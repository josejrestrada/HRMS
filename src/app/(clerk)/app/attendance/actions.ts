"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { requireRole } from "@/shared/roles";
import { cancelRegularization, cancelWfh, decideRegularizations, decideWfh, lockMonth, punch, requestRegularizations, requestWfh } from "@/modules/attendance/data";
import { regularizationDecisionSchema, regularizeSchema, wfhRequestSchema } from "@/modules/attendance/schemas";
import { ForbiddenError } from "@/shared/roles";
import { blankToUndefined, formValues } from "@/shared/validation";
import { z } from "zod";

// Checks sign-in and role on the server (and again inside the data function). The time is always the
// server's, never the browser's.
export async function punchAction() {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  let result;
  try {
    result = await punch(actor);
  } catch (err) {
    if (err instanceof DomainError) redirect(`/app/attendance?${new URLSearchParams({ error: err.message }).toString()}`);
    throw err;
  }
  revalidatePath("/app/attendance");
  redirect(`/app/attendance?${new URLSearchParams({ saved: result.direction, time: result.time }).toString()}`);
}

export type FormState = { error?: string; field?: string; values?: Record<string, string> };

function firstIssue(error: z.ZodError): string {
  return error.issues[0].message;
}

function backWithError(path: string, message: string): never {
  redirect(`${path}?${new URLSearchParams({ error: message }).toString()}`);
}

/** Bulk fix: the ticked days, each with its own times, and one reason for all. */
export async function requestRegularizationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const values = formValues(formData);
  const dates = formData.getAll("days").filter((d): d is string => typeof d === "string");
  const parsed = regularizeSchema.safeParse({
    reason: values.reason,
    items: dates.map((date) => ({ date, in: values[`in_${date}`] ?? "", out: values[`out_${date}`] ?? "" })),
  });
  const kept = { ...values, days: dates.join(",") };
  if (!parsed.success) return { error: firstIssue(parsed.error), values: kept };
  try {
    await requestRegularizations(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, values: kept };
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect(`/app/attendance?saved=fix&count=${parsed.data.items.length}`);
}

export async function cancelRegularizationAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const id = z.uuid().safeParse(formValues(formData).requestId);
  if (!id.success) redirect("/app/attendance");
  try {
    await cancelRegularization(actor, id.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/attendance", err.message);
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect("/app/attendance?saved=fixcancelled");
}

/** Approve or reject one day or a whole batch (every `requestId` field in the form). */
export async function decideRegularizationAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const values = blankToUndefined(formValues(formData));
  const parsed = regularizationDecisionSchema.safeParse({
    requestIds: formData.getAll("requestId").filter((v): v is string => typeof v === "string"),
    decision: values.decision,
    note: values.note,
  });
  if (!parsed.success) backWithError("/app/attendance/approvals", firstIssue(parsed.error));
  try {
    await decideRegularizations(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError || err instanceof ForbiddenError) backWithError("/app/attendance/approvals", err.message);
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect(`/app/attendance/approvals?saved=${parsed.data.decision === "approve" ? "approved" : "rejected"}&count=${parsed.data.requestIds.length}`);
}

/** HR: lock a finished month. Final: there is no unlock in the app. */
export async function lockMonthAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  const values = formValues(formData);
  const year = Number(values.year);
  const month = Number(values.month);
  if (!Number.isInteger(year) || !Number.isInteger(month)) backWithError("/app/attendance/lock", "Choose a month to lock.");
  let result;
  try {
    result = await lockMonth(actor, { year, month });
  } catch (err) {
    if (err instanceof DomainError) {
      redirect(`/app/attendance/lock?${new URLSearchParams({ year: String(year), month: String(month), error: err.message }).toString()}`);
    }
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect(
    `/app/attendance/lock?${new URLSearchParams({ year: String(year), saved: "locked", month: String(month), people: String(result.employees), unpaid: String(result.unpaidDays) }).toString()}`,
  );
}

// ---- Work from home ----

export async function requestWfhAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const values = formValues(formData);
  const parsed = wfhRequestSchema.safeParse(blankToUndefined(values));
  if (!parsed.success) return { error: firstIssue(parsed.error), values };
  let result;
  try {
    result = await requestWfh(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, values };
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect(`/app/attendance/wfh?saved=requested&count=${result.count}&skipped=${result.skipped.length}`);
}

export async function cancelWfhAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const id = z.uuid().safeParse(formValues(formData).requestId);
  if (!id.success) redirect("/app/attendance/wfh");
  try {
    await cancelWfh(actor, id.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError("/app/attendance/wfh", err.message);
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect("/app/attendance/wfh?saved=cancelled");
}

/** Approve or reject one day or a whole batch (every `requestId` field in the form). */
export async function decideWfhAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const values = blankToUndefined(formValues(formData));
  const parsed = regularizationDecisionSchema.safeParse({
    requestIds: formData.getAll("requestId").filter((v): v is string => typeof v === "string"),
    decision: values.decision,
    note: values.note,
  });
  if (!parsed.success) backWithError("/app/attendance/approvals", firstIssue(parsed.error));
  try {
    await decideWfh(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError || err instanceof ForbiddenError) backWithError("/app/attendance/approvals", err.message);
    throw err;
  }
  revalidatePath("/app/attendance", "layout");
  redirect(`/app/attendance/approvals?saved=wfh${parsed.data.decision === "approve" ? "approved" : "rejected"}&count=${parsed.data.requestIds.length}`);
}
