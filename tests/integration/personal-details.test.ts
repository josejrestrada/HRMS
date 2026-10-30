// Runs only with RUN_DB_TESTS=yes (npm run test:db). PAN and Aadhaar storage against the real schema.
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

describe.skipIf(!enabled)("PAN and Aadhaar against the database", () => {
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

  it("stores the PAN encrypted, shows it masked, and never keeps more than 4 Aadhaar digits", async () => {
    const me = await person("TESTDB-P1");
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { pan: "abcde1234f", aadhaarLast4: "4321" });

    const shown = await data.getPersonalDetails(me, me.employeeId, tx());
    expect(shown).toMatchObject({ panMasked: "ABCDE••••F", aadhaarMasked: "XXXX XXXX 4321", aadhaarVerified: false });

    const raw = (await current!.query("select * from employee_private where employee_id = $1", [me.employeeId])).rows[0];
    expect(JSON.stringify(raw)).not.toContain("ABCDE1234F");
    expect(JSON.stringify(raw)).not.toContain("1234F");
    expect(raw.pan_cipher).toBeTruthy();
    expect(raw.aadhaar_last4).toBe("4321");
    await expect(current!.query("savepoint s; update employee_private set aadhaar_last4 = '12345678' where employee_id = $1", [me.employeeId])).rejects.toThrow();
  });

  it("lets only the person and HR see the masked values, and nobody else", async () => {
    const me = await person("TESTDB-P2");
    const other = await person("TESTDB-P3");
    const hr = await person("TESTDB-PH", ["employee", "hr_admin"]);
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { pan: "ABCDE1234F" });

    await expect(data.getPersonalDetails(other, me.employeeId, tx())).rejects.toThrow();
    await expect(data.savePersonalDetailsTx(tx(), other, me.employeeId, { pan: "ZZZZZ9999Z" })).rejects.toThrow();
    await expect(data.getPersonalDetails(null, me.employeeId, tx())).rejects.toThrow();
    expect((await data.getPersonalDetails(hr, me.employeeId, tx())).panMasked).toBe("ABCDE••••F");
  });

  it("refuses a PAN another employee already has, without saying who", async () => {
    const a = await person("TESTDB-P4");
    const b = await person("TESTDB-P5");
    await data.savePersonalDetailsTx(tx(), a, a.employeeId, { pan: "ABCDE1234F" });
    await expect(data.savePersonalDetailsTx(tx(), b, b.employeeId, { pan: "ABCDE1234F" })).rejects.toThrow("cannot be used");
  });

  it("lets only HR mark Aadhaar verified, and clears the flag when the digits change", async () => {
    const me = await person("TESTDB-P6");
    const hr = await person("TESTDB-PH2", ["employee", "hr_admin"]);
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { aadhaarLast4: "1111" });
    // An employee cannot verify their own number, even if they send the flag.
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { aadhaarLast4: "1111", aadhaarVerified: true });
    expect((await data.getPersonalDetails(me, me.employeeId, tx())).aadhaarVerified).toBe(false);

    await data.savePersonalDetailsTx(tx(), hr, me.employeeId, { aadhaarVerified: true });
    expect((await data.getPersonalDetails(hr, me.employeeId, tx())).aadhaarVerified).toBe(true);
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { aadhaarLast4: "2222" });
    expect((await data.getPersonalDetails(me, me.employeeId, tx())).aadhaarVerified).toBe(false);
  });

  it("keeps the stored PAN when only Aadhaar is saved, and audits changes without the values", async () => {
    const me = await person("TESTDB-P7");
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { pan: "ABCDE1234F" });
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { aadhaarLast4: "9999" });
    expect((await data.getPersonalDetails(me, me.employeeId, tx())).panMasked).toBe("ABCDE••••F");
    const audit = (await current!.query("select summary from audit_log where action = 'personal_details_saved' and entity_id = $1", [me.employeeId])).rows;
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toMatch(/ABCDE|1234|9999/);
  });

  it("reveals a PAN only to HR, audits it, and stops after 10 reveals in an hour", async () => {
    const me = await person("TESTDB-P8");
    const hr = await person("TESTDB-PH3", ["employee", "hr_admin"]);
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { pan: "ABCDE1234F" });

    await expect(data.revealPanTx(tx(), me, me.employeeId)).rejects.toThrow(); // not even the owner
    expect(await data.revealPanTx(tx(), hr, me.employeeId)).toBe("ABCDE1234F");
    const audit = (await current!.query("select summary from audit_log where action = 'pan_revealed' and actor_employee_id = $1", [hr.employeeId])).rows;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("ABCDE1234F");

    for (let i = 1; i < 10; i++) await data.revealPanTx(tx(), hr, me.employeeId);
    await expect(data.revealPanTx(tx(), hr, me.employeeId)).rejects.toThrow("too many");
  });

  it("refuses to reveal when there is no PAN, and the table cannot be deleted from", async () => {
    const me = await person("TESTDB-P9");
    const hr = await person("TESTDB-PH4", ["employee", "hr_admin"]);
    await expect(data.revealPanTx(tx(), hr, me.employeeId)).rejects.toThrow("No PAN");
    await data.savePersonalDetailsTx(tx(), me, me.employeeId, { aadhaarLast4: "1234" });
    await expect(current!.query("savepoint d; delete from employee_private where employee_id = $1", [me.employeeId])).rejects.toThrow();
  });
});
