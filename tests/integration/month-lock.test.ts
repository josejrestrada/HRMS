// Runs only with RUN_DB_TESTS=yes (npm run test:db). Every test runs inside a transaction that is
// ALWAYS rolled back, so locking a month here never leaves a lock behind.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";
import { addDays, todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

const enabled = databaseTestsEnabled();

type Role = "employee" | "hr_admin";
type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: Role[] };

// A month that is long finished: March 2025.
const Y = 2025;
const M = 3;
const D = (day: number) => `2025-03-${String(day).padStart(2, "0")}`;

describe.skipIf(!enabled)("Month lock against the database", () => {
  let pool: Pool;
  let attendance: typeof import("@/modules/attendance/data");
  let leave: typeof import("@/modules/leave/data");
  let DomainError: typeof import("@/shared/errors").DomainError;
  let ForbiddenError: typeof import("@/shared/roles").ForbiddenError;
  let pnj: string;
  let clId: string;
  let lopId: string;
  let elId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    attendance = await import("@/modules/attendance/data");
    leave = await import("@/modules/leave/data");
    ({ DomainError } = await import("@/shared/errors"));
    ({ ForbiddenError } = await import("@/shared/roles"));
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
    clId = (await pool.query("select id from leave_type where code = 'CL'")).rows[0].id;
    lopId = (await pool.query("select id from leave_type where code = 'LOP'")).rows[0].id;
    elId = (await pool.query("select id from leave_type where code = 'EL'")).rows[0].id;
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
    opts: { joined?: string; exit?: string; manager?: string; roles?: Role[] } = {},
  ): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date, exit_date, status) values ($1, $2, $3, $4, $5, $6) returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`, opts.joined ?? "2024-01-01", opts.exit ?? null, opts.exit ? "inactive" : "active"],
    );
    const id = r.rows[0].id as string;
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from, effective_to) values ($1, $2, 'T', 'T', $3, 'permanent', $4, $5)",
      [id, pnj, opts.manager ?? null, opts.joined ?? "2024-01-01", opts.exit ?? null],
    );
    for (const role of opts.roles ?? []) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...(opts.roles ?? [])] };
  }

  const punch = (c: PoolClient, who: TestActor, date: string, time: string, direction: "in" | "out") =>
    c.query("insert into punch (employee_id, punched_at, direction) values ($1, $2::timestamptz, $3)", [who.employeeId, `${date}T${time}:00+05:30`, direction]);

  const frozen = async (c: PoolClient, who: TestActor) =>
    Object.fromEntries(
      (await c.query("select work_date::text as d, status, note, late, locked from attendance_day where employee_id = $1", [who.employeeId])).rows.map((r) => [r.d, r]),
    );

  it("locks a finished month: freezes every day, turns unfixed days into unpaid, and skips days outside employment", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const worker = await person(c, "TESTDB-E");
      const joiner = await person(c, "TESTDB-J", { joined: D(17) });
      const leaver = await person(c, "TESTDB-L", { exit: D(10) });

      await punch(c, worker, D(3), "09:20", "in"); // Mon 3 Mar 2025
      await punch(c, worker, D(3), "17:40", "out"); // present
      await punch(c, worker, D(4), "10:30", "in"); // missed check-out, and late
      // D(5) (Wed) has no punches at all

      const preview = await attendance.previewMonthLock(hr, Y, M, tx);
      expect(preview.canLock).toBe(true);
      expect(preview.unpaidDays).toBeGreaterThanOrEqual(2);
      expect(preview.unpaidPeople.find((p) => p.code === "TESTDB-E")?.days).toBeGreaterThanOrEqual(2);

      const result = await attendance.lockMonthTx(tx, hr, { year: Y, month: M });
      expect(result.employees).toBeGreaterThanOrEqual(4);

      const w = await frozen(c, worker);
      expect(w[D(3)]).toMatchObject({ status: "present", locked: true, late: false });
      expect(w[D(4)]).toMatchObject({ status: "absent", locked: true, late: true });
      expect(w[D(4)].note).toContain("not fixed in time");
      expect(w[D(5)]).toMatchObject({ status: "absent" });
      expect(w[D(8)].status).toBe("weekly_off"); // Saturday
      expect(Object.keys(w)).toHaveLength(31);

      // The joiner only has days from the 17th; the leaver only up to the 10th (R61).
      const j = await frozen(c, joiner);
      expect(Object.keys(j).sort()[0]).toBe(D(17));
      expect(Object.keys(j)).toHaveLength(15);
      const l = await frozen(c, leaver);
      expect(Object.keys(l).sort().pop()).toBe(D(10));
      expect(Object.keys(l)).toHaveLength(10);

      const period = (await c.query("select year, month, locked_by::text as by from attendance_period where year = $1 and month = $2", [Y, M])).rows;
      expect(period).toEqual([{ year: Y, month: M, by: hr.employeeId }]);
    });
  });

  it("stores how much of each day is unpaid: absent days, leave without pay, and the converted shortfall of a leave request", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const me = await person(c, "TESTDB-E");
      const leaveRow = (type: string, start: string, end: string, days: number, lop: number, part = "full") =>
        c.query(
          "insert into leave_request (employee_id, leave_type_id, start_date, end_date, day_part, days, lop_days, status) values ($1, $2, $3, $4, $5, $6, $7, 'approved')",
          [me.employeeId, type, start, end, part, days, lop],
        );
      await punch(c, me, D(3), "09:20", "in");
      await punch(c, me, D(3), "17:40", "out"); // Mon 3 Mar: present, paid
      await leaveRow(lopId, D(11), D(13), 3, 3); // Tue to Thu: leave without pay, 3 days
      await leaveRow(elId, D(17), D(21), 5, 2.5); // Mon to Fri: 5 days, the last 2.5 unpaid
      await leaveRow(lopId, D(25), D(25), 0.5, 0.5, "second_half"); // Tue 25 Mar: half a day without pay

      const unpaid = async () =>
        Object.fromEntries((await c.query("select work_date::text as d, status, unpaid_days::float8 as u from attendance_day where employee_id = $1", [me.employeeId])).rows.map((r) => [r.d, r]));
      const preview = await attendance.previewMonthLock(hr, Y, M, tx);
      await attendance.lockMonthTx(tx, hr, { year: Y, month: M });
      const days = await unpaid();

      expect(days[D(3)]).toMatchObject({ status: "present", u: 0 });
      for (const d of [11, 12, 13]) expect(days[D(d)]).toMatchObject({ status: "leave", u: 1 });
      expect(days[D(17)]).toMatchObject({ status: "leave", u: 0 }); // paid days come first
      expect(days[D(18)]).toMatchObject({ status: "leave", u: 0 });
      expect(days[D(19)]).toMatchObject({ status: "leave", u: 0.5 });
      expect(days[D(20)]).toMatchObject({ status: "leave", u: 1 });
      expect(days[D(21)]).toMatchObject({ status: "leave", u: 1 });
      expect(days[D(25)]).toMatchObject({ status: "half_day", u: 0.5 });
      expect(days[D(8)]).toMatchObject({ status: "weekly_off", u: 0 }); // Saturday
      expect(days[D(4)]).toMatchObject({ status: "absent", u: 1 }); // a working day, nothing recorded

      // The preview said the same as what was stored, for this person.
      const stored = Object.values(days).reduce((sum: number, r: any) => sum + r.u, 0);
      expect(preview.unpaidPeople.find((p) => p.code === "TESTDB-E")?.days).toBeCloseTo(stored, 5);
      // 3 (LOP) + 2.5 (shortfall) + 0.5 (half day) + the plain absent working days
      const absent = Object.values(days).filter((r: any) => r.status === "absent").length;
      expect(stored).toBeCloseTo(3 + 2.5 + 0.5 + absent, 5);
    });
  });

  it("is final: a second lock is refused, and a locked month is read from the frozen copy", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const worker = await person(c, "TESTDB-E");
      await punch(c, worker, D(3), "09:20", "in");
      await punch(c, worker, D(3), "17:40", "out");
      await attendance.lockMonthTx(tx, hr, { year: Y, month: M });
      await expect(attendance.lockMonthTx(tx, hr, { year: Y, month: M })).rejects.toThrow(/already locked/);

      const mine = await attendance.getMyAttendance(worker, Y, M, tx);
      expect(mine.locked).toBe(true);
      expect(mine.fixable).toEqual([]);
      expect(mine.days.find((d) => d.date === D(3))).toMatchObject({ status: "present", locked: true, firstIn: "09:20", lastOut: "17:40" });
      expect(mine.canPunch).toBe(false);

      const sheet = await attendance.getDaySheet(hr, D(3), tx);
      expect(sheet.rows.find((r) => r.code === "TESTDB-E")?.day).toMatchObject({ status: "present", locked: true });

      const overview = await attendance.getLockOverview(hr, Y);
      expect(overview).toHaveLength(12);
    });
  });

  it("is blocked by fixes that are still waiting, and by a month that has not ended", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const worker = await person(c, "TESTDB-E");
      await c.query(
        "insert into regularization (employee_id, work_date, batch_id, in_time, out_time, reason) values ($1, $2, gen_random_uuid(), '09:30', '17:30', 'forgot')",
        [worker.employeeId, D(5)],
      );
      const preview = await attendance.previewMonthLock(hr, Y, M, tx);
      expect(preview.canLock).toBe(false);
      expect(preview.pendingFixes).toBeGreaterThanOrEqual(1);
      await expect(attendance.lockMonthTx(tx, hr, { year: Y, month: M })).rejects.toThrow(/still waiting for approval/);

      const thisMonth = Number(todayIST().slice(5, 7));
      const thisYear = Number(todayIST().slice(0, 4));
      await expect(attendance.lockMonthTx(tx, hr, { year: thisYear, month: thisMonth })).rejects.toThrow(/after it has ended/);
    });
  });

  it("only an HR admin can lock", async () => {
    await inTx(async (c, tx) => {
      const worker = await person(c, "TESTDB-E");
      await expect(attendance.lockMonthTx(tx, worker, { year: Y, month: M })).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("after the lock the database refuses punches, fixes and edits to the frozen days", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const worker = await person(c, "TESTDB-E");
      await attendance.lockMonthTx(tx, hr, { year: Y, month: M });

      const refuse = async (sql: string, params: unknown[], pattern: RegExp) => {
        await c.query("savepoint s");
        await expect(c.query(sql, params)).rejects.toThrow(pattern);
        await c.query("rollback to savepoint s");
      };
      await refuse("insert into punch (employee_id, punched_at, direction) values ($1, $2::timestamptz, 'in')", [worker.employeeId, `${D(20)}T09:30:00+05:30`], /locked/);
      await refuse(
        "insert into regularization (employee_id, work_date, batch_id, in_time, out_time, reason) values ($1, $2, gen_random_uuid(), '09:30', '17:30', 'late fix')",
        [worker.employeeId, D(5)],
        /locked/,
      );
      await refuse("update attendance_day set status = 'present' where employee_id = $1 and work_date = $2", [worker.employeeId, D(5)], /locked attendance day cannot be changed/);
      await refuse("delete from attendance_day where employee_id = $1", [worker.employeeId], /locked attendance day cannot be changed/);
      await refuse("update attendance_period set employee_count = 0", [], /append-only/);
      await refuse("delete from attendance_period", [], /append-only/);
      await refuse("truncate attendance_period", [], /cannot be truncated|cannot truncate/);

      // The application says the same thing in plain words.
      await expect(attendance.requestRegularizationsTx(tx, worker, { reason: "forgot", items: [{ date: D(5), in: "09:30", out: "17:30" }] })).rejects.toThrow(/March 2025 is locked/);
    });
  });

  it("leave cannot be applied for, or approved for, a locked month, and only HR cancels approved leave there", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      await c.query("insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason) values ($1, $2, 2025, '2025-01-01', 8, 'grant')", [me.employeeId, clId]);

      // One pending and one approved CL request in March, created before the lock.
      const pending = await c.query("insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, $3, 1, 'pending') returning id", [me.employeeId, clId, D(12)]);
      const approved = await c.query("insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, $3, $3, 1, 'approved') returning id", [me.employeeId, clId, D(13)]);
      await attendance.lockMonthTx(tx, hr, { year: Y, month: M });

      await expect(leave.applyLeaveTx(tx, me, { leaveTypeId: clId, startDate: D(18), endDate: D(18), dayPart: "full", convertShortfallToLop: false })).rejects.toThrow(/closed/);
      await expect(leave.decideLeaveTx(tx, boss, { requestId: pending.rows[0].id, decision: "approve" })).rejects.toThrow(/closed/);
      await expect(leave.cancelLeaveTx(tx, me, approved.rows[0].id)).rejects.toThrow(/only HR can cancel/);
      await leave.cancelLeaveTx(tx, hr, approved.rows[0].id);
      expect((await c.query("select status from leave_request where id = $1", [approved.rows[0].id])).rows[0].status).toBe("cancelled");
    });
  });

  it("a recent finished month locks and stops fixes with a clear message", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const me = await person(c, "TESTDB-E");
      const t = todayIST();
      const prev = Number(t.slice(5, 7)) === 1 ? { y: Number(t.slice(0, 4)) - 1, m: 12 } : { y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 };
      await attendance.lockMonthTx(tx, hr, { year: prev.y, month: prev.m });
      const date = `${prev.y}-${String(prev.m).padStart(2, "0")}-10`;
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ date, in: "09:30", out: "17:30" }] })).rejects.toThrow(/is locked/);
      expect(addDays(date, 1) > date).toBe(true);
    });
  });
});

describe.skipIf(!enabled)("Month lock waits for, and holds back, other changes (R65)", () => {
  let pool: Pool;
  let attendance: typeof import("@/modules/attendance/data");
  let periods: typeof import("@/shared/periods");
  let pnj: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    attendance = await import("@/modules/attendance/data");
    periods = await import("@/shared/periods");
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
  });
  afterAll(async () => {
    await pool.end();
  });

  const q = (c: PoolClient) => ({
    query: async (text: string, params: unknown[] = []) => (await c.query(text, params)).rows,
  });
  /** Waits until some session is queued behind a month lock, as seen by a third connection (not just a slow query). */
  async function waitUntilBlocked(timeoutMs = 8000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const n = (await pool.query("select count(*)::int as n from pg_locks where locktype = 'advisory' and classid = 7101 and not granted")).rows[0].n;
      if (n > 0) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("nothing is waiting on a month lock");
  }

  async function newPerson(c: PoolClient, code: string, roles: Role[] = []): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
    );
    const id = r.rows[0].id as string;
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, employment_type, effective_from) values ($1, $2, 'T', 'T', 'permanent', '2024-01-01')",
      [id, pnj],
    );
    for (const role of roles) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...roles] };
  }

  it("a punch for a month waits while HR is locking that month, then goes through if the lock is abandoned", async () => {
    const a = await pool.connect(); // the lock
    const b = await pool.connect(); // the punch
    try {
      await a.query("begin");
      await b.query("begin");
      const hr = await newPerson(a, "TESTDB-HR", ["hr_admin"]);
      const worker = await newPerson(b, "TESTDB-E");

      await attendance.lockMonthTx(q(a), hr, { year: Y, month: M }); // holds the month, not committed

      let finished = false;
      const punching = attendance
        .punchTx(q(b), worker, { at: new Date(`${D(5)}T09:30:00+05:30`) })
        .then((r) => {
          finished = true;
          return r;
        });
      await waitUntilBlocked(); // the punch is queued behind the lock, seen from outside
      expect(finished).toBe(false);

      await a.query("rollback"); // the lock is abandoned
      const result = await punching;
      expect(result).toEqual({ direction: "in", time: "09:30" });
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      a.release();
      b.release();
    }
  });

  it("the lock waits for a change that is already in progress, then goes ahead", async () => {
    const a = await pool.connect(); // the lock
    const b = await pool.connect(); // a change in progress
    try {
      await a.query("begin");
      await b.query("begin");
      const hr = await newPerson(a, "TESTDB-HR", ["hr_admin"]);

      await periods.lockMonthsShared(q(b), [D(5)]); // a writer is part-way through a change to March

      let finished = false;
      const locking = attendance.lockMonthTx(q(a), hr, { year: Y, month: M }).then((r) => {
        finished = true;
        return r;
      });
      await waitUntilBlocked(); // the lock is queued behind the writer, seen from outside
      expect(finished).toBe(false);

      await b.query("rollback"); // the writer finishes
      const result = await locking;
      expect(result.year).toBe(Y);
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      a.release();
      b.release();
    }
  });

  it("locks for different months do not block each other", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      await periods.lockMonthExclusive(q(a), 2025, 3);
      const started = Date.now();
      await periods.lockMonthsShared(q(b), ["2025-04-10"]);
      expect(Date.now() - started).toBeLessThan(700);
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      a.release();
      b.release();
    }
  });
});
