"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { requireRole } from "@/shared/roles";
import { revealPan, savePersonalDetails } from "@/modules/employees/data";
import { personalDetailsSchema } from "@/modules/employees/personal";
import { blankToUndefined, formValues } from "@/shared/validation";

// Sign-in is checked here; whether the person may touch this employee's details (their own, or HR for
// anyone) is checked again inside the data functions. The PAN typed into the form is never returned.

export type PersonalState = { error?: string; field?: string; saved?: boolean; revealed?: string };

const idSchema = z.uuid();

export async function savePersonalAction(_prev: PersonalState, formData: FormData): Promise<PersonalState> {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  const values = formValues(formData);
  const id = idSchema.safeParse(values.employeeId);
  if (!id.success) return { error: "Something went wrong. Please reload the page." };

  const parsed = personalDetailsSchema.safeParse(blankToUndefined({ pan: values.pan ?? "", aadhaarLast4: values.aadhaarLast4 ?? "" }));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: String(issue.path[0] ?? "") };
  }
  try {
    // Only HR's form carries the verified box; the data function ignores it for anyone else.
    await savePersonalDetails(actor, id.data, {
      ...parsed.data,
      ...(values.hrForm === "1" ? { aadhaarVerified: values.aadhaarVerified === "on" } : {}),
    });
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field };
    throw err;
  }
  revalidatePath("/app/personal");
  revalidatePath(`/app/people/${id.data}`);
  return { saved: true };
}

export async function revealPanAction(_prev: PersonalState, formData: FormData): Promise<PersonalState> {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  const id = idSchema.safeParse(formValues(formData).employeeId);
  if (!id.success) return { error: "Something went wrong. Please reload the page." };
  try {
    return { revealed: await revealPan(actor, id.data) };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
}
