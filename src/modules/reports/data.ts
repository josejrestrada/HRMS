import "server-only";
import { query } from "@/shared/db";
import { requireRole, type Actor } from "@/shared/roles";
import { todayIST } from "@/shared/dates";

export type HrDashboard = {
  today: string;
  headcount: {
    total: number;
    byLocation: { name: string; count: number }[];
    byType: { type: string; count: number }[];
  };
  onLeave: { employeeCode: string; fullName: string; leaveCode: string; startDate: string; endDate: string }[];
  pending: { count: number; oldestAgeDays: number | null };
  attendance: { counts: Record<string, number>; recorded: number; notRecorded: number };
  holidays: { date: string; name: string; type: string; verified: boolean; locations: string[] }[];
  recentJoiners: { employeeCode: string; fullName: string; designation: string; location: string; joiningDate: string }[];
  attention: { withoutManager: number; notSignedIn: number };
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

  const [byLocation, byType, onLeave, pending, attendance, active, holidays, joiners, attention] = await Promise.all([
    query<{ name: string; count: number }>(
      `select l.name, count(*)::int as count from ${ACTIVE_NOW} group by l.name order by l.name`,
      [today],
    ),
    query<{ type: string; count: number }>(
      `select a.employment_type as type, count(*)::int as count from ${ACTIVE_NOW} group by a.employment_type order by 2 desc`,
      [today],
    ),
    query<{ employee_code: string; full_name: string; leave_code: string; start_date: string; end_date: string }>(
      `select e.employee_code, e.full_name, t.code as leave_code,
              lr.start_date::text, lr.end_date::text
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
                   else ($1::date - (min(created_at) at time zone 'Asia/Kolkata')::date) end::int as oldest
         from leave_request where status = 'pending'`,
      [today],
    ),
    query<{ status: string; count: number }>(
      `select ad.status, count(*)::int as count
         from attendance_day ad join employee e on e.id = ad.employee_id
        where ad.work_date = $1::date and e.status = 'active'
        group by ad.status`,
      [today],
    ),
    query<{ count: number }>(`select count(*)::int as count from ${ACTIVE_NOW}`, [today]),
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
  ]);

  const counts: Record<string, number> = {};
  for (const row of attendance) counts[row.status] = row.count;
  const recorded = attendance.reduce((sum, row) => sum + row.count, 0);
  const total = active[0]?.count ?? 0;

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
      startDate: r.start_date,
      endDate: r.end_date,
    })),
    pending: { count: pending[0]?.count ?? 0, oldestAgeDays: pending[0]?.oldest ?? null },
    attendance: { counts, recorded, notRecorded: Math.max(total - recorded, 0) },
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
    },
  };
}
