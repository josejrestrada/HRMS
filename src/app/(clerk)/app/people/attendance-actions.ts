"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { ForbiddenError, requireRole } from "@/shared/roles";
import { decideRegularizations, hrFixDay } from "@/modules/attendance/data";
import { isoDate, formValues } from "@/shared/validation";

// HR only. The role is checked here and again inside the data functions. Errors and success come back
// to the same tab through the address, like the other People actions.

const idSchema = z.uuid();
const month = z.string().regex(/^\d{4}-\d{2}$/);

function back(employeeId: string, m: string, params: Record<string, string>): never {
  redirect(`/app/people/${employeeId}?${new URLSearchParams({ tab: "attendance", m, ...params }).toString()}`);
}

export async function hrFixDayAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  const v = formValues(formData);
  const id = idSchema.safeParse(v.employeeId);
  const m = month.safeParse(v.m);
  const date = isoDate.safeParse(v.date);
  if (!id.success || !m.success || !date.success) redirect("/app/people");
  try {
    await hrFixDay(actor, id.data, { date: date.data, in: v.in ?? "", out: v.out ?? "", reason: v.reason ?? "" });
  } catch (err) {
    if (err instanceof DomainError || err instanceof ForbiddenError) back(id.data, m.data, { error: err.message });
    throw err;
  }
  revalidatePath(`/app/people/${id.data}`);
  back(id.data, m.data, { saved: "dayfixed" });
}

export async function hrReviewFixAction(formData: FormData) {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  const v = formValues(formData);
  const id = idSchema.safeParse(v.employeeId);
  const requestId = idSchema.safeParse(v.requestId);
  const m = month.safeParse(v.m);
  const decision = z.enum(["approve", "reject"]).safeParse(v.decision);
  if (!id.success || !requestId.success || !m.success || !decision.success) redirect("/app/people");
  try {
    await decideRegularizations(actor, { requestIds: [requestId.data], decision: decision.data });
  } catch (err) {
    if (err instanceof DomainError || err instanceof ForbiddenError) back(id.data, m.data, { error: err.message });
    throw err;
  }
  revalidatePath(`/app/people/${id.data}`);
  back(id.data, m.data, { saved: decision.data === "approve" ? "fixapproved" : "fixrejected" });
}
