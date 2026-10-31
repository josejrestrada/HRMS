// Runs only with RUN_DB_TESTS=yes (npm run test:db). Checks the minimum-privilege application role
// (hrms_app) against EVERY table in the database, so a table added later without a deliberate grant
// makes this test fail. Everything here is read-only or rolled back.
import { Pool } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseTestsEnabled } from "./enabled";

const enabled = databaseTestsEnabled();

// Tables whose rows may only ever be added (see migrations 001, 004, 005, 008).
const APPEND_ONLY = ["audit_log", "leave_ledger", "punch", "attendance_period", "agent_message"];
// The one table the application may delete from: role assignments are removed when someone loses a role.
const MAY_DELETE = ["employee_role"];

describe.skipIf(!enabled)("application role privileges (hrms_app)", () => {
  let pool: Pool;
  let tables: string[];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    tables = (await pool.query("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows.map(
      (r) => r.table_name as string,
    );
  });
  afterAll(async () => {
    await pool.end();
  });

  const can = async (privilege: string, table: string) =>
    (await pool.query("select has_table_privilege('hrms_app', $1, $2) as ok", [`public.${table}`, privilege])).rows[0].ok as boolean;

  it("knows about the tables it is checking", () => {
    expect(tables).toEqual(expect.arrayContaining(["employee", "leave_ledger", "punch", "regularization", "compoff_request", "attendance_period", "attendance_day", "attendance_policy", "agent_conversation", "agent_message", "agent_draft", "wfh_request", "employee_private", "employee_bank"]));
  });

  it("can read every application table, and cannot touch the migration record", async () => {
    for (const t of tables.filter((x) => x !== "schema_migration")) expect(await can("SELECT", t), `SELECT on ${t}`).toBe(true);
    expect(await can("SELECT", "schema_migration")).toBe(false);
    expect(await can("INSERT", "schema_migration")).toBe(false);
  });

  it("cannot truncate any table", async () => {
    for (const t of tables) expect(await can("TRUNCATE", t), `TRUNCATE on ${t}`).toBe(false);
  });

  it("can delete only role assignments", async () => {
    for (const t of tables) expect(await can("DELETE", t), `DELETE on ${t}`).toBe(MAY_DELETE.includes(t));
  });

  it("can only add to the append-only tables, never change them", async () => {
    for (const t of APPEND_ONLY) {
      expect(await can("INSERT", t), `INSERT on ${t}`).toBe(true);
      expect(await can("UPDATE", t), `UPDATE on ${t}`).toBe(false);
    }
  });

  it("cannot change the attendance policy until there is an audited screen for it", async () => {
    expect(await can("SELECT", "attendance_policy")).toBe(true);
    expect(await can("UPDATE", "attendance_policy")).toBe(false);
    expect(await can("INSERT", "attendance_policy")).toBe(false);
  });

  it("refuses to truncate the newer protected tables even for the owner (defence in depth)", async () => {
    for (const t of ["regularization", "compoff_request", "attendance_day", "punch", "leave_ledger", "attendance_period", "audit_log", "employee", "agent_conversation", "agent_message", "agent_draft", "wfh_request"]) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await expect(c.query(`truncate ${t} cascade`), `TRUNCATE ${t}`).rejects.toThrow(/cannot be truncated|cannot truncate/);
      } finally {
        await c.query("rollback").catch(() => {});
        c.release();
      }
    }
  });
});
