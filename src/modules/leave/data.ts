import "server-only";
import { query, transaction, type Queryable } from "@/shared/db";
import { recordAudit } from "@/shared/audit";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, requireRole, type Actor } from "@/shared/roles";
import { canDecide } from "@/shared/approvals";
import { firstLockedMonth, lockMonthsShared } from "@/shared/periods";
import { addDays, addMonths, formatDate, todayIST } from "@/shared/dates";
import { getSelfFacts } from "@/modules/employees/data";
import type { ApplyLeaveInput, CompoffInput, DecisionInput, MaternityInput, PaternityInput } from "./schemas";
import {
  COMPOFF_EXPIRY_DAYS,
  accrualMonths,
  allocateCompoff,
  canCancel,
  checkApplication,
  checkCompoff,
  checkMaternity,
  checkPaternity,
  compoffAvailable,
  isSameDelivery,
  countLeaveDays,
  elAccrualForMonth,
  fmtDays,
  lastDayOfMonth,
  proratedGrant,
  workingDaysInMonth,
  yearEndPlan,
  type CompoffCredit,
  type DayPart,
} from "./rules";

// Leave data access. Every function takes the acting user and checks what they may do. Write
// functions come in two forms: `xxx` opens a transaction, `xxxTx` runs inside one (for tests).

const HOLDS = `'pending_hold', 'hold_release'`;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** R62: leave cannot be applied for, or approved, for a month HR has locked. */
async function assertNotInLockedMonth(tx: Queryable, start: string, end: string, field?: string) {
  await lockMonthsShared(tx, [start, end]); // wait for an in-progress month lock (R65)
  const locked = await firstLockedMonth(tx, [start, end]);
  if (locked) {
    const [y, m] = locked.split("-").map(Number);
    throw new DomainError(`${MONTH_NAMES[m - 1]} ${y} is closed, so leave for those dates cannot be changed. Please talk to HR.`, field);
  }
}
const BALANCE_TYPES = ["CL", "SL", "EL"];
const STATEMENT_TYPES = ["CL", "SL", "EL", "COMPOFF"];

/** Every comp-off credit with its remaining days (credit minus what was used or expired). */
async function compoffCredits(q: Queryable, employeeId: string): Promise<CompoffCredit[]> {
  const rows = await q.query<{ id: string; expires_on: string; remaining: number }>(
    `select c.id::text as id, c.expires_on::text as expires_on,
            (c.delta + coalesce(sum(r.delta), 0))::float8 as remaining
       from leave_ledger c
       left join leave_ledger r on r.consumes_entry_id = c.id
      where c.employee_id = $1 and c.reason = 'compoff_credit'
      group by c.id
      order by c.expires_on, c.id`,
    [employeeId],
  );
  return rows.map((r) => ({ id: r.id, remaining: r.remaining, expiresOn: r.expires_on }));
}

async function openHolds(q: Queryable, employeeId: string, typeId: string): Promise<number> {
  const rows = await q.query<{ h: number }>(
    `select coalesce(-sum(delta), 0)::float8 as h from leave_ledger
      where employee_id = $1 and leave_type_id = $2 and reason in (${HOLDS})`,
    [employeeId, typeId],
  );
  return rows[0].h;
}

/** Comp-off as a balance card: days still usable today, not counting expired credits. */
async function compoffBalance(q: Queryable, employeeId: string, today: string): Promise<Balance | null> {
  const credits = await compoffCredits(q, employeeId);
  if (credits.length === 0) return null;
  const type = (await q.query<{ id: string; name: string }>("select id, name from leave_type where code = 'COMPOFF' and active"))[0];
  if (!type) return null;
  const usable = compoffAvailable(credits, today);
  const held = await openHolds(q, employeeId, type.id);
  return { typeId: type.id, code: "COMPOFF", name: type.name, annualQuota: null, balance: usable, held, available: Math.max(0, usable - held) };
}

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
  const compoff = await compoffBalance({ query }, actor.employeeId, today);
  if (compoff) balances.push(compoff);
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
  const compoff = await compoffBalance({ query }, actor.employeeId, today);
  const available = Object.fromEntries(balances.map((b) => [b.code, b.available]));
  if (compoff) {
    available.COMPOFF = compoff.available;
    const ct = await query<{ id: string; name: string }>("select id, name from leave_type where code = 'COMPOFF' and active");
    if (ct[0]) types.push({ id: ct[0].id, code: "COMPOFF", name: ct[0].name, max: null });
  }
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
  if (!STATEMENT_TYPES.includes(typeCode)) return null;
  const [bal] = await balancesFor({ query }, actor.employeeId, [typeCode]);
  if (!bal) return null;
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
  await assertNotInLockedMonth(tx, input.startDate, input.endDate, "startDate");

  const type = (
    await tx.query<{ id: string; code: string; name: string; accrual_mode: string; max: number | null }>(
      "select id, code, name, accrual_mode, max_consecutive_days as max from leave_type where id = $1 and active",
      [input.leaveTypeId],
    )
  )[0];
  if (!type) throw new DomainError("Choose a valid leave type.", "leaveTypeId");
  if (type.code === "MAT" || type.code === "PAT") {
    throw new DomainError("Use the maternity or paternity leave page for this kind of leave.", "leaveTypeId");
  }
  if (!(type.accrual_mode === "upfront" || type.accrual_mode === "monthly" || type.code === "LOP" || type.code === "COMPOFF")) {
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
  let available = bal?.available ?? 0;
  if (type.code === "COMPOFF") {
    // Only credits that have not expired by the last leave date can be used (R51).
    const credits = await compoffCredits(tx, actor.employeeId);
    available = Math.max(0, compoffAvailable(credits, input.endDate) - (await openHolds(tx, actor.employeeId, type.id)));
  }
  const check = checkApplication({
    today,
    start: input.startDate,
    end: input.endDate,
    dayPart: input.dayPart,
    days,
    typeCode: type.code,
    typeName: type.name,
    maxConsecutiveDays: type.max,
    available,
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
  type_code: string;
  held: number;
  start_date: string;
  end_date: string;
  days: number;
  lop_days: number;
  status: string;
};

async function lockRequest(tx: Queryable, requestId: string): Promise<LockedRequest> {
  const rows = await tx.query<LockedRequest>(
    `select lr.id, lr.employee_id, lr.leave_type_id, t.code as type_code,
            (case when t.code in ('MAT', 'PAT') then 0 else lr.days - lr.lop_days end)::float8 as held,
            lr.start_date::text, lr.end_date::text, lr.days::float8 as days, lr.lop_days::float8 as lop_days, lr.status
       from leave_request lr join leave_type t on t.id = lr.leave_type_id
      where lr.id = $1 for update of lr`,
    [requestId],
  );
  if (rows.length === 0) throw new DomainError("That leave request was not found.");
  return rows[0];
}

async function isManagerOf(tx: Queryable, managerId: string, employeeId: string): Promise<boolean> {
  // R68: the manager on the assignment effective today, not one entered ahead of time.
  const rows = await tx.query(
    `select 1 from employment_assignment
      where employee_id = $1 and manager_id = $2
        and effective_from <= $3::date and (effective_to is null or effective_to >= $3::date)`,
    [employeeId, managerId, todayIST()],
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
  if (input.decision === "approve") await assertNotInLockedMonth(tx, req.start_date, req.end_date);

  if (req.type_code === "COMPOFF") {
    // R66: one comp-off decision per employee at a time, so two approvals cannot use the same credit.
    await tx.query("select 1 from employee where id = $1 for update", [req.employee_id]);
  }

  const held = req.held;
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
    if (input.decision === "approve") {
      if (req.type_code === "COMPOFF") {
        // Use the earliest-expiring credits first, and record which credit each debit used (R51).
        const allocation = allocateCompoff(await compoffCredits(tx, req.employee_id), held, req.end_date);
        if (!allocation) {
          throw new DomainError("The employee's comp-off days do not cover these dates (some expire earlier). Ask them to pick earlier dates.");
        }
        for (const a of allocation) {
          await tx.query(
            `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id, consumes_entry_id)
             values ($1, $2, $3, $4, $5, 'application', $6, $7)`,
            [req.employee_id, req.leave_type_id, year, today, -a.amount, req.id, Number(a.creditId)],
          );
        }
      } else {
        await entry(-held, "application");
      }
    }
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
  await lockMonthsShared(tx, [req.start_date, req.end_date]); // R65
  if (req.status === "approved" && !isHr(actor) && (await firstLockedMonth(tx, [req.start_date, req.end_date]))) {
    throw new DomainError("This leave overlaps a closed month, so only HR can cancel it.");
  }
  if (!canCancel({ actorEmployeeId: actor.employeeId, actorIsHrAdmin: isHr(actor), requesterEmployeeId: req.employee_id, status: req.status, startDate: req.start_date, today })) {
    throw new DomainError("Leave that has already started can only be cancelled by HR.");
  }

  const held = req.held;
  const year = Number(req.start_date.slice(0, 4));
  if (held > 0 && req.status === "pending") {
    await tx.query(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id)
       values ($1, $2, $3, $4, $5, 'hold_release', $6)`,
      [req.employee_id, req.leave_type_id, year, today, held, req.id],
    );
  } else if (held > 0 && req.type_code === "COMPOFF") {
    await tx.query("select 1 from employee where id = $1 for update", [req.employee_id]); // R66
    // Give the days back only to comp-off credits that have not expired (R53).
    const used = await tx.query<{ cid: string; amount: number; expires_on: string }>(
      `select l.consumes_entry_id::text as cid, (-sum(l.delta))::float8 as amount, c.expires_on::text as expires_on
         from leave_ledger l join leave_ledger c on c.id = l.consumes_entry_id
        where l.request_id = $1 and l.reason = 'application' and l.consumes_entry_id is not null
        group by l.consumes_entry_id, c.expires_on`,
      [req.id],
    );
    for (const u of used) {
      if (u.expires_on < today) continue;
      await tx.query(
        `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id, consumes_entry_id)
         values ($1, $2, $3, $4, $5, 'cancellation', $6, $7)`,
        [req.employee_id, req.leave_type_id, year, today, u.amount, req.id, Number(u.cid)],
      );
    }
  } else if (held > 0) {
    await tx.query(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, request_id)
       values ($1, $2, $3, $4, $5, 'cancellation', $6)`,
      [req.employee_id, req.leave_type_id, year, today, held, req.id],
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
               where a.employee_id = e.id and a.manager_id = $1 and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)))
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
      where a.manager_id = $1 and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)
        and e.status = 'active'`,
    [actor.employeeId, todayIST()],
  );
  const canApprove = isHr(actor) || reports[0].n > 0;
  if (!canApprove) return { canApprove, pending: 0 };
  const [pending, compoff] = await Promise.all([listApprovals(actor), listCompoffApprovals(actor)]);
  return { canApprove, pending: pending.length + compoff.length };
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
    tx.query<{ employee_id: string; location_id: string }>(
      "select employee_id, location_id from employment_assignment where effective_from <= $1::date and (effective_to is null or effective_to >= $1::date)",
      [today],
    ),
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

// ---------------------------------------------------------------------------------------------
// Year end (HR): lapse, carry forward and encash (R22 to R25, R38 to R41). Preview, then run.
// ---------------------------------------------------------------------------------------------

export type YearEndLine = { code: string; name: string; people: number; lapsed: number; encashed: number; carried: number };
export type YearEndSummary = { year: number; applied: boolean; canRun: boolean; employees: number; lines: YearEndLine[] };

type YearEndEntry = { employee: string; type: string; code: string; year: number; date: string; delta: number; reason: string; key: string; note: string };

function checkYearEndYear(year: number, today: string) {
  const currentYear = Number(today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
    throw new DomainError("Choose the current year or an earlier one.");
  }
  return { canRun: year < currentYear || today >= `${year}-12-31` };
}

async function planYearEnd(q: Queryable, year: number): Promise<{ entries: YearEndEntry[]; lines: Map<string, YearEndLine> }> {
  const rows = await q.query<{
    employee_id: string;
    type_id: string;
    code: string;
    name: string;
    cap: number | null;
    encashable: boolean;
    balance: number;
    held: number;
  }>(
    `select e.id as employee_id, t.id as type_id, t.code, t.name, t.carry_forward_cap::float8 as cap, t.encashable,
            coalesce(sum(l.delta) filter (where l.reason not in (${HOLDS})), 0)::float8 as balance,
            coalesce(-sum(l.delta) filter (where l.reason in (${HOLDS})), 0)::float8 as held
       from employee e
       cross join leave_type t
       left join leave_ledger l on l.employee_id = e.id and l.leave_type_id = t.id
      where e.status = 'active' and t.active and t.annual_quota is not null and t.accrual_mode in ('upfront', 'monthly')
      group by e.id, t.id
      order by t.code, e.id`,
  );

  const entries: YearEndEntry[] = [];
  const lines = new Map<string, YearEndLine>();
  const end = `${year}-12-31`;
  const nextStart = `${year + 1}-01-01`;

  for (const r of rows) {
    const plan = yearEndPlan({ available: r.balance - r.held, cap: r.cap ?? 0, encashable: r.encashable });
    if (plan.carry === 0 && plan.lapse === 0 && plan.encash === 0) continue;
    const line = lines.get(r.code) ?? { code: r.code, name: r.name, people: 0, lapsed: 0, encashed: 0, carried: 0 };
    line.people += 1;
    line.lapsed += plan.lapse;
    line.encashed += plan.encash;
    line.carried += plan.carry;
    lines.set(r.code, line);

    const base = { employee: r.employee_id, type: r.type_id, code: r.code };
    const key = (kind: string) => `yearend:${year}:${r.employee_id}:${r.code}:${kind}`;
    if (plan.lapse > 0) {
      entries.push({ ...base, year, date: end, delta: -plan.lapse, reason: "lapse", key: key("lapse"), note: `${r.name} lapsed at the end of ${year} (R22)` });
    }
    if (plan.encash > 0) {
      entries.push({ ...base, year, date: end, delta: -plan.encash, reason: "encashment", key: key("encash"), note: `${plan.encash} days to encash at basic pay / 30 per day (R23)` });
    }
    if (plan.carry > 0) {
      entries.push({ ...base, year, date: end, delta: -plan.carry, reason: "carry_forward", key: key("cf-out"), note: `Carried forward to ${year + 1}` });
      entries.push({ ...base, year: year + 1, date: nextStart, delta: plan.carry, reason: "carry_forward", key: key("cf-in"), note: `Carried forward from ${year}` });
    }
  }
  return { entries, lines };
}

/** Read-only: what a year-end run would do right now. Nothing is written. */
export async function previewYearEnd(actor: Actor | null, year: number): Promise<YearEndSummary> {
  requireRole(actor, "hr_admin");
  const { canRun } = checkYearEndYear(year, todayIST());
  const { entries, lines } = await planYearEnd({ query }, year);
  const people = new Set(entries.map((e) => e.employee));
  return { year, applied: false, canRun, employees: people.size, lines: [...lines.values()] };
}

export async function runYearEndTx(tx: Queryable, actor: Actor | null, opts: { year: number }): Promise<YearEndSummary> {
  requireRole(actor, "hr_admin");
  const { canRun } = checkYearEndYear(opts.year, todayIST());
  if (!canRun) throw new DomainError(`Year-end can only be run from 31 December ${opts.year}.`);

  const { entries, lines: planned } = await planYearEnd(tx, opts.year);
  const lines = new Map<string, YearEndLine>();
  const people = new Set<string>();

  if (entries.length > 0) {
    const inserted = await tx.query<{ employee_id: string; reason: string; delta: number; k: string }>(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, ref_key, note)
       select * from unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::date[], $5::numeric[], $6::text[], $7::text[], $8::text[])
       on conflict (ref_key) where ref_key is not null do nothing
       returning employee_id, reason, delta::float8 as delta, ref_key as k`,
      [
        entries.map((e) => e.employee),
        entries.map((e) => e.type),
        entries.map((e) => e.year),
        entries.map((e) => e.date),
        entries.map((e) => e.delta),
        entries.map((e) => e.reason),
        entries.map((e) => e.key),
        entries.map((e) => e.note),
      ],
    );
    const codeOfKey = (k: string) => k.split(":")[3];
    for (const r of inserted) {
      people.add(r.employee_id);
      const code = codeOfKey(r.k);
      const line = lines.get(code) ?? { code, name: planned.get(code)?.name ?? code, people: 0, lapsed: 0, encashed: 0, carried: 0 };
      if (r.reason === "lapse") line.lapsed += -r.delta;
      else if (r.reason === "encashment") line.encashed += -r.delta;
      else if (r.reason === "carry_forward" && r.delta < 0) line.carried += -r.delta;
      lines.set(code, line);
    }
    const perType = new Map<string, Set<string>>();
    for (const r of inserted) {
      const code = codeOfKey(r.k);
      perType.set(code, (perType.get(code) ?? new Set()).add(r.employee_id));
    }
    for (const [code, set] of perType) lines.get(code)!.people = set.size;
  }

  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "leave_year_end_run",
      entity: "leave_ledger",
      summary: `Year ${opts.year}: ${[...lines.values()].map((l) => `${l.code} lapsed ${l.lapsed}, encashed ${l.encashed}, carried ${l.carried}`).join("; ") || "nothing to do"}`,
    },
    tx,
  );
  return { year: opts.year, applied: true, canRun: true, employees: people.size, lines: [...lines.values()] };
}

export async function runYearEnd(actor: Actor | null, opts: { year: number }) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => runYearEndTx(tx, actor, opts));
}

// ---------------------------------------------------------------------------------------------
// Calendar facts for other modules (attendance): approved leave and holidays.
// ---------------------------------------------------------------------------------------------

export type CalendarFacts = {
  leave: { employeeId: string; start: string; end: string; part: DayPart; typeCode: string; lopDays: number }[];
  holidays: { locationId: string; date: string; name: string }[];
};

/** Approved leave and national/state holidays between two dates. `null` ids means everyone (HR only). */
export async function getCalendarFacts(
  actor: Actor | null,
  opts: { employeeIds: string[] | null; locationIds: string[]; from: string; to: string },
  q: Queryable = { query },
): Promise<CalendarFacts> {
  requireEmployee(actor);
  if (opts.employeeIds === null) requireRole(actor, "hr_admin");
  else if (!isHr(actor) && opts.employeeIds.some((id) => id !== actor.employeeId)) throw new ForbiddenError();

  const [leave, holidays] = await Promise.all([
    q.query<{ employee_id: string; start_date: string; end_date: string; day_part: DayPart; code: string; lop_days: number }>(
      `select lr.employee_id, lr.start_date::text, lr.end_date::text, lr.day_part, t.code, lr.lop_days::float8 as lop_days
         from leave_request lr join leave_type t on t.id = lr.leave_type_id
        where lr.status = 'approved' and ($1::uuid[] is null or lr.employee_id = any($1::uuid[]))
          and lr.start_date <= $3::date and lr.end_date >= $2::date`,
      [opts.employeeIds, opts.from, opts.to],
    ),
    opts.locationIds.length === 0
      ? Promise.resolve([] as { location_id: string; d: string; name: string }[])
      : q.query<{ location_id: string; d: string; name: string }>(
          `select location_id, holiday_date::text as d, name from holiday
            where location_id = any($1::uuid[]) and type in ('national', 'state') and holiday_date between $2::date and $3::date`,
          [opts.locationIds, opts.from, opts.to],
        ),
  ]);
  return {
    leave: leave.map((r) => ({ employeeId: r.employee_id, start: r.start_date, end: r.end_date, part: r.day_part, typeCode: r.code, lopDays: r.lop_days })),
    holidays: holidays.map((r) => ({ locationId: r.location_id, date: r.d, name: r.name })),
  };
}

// ---------------------------------------------------------------------------------------------
// Maternity, paternity and comp-off (R47 to R53)
// ---------------------------------------------------------------------------------------------

async function calendarAt(
  tx: Queryable,
  employeeId: string,
  start: string,
  end: string,
): Promise<{ weeklyOffDays: number[]; holidays: Record<string, string> } | null> {
  const loc = (
    await tx.query<{ id: string; weekly_off_days: number[] }>(
      `select l.id, l.weekly_off_days
         from employment_assignment a join location l on l.id = a.location_id
        where a.employee_id = $1 and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)`,
      [employeeId, start],
    )
  )[0];
  if (!loc) return null;
  const holidays = await tx.query<{ d: string; name: string }>(
    `select holiday_date::text as d, name from holiday
      where location_id = $1 and type in ('national', 'state') and holiday_date between $2::date and $3::date`,
    [loc.id, start, end],
  );
  return { weeklyOffDays: loc.weekly_off_days, holidays: Object.fromEntries(holidays.map((h) => [h.d, h.name])) };
}

async function assertNoOverlap(tx: Queryable, employeeId: string, start: string, end: string) {
  const overlap = await tx.query<{ s: string; e: string }>(
    `select start_date::text as s, end_date::text as e from leave_request
      where employee_id = $1 and status in ('pending', 'approved')
        and daterange(start_date, end_date, '[]') && daterange($2::date, $3::date, '[]') limit 1`,
    [employeeId, start, end],
  );
  if (overlap.length > 0) {
    throw new DomainError(`You already have leave from ${formatDate(overlap[0].s)} to ${formatDate(overlap[0].e)} that overlaps these dates.`, "startDate");
  }
}

async function lockActiveEmployee(tx: Queryable, employeeId: string) {
  const emp = (
    await tx.query<{ status: string; gender: string | null; joining_date: string }>(
      "select status, gender, joining_date::text from employee where id = $1 for update",
      [employeeId],
    )
  )[0];
  if (!emp || emp.status !== "active") throw new DomainError("Only active employees can apply for leave."); // R5
  return emp;
}

async function typeId(tx: Queryable, code: string): Promise<string> {
  const row = (await tx.query<{ id: string }>("select id from leave_type where code = $1 and active", [code]))[0];
  if (!row) throw new DomainError("That kind of leave is not set up. Please contact HR.");
  return row.id;
}

export async function applyMaternityTx(tx: Queryable, actor: Actor | null, input: MaternityInput): Promise<{ requestId: string; endDate: string }> {
  requireEmployee(actor);
  const today = todayIST();
  const emp = await lockActiveEmployee(tx, actor.employeeId);
  const check = checkMaternity({
    today,
    startDate: input.startDate,
    expectedDelivery: input.expectedDeliveryDate,
    survivingChildren: input.survivingChildren,
    joiningDate: emp.joining_date,
    gender: emp.gender,
  });
  if (!check.ok) throw new DomainError(check.error, check.field || undefined);

  // R67: maternity leave is once for each delivery, not once for each request.
  const earlier = await tx.query<{ edd: string }>(
    `select lr.expected_delivery_date::text as edd
       from leave_request lr join leave_type t on t.id = lr.leave_type_id
      where t.code = 'MAT' and lr.employee_id = $1 and lr.status in ('pending', 'approved') and lr.expected_delivery_date is not null`,
    [actor.employeeId],
  );
  const same = earlier.find((e) => isSameDelivery(e.edd, input.expectedDeliveryDate));
  if (same) {
    throw new DomainError(
      `You already have maternity leave for a delivery expected around ${formatDate(same.edd)}. Maternity leave is once for each delivery. If this is a different delivery, please contact HR.`,
      "expectedDeliveryDate",
    );
  }

  await assertNotInLockedMonth(tx, input.startDate, check.endDate, "startDate");
  await assertNoOverlap(tx, actor.employeeId, input.startDate, check.endDate);

  const created = await tx.query<{ id: string }>(
    `insert into leave_request
       (employee_id, leave_type_id, start_date, end_date, day_part, days, lop_days, reason, certificate_required,
        expected_delivery_date, surviving_children)
     values ($1, $2, $3, $4, 'full', $5, 0, $6, true, $7, $8) returning id`,
    [actor.employeeId, await typeId(tx, "MAT"), input.startDate, check.endDate, check.days, input.reason ?? null, input.expectedDeliveryDate, input.survivingChildren],
  );
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "maternity_applied",
      entity: "leave_request",
      entityId: created[0].id,
      summary: `${input.startDate} to ${check.endDate}, ${check.weeks} weeks`,
    },
    tx,
  );
  return { requestId: created[0].id, endDate: check.endDate };
}

export async function applyMaternity(actor: Actor | null, input: MaternityInput) {
  requireEmployee(actor);
  return transaction((tx) => applyMaternityTx(tx, actor, input));
}

export async function applyPaternityTx(tx: Queryable, actor: Actor | null, input: PaternityInput): Promise<{ requestId: string; days: number }> {
  requireEmployee(actor);
  const today = todayIST();
  const emp = await lockActiveEmployee(tx, actor.employeeId);
  const cal = await calendarAt(tx, actor.employeeId, input.startDate, input.endDate);
  if (!cal) throw new DomainError("You have no job assignment on those dates. Please contact HR.", "startDate");

  const { days } = countLeaveDays({ start: input.startDate, end: input.endDate, dayPart: "full", weeklyOffDays: cal.weeklyOffDays, holidays: cal.holidays });
  const used = await tx.query<{ n: number }>(
    `select coalesce(sum(lr.days), 0)::float8 as n
       from leave_request lr join leave_type t on t.id = lr.leave_type_id
      where t.code = 'PAT' and lr.employee_id = $1 and lr.birth_date = $2::date and lr.status in ('pending', 'approved')`,
    [actor.employeeId, input.birthDate],
  );
  const check = checkPaternity({
    today,
    birthDate: input.birthDate,
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    alreadyUsed: used[0].n,
    gender: emp.gender,
    addMonthsFn: addMonths,
  });
  if (!check.ok) throw new DomainError(check.error, check.field || undefined);
  await assertNotInLockedMonth(tx, input.startDate, input.endDate, "startDate");
  await assertNoOverlap(tx, actor.employeeId, input.startDate, input.endDate);

  const created = await tx.query<{ id: string }>(
    `insert into leave_request (employee_id, leave_type_id, start_date, end_date, day_part, days, lop_days, reason, birth_date)
     values ($1, $2, $3, $4, 'full', $5, 0, $6, $7) returning id`,
    [actor.employeeId, await typeId(tx, "PAT"), input.startDate, input.endDate, days, input.reason ?? null, input.birthDate],
  );
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: "paternity_applied",
      entity: "leave_request",
      entityId: created[0].id,
      summary: `${input.startDate} to ${input.endDate}, ${fmtDays(days)}`,
    },
    tx,
  );
  return { requestId: created[0].id, days };
}

export async function applyPaternity(actor: Actor | null, input: PaternityInput) {
  requireEmployee(actor);
  return transaction((tx) => applyPaternityTx(tx, actor, input));
}

// ---- comp-off ----

export type CompoffCreditRow = { id: string; earnedOn: string; days: number; remaining: number; expiresOn: string; expired: boolean };
export type CompoffRequestRow = {
  id: string;
  workedDate: string;
  days: number;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
  decisionNote: string | null;
  canCancel: boolean;
};
export type CompoffApprovalRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workedDate: string;
  days: number;
  reason: string | null;
  waitingDays: number;
};

export async function getMyCompoff(actor: Actor | null): Promise<{ today: string; credits: CompoffCreditRow[]; requests: CompoffRequestRow[] }> {
  requireEmployee(actor);
  const today = todayIST();
  const [credits, entries, requests] = await Promise.all([
    compoffCredits({ query }, actor.employeeId),
    query<{ id: string; entry_date: string; delta: number }>(
      "select id::text, entry_date::text, delta::float8 as delta from leave_ledger where employee_id = $1 and reason = 'compoff_credit'",
      [actor.employeeId],
    ),
    query<{ id: string; worked_date: string; days: number; status: CompoffRequestRow["status"]; reason: string | null; decision_note: string | null }>(
      `select id, worked_date::text, days::float8 as days, status, reason, decision_note
         from compoff_request where employee_id = $1 order by worked_date desc, created_at desc limit 25`,
      [actor.employeeId],
    ),
  ]);
  const entry = new Map(entries.map((e) => [e.id, e]));
  return {
    today,
    credits: credits
      .map((c) => ({
        id: c.id,
        earnedOn: entry.get(c.id)?.entry_date ?? "",
        days: entry.get(c.id)?.delta ?? 0,
        remaining: c.remaining,
        expiresOn: c.expiresOn,
        expired: c.expiresOn < today,
      }))
      .sort((a, b) => b.earnedOn.localeCompare(a.earnedOn)),
    requests: requests.map((r) => ({
      id: r.id,
      workedDate: r.worked_date,
      days: r.days,
      status: r.status,
      reason: r.reason,
      decisionNote: r.decision_note,
      canCancel: r.status === "pending",
    })),
  };
}

export async function requestCompoffTx(tx: Queryable, actor: Actor | null, input: CompoffInput): Promise<{ requestId: string }> {
  requireEmployee(actor);
  const today = todayIST();
  await lockActiveEmployee(tx, actor.employeeId);
  const cal = await calendarAt(tx, actor.employeeId, input.workedDate, input.workedDate);
  if (!cal) throw new DomainError("You have no job assignment on that date. Please contact HR.", "workedDate");
  const weekday = new Date(`${input.workedDate}T00:00:00Z`).getUTCDay();
  const isOffDay = cal.weeklyOffDays.includes(weekday) || !!cal.holidays[input.workedDate];
  const check = checkCompoff({ today, workedDate: input.workedDate, isOffDay, part: input.part });
  if (!check.ok) throw new DomainError(check.error, check.field);

  const dup = await tx.query("select 1 from compoff_request where employee_id = $1 and worked_date = $2::date and status in ('pending', 'approved')", [actor.employeeId, input.workedDate]);
  if (dup.length > 0) throw new DomainError("You have already asked for comp-off for that day.", "workedDate");

  const created = await tx.query<{ id: string }>(
    "insert into compoff_request (employee_id, worked_date, days, reason) values ($1, $2, $3, $4) returning id",
    [actor.employeeId, input.workedDate, check.days, input.reason ?? null],
  );
  await recordAudit(
    { actorEmployeeId: actor.employeeId, action: "compoff_requested", entity: "compoff_request", entityId: created[0].id, summary: `Worked ${input.workedDate}, ${fmtDays(check.days)}` },
    tx,
  );
  return { requestId: created[0].id };
}

export async function requestCompoff(actor: Actor | null, input: CompoffInput) {
  requireEmployee(actor);
  return transaction((tx) => requestCompoffTx(tx, actor, input));
}

export async function cancelCompoffTx(tx: Queryable, actor: Actor | null, requestId: string): Promise<void> {
  requireEmployee(actor);
  const req = (
    await tx.query<{ employee_id: string; status: string; worked_date: string }>(
      "select employee_id, status, worked_date::text from compoff_request where id = $1 for update",
      [requestId],
    )
  )[0];
  if (!req) throw new DomainError("That comp-off request was not found.");
  if (req.employee_id !== actor.employeeId) throw new ForbiddenError("You cannot cancel this request.");
  if (req.status !== "pending") throw new DomainError("Only a request that is still waiting can be cancelled.");
  await tx.query("update compoff_request set status = 'cancelled' where id = $1", [requestId]);
  await recordAudit({ actorEmployeeId: actor.employeeId, action: "compoff_cancelled", entity: "compoff_request", entityId: requestId, summary: `Worked ${req.worked_date}` }, tx);
}

export async function cancelCompoff(actor: Actor | null, requestId: string) {
  requireEmployee(actor);
  return transaction((tx) => cancelCompoffTx(tx, actor, requestId));
}

export async function decideCompoffTx(tx: Queryable, actor: Actor | null, input: DecisionInput): Promise<void> {
  requireEmployee(actor);
  const req = (
    await tx.query<{ employee_id: string; status: string; worked_date: string; days: number }>(
      "select employee_id, status, worked_date::text, days::float8 as days from compoff_request where id = $1 for update",
      [input.requestId],
    )
  )[0];
  if (!req) throw new DomainError("That comp-off request was not found.");
  if (req.status !== "pending") throw new DomainError("This request has already been decided or cancelled.");
  const allowed = canDecide({
    actorEmployeeId: actor.employeeId,
    actorIsHrAdmin: isHr(actor),
    actorIsManagerOfRequester: await isManagerOf(tx, actor.employeeId, req.employee_id),
    requesterEmployeeId: req.employee_id,
  });
  if (!allowed) throw new ForbiddenError("You cannot decide this request.");

  let creditId: number | null = null;
  if (input.decision === "approve") {
    const today = todayIST();
    const credit = await tx.query<{ id: string }>(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, expires_on, ref_key, note)
       values ($1, $2, $3, $4, $5, 'compoff_credit', $6, $7, $8) returning id::text as id`,
      [
        req.employee_id,
        await typeId(tx, "COMPOFF"),
        Number(today.slice(0, 4)),
        today,
        req.days,
        addDays(today, COMPOFF_EXPIRY_DAYS),
        `compoff:${input.requestId}`,
        `Comp-off for working on ${req.worked_date}`,
      ],
    );
    creditId = Number(credit[0].id);
  }
  await tx.query(
    `update compoff_request set status = $2, approver_id = $3, decided_at = now(), decision_note = $4, credit_entry_id = $5 where id = $1`,
    [input.requestId, input.decision === "approve" ? "approved" : "rejected", actor.employeeId, input.note ?? null, creditId],
  );
  await recordAudit(
    {
      actorEmployeeId: actor.employeeId,
      action: input.decision === "approve" ? "compoff_approved" : "compoff_rejected",
      entity: "compoff_request",
      entityId: input.requestId,
      summary: `Worked ${req.worked_date}, ${fmtDays(req.days)}`,
    },
    tx,
  );
}

export async function decideCompoff(actor: Actor | null, input: DecisionInput) {
  requireEmployee(actor);
  return transaction((tx) => decideCompoffTx(tx, actor, input));
}

export async function listCompoffApprovals(actor: Actor | null): Promise<CompoffApprovalRow[]> {
  requireEmployee(actor);
  const today = todayIST();
  const rows = await query<{
    id: string;
    employee_id: string;
    employee_code: string;
    full_name: string;
    worked_date: string;
    days: number;
    reason: string | null;
    waiting: number;
  }>(
    `select cr.id, e.id as employee_id, e.employee_code, e.full_name, cr.worked_date::text, cr.days::float8 as days, cr.reason,
            ($2::date - (cr.created_at at time zone 'Asia/Kolkata')::date)::int as waiting
       from compoff_request cr join employee e on e.id = cr.employee_id
      where cr.status = 'pending' and e.status = 'active' and e.id <> $1
        and ($3::boolean or exists (
              select 1 from employment_assignment a
               where a.employee_id = e.id and a.manager_id = $1 and a.effective_from <= $2::date and (a.effective_to is null or a.effective_to >= $2::date)))
      order by cr.created_at limit 100`,
    [actor.employeeId, today, isHr(actor)],
  );
  return rows.map((r) => ({
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    workedDate: r.worked_date,
    days: r.days,
    reason: r.reason,
    waitingDays: r.waiting,
  }));
}

/** HR: write the expiry of comp-off days that have passed their date (R52). Safe to run again. */
export async function runCompoffExpiryTx(tx: Queryable, actor: Actor | null): Promise<{ credits: number; days: number }> {
  requireRole(actor, "hr_admin");
  const today = todayIST();
  const due = await tx.query<{ id: string; employee_id: string; type_id: string; remaining: number }>(
    `select c.id::text as id, c.employee_id, c.leave_type_id as type_id,
            (c.delta + coalesce(sum(r.delta), 0))::float8 as remaining
       from leave_ledger c left join leave_ledger r on r.consumes_entry_id = c.id
      where c.reason = 'compoff_credit' and c.expires_on < $1::date
      group by c.id
     having c.delta + coalesce(sum(r.delta), 0) > 0`,
    [today],
  );
  let credits = 0;
  let days = 0;
  if (due.length > 0) {
    const inserted = await tx.query<{ delta: number }>(
      `insert into leave_ledger (employee_id, leave_type_id, leave_year, entry_date, delta, reason, consumes_entry_id, ref_key, note)
       select * from unnest($1::uuid[], $2::uuid[], $3::smallint[], $4::date[], $5::numeric[], $6::text[], $7::bigint[], $8::text[], $9::text[])
       on conflict (ref_key) where ref_key is not null do nothing
       returning delta::float8 as delta`,
      [
        due.map((d) => d.employee_id),
        due.map((d) => d.type_id),
        due.map(() => Number(today.slice(0, 4))),
        due.map(() => today),
        due.map((d) => -d.remaining),
        due.map(() => "expiry"),
        due.map((d) => Number(d.id)),
        due.map((d) => `compoff-expiry:${d.id}`),
        due.map(() => "Comp-off expired after 60 days (R24)"),
      ],
    );
    credits = inserted.length;
    days = inserted.reduce((sum, r) => sum - r.delta, 0);
  }
  await recordAudit({ actorEmployeeId: actor.employeeId, action: "compoff_expiry_run", entity: "leave_ledger", summary: `${credits} credits, ${days} days expired` }, tx);
  return { credits, days };
}

export async function runCompoffExpiry(actor: Actor | null) {
  requireRole(actor, "hr_admin");
  return transaction((tx) => runCompoffExpiryTx(tx, actor));
}

/** For the leave pages: which family-leave actions apply to this employee. */
export async function getLeaveEligibility(actor: Actor | null): Promise<{ maternity: boolean; paternity: boolean }> {
  requireEmployee(actor);
  const facts = await getSelfFacts(actor);
  return { maternity: facts?.gender === "female", paternity: facts?.gender === "male" };
}
