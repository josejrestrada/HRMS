import { describe, expect, it } from "vitest";
import {
  accrualMonths,
  canCancel,
  canDecide,
  checkApplication,
  countLeaveDays,
  elAccrualForMonth,
  entitlementMonths,
  fmtDays,
  proratedGrant,
  workingDaysInMonth,
} from "@/modules/leave/rules";

const SAT_SUN = [0, 6];

describe("countLeaveDays (R3)", () => {
  it("skips weekly offs: Thu 29 Oct to Tue 3 Nov 2026 is 4 working days", () => {
    const r = countLeaveDays({ start: "2026-10-29", end: "2026-11-03", dayPart: "full", weeklyOffDays: SAT_SUN, holidays: {} });
    expect(r.days).toBe(4);
    expect(r.skipped.map((s) => s.date)).toEqual(["2026-10-31", "2026-11-01"]);
  });

  it("skips a holiday inside the range and names it", () => {
    const r = countLeaveDays({ start: "2026-12-02", end: "2026-12-04", dayPart: "full", weeklyOffDays: SAT_SUN, holidays: { "2026-12-03": "Feast of St Francis Xavier" } });
    expect(r.days).toBe(2);
    expect(r.skipped).toEqual([{ date: "2026-12-03", reason: "holiday", label: "Feast of St Francis Xavier" }]);
  });

  it("counts a half day as 0.5 only on a working day", () => {
    expect(countLeaveDays({ start: "2026-10-29", end: "2026-10-29", dayPart: "first_half", weeklyOffDays: SAT_SUN, holidays: {} }).days).toBe(0.5);
    expect(countLeaveDays({ start: "2026-10-31", end: "2026-10-31", dayPart: "first_half", weeklyOffDays: SAT_SUN, holidays: {} }).days).toBe(0);
  });

  it("returns zero days when the whole range is off", () => {
    expect(countLeaveDays({ start: "2026-10-31", end: "2026-11-01", dayPart: "full", weeklyOffDays: SAT_SUN, holidays: {} }).days).toBe(0);
  });
});

describe("entitlement and pro-rating (R13)", () => {
  it("gives twelve months to someone who joined in an earlier year", () => {
    expect(entitlementMonths("2024-07-20", 2026)).toBe(12);
  });

  it("counts the joining month only if joined on or before the 15th", () => {
    expect(entitlementMonths("2026-07-15", 2026)).toBe(6); // Jul to Dec
    expect(entitlementMonths("2026-07-16", 2026)).toBe(5); // Aug to Dec
    expect(entitlementMonths("2026-12-20", 2026)).toBe(0);
    expect(entitlementMonths("2027-01-05", 2026)).toBe(0);
  });

  it("rounds a pro-rated CL grant up to the half day", () => {
    // 8 x 5/12 = 3.33 -> 3.5, but the statutory floor is 6 so CL never drops below 6 (R4, P8)
    expect(proratedGrant({ annualQuota: 8, statutoryFloor: 6, joiningDate: "2026-07-16", year: 2026 })).toBe(6);
    // Without a floor the rounding is visible
    expect(proratedGrant({ annualQuota: 8, statutoryFloor: null, joiningDate: "2026-07-16", year: 2026 })).toBe(3.5);
  });

  it("never grants SL below the statutory 9 days", () => {
    expect(proratedGrant({ annualQuota: 9, statutoryFloor: 9, joiningDate: "2026-10-20", year: 2026 })).toBe(9);
  });

  it("gives a full year of CL to an earlier joiner", () => {
    expect(proratedGrant({ annualQuota: 8, statutoryFloor: 6, joiningDate: "2020-01-01", year: 2026 })).toBe(8);
  });
});

describe("earned leave accrual (R8, R14, R35)", () => {
  it("accrues on the last day of each completed month", () => {
    expect(accrualMonths("2020-01-01", 2026, "2026-10-30")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(accrualMonths("2020-01-01", 2026, "2026-10-31")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("starts a joiner in the right month", () => {
    expect(accrualMonths("2026-08-10", 2026, "2026-10-31")).toEqual([8, 9, 10]);
    expect(accrualMonths("2026-08-20", 2026, "2026-10-31")).toEqual([9, 10]);
    expect(accrualMonths("2027-02-01", 2026, "2026-10-31")).toEqual([]);
  });

  it("gives 1.5 days when there is no LOP", () => {
    expect(elAccrualForMonth({ annualQuota: 18, lopDays: 0, workingDays: 22 })).toBe(1.5);
  });

  it("reduces the accrual in proportion to LOP days, to the nearest half day", () => {
    expect(elAccrualForMonth({ annualQuota: 18, lopDays: 11, workingDays: 22 })).toBe(1); // 0.75 -> 1
    expect(elAccrualForMonth({ annualQuota: 18, lopDays: 22, workingDays: 22 })).toBe(0);
    expect(elAccrualForMonth({ annualQuota: 18, lopDays: 30, workingDays: 22 })).toBe(0); // capped
  });

  it("counts working days in a month", () => {
    expect(workingDaysInMonth(2026, 11, SAT_SUN, {})).toBe(21); // Nov 2026
  });
});

describe("checkApplication (R16 to R19, R33, R37)", () => {
  const base = {
    today: "2026-10-30",
    start: "2026-11-02",
    end: "2026-11-03",
    dayPart: "full" as const,
    days: 2,
    typeCode: "CL",
    typeName: "Casual leave",
    maxConsecutiveDays: 3,
    available: 5,
    convertShortfallToLop: false,
  };

  it("accepts a normal request and holds the days", () => {
    expect(checkApplication(base)).toEqual({ ok: true, days: 2, heldDays: 2, lopDays: 0, certificateRequired: false });
  });

  it("rejects an end date before the start date", () => {
    const r = checkApplication({ ...base, end: "2026-11-01" });
    expect(r).toMatchObject({ ok: false, field: "endDate" });
  });

  it("rejects a request that crosses a year (R33)", () => {
    const r = checkApplication({ ...base, start: "2026-12-30", end: "2027-01-02", days: 2 });
    expect(r.ok).toBe(false);
  });

  it("allows backdating up to 7 days and refuses older (R19, R37)", () => {
    expect(checkApplication({ ...base, start: "2026-10-23", end: "2026-10-23", days: 1 }).ok).toBe(true);
    const r = checkApplication({ ...base, start: "2026-10-22", end: "2026-10-22", days: 1 });
    expect(r).toMatchObject({ ok: false, field: "startDate" });
  });

  it("refuses a half day over several dates", () => {
    expect(checkApplication({ ...base, dayPart: "first_half", days: 0.5 })).toMatchObject({ ok: false, field: "dayPart" });
  });

  it("refuses a request with no working days", () => {
    expect(checkApplication({ ...base, days: 0 })).toMatchObject({ ok: false, field: "startDate" });
  });

  it("limits casual leave to 3 days in a row (R6)", () => {
    expect(checkApplication({ ...base, days: 4, available: 8 })).toMatchObject({ ok: false, field: "endDate" });
  });

  it("asks for a certificate for sick leave over 2 days (R7)", () => {
    const r = checkApplication({ ...base, typeCode: "SL", typeName: "Sick leave", maxConsecutiveDays: null, days: 3, available: 9 });
    expect(r).toMatchObject({ ok: true, certificateRequired: true });
    expect(checkApplication({ ...base, typeCode: "SL", typeName: "Sick leave", maxConsecutiveDays: null, days: 2, available: 9 })).toMatchObject({ certificateRequired: false });
  });

  it("rejects a shortfall unless the employee converts it to LOP (R18)", () => {
    const r = checkApplication({ ...base, days: 3, available: 1.5 });
    expect(r).toMatchObject({ ok: false, field: "leaveTypeId" });
    expect((r as { error: string }).error).toContain("1.5 days");
  });

  it("converts the shortfall to LOP when asked (R18, R34)", () => {
    expect(checkApplication({ ...base, days: 3, available: 1.5, convertShortfallToLop: true })).toEqual({
      ok: true, days: 3, heldDays: 1.5, lopDays: 1.5, certificateRequired: false,
    });
    expect(checkApplication({ ...base, days: 2, available: 0.5, convertShortfallToLop: true })).toMatchObject({ heldDays: 0.5, lopDays: 1.5 });
  });

  it("never holds more than the whole days available", () => {
    expect(checkApplication({ ...base, days: 2, available: 0, convertShortfallToLop: true })).toMatchObject({ heldDays: 0, lopDays: 2 });
  });

  it("treats LOP as unlimited with nothing held (R12)", () => {
    expect(checkApplication({ ...base, typeCode: "LOP", typeName: "Leave without pay", maxConsecutiveDays: null, available: 0, days: 5 })).toEqual({
      ok: true, days: 5, heldDays: 0, lopDays: 5, certificateRequired: false,
    });
  });
});

describe("who may decide or cancel (R20, R31)", () => {
  it("never lets someone decide their own request", () => {
    expect(canDecide({ actorEmployeeId: "a", actorIsHrAdmin: true, actorIsManagerOfRequester: true, requesterEmployeeId: "a" })).toBe(false);
  });

  it("lets a manager or an HR admin decide someone else's request, and nobody else", () => {
    const p = { actorEmployeeId: "a", requesterEmployeeId: "b" };
    expect(canDecide({ ...p, actorIsHrAdmin: false, actorIsManagerOfRequester: true })).toBe(true);
    expect(canDecide({ ...p, actorIsHrAdmin: true, actorIsManagerOfRequester: false })).toBe(true);
    expect(canDecide({ ...p, actorIsHrAdmin: false, actorIsManagerOfRequester: false })).toBe(false);
  });

  it("lets the owner cancel pending or future approved leave only", () => {
    const base = { actorEmployeeId: "a", actorIsHrAdmin: false, requesterEmployeeId: "a", today: "2026-10-30" };
    expect(canCancel({ ...base, status: "pending", startDate: "2026-10-01" })).toBe(true);
    expect(canCancel({ ...base, status: "approved", startDate: "2026-11-02" })).toBe(true);
    expect(canCancel({ ...base, status: "approved", startDate: "2026-10-01" })).toBe(false);
    expect(canCancel({ ...base, status: "rejected", startDate: "2026-11-02" })).toBe(false);
  });

  it("lets HR cancel past approved leave but not someone else's as a stranger", () => {
    expect(canCancel({ actorEmployeeId: "h", actorIsHrAdmin: true, requesterEmployeeId: "a", status: "approved", startDate: "2026-10-01", today: "2026-10-30" })).toBe(true);
    expect(canCancel({ actorEmployeeId: "x", actorIsHrAdmin: false, requesterEmployeeId: "a", status: "pending", startDate: "2026-11-01", today: "2026-10-30" })).toBe(false);
  });
});

describe("fmtDays", () => {
  it("formats singular, plural and halves", () => {
    expect([fmtDays(1), fmtDays(2), fmtDays(0.5), fmtDays(2.5)]).toEqual(["1 day", "2 days", "0.5 day", "2.5 days"]);
  });
});
