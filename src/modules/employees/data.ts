import "server-only";
import { query, transaction, type Queryable } from "@/shared/db";
import { recordAudit } from "@/shared/audit";
import { ForbiddenError, requireRole, type Actor, type Role } from "@/shared/roles";
import { DomainError } from "@/shared/errors";
import { formatDate, todayIST } from "@/shared/dates";
import type { ChangeAssignmentInput, DeactivateInput, ListFilter, NewEmployeeInput } from "./schemas";
import { PAGE_SIZE } from "./schemas";

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

// ---------------------------------------------------------------------------------------------
// People (HR admin only). Every function checks the role itself before touching the database.
// Write functions come in two forms: `xxx` opens a transaction, `xxxTx` runs inside one so that
// tests can roll everything back.
// ---------------------------------------------------------------------------------------------

export type PeopleLookups = {
  locations: { id: string; name: string }[];
  departments: string[];
  managers: { id: string; code: string; fullName: string }[];
};

export type EmployeeListRow = {
  id: string;
  code: string;
  fullName: string;
  workEmail: string;
  status: "active" | "inactive";
  signedIn: boolean;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  location: string | null;
  managerName: string | null;
};

export type EmployeeList = { rows: EmployeeListRow[]; total: number; page: number; pageSize: number };

export type AssignmentRow = {
  id: string;
  locationId: string;
  location: string;
  department: string;
  designation: string;
  employmentType: string;
  managerName: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type EmployeeProfile = {
  id: string;
  code: string;
  fullName: string;
  workEmail: string;
  gender: string | null;
  dateOfBirth: string | null;
  joiningDate: string;
  exitDate: string | null;
  status: "active" | "inactive";
  signedIn: boolean;
  roles: string[];
  current: AssignmentRow | null;
  managerId: string | null;
  directReports: { id: string; code: string; fullName: string; designation: string }[];
  history: AssignmentRow[];
};

const CURRENT = `a.effective_from <= $1::date and (a.effective_to is null or a.effective_to >= $1::date)`;

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function getPeopleLookups(actor: Actor | null): Promise<PeopleLookups> {
  requireRole(actor, "hr_admin");
  const [locations, departments, managers] = await Promise.all([
    query<{ id: string; name: string }>("select id, name from location order by name"),
    query<{ department: string }>("select distinct department from employment_assignment order by department"),
    query<{ id: string; employee_code: string; full_name: string }>(
      "select id, employee_code, full_name from employee where status = 'active' order by full_name",
    ),
  ]);
  return {
    locations,
    departments: departments.map((d) => d.department),
    managers: managers.map((m) => ({ id: m.id, code: m.employee_code, fullName: m.full_name })),
  };
}

export async function listEmployees(actor: Actor | null, filter: ListFilter): Promise<EmployeeList> {
  requireRole(actor, "hr_admin");
  const today = todayIST();
  const rows = await query<{
    id: string;
    employee_code: string;
    full_name: string;
    work_email: string;
    status: "active" | "inactive";
    signed_in: boolean;
    department: string | null;
    designation: string | null;
    employment_type: string | null;
    location: string | null;
    manager_name: string | null;
    total: number;
  }>(
    `select e.id, e.employee_code, e.full_name, e.work_email, e.status,
            (e.clerk_user_id is not null) as signed_in,
            a.department, a.designation, a.employment_type, l.name as location, m.full_name as manager_name,
            (count(*) over ())::int as total
       from employee e
       left join employment_assignment a on a.employee_id = e.id and ${CURRENT}
       left join location l on l.id = a.location_id
       left join employee m on m.id = a.manager_id
      where ($2::text = 'all' or e.status = $2::text)
        and ($3::uuid is null or a.location_id = $3::uuid)
        and ($4::text is null or a.department = $4::text)
        and ($5::text is null or e.full_name ilike $5::text or e.employee_code ilike $5::text or e.work_email ilike $5::text)
      order by e.full_name, e.employee_code
      limit ${PAGE_SIZE} offset $6::int`,
    [today, filter.status, filter.location ?? null, filter.department ?? null, filter.q ? likePattern(filter.q) : null, (filter.page - 1) * PAGE_SIZE],
  );
  return {
    rows: rows.map((r) => ({
      id: r.id,
      code: r.employee_code,
      fullName: r.full_name,
      workEmail: r.work_email,
      status: r.status,
      signedIn: r.signed_in,
      department: r.department,
      designation: r.designation,
      employmentType: r.employment_type,
      location: r.location,
      managerName: r.manager_name,
    })),
    total: rows[0]?.total ?? 0,
    page: filter.page,
    pageSize: PAGE_SIZE,
  };
}

export async function getEmployeeProfile(actor: Actor | null, employeeId: string): Promise<EmployeeProfile | null> {
  requireRole(actor, "hr_admin");
  const today = todayIST();
  const [emp, roles, history, reports] = await Promise.all([
    query<{
      id: string;
      employee_code: string;
      full_name: string;
      work_email: string;
      gender: string | null;
      date_of_birth: string | null;
      joining_date: string;
      exit_date: string | null;
      status: "active" | "inactive";
      signed_in: boolean;
    }>(
      `select id, employee_code, full_name, work_email, gender, date_of_birth::text, joining_date::text,
              exit_date::text, status, (clerk_user_id is not null) as signed_in
         from employee where id = $1`,
      [employeeId],
    ),
    query<{ role: string }>("select role from employee_role where employee_id = $1 order by role", [employeeId]),
    query<{
      id: string;
      location_id: string;
      location: string;
      department: string;
      designation: string;
      employment_type: string;
      manager_id: string | null;
      manager_name: string | null;
      effective_from: string;
      effective_to: string | null;
    }>(
      `select a.id, a.location_id, l.name as location, a.department, a.designation, a.employment_type, a.manager_id,
              m.full_name as manager_name, a.effective_from::text, a.effective_to::text
         from employment_assignment a
         join location l on l.id = a.location_id
         left join employee m on m.id = a.manager_id
        where a.employee_id = $1
        order by a.effective_from desc`,
      [employeeId],
    ),
    query<{ id: string; employee_code: string; full_name: string; designation: string }>(
      `select e.id, e.employee_code, e.full_name, a.designation
         from employment_assignment a join employee e on e.id = a.employee_id
        where a.manager_id = $1 and a.effective_to is null and e.status = 'active'
        order by e.full_name`,
      [employeeId],
    ),
  ]);
  const e = emp[0];
  if (!e) return null;

  const mapped: (AssignmentRow & { managerId: string | null })[] = history.map((h) => ({
    id: h.id,
    locationId: h.location_id,
    location: h.location,
    department: h.department,
    designation: h.designation,
    employmentType: h.employment_type,
    managerName: h.manager_name,
    managerId: h.manager_id,
    effectiveFrom: h.effective_from,
    effectiveTo: h.effective_to,
  }));
  const current = mapped.find((h) => h.effectiveFrom <= today && (h.effectiveTo === null || h.effectiveTo >= today)) ?? null;

  return {
    id: e.id,
    code: e.employee_code,
    fullName: e.full_name,
    workEmail: e.work_email,
    gender: e.gender,
    dateOfBirth: e.date_of_birth,
    joiningDate: e.joining_date,
    exitDate: e.exit_date,
    status: e.status,
    signedIn: e.signed_in,
    roles: roles.map((r) => r.role),
    current,
    managerId: current?.managerId ?? null,
    directReports: reports.map((r) => ({ id: r.id, code: r.employee_code, fullName: r.full_name, designation: r.designation })),
    history: mapped,
  };
}

async function assertValidLocation(tx: Queryable, locationId: string) {
  const rows = await tx.query("select 1 from location where id = $1", [locationId]);
  if (rows.length === 0) throw new DomainError("Choose a valid location.", "locationId");
}

/** The manager must exist, be active, not be the employee, and not already report to the employee. */
async function assertValidManager(tx: Queryable, managerId: string, employeeId: string | null) {
  const rows = await tx.query<{ status: string }>("select status from employee where id = $1", [managerId]);
  if (rows.length === 0) throw new DomainError("The manager you chose does not exist.", "managerId");
  if (rows[0].status !== "active") throw new DomainError("The manager must be an active employee.", "managerId");
  if (employeeId === null) return;
  if (managerId === employeeId) throw new DomainError("An employee cannot be their own manager.", "managerId");
  const loop = await tx.query(
    `with recursive up(id) as (
       select $1::uuid
       union
       select a.manager_id from up join employment_assignment a
         on a.employee_id = up.id and a.effective_to is null
      where a.manager_id is not null
     )
     select 1 from up where id = $2::uuid limit 1`,
    [managerId, employeeId],
  );
  if (loop.length > 0) throw new DomainError("That manager already reports, directly or indirectly, to this employee.", "managerId");
}


export async function createEmployeeTx(
  tx: Queryable,
  actor: Actor | null,
  input: NewEmployeeInput,
  // `employeeCode` is for the go-live import (P6, R29) and for tests that must not use the
  // sequence. The web form never sets it, so new people always get a generated code.
  opts: { employeeCode?: string } = {},
): Promise<{ id: string; employeeCode: string }> {
  requireRole(actor, "hr_admin");
  const dup = await tx.query("select 1 from employee where lower(work_email) = lower($1)", [input.workEmail]);
  if (dup.length > 0) throw new DomainError("An employee with this work email already exists.", "workEmail");
  await assertValidLocation(tx, input.locationId);
  if (input.managerId) await assertValidManager(tx, input.managerId, null);

  const created = opts.employeeCode
    ? await tx.query<{ id: string; employee_code: string }>(
        `insert into employee (employee_code, full_name, work_email, gender, date_of_birth, joining_date)
         values ($6, $1, $2, $3, $4, $5) returning id, employee_code`,
        [input.fullName, input.workEmail, input.gender ?? null, input.dateOfBirth ?? null, input.joiningDate, opts.employeeCode],
      )
    : await tx.query<{ id: string; employee_code: string }>(
        `insert into employee (full_name, work_email, gender, date_of_birth, joining_date)
         values ($1, $2, $3, $4, $5) returning id, employee_code`,
        [input.fullName, input.workEmail, input.gender ?? null, input.dateOfBirth ?? null, input.joiningDate],
      );
  const { id, employee_code: employeeCode } = created[0];
  await tx.query(
    `insert into employment_assignment
       (employee_id, location_id, department, designation, manager_id, employment_type, effective_from)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.locationId, input.department, input.designation, input.managerId ?? null, input.employmentType, input.joiningDate],
  );
  await recordAudit(
    { actorEmployeeId: actor.employeeId, action: "employee_created", entity: "employee", entityId: id, summary: `Created ${employeeCode}, joining ${input.joiningDate}` },
    tx,
  );
  return { id, employeeCode };
}

export async function createEmployee(actor: Actor | null, input: NewEmployeeInput) {
  requireRole(actor, "hr_admin");
  try {
    return await transaction((tx) => createEmployeeTx(tx, actor, input));
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("An employee with this work email already exists.", "workEmail");
    throw err;
  }
}

export async function changeAssignmentTx(
  tx: Queryable,
  actor: Actor | null,
  employeeId: string,
  input: ChangeAssignmentInput,
): Promise<void> {
  requireRole(actor, "hr_admin");
  const emp = await tx.query<{ status: string }>("select status from employee where id = $1 for update", [employeeId]);
  if (emp.length === 0) throw new DomainError("Employee not found.");
  if (emp[0].status !== "active") throw new DomainError("Reactivate this employee before changing their assignment.");

  const cur = (
    await tx.query<{
      id: string;
      location_id: string;
      department: string;
      designation: string;
      employment_type: string;
      manager_id: string | null;
      effective_from: string;
    }>(
      `select id, location_id, department, designation, employment_type, manager_id, effective_from::text
         from employment_assignment where employee_id = $1 and effective_to is null for update`,
      [employeeId],
    )
  )[0];
  if (!cur) throw new DomainError("This employee has no open assignment to change.");
  if (input.effectiveFrom <= cur.effective_from) {
    throw new DomainError(`The new assignment must start after the current one began on ${formatDate(cur.effective_from)}.`, "effectiveFrom");
  }
  await assertValidLocation(tx, input.locationId);
  if (input.managerId) await assertValidManager(tx, input.managerId, employeeId);

  const changes: string[] = [];
  if (cur.location_id !== input.locationId) changes.push("location");
  if (cur.department !== input.department) changes.push(`department ${cur.department} to ${input.department}`);
  if (cur.designation !== input.designation) changes.push(`designation ${cur.designation} to ${input.designation}`);
  if (cur.employment_type !== input.employmentType) changes.push(`type ${cur.employment_type} to ${input.employmentType}`);
  if ((cur.manager_id ?? null) !== (input.managerId ?? null)) changes.push("manager");
  if (changes.length === 0) throw new DomainError("Nothing has changed. Change at least one detail.");

  await tx.query("update employment_assignment set effective_to = ($1::date - 1) where id = $2", [input.effectiveFrom, cur.id]);
  await tx.query(
    `insert into employment_assignment
       (employee_id, location_id, department, designation, manager_id, employment_type, effective_from)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [employeeId, input.locationId, input.department, input.designation, input.managerId ?? null, input.employmentType, input.effectiveFrom],
  );
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "assignment_changed",
      entity: "employee",
      entityId: employeeId,
      summary: `Effective ${input.effectiveFrom}: ${changes.join("; ")}`,
    },
    tx,
  );
}

export async function changeAssignment(actor: Actor | null, employeeId: string, input: ChangeAssignmentInput) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => changeAssignmentTx(tx, actor, employeeId, input));
}

export async function deactivateEmployeeTx(
  tx: Queryable,
  actor: Actor | null,
  employeeId: string,
  input: DeactivateInput,
): Promise<void> {
  requireRole(actor, "hr_admin");
  if (actor.employeeId === employeeId) throw new DomainError("You cannot deactivate your own account.");

  const emp = (
    await tx.query<{ status: string; joining_date: string }>(
      "select status, joining_date::text from employee where id = $1 for update",
      [employeeId],
    )
  )[0];
  if (!emp) throw new DomainError("Employee not found.");
  if (emp.status !== "active") throw new DomainError("This employee is already inactive.");
  if (input.exitDate < emp.joining_date) throw new DomainError("The exit date cannot be before the joining date.", "exitDate");

  const reports = await tx.query<{ n: number }>(
    `select count(*)::int as n from employment_assignment a join employee e on e.id = a.employee_id
      where a.manager_id = $1 and a.effective_to is null and e.status = 'active'`,
    [employeeId],
  );
  if (reports[0].n > 0) {
    throw new DomainError(`${reports[0].n} active ${reports[0].n === 1 ? "employee still reports" : "employees still report"} to this person. Give them a new manager first.`);
  }
  const isHr = await tx.query("select 1 from employee_role where employee_id = $1 and role = 'hr_admin'", [employeeId]);
  if (isHr.length > 0) {
    const others = await tx.query<{ n: number }>(
      `select count(*)::int as n from employee_role r join employee e on e.id = r.employee_id
        where r.role = 'hr_admin' and e.status = 'active' and e.id <> $1`,
      [employeeId],
    );
    if (others[0].n === 0) throw new DomainError("This is the last active HR admin. Make someone else an HR admin first.");
  }

  await tx.query("update employee set status = 'inactive', exit_date = $2 where id = $1", [employeeId, input.exitDate]);
  await tx.query(
    "update employment_assignment set effective_to = greatest(effective_from, $2::date) where employee_id = $1 and effective_to is null",
    [employeeId, input.exitDate],
  );
  await recordAudit(
    { actorEmployeeId: actor.employeeId, action: "employee_deactivated", entity: "employee", entityId: employeeId, summary: `Exit date ${input.exitDate}` },
    tx,
  );
}

export async function deactivateEmployee(actor: Actor | null, employeeId: string, input: DeactivateInput) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => deactivateEmployeeTx(tx, actor, employeeId, input));
}

export async function reactivateEmployeeTx(tx: Queryable, actor: Actor | null, employeeId: string): Promise<void> {
  requireRole(actor, "hr_admin");
  const emp = (await tx.query<{ status: string }>("select status from employee where id = $1 for update", [employeeId]))[0];
  if (!emp) throw new DomainError("Employee not found.");
  if (emp.status !== "inactive") throw new DomainError("This employee is already active.");

  await tx.query("update employee set status = 'active', exit_date = null where id = $1", [employeeId]);
  await tx.query(
    `update employment_assignment set effective_to = null
      where id = (select id from employment_assignment where employee_id = $1 order by effective_from desc limit 1)`,
    [employeeId],
  );
  await recordAudit(
    { actorEmployeeId: actor.employeeId, action: "employee_reactivated", entity: "employee", entityId: employeeId, summary: "Reactivated" },
    tx,
  );
}

export async function reactivateEmployee(actor: Actor | null, employeeId: string) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => reactivateEmployeeTx(tx, actor, employeeId));
}

// ---------------------------------------------------------------------------------------------
// Workforce facts for other modules (attendance). HR can ask about everyone; anyone else can only
// ask about themself.
// ---------------------------------------------------------------------------------------------

export type WorkforceRow = {
  id: string;
  code: string;
  fullName: string;
  department: string | null;
  locationId: string | null;
  locationName: string | null;
  weeklyOffDays: number[];
};

/** Active employees with the location and department effective on `date`. `null` ids means everyone (HR only). */
export async function getWorkforce(
  actor: Actor | null,
  employeeIds: string[] | null,
  date: string,
  q: Queryable = { query },
): Promise<WorkforceRow[]> {
  requireRole(actor, "employee");
  if (employeeIds === null) requireRole(actor, "hr_admin");
  else if (!actor.roles.includes("hr_admin") && employeeIds.some((id) => id !== actor.employeeId)) {
    throw new ForbiddenError();
  }
  const rows = await q.query<{
    id: string;
    employee_code: string;
    full_name: string;
    department: string | null;
    location_id: string | null;
    location_name: string | null;
    weekly_off_days: number[] | null;
  }>(
    `select e.id, e.employee_code, e.full_name, a.department, l.id as location_id, l.name as location_name, l.weekly_off_days
       from employee e
       left join employment_assignment a on a.employee_id = e.id
        and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)
       left join location l on l.id = a.location_id
      where e.status = 'active' and ($1::uuid[] is null or e.id = any($1::uuid[]))
      order by e.full_name, e.employee_code`,
    [employeeIds, date],
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.employee_code,
    fullName: r.full_name,
    department: r.department,
    locationId: r.location_id,
    locationName: r.location_name,
    weeklyOffDays: r.weekly_off_days ?? [0, 6],
  }));
}
