import { z } from "zod";
import { isoDate } from "@/shared/validation";

export const applyLeaveSchema = z.object({
  leaveTypeId: z.uuid("Choose a leave type"),
  startDate: isoDate,
  endDate: isoDate,
  dayPart: z.enum(["full", "first_half", "second_half"]).default("full"),
  reason: z.string().trim().max(300, "The reason is too long (300 characters at most)").optional(),
  // A checkbox: present as "on" when ticked, absent otherwise.
  convertShortfallToLop: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});
export type ApplyLeaveInput = z.infer<typeof applyLeaveSchema>;

export const decisionSchema = z
  .object({
    requestId: z.uuid(),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(300, "The note is too long").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "reject" && (!v.note || v.note.length < 3)) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Please give a short reason for rejecting." });
    }
  });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const requestIdSchema = z.uuid();
