// Runs only with RUN_DB_TESTS=yes. HR's read-only leave and attendance views of one person.
// The shared query helper is pointed at one open transaction which is ALWAYS rolled back.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";

vi.mock("server-only", () => ({}));

let current: PoolClient | null = null;
vi.mock("@/shared/db", () => ({
  query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows }),
}));

const enabled = databaseTestsEnabled();

describe.skipIf(!enabled)("HR profile tabs against the database", () => {
  let pool: Pool;
  let leave: typeof import("@/modules/leave/data");
  let attendance: typeof import("@/modules/attendance/data");
  let mps: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    leave = await import("@/modules/leave/data");
    attendance = await import("@/modules/attendance/data");
    mps = (await pool.query("select id from location where code = 'MPS'")).rows[0].id;
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    current = await pool.connect();
    await current.query("begin");
  });
  afterEach(async () => {
    await current!.query("rollback");
    current!.release();
    current = null;
  });

  async function person(code: string) {
    const id = (
      await current!.query(
        "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
        [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
      )
    ).rows[0].id as string;
    await current!.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, employment_type, effective_from) values ($1, $2, 'Tabs dept', 'T', 'permanent', '2024-01-01')",
      [id, mps],
    );
    return id;
  }
  const actorFor = (employeeId: string, roles: ("employee" | "hr_admin")[]) => ({ employeeId, employeeCode: "TESTDB-TH", fullName: "DB", roles });

  it("refuses anyone who is not HR", async () => {
    const id = await person("TESTDB-TE");
    const employee = actorFor(id, ["employee"]);
    await expect(leave.getEmployeeLeaveForHr(employee, id)).rejects.toThrow();
    await expect(attendance.getEmployeeMonthForHr(employee, id, 2026, 10)).rejects.toThrow();
    await expect(leave.getEmployeeLeaveForHr(null, id)).rejects.toThrow();
  });

  it("shows HR a person's balances and one month for a location outside Panaji and Verna", async () => {
    const id = await person("TESTDB-TP");
    const hrId = await person("TESTDB-TH");
    const hr = actorFor(hrId, ["employee", "hr_admin"]);
    const l = await leave.getEmployeeLeaveForHr(hr, id);
    expect(l.balances.map((b) => b.code)).toEqual(expect.arrayContaining(["CL", "SL", "EL"]));
    expect(l.requests).toEqual([]);
    const m = await attendance.getEmployeeMonthForHr(hr, id, 2026, 10);
    expect(m.days).toHaveLength(31);
    expect(m.days.every((d) => d.employed)).toBe(true);
    await expect(attendance.getEmployeeMonthForHr(hr, id, 2026, 13)).rejects.toThrow();
  });

  it("lets HR fix a missed-punch day at once with a reason, and shows the punches", async () => {
    const id = await person("TESTDB-TF");
    const hrId = await person("TESTDB-TG");
    const hr = actorFor(hrId, ["employee", "hr_admin"]);
    const tx = { query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows };
    const date = "2026-10-14"; // a Wednesday
    await current!.query("insert into punch (employee_id, punched_at, direction) values ($1, $2::timestamptz, 'in')", [id, `${date}T09:20:00+05:30`]);

    let month = await attendance.getEmployeeMonthForHr(hr, id, 2026, 10);
    expect(month.extras[date].punches).toEqual([{ time: "09:20", direction: "in" }]);
    expect(month.extras[date].canFix).toBe(true);

    await expect(attendance.hrFixDayTx(tx, hr, id, { date, in: "09:20", out: "17:50", reason: "" })).rejects.toThrow(/reason/);
    await expect(attendance.hrFixDayTx(tx, hr, hrId, { date, in: "09:20", out: "17:50", reason: "own day" })).rejects.toThrow();
    await expect(attendance.hrFixDayTx(tx, actorFor(id, ["employee"]), id, { date, in: "09:20", out: "17:50", reason: "self" })).rejects.toThrow();

    await attendance.hrFixDayTx(tx, hr, id, { date, in: "09:20", out: "17:50", reason: "Machine was down" });
    month = await attendance.getEmployeeMonthForHr(hr, id, 2026, 10);
    expect(month.extras[date].canFix).toBe(false);
    expect(month.days.find((d) => d.date === date)?.regularized).toBe(true);
    const row = (await current!.query("select status, approver_id from regularization where employee_id = $1", [id])).rows[0];
    expect(row).toMatchObject({ status: "approved", approver_id: hrId });
    const audit = (await current!.query("select action from audit_log where entity = 'regularization' and actor_employee_id = $1", [hrId])).rows;
    expect(audit.map((a) => a.action)).toContain("regularization_hr_fixed");
    await expect(attendance.hrFixDayTx(tx, hr, id, { date, in: "09:20", out: "17:50", reason: "again" })).rejects.toThrow(/does not need fixing/);
  });
});
