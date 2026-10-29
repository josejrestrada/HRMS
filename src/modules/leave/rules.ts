// Pure leave rules (RESEARCH.md R1 to R37). No database and no server-only code, so the same
// functions give the live day count in the browser and the real check on the server.
import { addDays } from "@/shared/dates";

export type DayPart = "full" | "first_half" | "second_half";

/** Ledger reasons that only reserve days while a request is pending. */
export const HOLD_REASONS = ["pending_hold", "hold_release"] as const;

const EPS = 1e-9;
export const ceilHalf = (n: number) => Math.ceil(n * 2 - EPS) / 2;
export const floorHalf = (n: number) => Math.floor(n * 2 + EPS) / 2;
export const roundHalf = (n: number) => Math.round(n * 2) / 2;

/** "3 days", "1 day", "0.5 day", "2.5 days". */
export function fmtDays(n: number): string {
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text} ${n > 0 && n <= 1 ? "day" : "days"}`;
}

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD date. */
export function weekdayIndex(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export type DaySkip = { date: string; reason: "weekly_off" | "holiday"; label?: string };

/**
 * Working days in a request (R3): weekly offs and holidays are not counted. `holidays` maps a date
 * to its name (national and state holidays only, R36). A half day counts 0.5 and only makes sense
 * for a single date.
 */
export function countLeaveDays(input: {
  start: string;
  end: string;
  dayPart: DayPart;
  weeklyOffDays: number[];
  holidays: Record<string, string>;
}): { days: number; skipped: DaySkip[] } {
  const skipped: DaySkip[] = [];
  let working = 0;
  if (input.end < input.start) return { days: 0, skipped };
  let date = input.start;
  for (let i = 0; i < 400 && date <= input.end; i++, date = addDays(date, 1)) {
    if (input.weeklyOffDays.includes(weekdayIndex(date))) skipped.push({ date, reason: "weekly_off" });
    else if (input.holidays[date]) skipped.push({ date, reason: "holiday", label: input.holidays[date] });
    else working += 1;
  }
  const days = input.dayPart === "full" ? working : working > 0 ? 0.5 : 0;
  return { days, skipped };
}

/** Working days in a calendar month, for EL accrual (R14). */
export function workingDaysInMonth(
  year: number,
  month: number,
  weeklyOffDays: number[],
  holidays: Record<string, string>,
): number {
  const mm = String(month).padStart(2, "0");
  const last = lastDayOfMonth(year, month);
  return countLeaveDays({
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(last).padStart(2, "0")}`,
    dayPart: "full",
    weeklyOffDays,
    holidays,
  }).days;
}

/** Months of entitlement in `year` for a joiner (R13): the joining month counts if joined on or before the 15th. */
export function entitlementMonths(joiningDate: string, year: number): number {
  const [jy, jm, jd] = joiningDate.split("-").map(Number);
  if (jy < year) return 12;
  if (jy > year) return 0;
  const startMonth = jd <= 15 ? jm : jm + 1;
  return Math.max(0, 13 - startMonth);
}

/**
 * Upfront grant for CL and SL (R6, R7, R13). Pro-rated and rounded up to the half day, but never
 * below the statutory floor (R4, P8).
 */
export function proratedGrant(input: {
  annualQuota: number;
  statutoryFloor: number | null;
  joiningDate: string;
  year: number;
}): number {
  const months = entitlementMonths(input.joiningDate, input.year);
  const raw = ceilHalf((input.annualQuota * months) / 12);
  return Math.max(input.statutoryFloor ?? 0, raw);
}

/** Months in `year` that earn an EL accrual by `today` (R14: accrues on the last day of the month). */
export function accrualMonths(joiningDate: string, year: number, today: string): number[] {
  const [jy, jm, jd] = joiningDate.split("-").map(Number);
  if (jy > year) return [];
  const first = jy < year ? 1 : jd <= 15 ? jm : jm + 1;
  const months: number[] = [];
  for (let m = first; m <= 12; m++) {
    const lastDay = `${year}-${String(m).padStart(2, "0")}-${String(lastDayOfMonth(year, m)).padStart(2, "0")}`;
    if (today >= lastDay) months.push(m);
  }
  return months;
}

/** Earned leave for one month (R8, R14, R35): the monthly rate reduced in proportion to LOP days. */
export function elAccrualForMonth(input: { annualQuota: number; lopDays: number; workingDays: number }): number {
  const rate = input.annualQuota / 12;
  const lopShare = input.workingDays > 0 ? Math.min(1, Math.max(0, input.lopDays / input.workingDays)) : 0;
  return Math.max(0, roundHalf(rate * (1 - lopShare)));
}

export type ApplicationCheck =
  | { ok: true; days: number; heldDays: number; lopDays: number; certificateRequired: boolean }
  | { ok: false; error: string; field: string };

/** The rules for one application (R5 to R7, R16 to R19, R33, R37). Overlap is checked against the database. */
export function checkApplication(i: {
  today: string;
  start: string;
  end: string;
  dayPart: DayPart;
  days: number;
  typeCode: string;
  typeName: string;
  maxConsecutiveDays: number | null;
  available: number;
  convertShortfallToLop: boolean;
}): ApplicationCheck {
  const fail = (field: string, error: string): ApplicationCheck => ({ ok: false, field, error });

  if (i.end < i.start) return fail("endDate", "The end date cannot be before the start date.");
  if (i.start.slice(0, 4) !== i.end.slice(0, 4)) {
    return fail("endDate", "A request cannot cross into a new year. Apply for each year separately.");
  }
  if (i.dayPart !== "full" && i.start !== i.end) {
    return fail("dayPart", "A half day can only be a single date. Choose the same start and end date.");
  }
  if (i.start < addDays(i.today, -7)) {
    return fail("startDate", "This date is more than 7 days ago. Please contact HR to enter it for you.");
  }
  if (i.start > addDays(i.today, 366)) {
    return fail("startDate", "Dates more than a year ahead cannot be requested yet.");
  }
  if (i.days === 0) {
    return fail("startDate", "Those dates are all weekly offs or holidays, so there is nothing to apply for.");
  }

  if (i.typeCode === "LOP") {
    return { ok: true, days: i.days, heldDays: 0, lopDays: i.days, certificateRequired: false };
  }

  if (i.maxConsecutiveDays !== null && i.days > i.maxConsecutiveDays) {
    return fail("endDate", `${i.typeName} can be used for at most ${fmtDays(i.maxConsecutiveDays)} in a row.`);
  }

  const certificateRequired = i.typeCode === "SL" && i.days > 2;
  const available = Math.max(0, i.available);
  if (i.days <= available) {
    return { ok: true, days: i.days, heldDays: i.days, lopDays: 0, certificateRequired };
  }
  if (!i.convertShortfallToLop) {
    return fail(
      "leaveTypeId",
      `You have ${fmtDays(available)} of ${i.typeName} available. Shorten the request, or tick the box to use the extra ${fmtDays(i.days - available)} as leave without pay.`,
    );
  }
  const heldDays = floorHalf(available);
  return { ok: true, days: i.days, heldDays, lopDays: i.days - heldDays, certificateRequired };
}

/** R20, R31: who may approve or reject a request. */
export function canDecide(p: {
  actorEmployeeId: string;
  actorIsHrAdmin: boolean;
  actorIsManagerOfRequester: boolean;
  requesterEmployeeId: string;
}): boolean {
  if (p.actorEmployeeId === p.requesterEmployeeId) return false;
  return p.actorIsHrAdmin || p.actorIsManagerOfRequester;
}

/** R20: the owner cancels their own request, but past approved leave can only be cancelled by HR. */
export function canCancel(p: {
  actorEmployeeId: string;
  actorIsHrAdmin: boolean;
  requesterEmployeeId: string;
  status: string;
  startDate: string;
  today: string;
}): boolean {
  if (p.status !== "pending" && p.status !== "approved") return false;
  if (p.actorIsHrAdmin) return true;
  if (p.actorEmployeeId !== p.requesterEmployeeId) return false;
  return p.status === "pending" || p.startDate >= p.today;
}

/**
 * Year-end for one balance (R22, R23, R38): `available` is the balance minus days held by pending
 * requests. Up to `cap` is carried forward; the excess is encashed if the type allows it, otherwise
 * it lapses. A balance of zero or less produces no entries.
 */
export function yearEndPlan(i: { available: number; cap: number; encashable: boolean }): {
  carry: number;
  lapse: number;
  encash: number;
} {
  if (!(i.available > 0)) return { carry: 0, lapse: 0, encash: 0 };
  const carry = Math.min(i.available, Math.max(0, i.cap));
  const excess = i.available - carry;
  return { carry, lapse: i.encashable ? 0 : excess, encash: i.encashable ? excess : 0 };
}
