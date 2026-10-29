import "server-only";
import { query, transaction } from "@/shared/db";
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

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Links a Clerk user to the employee row with the same VERIFIED work email, once.
 * The link and its audit entry are written in one transaction. An unlinked, unmatched Clerk user
 * gets no access (decision P2). Only "already linked elsewhere" is treated as no-match; any other
 * database error is thrown so it is not mistaken for "not linked".
 */
export async function linkActorByVerifiedEmail(clerkUserId: string, verifiedEmail: string): Promise<Actor | null> {
  let linkedId: string | null;
  try {
    linkedId = await transaction(async (tx) => {
      const rows = await tx.query<{ id: string }>(
        `update employee
            set clerk_user_id = $1
          where lower(work_email) = lower($2) and clerk_user_id is null and status = 'active'
          returning id`,
        [clerkUserId, verifiedEmail],
      );
      if (rows.length !== 1) return null;
      await recordAudit(
        {
          actorEmployeeId: rows[0].id,
          action: "link_sign_in",
          entity: "employee",
          entityId: rows[0].id,
          summary: "Clerk account linked by verified email",
        },
        tx,
      );
      return rows[0].id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null; // this Clerk user is already linked to another employee
    throw err;
  }
  if (!linkedId) return null;
  return findActorByClerkUserId(clerkUserId);
}
