// Runs only with RUN_DB_TESTS=yes (npm run test:db). Every test runs inside a transaction that is
// ALWAYS rolled back, and inserts use explicit TESTDB codes so the employee code sequence is never
// used. Nothing is left in the database.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseTestsEnabled } from "./enabled";

const enabled = databaseTestsEnabled();

describe.skipIf(!enabled)("database protections (rolled back)", () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });

  async function inTx(fn: (c: PoolClient) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await fn(c);
    } finally {
      await c.query("rollback").catch(() => {});
      c.release();
    }
  }

  async function expectFail(c: PoolClient, sql: string, params: unknown[], pattern: RegExp) {
    await c.query("savepoint attempt");
    await expect(c.query(sql, params)).rejects.toThrow(pattern);
    await c.query("rollback to savepoint attempt");
  }

  async function newEmployee(c: PoolClient, code = "TESTDB-1") {
    const email = `db-test-${Math.random().toString(36).slice(2)}@example.invalid`;
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, 'DB test', $2, '2026-01-01') returning id",
      [code, email],
    );
    return r.rows[0].id as string;
  }

  it("never lets an employee code change", async () => {
    await inTx(async (c) => {
      await newEmployee(c);
      await expectFail(c, "update employee set employee_code = 'TESTDB-2' where employee_code = 'TESTDB-1'", [], /immutable/);
    });
  });

  it("never lets an employee be deleted or truncated", async () => {
    await inTx(async (c) => {
      await newEmployee(c);
      await expectFail(c, "delete from employee where employee_code = 'TESTDB-1'", [], /cannot be deleted/);
      // Plain TRUNCATE is stopped by the foreign keys; CASCADE gets as far as our guard.
      await expectFail(c, "truncate employee", [], /cannot be truncated|cannot truncate a table referenced/);
      await expectFail(c, "truncate employee cascade", [], /cannot be truncated/);
    });
  });

  it("keeps the audit log append-only (update, delete and truncate blocked)", async () => {
    await inTx(async (c) => {
      await c.query("insert into audit_log (action, entity) values ('test', 'test')");
      await expectFail(c, "update audit_log set action = 'x'", [], /append-only/);
      await expectFail(c, "delete from audit_log", [], /append-only/);
      await expectFail(c, "truncate audit_log", [], /cannot be truncated/);
    });
  });

  it("rejects a leave quota below its statutory floor", async () => {
    await inTx(async (c) => {
      await expectFail(c, "update leave_type set annual_quota = 1 where code = 'SL'", [], /leave_type_quota_meets_floor/);
    });
  });

  it("rejects overlapping assignments and self-management", async () => {
    await inTx(async (c) => {
      const id = await newEmployee(c);
      const loc = (await c.query("select id from location where code = 'PNJ'")).rows[0].id;
      const insert =
        "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from, effective_to) values ($1, $2, 'X', 'Y', $3, 'permanent', $4, $5)";
      await c.query(insert, [id, loc, null, "2026-01-01", "2026-06-30"]);
      await expectFail(c, insert, [id, loc, null, "2026-06-01", null], /conflicting|exclusion/i);
      await expectFail(c, insert, [id, loc, id, "2026-07-01", null], /check/i);
    });
  });

  it("rejects self-approval of leave", async () => {
    await inTx(async (c) => {
      const id = await newEmployee(c);
      const lt = (await c.query("select id from leave_type where code = 'CL'")).rows[0].id;
      await expectFail(
        c,
        "insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, status, approver_id) values ($1, $2, '2026-11-02', '2026-11-02', 1, 'approved', $1)",
        [id, lt],
        /check/i,
      );
    });
  });

  it("gives the app role no way to delete, truncate or edit history", async () => {
    await inTx(async (c) => {
      const q = async (priv: string, table: string) =>
        (await c.query("select has_table_privilege('hrms_app', $1, $2) as ok", [table, priv])).rows[0].ok as boolean;
      expect(await q("INSERT", "audit_log")).toBe(true);
      expect(await q("UPDATE", "audit_log")).toBe(false);
      expect(await q("DELETE", "audit_log")).toBe(false);
      expect(await q("TRUNCATE", "audit_log")).toBe(false);
      expect(await q("DELETE", "employee")).toBe(false);
      expect(await q("TRUNCATE", "employee")).toBe(false);
      expect(await q("DELETE", "leave_request")).toBe(false);
      expect(await q("DELETE", "employee_role")).toBe(true);
    });
  });
});
