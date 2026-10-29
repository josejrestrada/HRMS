import { describe, expect, it } from "vitest";
import {
  deriveDay,
  formatMinutes,
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
