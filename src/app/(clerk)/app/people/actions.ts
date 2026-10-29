"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { requireRole } from "@/shared/roles";
import { changeAssignment, createEmployee, deactivateEmployee, reactivateEmployee } from "@/modules/employees/data";
import { blankToUndefined, changeAssignmentSchema, deactivateSchema, newEmployeeSchema } from "@/modules/employees/schemas";

// Every action: sign-in and the hr_admin role are checked here on the server (and again inside each
// data function). Form values are validated with Zod. Problems the user can fix are returned to the
// form in plain words, with the values they typed; anything unexpected is thrown.

export type FormState = { error?: string; field?: string; values?: Record<string, string> };

function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

function firstIssue(error: z.ZodError): { field: string; message: string } {
  const issue = error.issues[0];
  return { field: String(issue.path[0] ?? ""), message: issue.message };
}

async function requireHr() {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  return actor;
}

const idSchema = z.uuid();

export async function createEmployeeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireHr();
  const values = formValues(formData);
  const parsed = newEmployeeSchema.safeParse(blankToUndefined(values));
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { error: message, field, values };
  }

  let id: string;
  try {
    ({ id } = await createEmployee(actor, parsed.data));
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field, values };
    throw err;
  }
  revalidatePath("/app/people");
  redirect(`/app/people/${id}?saved=created`);
}

export async function changeAssignmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await requireHr();
  const values = formValues(formData);
  const id = idSchema.safeParse(values.employeeId);
  if (!id.success) redirect("/app/people");

  const parsed = changeAssignmentSchema.safeParse(blankToUndefined(values));
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error);
    return { error: message, field, values };
  }
  try {
    await changeAssignment(actor, id.data, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field, values };
    throw err;
  }
  revalidatePath("/app/people");
  redirect(`/app/people/${id.data}?tab=history&saved=assignment`);
}

function backWithError(path: string, message: string, form?: string): never {
  const qs = new URLSearchParams({ error: message, ...(form ? { form } : {}) }).toString();
  redirect(`${path}?${qs}`);
}

export async function deactivateEmployeeAction(formData: FormData) {
  const actor = await requireHr();
  const values = formValues(formData);
  const id = idSchema.safeParse(values.employeeId);
  if (!id.success) redirect("/app/people");
  const path = `/app/people/${id.data}`;

  const parsed = deactivateSchema.safeParse(blankToUndefined(values));
  if (!parsed.success) backWithError(path, firstIssue(parsed.error).message, "deactivate");
  try {
    await deactivateEmployee(actor, id.data, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError(path, err.message, "deactivate");
    throw err;
  }
  revalidatePath("/app/people");
  redirect(`${path}?saved=deactivated`);
}

export async function reactivateEmployeeAction(formData: FormData) {
  const actor = await requireHr();
  const id = idSchema.safeParse(formValues(formData).employeeId);
  if (!id.success) redirect("/app/people");
  const path = `/app/people/${id.data}`;
  try {
    await reactivateEmployee(actor, id.data);
  } catch (err) {
    if (err instanceof DomainError) backWithError(path, err.message);
    throw err;
  }
  revalidatePath("/app/people");
  redirect(`${path}?saved=reactivated`);
}
