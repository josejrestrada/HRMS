import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const queryMock = vi.fn();
vi.mock("@/shared/db", () => ({ query: (...args: unknown[]) => queryMock(...args) }));

import { getHrDashboard } from "@/modules/reports/data";
import { ForbiddenError, type Actor } from "@/shared/roles";
import { todayIST } from "@/shared/dates";

const employee: Actor = { employeeId: "1", employeeCode: "KCF0001", fullName: "A", roles: ["employee"] };
const hr: Actor = { employeeId: "2", employeeCode: "KCF0002", fullName: "B", roles: ["employee", "hr_admin"] };
const systemAdminOnly: Actor = { employeeId: "3", employeeCode: "KCF0003", fullName: "C", roles: ["employee", "system_admin"] };

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue([]);
});

describe("getHrDashboard access", () => {
  it("rejects a missing actor before any query runs", async () => {
    await expect(getHrDashboard(null)).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects an ordinary employee before any query runs", async () => {
    await expect(getHrDashboard(employee)).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects a system admin who is not an HR admin", async () => {
    await expect(getHrDashboard(systemAdminOnly)).rejects.toBeInstanceOf(ForbiddenError);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("allows an HR admin and uses today's date in IST", async () => {
    const data = await getHrDashboard(hr);
    expect(data.today).toBe(todayIST());
    expect(queryMock).toHaveBeenCalled();
    expect(data.pending.count).toBe(0);
    expect(data.onLeaveTotal).toBe(0);
  });
});

describe("getHrDashboard accuracy", () => {
  it("counts only active employees' pending requests", async () => {
    await getHrDashboard(hr);
    const pendingSql = queryMock.mock.calls
      .map((c) => String(c[0]))
      .filter((sql) => sql.includes("lr.status = 'pending'"));
    expect(pendingSql.length).toBeGreaterThanOrEqual(2); // the count and the list
    for (const sql of pendingSql) expect(sql).toContain("e.status = 'active'");
  });

  it("reports active employees with no current assignment", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("from employee where status = 'active'")) return [{ count: 10 }];
      if (sql.includes("group by l.name")) return [{ name: "Panaji", count: 6 }, { name: "Verna", count: 3 }];
      return [];
    });
    const data = await getHrDashboard(hr);
    expect(data.headcount.total).toBe(10);
    expect(data.attention.unassigned).toBe(1);
  });

  it("uses the true on-leave total even when the list is capped", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("lr.status = 'approved'")) {
        return [{ employee_code: "KCF0001", full_name: "A", leave_code: "CL", day_part: "first_half", start_date: "2026-10-29", end_date: "2026-10-29", total: 40 }];
      }
      return [];
    });
    const data = await getHrDashboard(hr);
    expect(data.onLeaveTotal).toBe(40);
    expect(data.onLeave[0].dayPart).toBe("first_half");
  });
});
