import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/db", () => ({ query: vi.fn() }));

import { lockMonthExclusive, lockMonthsShared, monthsBetween } from "@/shared/periods";

describe("monthsBetween", () => {
  it("lists every month touched, in order, across a year end", () => {
    expect(monthsBetween("2026-11-20", "2027-02-03")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(monthsBetween("2026-10-05", "2026-10-30")).toEqual(["2026-10"]);
  });
});

describe("month locks for concurrency (R65)", () => {
  it("takes a shared lock for each month a set of dates touches, earliest first", async () => {
    const tx = { query: vi.fn().mockResolvedValue([]) };
    await lockMonthsShared(tx, ["2026-12-30", "2026-10-05"]);
    expect(tx.query).toHaveBeenCalledTimes(3);
    const keys = tx.query.mock.calls.map((c) => c[1][1] as number);
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
    expect(tx.query.mock.calls[0][0]).toContain("pg_advisory_xact_lock_shared");
  });

  it("does nothing for no dates", async () => {
    const tx = { query: vi.fn() };
    await lockMonthsShared(tx, []);
    expect(tx.query).not.toHaveBeenCalled();
  });

  it("uses the same key for the exclusive lock and the shared lock of one month", async () => {
    const shared = { query: vi.fn().mockResolvedValue([]) };
    const exclusive = { query: vi.fn().mockResolvedValue([]) };
    await lockMonthsShared(shared, ["2025-03-10"]);
    await lockMonthExclusive(exclusive, 2025, 3);
    expect(exclusive.query.mock.calls[0][0]).toContain("pg_advisory_xact_lock(");
    expect(exclusive.query.mock.calls[0][1]).toEqual(shared.query.mock.calls[0][1]);
  });
});
