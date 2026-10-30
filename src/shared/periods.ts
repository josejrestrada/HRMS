import "server-only";
import { query, type Queryable } from "./db";

// Attendance months that HR has locked (R58 to R62). Shared so leave and attendance can both check it
// without importing each other.

/** "YYYY-MM" keys of the locked months that overlap [from, to]. */
export async function lockedMonthKeys(from: string, to: string, q: Queryable = { query }): Promise<Set<string>> {
  const rows = await q.query<{ k: string }>(
    `select to_char(make_date(year, month, 1), 'YYYY-MM') as k from attendance_period
      where make_date(year, month, 1) <= $2::date and (make_date(year, month, 1) + interval '1 month') > $1::date`,
    [from, to],
  );
  return new Set(rows.map((r) => r.k));
}

export const monthKey = (isoDate: string) => isoDate.slice(0, 7);

/** The first locked month touched by any of the dates, as "YYYY-MM", or null. */
export async function firstLockedMonth(q: Queryable, dates: string[]): Promise<string | null> {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  const locked = await lockedMonthKeys(sorted[0], sorted[sorted.length - 1], q);
  return dates.map(monthKey).sort().find((k) => locked.has(k)) ?? null;
}
