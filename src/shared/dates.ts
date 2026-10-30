// All date logic runs in IST (Asia/Kolkata). Never use the server's local date.
// Dates are plain "YYYY-MM-DD" strings, matching Postgres `date` columns cast to text.

export const IST_TIMEZONE = "Asia/Kolkata";

const istDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  return istDateFormat.format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  return Math.round(ms / 86_400_000);
}

/** "22 Oct 2026" */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const weekdayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" });

/** "Thursday" for a YYYY-MM-DD date. */
export function weekdayName(isoDate: string): string {
  return weekdayFormat.format(new Date(`${isoDate}T00:00:00Z`));
}

/** "2 years 3 months" or "5 months" or "Less than a month", between two YYYY-MM-DD dates. */
export function tenureText(from: string, to: string): string {
  if (to < from) return "Not started yet";
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  if (months < 1) return "Less than a month";
  const years = Math.floor(months / 12);
  months -= years * 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  return parts.join(" ");
}

/** Adds whole months to a YYYY-MM-DD date, keeping the day where possible (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** True only for a date that exists on the calendar, written YYYY-MM-DD (31 February is not real). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
