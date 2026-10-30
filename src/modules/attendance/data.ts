import "server-only";
import { query, transaction, type Queryable } from "@/shared/db";
import { DomainError } from "@/shared/errors";
import { recordAudit } from "@/shared/audit";
import { ForbiddenError, requireRole, type Actor } from "@/shared/roles";
import { canDecide } from "@/shared/approvals";
import { addDays, formatDate, todayIST } from "@/shared/dates";
import { getDirectReportIds, getWorkforce, isCurrentManagerOf, type WorkforceRow } from "@/modules/employees/data";
import { getCalendarFacts } from "@/modules/leave/data";
import {
  canRegularize,
  checkFixTimes,
  defaultFixTimes,
  deriveDay,
  isFixable,
  nextPunchDirection,
  summarizeMonth,
  type DayResult,
  type MonthSummary,
  type Policy,
  type PunchTime,
} from "./rules";

// Attendance data access. Daily status is worked out from punches, approved leave, holidays and
// weekly offs when it is read (decision: "Attendance module"); nothing here stores a derived day.

const DEFAULT_POLICY: Policy = {
  workStart: "09:30",
  graceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 270,
  lateMarksPerDeduction: 3,
  regularizeUntilDay: 5,
};

export type DayRow = {
  id: string;
  code: string;
  fullName: string;
  department: string | null;
  location: string | null;
  day: DayResult;
};

export type MyAttendance = {
  today: string;
  year: number;
  month: number;
  policy: Policy;
  days: DayResult[];
  summary: MonthSummary;
  next: "in" | "out";
  todayIn: string | null;
  todayOut: string | null;
  canPunch: boolean;
  /** Days that need action and can still be fixed, with the times to prefill. */
  fixable: { date: string; status: string; note: string | null }[];
  /** Days that need action but are past the deadline: they count as unpaid (R55). */
  pastDeadline: { date: string; note: string | null }[];
  defaults: { in: string; out: string };
  requests: MyRegularization[];
};

export type MyRegularization = {
  id: string;
  date: string;
  inTime: string;
  outTime: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  decisionNote: string | null;
  canCancel: boolean;
};

export type RegularizationApproval = {
  id: string;
  batchId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  inTime: string;
  outTime: string;
  reason: string;
  waitingDays: number;
};

export type DaySheet = {
  date: string;
  rows: DayRow[];
  counts: Record<string, number>;
  notCheckedIn: number;
  late: number;
};

export type DaySummary = {
  total: number;
  counts: Record<string, number>;
  recorded: number;
  notRecorded: number;
  offToday: number;
};

function requireEmployee(actor: Actor | null): asserts actor is Actor {
  requireRole(actor, "employee");
}

const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
const monthEnd = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;

function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) dates.push(d);
  return dates;
}

/** Derive every day between `from` and `to` for the given employees (`null` means everyone, HR only). */
async function deriveRange(
  actor: Actor,
  employeeIds: string[] | null,
  from: string,
  to: string,
  q: Queryable,
): Promise<{ workforce: WorkforceRow[]; days: Map<string, DayResult[]>; policies: Map<string, Policy> }> {
  const today = todayIST();
  const workforce = await getWorkforce(actor, employeeIds, from, q);
  const ids = workforce.map((w) => w.id);
  const locationIds = [...new Set(workforce.map((w) => w.locationId).filter((l): l is string => !!l))];

  const [policyRows, punchRows, facts, fixRows] = await Promise.all([
    q.query<{
      location_id: string;
      work_start: string;
      grace_minutes: number;
      full_day_minutes: number;
      half_day_minutes: number;
      late_marks_per_deduction: number;
      regularize_until_day: number;
    }>(
      `select location_id, to_char(work_start, 'HH24:MI') as work_start, grace_minutes, full_day_minutes,
              half_day_minutes, late_marks_per_deduction, regularize_until_day
         from attendance_policy where location_id = any($1::uuid[])`,
      [locationIds],
    ),
    ids.length === 0
      ? Promise.resolve([] as { employee_id: string; d: string; hm: string; direction: "in" | "out" }[])
      : q.query<{ employee_id: string; d: string; hm: string; direction: "in" | "out" }>(
          `select employee_id, (punched_at at time zone 'Asia/Kolkata')::date::text as d,
                  to_char(punched_at at time zone 'Asia/Kolkata', 'HH24:MI') as hm, direction
             from punch
            where employee_id = any($1::uuid[])
              and (punched_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
            order by punched_at`,
          [ids, from, to],
        ),
    getCalendarFacts(actor, { employeeIds, locationIds, from, to }, q),
    ids.length === 0
      ? Promise.resolve([] as { employee_id: string; d: string; in_time: string; out_time: string; status: "pending" | "approved" }[])
      : q.query<{ employee_id: string; d: string; in_time: string; out_time: string; status: "pending" | "approved" }>(
          `select employee_id, work_date::text as d, to_char(in_time, 'HH24:MI') as in_time,
                  to_char(out_time, 'HH24:MI') as out_time, status
             from regularization
            where employee_id = any($1::uuid[]) and status in ('pending', 'approved') and work_date between $2::date and $3::date`,
          [ids, from, to],
        ),
  ]);
  const fixBy = new Map(fixRows.map((f) => [`${f.employee_id}|${f.d}`, { in: f.in_time, out: f.out_time, status: f.status }]));

  const policies = new Map<string, Policy>(
    policyRows.map((r) => [
      r.location_id,
      {
        workStart: r.work_start,
        graceMinutes: r.grace_minutes,
        fullDayMinutes: r.full_day_minutes,
        halfDayMinutes: r.half_day_minutes,
        lateMarksPerDeduction: r.late_marks_per_deduction,
        regularizeUntilDay: r.regularize_until_day,
      },
    ]),
  );

  const punchesBy = new Map<string, PunchTime[]>();
  for (const p of punchRows) {
    const key = `${p.employee_id}|${p.d}`;
    punchesBy.set(key, [...(punchesBy.get(key) ?? []), { time: p.hm, direction: p.direction }]);
  }
  const holidayBy = new Map(facts.holidays.map((h) => [`${h.locationId}|${h.date}`, h.name]));
  const leaveBy = new Map<string, typeof facts.leave>();
  for (const l of facts.leave) leaveBy.set(l.employeeId, [...(leaveBy.get(l.employeeId) ?? []), l]);

  const dates = datesBetween(from, to);
  const days = new Map<string, DayResult[]>();
  for (const w of workforce) {
    const policy = (w.locationId && policies.get(w.locationId)) || DEFAULT_POLICY;
    days.set(
      w.id,
      dates.map((date) => {
        const leave = (leaveBy.get(w.id) ?? []).find((l) => l.start <= date && l.end >= date);
        return deriveDay({
          date,
          today,
          weeklyOff: w.weeklyOffDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
          holiday: w.locationId ? (holidayBy.get(`${w.locationId}|${date}`) ?? null) : null,
          leave: leave ? leave.part : null,
          wfh: false, // work from home requests arrive in the next slice
          punches: punchesBy.get(`${w.id}|${date}`) ?? [],
          policy,
          regularization: fixBy.get(`${w.id}|${date}`) ?? null,
        });
      }),
    );
  }
  return { workforce, days, policies };
}

export async function getMyAttendance(actor: Actor | null, year: number, month: number, q: Queryable = { query }): Promise<MyAttendance> {
  requireEmployee(actor);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("Choose a valid month.");
  }
  const today = todayIST();
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const { workforce, days, policies } = await deriveRange(actor, [actor.employeeId], from, to, q);
  const me = workforce[0];
  const policy = (me?.locationId && policies.get(me.locationId)) || DEFAULT_POLICY;
  const list = days.get(actor.employeeId) ?? [];

  const todayPunches = await q.query<{ hm: string; direction: "in" | "out" }>(
    `select to_char(punched_at at time zone 'Asia/Kolkata', 'HH24:MI') as hm, direction
       from punch where employee_id = $1 and (punched_at at time zone 'Asia/Kolkata')::date = $2::date
      order by punched_at`,
    [actor.employeeId, today],
  );
  const punches: PunchTime[] = todayPunches.map((p) => ({ time: p.hm, direction: p.direction }));
  const ins = punches.filter((p) => p.direction === "in").map((p) => p.time);
  const outs = punches.filter((p) => p.direction === "out").map((p) => p.time);

  const fixable: MyAttendance["fixable"] = [];
  const pastDeadline: MyAttendance["pastDeadline"] = [];
  for (const d of list) {
    if (!isFixable(d)) continue;
    const ok = canRegularize({ date: d.date, today, regularizeUntilDay: policy.regularizeUntilDay });
    if (ok.ok) fixable.push({ date: d.date, status: d.status, note: d.note });
    else if (d.date < today) pastDeadline.push({ date: d.date, note: d.note });
  }

  return {
    today,
    year,
    month,
    policy,
    days: list,
    summary: summarizeMonth(list, policy),
    next: nextPunchDirection(punches),
    todayIn: ins[0] ?? null,
    todayOut: outs[outs.length - 1] ?? null,
    canPunch: !!me, // only active employees come back from the workforce lookup
    fixable,
    pastDeadline,
    defaults: defaultFixTimes(policy),
    requests: await myRegularizations(q, actor.employeeId),
  };
}

/** Check in or check out for the signed-in employee. The server clock decides the time. */
export async function punchTx(tx: Queryable, actor: Actor | null, opts: { at?: Date } = {}): Promise<{ direction: "in" | "out"; time: string }> {
  requireEmployee(actor);
  const emp = (await tx.query<{ status: string }>("select status from employee where id = $1 for update", [actor.employeeId]))[0];
  if (!emp || emp.status !== "active") throw new DomainError("Only active employees can check in.");

  const at = opts.at ?? new Date();
  const todayRows = await tx.query<{ hm: string; direction: "in" | "out"; seconds_ago: number }>(
    `select to_char(punched_at at time zone 'Asia/Kolkata', 'HH24:MI') as hm, direction,
            extract(epoch from ($2::timestamptz - punched_at))::float8 as seconds_ago
       from punch
      where employee_id = $1 and (punched_at at time zone 'Asia/Kolkata')::date = ($2::timestamptz at time zone 'Asia/Kolkata')::date
      order by punched_at`,
    [actor.employeeId, at.toISOString()],
  );
  const last = todayRows[todayRows.length - 1];
  if (last && last.seconds_ago >= 0 && last.seconds_ago < 60) {
    throw new DomainError(`You just checked ${last.direction === "in" ? "in" : "out"}. Please wait a minute before pressing again.`);
  }
  const direction = nextPunchDirection(todayRows.map((r) => ({ time: r.hm, direction: r.direction })));
  const inserted = await tx.query<{ hm: string }>(
    `insert into punch (employee_id, punched_at, direction, source) values ($1, $2::timestamptz, $3, 'web')
     returning to_char(punched_at at time zone 'Asia/Kolkata', 'HH24:MI') as hm`,
    [actor.employeeId, at.toISOString(), direction],
  );
  return { direction, time: inserted[0].hm };
}

export async function punch(actor: Actor | null) {
  requireEmployee(actor);
  return transaction((tx) => punchTx(tx, actor));
}

/** HR: every active employee's status for one date. */
export async function getDaySheet(actor: Actor | null, date: string, q: Queryable = { query }): Promise<DaySheet> {
  requireRole(actor, "hr_admin");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError("Choose a valid date.");
  const { workforce, days } = await deriveRange(actor, null, date, date, q);
  const rows: DayRow[] = workforce.map((w) => ({
    id: w.id,
    code: w.code,
    fullName: w.fullName,
    department: w.department,
    location: w.locationName,
    day: days.get(w.id)![0],
  }));
  const counts: Record<string, number> = {};
  let notCheckedIn = 0;
  let late = 0;
  for (const r of rows) {
    if (r.day.provisional && r.day.status === "absent") notCheckedIn += 1;
    else counts[r.day.status] = (counts[r.day.status] ?? 0) + 1;
    if (r.day.late) late += 1;
  }
  return { date, rows, counts, notCheckedIn, late };
}

/** HR: the numbers for the dashboard. */
export async function getDaySummary(actor: Actor | null, date: string): Promise<DaySummary> {
  const sheet = await getDaySheet(actor, date);
  const off = (sheet.counts.weekly_off ?? 0) + (sheet.counts.holiday ?? 0);
  const counts: Record<string, number> = {
    present: sheet.counts.present ?? 0,
    wfh: sheet.counts.wfh ?? 0,
    half_day: sheet.counts.half_day ?? 0,
    leave: sheet.counts.leave ?? 0,
    absent: (sheet.counts.absent ?? 0) + (sheet.counts.missed_punch ?? 0),
  };
  const recorded = Object.values(counts).reduce((a, b) => a + b, 0);
  return { total: sheet.rows.length, counts, recorded, notRecorded: sheet.notCheckedIn, offToday: off };
}

// ---------------------------------------------------------------------------------------------
// Regularization (R54 to R57)
// ---------------------------------------------------------------------------------------------

async function myRegularizations(q: Queryable, employeeId: string): Promise<MyRegularization[]> {
  const rows = await q.query<{
    id: string;
    d: string;
    in_time: string;
    out_time: string;
    status: MyRegularization["status"];
    reason: string;
    decision_note: string | null;
  }>(
    `select id, work_date::text as d, to_char(in_time, 'HH24:MI') as in_time, to_char(out_time, 'HH24:MI') as out_time,
            status, reason, decision_note
       from regularization where employee_id = $1 order by work_date desc, created_at desc limit 20`,
    [employeeId],
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.d,
    inTime: r.in_time,
    outTime: r.out_time,
    status: r.status,
    reason: r.reason,
    decisionNote: r.decision_note,
    canCancel: r.status === "pending",
  }));
}

export type RegularizeInput = { reason: string; items: { date: string; in: string; out: string }[] };

/** One request per day, all sharing one reason and one batch (bulk regularization). */
export async function requestRegularizationsTx(tx: Queryable, actor: Actor | null, input: RegularizeInput): Promise<{ batchId: string; count: number }> {
  requireEmployee(actor);
  const today = todayIST();
  const emp = (await tx.query<{ status: string }>("select status from employee where id = $1 for update", [actor.employeeId]))[0];
  if (!emp || emp.status !== "active") throw new DomainError("Only active employees can fix attendance.");

  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("Please give a short reason.");
  if (input.items.length === 0) throw new DomainError("Tick at least one day to fix.");
  if (input.items.length > 31) throw new DomainError("You can fix at most 31 days at a time.");
  const dates = input.items.map((i) => i.date);
  if (new Set(dates).size !== dates.length) throw new DomainError("The same day was chosen twice.");

  const from = [...dates].sort()[0];
  const to = [...dates].sort()[dates.length - 1];
  const { days, policies, workforce } = await deriveRange(actor, [actor.employeeId], from, to, tx);
  const policy = (workforce[0]?.locationId && policies.get(workforce[0].locationId)) || DEFAULT_POLICY;
  const mine = new Map((days.get(actor.employeeId) ?? []).map((d) => [d.date, d]));

  for (const item of input.items) {
    const label = formatDate(item.date);
    const when = canRegularize({ date: item.date, today, regularizeUntilDay: policy.regularizeUntilDay });
    if (!when.ok) throw new DomainError(`${label}: ${when.error}`);
    const times = checkFixTimes(item.in, item.out);
    if (!times.ok) throw new DomainError(`${label}: ${times.error}`);
    const day = mine.get(item.date);
    if (!day || !isFixable(day)) {
      throw new DomainError(`${label} does not need fixing, or a fix for it has already been sent.`);
    }
  }

  const batchId = (await tx.query<{ id: string }>("select gen_random_uuid()::text as id"))[0].id;
  for (const item of input.items) {
    await tx.query(
      `insert into regularization (employee_id, work_date, batch_id, in_time, out_time, reason)
       values ($1, $2, $3, $4, $5, $6)`,
      [actor.employeeId, item.date, batchId, item.in, item.out, reason],
    );
  }
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "regularization_requested",
      entity: "regularization",
      entityId: batchId,
      summary: `${input.items.length} ${input.items.length === 1 ? "day" : "days"}: ${[...dates].sort().join(", ")}`,
    },
    tx,
  );
  return { batchId, count: input.items.length };
}

export async function requestRegularizations(actor: Actor | null, input: RegularizeInput) {
  requireEmployee(actor);
  return transaction((tx) => requestRegularizationsTx(tx, actor, input));
}

export async function cancelRegularizationTx(tx: Queryable, actor: Actor | null, requestId: string): Promise<void> {
  requireEmployee(actor);
  const req = (
    await tx.query<{ employee_id: string; status: string; d: string }>(
      "select employee_id, status, work_date::text as d from regularization where id = $1 for update",
      [requestId],
    )
  )[0];
  if (!req) throw new DomainError("That request was not found.");
  if (req.employee_id !== actor.employeeId) throw new ForbiddenError("You cannot cancel this request.");
  if (req.status !== "pending") throw new DomainError("Only a request that is still waiting can be cancelled.");
  await tx.query("update regularization set status = 'cancelled' where id = $1", [requestId]);
  await recordAudit({ actorEmployeeId: actor.employeeId, action: "regularization_cancelled", entity: "regularization", entityId: requestId, summary: req.d }, tx);
}

export async function cancelRegularization(actor: Actor | null, requestId: string) {
  requireEmployee(actor);
  return transaction((tx) => cancelRegularizationTx(tx, actor, requestId));
}

/** Approve or reject one or more days together. All or nothing. */
export async function decideRegularizationsTx(
  tx: Queryable,
  actor: Actor | null,
  input: { requestIds: string[]; decision: "approve" | "reject"; note?: string },
): Promise<{ count: number }> {
  requireEmployee(actor);
  if (input.requestIds.length === 0) throw new DomainError("Choose at least one request.");
  const isHr = actor.roles.includes("hr_admin");
  const dates: string[] = [];

  for (const id of input.requestIds) {
    const req = (
      await tx.query<{ employee_id: string; status: string; d: string }>(
        "select employee_id, status, work_date::text as d from regularization where id = $1 for update",
        [id],
      )
    )[0];
    if (!req) throw new DomainError("That request was not found.");
    if (req.status !== "pending") throw new DomainError("A request has already been decided or cancelled.");
    const allowed = canDecide({
      actorEmployeeId: actor.employeeId,
      actorIsHrAdmin: isHr,
      actorIsManagerOfRequester: await isCurrentManagerOf(tx, actor.employeeId, req.employee_id),
      requesterEmployeeId: req.employee_id,
    });
    if (!allowed) throw new ForbiddenError("You cannot decide this request.");
    await tx.query(
      `update regularization set status = $2, approver_id = $3, decided_at = now(), decision_note = $4 where id = $1`,
      [id, input.decision === "approve" ? "approved" : "rejected", actor.employeeId, input.note ?? null],
    );
    dates.push(req.d);
  }
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: input.decision === "approve" ? "regularization_approved" : "regularization_rejected",
      entity: "regularization",
      entityId: input.requestIds[0],
      summary: `${dates.length} ${dates.length === 1 ? "day" : "days"}: ${dates.sort().join(", ")}`,
    },
    tx,
  );
  return { count: dates.length };
}

export async function decideRegularizations(actor: Actor | null, input: { requestIds: string[]; decision: "approve" | "reject"; note?: string }) {
  requireEmployee(actor);
  return transaction((tx) => decideRegularizationsTx(tx, actor, input));
}

/** Pending fixes the signed-in person may decide: direct reports for a manager, everyone for HR (never their own). */
export async function listRegularizationApprovals(actor: Actor | null, q: Queryable = { query }): Promise<RegularizationApproval[]> {
  requireEmployee(actor);
  const isHr = actor.roles.includes("hr_admin");
  const reportIds = isHr ? null : await getDirectReportIds(actor, q);
  if (reportIds !== null && reportIds.length === 0) return [];
  const today = todayIST();
  const rows = await q.query<{
    id: string;
    batch_id: string;
    employee_id: string;
    employee_code: string;
    full_name: string;
    d: string;
    in_time: string;
    out_time: string;
    reason: string;
    waiting: number;
  }>(
    `select r.id, r.batch_id, e.id as employee_id, e.employee_code, e.full_name, r.work_date::text as d,
            to_char(r.in_time, 'HH24:MI') as in_time, to_char(r.out_time, 'HH24:MI') as out_time, r.reason,
            ($3::date - (r.created_at at time zone 'Asia/Kolkata')::date)::int as waiting
       from regularization r join employee e on e.id = r.employee_id
      where r.status = 'pending' and e.status = 'active' and e.id <> $1
        and ($2::uuid[] is null or e.id = any($2::uuid[]))
      order by r.created_at, r.work_date
      limit 200`,
    [actor.employeeId, reportIds, today],
  );
  return rows.map((r) => ({
    id: r.id,
    batchId: r.batch_id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    date: r.d,
    inTime: r.in_time,
    outTime: r.out_time,
    reason: r.reason,
    waitingDays: r.waiting,
  }));
}

/** For tabs and navigation: can this person approve attendance fixes, and how many are waiting? */
export async function getAttendanceApprovalScope(actor: Actor | null): Promise<{ canApprove: boolean; pending: number }> {
  requireEmployee(actor);
  const isHr = actor.roles.includes("hr_admin");
  const reports = isHr ? [] : await getDirectReportIds(actor);
  const canApprove = isHr || reports.length > 0;
  if (!canApprove) return { canApprove, pending: 0 };
  return { canApprove, pending: (await listRegularizationApprovals(actor)).length };
}
