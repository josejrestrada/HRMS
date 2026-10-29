// Runs only with RUN_DB_TESTS=yes (npm run test:db). Every test runs inside a transaction that is
// ALWAYS rolled back, with explicit TESTDB employee codes so the code sequence is never used.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DB_TESTS === "yes" && !!process.env.DATABASE_URL;

type Role = "employee" | "hr_admin";
type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: Role[] };

describe.skipIf(!enabled)("Leave rules against the database", () => {
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

  async function person(c: PoolClient, code: string, opts: { manager?: string; roles?: Role[]; joined?: string } = {}): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, $4) returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`, opts.joined ?? "2024-01-01"],
    );
    const id = r.rows[0].id as string;
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from) values ($1, $2, 'T', 'T', $3, 'permanent', $4)",
      [id, pnj, opts.manager ?? null, opts.joined ?? "2024-01-01"],
    );
    const roles: Role[] = ["employee", ...(opts.roles ?? [])];
    for (const role of opts.roles ?? []) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles };
  }

  async function credit(c: PoolClient, who: TestActor, code: string, delta: number, reason = "grant") {
    await c.query(
      "insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason) values ($1, $2, 2026, '2026-01-01', $3, $4)",
      [who.employeeId, ids[code], delta, reason],
    );
  }

  /** A Monday at least two weeks away, so the dates are always valid whenever the test runs. */
  function monday(weeksAhead = 3) {
    let d = addDays(todayIST(), weeksAhead * 7);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    return d;
  }

  const apply = (code: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
    leaveTypeId: ids[code],
    startDate: start,
    endDate: end,
    dayPart: "full" as const,
    convertShortfallToLop: false,
    ...extra,
  });

  const bal = async (tx: ReturnType<typeof q>, who: TestActor, code: string) => {
    const rows = await tx.query(
      `select coalesce(sum(delta) filter (where reason not in ('pending_hold','hold_release')),0)::float8 as balance,
              coalesce(-sum(delta) filter (where reason in ('pending_hold','hold_release')),0)::float8 as held
         from leave_ledger where employee_id = $1 and leave_type_id = $2`,
      [who.employeeId, ids[code]],
    );
    return rows[0] as { balance: number; held: number };
  };

  it("applying holds the days and skips weekly offs", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      await credit(c, me, "EL", 10);
      const mon = monday();
      // Friday before to Monday: Fri + Mon are working days, Sat and Sun are not
      const { requestId } = await leave.applyLeaveTx(tx, me, apply("EL", addDays(mon, -3), mon));
      const r = (await c.query("select days::float8 as days, status, lop_days::float8 as lop from leave_request where id = $1", [requestId])).rows[0];
      expect(r).toEqual({ days: 2, status: "pending", lop: 0 });
      expect(await bal(tx, me, "EL")).toEqual({ balance: 10, held: 2 });
    });
  });

  it("refuses overlapping requests", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await credit(c, me, "EL", 10);
      const mon = monday();
      await leave.applyLeaveTx(tx, me, apply("EL", mon, addDays(mon, 1)));
      await expect(leave.applyLeaveTx(tx, me, apply("EL", addDays(mon, 1), addDays(mon, 2)))).rejects.toThrow(/overlaps/);
    });
  });

  it("refuses a shortfall unless converted, then holds only what is available", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await credit(c, me, "EL", 1.5);
      const mon = monday();
      const end = addDays(mon, 3); // Mon to Thu = 4 days
      await expect(leave.applyLeaveTx(tx, me, apply("EL", mon, end))).rejects.toBeInstanceOf(DomainError);
      const { requestId } = await leave.applyLeaveTx(tx, me, apply("EL", mon, end, { convertShortfallToLop: true }));
      const r = (await c.query("select days::float8 as days, lop_days::float8 as lop from leave_request where id = $1", [requestId])).rows[0];
      expect(r).toEqual({ days: 4, lop: 2.5 });
      expect(await bal(tx, me, "EL")).toEqual({ balance: 1.5, held: 1.5 });
    });
  });

  it("limits casual leave to 3 days in a row", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await credit(c, me, "CL", 8);
      const mon = monday();
      await expect(leave.applyLeaveTx(tx, me, apply("CL", mon, addDays(mon, 3)))).rejects.toThrow(/at most 3 days/);
    });
  });

  it("approving by the manager turns the hold into a debit", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      await credit(c, me, "EL", 10);
      const mon = monday();
      const { requestId } = await leave.applyLeaveTx(tx, me, apply("EL", mon, addDays(mon, 1)));
      await leave.decideLeaveTx(tx, boss, { requestId, decision: "approve" });
      expect(await bal(tx, me, "EL")).toEqual({ balance: 8, held: 0 });
      const r = (await c.query("select status, approver_id from leave_request where id = $1", [requestId])).rows[0];
      expect(r).toEqual({ status: "approved", approver_id: boss.employeeId });
      await expect(leave.decideLeaveTx(tx, boss, { requestId, decision: "approve" })).rejects.toThrow(/already been decided/);
    });
  });

  it("does not let people decide their own request or someone else's", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const stranger = await person(c, "TESTDB-S");
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      await credit(c, me, "EL", 10);
      await credit(c, hr, "EL", 10);
      const mon = monday();
      const mine = await leave.applyLeaveTx(tx, me, apply("EL", mon, mon));
      await expect(leave.decideLeaveTx(tx, me, { requestId: mine.requestId, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(leave.decideLeaveTx(tx, stranger, { requestId: mine.requestId, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      // An HR admin cannot approve their own request either, but can approve someone else's.
      const hrOwn = await leave.applyLeaveTx(tx, hr, apply("EL", mon, mon));
      await expect(leave.decideLeaveTx(tx, hr, { requestId: hrOwn.requestId, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await leave.decideLeaveTx(tx, hr, { requestId: mine.requestId, decision: "approve" });
    });
  });

  it("rejecting releases the hold", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      await credit(c, me, "EL", 5);
      const mon = monday();
      const { requestId } = await leave.applyLeaveTx(tx, me, apply("EL", mon, mon));
      await leave.decideLeaveTx(tx, boss, { requestId, decision: "reject", note: "Busy week" });
      expect(await bal(tx, me, "EL")).toEqual({ balance: 5, held: 0 });
    });
  });

  it("cancelling releases a pending hold or credits back approved leave, and only HR cancels started leave", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      await credit(c, me, "EL", 5);
      const mon = monday();

      const pending = await leave.applyLeaveTx(tx, me, apply("EL", mon, mon));
      await leave.cancelLeaveTx(tx, me, pending.requestId);
      expect(await bal(tx, me, "EL")).toEqual({ balance: 5, held: 0 });

      const approved = await leave.applyLeaveTx(tx, me, apply("EL", mon, mon));
      await leave.decideLeaveTx(tx, boss, { requestId: approved.requestId, decision: "approve" });
      expect((await bal(tx, me, "EL")).balance).toBe(4);
      await leave.cancelLeaveTx(tx, me, approved.requestId);
      expect(await bal(tx, me, "EL")).toEqual({ balance: 5, held: 0 });

      // Leave that already started: pretend this approved request began yesterday.
      const started = await c.query(
        "insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, $3, 1, 'approved') returning id",
        [me.employeeId, ids.EL, addDays(todayIST(), -1)],
      );
      await expect(leave.cancelLeaveTx(tx, me, started.rows[0].id)).rejects.toThrow(/only be cancelled by HR/);
      await leave.cancelLeaveTx(tx, hr, started.rows[0].id);
    });
  });

  it("protects approved leave and the ledger in the database", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      await credit(c, me, "EL", 5);
      const { requestId } = await leave.applyLeaveTx(tx, me, apply("EL", monday(), monday()));
      await leave.decideLeaveTx(tx, boss, { requestId, decision: "approve" });

      const attempt = async (sql: string, params: unknown[], pattern: RegExp) => {
        await c.query("savepoint s");
        await expect(c.query(sql, params)).rejects.toThrow(pattern);
        await c.query("rollback to savepoint s");
      };
      await attempt("update leave_request set days = 5 where id = $1", [requestId], /cannot be edited/);
      await attempt("delete from leave_request where id = $1", [requestId], /cannot be deleted/);
      await attempt("update leave_ledger set delta = 99 where employee_id = $1", [me.employeeId], /append-only/);
      await attempt("delete from leave_ledger where employee_id = $1", [me.employeeId], /append-only/);
      await attempt("truncate leave_ledger", [], /cannot be truncated|cannot truncate/);
    });
  });

  it("only active employees can apply", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await credit(c, me, "EL", 5);
      await c.query("update employee set status = 'inactive' where id = $1", [me.employeeId]);
      await expect(leave.applyLeaveTx(tx, me, apply("EL", monday(), monday()))).rejects.toThrow(/active employees/);
    });
  });

  it("running credits grants CL and SL with the legal floor and is safe to run twice", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const old = await person(c, "TESTDB-OLD", { joined: "2020-01-01" });
      const late = await person(c, "TESTDB-LATE", { joined: `${todayIST().slice(0, 4)}-10-20` });

      const first = await leave.runLeaveCreditsTx(tx, hr);
      expect(first.grants).toBeGreaterThan(0);
      const second = await leave.runLeaveCreditsTx(tx, hr);
      expect(second).toMatchObject({ grants: 0, accruals: 0 });

      const grant = async (who: TestActor, code: string) =>
        Number((await c.query("select coalesce(sum(delta),0)::float8 as s from leave_ledger where employee_id = $1 and leave_type_id = $2 and reason = 'grant'", [who.employeeId, ids[code]])).rows[0].s);
      expect(await grant(old, "CL")).toBe(8);
      expect(await grant(old, "SL")).toBe(9);
      expect(await grant(late, "SL")).toBe(9); // never below the statutory 9
      expect(await grant(late, "CL")).toBe(6); // pro-rated amount is below the statutory floor of 6
      const el = Number((await c.query("select coalesce(sum(delta),0)::float8 as s from leave_ledger where employee_id = $1 and leave_type_id = $2 and reason = 'accrual'", [old.employeeId, ids.EL])).rows[0].s);
      expect(el).toBeGreaterThan(0);
      expect(el % 1.5).toBe(0);
    });
  });

  it("only an HR admin can run credits", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await expect(leave.runLeaveCreditsTx(tx, me)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("year-end lapses CL and SL, carries EL up to 45 and encashes the rest, leaving held days alone", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const me = await person(c, "TESTDB-E");
      await credit(c, me, "CL", 5);
      await credit(c, me, "SL", 3);
      await credit(c, me, "EL", 50);
      // A pending request holds 2 EL days: those days are not lapsed or encashed (R38).
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason) values ($1, $2, 2025, '2025-12-01', -2, 'pending_hold')", [me.employeeId, ids.EL]);

      const run = await leave.runYearEndTx(tx, hr, { year: 2025 });
      expect(run.applied).toBe(true);

      expect(await bal(tx, me, "CL")).toEqual({ balance: 0, held: 0 });
      expect(await bal(tx, me, "SL")).toEqual({ balance: 0, held: 0 });
      // EL: balance 50, held 2 -> available 48 -> carry 45, encash 3 -> balance 47, hold untouched
      expect(await bal(tx, me, "EL")).toEqual({ balance: 47, held: 2 });

      const reasons = (await c.query("select reason, delta::float8 as delta, leave_year from leave_ledger where employee_id = $1 and leave_type_id = $2 and ref_key like 'yearend:%' order by ref_key", [me.employeeId, ids.EL])).rows;
      expect(reasons).toEqual([
        { reason: "carry_forward", delta: 45, leave_year: 2026 }, // cf-in
        { reason: "carry_forward", delta: -45, leave_year: 2025 }, // cf-out
        { reason: "encashment", delta: -3, leave_year: 2025 },
      ]);
    });
  });

  it("year-end is safe to run twice and adds nothing the second time", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const me = await person(c, "TESTDB-E");
      await credit(c, me, "CL", 4);
      await leave.runYearEndTx(tx, hr, { year: 2025 });
      const second = await leave.runYearEndTx(tx, hr, { year: 2025 });
      expect(second.lines).toEqual([]);
      expect(await bal(tx, me, "CL")).toEqual({ balance: 0, held: 0 });
    });
  });

  it("year-end cannot be run early for the current year", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const year = Number(todayIST().slice(0, 4));
      if (todayIST() < `${year}-12-31`) {
        await expect(leave.runYearEndTx(tx, hr, { year })).rejects.toThrow(/from 31 December/);
      }
      await expect(leave.runYearEndTx(tx, hr, { year: year + 1 })).rejects.toBeInstanceOf(DomainError);
    });
  });

  // ---- read-only ----
  it("reads the overview and approvals for a real HR admin without errors", async () => {
    const hrRow = (await pool.query("select e.id, e.employee_code, e.full_name from employee e join employee_role r on r.employee_id = e.id where r.role = 'hr_admin' and e.status = 'active' limit 1")).rows[0];
    if (!hrRow) return;
    const hr: TestActor = { employeeId: hrRow.id, employeeCode: hrRow.employee_code, fullName: hrRow.full_name, roles: ["employee", "hr_admin"] };
    const overview = await leave.getLeaveOverview(hr);
    expect(overview.balances.map((b) => b.code)).toEqual(["CL", "SL", "EL"]);
    expect(await leave.getApplyContext(hr)).not.toBeUndefined();
    expect(Array.isArray(await leave.listApprovals(hr))).toBe(true);
    expect((await leave.getApprovalScope(hr)).canApprove).toBe(true);
    expect(await leave.getStatement(hr, "NOPE")).toBeNull();
  });
});
