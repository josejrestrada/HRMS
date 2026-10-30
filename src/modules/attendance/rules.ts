// Pure attendance rules (RESEARCH.md R26 to R28, R42 to R46). No database and no server-only code.
// Times are plain "HH:MM" strings in IST; dates are "YYYY-MM-DD".

export type DayStatus =
  | "present"
  | "half_day"
  | "absent"
  | "leave"
  | "holiday"
  | "weekly_off"
  | "wfh"
  | "missed_punch"
  | "upcoming";

export type LeavePart = "full" | "first_half" | "second_half";

export type Policy = {
  workStart: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  lateMarksPerDeduction: number;
  regularizeUntilDay: number;
};

export type PunchTime = { time: string; direction: "in" | "out" };

/** An employee's correction of a day's check-in and check-out (R54 to R57). */
export type Regularization = { in: string; out: string; status: "pending" | "approved" };

export type DayInput = {
  date: string;
  today: string;
  weeklyOff: boolean;
  holiday: string | null;
  leave: LeavePart | null;
  wfh: boolean;
  punches: PunchTime[];
  policy: Policy;
  regularization?: Regularization | null;
  /** False for a day before the employee joined or after they left (R61). Defaults to true. */
  employed?: boolean;
  /** How much of this day's approved leave is unpaid, 0 to 1 (R64). Only used on a leave day. */
  unpaidLeave?: number;
};

export type DayResult = {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number | null;
  late: boolean;
  needsAction: boolean;
  /** Today, not finished yet: the status may still change. */
  provisional: boolean;
  /** The times come from an approved regularization, not from raw punches. */
  regularized: boolean;
  /** A regularization has been sent and is waiting for approval. */
  fixPending: boolean;
  /** False when the day is outside the person's employment (R61). */
  employed: boolean;
  /** The day comes from the frozen copy of a locked month (R58). */
  locked: boolean;
  /** Unpaid part of the day, 0 to 1 (R64). Absent days are set to 1 when the month is frozen. */
  unpaid: number;
  note: string | null;
};

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** "7 h 45 m", "8 h", "40 m". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} m`;
  return m === 0 ? `${h} h` : `${h} h ${m} m`;
}

/** What the next press of the check in / check out button should record. */
export function nextPunchDirection(todayPunches: PunchTime[]): "in" | "out" {
  if (todayPunches.length === 0) return "in";
  const sorted = [...todayPunches].sort((a, b) => toMinutes(a.time) - toMinutes(b.time));
  return sorted[sorted.length - 1].direction === "in" ? "out" : "in";
}

/** First check-in, last check-out after it, and the minutes between them. */
export function summarizePunches(punches: PunchTime[]): { firstIn: string | null; lastOut: string | null; workedMinutes: number | null } {
  const ins = punches.filter((p) => p.direction === "in").map((p) => p.time).sort();
  const firstIn = ins[0] ?? null;
  if (!firstIn) return { firstIn: null, lastOut: null, workedMinutes: null };
  const outs = punches.filter((p) => p.direction === "out" && p.time > firstIn).map((p) => p.time).sort();
  const lastOut = outs[outs.length - 1] ?? null;
  return { firstIn, lastOut, workedMinutes: lastOut ? toMinutes(lastOut) - toMinutes(firstIn) : null };
}

/** R26: later than the work start plus the grace window. */
export function isLate(firstIn: string | null, policy: Policy): boolean {
  if (!firstIn) return false;
  return toMinutes(firstIn) > toMinutes(policy.workStart.slice(0, 5)) + policy.graceMinutes;
}

/** The status of one day (R27, R43, R44). */
export function deriveDay(i: DayInput): DayResult {
  // An approved regularization replaces the day's punches for working out its status; the raw
  // punches themselves are never changed (R56).
  const approved = i.regularization?.status === "approved" ? i.regularization : null;
  const punches: PunchTime[] = approved
    ? [{ time: approved.in, direction: "in" }, { time: approved.out, direction: "out" }]
    : i.punches;
  const { firstIn, lastOut, workedMinutes } = summarizePunches(punches);
  const result = (status: DayStatus, extra: Partial<DayResult> = {}): DayResult => ({
    date: i.date,
    status,
    firstIn,
    lastOut,
    workedMinutes,
    late: false,
    needsAction: false,
    provisional: false,
    regularized: !!approved,
    fixPending: i.regularization?.status === "pending",
    employed: true,
    locked: false,
    unpaid: 0,
    note: null,
    ...extra,
  });

  if (i.employed === false) return result("upcoming", { employed: false, note: "Not employed on this day" });

  // A holiday or weekly off wins over everything else (R43).
  if (i.holiday) return result("holiday", { note: i.holiday });
  if (i.weeklyOff) return result("weekly_off");

  // Leave beats punches (R43, P9). Half-day leave shows as a half day.
  if (i.leave === "full") return result("leave", { unpaid: i.unpaidLeave ?? 0 });
  if (i.leave) return result("half_day", { note: "Half-day leave", unpaid: i.unpaidLeave ?? 0 });
  if (i.wfh) return result("wfh", { note: "Work from home" });

  if (i.date > i.today) return result("upcoming");

  const isToday = i.date === i.today;
  const late = isLate(firstIn, i.policy);

  if (!firstIn) {
    return isToday
      ? result("absent", { provisional: true, note: "Not checked in yet" })
      : result("absent", { needsAction: true, note: "No check-in" });
  }
  if (!lastOut) {
    return isToday
      ? result("present", { late, provisional: true, note: "Checked in" })
      : result("missed_punch", { late, needsAction: true, note: "Missing check-out" });
  }

  const minutes = workedMinutes ?? 0;
  // After an approved fix the day is decided: it no longer needs action, even if the hours are short.
  const needsFix = !approved;
  if (minutes >= i.policy.fullDayMinutes) return result("present", { late, note: approved ? "Regularized" : null });
  if (minutes >= i.policy.halfDayMinutes) {
    return result("half_day", { late, note: approved ? "Regularized" : `Worked ${formatMinutes(minutes)}` });
  }
  return result("absent", { late, needsAction: needsFix, note: approved ? "Regularized" : `Worked only ${formatMinutes(minutes)}` });
}

export type MonthSummary = {
  counts: Record<DayStatus, number>;
  lateMarks: number;
  lateLimit: number;
  needsAction: string[];
};

/** Totals for a month of derived days (R26 late marks are counted only, never deducted here, R45). */
export function summarizeMonth(days: DayResult[], policy: Policy): MonthSummary {
  const counts: Record<DayStatus, number> = {
    present: 0,
    half_day: 0,
    absent: 0,
    leave: 0,
    holiday: 0,
    weekly_off: 0,
    wfh: 0,
    missed_punch: 0,
    upcoming: 0,
  };
  let lateMarks = 0;
  const needsAction: string[] = [];
  for (const d of days) {
    // Today is still in progress, so an unfinished absent day is not counted as absent yet.
    if (d.provisional && d.status === "absent") continue;
    counts[d.status] += 1;
    if (d.late) lateMarks += 1;
    if (d.needsAction) needsAction.push(d.date);
  }
  return { counts, lateMarks, lateLimit: policy.lateMarksPerDeduction, needsAction };
}

// ---------------------------------------------------------------------------------------------
// Regularization (R54 to R57)
// ---------------------------------------------------------------------------------------------

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_FIX_MINUTES = 16 * 60;

export type RegularizeCheck = { ok: true } | { ok: false; error: string };

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** R54, R55: which days can still be fixed, and until when. */
export function canRegularize(i: { date: string; today: string; regularizeUntilDay: number }): RegularizeCheck {
  if (i.date > i.today) return { ok: false, error: "That date is in the future." };
  if (i.date === i.today) return { ok: false, error: "Today is still in progress. You can fix it from tomorrow." };

  const [dy, dm] = i.date.split("-").map(Number);
  const [ty, tm, td] = i.today.split("-").map(Number);
  const monthsApart = (ty - dy) * 12 + (tm - dm);
  if (monthsApart === 0) return { ok: true };
  if (monthsApart === 1 && td <= i.regularizeUntilDay) return { ok: true };
  return {
    ok: false,
    error: `The deadline to fix ${MONTH_NAMES[dm - 1]} days was the ${i.regularizeUntilDay}th of the next month. That day now counts as unpaid. Please talk to HR.`,
  };
}

/** The statuses a day must have (before any fix) to be worth regularizing. */
export function isFixable(day: Pick<DayResult, "status" | "needsAction" | "fixPending" | "regularized">): boolean {
  return day.needsAction && !day.fixPending && !day.regularized;
}

export function checkFixTimes(inTime: string, outTime: string): RegularizeCheck {
  if (!TIME.test(inTime) || !TIME.test(outTime)) return { ok: false, error: "Enter times like 09:30 and 17:45." };
  const span = toMinutes(outTime) - toMinutes(inTime);
  if (span <= 0) return { ok: false, error: "Check-out must be after check-in." };
  if (span > MAX_FIX_MINUTES) return { ok: false, error: "That is longer than 16 hours. Please check the times." };
  return { ok: true };
}

/** Starting times for the fix form: normal start, and start plus a full day. */
export function defaultFixTimes(policy: Policy): { in: string; out: string } {
  const start = toMinutes(policy.workStart.slice(0, 5));
  const end = Math.min(start + policy.fullDayMinutes, 23 * 60 + 59);
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return { in: hhmm(start), out: hhmm(end) };
}

// ---------------------------------------------------------------------------------------------
// Month lock (R58 to R62)
// ---------------------------------------------------------------------------------------------

export type FrozenDay = {
  status: Exclude<DayStatus, "upcoming" | "missed_punch">;
  note: string | null;
  late: boolean;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number | null;
  /** Unpaid part of the day, 0 to 1, for payroll (R64). */
  unpaid: number;
};

/**
 * What is stored when a month is locked (R59, R64). A day that still needs action becomes absent.
 * Every absent day is unpaid (R27); leave contributes the unpaid part of its request. Days outside
 * employment, and days that cannot be judged, are not stored (null).
 */
export function freezeDay(d: DayResult): FrozenDay | null {
  if (!d.employed || d.status === "upcoming") return null;
  const base = { late: d.late, firstIn: d.firstIn, lastOut: d.lastOut, workedMinutes: d.workedMinutes };
  if (d.status === "missed_punch") {
    return { ...base, status: "absent", unpaid: 1, note: "Missing check-out, not fixed in time (unpaid)" };
  }
  if (d.status === "absent") {
    const unfixed = d.needsAction;
    return { ...base, status: "absent", unpaid: 1, note: unfixed ? `${d.note ?? "Absent"}, not fixed in time (unpaid)` : `${d.note ?? "Absent"} (unpaid)` };
  }
  if (d.status === "leave" || (d.status === "half_day" && d.note === "Half-day leave")) {
    const unpaid = Math.min(Math.max(d.unpaid, 0), d.status === "half_day" ? 0.5 : 1);
    return { ...base, status: d.status, unpaid, note: unpaid > 0 ? `${d.note ? `${d.note}, ` : ""}${unpaid === 1 ? "leave without pay" : "partly unpaid leave"}` : d.note };
  }
  return { ...base, status: d.status, unpaid: 0, note: d.note };
}

/** True for a frozen day with any unpaid part. */
export const isUnpaidFrozen = (f: FrozenDay) => f.unpaid > 0;

/**
 * Which days of an approved leave request are unpaid (R34, R64). Leave without pay is unpaid on
 * every working day. For other leave with a converted shortfall (`lopDays`), the unpaid part is taken
 * from the LAST working days of the request: paid days first. A half-day request weighs 0.5.
 */
export function allocateUnpaid(
  req: { start: string; end: string; part: LeavePart; typeCode: string; lopDays: number },
  isWorkingDay: (date: string) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  const weight = req.part === "full" ? 1 : 0.5;
  const days: string[] = [];
  let d = req.start;
  for (let i = 0; i < 400 && d <= req.end; i++) {
    if (isWorkingDay(d)) days.push(d);
    d = new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);
  }
  if (req.typeCode === "LOP") {
    for (const date of days) out.set(date, weight);
    return out;
  }
  let remaining = req.lopDays;
  for (let i = days.length - 1; i >= 0 && remaining > 0; i--) {
    const take = Math.min(weight, remaining);
    out.set(days[i], take);
    remaining -= take;
  }
  return out;
}

export type LockCheck = { ok: true } | { ok: false; error: string };

/** R58: only a finished month can be locked. */
export function canLockMonth(i: { today: string; year: number; month: number }): LockCheck {
  const last = new Date(Date.UTC(i.year, i.month, 0)).getUTCDate();
  const end = `${i.year}-${String(i.month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  if (i.today <= end) return { ok: false, error: `${MONTH_NAMES[i.month - 1]} ${i.year} can only be locked after it has ended.` };
  return { ok: true };
}

export { MONTH_NAMES };

// ---------------------------------------------------------------------------------------------
// Which assignment applies on a day (R63)
// ---------------------------------------------------------------------------------------------

export type Span = { from: string; to: string | null };

/** The span effective on `date`, or null if there is none. If spans overlap, the latest start wins. */
export function spanAt<T extends Span>(spans: T[], date: string): T | null {
  let best: T | null = null;
  for (const s of spans) {
    if (s.from <= date && (s.to === null || s.to >= date) && (best === null || s.from > best.from)) best = s;
  }
  return best;
}
