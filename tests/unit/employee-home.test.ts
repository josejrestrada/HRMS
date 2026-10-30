import { describe, expect, it } from "vitest";
import { buildHome, fixDeadline, todayStatus, type HomeInput } from "@/modules/reports/home";

const base: HomeInput = {
  today: "2026-11-03",
  day: { status: "absent", note: null },
  todayIn: null,
  todayOut: null,
  canPunch: true,
  next: "in",
  regularizeUntilDay: 5,
  fixableDates: [],
  pastDeadlineCount: 0,
  balances: [{ code: "CL", name: "Casual leave", available: 5, held: 1 }],
  holidays: {},
  leave: [],
  wfh: [],
  waitingForMe: { leave: 0, attendance: 0 },
};

describe("today's status", () => {
  const s = (over: Partial<HomeInput>) => todayStatus({ ...base, ...over });
  it("says what the person is doing today", () => {
    expect(s({})).toMatchObject({ label: "Not checked in yet" });
    expect(s({ day: { status: "present", note: null }, todayIn: "09:20" })).toMatchObject({ label: "Checked in", detail: "Since 09:20" });
    expect(s({ day: { status: "present", note: null }, todayIn: "09:20", todayOut: "17:40" })).toMatchObject({ label: "Checked out" });
    expect(s({ day: { status: "wfh", note: null } })).toMatchObject({ label: "Working from home" });
    expect(s({ day: { status: "leave", note: null } })).toMatchObject({ label: "On leave" });
    expect(s({ day: { status: "holiday", note: "Diwali" } })).toMatchObject({ label: "Holiday", detail: "Diwali" });
    expect(s({ day: { status: "weekly_off", note: null } })).toMatchObject({ label: "Weekly off" });
    expect(s({ day: null })).toMatchObject({ label: "Not checked in yet" });
  });
});

describe("upcoming", () => {
  it("mixes holidays, leave and work from home, soonest first, and drops the past and closed requests", () => {
    const home = buildHome({
      ...base,
      holidays: { "2026-10-02": "Gandhi Jayanti", "2026-12-25": "Christmas", "2026-11-09": "Goa Festival", "2026-12-03": "St Francis Xavier", "2027-01-26": "Republic Day" },
      leave: [
        { startDate: "2026-11-10", endDate: "2026-11-11", typeName: "Earned leave", status: "approved" },
        { startDate: "2026-11-20", endDate: "2026-11-20", typeName: "Casual leave", status: "rejected" },
        { startDate: "2026-10-01", endDate: "2026-10-02", typeName: "Sick leave", status: "approved" },
        { startDate: "2026-11-02", endDate: "2026-11-05", typeName: "Casual leave", status: "approved" }, // already started
      ],
      wfh: [
        { date: "2026-11-04", status: "pending" },
        { date: "2026-10-28", status: "approved" },
        { date: "2026-11-06", status: "cancelled" },
      ],
    });
    expect(home.upcoming.map((u) => [u.date, u.kind, u.status])).toEqual([
      ["2026-11-03", "leave", "approved"], // started yesterday, shown from today
      ["2026-11-04", "wfh", "pending"],
      ["2026-11-09", "holiday", null],
      ["2026-11-10", "leave", "approved"],
      ["2026-12-03", "holiday", null],
      ["2026-12-25", "holiday", null],
    ]);
  });

  it("shows at most eight items", () => {
    const wfh = Array.from({ length: 12 }, (_, i) => ({ date: `2026-11-${String(10 + i).padStart(2, "0")}`, status: "pending" }));
    expect(buildHome({ ...base, wfh }).upcoming).toHaveLength(8);
  });
});

describe("attention", () => {
  it("names the date the fix window closes, for the earliest day", () => {
    expect(fixDeadline("2026-10-28", 5)).toBe("2026-11-05");
    expect(fixDeadline("2026-12-30", 5)).toBe("2027-01-05");
    const home = buildHome({ ...base, fixableDates: ["2026-11-02", "2026-10-30", "2026-10-29"] });
    expect(home.attention).toEqual([{ text: "3 days need fixing before 5 Nov 2026.", href: "/app/attendance", tone: "warn" }]);
  });

  it("says one day, one request, in the singular, and reports unpaid days and waiting approvals", () => {
    const home = buildHome({ ...base, fixableDates: ["2026-11-02"], pastDeadlineCount: 1, waitingForMe: { leave: 1, attendance: 2 } });
    expect(home.attention.map((a) => a.text)).toEqual([
      "1 day needs fixing before 5 Dec 2026.",
      "1 day can no longer be fixed and will count as unpaid.",
      "1 leave request is waiting for you.",
      "2 attendance requests are waiting for you.",
    ]);
    expect(home.attention.map((a) => a.href)).toEqual(["/app/attendance", "/app/attendance", "/app/leave/approvals", "/app/attendance/approvals"]);
  });

  it("has nothing to say when nothing needs attention", () => {
    expect(buildHome(base).attention).toEqual([]);
  });
});
