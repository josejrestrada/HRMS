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
