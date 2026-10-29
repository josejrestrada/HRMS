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

export type DayInput = {
  date: string;
  today: string;
  weeklyOff: boolean;
  holiday: string | null;
  leave: LeavePart | null;
  wfh: boolean;
  punches: PunchTime[];
  policy: Policy;
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
  const { firstIn, lastOut, workedMinutes } = summarizePunches(i.punches);
  const result = (status: DayStatus, extra: Partial<DayResult> = {}): DayResult => ({
    date: i.date,
    status,
    firstIn,
    lastOut,
    workedMinutes,
    late: false,
    needsAction: false,
    provisional: false,
    note: null,
    ...extra,
  });

  // A holiday or weekly off wins over everything else (R43).
  if (i.holiday) return result("holiday", { note: i.holiday });
  if (i.weeklyOff) return result("weekly_off");

  // Leave beats punches (R43, P9). Half-day leave shows as a half day.
  if (i.leave === "full") return result("leave");
  if (i.leave) return result("half_day", { note: "Half-day leave" });
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
  if (minutes >= i.policy.fullDayMinutes) return result("present", { late });
  if (minutes >= i.policy.halfDayMinutes) return result("half_day", { late, note: `Worked ${formatMinutes(minutes)}` });
  return result("absent", { late, needsAction: true, note: `Worked only ${formatMinutes(minutes)}` });
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
