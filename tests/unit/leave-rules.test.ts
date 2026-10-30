import { describe, expect, it } from "vitest";
import {
  accrualMonths,
  allocateCompoff,
  canCancel,
  checkCompoff,
  checkMaternity,
  checkPaternity,
  compoffAvailable,
  maternityWeeks,
  canDecide,
  checkApplication,
  countLeaveDays,
  elAccrualForMonth,
  entitlementMonths,
  fmtDays,
  isSameDelivery,
  proratedGrant,
  workingDaysInMonth,
  yearEndPlan,
} from "@/modules/leave/rules";
import { addMonths } from "@/shared/dates";

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

describe("yearEndPlan (R22, R23, R38)", () => {
  it("lapses all casual and sick leave, which have a carry-forward cap of 0", () => {
    expect(yearEndPlan({ available: 5, cap: 0, encashable: false })).toEqual({ carry: 0, lapse: 5, encash: 0 });
  });

  it("carries earned leave up to 45 days and encashes the excess", () => {
    expect(yearEndPlan({ available: 50, cap: 45, encashable: true })).toEqual({ carry: 45, lapse: 0, encash: 5 });
    expect(yearEndPlan({ available: 45, cap: 45, encashable: true })).toEqual({ carry: 45, lapse: 0, encash: 0 });
  });

  it("carries everything when the balance is under the cap", () => {
    expect(yearEndPlan({ available: 12.5, cap: 45, encashable: true })).toEqual({ carry: 12.5, lapse: 0, encash: 0 });
  });

  it("lapses (not encashes) the excess for a type that cannot be encashed", () => {
    expect(yearEndPlan({ available: 10, cap: 4, encashable: false })).toEqual({ carry: 4, lapse: 6, encash: 0 });
  });

  it("does nothing for a zero or negative balance", () => {
    expect(yearEndPlan({ available: 0, cap: 45, encashable: true })).toEqual({ carry: 0, lapse: 0, encash: 0 });
    expect(yearEndPlan({ available: -2, cap: 45, encashable: true })).toEqual({ carry: 0, lapse: 0, encash: 0 });
  });
});

describe("maternity (R47, R48)", () => {
  const base = { today: "2026-10-30", startDate: "2026-12-01", expectedDelivery: "2027-01-10", survivingChildren: 0, joiningDate: "2024-01-01", gender: "female" };

  it("gives 26 weeks for fewer than two surviving children and 12 for two or more", () => {
    expect([maternityWeeks(0), maternityWeeks(1), maternityWeeks(2), maternityWeeks(3)]).toEqual([26, 26, 12, 12]);
  });

  it("works out the end date and calendar days, even across a year end", () => {
    const r = checkMaternity(base);
    expect(r).toMatchObject({ ok: true, weeks: 26, days: 182, endDate: "2027-05-31" });
    expect(checkMaternity({ ...base, survivingChildren: 2 })).toMatchObject({ weeks: 12, days: 84, endDate: "2027-02-22" });
  });

  it("starts at most 8 weeks before the delivery and not after it", () => {
    expect(checkMaternity({ ...base, startDate: "2026-11-14" })).toMatchObject({ ok: false, field: "startDate" }); // 57 days before
    expect(checkMaternity({ ...base, startDate: "2026-11-15" }).ok).toBe(true); // exactly 56 days before
    expect(checkMaternity({ ...base, startDate: "2027-01-11" })).toMatchObject({ ok: false, field: "startDate" });
  });

  it("is only for female employees", () => {
    expect(checkMaternity({ ...base, gender: "male" }).ok).toBe(false);
    expect(checkMaternity({ ...base, gender: null }).ok).toBe(false);
  });

  it("blocks someone with under 80 days of service", () => {
    expect(checkMaternity({ ...base, joiningDate: "2026-10-01" }).ok).toBe(false);
    expect(checkMaternity({ ...base, joiningDate: "2026-09-12" }).ok).toBe(true); // 80 days to 1 Dec
  });

  it("refuses an old start date and an implausible delivery date", () => {
    expect(checkMaternity({ ...base, startDate: "2026-10-20", expectedDelivery: "2026-11-10" }).ok).toBe(false);
    expect(checkMaternity({ ...base, expectedDelivery: "2031-01-01" })).toMatchObject({ ok: false, field: "expectedDeliveryDate" });
  });
});

describe("paternity (R49)", () => {
  const base = { today: "2026-10-30", birthDate: "2026-10-25", startDate: "2026-11-02", endDate: "2026-11-06", days: 5, alreadyUsed: 0, gender: "male", addMonthsFn: addMonths };

  it("accepts 5 working days within three months of the birth", () => {
    expect(checkPaternity(base)).toEqual({ ok: true, windowEnd: "2027-01-25" });
  });

  it("is only for male employees", () => {
    expect(checkPaternity({ ...base, gender: "female" }).ok).toBe(false);
  });

  it("refuses a future birth date, a start before the birth and an end after the window", () => {
    expect(checkPaternity({ ...base, birthDate: "2026-11-05" })).toMatchObject({ ok: false, field: "birthDate" });
    expect(checkPaternity({ ...base, startDate: "2026-10-24" })).toMatchObject({ ok: false, field: "startDate" });
    expect(checkPaternity({ ...base, endDate: "2027-01-26" })).toMatchObject({ ok: false, field: "endDate" });
  });

  it("allows the days to be split but never more than 5 in total", () => {
    expect(checkPaternity({ ...base, days: 2, alreadyUsed: 3 }).ok).toBe(true);
    const r = checkPaternity({ ...base, days: 3, alreadyUsed: 3 });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("2 days left");
  });
});

describe("comp-off requests (R50)", () => {
  const base = { today: "2026-10-30", workedDate: "2026-10-24", isOffDay: true, part: "full" as const };

  it("gives 1 day or half a day for a worked weekly off or holiday", () => {
    expect(checkCompoff(base)).toEqual({ ok: true, days: 1 });
    expect(checkCompoff({ ...base, part: "half" })).toEqual({ ok: true, days: 0.5 });
  });

  it("refuses a normal working day, a future date and a claim older than 30 days", () => {
    expect(checkCompoff({ ...base, isOffDay: false }).ok).toBe(false);
    expect(checkCompoff({ ...base, workedDate: "2026-10-31" }).ok).toBe(false);
    expect(checkCompoff({ ...base, workedDate: "2026-09-30" }).ok).toBe(true); // exactly 30 days
    expect(checkCompoff({ ...base, workedDate: "2026-09-29" }).ok).toBe(false);
  });
});

describe("comp-off credits (R51)", () => {
  const credits = [
    { id: "b", remaining: 1, expiresOn: "2026-12-20" },
    { id: "a", remaining: 0.5, expiresOn: "2026-11-30" },
    { id: "c", remaining: 1, expiresOn: "2026-11-10" },
  ];

  it("counts only credits that have not expired by the last leave date", () => {
    expect(compoffAvailable(credits, "2026-11-05")).toBe(2.5);
    expect(compoffAvailable(credits, "2026-11-30")).toBe(1.5);
    expect(compoffAvailable(credits, "2027-01-01")).toBe(0);
  });

  it("uses the earliest-expiring credit first and splits across credits", () => {
    expect(allocateCompoff(credits, 1.5, "2026-11-05")).toEqual([
      { creditId: "c", amount: 1 },
      { creditId: "a", amount: 0.5 },
    ]);
  });

  it("returns null when the usable credits are not enough", () => {
    expect(allocateCompoff(credits, 2, "2026-11-30")).toBeNull();
    expect(allocateCompoff([], 0.5, "2026-11-05")).toBeNull();
  });
});

describe("isSameDelivery (R67)", () => {
  it("treats expected delivery dates less than 180 days apart as one delivery", () => {
    expect(isSameDelivery("2027-01-10", "2027-01-10")).toBe(true);
    expect(isSameDelivery("2027-01-10", "2027-03-01")).toBe(true);
    expect(isSameDelivery("2027-01-10", "2026-08-15")).toBe(true); // either way round
    expect(isSameDelivery("2027-01-10", "2027-07-08")).toBe(true); // 179 days
  });

  it("treats dates 180 days or more apart as different deliveries", () => {
    expect(isSameDelivery("2027-01-10", "2027-07-09")).toBe(false); // exactly 180 days
    expect(isSameDelivery("2027-01-10", "2027-07-10")).toBe(false);
    expect(isSameDelivery("2027-01-10", "2028-04-01")).toBe(false);
  });
});
