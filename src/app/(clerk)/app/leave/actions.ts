"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, requireRole } from "@/shared/roles";
import {
  applyLeave,
  applyMaternity,
  applyPaternity,
  cancelCompoff,
  cancelLeave,
  decideCompoff,
  decideLeave,
  requestCompoff,
  runCompoffExpiry,
  runLeaveCredits,
  runYearEnd,
} from "@/modules/leave/data";
import { applyLeaveSchema, compoffSchema, decisionSchema, maternitySchema, paternitySchema, requestIdSchema } from "@/modules/leave/schemas";
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

export async function runYearEndAction(formData: FormData) {
  const actor = await requireActor();
  requireRole(actor, "hr_admin");
  const year = Number(formValues(formData).year);
  if (!Number.isInteger(year)) backWithError("/app/leave/admin", "Choose a year.");
  let summary;
  try {
    summary = await runYearEnd(actor, { year });
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/leave/admin", err.message);
    throw err;
  }
  revalidatePath("/app/leave", "layout");
  const lines = summary.lines.map((l) => `${l.code}:${l.lapsed}:${l.encashed}:${l.carried}`).join(",");
  redirect(
    `/app/leave/admin?${new URLSearchParams({ saved: "yearend", year: String(summary.year), people: String(summary.employees), lines }).toString()}`,
  );
}

export async function applyMaternityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  const values = formValues(formData);
  const parsed = maternitySchema.safeParse(blankToUndefined(values));
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { error: message, field, values };
  }
  try {
    await applyMaternity(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field, values };
    throw err;
  }
  revalidatePath("/app/leave");
  redirect("/app/leave?saved=applied");
}

export async function applyPaternityAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  const values = formValues(formData);
  const parsed = paternitySchema.safeParse(blankToUndefined(values));
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { error: message, field, values };
  }
  try {
    await applyPaternity(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field, values };
    throw err;
  }
  revalidatePath("/app/leave");
  redirect("/app/leave?saved=applied");
}

export async function requestCompoffAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireActor();
  const values = formValues(formData);
  const parsed = compoffSchema.safeParse(blankToUndefined(values));
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { error: message, field, values };
  }
  try {
    await requestCompoff(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field, values };
    throw err;
  }
  revalidatePath("/app/leave", "layout");
  redirect("/app/leave/comp-off?saved=requested");
}

export async function cancelCompoffAction(formData: FormData) {
  const actor = await requireActor();
  const id = requestIdSchema.safeParse(formValues(formData).requestId);
  if (!id.success) redirect("/app/leave/comp-off");
  try {
    await cancelCompoff(actor, id.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/leave/comp-off", err.message);
    throw err;
  }
  revalidatePath("/app/leave", "layout");
  redirect("/app/leave/comp-off?saved=cancelled");
}

export async function decideCompoffAction(formData: FormData) {
  const actor = await requireActor();
  const parsed = decisionSchema.safeParse(blankToUndefined(formValues(formData)));
  if (!parsed.success) backWithError("/app/leave/approvals", firstIssue(parsed.error).message);
  try {
    await decideCompoff(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError || err instanceof ForbiddenError) backWithError("/app/leave/approvals", err.message);
    throw err;
  }
  revalidatePath("/app/leave", "layout");
  redirect(`/app/leave/approvals?saved=${parsed.data.decision === "approve" ? "approved" : "rejected"}`);
}

export async function runCompoffExpiryAction() {
  const actor = await requireActor();
  requireRole(actor, "hr_admin");
  const result = await runCompoffExpiry(actor);
  revalidatePath("/app/leave", "layout");
  redirect(`/app/leave/admin?${new URLSearchParams({ saved: "compoff", credits: String(result.credits), days: String(result.days) }).toString()}`);
}
