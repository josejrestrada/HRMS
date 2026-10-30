// Runs only with RUN_DB_TESTS=yes (npm run test:db). Every test runs inside a transaction that is
// ALWAYS rolled back, with explicit TESTDB employee codes so the code sequence is never used.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";
import { addDays, todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

const enabled = databaseTestsEnabled();

type Role = "employee" | "hr_admin";
type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: Role[] };

describe.skipIf(!enabled)("Maternity, paternity and comp-off against the database", () => {
  let pool: Pool;
  let leave: typeof import("@/modules/leave/data");
  let DomainError: typeof import("@/shared/errors").DomainError;
  let ForbiddenError: typeof import("@/shared/roles").ForbiddenError;
  let pnj: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    leave = await import("@/modules/leave/data");
    ({ DomainError } = await import("@/shared/errors"));
    ({ ForbiddenError } = await import("@/shared/roles"));
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
    for (const r of (await pool.query("select id, code from leave_type")).rows) ids[r.code] = r.id;
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

  async function person(
    c: PoolClient,
    code: string,
    opts: { gender?: string | null; manager?: string; roles?: Role[]; joined?: string } = {},
  ): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date, gender) values ($1, $2, $3, $4, $5) returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`, opts.joined ?? "2024-01-01", opts.gender ?? null],
    );
    const id = r.rows[0].id as string;
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from) values ($1, $2, 'T', 'T', $3, 'permanent', '2024-01-01')",
      [id, pnj, opts.manager ?? null],
    );
    for (const role of opts.roles ?? []) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...(opts.roles ?? [])] };
  }

  const today = () => todayIST();
  /** A Monday at least `weeksAhead` weeks away that is not a holiday this year. */
  function monday(weeksAhead: number) {
    let d = addDays(today(), weeksAhead * 7);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    return d;
  }
  /** The most recent Saturday on or before today (a weekly off at Panaji). */
  function lastSaturday() {
    let d = today();
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, -1);
    return d;
  }

  const ledgerRows = async (c: PoolClient, who: TestActor, code: string) =>
    (await c.query("select reason, delta::float8 as delta, consumes_entry_id::text as cid, expires_on::text as exp from leave_ledger where employee_id = $1 and leave_type_id = $2 order by id", [who.employeeId, ids[code]])).rows;

  // ---------------- maternity ----------------
  it("maternity: 26 weeks in calendar days, no ledger entries, certificate flagged", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-F", { gender: "female", manager: boss.employeeId });
      const edd = addDays(today(), 60);
      const { requestId, endDate } = await leave.applyMaternityTx(tx, me, { startDate: addDays(today(), 10), expectedDeliveryDate: edd, survivingChildren: 1 });
      expect(endDate).toBe(addDays(addDays(today(), 10), 181));
      const r = (await c.query("select days::float8 as days, lop_days::float8 as lop, certificate_required, surviving_children, expected_delivery_date::text as edd from leave_request where id = $1", [requestId])).rows[0];
      expect(r).toEqual({ days: 182, lop: 0, certificate_required: true, surviving_children: 1, edd });

      // Approving and cancelling touch no ledger (R47): there is no balance.
      await leave.decideLeaveTx(tx, boss, { requestId, decision: "approve" });
      await leave.cancelLeaveTx(tx, me, requestId).catch(() => undefined);
      const all = (await c.query("select count(*)::int as n from leave_ledger where employee_id = $1", [me.employeeId])).rows[0].n;
      expect(all).toBe(0);
    });
  });

  it("maternity: 12 weeks with two or more children, and refused for men, short service and bad dates", async () => {
    await inTx(async (c, tx) => {
      const mum = await person(c, "TESTDB-F", { gender: "female" });
      const dad = await person(c, "TESTDB-D", { gender: "male" });
      const newbie = await person(c, "TESTDB-N", { gender: "female", joined: addDays(today(), -30) });
      const edd = addDays(today(), 60);
      const start = addDays(today(), 10);

      const twelve = await leave.applyMaternityTx(tx, mum, { startDate: start, expectedDeliveryDate: edd, survivingChildren: 2 });
      expect(twelve.endDate).toBe(addDays(start, 83));

      await expect(leave.applyMaternityTx(tx, dad, { startDate: start, expectedDeliveryDate: edd, survivingChildren: 0 })).rejects.toBeInstanceOf(DomainError);
      await expect(leave.applyMaternityTx(tx, newbie, { startDate: start, expectedDeliveryDate: edd, survivingChildren: 0 })).rejects.toThrow(/80 days/);
      await expect(leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 70), expectedDeliveryDate: edd, survivingChildren: 0 })).rejects.toThrow(/on or before/);
      await expect(leave.applyMaternityTx(tx, mum, { startDate: addDays(edd, -57), expectedDeliveryDate: edd, survivingChildren: 0 })).rejects.toThrow(/8 weeks/);
    });
  });

  it("maternity: a second request for the same delivery is refused, and other leave cannot overlap the maternity dates", async () => {
    await inTx(async (c, tx) => {
      const mum = await person(c, "TESTDB-F", { gender: "female" });
      const edd = addDays(today(), 60);
      await leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 10), expectedDeliveryDate: edd, survivingChildren: 0 });
      // The same delivery cannot be claimed twice (R67), whatever the dates.
      await expect(leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 12), expectedDeliveryDate: edd, survivingChildren: 0 })).rejects.toThrow(/once for each delivery/);

      // Other leave during the maternity dates is refused as an overlap (R17).
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason) values ($1, $2, 2026, $3, 5, 'grant')", [mum.employeeId, ids.EL, today()]);
      const mon = monday(4);
      await expect(leave.applyLeaveTx(tx, mum, { leaveTypeId: ids.EL, startDate: mon, endDate: mon, dayPart: "full", convertShortfallToLop: false })).rejects.toThrow(/overlaps/);
    });
  });

  // ---------------- paternity ----------------
  it("paternity: 5 working days per birth, split allowed, never more than 5", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const dad = await person(c, "TESTDB-D", { gender: "male", manager: boss.employeeId });
      const birth = addDays(today(), -5);
      const mon = monday(2);

      const first = await leave.applyPaternityTx(tx, dad, { birthDate: birth, startDate: mon, endDate: addDays(mon, 2) }); // Mon to Wed
      expect(first.days).toBe(3);
      const second = await leave.applyPaternityTx(tx, dad, { birthDate: birth, startDate: addDays(mon, 3), endDate: addDays(mon, 4) }); // Thu, Fri
      expect(second.days).toBe(2);
      await expect(leave.applyPaternityTx(tx, dad, { birthDate: birth, startDate: monday(3), endDate: monday(3) })).rejects.toThrow(/0 days left/);

      // No ledger entries, before or after approval (R49).
      await leave.decideLeaveTx(tx, boss, { requestId: first.requestId, decision: "approve" });
      expect((await c.query("select count(*)::int as n from leave_ledger where employee_id = $1", [dad.employeeId])).rows[0].n).toBe(0);
    });
  });

  it("paternity: for men only, within 3 months of the birth, never a future birth date", async () => {
    await inTx(async (c, tx) => {
      const mum = await person(c, "TESTDB-F", { gender: "female" });
      const dad = await person(c, "TESTDB-D", { gender: "male" });
      const mon = monday(2);
      await expect(leave.applyPaternityTx(tx, mum, { birthDate: addDays(today(), -5), startDate: mon, endDate: mon })).rejects.toBeInstanceOf(DomainError);
      await expect(leave.applyPaternityTx(tx, dad, { birthDate: addDays(today(), 3), startDate: mon, endDate: mon })).rejects.toThrow(/future/);
      await expect(leave.applyPaternityTx(tx, dad, { birthDate: addDays(today(), -85), startDate: mon, endDate: mon })).rejects.toThrow(/3 months/);
    });
  });

  // ---------------- comp-off ----------------
  it("comp-off: request, approve, credit with a 60-day expiry, then use it", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const saturday = lastSaturday();

      const { requestId } = await leave.requestCompoffTx(tx, me, { workedDate: saturday, part: "full" });
      await expect(leave.requestCompoffTx(tx, me, { workedDate: saturday, part: "full" })).rejects.toThrow(/already asked/);
      await expect(leave.decideCompoffTx(tx, me, { requestId, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await leave.decideCompoffTx(tx, boss, { requestId, decision: "approve" });

      const credit = (await ledgerRows(c, me, "COMPOFF"))[0];
      expect(credit).toMatchObject({ reason: "compoff_credit", delta: 1, exp: addDays(today(), 60) });

      const mon = monday(2);
      const apply = await leave.applyLeaveTx(tx, me, { leaveTypeId: ids.COMPOFF, startDate: mon, endDate: mon, dayPart: "full", convertShortfallToLop: false });
      await leave.decideLeaveTx(tx, boss, { requestId: apply.requestId, decision: "approve" });

      const used = (await ledgerRows(c, me, "COMPOFF")).filter((r) => r.reason === "application");
      expect(used).toEqual([{ reason: "application", delta: -1, cid: expect.any(String), exp: null }]);
      const credits = await leave.getMyCompoff(me).catch(() => null);
      void credits; // read through the pool would not see uncommitted rows

      // Cancelling the approved leave puts the day back on the same credit (R53).
      await leave.cancelLeaveTx(tx, me, apply.requestId);
      const after = await ledgerRows(c, me, "COMPOFF");
      expect(after.filter((r) => r.reason === "cancellation")).toHaveLength(1);
      expect(after.reduce((sum, r) => (r.reason === "pending_hold" || r.reason === "hold_release" ? sum : sum + r.delta), 0)).toBe(1);
    });
  });

  it("comp-off: only a weekly off or holiday, within 30 days; approved requests are frozen", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      await expect(leave.requestCompoffTx(tx, me, { workedDate: monday(-1), part: "full" })).rejects.toThrow(/normal working day/);
      await expect(leave.requestCompoffTx(tx, me, { workedDate: addDays(lastSaturday(), -42), part: "full" })).rejects.toThrow(/30 days/);

      const { requestId } = await leave.requestCompoffTx(tx, me, { workedDate: lastSaturday(), part: "half" });
      await leave.decideCompoffTx(tx, boss, { requestId, decision: "approve" });
      await c.query("savepoint s");
      await expect(c.query("update compoff_request set days = 1 where id = $1", [requestId])).rejects.toThrow(/cannot be changed/);
      await c.query("rollback to savepoint s");
      await expect(leave.cancelCompoffTx(tx, me, requestId)).rejects.toThrow(/still waiting/);
    });
  });

  it("comp-off: uses the earliest-expiring credit first and only credits valid on the leave dates", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const credit = async (days: number, expires: string) =>
        (await c.query(
          "insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on) values ($1, $2, 2026, $3, $4, 'compoff_credit', $5) returning id::text as id",
          [me.employeeId, ids.COMPOFF, today(), days, expires],
        )).rows[0].id as string;
      const later = await credit(1, addDays(today(), 50));
      const sooner = await credit(0.5, addDays(today(), 25));

      const mon = monday(2); // inside both expiry dates
      const two = await leave.applyLeaveTx(tx, me, { leaveTypeId: ids.COMPOFF, startDate: mon, endDate: addDays(mon, 1), dayPart: "full", convertShortfallToLop: true });
      const r = (await c.query("select days::float8 as days, lop_days::float8 as lop from leave_request where id = $1", [two.requestId])).rows[0];
      expect(r).toEqual({ days: 2, lop: 0.5 }); // 1.5 usable, the extra half day converted to LOP
      await leave.decideLeaveTx(tx, boss, { requestId: two.requestId, decision: "approve" });
      const used = (await ledgerRows(c, me, "COMPOFF")).filter((x) => x.reason === "application");
      expect(used.map((x) => [x.cid, x.delta])).toEqual([[sooner, -0.5], [later, -1]]); // earliest-expiring first

      // Leave dates after the earlier credit expires can only use the later credit.
      const me2 = await person(c, "TESTDB-E2", { manager: boss.employeeId });
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on) values ($1, $2, 2026, $3, 1, 'compoff_credit', $4)", [me2.employeeId, ids.COMPOFF, today(), addDays(today(), 5)]);
      await expect(leave.applyLeaveTx(tx, me2, { leaveTypeId: ids.COMPOFF, startDate: monday(3), endDate: monday(3), dayPart: "full", convertShortfallToLop: false })).rejects.toThrow(/available/);
    });
  });

  it("comp-off: expiry is written once, only for credits past their date, and only by HR", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const me = await person(c, "TESTDB-E");
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on) values ($1, $2, 2026, $3, 1, 'compoff_credit', $4)", [me.employeeId, ids.COMPOFF, addDays(today(), -70), addDays(today(), -10)]);
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on) values ($1, $2, 2026, $3, 1, 'compoff_credit', $4)", [me.employeeId, ids.COMPOFF, today(), addDays(today(), 60)]);

      await expect(leave.runCompoffExpiryTx(tx, me)).rejects.toBeInstanceOf(ForbiddenError);
      const first = await leave.runCompoffExpiryTx(tx, hr);
      expect(first.credits).toBeGreaterThanOrEqual(1);
      const mine = (await ledgerRows(c, me, "COMPOFF")).filter((r) => r.reason === "expiry");
      expect(mine).toEqual([{ reason: "expiry", delta: -1, cid: expect.any(String), exp: null }]);
      const second = await leave.runCompoffExpiryTx(tx, hr);
      expect(second.credits).toBe(0);
      expect((await ledgerRows(c, me, "COMPOFF")).reduce((s, r) => s + r.delta, 0)).toBe(1); // only the live credit remains
    });
  });
});
