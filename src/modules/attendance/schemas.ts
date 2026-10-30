import { z } from "zod";
import { isoDate } from "@/shared/validation";

export const regularizeSchema = z.object({
  reason: z
    .string({ error: "Please give a short reason." })
    .trim()
    .min(3, "Please give a short reason.")
    .max(300, "The reason is too long (300 characters at most)."),
  items: z
    .array(z.object({ date: isoDate, in: z.string(), out: z.string() }))
    .min(1, "Tick at least one day to fix.")
    .max(31, "You can fix at most 31 days at a time."),
});
export type RegularizeFormInput = z.infer<typeof regularizeSchema>;

export const regularizationDecisionSchema = z
  .object({
    requestIds: z.array(z.uuid()).min(1, "Choose at least one request.").max(60),
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(300, "The note is too long").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "reject" && (!v.note || v.note.length < 3)) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Please give a short reason for rejecting." });
    }
  });
export type RegularizationDecisionInput = z.infer<typeof regularizationDecisionSchema>;
