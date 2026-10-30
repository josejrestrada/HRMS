// Runs only with RUN_DB_TESTS=yes (npm run test:db). The employee home screen read against the real schema.
// The shared query helper is pointed at one open transaction which is ALWAYS rolled back.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";
import { addDays, todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

let current: PoolClient | null = null;
vi.mock("@/shared/db", () => ({
  query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows }),
}));

const enabled = databaseTestsEnabled();

describe.skipIf(!enabled)("Employee home against the database", () => {
  let pool: Pool;
  let reports: typeof import("@/modules/reports/data");
  let pnj: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    reports = await import("@/modules/reports/data");
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
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

  async function person(code: string, manager?: string) {
    const id = (
      await current!.query(
        "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
        [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
      )
    ).rows[0].id as string;
    await current!.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from) values ($1, $2, 'T', 'T', $3, 'permanent', '2024-01-01')",
      [id, pnj, manager ?? null],
    );
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee"] as "employee"[] };
  }

  it("returns the person's own status, balances, upcoming items and waiting approvals", async () => {
    const boss = await person("TESTDB-HM");
    const me = await person("TESTDB-HE", boss.employeeId);
    const today = todayIST();

    const mine = await reports.getEmployeeHome(me);
    expect(mine.today).toBe(today);
    expect(mine.status.label).toBeTruthy();
    expect(mine.balances.every((b) => b.code !== "LOP")).toBe(true);
    expect(mine.attention.filter((a) => a.href.endsWith("/approvals"))).toEqual([]); // not a manager of anyone
    expect(mine.upcoming.every((u) => u.date >= today)).toBe(true);
    expect(mine.upcoming.filter((u) => u.kind === "holiday").length).toBeLessThanOrEqual(3);

    // A request from the report shows up for the manager, and only for the manager.
    const day = addDays(today, 3);
    await current!.query("insert into wfh_request (employee_id, work_date, batch_id, reason) values ($1, $2, gen_random_uuid(), 'home')", [me.employeeId, day]);
    const mgr = await reports.getEmployeeHome(boss);
    expect(mgr.attention.map((a) => a.text)).toContain("1 attendance request is waiting for you.");
    const again = await reports.getEmployeeHome(me);
    expect(again.upcoming.map((u) => u.kind)).toContain("wfh");
  });
});
