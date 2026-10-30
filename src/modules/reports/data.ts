import "server-only";
import { query } from "@/shared/db";
import { recordAudit } from "@/shared/audit";
import { DomainError } from "@/shared/errors";
import { requireRole, type Actor } from "@/shared/roles";
import { todayIST } from "@/shared/dates";
import { toCsv, type Cell } from "./csv";
import { getAttendanceApprovalScope, getDaySummary, getMonthSummary, getMyAttendance, getMyWfh } from "@/modules/attendance/data";
import { getApplyContext, getApprovalScope, getBalancesReport, getLeaveOverview } from "@/modules/leave/data";
import { addMonths } from "@/shared/dates";
import { buildHome, type EmployeeHome } from "./home";

export type HrDashboard = {
  today: string;
  headcount: {
    /** All active employees, including any without a current assignment. */
    total: number;
    byLocation: { name: string; count: number }[];
    byType: { type: string; count: number }[];
  };
  onLeave: {
    employeeCode: string;
    fullName: string;
    leaveCode: string;
    dayPart: "full" | "first_half" | "second_half";
    startDate: string;
    endDate: string;
  }[];
  /** True number of people on approved leave today; `onLeave` is capped at 25. */
  onLeaveTotal: number;
  pending: {
    count: number;
    oldestAgeDays: number | null;
    items: { employeeCode: string; fullName: string; leaveCode: string; startDate: string; endDate: string; days: number; waitingDays: number }[];
  };
  byDepartment: { name: string; count: number }[];
  attendance: { counts: Record<string, number>; recorded: number; notRecorded: number; offToday: number; notEmployed: number };
  holidays: { date: string; name: string; type: string; verified: boolean; locations: string[] }[];
  recentJoiners: { employeeCode: string; fullName: string; designation: string; location: string; joiningDate: string }[];
  attention: { withoutManager: number; notSignedIn: number; unassigned: number };
};

// Employees active today, joined with the assignment effective today (decision P5).
const ACTIVE_NOW = `
  employee e
  join employment_assignment a
    on a.employee_id = e.id
   and a.effective_from <= $1::date
   and (a.effective_to is null or a.effective_to >= $1::date)
  join location l on l.id = a.location_id
  where e.status = 'active'`;

/** HR admin dashboard. The role is checked here, on the server, before any query runs. */
export async function getHrDashboard(actor: Actor | null): Promise<HrDashboard> {
  requireRole(actor, "hr_admin");
  const today = todayIST();

  const [byLocation, byType, onLeave, pending, attendance, activeTotal, holidays, joiners, attention, pendingItems, byDepartment] =
    await Promise.all([
      query<{ name: string; count: number }>(
        `select l.name, count(*)::int as count from ${ACTIVE_NOW} group by l.name order by l.name`,
        [today],
      ),
      query<{ type: string; count: number }>(
        `select a.employment_type as type, count(*)::int as count from ${ACTIVE_NOW} group by a.employment_type order by 2 desc`,
        [today],
      ),
      query<{
        employee_code: string;
        full_name: string;
        leave_code: string;
        day_part: "full" | "first_half" | "second_half";
        start_date: string;
        end_date: string;
        total: number;
      }>(
        `select e.employee_code, e.full_name, t.code as leave_code, lr.day_part,
                lr.start_date::text, lr.end_date::text,
                (count(*) over ())::int as total
           from leave_request lr
           join employee e on e.id = lr.employee_id
           join leave_type t on t.id = lr.leave_type_id
          where lr.status = 'approved' and e.status = 'active'
            and $1::date between lr.start_date and lr.end_date
          order by e.full_name
          limit 25`,
        [today],
      ),
      query<{ count: number; oldest: number | null }>(
        `select count(*)::int as count,
                case when count(*) = 0 then null
                     else ($1::date - (min(lr.created_at) at time zone 'Asia/Kolkata')::date) end::int as oldest
           from leave_request lr
           join employee e on e.id = lr.employee_id
          where lr.status = 'pending' and e.status = 'active'`,
        [today],
      ),
      getDaySummary(actor, today),
      query<{ count: number }>(`select count(*)::int as count from employee where status = 'active'`),
      query<{ holiday_date: string; name: string; type: string; verified: boolean; locations: string[] }>(
        `select h.holiday_date::text, h.name, h.type, bool_and(h.verified) as verified,
                array_agg(l.name order by l.name) as locations
           from holiday h join location l on l.id = h.location_id
          where h.holiday_date >= $1::date
          group by h.holiday_date, h.name, h.type
          order by h.holiday_date
          limit 5`,
        [today],
      ),
      query<{ employee_code: string; full_name: string; designation: string; location: string; joining_date: string }>(
        `select e.employee_code, e.full_name, a.designation, l.name as location, e.joining_date::text
           from ${ACTIVE_NOW}
            and e.joining_date >= ($1::date - 30)
          order by e.joining_date desc, e.full_name
          limit 5`,
        [today],
      ),
      query<{ without_manager: number; not_signed_in: number }>(
        `select count(*) filter (where a.manager_id is null)::int as without_manager,
                count(*) filter (where e.clerk_user_id is null)::int as not_signed_in
           from ${ACTIVE_NOW}`,
        [today],
      ),
      query<{ employee_code: string; full_name: string; leave_code: string; start_date: string; end_date: string; days: number; waiting: number }>(
        `select e.employee_code, e.full_name, t.code as leave_code, lr.start_date::text, lr.end_date::text,
                lr.days::float8 as days,
                ($1::date - (lr.created_at at time zone 'Asia/Kolkata')::date)::int as waiting
           from leave_request lr
           join employee e on e.id = lr.employee_id
           join leave_type t on t.id = lr.leave_type_id
          where lr.status = 'pending' and e.status = 'active'
          order by lr.created_at
          limit 5`,
        [today],
      ),
      query<{ name: string; count: number }>(
        `select a.department as name, count(*)::int as count from ${ACTIVE_NOW}
          group by a.department order by 2 desc, 1 limit 8`,
        [today],
      ),
    ]);

  const total = activeTotal[0]?.count ?? 0;
  const assigned = byLocation.reduce((sum, r) => sum + r.count, 0);

  return {
    today,
    headcount: {
      total,
      byLocation: byLocation.map((r) => ({ name: r.name, count: r.count })),
      byType: byType.map((r) => ({ type: r.type, count: r.count })),
    },
    onLeave: onLeave.map((r) => ({
      employeeCode: r.employee_code,
      fullName: r.full_name,
      leaveCode: r.leave_code,
      dayPart: r.day_part,
      startDate: r.start_date,
      endDate: r.end_date,
    })),
    onLeaveTotal: onLeave[0]?.total ?? 0,
    pending: {
      count: pending[0]?.count ?? 0,
      oldestAgeDays: pending[0]?.oldest ?? null,
      items: pendingItems.map((r) => ({
        employeeCode: r.employee_code,
        fullName: r.full_name,
        leaveCode: r.leave_code,
        startDate: r.start_date,
        endDate: r.end_date,
        days: r.days,
        waitingDays: r.waiting,
      })),
    },
    byDepartment: byDepartment.map((r) => ({ name: r.name, count: r.count })),
    attendance: { counts: attendance.counts, recorded: attendance.recorded, notRecorded: attendance.notRecorded, offToday: attendance.offToday, notEmployed: attendance.notEmployed },
    holidays: holidays.map((r) => ({
      date: r.holiday_date,
      name: r.name,
      type: r.type,
      verified: r.verified,
      locations: r.locations,
    })),
    recentJoiners: joiners.map((r) => ({
      employeeCode: r.employee_code,
      fullName: r.full_name,
      designation: r.designation,
      location: r.location,
      joiningDate: r.joining_date,
    })),
    attention: {
      withoutManager: attention[0]?.without_manager ?? 0,
      notSignedIn: attention[0]?.not_signed_in ?? 0,
      unassigned: Math.max(total - assigned, 0),
    },
  };
}

/** The signed-in person's own home screen: today's status, balances, what is coming up and what needs attention. */
export async function getEmployeeHome(actor: Actor | null): Promise<EmployeeHome> {
  requireRole(actor, "employee");
  const today = todayIST();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  const [attendance, overview, context, wfh, leaveScope, attendanceScope] = await Promise.all([
    getMyAttendance(actor, year, month),
    getLeaveOverview(actor),
    getApplyContext(actor),
    getMyWfh(actor),
    getApprovalScope(actor),
    getAttendanceApprovalScope(actor),
  ]);

  // While last month's fix window is still open (until the policy day), its days need attention too.
  const previous = addMonths(`${today.slice(0, 7)}-01`, -1);
  const stillOpen = Number(today.slice(8, 10)) <= attendance.policy.regularizeUntilDay;
  const before = stillOpen ? await getMyAttendance(actor, Number(previous.slice(0, 4)), Number(previous.slice(5, 7))) : null;
  const fixable = [...(before && !before.locked ? before.fixable : []), ...attendance.fixable];

  return buildHome({
    today,
    day: attendance.days.find((d) => d.date === today) ?? null,
    todayIn: attendance.todayIn,
    todayOut: attendance.todayOut,
    canPunch: attendance.canPunch,
    next: attendance.next,
    regularizeUntilDay: attendance.policy.regularizeUntilDay,
    fixableDates: fixable.map((f) => f.date),
    pastDeadlineCount: attendance.pastDeadline.length,
    balances: overview.balances.filter((b) => b.code !== "LOP").map((b) => ({ code: b.code, name: b.name, available: b.available, held: b.held })),
    holidays: context?.holidays ?? {},
    leave: overview.requests,
    wfh: wfh.requests,
    waitingForMe: { leave: leaveScope.pending, attendance: attendanceScope.pending },
  });
}


// ---------------------------------------------------------------------------------------------
// Reports (HR only). Each one is a title, a header and rows, so the page and the CSV share one source.
// ---------------------------------------------------------------------------------------------

export const REPORT_KINDS = ["headcount", "leave-balances", "attendance-summary"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export type Report = { kind: ReportKind; title: string; subtitle: string; header: string[]; rows: Cell[][]; numericFrom: number };

const TYPE_NAMES: Record<string, string> = { permanent: "Permanent", probation: "Probation", contract: "Contract", intern: "Intern" };
const num = (n: number) => Math.round(n * 100) / 100;

export async function buildReport(actor: Actor | null, kind: string, opts: { year?: number; month?: number } = {}): Promise<Report> {
  requireRole(actor, "hr_admin");
  const today = todayIST();

  if (kind === "headcount") {
    const rows = await query<{ code: string; full_name: string; department: string | null; location: string; type: string; joined: string }>(
      `select e.employee_code as code, e.full_name, a.department, l.name as location, a.employment_type as type, e.joining_date::text as joined
         from ${ACTIVE_NOW}
        order by e.full_name, e.employee_code`,
      [today],
    );
    return {
      kind, title: "Headcount", subtitle: `${rows.length} active employees on ${today}`, numericFrom: 99,
      header: ["Employee code", "Name", "Department", "Location", "Employment type", "Joining date"],
      rows: rows.map((r) => [r.code, r.full_name, r.department, r.location, TYPE_NAMES[r.type] ?? r.type, r.joined]),
    };
  }

  if (kind === "leave-balances") {
    const rows = await getBalancesReport(actor);
    return {
      kind, title: "Leave balances", subtitle: `Available days (balance minus days held for pending requests) on ${today}`, numericFrom: 3,
      header: ["Employee code", "Name", "Department", "Casual (CL)", "Sick (SL)", "Earned (EL)"],
      rows: rows.map((r) => [r.code, r.fullName, r.department, num(r.available.CL ?? 0), num(r.available.SL ?? 0), num(r.available.EL ?? 0)]),
    };
  }

  if (kind === "attendance-summary") {
    const year = opts.year ?? Number(today.slice(0, 4));
    const month = opts.month ?? Number(today.slice(5, 7));
    const rows = await getMonthSummary(actor, year, month);
    return {
      kind, title: "Attendance summary", numericFrom: 4,
      subtitle: `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}. Missed punches count as absent.`,
      header: ["Employee code", "Name", "Department", "Location", "Present", "Work from home", "Half day", "On leave", "Absent", "Weekly off", "Holiday", "Late marks"],
      rows: rows.map((r) => [r.code, r.fullName, r.department, r.location, r.present, r.wfh, r.halfDay, r.leave, r.absent, r.weeklyOff, r.holiday, r.lateMarks]),
    };
  }

  throw new DomainError("Choose a report from the list.");
}

/** Builds the CSV and records who downloaded what. */
export async function exportReportCsv(actor: Actor | null, kind: string, opts: { year?: number; month?: number } = {}) {
  const report = await buildReport(actor, kind, opts);
  await recordAudit({
    actorEmployeeId: actor!.employeeId,
    action: "report.download",
    entity: "report",
    summary: `${report.title} (${report.rows.length} rows)${kind === "attendance-summary" ? ` ${opts.year}-${String(opts.month).padStart(2, "0")}` : ""}`,
  });
  return { filename: `${kind}-${todayIST()}.csv`, csv: toCsv(report.header, report.rows) };
}
