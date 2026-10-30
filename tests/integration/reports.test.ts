// Runs only with RUN_DB_TESTS=yes (npm run test:db). The HR reports against the real schema.
// The shared query helper is pointed at one open transaction which is ALWAYS rolled back.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";
import { todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

let current: PoolClient | null = null;
vi.mock("@/shared/db", () => ({
  query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows }),
}));

const enabled = databaseTestsEnabled();

describe.skipIf(!enabled)("HR reports against the database", () => {
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

  async function person(code: string) {
    const id = (
      await current!.query(
        "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
        [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
      )
    ).rows[0].id as string;
    await current!.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, employment_type, effective_from) values ($1, $2, 'Reports dept', 'T', 'contract', '2024-01-01')",
      [id, pnj],
    );
    return id;
  }
  const hr = (employeeId: string) => ({ employeeId, employeeCode: "TESTDB-RH", fullName: "DB HR", roles: ["employee", "hr_admin"] as ("employee" | "hr_admin")[] });

  it("refuses everyone who is not HR, for every report and for the download", async () => {
    const id = await person("TESTDB-RE");
    const employee = { employeeId: id, employeeCode: "TESTDB-RE", fullName: "DB E", roles: ["employee"] as "employee"[] };
    for (const kind of reports.REPORT_KINDS) await expect(reports.buildReport(employee, kind)).rejects.toThrow();
    await expect(reports.exportReportCsv(employee, "headcount")).rejects.toThrow();
    await expect(reports.buildReport(null, "headcount")).rejects.toThrow();
  });

  it("lists the new person in headcount and leave balances, and rejects an unknown report", async () => {
    const id = await person("TESTDB-RA");
    const actor = hr(id);

    const headcount = await reports.buildReport(actor, "headcount");
    const row = headcount.rows.find((r) => r[0] === "TESTDB-RA");
    expect(row).toEqual(["TESTDB-RA", "DB TESTDB-RA", "Reports dept", expect.any(String), "Contract", "2024-01-01"]);

    const bal = await reports.buildReport(actor, "leave-balances");
    expect(bal.rows.find((r) => r[0] === "TESTDB-RA")).toEqual(["TESTDB-RA", "DB TESTDB-RA", "Reports dept", expect.any(Number), expect.any(Number), expect.any(Number)]);

    await expect(reports.buildReport(actor, "salaries")).rejects.toThrow("Choose a report");
  });

  it("summarises a month, counts only employed days, and writes an audit entry on export", async () => {
    const id = await person("TESTDB-RM");
    const actor = hr(id);
    const today = todayIST();
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));

    const summary = await reports.buildReport(actor, "attendance-summary", { year, month });
    const r = summary.rows.find((x) => x[0] === "TESTDB-RM")!;
    expect(r).toBeTruthy();
    const counted = (r.slice(4) as number[]).filter((_, i) => i !== 7).reduce((a, b) => a + b, 0);
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThanOrEqual(31);

    // Before the person joined nothing is counted (R61).
    const before = await reports.buildReport(actor, "attendance-summary", { year: 2023, month: 6 });
    expect(before.rows.find((x) => x[0] === "TESTDB-RM")).toBeUndefined();

    await expect(reports.buildReport(actor, "attendance-summary", { year: 2026, month: 13 })).rejects.toThrow("valid month");

    const { csv, filename } = await reports.exportReportCsv(actor, "headcount");
    expect(filename).toMatch(/^headcount-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.startsWith('"Employee code"')).toBe(true);
    const audit = await current!.query("select summary from audit_log where action = 'report.download' and actor_employee_id = $1", [id]);
    expect(audit.rows).toHaveLength(1);
  });
});
