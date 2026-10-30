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

describe.skipIf(!enabled)("Attendance regularization against the database", () => {
  let pool: Pool;
  let attendance: typeof import("@/modules/attendance/data");
  let DomainError: typeof import("@/shared/errors").DomainError;
  let ForbiddenError: typeof import("@/shared/roles").ForbiddenError;
  let pnj: string;
  let holidays: Set<string>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    attendance = await import("@/modules/attendance/data");
    ({ DomainError } = await import("@/shared/errors"));
    ({ ForbiddenError } = await import("@/shared/roles"));
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
    holidays = new Set((await pool.query("select holiday_date::text as d from holiday where location_id = $1", [pnj])).rows.map((r) => r.d));
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

  async function person(c: PoolClient, code: string, opts: { manager?: string; roles?: Role[] } = {}): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
    );
    const id = r.rows[0].id as string;
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from) values ($1, $2, 'T', 'T', $3, 'permanent', '2024-01-01')",
      [id, pnj, opts.manager ?? null],
    );
    for (const role of opts.roles ?? []) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...(opts.roles ?? [])] };
  }

  /** The most recent working days (Mon to Fri, not a Panaji holiday) strictly before today. */
  function workdaysBefore(count: number, skip = 0): string[] {
    const out: string[] = [];
    let d = addDays(todayIST(), -1);
    let skipped = 0;
    for (let i = 0; i < 40 && out.length < count; i++, d = addDays(d, -1)) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6 || holidays.has(d)) continue;
      if (skipped < skip) {
        skipped++;
        continue;
      }
      out.push(d);
    }
    return out;
  }

  const punchAt = (c: PoolClient, who: TestActor, date: string, time: string, direction: "in" | "out") =>
    c.query("insert into punch (employee_id, punched_at, direction) values ($1, $2::timestamptz, $3)", [who.employeeId, `${date}T${time}:00+05:30`, direction]);

  const month = (date: string) => ({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) });
  const dayOf = async (tx: ReturnType<typeof q>, who: TestActor, date: string) => {
    const { y, m } = month(date);
    return (await attendance.getMyAttendance(who, y, m, tx)).days.find((d) => d.date === date)!;
  };

  it("a bulk fix shares one batch, shows as pending, and after approval the days count and the late mark goes", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const [d1, d2] = workdaysBefore(2);
      await punchAt(c, me, d1, "10:40", "in"); // missed check-out and late
      // d2 has no punches at all

      expect(await dayOf(tx, me, d1)).toMatchObject({ status: "missed_punch", late: true, needsAction: true });
      expect(await dayOf(tx, me, d2)).toMatchObject({ status: "absent", needsAction: true });

      const { batchId, count } = await attendance.requestRegularizationsTx(tx, me, {
        reason: "Forgot to check out and the scanner was down",
        items: [
          { date: d1, in: "09:20", out: "17:45" },
          { date: d2, in: "09:30", out: "17:30" },
        ],
      });
      expect(count).toBe(2);
      const rows = (await c.query("select distinct batch_id::text as b from regularization where employee_id = $1", [me.employeeId])).rows;
      expect(rows).toEqual([{ b: batchId }]);

      // Pending: the day is unchanged but marked, and is no longer offered again.
      expect(await dayOf(tx, me, d1)).toMatchObject({ status: "missed_punch", fixPending: true });
      const { y, m } = month(d1);
      const mid = await attendance.getMyAttendance(me, y, m, tx);
      expect(mid.fixable.map((f) => f.date)).not.toContain(d1);
      expect(mid.requests.filter((r) => r.status === "pending")).toHaveLength(2);

      // The manager sees both, and approves them together.
      const waiting = await attendance.listRegularizationApprovals(boss, tx);
      expect(waiting.map((w) => w.date).sort()).toEqual([d1, d2].sort());
      await attendance.decideRegularizationsTx(tx, boss, { requestIds: waiting.map((w) => w.id), decision: "approve" });

      expect(await dayOf(tx, me, d1)).toMatchObject({ status: "present", firstIn: "09:20", lastOut: "17:45", late: false, needsAction: false, regularized: true });
      expect(await dayOf(tx, me, d2)).toMatchObject({ status: "present", regularized: true });

      // The raw punches were never touched (R56).
      expect((await c.query("select count(*)::int as n from punch where employee_id = $1", [me.employeeId])).rows[0].n).toBe(1);
    });
  });

  it("refuses days that cannot or need not be fixed, and bad input, in plain words", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      const [d1, d2] = workdaysBefore(2);
      const ok = { date: d1, in: "09:30", out: "17:30" };

      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "x", items: [ok] })).rejects.toThrow(/short reason/);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [] })).rejects.toThrow(/at least one day/);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [ok, ok] })).rejects.toThrow(/twice/);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ ...ok, in: "17:30", out: "09:30" }] })).rejects.toThrow(/after check-in/);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ ...ok, date: todayIST() }] })).rejects.toThrow(/still in progress/);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ ...ok, date: addDays(todayIST(), 2) }] })).rejects.toThrow(/future/);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ ...ok, date: addDays(todayIST(), -75) }] })).rejects.toThrow(/deadline/);

      // A day that was fine (full hours) does not need fixing.
      await punchAt(c, me, d2, "09:20", "in");
      await punchAt(c, me, d2, "17:40", "out");
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ ...ok, date: d2 }] })).rejects.toThrow(/does not need fixing/);

      // A weekly off cannot be fixed either.
      let saturday = addDays(todayIST(), -1);
      while (new Date(`${saturday}T00:00:00Z`).getUTCDay() !== 6) saturday = addDays(saturday, -1);
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ ...ok, date: saturday }] })).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("allows only one open request per day, in the app and in the database", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      const [d1] = workdaysBefore(1);
      await attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ date: d1, in: "09:30", out: "17:30" }] });
      await expect(attendance.requestRegularizationsTx(tx, me, { reason: "again", items: [{ date: d1, in: "09:30", out: "17:30" }] })).rejects.toThrow(/does not need fixing|already been sent/);
      await c.query("savepoint s");
      await expect(
        c.query("insert into regularization (employee_id, work_date, batch_id, in_time, out_time, reason) values ($1, $2, gen_random_uuid(), '09:30', '17:30', 'dup')", [me.employeeId, d1]),
      ).rejects.toThrow(/regularization_open_per_day|duplicate/);
      await c.query("rollback to savepoint s");
    });
  });

  it("only a manager or HR decides, never the person themself, and a decided request is frozen", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const stranger = await person(c, "TESTDB-S");
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const [d1, d2] = workdaysBefore(2);

      await attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ date: d1, in: "09:30", out: "17:30" }, { date: d2, in: "09:30", out: "17:30" }] });
      const ids = (await c.query("select id::text as id from regularization where employee_id = $1 order by work_date desc", [me.employeeId])).rows.map((r) => r.id as string); // ids[0] is d1, the most recent day

      await expect(attendance.decideRegularizationsTx(tx, me, { requestIds: ids, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(attendance.decideRegularizationsTx(tx, stranger, { requestIds: ids, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);

      // Rejecting makes the day fixable again; an HR admin can approve a new request.
      await attendance.decideRegularizationsTx(tx, boss, { requestIds: [ids[0]], decision: "reject", note: "Not on site" });
      expect(await dayOf(tx, me, d1)).toMatchObject({ fixPending: false, needsAction: true });
      await attendance.decideRegularizationsTx(tx, hr, { requestIds: [ids[1]], decision: "approve" });

      await expect(attendance.decideRegularizationsTx(tx, boss, { requestIds: [ids[0]], decision: "approve" })).rejects.toThrow(/already been decided/);
      for (const sql of ["update regularization set out_time = '18:00' where id = $1", "delete from regularization where id = $1"]) {
        await c.query("savepoint s");
        await expect(c.query(sql, [ids[0]])).rejects.toThrow(/cannot be changed|cannot be deleted/);
        await c.query("rollback to savepoint s");
      }
    });
  });

  it("an all-or-nothing batch: one request the actor may not decide stops the whole batch", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const mine = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const other = await person(c, "TESTDB-O"); // reports to nobody
      const [d1] = workdaysBefore(1);
      await attendance.requestRegularizationsTx(tx, mine, { reason: "forgot", items: [{ date: d1, in: "09:30", out: "17:30" }] });
      await attendance.requestRegularizationsTx(tx, other, { reason: "forgot", items: [{ date: d1, in: "09:30", out: "17:30" }] });
      const ids = (await c.query("select id::text as id from regularization where employee_id = any($1::uuid[])", [[mine.employeeId, other.employeeId]])).rows.map((r) => r.id as string);
      await c.query("savepoint s");
      await expect(attendance.decideRegularizationsTx(tx, boss, { requestIds: ids, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await c.query("rollback to savepoint s");
      expect((await c.query("select count(*)::int as n from regularization where status = 'pending' and employee_id = any($1::uuid[])", [[mine.employeeId, other.employeeId]])).rows[0].n).toBe(2);
    });
  });

  it("the owner cancels a waiting request, and nobody else can", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const me = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const [d1] = workdaysBefore(1);
      await attendance.requestRegularizationsTx(tx, me, { reason: "forgot", items: [{ date: d1, in: "09:30", out: "17:30" }] });
      const id = (await c.query("select id::text as id from regularization where employee_id = $1", [me.employeeId])).rows[0].id as string;
      await expect(attendance.cancelRegularizationTx(tx, boss, id)).rejects.toBeInstanceOf(ForbiddenError);
      await attendance.cancelRegularizationTx(tx, me, id);
      expect(await dayOf(tx, me, d1)).toMatchObject({ fixPending: false, needsAction: true });
      await expect(attendance.cancelRegularizationTx(tx, me, id)).rejects.toThrow(/still waiting/);
    });
  });

  it("a manager sees only their own reports' requests, and HR sees everyone's except their own", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-M");
      const mine = await person(c, "TESTDB-E", { manager: boss.employeeId });
      const other = await person(c, "TESTDB-O");
      const hr = await person(c, "TESTDB-HR", { roles: ["hr_admin"] });
      const [d1, d2] = workdaysBefore(2);
      const fix = (date: string) => ({ reason: "forgot", items: [{ date, in: "09:30", out: "17:30" }] });
      await attendance.requestRegularizationsTx(tx, mine, fix(d1));
      await attendance.requestRegularizationsTx(tx, other, fix(d1));
      await attendance.requestRegularizationsTx(tx, hr, fix(d2));

      const seenByBoss = (await attendance.listRegularizationApprovals(boss, tx)).map((r) => r.employeeCode);
      expect(seenByBoss).toEqual(["TESTDB-E"]);
      const seenByHr = (await attendance.listRegularizationApprovals(hr, tx)).map((r) => r.employeeCode);
      expect(seenByHr).toContain("TESTDB-E");
      expect(seenByHr).toContain("TESTDB-O");
      expect(seenByHr).not.toContain("TESTDB-HR");
      expect(await attendance.listRegularizationApprovals(other, tx)).toEqual([]);
    });
  });
});
