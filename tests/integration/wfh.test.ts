// Runs only with RUN_DB_TESTS=yes (npm run test:db). Work-from-home requests. Every test runs inside a
// transaction that is ALWAYS rolled back, with explicit TESTDB employee codes.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";
import { addDays, todayIST } from "@/shared/dates";

vi.mock("server-only", () => ({}));

const enabled = databaseTestsEnabled();

type Role = "employee" | "hr_admin";
type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: Role[] };

describe.skipIf(!enabled)("Work-from-home requests against the database", () => {
  let pool: Pool;
  let attendance: typeof import("@/modules/attendance/data");
  let DomainError: typeof import("@/shared/errors").DomainError;
  let ForbiddenError: typeof import("@/shared/roles").ForbiddenError;
  let pnj: string;
  let other: string;
  let holidays: Set<string>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    attendance = await import("@/modules/attendance/data");
    ({ DomainError } = await import("@/shared/errors"));
    ({ ForbiddenError } = await import("@/shared/roles"));
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
    other = (await pool.query("select id from location where code <> 'PNJ' order by code limit 1")).rows[0].id;
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

  async function person(c: PoolClient, code: string, opts: { manager?: string; roles?: Role[]; location?: string } = {}): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, '2024-01-01') returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`],
    );
    const id = r.rows[0].id as string;
    await c.query(
      "insert into employment_assignment (employee_id, location_id, department, designation, manager_id, employment_type, effective_from) values ($1, $2, 'T', 'T', $3, 'permanent', '2024-01-01')",
      [id, opts.location ?? pnj, opts.manager ?? null],
    );
    for (const role of opts.roles ?? []) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...(opts.roles ?? [])] };
  }

  /** The next working days (Mon to Fri, not a Panaji holiday) strictly after today. */
  function workdaysAfter(count: number): string[] {
    const out: string[] = [];
    let d = addDays(todayIST(), 1);
    for (let i = 0; i < 40 && out.length < count; i++, d = addDays(d, 1)) {
      const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6 || holidays.has(d)) continue;
      out.push(d);
    }
    return out;
  }

  const statusOn = async (tx: ReturnType<typeof q>, who: TestActor, date: string) =>
    (await attendance.getMyAttendance(who, Number(date.slice(0, 4)), Number(date.slice(5, 7)), tx)).days.find((d) => d.date === date)!;

  it("a request waits for the manager, and once approved the day shows as work from home", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-WM");
      const me = await person(c, "TESTDB-WE", { manager: boss.employeeId });
      const [d] = workdaysAfter(1);

      const r = await attendance.requestWfhTx(tx, me, { startDate: d, endDate: d, reason: "Waiting for a repair visit" });
      expect(r).toMatchObject({ count: 1, skipped: [] });
      expect((await statusOn(tx, me, d)).status).not.toBe("wfh"); // not until approved

      const mine = await attendance.getMyWfh(me, tx);
      expect(mine).toMatchObject({ allowed: true, daysPerMonth: 4 });
      expect(mine.requests[0]).toMatchObject({ date: d, status: "pending", canCancel: true });

      const waiting = await attendance.listWfhApprovals(boss, tx);
      expect(waiting.map((w) => w.employeeCode)).toContain("TESTDB-WE");
      await attendance.decideWfhTx(tx, boss, { requestIds: [waiting.find((w) => w.employeeCode === "TESTDB-WE")!.id], decision: "approve" });

      expect(await statusOn(tx, me, d)).toMatchObject({ status: "wfh" });
      expect((await attendance.getMyWfh(me, tx)).requests[0]).toMatchObject({ status: "approved", canCancel: true });
      expect((await c.query("select count(*)::int as n from audit_log where action in ('wfh_requested','wfh_approved') and actor_employee_id in ($1, $2)", [me.employeeId, boss.employeeId])).rows[0].n).toBe(2);
    });
  });

  it("skips weekly offs, holidays and days already asked for, and refuses a range with nothing left", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-WS");
      const [first] = workdaysAfter(1);
      // Find a Saturday within reach and the Friday before it.
      let sat = addDays(todayIST(), 1);
      while (new Date(`${sat}T00:00:00Z`).getUTCDay() !== 6) sat = addDays(sat, 1);
      const sun = addDays(sat, 1);
      await expect(attendance.requestWfhTx(tx, me, { startDate: sat, endDate: sun, reason: "weekend" })).rejects.toThrow(/no working day/);

      const mon = addDays(sun, 1);
      const r = await attendance.requestWfhTx(tx, me, { startDate: sat, endDate: mon, reason: "long weekend" });
      expect(r.skipped).toEqual(expect.arrayContaining([sat, sun]));
      await expect(attendance.requestWfhTx(tx, me, { startDate: mon, endDate: mon, reason: "again" })).rejects.toThrow(/no working day/);
      void first;
    });
  });

  it("refuses past days, days too far ahead, and a bad reason", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-WP");
      const today = todayIST();
      await expect(attendance.requestWfhTx(tx, me, { startDate: addDays(today, -1), endDate: addDays(today, 1), reason: "late" })).rejects.toThrow(/passed/);
      await expect(attendance.requestWfhTx(tx, me, { startDate: addDays(today, 31), endDate: addDays(today, 31), reason: "far" })).rejects.toThrow(/30 days ahead/);
      const [d] = workdaysAfter(1);
      await expect(attendance.requestWfhTx(tx, me, { startDate: d, endDate: d, reason: " " })).rejects.toThrow(/reason/);
      await expect(attendance.requestWfhTx(tx, me, { startDate: addDays(d, 1), endDate: d, reason: "backwards" })).rejects.toThrow(/before/);
    });
  });

  it("refuses people at a location that does not allow it, and enforces the monthly limit", async () => {
    await inTx(async (c, tx) => {
      const plant = await person(c, "TESTDB-WV", { location: other });
      const [d] = workdaysAfter(1);
      await expect(attendance.requestWfhTx(tx, plant, { startDate: d, endDate: d, reason: "try" })).rejects.toThrow(/not available/);
      expect((await attendance.getMyWfh(plant, tx)).allowed).toBe(false);

      await c.query("update attendance_policy set wfh_days_per_month = 1 where location_id = $1", [pnj]);
      const me = await person(c, "TESTDB-WL");
      const [a, b] = workdaysAfter(2);
      if (a.slice(0, 7) !== b.slice(0, 7)) return; // the two days fall in different months; nothing to compare
      await expect(attendance.requestWfhTx(tx, me, { startDate: a, endDate: b, reason: "two days" })).rejects.toThrow(/1 days a month/);
      await attendance.requestWfhTx(tx, me, { startDate: a, endDate: a, reason: "one day" });
      await expect(attendance.requestWfhTx(tx, me, { startDate: b, endDate: b, reason: "second" })).rejects.toThrow(/0 left/);
    });
  });

  it("only the manager or HR can decide, never the person, and a rejection keeps the day as it was", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-DM");
      const stranger = await person(c, "TESTDB-DS");
      const hr = await person(c, "TESTDB-DH", { roles: ["hr_admin"] });
      const me = await person(c, "TESTDB-DE", { manager: boss.employeeId });
      const [a, b] = workdaysAfter(2);
      await attendance.requestWfhTx(tx, me, { startDate: a, endDate: b, reason: "two days at home" });
      const ids = (await attendance.listWfhApprovals(hr, tx)).filter((w) => w.employeeCode === "TESTDB-DE").map((w) => w.id);
      expect(ids).toHaveLength(2);

      await expect(attendance.decideWfhTx(tx, me, { requestIds: ids, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(attendance.decideWfhTx(tx, stranger, { requestIds: ids, decision: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
      expect(await attendance.listWfhApprovals(stranger, tx)).toEqual([]);

      await attendance.decideWfhTx(tx, boss, { requestIds: ids, decision: "reject", note: "Team meeting that week" });
      expect((await attendance.getMyWfh(me, tx)).requests.map((r) => [r.status, r.decisionNote])).toEqual([["rejected", "Team meeting that week"], ["rejected", "Team meeting that week"]]);
      expect((await statusOn(tx, me, a)).status).not.toBe("wfh");
      await expect(attendance.decideWfhTx(tx, boss, { requestIds: ids, decision: "approve" })).rejects.toThrow(/already been decided/);
      // A rejected day can be asked for again.
      await attendance.requestWfhTx(tx, me, { startDate: a, endDate: a, reason: "asking again" });
    });
  });

  it("can be cancelled while pending, or when approved for a future day, but only by its owner", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-CM");
      const me = await person(c, "TESTDB-CE", { manager: boss.employeeId });
      const [a, b] = workdaysAfter(2);
      await attendance.requestWfhTx(tx, me, { startDate: a, endDate: b, reason: "two days" });
      const [first, second] = (await attendance.getMyWfh(me, tx)).requests.map((r) => r.id);

      await expect(attendance.cancelWfhTx(tx, boss, first)).rejects.toBeInstanceOf(ForbiddenError);
      await attendance.cancelWfhTx(tx, me, first);
      await expect(attendance.cancelWfhTx(tx, me, first)).rejects.toThrow(/already closed/);

      await attendance.decideWfhTx(tx, boss, { requestIds: [second], decision: "approve" });
      expect((await statusOn(tx, me, (await attendance.getMyWfh(me, tx)).requests.find((r) => r.id === second)!.date)).status).toBe("wfh");
      await attendance.cancelWfhTx(tx, me, second);
      expect((await attendance.getMyWfh(me, tx)).requests.every((r) => r.status === "cancelled")).toBe(true);
    });
  });

  it("an approved day for today or the past cannot be cancelled, and the database refuses to edit a decided request", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-GM");
      const me = await person(c, "TESTDB-GE", { manager: boss.employeeId });
      const today = todayIST();
      const batch = (await c.query("select gen_random_uuid()::text as id")).rows[0].id;
      const id = (
        await c.query(
          "insert into wfh_request (employee_id, work_date, batch_id, reason, status, approver_id, decided_at) values ($1, $2, $3, 'test', 'approved', $4, now()) returning id",
          [me.employeeId, today, batch, boss.employeeId],
        )
      ).rows[0].id;
      await expect(attendance.cancelWfhTx(tx, me, id)).rejects.toThrow(/before the day starts/);

      await c.query("savepoint s1");
      await expect(c.query("update wfh_request set reason = 'edited' where id = $1", [id])).rejects.toThrow(/cannot be changed/);
      await c.query("rollback to savepoint s1");
      await c.query("update wfh_request set status = 'cancelled' where id = $1", [id]); // the one allowed change
      await c.query("savepoint s2");
      await expect(c.query("update wfh_request set status = 'approved' where id = $1", [id])).rejects.toThrow(/cannot be changed/);
      await c.query("rollback to savepoint s2");
      await expect(c.query("delete from wfh_request where id = $1", [id])).rejects.toThrow();
    });
  });

  it("an approved work-from-home day counts as present in the month summary", async () => {
    await inTx(async (c, tx) => {
      const boss = await person(c, "TESTDB-SM");
      const me = await person(c, "TESTDB-SE", { manager: boss.employeeId });
      const [d] = workdaysAfter(1);
      await attendance.requestWfhTx(tx, me, { startDate: d, endDate: d, reason: "home" });
      await attendance.decideWfhTx(tx, boss, { requestIds: [(await attendance.getMyWfh(me, tx)).requests[0].id], decision: "approve" });
      const sheet = await attendance.getMyAttendance(me, Number(d.slice(0, 4)), Number(d.slice(5, 7)), tx);
      expect(sheet.summary.counts.wfh).toBeGreaterThanOrEqual(1);
    });
  });
});
