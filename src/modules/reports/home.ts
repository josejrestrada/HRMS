// Pure assembly of the employee home screen. No database and no server-only code, so it can be tested directly.
import { addMonths, formatDate } from "@/shared/dates";

export type HomeBalance = { code: string; name: string; available: number; held: number };

export type HomeStatus = { label: string; detail: string | null; tone: "ok" | "warn" | "muted" };

export type UpcomingItem = {
  kind: "holiday" | "leave" | "wfh";
  /** First day, used for sorting. */
  date: string;
  endDate: string;
  title: string;
  status: "pending" | "approved" | null;
};

export type AttentionItem = { text: string; href: string; tone: "warn" | "info" };

export type EmployeeHome = {
  today: string;
  status: HomeStatus;
  canPunch: boolean;
  next: "in" | "out";
  balances: HomeBalance[];
  upcoming: UpcomingItem[];
  attention: AttentionItem[];
};

export type HomeInput = {
  today: string;
  day: { status: string; note: string | null } | null;
  todayIn: string | null;
  todayOut: string | null;
  canPunch: boolean;
  next: "in" | "out";
  regularizeUntilDay: number;
  /** Days that need fixing and still can be, across the months whose window is open. */
  fixableDates: string[];
  pastDeadlineCount: number;
  balances: { code: string; name: string; available: number; held: number }[];
  holidays: Record<string, string>;
  leave: { startDate: string; endDate: string; typeName: string; status: string }[];
  wfh: { date: string; status: string }[];
  waitingForMe: { leave: number; attendance: number };
};

const UPCOMING_LIMIT = 8;
const HOLIDAYS_SHOWN = 3;

export function todayStatus(i: Pick<HomeInput, "day" | "todayIn" | "todayOut">): HomeStatus {
  const day = i.day;
  if (!day) return { label: "Not checked in yet", detail: null, tone: "muted" };
  switch (day.status) {
    case "holiday":
      return { label: "Holiday", detail: day.note, tone: "muted" };
    case "weekly_off":
      return { label: "Weekly off", detail: null, tone: "muted" };
    case "leave":
      return { label: "On leave", detail: null, tone: "ok" };
    case "wfh":
      return { label: "Working from home", detail: null, tone: "ok" };
    default:
      if (i.todayOut) return { label: "Checked out", detail: `In ${i.todayIn ?? "–"}, out ${i.todayOut}`, tone: "ok" };
      if (i.todayIn) return { label: "Checked in", detail: `Since ${i.todayIn}`, tone: "ok" };
      return { label: day.status === "half_day" ? "On half-day leave" : "Not checked in yet", detail: day.note, tone: "muted" };
  }
}

/** The last day on which a day in `date`'s month can still be fixed (the month after, on the policy day). */
export function fixDeadline(date: string, regularizeUntilDay: number): string {
  const next = addMonths(`${date.slice(0, 7)}-01`, 1);
  return `${next.slice(0, 7)}-${String(regularizeUntilDay).padStart(2, "0")}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildHome(i: HomeInput): EmployeeHome {
  const upcoming: UpcomingItem[] = [];

  Object.entries(i.holidays)
    .filter(([date]) => date >= i.today)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, HOLIDAYS_SHOWN)
    .forEach(([date, name]) => upcoming.push({ kind: "holiday", date, endDate: date, title: name, status: null }));

  for (const l of i.leave) {
    if (l.endDate < i.today || (l.status !== "approved" && l.status !== "pending")) continue;
    upcoming.push({ kind: "leave", date: l.startDate < i.today ? i.today : l.startDate, endDate: l.endDate, title: l.typeName, status: l.status });
  }
  for (const w of i.wfh) {
    if (w.date < i.today || (w.status !== "approved" && w.status !== "pending")) continue;
    upcoming.push({ kind: "wfh", date: w.date, endDate: w.date, title: "Work from home", status: w.status });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  const attention: AttentionItem[] = [];
  if (i.fixableDates.length > 0) {
    const first = [...i.fixableDates].sort()[0];
    attention.push({
      text: `${plural(i.fixableDates.length, "day needs", "days need")} fixing before ${formatDate(fixDeadline(first, i.regularizeUntilDay))}.`,
      href: "/app/attendance",
      tone: "warn",
    });
  }
  if (i.pastDeadlineCount > 0) {
    attention.push({
      text: `${plural(i.pastDeadlineCount, "day can", "days can")} no longer be fixed and will count as unpaid.`,
      href: "/app/attendance",
      tone: "warn",
    });
  }
  if (i.waitingForMe.leave > 0) {
    attention.push({ text: `${plural(i.waitingForMe.leave, "leave request is", "leave requests are")} waiting for you.`, href: "/app/leave/approvals", tone: "info" });
  }
  if (i.waitingForMe.attendance > 0) {
    attention.push({ text: `${plural(i.waitingForMe.attendance, "attendance request is", "attendance requests are")} waiting for you.`, href: "/app/attendance/approvals", tone: "info" });
  }

  return {
    today: i.today,
    status: todayStatus(i),
    canPunch: i.canPunch,
    next: i.next,
    balances: i.balances,
    upcoming: upcoming.slice(0, UPCOMING_LIMIT),
    attention,
  };
}
