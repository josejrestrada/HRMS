// Runs only with RUN_DB_TESTS=yes (npm run test:db). Review finding 1: weekly offs, holidays and
// policy are decided per day from the assignment effective that day (R63). Every test runs in a
// transaction that is ALWAYS rolled back, so the test holidays and the changed weekly offs vanish.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";

vi.mock("server-only", () => ({}));

const enabled = databaseTestsEnabled();

type TestActor = { employeeId: string; employeeCode: string; fullName: string; roles: ("employee" | "hr_admin")[] };
const D = (day: number) => `2025-03-${String(day).padStart(2, "0")}`;

describe.skipIf(!enabled)("Attendance calendar is resolved per day", () => {
  let pool: Pool;
  let attendance: typeof import("@/modules/attendance/data");
  let pnj: string;
  let vrn: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    attendance = await import("@/modules/attendance/data");
    pnj = (await pool.query("select id from location where code = 'PNJ'")).rows[0].id;
    vrn = (await pool.query("select id from location where code = 'VRN'")).rows[0].id;
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
    joined: string,
    stretches: { loc: string; from: string; to: string | null }[],
    roles: ("hr_admin")[] = [],
  ): Promise<TestActor> {
    const r = await c.query(
      "insert into employee (employee_code, full_name, work_email, joining_date) values ($1, $2, $3, $4) returning id",
      [code, `DB ${code}`, `${code.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.invalid`, joined],
    );
    const id = r.rows[0].id as string;
    for (const s of stretches) {
      await c.query(
        "insert into employment_assignment (employee_id, location_id, department, designation, employment_type, effective_from, effective_to) values ($1, $2, 'T', 'T', 'permanent', $3, $4)",
        [id, s.loc, s.from, s.to],
      );
    }
    for (const role of roles) await c.query("insert into employee_role (employee_id, role) values ($1, $2)", [id, role]);
    return { employeeId: id, employeeCode: code, fullName: `DB ${code}`, roles: ["employee", ...roles] };
  }

  /** Test calendar: a Panaji holiday on Wed 19 Mar, a Verna holiday on Thu 20 Mar, and Verna works Saturdays. */
  async function setUpCalendar(c: PoolClient) {
    await c.query("insert into holiday (location_id, holiday_date, name, type) values ($1, $2, 'Panaji test holiday', 'state')", [pnj, D(19)]);
    await c.query("insert into holiday (location_id, holiday_date, name, type) values ($1, $2, 'Verna test holiday', 'state')", [vrn, D(20)]);
    await c.query("update location set weekly_off_days = '{0}' where id = $1", [vrn]);
  }

  const by = (days: { date: string }[]) => Object.fromEntries(days.map((d) => [d.date, d])) as Record<string, any>;

  it("a mid-month joiner gets the holiday and weekly offs of their location, and no absent days before joining", async () => {
    await inTx(async (c, tx) => {
      await setUpCalendar(c);
      const joiner = await person(c, "TESTDB-J", D(10), [{ loc: pnj, from: D(10), to: null }]);
      const days = by((await attendance.getMyAttendance(joiner, 2025, 3, tx)).days);

      expect(days[D(5)]).toMatchObject({ employed: false, status: "upcoming", needsAction: false }); // before joining
      expect(days[D(19)]).toMatchObject({ status: "holiday", note: "Panaji test holiday", needsAction: false });
      expect(days[D(15)].status).toBe("weekly_off"); // Saturday
      expect(days[D(12)]).toMatchObject({ status: "absent", needsAction: true }); // a plain working day with no punches
    });
  });

  it("a mid-month transfer uses each location's weekly offs and holidays on the right days", async () => {
    await inTx(async (c, tx) => {
      await setUpCalendar(c);
      const mover = await person(c, "TESTDB-T", "2024-01-01", [
        { loc: pnj, from: "2024-01-01", to: D(14) },
        { loc: vrn, from: D(15), to: null },
      ]);
      const days = by((await attendance.getMyAttendance(mover, 2025, 3, tx)).days);

      expect(days[D(8)].status).toBe("weekly_off"); // Saturday at Panaji
      expect(days[D(22)]).toMatchObject({ status: "absent", needsAction: true }); // Saturday at Verna is a working day
      expect(days[D(16)].status).toBe("weekly_off"); // Sunday at Verna
      expect(days[D(19)]).toMatchObject({ status: "absent" }); // Panaji's holiday does not apply once at Verna
      expect(days[D(20)]).toMatchObject({ status: "holiday", note: "Verna test holiday" });
    });
  });

  it("the month lock freezes the same calendar, so a holiday is never stored as unpaid", async () => {
    await inTx(async (c, tx) => {
      await setUpCalendar(c);
      const hr = await person(c, "TESTDB-HR", "2024-01-01", [{ loc: pnj, from: "2024-01-01", to: null }], ["hr_admin"]);
      const joiner = await person(c, "TESTDB-J", D(10), [{ loc: pnj, from: D(10), to: null }]);
      const mover = await person(c, "TESTDB-T", "2024-01-01", [
        { loc: pnj, from: "2024-01-01", to: D(14) },
        { loc: vrn, from: D(15), to: null },
      ]);

      await attendance.lockMonthTx(tx, hr, { year: 2025, month: 3 });
      const frozen = async (who: TestActor) =>
        Object.fromEntries((await c.query("select work_date::text as d, status, note from attendance_day where employee_id = $1", [who.employeeId])).rows.map((r) => [r.d, r]));

      const j = await frozen(joiner);
      expect(Object.keys(j)).toHaveLength(22); // 10 to 31 March
      expect(j[D(19)].status).toBe("holiday");
      const joinerUnpaid = Object.values(j).filter((r: any) => r.status === "absent").length;
      expect(joinerUnpaid).toBe(15); // 16 working days minus the holiday, none worked

      const m = await frozen(mover);
      expect(m[D(8)].status).toBe("weekly_off");
      expect(m[D(22)]).toMatchObject({ status: "absent" });
      expect(m[D(22)].note).toContain("not fixed in time");
      expect(m[D(20)].status).toBe("holiday");
      expect(m[D(19)].status).toBe("absent");
    });
  });

  it("the policy that applies is the one for the location on that day", async () => {
    await inTx(async (c, tx) => {
      await setUpCalendar(c);
      // Verna starts at 10:30 and Panaji at 09:30; an arrival at 10:20 is late at Panaji but on time at Verna.
      await c.query("update attendance_policy set work_start = '10:30' where location_id = $1", [vrn]);
      const mover = await person(c, "TESTDB-T", "2024-01-01", [
        { loc: pnj, from: "2024-01-01", to: D(14) },
        { loc: vrn, from: D(15), to: null },
      ]);
      const punch = (date: string, time: string, dir: string) =>
        c.query("insert into punch (employee_id, punched_at, direction) values ($1, $2::timestamptz, $3)", [mover.employeeId, `${date}T${time}:00+05:30`, dir]);
      await punch(D(13), "10:20", "in"); await punch(D(13), "18:30", "out"); // Thu at Panaji
      await punch(D(18), "10:20", "in"); await punch(D(18), "18:30", "out"); // Tue at Verna

      const days = by((await attendance.getMyAttendance(mover, 2025, 3, tx)).days);
      expect(days[D(13)]).toMatchObject({ status: "present", late: true });
      expect(days[D(18)]).toMatchObject({ status: "present", late: false });
    });
  });
});
