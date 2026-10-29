"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, requireRole } from "@/shared/roles";
import { applyLeave, cancelLeave, decideLeave, runLeaveCredits } from "@/modules/leave/data";
import { applyLeaveSchema, decisionSchema, requestIdSchema } from "@/modules/leave/schemas";
import { blankToUndefined, formValues } from "@/shared/validation";

// Every action checks sign-in and role on the server (and again inside each data function). Values
// are validated with Zod. Problems the user can fix go back to the form in plain words.

export type FormState = { error?: string; field?: string; values?: Record<string, string> };

async function requireActor() {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  return actor;
}

function firstIssue(error: z.ZodError): { field: string; message: string } {
  const issue = error.issues[0];
  return { field: String(issue.path[0] ?? ""), message: issue.message };
}

function backWithError(path: string, message: string): never {
  redirect(`${path}?${new URLSearchParams({ error: message }).toString()}`);
}

export async function applyLeaveAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  const values = formValues(formData);
  const parsed = applyLeaveSchema.safeParse(blankToUndefined(values));
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { error: message, field, values };
  }
  try {
    await applyLeave(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field, values };
    throw err;
  }
  revalidatePath("/app/leave");
  redirect("/app/leave?saved=applied");
}

export async function cancelLeaveAction(formData: FormData) {
  const actor = await requireActor();
  const id = requestIdSchema.safeParse(formValues(formData).requestId);
  if (!id.success) redirect("/app/leave");
  try {
    await cancelLeave(actor, id.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/leave", err.message);
    throw err;
  }
  revalidatePath("/app/leave");
  redirect("/app/leave?saved=cancelled");
}

export async function decideLeaveAction(formData: FormData) {
  const actor = await requireActor();
  const parsed = decisionSchema.safeParse(blankToUndefined(formValues(formData)));
  if (!parsed.success) backWithError("/app/leave/approvals", firstIssue(parsed.error).message);
  try {
    await decideLeave(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/leave/approvals", err.message);
    if (err instanceof ForbiddenError) backWithError("/app/leave/approvals", err.message);
    throw err;
  }
  revalidatePath("/app/leave", "layout");
  redirect(`/app/leave/approvals?saved=${parsed.data.decision === "approve" ? "approved" : "rejected"}`);
}

export async function runLeaveCreditsAction(formData: FormData) {
  const actor = await requireActor();
  requireRole(actor, "hr_admin");
  const yearValue = Number(formValues(formData).year);
  let summary;
  try {
    summary = await runLeaveCredits(actor, Number.isInteger(yearValue) ? { year: yearValue } : {});
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/leave/admin", err.message);
    throw err;
  }
  revalidatePath("/app/leave", "layout");
  redirect(
    `/app/leave/admin?${new URLSearchParams({
      saved: "credits",
      year: String(summary.year),
      grants: String(summary.grants),
      accruals: String(summary.accruals),
    }).toString()}`,
  );
}
