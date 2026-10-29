// Runs only with RUN_DB_TESTS=yes (npm run test:db). The write tests run the transaction-level
// functions inside a transaction that is ALWAYS rolled back, with explicit TESTDB employee codes so
// the code sequence is never used. The read tests only read.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DB_TESTS === "yes" && !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("People rules against the database", () => {
  let pool: Pool;
  let people: typeof import("@/modules/employees/data");
  let DomainError: typeof import("@/shared/errors").DomainError;
  let locationId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    people = await import("@/modules/employees/data");
    ({ DomainError } = await import("@/shared/errors"));
    locationId = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
  });
  afterAll(async () => {
    await pool.end();
  });

  const q = (c: PoolClient) => ({
    query: async (text: string, params: unknown[] = []) => (await c.query(text, params)).rows,
  });

  async function inTx(fn: (c: PoolClient, tx: ReturnType<typeof q>) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await fn(c, q(c));
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  const input = (n: number, extra: Record<string, unknown> = {}) => ({
    fullName: `DB Test ${n}`,
    workEmail: `db-test-${n}-${Math.random().toString(36).slice(2)}@example.invalid`,
    joiningDate: "2026-01-05",
    locationId,
    department: "Test",
    designation: "Tester",
    employmentType: "permanent" as const,
    ...extra,
  });

  /** An HR admin created directly inside the transaction, to act as the signed-in user. */
  async function hrActor(c: PoolClient, _tx: ReturnType<typeof q>, n = 0) {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, 'DB HR', $2, '2026-01-01') returning id",
      [`TESTDB-HR${n}`, `db-hr-${n}-${Math.random().toString(36).slice(2)}@example.invalid`],
    );
    const id = r.rows[0].id as string;
    await c.query("insert into employee_role (employee_id, role) values ($1, 'hr_admin')", [id]);
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, employment_type, effective_from) values ($1, $2, 'HR', 'HR', 'permanent', '2026-01-01')",
      [id, locationId],
    );
    return { employeeId: id, employeeCode: `TESTDB-HR${n}`, fullName: "DB HR", roles: ["employee", "hr_admin"] as ("employee" | "hr_admin")[] };
  }

  it("creates an employee with a first assignment and an audit entry", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const { id, employeeCode } = await people.createEmployeeTx(tx, hr, input(1), { employeeCode: "TESTDB-1" });
      expect(employeeCode).toBe("TESTDB-1");
      const a = await c.query("select effective_from::text, effective_to from employment_assignment where employee_id = $1", [id]);
      expect(a.rows).toEqual([{ effective_from: "2026-01-05", effective_to: null }]);
      const log = await c.query("select actor_employee_id from audit_log where entity_id = $1 and action = 'employee_created'", [id]);
      expect(log.rows[0].actor_employee_id).toBe(hr.employeeId);
    });
  });

  it("rejects a duplicate work email in any letter case", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const first = input(2);
      await people.createEmployeeTx(tx, hr, first, { employeeCode: "TESTDB-2" });
      await expect(
        people.createEmployeeTx(tx, hr, { ...input(3), workEmail: first.workEmail.toUpperCase() }, { employeeCode: "TESTDB-3" }),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("rejects an inactive or unknown manager", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const boss = await people.createEmployeeTx(tx, hr, input(4), { employeeCode: "TESTDB-4" });
      await c.query("update employee set status = 'inactive' where id = $1", [boss.id]);
      await expect(people.createEmployeeTx(tx, hr, input(5, { managerId: boss.id }), { employeeCode: "TESTDB-5" })).rejects.toThrow(/active employee/);
      await expect(
        people.createEmployeeTx(tx, hr, input(6, { managerId: "00000000-0000-4000-8000-000000000000" }), { employeeCode: "TESTDB-6" }),
      ).rejects.toThrow(/does not exist/);
    });
  });

  it("changes an assignment: closes the old one the day before and opens the new one", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const e = await people.createEmployeeTx(tx, hr, input(7), { employeeCode: "TESTDB-7" });
      await people.changeAssignmentTx(tx, hr, e.id, { effectiveFrom: "2026-06-01", locationId, department: "Test", designation: "Senior Tester", employmentType: "permanent" });
      const rows = (await c.query("select designation, effective_from::text as f, effective_to::text as t from employment_assignment where employee_id = $1 order by effective_from", [e.id])).rows;
      expect(rows).toEqual([
        { designation: "Tester", f: "2026-01-05", t: "2026-05-31" },
        { designation: "Senior Tester", f: "2026-06-01", t: null },
      ]);
    });
  });

  it("refuses a change that starts too early or changes nothing", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const e = await people.createEmployeeTx(tx, hr, input(8), { employeeCode: "TESTDB-8" });
      const same = { locationId, department: "Test", designation: "Tester", employmentType: "permanent" as const };
      await expect(people.changeAssignmentTx(tx, hr, e.id, { ...same, effectiveFrom: "2026-01-05", designation: "X" })).rejects.toThrow(/must start after/);
      await expect(people.changeAssignmentTx(tx, hr, e.id, { ...same, effectiveFrom: "2026-02-01" })).rejects.toThrow(/Nothing has changed/);
    });
  });

  it("blocks a reporting loop and self-management", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const a = await people.createEmployeeTx(tx, hr, input(9), { employeeCode: "TESTDB-9" });
      const b = await people.createEmployeeTx(tx, hr, input(10, { managerId: a.id }), { employeeCode: "TESTDB-10" });
      const base = { effectiveFrom: "2026-06-01", locationId, department: "Test", designation: "Boss", employmentType: "permanent" as const };
      await expect(people.changeAssignmentTx(tx, hr, a.id, { ...base, managerId: b.id })).rejects.toThrow(/directly or indirectly/);
      await expect(people.changeAssignmentTx(tx, hr, a.id, { ...base, managerId: a.id })).rejects.toThrow(/own manager/);
    });
  });

  it("does not let HR deactivate themself, the last HR admin, or someone with direct reports", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      await expect(people.deactivateEmployeeTx(tx, hr, hr.employeeId, { exitDate: "2026-10-30" })).rejects.toThrow(/your own account/);

      const boss = await people.createEmployeeTx(tx, hr, input(11), { employeeCode: "TESTDB-11" });
      await people.createEmployeeTx(tx, hr, input(12, { managerId: boss.id }), { employeeCode: "TESTDB-12" });
      await expect(people.deactivateEmployeeTx(tx, hr, boss.id, { exitDate: "2026-10-30" })).rejects.toThrow(/still report/);

      // A second HR admin can only be deactivated while another active HR admin exists.
      const hr2 = await hrActor(c, tx, 1);
      // Other HR admins already in this database would count, so set them inactive inside the
      // transaction (rolled back afterwards) to make hr2 the last active one.
      await c.query(
        "update employee set status = 'inactive' where id in (select employee_id from employee_role where role = 'hr_admin') and id <> $1",
        [hr2.employeeId],
      );
      await expect(people.deactivateEmployeeTx(tx, { ...hr, employeeId: boss.id }, hr2.employeeId, { exitDate: "2026-10-30" })).rejects.toThrow(/last active HR admin/);
    });
  });

  it("deactivates and reactivates, closing and reopening the assignment", async () => {
    await inTx(async (c, tx) => {
      const hr = await hrActor(c, tx);
      const e = await people.createEmployeeTx(tx, hr, input(13), { employeeCode: "TESTDB-13" });
      await expect(people.deactivateEmployeeTx(tx, hr, e.id, { exitDate: "2025-12-31" })).rejects.toThrow(/before the joining date/);

      await people.deactivateEmployeeTx(tx, hr, e.id, { exitDate: "2026-09-30" });
      let emp = (await c.query("select status, exit_date::text as x from employee where id = $1", [e.id])).rows[0];
      expect(emp).toEqual({ status: "inactive", x: "2026-09-30" });
      let a = (await c.query("select effective_to::text as t from employment_assignment where employee_id = $1", [e.id])).rows[0];
      expect(a.t).toBe("2026-09-30");

      await people.reactivateEmployeeTx(tx, hr, e.id);
      emp = (await c.query("select status, exit_date::text as x from employee where id = $1", [e.id])).rows[0];
      expect(emp).toEqual({ status: "active", x: null });
      a = (await c.query("select effective_to::text as t from employment_assignment where employee_id = $1", [e.id])).rows[0];
      expect(a.t).toBeNull();
    });
  });

  // ---- read-only ----
  const hr = { employeeId: "t", employeeCode: "t", fullName: "t", roles: ["employee", "hr_admin"] as ("employee" | "hr_admin")[] };

  it("lists and searches people, treating % and _ as plain characters", async () => {
    const all = await people.listEmployees(hr, { status: "all", page: 1 });
    expect(all.total).toBeGreaterThan(0);
    expect(all.rows.length).toBeLessThanOrEqual(all.pageSize);

    const byName = await people.listEmployees(hr, { status: "all", page: 1, q: all.rows[0].fullName.slice(0, 6) });
    expect(byName.rows.some((r) => r.id === all.rows[0].id)).toBe(true);

    const wildcard = await people.listEmployees(hr, { status: "all", page: 1, q: "%%" });
    expect(wildcard.total).toBe(0);
  });

  it("returns a profile with history and a current assignment", async () => {
    const active = await people.listEmployees(hr, { status: "active", page: 1 });
    const profile = await people.getEmployeeProfile(hr, active.rows[0].id);
    expect(profile?.history.length).toBeGreaterThan(0);
    expect(profile?.current).not.toBeNull();
    expect(await people.getEmployeeProfile(hr, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
