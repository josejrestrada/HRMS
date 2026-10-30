import { COMPOFF_CLAIM_WINDOW_DAYS, COMPOFF_EXPIRY_DAYS, MATERNITY_MIN_TENURE_DAYS, MATERNITY_PRE_DELIVERY_DAYS, PATERNITY_DAYS, PATERNITY_MONTHS } from "@/modules/leave/rules";

// Plain-language policy answers for the assistant. They are built from the same constants the rules use,
// so they cannot drift from what the system actually enforces.

export const POLICY_TOPICS = [
  "casual_leave",
  "sick_leave",
  "earned_leave",
  "maternity_leave",
  "paternity_leave",
  "comp_off",
  "leave_without_pay",
  "attendance_and_late_marks",
  "fixing_attendance",
  "month_lock",
] as const;
export type PolicyTopic = (typeof POLICY_TOPICS)[number];

export const POLICY_NOTE =
  "These are the rules as they are set up in the HR system today. Some legal minimums are still being confirmed with HR, so for a legal question please ask HR.";

export function explainPolicy(
  topic: PolicyTopic,
  facts: { quotas: Record<string, number | null>; attendance: { workStart: string; graceMinutes: number; fullDayMinutes: number; halfDayMinutes: number; lateMarksPerDeduction: number; regularizeUntilDay: number } | null },
): string {
  const q = facts.quotas;
  switch (topic) {
    case "casual_leave":
      return `Casual leave: ${q.CL ?? 8} days a year, given at the start of the year (pro-rated if you joined during the year, never below the legal minimum). At most 3 days in a row. Unused days lapse at year end and cannot be paid out.`;
    case "sick_leave":
      return `Sick leave: ${q.SL ?? 9} days a year, given at the start of the year. For more than 2 days in a row a medical certificate is needed (give it to HR). Unused days lapse at year end.`;
    case "earned_leave":
      return `Earned leave: ${q.EL ?? 18} days a year, added at 1.5 days at the end of each month (less if you took unpaid leave that month). Up to 45 days carry forward to the next year; anything above 45 is paid out at year end.`;
    case "maternity_leave":
      return `Maternity leave is for women employees: 26 weeks if you have fewer than two surviving children, 12 weeks if you have two or more. It can start up to ${MATERNITY_PRE_DELIVERY_DAYS / 7} weeks before the expected delivery date. Weekly offs and holidays inside it are counted. You need at least ${MATERNITY_MIN_TENURE_DAYS} days of service, and a medical certificate. It does not use your other leave. Apply from My leave > Maternity leave.`;
    case "paternity_leave":
      return `Paternity leave is for male employees: ${PATERNITY_DAYS} working days for each child, taken within ${PATERNITY_MONTHS} months of the birth. You can split it across requests. Apply from My leave > Paternity leave.`;
    case "comp_off":
      return `Comp-off: if you work on a weekly off or a holiday, ask for comp-off within ${COMPOFF_CLAIM_WINDOW_DAYS} days (1 day or half a day). Once your manager approves, it is added to your balance and expires ${COMPOFF_EXPIRY_DAYS} days after approval, earliest first. Ask from My leave > Comp-off.`;
    case "leave_without_pay":
      return "Leave without pay is for when you have no balance or choose not to use it. It is unlimited but your pay is reduced for those days. If your balance is short you can choose to use the extra days as unpaid leave when you apply.";
    case "attendance_and_late_marks": {
      const a = facts.attendance;
      if (!a) return "Attendance is worked out from your check-ins: 8 hours or more is a full day, 4.5 hours up to 8 is a half day, and less than 4.5 hours is absent. Late marks are counted each month.";
      return `Attendance is worked out from your check-ins: ${a.fullDayMinutes / 60} hours or more is a full day, ${a.halfDayMinutes / 60} hours up to ${a.fullDayMinutes / 60} is a half day, and less than ${a.halfDayMinutes / 60} hours is absent. Work starts at ${a.workStart.slice(0, 5)} with ${a.graceMinutes} minutes of grace; after that you get a late mark. Late marks are counted and shown against a monthly limit of ${a.lateMarksPerDeduction}. Approved work from home counts as present.`;
    }
    case "fixing_attendance": {
      const day = facts.attendance?.regularizeUntilDay ?? 5;
      return `If you forgot to check out or check in, or had a short day, send a fix from Attendance > Days to fix: choose the days, enter the real times and one reason, and your manager approves. Days this month can be fixed any time; days from last month can be fixed until the ${day}th. After that the day counts as unpaid. Your original check-ins are always kept.`;
    }
    case "month_lock":
      return "At the end of each month HR locks the month. Days that were not fixed in time become unpaid, and a locked month can no longer be changed. Talk to HR if something in a locked month is wrong.";
  }
}
