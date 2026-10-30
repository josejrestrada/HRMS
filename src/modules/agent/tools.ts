import { z } from "zod";
import { formatDate, todayIST } from "@/shared/dates";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, type Actor } from "@/shared/roles";
import { getMyAttendance, getAttendanceApprovalScope } from "@/modules/attendance/data";
import { getApplyContext, getApprovalScope, getLeaveOverview } from "@/modules/leave/data";
import { checkApplication, countLeaveDays, fmtDays } from "@/modules/leave/rules";
import { getHrDashboard } from "@/modules/reports/data";
import { createDraft } from "./data";
import { POLICY_NOTE, POLICY_TOPICS, explainPolicy } from "./policy";
import type { JsonSchema, ToolSpec } from "./types";

// The assistant's tools. Rules that matter:
//  * Who is asking always comes from `actor` (the session). No tool takes an employee id, and unknown
//    arguments are rejected, so a prompt cannot ask for someone else's data.
//  * Tools return small, whitelisted facts: numbers and dates. No names of other people, no reasons or
//    notes, nothing about Aadhaar, PAN, bank details or salary (none of it is reachable from here).
//  * Nothing here changes data. prepare_leave_application only saves a DRAFT for the employee to confirm.

export type DraftSummary = {
  draftId: string;
  leaveType: string;
  from: string;
  to: string;
  dayPart: string;
  days: number;
  balanceAfter: number | null;
  unpaidDays: number;
  certificateNeeded: boolean;
  skipped: string[];
  expiresInMinutes: number;
};

export type ToolOutcome = { result: unknown; draft?: DraftSummary };

type ToolDef = {
  spec: ToolSpec;
  schema: z.ZodType<Record<string, unknown>>;
  available: (a: { isHr: boolean }) => boolean;
  run: (ctx: { actor: Actor; conversationId: string }, args: any) => Promise<ToolOutcome>;
};

const NO_ARGS: JsonSchema = { type: "object", properties: {}, additionalProperties: false };
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();

const round1 = (n: number) => Math.round(n * 10) / 10;

const tools: ToolDef[] = [
  {
    spec: { name: "get_my_leave_balances", description: "The signed-in employee's leave balances: days available for each leave type, and days held for requests still waiting.", parameters: NO_ARGS },
    schema: strict({}),
    available: () => true,
    async run({ actor }) {
      const o = await getLeaveOverview(actor);
      return { result: { balances: o.balances.map((b) => ({ type: b.name, code: b.code, available_days: round1(b.available), held_for_pending_requests: round1(b.held), per_year: b.annualQuota })) } };
    },
  },
  {
    spec: { name: "list_my_leave_requests", description: "The signed-in employee's most recent leave requests with their status.", parameters: NO_ARGS },
    schema: strict({}),
    available: () => true,
    async run({ actor }) {
      const o = await getLeaveOverview(actor);
      return {
        result: {
          requests: o.requests.slice(0, 8).map((r) => ({ type: r.typeName, from: r.startDate, to: r.endDate, days: r.days, unpaid_days: r.lopDays, status: r.status })),
        },
      };
    },
  },
  {
    spec: {
      name: "get_my_attendance",
      description: "The signed-in employee's attendance totals for a month: present, half days, leave, work from home, absent, late marks and days that need fixing. Defaults to this month.",
      parameters: { type: "object", properties: { month: { type: "string", description: "Month as YYYY-MM. Leave out for this month." } }, additionalProperties: false },
    },
    schema: strict({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must look like 2026-10").optional() }),
    available: () => true,
    async run({ actor }, args: { month?: string }) {
      const today = todayIST();
      const year = Number((args.month ?? today.slice(0, 7)).slice(0, 4));
      const month = Number((args.month ?? today.slice(0, 7)).slice(5, 7));
      const a = await getMyAttendance(actor, year, month);
      const c = a.summary.counts;
      return {
        result: {
          month: `${year}-${String(month).padStart(2, "0")}`,
          present_days: c.present,
          half_days: c.half_day,
          leave_days: c.leave,
          work_from_home_days: c.wfh,
          absent_days: c.absent + c.missed_punch,
          late_marks: a.summary.lateMarks,
          late_marks_limit: a.summary.lateLimit,
          days_to_fix: a.fixable.length,
          days_past_fix_deadline: a.pastDeadline.length,
          month_is_locked: a.locked,
          checked_in_now: a.todayIn !== null && a.todayOut === null,
        },
      };
    },
  },
  {
    spec: { name: "get_upcoming_holidays", description: "The next public holidays at the signed-in employee's work location.", parameters: NO_ARGS },
    schema: strict({}),
    available: () => true,
    async run({ actor }) {
      const ctx = await getApplyContext(actor);
      if (!ctx) return { result: { note: "You have no current job assignment, so I cannot tell your location's holidays." } };
      const upcoming = Object.entries(ctx.holidays)
        .filter(([date]) => date >= ctx.today)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, 5)
        .map(([date, name]) => ({ date, name }));
      return { result: { location: ctx.locationName, holidays: upcoming, note: "Holiday dates for this year may still be tentative." } };
    },
  },
  {
    spec: {
      name: "explain_policy",
      description: "Explain a company leave or attendance rule in plain words.",
      parameters: { type: "object", properties: { topic: { type: "string", enum: [...POLICY_TOPICS] } }, required: ["topic"], additionalProperties: false },
    },
    schema: strict({ topic: z.enum(POLICY_TOPICS) }),
    available: () => true,
    async run({ actor }, args: { topic: (typeof POLICY_TOPICS)[number] }) {
      const needsAttendance = args.topic === "attendance_and_late_marks" || args.topic === "fixing_attendance";
      const [overview, attendance] = await Promise.all([
        getLeaveOverview(actor),
        needsAttendance ? getMyAttendance(actor, Number(todayIST().slice(0, 4)), Number(todayIST().slice(5, 7))) : Promise.resolve(null),
      ]);
      const quotas = Object.fromEntries(overview.balances.map((b) => [b.code, b.annualQuota]));
      return { result: { answer: explainPolicy(args.topic, { quotas, attendance: attendance?.policy ?? null }), note: POLICY_NOTE } };
    },
  },
  {
    spec: {
      name: "prepare_leave_application",
      description:
        "Check a leave request and prepare a DRAFT for the employee to confirm. It does NOT apply for leave. Use it when the employee wants to apply for casual, sick, earned or unpaid leave or use comp-off. Maternity and paternity leave are applied for on their own pages.",
      parameters: {
        type: "object",
        properties: {
          leave_type: { type: "string", enum: ["CL", "SL", "EL", "COMPOFF", "LOP"], description: "CL casual, SL sick, EL earned, COMPOFF comp-off, LOP unpaid." },
          start_date: { type: "string", description: "First day, YYYY-MM-DD." },
          end_date: { type: "string", description: "Last day, YYYY-MM-DD. Same as start for one day." },
          day_part: { type: "string", enum: ["full", "first_half", "second_half"], description: "Half days only for a single date." },
          reason: { type: "string", description: "Short reason, optional." },
          use_shortfall_as_unpaid: { type: "boolean", description: "True only if the employee agreed to use days they do not have as unpaid leave." },
        },
        required: ["leave_type", "start_date", "end_date"],
        additionalProperties: false,
      },
    },
    schema: strict({
      leave_type: z.enum(["CL", "SL", "EL", "COMPOFF", "LOP"]),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      day_part: z.enum(["full", "first_half", "second_half"]).optional(),
      reason: z.string().trim().max(300).optional(),
      use_shortfall_as_unpaid: z.boolean().optional(),
    }),
    available: () => true,
    async run({ actor, conversationId }, args: { leave_type: string; start_date: string; end_date: string; day_part?: "full" | "first_half" | "second_half"; reason?: string; use_shortfall_as_unpaid?: boolean }) {
      const ctx = await getApplyContext(actor);
      if (!ctx) return { result: { ok: false, problem: "You have no current job assignment, so leave cannot be requested. Please contact HR." } };
      const type = ctx.types.find((t) => t.code === args.leave_type);
      if (!type) return { result: { ok: false, problem: "You do not have that kind of leave to use." } };

      const dayPart = args.day_part ?? "full";
      const counted = countLeaveDays({ start: args.start_date, end: args.end_date, dayPart, weeklyOffDays: ctx.weeklyOffDays, holidays: ctx.holidays });
      const check = checkApplication({
        today: ctx.today,
        start: args.start_date,
        end: args.end_date,
        dayPart,
        days: counted.days,
        typeCode: type.code,
        typeName: type.name,
        maxConsecutiveDays: type.maxConsecutiveDays,
        available: type.available,
        convertShortfallToLop: args.use_shortfall_as_unpaid === true,
      });
      if (!check.ok) return { result: { ok: false, problem: check.error } };

      const skipped = counted.skipped.map((s) => `${formatDate(s.date)} (${s.reason === "weekly_off" ? "weekly off" : (s.label ?? "holiday")})`);
      const summary: Omit<DraftSummary, "draftId"> = {
        leaveType: type.name,
        from: args.start_date,
        to: args.end_date,
        dayPart,
        days: check.days,
        balanceAfter: type.code === "LOP" ? null : round1(Math.max(0, type.available - check.heldDays)),
        unpaidDays: check.lopDays,
        certificateNeeded: check.certificateRequired,
        skipped,
        expiresInMinutes: 30,
      };
      // What the Confirm button will submit: the same fields the normal application form sends.
      const input = {
        leaveTypeId: type.id,
        startDate: args.start_date,
        endDate: args.end_date,
        dayPart,
        reason: args.reason,
        convertShortfallToLop: args.use_shortfall_as_unpaid === true,
      };
      const draftId = await createDraft(actor, conversationId, { input, summary });
      return {
        result: {
          ok: true,
          draft_prepared: true,
          summary: `${type.name} from ${formatDate(args.start_date)} to ${formatDate(args.end_date)}: ${fmtDays(check.days)}${check.lopDays > 0 ? `, of which ${fmtDays(check.lopDays)} unpaid` : ""}.`,
          certificate_needed: check.certificateRequired,
          instruction: "Tell the employee the draft is ready and they must press Confirm below to send it. It has NOT been applied for yet.",
        },
        draft: { ...summary, draftId },
      };
    },
  },
  {
    spec: { name: "get_my_pending_approvals", description: "How many requests are waiting for the signed-in person to approve (only managers and HR admins approve anything).", parameters: NO_ARGS },
    schema: strict({}),
    available: () => true,
    async run({ actor }) {
      const [leave, attendance] = await Promise.all([getApprovalScope(actor), getAttendanceApprovalScope(actor)]);
      if (!leave.canApprove && !attendance.canApprove) return { result: { note: "You do not approve anyone's requests." } };
      return { result: { leave_and_comp_off_requests_waiting: leave.pending, attendance_fixes_waiting: attendance.pending } };
    },
  },
  {
    spec: { name: "get_company_today", description: "Company totals for today: headcount, people on leave, requests waiting, attendance counts. Numbers only. HR administrators only.", parameters: NO_ARGS },
    schema: strict({}),
    available: ({ isHr }) => isHr,
    async run({ actor }) {
      const d = await getHrDashboard(actor);
      return {
        result: {
          date: d.today,
          active_employees: d.headcount.total,
          by_location: d.headcount.byLocation,
          on_leave_today: d.onLeaveTotal,
          leave_requests_waiting: d.pending.count,
          attendance: { ...d.attendance.counts, not_checked_in: d.attendance.notRecorded, off_today: d.attendance.offToday },
        },
      };
    },
  },
];

/** The tools this person may be offered. HR-only tools are not even advertised to anyone else. */
export function toolsFor(actor: Actor): ToolSpec[] {
  const isHr = actor.roles.includes("hr_admin");
  return tools.filter((t) => t.available({ isHr })).map((t) => t.spec);
}

export const TOOL_NAMES = tools.map((t) => t.spec.name);

/**
 * Runs one tool call for the signed-in person. Never throws: problems come back as a short message the
 * model can relay. Unknown tools, tools the person may not use, and unexpected arguments are refused.
 */
export async function executeTool(actor: Actor, conversationId: string, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const isHr = actor.roles.includes("hr_admin");
  const tool = tools.find((t) => t.spec.name === name && t.available({ isHr }));
  if (!tool) return { result: { error: "That tool is not available." } };
  const parsed = tool.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) return { result: { error: `Invalid arguments: ${parsed.error.issues[0]?.message ?? "check the arguments"}` } };
  try {
    return await tool.run({ actor, conversationId }, parsed.data);
  } catch (err) {
    if (err instanceof ForbiddenError) return { result: { error: "You do not have access to that." } };
    if (err instanceof DomainError) return { result: { error: err.message } };
    return { result: { error: "Something went wrong getting that information." } };
  }
}
