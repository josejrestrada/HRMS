import { describe, expect, it } from "vitest";
import { canWorkFromHomeOn, checkWfhWindow, wfhLimitError } from "@/modules/attendance/rules";

describe("work-from-home window", () => {
  const base = { today: "2026-11-02", latest: "2026-12-02" };
  it("accepts today up to 30 days ahead", () => {
    expect(checkWfhWindow({ ...base, start: "2026-11-02", end: "2026-12-02" })).toEqual({ ok: true });
  });
  it("refuses a past start, a day too far ahead, and an end before the start", () => {
    expect(checkWfhWindow({ ...base, start: "2026-11-01", end: "2026-11-03" })).toMatchObject({ ok: false });
    expect(checkWfhWindow({ ...base, start: "2026-11-02", end: "2026-12-03" })).toMatchObject({ ok: false });
    expect(checkWfhWindow({ ...base, start: "2026-11-05", end: "2026-11-04" })).toMatchObject({ ok: false });
  });
});

describe("which days work from home can be asked for", () => {
  it("only ordinary working days of someone who is employed", () => {
    expect(canWorkFromHomeOn({ status: "upcoming", employed: true })).toBe(true);
    expect(canWorkFromHomeOn({ status: "absent", employed: true })).toBe(true);
    for (const status of ["holiday", "weekly_off", "leave", "half_day", "wfh"] as const) expect(canWorkFromHomeOn({ status, employed: true })).toBe(false);
    expect(canWorkFromHomeOn({ status: "upcoming", employed: false })).toBe(false);
  });
});

describe("monthly limit", () => {
  it("allows up to the limit counting days already pending or approved", () => {
    expect(wfhLimitError({ monthLabel: "Nov 2026", alreadyUsed: 2, asking: 2, limit: 4 })).toBeNull();
    expect(wfhLimitError({ monthLabel: "Nov 2026", alreadyUsed: 3, asking: 2, limit: 4 })).toContain("1 left");
    expect(wfhLimitError({ monthLabel: "Nov 2026", alreadyUsed: 5, asking: 1, limit: 4 })).toContain("0 left");
  });
});
