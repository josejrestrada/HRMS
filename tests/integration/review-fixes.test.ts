// Runs only with RUN_DB_TESTS=yes (npm run test:db). Review findings 5, 6 and 7. Every test runs in a
// transaction that is ALWAYS rolled back (the concurrency test holds a lock on an existing row and never
// changes it).
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";
import { addDays, todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

const enabled = databaseTestsEnabled();

type Role = "employee" | "hr_admin";
type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: Role[] };

describe.skipIf(!enabled)("Review findings 5, 6 and 7 against the database", () => {
  let pool: Pool;
  let leave: typeof import("@/modules/leave/data");
  let employees: typeof import("@/modules/employees/data");
  let attendance: typeof import("@/modules/attendance/data");
  let ForbiddenError: typeof import("@/shared/roles").ForbiddenError;
  let pnj: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    leave = await import("@/modules/leave/data");
    employees = await import("@/modules/employees/data");
    attendance = await import("@/modules/attendance/data");
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
    opts: { gender?: string; roles?: Role[]; assignments?: { manager?: string; from: string; to?: string | null }[] } = {},
  ): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date, gender) values ($1, $2, $3, '2024-01-01', $4) returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`, opts.gender ?? null],
    );
    const id = r.rows[0].id as string;
    for (const a of opts.assignments ?? [{ from: "2024-01-01", to: null }]) {
      await c.query(
        "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from, effective_to) values ($1, $2, 'T', 'T', $3, 'permanent', $4, $5)",
        [id, pnj, a.manager ?? null, a.from, a.to ?? null],
      );
    }
    for (const role of opts.roles ?? []) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...(opts.roles ?? [])] };
  }

  const today = () => todayIST();
  function monday(weeksAhead: number) {
    let d = addDays(today(), weeksAhead * 7);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
    return d;
  }

  // ------------------------------------------------------------------ finding 5
  it("the database never lets a comp-off credit go below zero or above its original amount", async () => {
    await inTx(async (c) => {
      const me = await person(c, "TESTDB-E");
      const credit = (
        await c.query(
          "insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on) values ($1, $2, 2026, $3, 1, 'compoff_credit', $4) returning id::text as id",
          [me.employeeId, ids.COMPOFF, today(), addDays(today(), 60)],
        )
      ).rows[0].id as string;
      const use = (delta: number, reason = "application") =>
        c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, consumes_entry_id) values ($1, $2, 2026, $3, $4, $5, $6)", [
          me.employeeId, ids.COMPOFF, today(), delta, reason, credit,
        ]);
      const refuse = async (run: () => Promise<unknown>, pattern: RegExp) => {
        await c.query("savepoint s");
        await expect(run()).rejects.toThrow(pattern);
        await c.query("rollback to savepoint s");
      };

      await use(-0.5);
      await use(-0.5); // exactly used up
      await refuse(() => use(-0.5), /below zero/);
      await use(0.5, "cancellation"); // half a day comes back
      await refuse(() => use(1, "cancellation"), /exceed/); // more than the credit ever was
      await use(-0.5, "expiry"); // the rest expires
      await refuse(
        () => c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, consumes_entry_id) values ($1, $2, 2026, $3, -1, 'application', $4)", [me.employeeId, ids.COMPOFF, today(), 999999999]),
        /must point to a comp-off credit/,
      );
    });
  });

  it("two comp-off approvals for the same person are decided one after the other (the employee row is locked)", async () => {
    // An existing, committed employee whose row another session is holding. We never change it.
    const target = (await pool.query("select id from employee where status = 'active' order by employee_code limit 1")).rows[0].id as string;
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      // B is part-way through its own comp-off decision for the same person. "no key update" does not
      // collide with the foreign-key checks of A's fixture inserts, but it does collide with the app's lock.
      await b.query("select 1 from employee where id = $1 for no key update", [target]);

      const hr = await person(a, "TESTDB-HR", { roles: ["hr_admin"] });
      await a.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on) values ($1, $2, 2026, $3, 1, 'compoff_credit', $4)", [target, ids.COMPOFF, today(), addDays(today(), 60)]);
      const mon = monday(2);
      const req = (
        await a.query("insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, $3, 1, 'pending') returning id", [target, ids.COMPOFF, mon])
      ).rows[0].id as string;
      await a.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id) values ($1, $2, 2026, $3, -1, 'pending_hold', $4)", [target, ids.COMPOFF, today(), req]);

      let finished = false;
      const deciding = leave.decideLeaveTx(q(a), hr, { requestId: req, decision: "approve" }).then(() => {
        finished = true;
      });

      // Wait until a session is queued behind a row lock, seen from a third connection.
      const started = Date.now();
      let waiting = 0;
      while (Date.now() - started < 8000 && waiting === 0) {
        waiting = (await pool.query("select count(*)::int as n from pg_locks where not granted and locktype in ('transactionid', 'tuple')")).rows[0].n;
        if (waiting === 0) await new Promise((r) => setTimeout(r, 100));
      }
      expect(waiting).toBeGreaterThan(0);
      expect(finished).toBe(false);

      await b.query("rollback"); // the other decision is done
      await deciding;
      expect((await a.query("select status from leave_request where id = $1", [req])).rows[0].status).toBe("approved");
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      a.release();
      b.release();
    }
  });

  // ------------------------------------------------------------------ finding 6
  it("maternity leave is once for each delivery, but a different delivery is allowed", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const mum = await person(c, "TESTDB-F", { gender: "female", assignments: [{ manager: boss.employeeId, from: "2024-01-01" }] });
      const first = await leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 10), expectedDeliveryDate: addDays(today(), 60), survivingChildren: 0 });

      // Another request for the same delivery, even with other dates, is refused.
      await expect(
        leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 14), expectedDeliveryDate: addDays(today(), 70), survivingChildren: 0 }),
      ).rejects.toThrow(/once for each delivery/);

      // A delivery 190 days later is a different delivery, with a start date after the first leave ends.
      await leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 200), expectedDeliveryDate: addDays(today(), 250), survivingChildren: 1 });

      // A rejected request no longer counts: the first can be re-filed after a rejection.
      await leave.decideLeaveTx(tx, boss, { requestId: first.requestId, decision: "reject", note: "Wrong dates" });
      await leave.applyMaternityTx(tx, mum, { startDate: addDays(today(), 12), expectedDeliveryDate: addDays(today(), 62), survivingChildren: 0 });
    });
  });

  // ------------------------------------------------------------------ finding 7
  it("a manager entered for a future date cannot approve today, and a manager whose assignment has ended cannot either", async () => {
    await inTx(async (c, tx) => {
      const current = await person(c, "TESTDB-A"); // the manager today
      const future = await person(c, "TESTDB-B"); // entered ahead of time, starts tomorrow
      const former = await person(c, "TESTDB-C"); // manager until yesterday
      const t = today();
      const me = await person(c, "TESTDB-E", {
        assignments: [
          { manager: current.employeeId, from: "2024-01-01", to: t },
          { manager: future.employeeId, from: addDays(t, 1), to: null },
        ],
      });
      const other = await person(c, "TESTDB-O", {
        assignments: [
          { manager: former.employeeId, from: "2024-01-01", to: addDays(t, -1) },
          { manager: current.employeeId, from: t, to: null },
        ],
      });

      // Who counts as the manager today.
      expect(await employees.isCurrentManagerOf(tx, current.employeeId, me.employeeId)).toBe(true);
      expect(await employees.isCurrentManagerOf(tx, future.employeeId, me.employeeId)).toBe(false);
      expect(await employees.isCurrentManagerOf(tx, former.employeeId, other.employeeId)).toBe(false);
      expect(await employees.getDirectReportIds(current, tx)).toEqual(expect.arrayContaining([me.employeeId, other.employeeId]));
      expect(await employees.getDirectReportIds(future, tx)).not.toContain(me.employeeId);
      expect(await employees.getDirectReportIds(former, tx)).not.toContain(other.employeeId);

      // Leave: only the current manager can decide.
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason) values ($1, $2, 2026, $3, 5, 'grant')", [me.employeeId, ids.EL, today()]);
      const mon = monday(2);
      const applied = await leave.applyLeaveTx(tx, me, { leaveTypeId: ids.EL, startDate: mon, endDate: mon, dayPart: "full", convertShortfallToLop: false });
      await expect(leave.decideLeaveTx(tx, future, { requestId: applied.requestId, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(leave.decideLeaveTx(tx, former, { requestId: applied.requestId, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await leave.decideLeaveTx(tx, current, { requestId: applied.requestId, decision: "approve" });

      // Comp-off: the same.
      const comp = (
        await c.query("insert into compoff_request (employee_id, worked_date, days) values ($1, $2, 1) returning id", [me.employeeId, addDays(t, -3)])
      ).rows[0].id as string;
      await expect(leave.decideCompoffTx(tx, future, { requestId: comp, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await leave.decideCompoffTx(tx, current, { requestId: comp, decision: "approve" });

      // Attendance fixes: the approvals list and the decision both follow the current manager.
      const day = addDays(t, -2);
      await c.query("insert into regularization (employee_id, work_date, batch_id, in_time, out_time, reason) values ($1, $2, gen_random_uuid(), '09:30', '17:30', 'forgot')", [me.employeeId, day]);
      expect((await attendance.listRegularizationApprovals(future, tx)).map((r) => r.employeeCode)).not.toContain("TESTDB-E");
      expect((await attendance.listRegularizationApprovals(current, tx)).map((r) => r.employeeCode)).toContain("TESTDB-E");
      const fixId = (await c.query("select id::text as id from regularization where employee_id = $1", [me.employeeId])).rows[0].id as string;
      await expect(attendance.decideRegularizationsTx(tx, future, { requestIds: [fixId], decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await attendance.decideRegularizationsTx(tx, current, { requestIds: [fixId], decision: "approve" });
    });
  });
});
