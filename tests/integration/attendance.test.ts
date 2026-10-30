// Runs only with RUN_DB_TESTS=yes (npm run test:db). Every test runs inside a transaction that is
// ALWAYS rolled back, with explicit TESTDB employee codes so the code sequence is never used.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enabled = process.env.RUN_DB_TESTS === "yes" && !!process.env.DATABASE_URL;

type Role = "employee" | "hr_admin";
type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: Role[] };

describe.skipIf(!enabled)("Attendance against the database", () => {
  let pool: Pool;
  let attendance: typeof import("@/modules/attendance/data");
  let DomainError: typeof import("@/shared/errors").DomainError;
  let ForbiddenError: typeof import("@/shared/roles").ForbiddenError;
  let pnj: string;
  let casual: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    attendance = await import("@/modules/attendance/data");
    ({ DomainError } = await import("@/shared/errors"));
    ({ ForbiddenError } = await import("@/shared/roles"));
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
    casual = (await pool.query("select id from leave_type where code = 'CL'")).rows[0].id;
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

  async function person(c: PoolClient, code: string, roles: Role[] = []): Promise<TestActor> {
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

  const at = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);

  it("alternates check-in and check-out and refuses a double press", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      const first = await attendance.punchTx(tx, me, { at: at("2026-10-05", "09:30") });
      expect(first).toEqual({ direction: "in", time: "09:30" });
      await expect(attendance.punchTx(tx, me, { at: at("2026-10-05", "09:30") })).rejects.toThrow(/wait a minute/);
      const second = await attendance.punchTx(tx, me, { at: at("2026-10-05", "17:45") });
      expect(second).toEqual({ direction: "out", time: "17:45" });
      const third = await attendance.punchTx(tx, me, { at: at("2026-10-05", "18:30") });
      expect(third.direction).toBe("in");
    });
  });

  it("only lets an active employee check in", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await c.query("update employee set status = 'inactive' where id = $1", [me.employeeId]);
      await expect(attendance.punchTx(tx, me)).rejects.toBeInstanceOf(DomainError);
    });
  });

  it("keeps punches append-only in the database", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      await attendance.punchTx(tx, me, { at: at("2026-10-05", "09:30") });
      for (const [sql, pattern] of [
        ["update punch set direction = 'out'", /append-only/],
        ["delete from punch", /append-only/],
        ["truncate punch", /cannot be truncated|cannot truncate/],
      ] as const) {
        await c.query("savepoint s");
        await expect(c.query(sql)).rejects.toThrow(pattern);
        await c.query("rollback to savepoint s");
      }
    });
  });

  it("works out each day of a month from punches, leave, holidays and weekly offs", async () => {
    await inTx(async (c, tx) => {
      const me = await person(c, "TESTDB-E");
      const punch = (d: string, t: string) => attendance.punchTx(tx, me, { at: at(d, t) });

      await punch("2026-10-05", "09:30"); await punch("2026-10-05", "17:45"); // present
      await punch("2026-10-06", "10:05"); await punch("2026-10-06", "18:30"); // present, late
      await punch("2026-10-07", "09:30"); // missed check-out
      await punch("2026-10-08", "09:30"); await punch("2026-10-08", "17:30"); // has punches, but approved leave wins
      await c.query(
        "insert into leave_request (employee_id, leave_type_id, start_date, end_date, days, status) values ($1, $2, '2026-10-08', '2026-10-08', 1, 'approved')",
        [me.employeeId, casual],
      );

      const data = await attendance.getMyAttendance(me, 2026, 10, tx);
      const by = Object.fromEntries(data.days.map((d) => [d.date, d]));

      expect(by["2026-10-05"]).toMatchObject({ status: "present", firstIn: "09:30", lastOut: "17:45", late: false });
      expect(by["2026-10-06"]).toMatchObject({ status: "present", late: true });
      expect(by["2026-10-07"]).toMatchObject({ status: "missed_punch", needsAction: true });
      expect(by["2026-10-08"].status).toBe("leave");
      expect(by["2026-10-09"]).toMatchObject({ status: "absent", needsAction: true }); // no punches
      expect(by["2026-10-02"]).toMatchObject({ status: "holiday", note: "Gandhi Jayanti" });
      expect(by["2026-10-03"].status).toBe("weekly_off");

      expect(data.summary.counts.present).toBe(2);
      expect(data.summary.counts.leave).toBe(1);
      expect(data.summary.counts.missed_punch).toBe(1);
      expect(data.summary.counts.holiday).toBe(1);
      expect(data.summary.counts.weekly_off).toBe(9); // Saturdays and Sundays in October 2026
      expect(data.summary.lateMarks).toBe(1);
      expect(data.summary.needsAction).toContain("2026-10-07");
      expect(data.days).toHaveLength(31);
    });
  });

  it("lets HR see everyone for a date, and nobody else", async () => {
    await inTx(async (c, tx) => {
      const hr = await person(c, "TESTDB-HR", ["hr_admin"]);
      const me = await person(c, "TESTDB-E");
      await attendance.punchTx(tx, me, { at: at("2026-10-05", "09:30") });
      await attendance.punchTx(tx, me, { at: at("2026-10-05", "17:45") });

      const sheet = await attendance.getDaySheet(hr, "2026-10-05", tx);
      const row = sheet.rows.find((r) => r.code === "TESTDB-E");
      expect(row?.day).toMatchObject({ status: "present", firstIn: "09:30", lastOut: "17:45" });
      expect(sheet.rows.length).toBeGreaterThanOrEqual(2);

      await expect(attendance.getDaySheet(me, "2026-10-05", tx)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("reads the summary for the dashboard without errors", async () => {
    const hrRow = (await pool.query("select e.id, e.employee_code, e.full_name from employee e join employee_role r on r.employee_id = e.id where r.role = 'hr_admin' and e.status = 'active' limit 1")).rows[0];
    if (!hrRow) return;
    const hr: TestActor = { employeeId: hrRow.id, employeeCode: hrRow.employee_code, fullName: hrRow.full_name, roles: ["employee", "hr_admin"] };
    const s = await attendance.getDaySummary(hr, "2026-10-05");
    // Everyone is recorded, not in yet, off that day, or not employed yet (R61).
    expect(s.recorded + s.notRecorded + s.offToday + s.notEmployed).toBe(s.total);
  });
});
