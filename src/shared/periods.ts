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

// ---------------------------------------------------------------------------------------------
// Serialising the month lock with everything that changes a month (R65)
// ---------------------------------------------------------------------------------------------

const LOCK_NAMESPACE = 7101;
const monthNumber = (isoDate: string) => Number(isoDate.slice(0, 4)) * 12 + (Number(isoDate.slice(5, 7)) - 1);

/** Every "YYYY-MM" month from the month of `from` to the month of `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = monthNumber(from); n <= monthNumber(to) && out.length < 24; n++) {
    out.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Anything that changes a month's attendance or leave calls this first. It takes a shared,
 * transaction-long lock for each month touched, so it waits while HR is locking that month and an
 * in-progress lock waits for it. Months are taken in order, which keeps writers from deadlocking.
 */
export async function lockMonthsShared(q: Queryable, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const sorted = [...dates].sort();
  for (const key of monthsBetween(sorted[0], sorted[sorted.length - 1])) {
    await q.query("select pg_advisory_xact_lock_shared($1::int, $2::int)", [LOCK_NAMESPACE, monthNumber(`${key}-01`)]);
  }
}

/** The month lock itself: exclusive for one month, held until the transaction ends. */
export async function lockMonthExclusive(q: Queryable, year: number, month: number): Promise<void> {
  await q.query("select pg_advisory_xact_lock($1::int, $2::int)", [LOCK_NAMESPACE, year * 12 + (month - 1)]);
}
