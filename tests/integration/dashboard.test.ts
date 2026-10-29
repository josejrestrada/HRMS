// Read-only. Runs only with RUN_DB_TESTS=yes (npm run test:db). Checks that the dashboard SQL runs
// against the real schema and that the numbers are internally consistent.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DB_TESTS === "yes" && !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("HR dashboard against the database (read-only)", () => {
  it("returns consistent numbers", async () => {
    const { getHrDashboard } = await import("@/modules/reports/data");
    const hr = { employeeId: "test", employeeCode: "TST", fullName: "Test", roles: ["employee", "hr_admin"] as ("employee" | "hr_admin")[] };
    const d = await getHrDashboard(hr);

    const assigned = d.headcount.byLocation.reduce((sum, l) => sum + l.count, 0);
    expect(d.headcount.total).toBeGreaterThanOrEqual(assigned);
    expect(d.attention.unassigned).toBe(d.headcount.total - assigned);
    expect(d.onLeaveTotal).toBeGreaterThanOrEqual(d.onLeave.length);
    expect(d.pending.items.length).toBeLessThanOrEqual(d.pending.count);
    // Everyone is either recorded, not in yet, or off today (weekly off or holiday).
    expect(d.attendance.recorded + d.attendance.notRecorded + d.attendance.offToday).toBe(d.headcount.total);
    expect(d.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const h of d.holidays) expect(h.date >= d.today).toBe(true);
  });
});
