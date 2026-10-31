// Runs only with RUN_DB_TESTS=yes (npm run test:db). bank and salary storage against the real schema.
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

describe.skipIf(!enabled)("Bank and salary against the database", () => {
  let pool: Pool;
  let data: typeof import("@/modules/employees/data");
  let pnj: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    data = await import("@/modules/employees/data");
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

  async function person(code: string, roles: ("employee" | "hr_admin")[] = ["employee"]) {
    const id = (
      await current!.query(
        "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
        [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
      )
    ).rows[0].id as string;
    await current!.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, employment_type, effective_from) values ($1, $2, 'T', 'T', 'permanent', '2024-01-01')",
      [id, pnj],
    );
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles };
  }
  const tx = () => ({ query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows });

  it("is HR only: an employee cannot read, save or reveal even their own", async () => {
    const me = await person("TESTDB-B1");
    await expect(data.getBankDetails(me, me.employeeId, tx())).rejects.toThrow();
    await expect(data.saveBankDetailsTx(tx(), me, me.employeeId, { account: "123456789012" })).rejects.toThrow();
    await expect(data.revealBankFieldTx(tx(), me, me.employeeId, "salary")).rejects.toThrow();
  });

  it("stores secrets encrypted, shows masks, reveals them with an audit entry that holds no value", async () => {
    const hr = await person("TESTDB-B2", ["employee", "hr_admin"]);
    const emp = await person("TESTDB-B3");
    await data.saveBankDetailsTx(tx(), hr, emp.employeeId, {
      accountHolder: "Test Holder", bankName: "Test Bank", ifsc: "SBIN0001234", account: "123456789012", uan: "100200300400", salary: "45000",
    });
    const raw = (await current!.query("select * from employee_bank where employee_id = $1", [emp.employeeId])).rows[0];
    expect(JSON.stringify(raw)).not.toContain("123456789012");
    expect(JSON.stringify(raw)).not.toContain("100200300400");
    expect(raw.salary_cipher).not.toContain("45000");

    const shown = await data.getBankDetails(hr, emp.employeeId, tx());
    expect(shown).toMatchObject({ accountMasked: "••••••••9012", uanMasked: "••••••••0400", hasSalary: true, ifsc: "SBIN0001234" });
    expect(await data.revealBankFieldTx(tx(), hr, emp.employeeId, "account")).toBe("123456789012");
    expect(await data.revealBankFieldTx(tx(), hr, emp.employeeId, "salary")).toBe("45000");

    const audit = (await current!.query("select action, summary from audit_log where entity = 'employee_bank' and entity_id = $1", [emp.employeeId])).rows;
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["bank_details_saved", "bank_account_revealed", "bank_salary_revealed"]));
    expect(JSON.stringify(audit)).not.toMatch(/123456789012|45000|100200300400/);
  });

  it("keeps stored values when a box is left empty, refuses empty saves, and limits reveals to 10 an hour", async () => {
    const hr = await person("TESTDB-B4", ["employee", "hr_admin"]);
    const emp = await person("TESTDB-B5");
    await data.saveBankDetailsTx(tx(), hr, emp.employeeId, { account: "123456789012", salary: "30000" });
    await data.saveBankDetailsTx(tx(), hr, emp.employeeId, { bankName: "Another Bank" });
    expect(await data.revealBankFieldTx(tx(), hr, emp.employeeId, "account")).toBe("123456789012");
    await expect(data.saveBankDetailsTx(tx(), hr, emp.employeeId, {})).rejects.toThrow();
    for (let i = 0; i < 9; i++) await data.revealBankFieldTx(tx(), hr, emp.employeeId, "salary");
    await expect(data.revealBankFieldTx(tx(), hr, emp.employeeId, "salary")).rejects.toThrow(/too many/);
  });

  it("cannot be deleted from", async () => {
    const hr = await person("TESTDB-B6", ["employee", "hr_admin"]);
    const emp = await person("TESTDB-B7");
    await data.saveBankDetailsTx(tx(), hr, emp.employeeId, { bankName: "Bank" });
    await expect(current!.query("savepoint d; delete from employee_bank where employee_id = $1", [emp.employeeId])).rejects.toThrow();
  });
});
