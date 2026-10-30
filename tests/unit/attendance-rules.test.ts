import { describe, expect, it } from "vitest";
import {
  canLockMonth,
  canRegularize,
  checkFixTimes,
  defaultFixTimes,
  deriveDay,
  freezeDay,
  allocateUnpaid,
  isUnpaidFrozen,
  spanAt,
  formatMinutes,
  isFixable,
  isLate,
  nextPunchDirection,
  summarizeMonth,
  summarizePunches,
  type DayInput,
  type Policy,
} from "@/modules/attendance/rules";

const policy: Policy = {
  workStart: "09:30:00",
  graceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 270,
  lateMarksPerDeduction: 3,
  regularizeUntilDay: 5,
};

const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: "2026-10-28",
  today: "2026-10-30",
  weeklyOff: false,
  holiday: null,
  leave: null,
  wfh: false,
  punches: [],
  policy,
  ...over,
});
const inOut = (a: string, b: string) => [
  { time: a, direction: "in" as const },
  { time: b, direction: "out" as const },
];

describe("summarizePunches", () => {
  it("uses the first check-in and the last check-out after it", () => {
    const r = summarizePunches([
      { time: "13:00", direction: "in" },
      { time: "09:10", direction: "in" },
      { time: "12:30", direction: "out" },
      { time: "18:15", direction: "out" },
    ]);
    expect(r).toEqual({ firstIn: "09:10", lastOut: "18:15", workedMinutes: 545 });
  });

  it("ignores a check-out before the first check-in", () => {
    expect(summarizePunches([{ time: "08:00", direction: "out" }, { time: "09:00", direction: "in" }])).toEqual({
      firstIn: "09:00",
      lastOut: null,
      workedMinutes: null,
    });
  });

  it("returns nothing when there are no punches", () => {
    expect(summarizePunches([])).toEqual({ firstIn: null, lastOut: null, workedMinutes: null });
  });
});

describe("isLate (R26)", () => {
  it("allows the grace window and flags anything after it", () => {
    expect(isLate("09:45", policy)).toBe(false);
    expect(isLate("09:46", policy)).toBe(true);
    expect(isLate(null, policy)).toBe(false);
  });
});

describe("deriveDay (R27, R43, R44)", () => {
  it("is present with 8 hours or more", () => {
    expect(deriveDay(day({ punches: inOut("09:30", "17:30") })).status).toBe("present");
  });

  it("is a half day from 4.5 hours up to 8", () => {
    const r = deriveDay(day({ punches: inOut("09:30", "14:30") }));
    expect(r.status).toBe("half_day");
    expect(r.note).toBe("Worked 5 h");
    expect(deriveDay(day({ punches: inOut("09:30", "14:00") })).status).toBe("half_day"); // exactly 4.5 h
    expect(deriveDay(day({ punches: inOut("09:30", "13:59") })).status).toBe("absent"); // 4 h 29 m
  });

  it("is absent and needs action under 4.5 hours", () => {
    const r = deriveDay(day({ punches: inOut("09:30", "13:00") }));
    expect(r).toMatchObject({ status: "absent", needsAction: true });
  });

  it("is absent with no punches on a past working day", () => {
    expect(deriveDay(day())).toMatchObject({ status: "absent", needsAction: true, provisional: false });
  });

  it("flags a missed check-out on a past day (R44)", () => {
    expect(deriveDay(day({ punches: [{ time: "09:30", direction: "in" }] }))).toMatchObject({
      status: "missed_punch",
      needsAction: true,
    });
  });

  it("treats today as in progress, not as a failure", () => {
    expect(deriveDay(day({ date: "2026-10-30" }))).toMatchObject({ status: "absent", provisional: true, needsAction: false });
    expect(deriveDay(day({ date: "2026-10-30", punches: [{ time: "09:20", direction: "in" }] }))).toMatchObject({
      status: "present",
      provisional: true,
      needsAction: false,
    });
  });

  it("marks late arrivals, also on a half day", () => {
    expect(deriveDay(day({ punches: inOut("10:00", "18:30") })).late).toBe(true);
    expect(deriveDay(day({ punches: inOut("09:40", "18:00") })).late).toBe(false);
  });

  it("lets a weekly off or a holiday win over punches and leave (R43)", () => {
    expect(deriveDay(day({ weeklyOff: true, punches: inOut("09:30", "17:30"), leave: "full" })).status).toBe("weekly_off");
    expect(deriveDay(day({ holiday: "Christmas", leave: "full" }))).toMatchObject({ status: "holiday", note: "Christmas" });
  });

  it("lets leave beat punches, and shows half-day leave as a half day", () => {
    expect(deriveDay(day({ leave: "full", punches: inOut("09:30", "17:30") })).status).toBe("leave");
    expect(deriveDay(day({ leave: "first_half" })).status).toBe("half_day");
  });

  it("expects the other half of a half-day leave to be worked (review finding 4)", () => {
    // Past day, nothing worked: the other half is unpaid and the day can still be fixed.
    expect(deriveDay(day({ leave: "first_half" }))).toMatchObject({ status: "half_day", needsAction: true, unpaid: 0.5, note: "Half-day leave, other half not worked" });
    // Worked half a day (4 hours) or more: complete, nothing unpaid.
    expect(deriveDay(day({ leave: "second_half", punches: inOut("09:30", "13:30") }))).toMatchObject({ status: "half_day", needsAction: false, unpaid: 0, note: "Half-day leave" });
    // Not held against the person while the day is still going, or after an approved fix.
    expect(deriveDay(day({ date: "2026-10-30", leave: "first_half" }))).toMatchObject({ needsAction: false, unpaid: 0 });
    expect(deriveDay(day({ leave: "first_half", regularization: { status: "approved", in: "09:30", out: "13:30" } }))).toMatchObject({ needsAction: false, unpaid: 0 });
    // Unpaid leave on that half plus an unworked other half is a whole unpaid day, never more.
    expect(deriveDay(day({ leave: "first_half", unpaidLeave: 0.5 })).unpaid).toBe(1);
  });

  it("freezes an unworked other half as half a day unpaid", () => {
    expect(freezeDay(deriveDay(day({ leave: "first_half" })))).toMatchObject({ status: "half_day", unpaid: 0.5 });
    expect(freezeDay(deriveDay(day({ leave: "first_half", unpaidLeave: 0.5 })))).toMatchObject({ unpaid: 1 });
    expect(freezeDay(deriveDay(day({ leave: "first_half", punches: inOut("13:00", "17:30") })))).toMatchObject({ status: "half_day", unpaid: 0 });
  });

  it("counts approved work from home as its own present-like status", () => {
    expect(deriveDay(day({ wfh: true })).status).toBe("wfh");
  });

  it("shows a future day as upcoming unless something is already planned", () => {
    expect(deriveDay(day({ date: "2026-11-05" })).status).toBe("upcoming");
    expect(deriveDay(day({ date: "2026-11-05", leave: "full" })).status).toBe("leave");
    expect(deriveDay(day({ date: "2026-11-05", weeklyOff: true })).status).toBe("weekly_off");
  });
});

describe("nextPunchDirection", () => {
  it("starts with a check-in and then alternates", () => {
    expect(nextPunchDirection([])).toBe("in");
    expect(nextPunchDirection([{ time: "09:30", direction: "in" }])).toBe("out");
    expect(nextPunchDirection([{ time: "09:30", direction: "in" }, { time: "13:00", direction: "out" }])).toBe("in");
  });
});

describe("summarizeMonth (R26, R45)", () => {
  it("counts statuses and late marks and lists days to fix", () => {
    const days = [
      deriveDay(day({ date: "2026-10-26", punches: inOut("10:05", "18:30") })),
      deriveDay(day({ date: "2026-10-27", punches: inOut("09:30", "17:30") })),
      deriveDay(day({ date: "2026-10-28", punches: [{ time: "09:30", direction: "in" }] })),
      deriveDay(day({ date: "2026-10-29", leave: "full" })),
      deriveDay(day({ date: "2026-10-30" })), // today, not in yet
    ];
    const s = summarizeMonth(days, policy);
    expect(s.counts.present).toBe(2);
    expect(s.counts.missed_punch).toBe(1);
    expect(s.counts.leave).toBe(1);
    expect(s.counts.absent).toBe(0); // today's unfinished day is not counted as absent
    expect(s.lateMarks).toBe(1);
    expect(s.lateLimit).toBe(3);
    expect(s.needsAction).toEqual(["2026-10-28"]);
  });
});

describe("formatMinutes", () => {
  it("formats hours and minutes", () => {
    expect([formatMinutes(465), formatMinutes(480), formatMinutes(40)]).toEqual(["7 h 45 m", "8 h", "40 m"]);
  });
});

describe("deriveDay with a regularization (R56, R57)", () => {
  const missed = [{ time: "09:30", direction: "in" as const }];

  it("uses the approved times instead of the raw punches and removes the late mark", () => {
    const raw = deriveDay(day({ punches: [{ time: "10:30", direction: "in" }] }));
    expect(raw).toMatchObject({ status: "missed_punch", late: true, needsAction: true });
    const fixed = deriveDay(day({ punches: [{ time: "10:30", direction: "in" }], regularization: { in: "09:20", out: "17:45", status: "approved" } }));
    expect(fixed).toMatchObject({ status: "present", firstIn: "09:20", lastOut: "17:45", late: false, needsAction: false, regularized: true, note: "Regularized" });
  });

  it("keeps a missed punch as it is while the fix is only pending", () => {
    const r = deriveDay(day({ punches: missed, regularization: { in: "09:30", out: "17:30", status: "pending" } }));
    expect(r).toMatchObject({ status: "missed_punch", fixPending: true, regularized: false, needsAction: true });
    expect(isFixable(r)).toBe(false); // already sent, so it is not offered again
  });

  it("settles a day even if the approved hours are short, so it no longer asks for action", () => {
    const r = deriveDay(day({ regularization: { in: "09:30", out: "12:00", status: "approved" } }));
    expect(r).toMatchObject({ status: "absent", needsAction: false, regularized: true });
  });

  it("still lets a weekly off, a holiday and leave win", () => {
    const fix = { in: "09:30", out: "17:30", status: "approved" as const };
    expect(deriveDay(day({ weeklyOff: true, regularization: fix })).status).toBe("weekly_off");
    expect(deriveDay(day({ holiday: "Christmas", regularization: fix })).status).toBe("holiday");
    expect(deriveDay(day({ leave: "full", regularization: fix })).status).toBe("leave");
  });

  it("offers an unfixed problem day again, but not one that was already fixed", () => {
    expect(isFixable(deriveDay(day({ punches: missed })))).toBe(true);
    expect(isFixable(deriveDay(day({ punches: missed, regularization: { in: "09:30", out: "17:30", status: "approved" } })))).toBe(false);
    expect(isFixable(deriveDay(day({ punches: inOut("09:30", "17:30") })))).toBe(false);
  });
});

describe("canRegularize (R54, R55)", () => {
  const base = { regularizeUntilDay: 5 };

  it("allows any past day in the current month", () => {
    expect(canRegularize({ ...base, date: "2026-10-05", today: "2026-10-30" })).toEqual({ ok: true });
    expect(canRegularize({ ...base, date: "2026-10-29", today: "2026-10-30" })).toEqual({ ok: true });
  });

  it("does not allow today or the future", () => {
    expect(canRegularize({ ...base, date: "2026-10-30", today: "2026-10-30" })).toMatchObject({ ok: false });
    expect(canRegularize({ ...base, date: "2026-11-02", today: "2026-10-30" })).toMatchObject({ ok: false });
  });

  it("allows last month up to and including the 5th, and no longer after", () => {
    expect(canRegularize({ ...base, date: "2026-09-20", today: "2026-10-05" })).toEqual({ ok: true });
    const late = canRegularize({ ...base, date: "2026-09-20", today: "2026-10-06" });
    expect(late).toMatchObject({ ok: false });
    expect((late as { error: string }).error).toContain("September");
    expect((late as { error: string }).error).toContain("unpaid");
  });

  it("works across a year end and refuses older months", () => {
    expect(canRegularize({ ...base, date: "2026-12-15", today: "2027-01-03" })).toEqual({ ok: true });
    expect(canRegularize({ ...base, date: "2026-12-15", today: "2027-01-09" })).toMatchObject({ ok: false });
    expect(canRegularize({ ...base, date: "2026-08-15", today: "2026-10-02" })).toMatchObject({ ok: false });
  });
});

describe("checkFixTimes and defaultFixTimes", () => {
  it("accepts a sensible pair and explains each problem", () => {
    expect(checkFixTimes("09:20", "17:45")).toEqual({ ok: true });
    expect(checkFixTimes("9:20", "17:45")).toMatchObject({ ok: false });
    expect(checkFixTimes("09:20", "25:00")).toMatchObject({ ok: false });
    expect(checkFixTimes("17:45", "09:20")).toMatchObject({ ok: false, error: "Check-out must be after check-in." });
    expect(checkFixTimes("17:45", "17:45")).toMatchObject({ ok: false });
    expect(checkFixTimes("00:30", "17:00")).toMatchObject({ ok: false }); // 16.5 hours
  });

  it("prefills the normal working hours", () => {
    expect(defaultFixTimes(policy)).toEqual({ in: "09:30", out: "17:30" });
  });
});

describe("days outside employment (R61)", () => {
  it("are not absent, and are never stored", () => {
    const r = deriveDay(day({ employed: false }));
    expect(r).toMatchObject({ status: "upcoming", employed: false, needsAction: false });
    expect(freezeDay(r)).toBeNull();
  });
});

describe("freezeDay (R59, R64)", () => {
  it("keeps a good day as it is, with nothing unpaid", () => {
    expect(freezeDay(deriveDay(day({ punches: inOut("09:20", "17:45") })))).toMatchObject({ status: "present", firstIn: "09:20", lastOut: "17:45", late: false, unpaid: 0 });
    expect(freezeDay(deriveDay(day({ weeklyOff: true })))).toMatchObject({ status: "weekly_off", unpaid: 0 });
    expect(freezeDay(deriveDay(day({ holiday: "Christmas" })))).toMatchObject({ status: "holiday", unpaid: 0 });
    expect(freezeDay(deriveDay(day({ leave: "full" })))).toMatchObject({ status: "leave", unpaid: 0 });
  });

  it("turns a missed check-out into an unpaid absent day", () => {
    const f = freezeDay(deriveDay(day({ punches: [{ time: "09:30", direction: "in" }] })))!;
    expect(f).toMatchObject({ status: "absent", unpaid: 1 });
    expect(f.note).toContain("not fixed in time");
    expect(isUnpaidFrozen(f)).toBe(true);
    expect(f.firstIn).toBe("09:30");
  });

  it("makes a day with no punches, and a very short day, one unpaid day each", () => {
    expect(freezeDay(deriveDay(day()))).toMatchObject({ status: "absent", unpaid: 1 });
    expect(freezeDay(deriveDay(day({ punches: inOut("09:30", "12:00") })))).toMatchObject({ status: "absent", unpaid: 1 });
  });

  it("still counts an approved fix with very short hours as absent, but not as 'not fixed in time'", () => {
    const f = freezeDay(deriveDay(day({ regularization: { in: "09:30", out: "12:00", status: "approved" } })))!;
    expect(f).toMatchObject({ status: "absent", unpaid: 1 });
    expect(f.note).not.toContain("not fixed in time");
  });

  it("does not make a half day of attendance unpaid (an open question for the owner)", () => {
    expect(freezeDay(deriveDay(day({ punches: inOut("10:10", "15:00") })))).toMatchObject({ status: "half_day", late: true, unpaid: 0 });
  });

  it("carries the unpaid part of leave: whole, half, partly and none", () => {
    expect(freezeDay(deriveDay(day({ leave: "full", unpaidLeave: 1 })))).toMatchObject({ status: "leave", unpaid: 1 });
    expect(freezeDay(deriveDay(day({ leave: "full", unpaidLeave: 0.5 })))).toMatchObject({ status: "leave", unpaid: 0.5 });
    const worked = inOut("13:00", "17:30");
    expect(freezeDay(deriveDay(day({ leave: "first_half", unpaidLeave: 0.5, punches: worked })))).toMatchObject({ status: "half_day", unpaid: 0.5 });
    expect(freezeDay(deriveDay(day({ leave: "first_half", punches: worked })))).toMatchObject({ status: "half_day", unpaid: 0 });
    expect(freezeDay(deriveDay(day({ leave: "full", unpaidLeave: 5 })))!.unpaid).toBe(1); // never more than a whole day
  });
});

describe("allocateUnpaid (R34, R64)", () => {
  const weekdays = (d: string) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

  it("makes every working day of leave without pay unpaid, and skips weekly offs", () => {
    // Thu 6 to Tue 11 Nov 2025: Thu, Fri, Mon, Tue are working days
    const m = allocateUnpaid({ start: "2025-11-06", end: "2025-11-11", part: "full", typeCode: "LOP", lopDays: 4 }, weekdays);
    expect([...m.entries()]).toEqual([["2025-11-06", 1], ["2025-11-07", 1], ["2025-11-10", 1], ["2025-11-11", 1]]);
  });

  it("takes a converted shortfall from the last days of the request, paid days first", () => {
    const m = allocateUnpaid({ start: "2025-11-03", end: "2025-11-07", part: "full", typeCode: "EL", lopDays: 2.5 }, weekdays);
    expect([...m.entries()].sort()).toEqual([["2025-11-05", 0.5], ["2025-11-06", 1], ["2025-11-07", 1]]);
  });

  it("marks nothing unpaid for ordinary paid leave", () => {
    expect(allocateUnpaid({ start: "2025-11-03", end: "2025-11-07", part: "full", typeCode: "CL", lopDays: 0 }, weekdays).size).toBe(0);
  });

  it("handles a half-day request", () => {
    expect([...allocateUnpaid({ start: "2025-11-03", end: "2025-11-03", part: "first_half", typeCode: "LOP", lopDays: 0.5 }, weekdays).entries()]).toEqual([["2025-11-03", 0.5]]);
    expect([...allocateUnpaid({ start: "2025-11-03", end: "2025-11-03", part: "second_half", typeCode: "CL", lopDays: 0.5 }, weekdays).entries()]).toEqual([["2025-11-03", 0.5]]);
  });
});

describe("canLockMonth (R58)", () => {
  it("only allows a month that has ended", () => {
    expect(canLockMonth({ today: "2026-10-30", year: 2026, month: 10 })).toMatchObject({ ok: false });
    expect(canLockMonth({ today: "2026-10-31", year: 2026, month: 10 })).toMatchObject({ ok: false });
    expect(canLockMonth({ today: "2026-11-01", year: 2026, month: 10 })).toEqual({ ok: true });
    expect(canLockMonth({ today: "2026-10-30", year: 2026, month: 9 })).toEqual({ ok: true });
    expect(canLockMonth({ today: "2027-01-01", year: 2026, month: 12 })).toEqual({ ok: true });
  });

  it("explains itself", () => {
    expect((canLockMonth({ today: "2026-10-30", year: 2026, month: 10 }) as { error: string }).error).toContain("October 2026");
  });
});

describe("spanAt (R63)", () => {
  const spans = [
    { id: "pnj", from: "2024-01-01", to: "2025-03-14" },
    { id: "vrn", from: "2025-03-15", to: null },
  ];

  it("picks the assignment effective on the day, including the boundaries", () => {
    expect(spanAt(spans, "2025-03-14")?.id).toBe("pnj");
    expect(spanAt(spans, "2025-03-15")?.id).toBe("vrn");
    expect(spanAt(spans, "2030-01-01")?.id).toBe("vrn");
    expect(spanAt(spans, "2024-06-01")?.id).toBe("pnj");
  });

  it("returns null before the first assignment or in a gap", () => {
    expect(spanAt(spans, "2023-12-31")).toBeNull();
    expect(spanAt([{ id: "a", from: "2025-03-10", to: "2025-03-12" }, { id: "b", from: "2025-03-20", to: null }], "2025-03-15")).toBeNull();
    expect(spanAt([], "2025-03-15")).toBeNull();
  });

  it("lets the latest start win if two spans overlap", () => {
    expect(spanAt([{ id: "old", from: "2025-01-01", to: null }, { id: "new", from: "2025-03-01", to: null }], "2025-03-05")?.id).toBe("new");
  });
});
