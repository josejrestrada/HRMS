"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { requireRole } from "@/shared/roles";
import { punch } from "@/modules/attendance/data";

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
