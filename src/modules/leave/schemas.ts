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

const optionalReason = z.string().trim().max(300, "The reason is too long (300 characters at most)").optional();

export const maternitySchema = z.object({
  startDate: isoDate,
  expectedDeliveryDate: isoDate,
  survivingChildren: z.preprocess(
    (v) => (v === undefined || v === "" ? NaN : Number(v)),
    z.number({ error: "Enter how many surviving children you have (0 or more)" }).int("Enter a whole number").min(0, "Enter 0 or more").max(20, "Check the number of children"),
  ),
  reason: optionalReason,
});
export type MaternityInput = z.infer<typeof maternitySchema>;

export const paternitySchema = z.object({
  birthDate: isoDate,
  startDate: isoDate,
  endDate: isoDate,
  reason: optionalReason,
});
export type PaternityInput = z.infer<typeof paternitySchema>;

export const compoffSchema = z.object({
  workedDate: isoDate,
  part: z.enum(["full", "half"], { error: "Choose a full day or half a day" }),
  reason: optionalReason,
});
export type CompoffInput = z.infer<typeof compoffSchema>;
