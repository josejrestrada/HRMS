import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, isRealDate, formatDate, tenureText, todayIST, weekdayName } from "../../src/shared/dates";

describe("IST dates", () => {
  it("rolls over to the next day at 18:30 UTC (midnight IST)", () => {
    expect(todayIST(new Date("2026-10-29T18:29:59Z"))).toBe("2026-10-29");
    expect(todayIST(new Date("2026-10-29T18:30:00Z"))).toBe("2026-10-30");
  });

  it("uses IST, not UTC, just after midnight in India", () => {
    expect(todayIST(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-10-29", "2026-12-03")).toBe(35);
    expect(daysBetween("2026-10-29", "2026-10-29")).toBe(0);
  });

  it("formats dates and weekdays", () => {
    expect(formatDate("2026-10-02")).toBe("2 Oct 2026");
    expect(weekdayName("2026-10-29")).toBe("Thursday");
  });
});

describe("tenureText", () => {
  it("describes years and months", () => {
    expect(tenureText("2024-07-15", "2026-10-29")).toBe("2 years 3 months");
    expect(tenureText("2025-10-29", "2026-10-29")).toBe("1 year");
  });

  it("does not count a month until the day of the month is reached", () => {
    expect(tenureText("2026-09-30", "2026-10-29")).toBe("Less than a month");
    expect(tenureText("2026-08-30", "2026-10-29")).toBe("1 month");
  });

  it("handles a joining date in the future", () => {
    expect(tenureText("2026-12-01", "2026-10-29")).toBe("Not started yet");
  });
});

describe("addMonths", () => {
  it("adds months and keeps the day when it exists", () => {
    expect(addMonths("2026-10-15", 3)).toBe("2027-01-15");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
  });

  it("clamps to the last day of a shorter month", () => {
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2023-11-30", 3)).toBe("2024-02-29");
  });

  it("can go backwards", () => {
    expect(addMonths("2026-01-31", -2)).toBe("2025-11-30");
  });
});

describe("isRealDate (review finding 10)", () => {
  it("accepts real dates, including 29 February in a leap year", () => {
    expect(isRealDate("2026-10-31")).toBe(true);
    expect(isRealDate("2024-02-29")).toBe(true);
  });

  it("rejects dates that look right but do not exist", () => {
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2025-02-29")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("2026-00-10")).toBe(false);
    expect(isRealDate("2026-04-31")).toBe(false);
  });

  it("rejects text that is not in the YYYY-MM-DD shape", () => {
    for (const bad of ["", "2026-1-5", "26-10-31", "2026/10/31", "yesterday", "2026-10-31T00:00", " 2026-10-31"]) expect(isRealDate(bad)).toBe(false);
  });
});
