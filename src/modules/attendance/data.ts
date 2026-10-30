import "server-only";
import { query, transaction, type Queryable } from "@/shared/db";
import { DomainError } from "@/shared/errors";
import { recordAudit } from "@/shared/audit";
import { ForbiddenError, requireRole, type Actor } from "@/shared/roles";
import { canDecide } from "@/shared/approvals";
import { firstLockedMonth, lockMonthExclusive, lockMonthsShared, lockedMonthKeys } from "@/shared/periods";
import { addDays, formatDate, isRealDate, todayIST } from "@/shared/dates";
import { getAssignmentSpans, getDirectReportIds, getWorkforce, isCurrentManagerOf, type AssignmentSpan, type WorkforceRow } from "@/modules/employees/data";
import { getCalendarFacts } from "@/modules/leave/data";
import {
  MONTH_NAMES,
  allocateUnpaid,
  canLockMonth,
  WFH_MAX_DAYS_AHEAD,
  WFH_MAX_RANGE_DAYS,
  canRegularize,
  canWorkFromHomeOn,
  checkWfhWindow,
  checkFixTimes,
  defaultFixTimes,
  deriveDay,
  freezeDay,
  isFixable,
  isUnpaidFrozen,
  nextPunchDirection,
  spanAt,
  summarizeMonth,
  wfhLimitError,
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

type FrozenRow = {
  employee_id: string;
  d: string;
  status: DayResult["status"];
  worked_minutes: number | null;
  late: boolean;
  note: string | null;
  first_in: string | null;
  last_out: string | null;
  unpaid_days: number;
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
  /** HR has locked this month: it cannot be changed (R60). */
  locked: boolean;
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
  /** Active employees who had not joined yet (or had left) on this date. */
  notEmployed: number;
};

export type DaySummary = {
  total: number;
  counts: Record<string, number>;
  recorded: number;
  notRecorded: number;
  offToday: number;
  /** Not yet joined or already left on this date: not expected, not absent (R61). */
  notEmployed: number;
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
  opts: { period?: boolean; ignoreFrozen?: boolean } = {},
): Promise<{
  workforce: WorkforceRow[];
  days: Map<string, DayResult[]>;
  policies: Map<string, Policy>;
  /** The attendance policy that applies to a person on a day (R63). */
  policyAt: (employeeId: string, date: string) => Policy;
}> {
  const today = todayIST();
  const workforce = await getWorkforce(actor, employeeIds, from, q, opts.period ? { from, to } : undefined);
  const ids = workforce.map((w) => w.id);

  // Location, weekly offs, holidays and policy are decided per day from the assignment effective that
  // day, not once for the first day of the period (R63).
  const spans = ids.length === 0 ? [] : await getAssignmentSpans(actor, ids, from, to, q);
  const spansBy = new Map<string, AssignmentSpan[]>();
  for (const sp of spans) spansBy.set(sp.employeeId, [...(spansBy.get(sp.employeeId) ?? []), sp]);
  const locationIds = [
    ...new Set([...spans.map((sp) => sp.locationId), ...workforce.map((w) => w.locationId).filter((l): l is string => !!l)]),
  ];

  const [policyRows, punchRows, facts, fixRows, frozenRows, wfhRows] = await Promise.all([
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
    ids.length === 0 || opts.ignoreFrozen
      ? Promise.resolve([] as FrozenRow[])
      : q.query<FrozenRow>(
          `select employee_id, work_date::text as d, status, worked_minutes, late, note, unpaid_days::float8 as unpaid_days,
                  to_char(first_in at time zone 'Asia/Kolkata', 'HH24:MI') as first_in,
                  to_char(last_out at time zone 'Asia/Kolkata', 'HH24:MI') as last_out
             from attendance_day
            where locked and employee_id = any($1::uuid[]) and work_date between $2::date and $3::date`,
          [ids, from, to],
        ),
    ids.length === 0
      ? Promise.resolve([] as { employee_id: string; d: string }[])
      : q.query<{ employee_id: string; d: string }>(
          `select employee_id, work_date::text as d from wfh_request
            where employee_id = any($1::uuid[]) and status = 'approved' and work_date between $2::date and $3::date`,
          [ids, from, to],
        ),
  ]);
  const wfhDays = new Set(wfhRows.map((w) => `${w.employee_id}|${w.d}`));
  const frozenBy = new Map(frozenRows.map((f) => [`${f.employee_id}|${f.d}`, f]));
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

  const policyAt = (employeeId: string, date: string): Policy => {
    const span = spanAt(
      (spansBy.get(employeeId) ?? []).map((sp) => ({ ...sp, from: sp.from, to: sp.to })),
      date,
    );
    return (span && policies.get(span.locationId)) || DEFAULT_POLICY;
  };

  // How much of each approved leave day is unpaid (R64). Working days outside the period use Monday to
  // Friday with no holidays, because assignments and holidays were only loaded for the period.
  const unpaidLeave = new Map<string, number>();
  for (const l of facts.leave) {
    if (l.typeCode !== "LOP" && l.lopDays <= 0) continue;
    const empSpans = spansBy.get(l.employeeId) ?? [];
    const working = (date: string) => {
      const span = spanAt(empSpans, date);
      const off = (span?.weeklyOffDays ?? [0, 6]).includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const holiday = span ? holidayBy.has(`${span.locationId}|${date}`) : false;
      return !off && !holiday;
    };
    for (const [date, amount] of allocateUnpaid(l, working)) {
      unpaidLeave.set(`${l.employeeId}|${date}`, (unpaidLeave.get(`${l.employeeId}|${date}`) ?? 0) + amount);
    }
  }

  const dates = datesBetween(from, to);
  const days = new Map<string, DayResult[]>();
  for (const w of workforce) {
    const empSpans = spansBy.get(w.id) ?? [];
    days.set(
      w.id,
      dates.map((date) => {
        const frozen = frozenBy.get(`${w.id}|${date}`);
        if (frozen) {
          return {
            date,
            status: frozen.status,
            firstIn: frozen.first_in,
            lastOut: frozen.last_out,
            workedMinutes: frozen.worked_minutes,
            late: frozen.late,
            needsAction: false,
            provisional: false,
            regularized: false,
            fixPending: false,
            employed: true,
            locked: true,
            unpaid: frozen.unpaid_days,
            note: frozen.note,
          } satisfies DayResult;
        }
        const leave = (leaveBy.get(w.id) ?? []).find((l) => l.start <= date && l.end >= date);
        const span = spanAt(empSpans, date);
        const weeklyOffDays = span?.weeklyOffDays ?? [0, 6]; // no assignment that day: Saturday and Sunday off
        return deriveDay({
          employed: date >= w.joiningDate && (!w.exitDate || date <= w.exitDate),
          date,
          today,
          weeklyOff: weeklyOffDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()),
          holiday: span ? (holidayBy.get(`${span.locationId}|${date}`) ?? null) : null,
          leave: leave ? leave.part : null,
          unpaidLeave: unpaidLeave.get(`${w.id}|${date}`) ?? 0,
          wfh: wfhDays.has(`${w.id}|${date}`),
          punches: punchesBy.get(`${w.id}|${date}`) ?? [],
          policy: (span && policies.get(span.locationId)) || DEFAULT_POLICY,
          regularization: fixBy.get(`${w.id}|${date}`) ?? null,
        });
      }),
    );
  }
  return { workforce, days, policies, policyAt };
}

export async function getMyAttendance(actor: Actor | null, year: number, month: number, q: Queryable = { query }): Promise<MyAttendance> {
  requireEmployee(actor);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("Choose a valid month.");
  }
  const today = todayIST();
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const { workforce, days, policyAt } = await deriveRange(actor, [actor.employeeId], from, to, q);
  const me = workforce[0];
  // The policy shown for the month is the one in force today (or on the last day of a past month).
  const policy = policyAt(actor.employeeId, today < from ? from : today > to ? to : today);
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

  const locked = (await lockedMonthKeys(from, to, q)).has(`${year}-${String(month).padStart(2, "0")}`);
  const fixable: MyAttendance["fixable"] = [];
  const pastDeadline: MyAttendance["pastDeadline"] = [];
  for (const d of locked ? [] : list) {
    if (!isFixable(d)) continue;
    const ok = canRegularize({ date: d.date, today, regularizeUntilDay: policyAt(actor.employeeId, d.date).regularizeUntilDay });
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
    canPunch: !!me && !locked, // only active employees come back from the workforce lookup
    locked,
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
  await lockMonthsShared(tx, [todayIST(at)]); // R65: wait for an in-progress month lock
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
  if (!isRealDate(date)) throw new DomainError("Choose a valid date.");
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
  let notEmployed = 0;
  for (const r of rows) {
    if (!r.day.employed) notEmployed += 1;
    else if (r.day.provisional && r.day.status === "absent") notCheckedIn += 1;
    else counts[r.day.status] = (counts[r.day.status] ?? 0) + 1;
    if (r.day.late) late += 1;
  }
  return { date, rows, counts, notCheckedIn, late, notEmployed };
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
  return { total: sheet.rows.length, counts, recorded, notRecorded: sheet.notCheckedIn, offToday: off, notEmployed: sheet.notEmployed };
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

  await lockMonthsShared(tx, dates); // R65
  const lockedMonth = await firstLockedMonth(tx, dates);
  if (lockedMonth) {
    const [y, m] = lockedMonth.split("-").map(Number);
    throw new DomainError(`${MONTH_NAMES[m - 1]} ${y} is locked, so its days can no longer be fixed. Please talk to HR.`);
  }

  const from = [...dates].sort()[0];
  const to = [...dates].sort()[dates.length - 1];
  const { days, policyAt } = await deriveRange(actor, [actor.employeeId], from, to, tx);
  const mine = new Map((days.get(actor.employeeId) ?? []).map((d) => [d.date, d]));

  for (const item of input.items) {
    const label = formatDate(item.date);
    const when = canRegularize({ date: item.date, today, regularizeUntilDay: policyAt(actor.employeeId, item.date).regularizeUntilDay });
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
  await lockMonthsShared(tx, [req.d]); // R65
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
    await lockMonthsShared(tx, [req.d]); // R65
    if (await firstLockedMonth(tx, [req.d])) throw new DomainError("That month is locked, so this request can no longer be decided.");
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

// ---------------------------------------------------------------------------------------------
// Work from home requests (docs/decisions.md, "Work-from-home requests")
// ---------------------------------------------------------------------------------------------

export type MyWfhRequest = {
  id: string;
  date: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string;
  decisionNote: string | null;
  canCancel: boolean;
};

export type MyWfh = {
  today: string;
  allowed: boolean;
  daysPerMonth: number;
  /** Pending and approved days in the current month. */
  usedThisMonth: number;
  latestDate: string;
  requests: MyWfhRequest[];
};

export type WfhApproval = {
  id: string;
  batchId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  date: string;
  reason: string;
  waitingDays: number;
  /** Pending and approved days this person already has in that month, including this one. */
  monthDays: number;
};

export type WfhInput = { startDate: string; endDate: string; reason: string };

async function wfhPolicyFor(tx: Queryable, actor: Actor, from: string, to: string): Promise<(date: string) => { allowed: boolean; limit: number }> {
  const spans = await getAssignmentSpans(actor, [actor.employeeId], from, to, tx);
  const rows = await tx.query<{ location_id: string; wfh_allowed: boolean; wfh_days_per_month: number }>(
    "select location_id, wfh_allowed, wfh_days_per_month from attendance_policy where location_id = any($1::uuid[])",
    [[...new Set(spans.map((s) => s.locationId))]],
  );
  const by = new Map(rows.map((r) => [r.location_id, { allowed: r.wfh_allowed, limit: r.wfh_days_per_month }]));
  return (date) => {
    const span = spanAt(spans, date);
    return (span && by.get(span.locationId)) || { allowed: false, limit: 0 };
  };
}

async function openWfhInMonth(tx: Queryable, employeeId: string, year: number, month: number): Promise<number> {
  const rows = await tx.query<{ n: number }>(
    `select count(*)::int as n from wfh_request
      where employee_id = $1 and status in ('pending', 'approved') and work_date between $2::date and $3::date`,
    [employeeId, monthStart(year, month), monthEnd(year, month)],
  );
  return rows[0].n;
}

export async function getMyWfh(actor: Actor | null, q: Queryable = { query }): Promise<MyWfh> {
  requireEmployee(actor);
  const today = todayIST();
  const latestDate = addDays(today, WFH_MAX_DAYS_AHEAD);
  const [y, m] = today.split("-").map(Number);
  const policyAt = await wfhPolicyFor(q, actor, today, latestDate);
  const here = policyAt(today);
  const rows = await q.query<{ id: string; d: string; status: MyWfhRequest["status"]; reason: string; decision_note: string | null }>(
    `select id, work_date::text as d, status, reason, decision_note from wfh_request
      where employee_id = $1 order by work_date desc, created_at desc limit 30`,
    [actor.employeeId],
  );
  return {
    today,
    allowed: here.allowed,
    daysPerMonth: here.limit,
    usedThisMonth: await openWfhInMonth(q, actor.employeeId, y, m),
    latestDate,
    requests: rows.map((r) => ({
      id: r.id,
      date: r.d,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decision_note,
      canCancel: r.status === "pending" || (r.status === "approved" && r.d > today),
    })),
  };
}

/** Ask to work from home on every working day from the start date to the end date. */
export async function requestWfhTx(tx: Queryable, actor: Actor | null, input: WfhInput): Promise<{ batchId: string; count: number; skipped: string[] }> {
  requireEmployee(actor);
  const today = todayIST();
  const emp = (await tx.query<{ status: string }>("select status from employee where id = $1 for update", [actor.employeeId]))[0];
  if (!emp || emp.status !== "active") throw new DomainError("Only active employees can ask to work from home.");

  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError("Please give a short reason.");
  const window = checkWfhWindow({ start: input.startDate, end: input.endDate, today, latest: addDays(today, WFH_MAX_DAYS_AHEAD) });
  if (!window.ok) throw new DomainError(window.error);
  const asked = datesBetween(input.startDate, input.endDate);
  if (asked.length > WFH_MAX_RANGE_DAYS) throw new DomainError(`Please choose at most ${WFH_MAX_RANGE_DAYS} days at a time.`);

  await lockMonthsShared(tx, asked); // R65
  const lockedMonth = await firstLockedMonth(tx, asked);
  if (lockedMonth) {
    const [y, m] = lockedMonth.split("-").map(Number);
    throw new DomainError(`${MONTH_NAMES[m - 1]} ${y} is locked, so it can no longer be changed. Please talk to HR.`);
  }

  const policyAt = await wfhPolicyFor(tx, actor, input.startDate, input.endDate);
  const { days } = await deriveRange(actor, [actor.employeeId], input.startDate, input.endDate, tx);
  const mine = new Map((days.get(actor.employeeId) ?? []).map((d) => [d.date, d]));
  const open = new Set(
    (
      await tx.query<{ d: string }>(
        "select work_date::text as d from wfh_request where employee_id = $1 and status in ('pending', 'approved') and work_date between $2::date and $3::date",
        [actor.employeeId, input.startDate, input.endDate],
      )
    ).map((r) => r.d),
  );

  const dates: string[] = [];
  const skipped: string[] = [];
  for (const date of asked) {
    const day = mine.get(date);
    if (!day || !canWorkFromHomeOn(day) || open.has(date)) skipped.push(date);
    else dates.push(date);
  }
  if (dates.length === 0) throw new DomainError("There is no working day to ask for in these dates (weekly offs, holidays, leave and days already requested are skipped).");

  // Where you work on the first day decides whether it is allowed and how many days a month you get.
  const rule = policyAt(dates[0]);
  if (!rule.allowed) throw new DomainError("Work from home is not available for your location. Please talk to your manager or HR.");
  const byMonth = new Map<string, string[]>();
  for (const d of dates) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d]);
  for (const [key, list] of byMonth) {
    const [y, m] = key.split("-").map(Number);
    const err = wfhLimitError({
      monthLabel: `${MONTH_NAMES[m - 1]} ${y}`,
      alreadyUsed: await openWfhInMonth(tx, actor.employeeId, y, m),
      asking: list.length,
      limit: policyAt(list[0]).limit,
    });
    if (err) throw new DomainError(err);
  }

  const batchId = (await tx.query<{ id: string }>("select gen_random_uuid()::text as id"))[0].id;
  for (const date of dates) {
    await tx.query("insert into wfh_request (employee_id, work_date, batch_id, reason) values ($1, $2, $3, $4)", [actor.employeeId, date, batchId, reason]);
  }
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "wfh_requested",
      entity: "wfh_request",
      entityId: batchId,
      summary: `${dates.length} ${dates.length === 1 ? "day" : "days"}: ${dates.join(", ")}`,
    },
    tx,
  );
  return { batchId, count: dates.length, skipped };
}

export async function requestWfh(actor: Actor | null, input: WfhInput) {
  requireEmployee(actor);
  return transaction((tx) => requestWfhTx(tx, actor, input));
}

export async function cancelWfhTx(tx: Queryable, actor: Actor | null, requestId: string): Promise<void> {
  requireEmployee(actor);
  const req = (
    await tx.query<{ employee_id: string; status: string; d: string }>(
      "select employee_id, status, work_date::text as d from wfh_request where id = $1 for update",
      [requestId],
    )
  )[0];
  if (!req) throw new DomainError("That request was not found.");
  if (req.employee_id !== actor.employeeId) throw new ForbiddenError("You cannot cancel this request.");
  const today = todayIST();
  if (req.status === "approved" && req.d <= today) throw new DomainError("An approved day can only be cancelled before the day starts.");
  if (req.status !== "pending" && req.status !== "approved") throw new DomainError("This request is already closed.");
  await lockMonthsShared(tx, [req.d]); // R65
  if (await firstLockedMonth(tx, [req.d])) throw new DomainError("That month is locked, so this request can no longer be changed.");
  await tx.query("update wfh_request set status = 'cancelled' where id = $1", [requestId]);
  await recordAudit({ actorEmployeeId: actor.employeeId, action: "wfh_cancelled", entity: "wfh_request", entityId: requestId, summary: req.d }, tx);
}

export async function cancelWfh(actor: Actor | null, requestId: string) {
  requireEmployee(actor);
  return transaction((tx) => cancelWfhTx(tx, actor, requestId));
}

/** Approve or reject one or more days together. All or nothing. */
export async function decideWfhTx(
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
        "select employee_id, status, work_date::text as d from wfh_request where id = $1 for update",
        [id],
      )
    )[0];
    if (!req) throw new DomainError("That request was not found.");
    if (req.status !== "pending") throw new DomainError("A request has already been decided or cancelled.");
    await lockMonthsShared(tx, [req.d]); // R65
    if (await firstLockedMonth(tx, [req.d])) throw new DomainError("That month is locked, so this request can no longer be decided.");
    const allowed = canDecide({
      actorEmployeeId: actor.employeeId,
      actorIsHrAdmin: isHr,
      actorIsManagerOfRequester: await isCurrentManagerOf(tx, actor.employeeId, req.employee_id),
      requesterEmployeeId: req.employee_id,
    });
    if (!allowed) throw new ForbiddenError("You cannot decide this request.");
    if (input.decision === "approve" && req.d < todayIST()) throw new DomainError("This day has already passed, so it cannot be approved. You can reject it to close it.");
    await tx.query(
      "update wfh_request set status = $2, approver_id = $3, decided_at = now(), decision_note = $4 where id = $1",
      [id, input.decision === "approve" ? "approved" : "rejected", actor.employeeId, input.note ?? null],
    );
    dates.push(req.d);
  }
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: input.decision === "approve" ? "wfh_approved" : "wfh_rejected",
      entity: "wfh_request",
      entityId: input.requestIds[0],
      summary: `${dates.length} ${dates.length === 1 ? "day" : "days"}: ${dates.sort().join(", ")}`,
    },
    tx,
  );
  return { count: dates.length };
}

export async function decideWfh(actor: Actor | null, input: { requestIds: string[]; decision: "approve" | "reject"; note?: string }) {
  requireEmployee(actor);
  return transaction((tx) => decideWfhTx(tx, actor, input));
}

/** Pending requests the signed-in person may decide: direct reports for a manager, everyone for HR (never their own). */
export async function listWfhApprovals(actor: Actor | null, q: Queryable = { query }): Promise<WfhApproval[]> {
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
    reason: string;
    waiting: number;
    month_days: number;
  }>(
    `select r.id, r.batch_id, e.id as employee_id, e.employee_code, e.full_name, r.work_date::text as d, r.reason,
            ($3::date - (r.created_at at time zone 'Asia/Kolkata')::date)::int as waiting,
            (select count(*)::int from wfh_request o
              where o.employee_id = r.employee_id and o.status in ('pending', 'approved')
                and date_trunc('month', o.work_date) = date_trunc('month', r.work_date)) as month_days
       from wfh_request r join employee e on e.id = r.employee_id
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
    reason: r.reason,
    waitingDays: r.waiting,
    monthDays: r.month_days,
  }));
}

/** For tabs and navigation: can this person approve attendance fixes, and how many are waiting? */
export async function getAttendanceApprovalScope(actor: Actor | null): Promise<{ canApprove: boolean; pending: number }> {
  requireEmployee(actor);
  const isHr = actor.roles.includes("hr_admin");
  const reports = isHr ? [] : await getDirectReportIds(actor);
  const canApprove = isHr || reports.length > 0;
  if (!canApprove) return { canApprove, pending: 0 };
  return { canApprove, pending: (await listRegularizationApprovals(actor)).length + (await listWfhApprovals(actor)).length };
}

// ---------------------------------------------------------------------------------------------
// Month lock (HR): freeze a finished month (R58 to R62)
// ---------------------------------------------------------------------------------------------

export type MonthLockRow = {
  month: number;
  state: "locked" | "open" | "future";
  lockedAt: string | null;
  lockedBy: string | null;
  employees: number | null;
};

export type LockPreview = {
  year: number;
  month: number;
  label: string;
  employees: number;
  days: number;
  unpaidDays: number;
  unpaidPeople: { code: string; name: string; days: number }[];
  pendingFixes: number;
  /** Employees can still send fixes for this month (the deadline has not passed). */
  beforeDeadline: boolean;
  alreadyLocked: boolean;
  blockers: string[];
  canLock: boolean;
};

export type LockResult = { year: number; month: number; employees: number; days: number; unpaidDays: number };

const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export async function getLockOverview(actor: Actor | null, year: number): Promise<MonthLockRow[]> {
  requireRole(actor, "hr_admin");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DomainError("Choose a valid year.");
  const today = todayIST();
  const rows = await query<{ month: number; locked_at: string; locked_by_name: string; employee_count: number }>(
    `select p.month, p.locked_at::text, e.full_name as locked_by_name, p.employee_count
       from attendance_period p join employee e on e.id = p.locked_by where p.year = $1`,
    [year],
  );
  const lockedBy = new Map(rows.map((r) => [r.month, r]));
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const row = lockedBy.get(month);
    if (row) return { month, state: "locked" as const, lockedAt: row.locked_at, lockedBy: row.locked_by_name, employees: row.employee_count };
    const done = canLockMonth({ today, year, month }).ok;
    return { month, state: done ? ("open" as const) : ("future" as const), lockedAt: null, lockedBy: null, employees: null };
  });
}

async function planLock(actor: Actor, year: number, month: number, q: Queryable) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOf(year, month)).padStart(2, "0")}`;
  const { workforce, days } = await deriveRange(actor, null, from, to, q, { period: true, ignoreFrozen: true });
  const rows: { employee: WorkforceRow; date: string; frozen: NonNullable<ReturnType<typeof freezeDay>> }[] = [];
  const unpaid = new Map<string, { code: string; name: string; days: number }>();
  let unpaidDays = 0;
  for (const w of workforce) {
    for (const d of days.get(w.id) ?? []) {
      const frozen = freezeDay(d);
      if (!frozen) continue;
      rows.push({ employee: w, date: d.date, frozen });
      if (isUnpaidFrozen(frozen)) {
        unpaidDays += frozen.unpaid;
        const u = unpaid.get(w.id) ?? { code: w.code, name: w.fullName, days: 0 };
        u.days += frozen.unpaid;
        unpaid.set(w.id, u);
      }
    }
  }
  return { from, to, workforce, rows, unpaidDays, unpaid: [...unpaid.values()].sort((a, b) => b.days - a.days) };
}

/** Read-only: what locking this month would do, and what stands in the way. */
export async function previewMonthLock(actor: Actor | null, year: number, month: number, q: Queryable = { query }): Promise<LockPreview> {
  requireRole(actor, "hr_admin");
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("Choose a valid month.");
  }
  const today = todayIST();
  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  const plan = await planLock(actor, year, month, q);
  const pending = await q.query<{ n: number }>(
    "select count(*)::int as n from regularization where status = 'pending' and work_date between $1::date and $2::date",
    [plan.from, plan.to],
  );
  const alreadyLocked = (await lockedMonthKeys(plan.from, plan.to, q)).has(`${year}-${String(month).padStart(2, "0")}`);
  const timing = canLockMonth({ today, year, month });
  const blockers: string[] = [];
  if (alreadyLocked) blockers.push(`${label} is already locked.`);
  if (!timing.ok) blockers.push(timing.error);
  if (pending[0].n > 0) {
    blockers.push(`${pending[0].n} ${pending[0].n === 1 ? "fix is" : "fixes are"} still waiting for approval. Decide them first.`);
  }
  const policyDay = DEFAULT_POLICY.regularizeUntilDay;
  const lastDay = plan.to;
  return {
    year,
    month,
    label,
    employees: plan.workforce.length,
    days: plan.rows.length,
    unpaidDays: plan.unpaidDays,
    unpaidPeople: plan.unpaid.slice(0, 15),
    pendingFixes: pending[0].n,
    beforeDeadline: canRegularize({ date: lastDay, today, regularizeUntilDay: policyDay }).ok,
    alreadyLocked,
    blockers,
    canLock: blockers.length === 0,
  };
}

export async function lockMonthTx(tx: Queryable, actor: Actor | null, input: { year: number; month: number }): Promise<LockResult> {
  requireRole(actor, "hr_admin");
  const { year, month } = input;
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError("Choose a valid month.");
  }
  const label = `${MONTH_NAMES[month - 1]} ${year}`;
  const timing = canLockMonth({ today: todayIST(), year, month });
  if (!timing.ok) throw new DomainError(timing.error);

  // R65: wait for every change to this month that is already in progress, and stop new ones, until we commit.
  await lockMonthExclusive(tx, year, month);

  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDayOf(year, month)).padStart(2, "0")}`;
  if ((await lockedMonthKeys(from, to, tx)).has(`${year}-${String(month).padStart(2, "0")}`)) {
    throw new DomainError(`${label} is already locked.`);
  }
  const pending = await tx.query<{ n: number }>(
    "select count(*)::int as n from regularization where status = 'pending' and work_date between $1::date and $2::date",
    [from, to],
  );
  if (pending[0].n > 0) {
    throw new DomainError(`${pending[0].n} ${pending[0].n === 1 ? "fix is" : "fixes are"} still waiting for approval. Decide them before locking ${label}.`);
  }

  const plan = await planLock(actor, year, month, tx);
  const stamp = (date: string, hm: string | null) => (hm ? `${date}T${hm}:00+05:30` : null);
  if (plan.rows.length > 0) {
    await tx.query(
      `insert into attendance_day (employee_id, work_date, status, first_in, last_out, worked_minutes, late, locked, note, unpaid_days)
       select employee_id, work_date, status, first_in, last_out, worked_minutes, late, true, note, unpaid_days
         from unnest($1::uuid[], $2::date[], $3::text[], $4::timestamptz[], $5::timestamptz[], $6::int[], $7::boolean[], $8::text[], $9::numeric[])
              as t(employee_id, work_date, status, first_in, last_out, worked_minutes, late, note, unpaid_days)
       on conflict (employee_id, work_date) do update
         set status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
             worked_minutes = excluded.worked_minutes, late = excluded.late, locked = true, note = excluded.note,
             unpaid_days = excluded.unpaid_days
         where attendance_day.locked = false`,
      [
        plan.rows.map((r) => r.employee.id),
        plan.rows.map((r) => r.date),
        plan.rows.map((r) => r.frozen.status),
        plan.rows.map((r) => stamp(r.date, r.frozen.firstIn)),
        plan.rows.map((r) => stamp(r.date, r.frozen.lastOut)),
        plan.rows.map((r) => r.frozen.workedMinutes),
        plan.rows.map((r) => r.frozen.late),
        plan.rows.map((r) => r.frozen.note),
        plan.rows.map((r) => r.frozen.unpaid),
      ],
    );
  }
  await tx.query("insert into attendance_period (year, month, locked_by, employee_count) values ($1, $2, $3, $4)", [
    year,
    month,
    actor.employeeId,
    plan.workforce.length,
  ]);
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "attendance_month_locked",
      entity: "attendance_period",
      entityId: `${year}-${String(month).padStart(2, "0")}`,
      summary: `${label}: ${plan.workforce.length} people, ${plan.rows.length} days, ${plan.unpaidDays} unpaid`,
    },
    tx,
  );
  return { year, month, employees: plan.workforce.length, days: plan.rows.length, unpaidDays: plan.unpaidDays };
}

export async function lockMonth(actor: Actor | null, input: { year: number; month: number }) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => lockMonthTx(tx, actor, input));
}
