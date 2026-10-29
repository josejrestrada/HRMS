import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatDate, tenureText, todayIST, weekdayName } from "../../src/shared/dates";

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
