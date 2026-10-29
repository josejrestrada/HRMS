import "server-only";
import { query } from "@/shared/db";
import { recordAudit } from "@/shared/audit";
import type { Actor, Role } from "@/shared/roles";

type ActorRow = { id: string; employee_code: string; full_name: string; roles: Role[] };

// Identity bootstrap: these two functions run before an Actor exists, so they are the only
// data functions that do not take one. They never return anything except the Actor itself.

export async function findActorByClerkUserId(clerkUserId: string): Promise<Actor | null> {
  const rows = await query<ActorRow>(
    `select e.id, e.employee_code, e.full_name,
            coalesce(array_agg(r.role) filter (where r.role is not null), '{}') as roles
       from employee e
       left join employee_role r on r.employee_id = e.id
      where e.clerk_user_id = $1 and e.status = 'active'
      group by e.id`,
    [clerkUserId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    employeeId: row.id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    // Every active, linked employee is an "employee"; extra roles come from the database.
    roles: ["employee", ...row.roles],
  };
}

/**
 * Links a Clerk user to the employee row with the same VERIFIED work email, once.
 * An unlinked, unmatched Clerk user gets no access (decision P2).
 */
export async function linkActorByVerifiedEmail(clerkUserId: string, verifiedEmail: string): Promise<Actor | null> {
  let linked: { id: string }[];
  try {
    linked = await query<{ id: string }>(
      `update employee
          set clerk_user_id = $1
        where lower(work_email) = lower($2) and clerk_user_id is null and status = 'active'
        returning id`,
      [clerkUserId, verifiedEmail],
    );
  } catch {
    return null; // unique violation: this Clerk user is already linked elsewhere
  }
  if (linked.length !== 1) return null;
  await recordAudit({
    actorEmployeeId: linked[0].id,
    action: "link_sign_in",
    entity: "employee",
    entityId: linked[0].id,
    summary: "Clerk account linked by verified email",
  });
  return findActorByClerkUserId(clerkUserId);
}
