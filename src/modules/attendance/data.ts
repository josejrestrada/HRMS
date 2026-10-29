import "server-only";
import { query, transaction, type Queryable } from "@/shared/db";
import { DomainError } from "@/shared/errors";
import { requireRole, type Actor } from "@/shared/roles";
import { addDays, todayIST } from "@/shared/dates";
import { getWorkforce, type WorkforceRow } from "@/modules/employees/data";
import { getCalendarFacts } from "@/modules/leave/data";
import {
  deriveDay,
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

  const [policyRows, punchRows, facts] = await Promise.all([
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
  ]);

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
