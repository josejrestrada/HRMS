import "server-only";
import { query, transaction, type Queryable } from "@/shared/db";
import { recordAudit } from "@/shared/audit";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, requireRole, type Actor } from "@/shared/roles";
import { addDays, formatDate, todayIST } from "@/shared/dates";
import type { ApplyLeaveInput, DecisionInput } from "./schemas";
import {
  accrualMonths,
  canCancel,
  canDecide,
  checkApplication,
  countLeaveDays,
  elAccrualForMonth,
  fmtDays,
  lastDayOfMonth,
  proratedGrant,
  workingDaysInMonth,
  type DayPart,
} from "./rules";

// Leave data access. Every function takes the acting user and checks what they may do. Write
// functions come in two forms: `xxx` opens a transaction, `xxxTx` runs inside one (for tests).

const HOLDS = `'pending_hold', 'hold_release'`;
const BALANCE_TYPES = ["CL", "SL", "EL"];

export type Balance = {
  typeId: string;
  code: string;
  name: string;
  annualQuota: number | null;
  balance: number;
  held: number;
  available: number;
};

export type LeaveRequestRow = {
  id: string;
  typeCode: string;
  typeName: string;
  startDate: string;
  endDate: string;
  dayPart: DayPart;
  days: number;
  lopDays: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
  decisionNote: string | null;
  certificateRequired: boolean;
  canCancel: boolean;
};

export type LeaveOverview = { today: string; balances: Balance[]; requests: LeaveRequestRow[] };

export type ApplyContext = {
  today: string;
  locationName: string;
  weeklyOffDays: number[];
  holidays: Record<string, string>;
  types: { id: string; code: string; name: string; maxConsecutiveDays: number | null; available: number }[];
};

export type StatementEntry = {
  id: string;
  date: string;
  reason: string;
  delta: number;
  isHold: boolean;
  running: number | null;
  note: string | null;
};

export type Statement = { code: string; name: string; balance: number; held: number; entries: StatementEntry[] };

export type ApprovalRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  typeCode: string;
  typeName: string;
  startDate: string;
  endDate: string;
  dayPart: DayPart;
  days: number;
  lopDays: number;
  reason: string | null;
  certificateRequired: boolean;
  waitingDays: number;
};

function requireEmployee(actor: Actor | null): asserts actor is Actor {
  requireRole(actor, "employee");
}

const isHr = (actor: Actor) => actor.roles.includes("hr_admin");

// ---------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------

async function balancesFor(q: Queryable, employeeId: string, codes: string[]): Promise<Balance[]> {
  const rows = await q.query<{
    id: string;
    code: string;
    name: string;
    quota: number | null;
    balance: number;
    held: number;
  }>(
    `select t.id, t.code, t.name, t.annual_quota::float8 as quota,
            coalesce(sum(l.delta) filter (where l.reason not in (${HOLDS})), 0)::float8 as balance,
            coalesce(-sum(l.delta) filter (where l.reason in (${HOLDS})), 0)::float8 as held
       from leave_type t
       left join leave_ledger l on l.leave_type_id = t.id and l.employee_id = $1
      where t.code = any($2::text[]) and t.active
      group by t.id
      order by array_position($2::text[], t.code)`,
    [employeeId, codes],
  );
  return rows.map((r) => ({
    typeId: r.id,
    code: r.code,
    name: r.name,
    annualQuota: r.quota,
    balance: r.balance,
    held: r.held,
    available: r.balance - r.held,
  }));
}

export async function getLeaveOverview(actor: Actor | null): Promise<LeaveOverview> {
  requireEmployee(actor);
  const today = todayIST();
  const [balances, requests] = await Promise.all([
    balancesFor({ query }, actor.employeeId, BALANCE_TYPES),
    query<{
      id: string;
      code: string;
      name: string;
      start_date: string;
      end_date: string;
      day_part: DayPart;
      days: number;
      lop_days: number;
      status: LeaveRequestRow["status"];
      reason: string | null;
      decision_note: string | null;
      certificate_required: boolean;
    }>(
      `select lr.id, t.code, t.name, lr.start_date::text, lr.end_date::text, lr.day_part, lr.days::float8 as days,
              lr.lop_days::float8 as lop_days, lr.status, lr.reason, lr.decision_note, lr.certificate_required
         from leave_request lr join leave_type t on t.id = lr.leave_type_id
        where lr.employee_id = $1
        order by lr.start_date desc, lr.created_at desc
        limit 25`,
      [actor.employeeId],
    ),
  ]);
  return {
    today,
    balances,
    requests: requests.map((r) => ({
      id: r.id,
      typeCode: r.code,
      typeName: r.name,
      startDate: r.start_date,
      endDate: r.end_date,
      dayPart: r.day_part,
      days: r.days,
      lopDays: r.lop_days,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decision_note,
      certificateRequired: r.certificate_required,
      canCancel: canCancel({
        actorEmployeeId: actor.employeeId,
        actorIsHrAdmin: false,
        requesterEmployeeId: actor.employeeId,
        status: r.status,
        startDate: r.start_date,
        today,
      }),
    })),
  };
}

export async function getApplyContext(actor: Actor | null): Promise<ApplyContext | null> {
  requireEmployee(actor);
  const today = todayIST();
  const loc = (
    await query<{ id: string; name: string; weekly_off_days: number[] }>(
      `select l.id, l.name, l.weekly_off_days
         from employment_assignment a join location l on l.id = a.location_id
        where a.employee_id = $1 and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)`,
      [actor.employeeId, today],
    )
  )[0];
  if (!loc) return null;
  const [holidays, balances, types] = await Promise.all([
    query<{ d: string; name: string }>(
      `select holiday_date::text as d, name from holiday
        where location_id = $1 and type in ('national', 'state') and holiday_date between $2::date and $3::date`,
      [loc.id, addDays(today, -30), addDays(today, 400)],
    ),
    balancesFor({ query }, actor.employeeId, BALANCE_TYPES),
    query<{ id: string; code: string; name: string; max: number | null }>(
      `select id, code, name, max_consecutive_days as max from leave_type
        where active and (code = 'LOP' or code = any($1::text[]))
        order by array_position(array['CL','SL','EL','LOP'], code)`,
      [BALANCE_TYPES],
    ),
  ]);
  const available = Object.fromEntries(balances.map((b) => [b.code, b.available]));
  return {
    today,
    locationName: loc.name,
    weeklyOffDays: loc.weekly_off_days,
    holidays: Object.fromEntries(holidays.map((h) => [h.d, h.name])),
    types: types.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      maxConsecutiveDays: t.max,
      available: available[t.code] ?? 0,
    })),
  };
}

export async function getStatement(actor: Actor | null, typeCode: string): Promise<Statement | null> {
  requireEmployee(actor);
  const [bal] = await balancesFor({ query }, actor.employeeId, [typeCode]);
  if (!bal || !BALANCE_TYPES.includes(typeCode)) return null;
  const rows = await query<{ id: string; entry_date: string; reason: string; delta: number; note: string | null }>(
    `select id::text, entry_date::text, reason, delta::float8 as delta, note
       from leave_ledger where employee_id = $1 and leave_type_id = $2 order by id asc limit 500`,
    [actor.employeeId, bal.typeId],
  );
  let running = 0;
  const entries: StatementEntry[] = rows.map((r) => {
    const isHold = r.reason === "pending_hold" || r.reason === "hold_release";
    if (!isHold) running += r.delta;
    return { id: r.id, date: r.entry_date, reason: r.reason, delta: r.delta, isHold, running: isHold ? null : running, note: r.note };
  });
  return { code: bal.code, name: bal.name, balance: bal.balance, held: bal.held, entries: entries.reverse() };
}

// ---------------------------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------------------------

export async function applyLeaveTx(tx: Queryable, actor: Actor | null, input: ApplyLeaveInput): Promise<{ requestId: string }> {
  requireEmployee(actor);
  const today = todayIST();

  const emp = (await tx.query<{ status: string }>("select status from employee where id = $1 for update", [actor.employeeId]))[0];
  if (!emp || emp.status !== "active") throw new DomainError("Only active employees can apply for leave."); // R5

  const type = (
    await tx.query<{ id: string; code: string; name: string; accrual_mode: string; max: number | null }>(
      "select id, code, name, accrual_mode, max_consecutive_days as max from leave_type where id = $1 and active",
      [input.leaveTypeId],
    )
  )[0];
  if (!type) throw new DomainError("Choose a valid leave type.", "leaveTypeId");
  if (!(type.accrual_mode === "upfront" || type.accrual_mode === "monthly" || type.code === "LOP")) {
    throw new DomainError("That kind of leave cannot be requested here yet. Please contact HR.", "leaveTypeId");
  }

  // R32 (simplified): the location on the assignment effective on the start date.
  const loc = (
    await tx.query<{ id: string; weekly_off_days: number[] }>(
      `select l.id, l.weekly_off_days
         from employment_assignment a join location l on l.id = a.location_id
        where a.employee_id = $1 and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)`,
      [actor.employeeId, input.startDate],
    )
  )[0];
  if (!loc) throw new DomainError("You have no job assignment on those dates. Please contact HR.", "startDate");

  const holidays = await tx.query<{ d: string; name: string }>(
    `select holiday_date::text as d, name from holiday
      where location_id = $1 and type in ('national', 'state') and holiday_date between $2::date and $3::date`,
    [loc.id, input.startDate, input.endDate],
  );
  const { days } = countLeaveDays({
    start: input.startDate,
    end: input.endDate,
    dayPart: input.dayPart,
    weeklyOffDays: loc.weekly_off_days,
    holidays: Object.fromEntries(holidays.map((h) => [h.d, h.name])),
  });

  // R17: no overlap with pending or approved leave.
  const overlap = await tx.query<{ s: string; e: string }>(
    `select start_date::text as s, end_date::text as e from leave_request
      where employee_id = $1 and status in ('pending', 'approved')
        and daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]') limit 1`,
    [actor.employeeId, input.startDate, input.endDate],
  );
  if (overlap.length > 0) {
    throw new DomainError(`You already have leave from ${formatDate(overlap[0].s)} to ${formatDate(overlap[0].e)} that overlaps these dates.`, "startDate");
  }

  const [bal] = await balancesFor(tx, actor.employeeId, [type.code]);
  const check = checkApplication({
    today,
    start: input.startDate,
    end: input.endDate,
    dayPart: input.dayPart,
    days,
    typeCode: type.code,
    typeName: type.name,
    maxConsecutiveDays: type.max,
    available: bal?.available ?? 0,
    convertShortfallToLop: input.convertShortfallToLop,
  });
  if (!check.ok) throw new DomainError(check.error, check.field);

  const created = await tx.query<{ id: string }>(
    `insert into leave_request
       (employee_id, leave_type_id, start_date, end_date, day_part, days, lop_days, reason, certificate_required)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [actor.employeeId, type.id, input.startDate, input.endDate, input.dayPart, check.days, check.lopDays, input.reason ?? null, check.certificateRequired],
  );
  const requestId = created[0].id;
  if (check.heldDays > 0) {
    await tx.query(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id)
       values ($1, $2, $3, $4, $5, 'pending_hold', $6)`,
      [actor.employeeId, type.id, Number(input.startDate.slice(0, 4)), today, -check.heldDays, requestId],
    );
  }
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "leave_applied",
      entity: "leave_request",
      entityId: requestId,
      summary: `${type.code} ${input.startDate} to ${input.endDate}, ${fmtDays(check.days)}`,
    },
    tx,
  );
  return { requestId };
}

export async function applyLeave(actor: Actor | null, input: ApplyLeaveInput) {
  requireEmployee(actor);
  return transaction((tx) => applyLeaveTx(tx, actor, input));
}

// ---------------------------------------------------------------------------------------------
// Decide and cancel
// ---------------------------------------------------------------------------------------------

type LockedRequest = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  lop_days: number;
  status: string;
};

async function lockRequest(tx: Queryable, requestId: string): Promise<LockedRequest> {
  const rows = await tx.query<LockedRequest>(
    `select id, employee_id, leave_type_id, start_date::text, end_date::text, days::float8 as days,
            lop_days::float8 as lop_days, status
       from leave_request where id = $1 for update`,
    [requestId],
  );
  if (rows.length === 0) throw new DomainError("That leave request was not found.");
  return rows[0];
}

async function isManagerOf(tx: Queryable, managerId: string, employeeId: string): Promise<boolean> {
  const rows = await tx.query(
    "select 1 from employment_assignment where employee_id = $1 and manager_id = $2 and effective_to is null",
    [employeeId, managerId],
  );
  return rows.length > 0;
}

export async function decideLeaveTx(tx: Queryable, actor: Actor | null, input: DecisionInput): Promise<void> {
  requireEmployee(actor);
  const req = await lockRequest(tx, input.requestId);
  if (req.status !== "pending") throw new DomainError("This request has already been decided or cancelled.");

  const allowed = canDecide({
    actorEmployeeId: actor.employeeId,
    actorIsHrAdmin: isHr(actor),
    actorIsManagerOfRequester: await isManagerOf(tx, actor.employeeId, req.employee_id),
    requesterEmployeeId: req.employee_id,
  });
  if (!allowed) throw new ForbiddenError("You cannot decide this request.");

  const held = req.days - req.lop_days;
  const year = Number(req.start_date.slice(0, 4));
  const today = todayIST();
  const entry = (delta: number, reason: string) =>
    tx.query(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [req.employee_id, req.leave_type_id, year, today, delta, reason, req.id],
    );

  if (held > 0) {
    await entry(held, "hold_release");
    if (input.decision === "approve") await entry(-held, "application");
  }
  await tx.query(
    `update leave_request set status = $2, approver_id = $3, decided_at = now(), decision_note = $4 where id = $1`,
    [req.id, input.decision === "approve" ? "approved" : "rejected", actor.employeeId, input.note ?? null],
  );
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: input.decision === "approve" ? "leave_approved" : "leave_rejected",
      entity: "leave_request",
      entityId: req.id,
      summary: `${req.start_date} to ${req.end_date}, ${fmtDays(req.days)}`,
    },
    tx,
  );
}

export async function decideLeave(actor: Actor | null, input: DecisionInput) {
  requireEmployee(actor);
  return transaction((tx) => decideLeaveTx(tx, actor, input));
}

export async function cancelLeaveTx(tx: Queryable, actor: Actor | null, requestId: string): Promise<void> {
  requireEmployee(actor);
  const req = await lockRequest(tx, requestId);
  const today = todayIST();
  if (req.status !== "pending" && req.status !== "approved") throw new DomainError("This request can no longer be cancelled.");

  const mine = req.employee_id === actor.employeeId;
  if (!mine && !isHr(actor)) throw new ForbiddenError("You cannot cancel this request.");
  if (!canCancel({ actorEmployeeId: actor.employeeId, actorIsHrAdmin: isHr(actor), requesterEmployeeId: req.employee_id, status: req.status, startDate: req.start_date, today })) {
    throw new DomainError("Leave that has already started can only be cancelled by HR.");
  }

  const held = req.days - req.lop_days;
  if (held > 0) {
    await tx.query(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [req.employee_id, req.leave_type_id, Number(req.start_date.slice(0, 4)), today, held, req.status === "pending" ? "hold_release" : "cancellation", req.id],
    );
  }
  await tx.query("update leave_request set status = 'cancelled', cancelled_at = now() where id = $1", [req.id]);
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "leave_cancelled",
      entity: "leave_request",
      entityId: req.id,
      summary: `${req.start_date} to ${req.end_date}, ${fmtDays(req.days)}`,
    },
    tx,
  );
}

export async function cancelLeave(actor: Actor | null, requestId: string) {
  requireEmployee(actor);
  return transaction((tx) => cancelLeaveTx(tx, actor, requestId));
}

// ---------------------------------------------------------------------------------------------
// Approvals inbox
// ---------------------------------------------------------------------------------------------

export async function listApprovals(actor: Actor | null): Promise<ApprovalRow[]> {
  requireEmployee(actor);
  const today = todayIST();
  const rows = await query<{
    id: string;
    employee_id: string;
    employee_code: string;
    full_name: string;
    code: string;
    name: string;
    start_date: string;
    end_date: string;
    day_part: DayPart;
    days: number;
    lop_days: number;
    reason: string | null;
    certificate_required: boolean;
    waiting: number;
  }>(
    `select lr.id, e.id as employee_id, e.employee_code, e.full_name, t.code, t.name,
            lr.start_date::text, lr.end_date::text, lr.day_part, lr.days::float8 as days, lr.lop_days::float8 as lop_days,
            lr.reason, lr.certificate_required,
            ($2::date - (lr.created_at at time zone 'Asia/Kolkata')::date)::int as waiting
       from leave_request lr
       join employee e on e.id = lr.employee_id
       join leave_type t on t.id = lr.leave_type_id
      where lr.status = 'pending' and e.status = 'active' and e.id <> $1
        and ($3::boolean or exists (
              select 1 from employment_assignment a
               where a.employee_id = e.id and a.manager_id = $1 and a.effective_to is null))
      order by lr.created_at
      limit 100`,
    [actor.employeeId, today, isHr(actor)],
  );
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    typeCode: r.code,
    typeName: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    dayPart: r.day_part,
    days: r.days,
    lopDays: r.lop_days,
    reason: r.reason,
    certificateRequired: r.certificate_required,
    waitingDays: r.waiting,
  }));
}

/** For the navigation: can this person approve anything, and how many requests are waiting? */
export async function getApprovalScope(actor: Actor | null): Promise<{ canApprove: boolean; pending: number }> {
  requireEmployee(actor);
  const reports = await query<{ n: number }>(
    `select count(*)::int as n from employment_assignment a join employee e on e.id = a.employee_id
      where a.manager_id = $1 and a.effective_to is null and e.status = 'active'`,
    [actor.employeeId],
  );
  const canApprove = isHr(actor) || reports[0].n > 0;
  if (!canApprove) return { canApprove, pending: 0 };
  const pending = await listApprovals(actor);
  return { canApprove, pending: pending.length };
}

// ---------------------------------------------------------------------------------------------
// Credits (HR): CL and SL grants for the year, EL accrual by month. Idempotent.
// ---------------------------------------------------------------------------------------------

export type CreditsSummary = { year: number; employees: number; grants: number; accruals: number };

export async function runLeaveCreditsTx(tx: Queryable, actor: Actor | null, opts: { year?: number } = {}): Promise<CreditsSummary> {
  requireRole(actor, "hr_admin");
  const today = todayIST();
  const currentYear = Number(today.slice(0, 4));
  const year = opts.year ?? currentYear;
  if (year > currentYear || year < 2000) throw new DomainError("Choose the current year or an earlier one.");

  const [types, employees, assignments, locations, holidayRows, lopRows] = await Promise.all([
    tx.query<{ id: string; code: string; quota: number; mode: string; floor: number | null }>(
      `select id, code, annual_quota::float8 as quota, accrual_mode as mode, statutory_floor::float8 as floor
         from leave_type where active and annual_quota is not null and accrual_mode in ('upfront', 'monthly')`,
    ),
    tx.query<{ id: string; joining_date: string }>("select id, joining_date::text from employee where status = 'active'"),
    tx.query<{ employee_id: string; location_id: string }>("select employee_id, location_id from employment_assignment where effective_to is null"),
    tx.query<{ id: string; weekly_off_days: number[] }>("select id, weekly_off_days from location"),
    tx.query<{ location_id: string; d: string; name: string }>(
      `select location_id, holiday_date::text as d, name from holiday
        where type in ('national', 'state') and holiday_date between $1::date and $2::date`,
      [`${year}-01-01`, `${year}-12-31`],
    ),
    tx.query<{ employee_id: string; code: string; start_date: string; end_date: string; lop_days: number; day_part: DayPart }>(
      `select lr.employee_id, t.code, lr.start_date::text, lr.end_date::text, lr.lop_days::float8 as lop_days, lr.day_part
         from leave_request lr join leave_type t on t.id = lr.leave_type_id
        where lr.status = 'approved' and lr.lop_days > 0
          and lr.start_date <= $2::date and lr.end_date >= $1::date`,
      [`${year}-01-01`, `${year}-12-31`],
    ),
  ]);

  const weeklyOff = new Map(locations.map((l) => [l.id, l.weekly_off_days]));
  const holidaysByLocation = new Map<string, Record<string, string>>();
  for (const h of holidayRows) {
    const m = holidaysByLocation.get(h.location_id) ?? {};
    m[h.d] = h.name;
    holidaysByLocation.set(h.location_id, m);
  }
  const locationOf = new Map(assignments.map((a) => [a.employee_id, a.location_id]));
  const lopByEmployee = new Map<string, typeof lopRows>();
  for (const r of lopRows) lopByEmployee.set(r.employee_id, [...(lopByEmployee.get(r.employee_id) ?? []), r]);

  const rows: { employee: string; type: string; date: string; delta: number; reason: string; key: string; note: string }[] = [];
  const employeesWithCredit = new Set<string>();

  for (const emp of employees) {
    for (const t of types) {
      if (t.mode === "upfront") {
        const amount = proratedGrant({ annualQuota: t.quota, statutoryFloor: t.floor, joiningDate: emp.joining_date, year });
        const joinedLater = Number(emp.joining_date.slice(0, 4)) > year;
        if (amount > 0 && !joinedLater) {
          const date = emp.joining_date.startsWith(String(year)) ? emp.joining_date : `${year}-01-01`;
          rows.push({ employee: emp.id, type: t.id, date, delta: amount, reason: "grant", key: `grant:${emp.id}:${t.code}:${year}`, note: `${t.code} grant for ${year}` });
        }
      } else {
        const locationId = locationOf.get(emp.id);
        if (!locationId) continue; // no current assignment: cannot work out working days
        const weekly = weeklyOff.get(locationId) ?? [0, 6];
        const holidays = holidaysByLocation.get(locationId) ?? {};
        for (const month of accrualMonths(emp.joining_date, year, today)) {
          const mm = String(month).padStart(2, "0");
          const monthStart = `${year}-${mm}-01`;
          const monthEnd = `${year}-${mm}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
          let lopDays = 0;
          for (const r of lopByEmployee.get(emp.id) ?? []) {
            if (r.code === "LOP") {
              const start = r.start_date > monthStart ? r.start_date : monthStart;
              const end = r.end_date < monthEnd ? r.end_date : monthEnd;
              if (start <= end) lopDays += countLeaveDays({ start, end, dayPart: r.day_part, weeklyOffDays: weekly, holidays }).days;
            } else if (r.start_date >= monthStart && r.start_date <= monthEnd) {
              lopDays += r.lop_days; // shortfall converted to LOP (R34) counts in the month it starts
            }
          }
          const amount = elAccrualForMonth({
            annualQuota: t.quota,
            lopDays,
            workingDays: workingDaysInMonth(year, month, weekly, holidays),
          });
          if (amount > 0) {
            rows.push({ employee: emp.id, type: t.id, date: monthEnd, delta: amount, reason: "accrual", key: `accrual:${emp.id}:${t.code}:${year}-${mm}`, note: `${t.code} accrual for ${year}-${mm}` });
          }
        }
      }
    }
  }

  let grants = 0;
  let accruals = 0;
  if (rows.length > 0) {
    // One set-based insert; rows that already exist (same key) are skipped, so re-running adds nothing.
    const inserted = await tx.query<{ reason: string; employee_id: string }>(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, ref_key, note)
       select * from unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::date[], $5::numeric[], $6::text[], $7::text[], $8::text[])
       on conflict (ref_key) where ref_key is not null do nothing
       returning reason, employee_id`,
      [
        rows.map((r) => r.employee),
        rows.map((r) => r.type),
        rows.map(() => year),
        rows.map((r) => r.date),
        rows.map((r) => r.delta),
        rows.map((r) => r.reason),
        rows.map((r) => r.key),
        rows.map((r) => r.note),
      ],
    );
    for (const r of inserted) {
      employeesWithCredit.add(r.employee_id);
      if (r.reason === "grant") grants += 1;
      else accruals += 1;
    }
  }

  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "leave_credits_run",
      entity: "leave_ledger",
      summary: `Year ${year}: ${grants} grants, ${accruals} accruals added`,
    },
    tx,
  );
  return { year, employees: employeesWithCredit.size, grants, accruals };
}

export async function runLeaveCredits(actor: Actor | null, opts: { year?: number } = {}) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => runLeaveCreditsTx(tx, actor, opts));
}
