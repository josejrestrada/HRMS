"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { DomainError } from "@/shared/errors";
import { requireRole } from "@/shared/roles";
import { revealBankField, saveBankDetails } from "@/modules/employees/data";
import { BANK_REVEAL_FIELDS, bankSchema } from "@/modules/employees/bank";
import { formValues } from "@/shared/validation";

// HR only. The role is checked here and again inside the data functions. Typed values are never returned.

export type BankState = { error?: string; field?: string; saved?: boolean; revealed?: string };

const idSchema = z.uuid();

export async function saveBankAction(_prev: BankState, formData: FormData): Promise<BankState> {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  const values = formValues(formData);
  const id = idSchema.safeParse(values.employeeId);
  if (!id.success) return { error: "Something went wrong. Please reload the page." };

  const parsed = bankSchema.safeParse({
    accountHolder: values.accountHolder ?? "",
    bankName: values.bankName ?? "",
    ifsc: values.ifsc ?? "",
    account: values.account ?? "",
    uan: values.uan ?? "",
    salary: values.salary ?? "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: String(issue.path[0] ?? "") };
  }
  try {
    await saveBankDetails(actor, id.data, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, field: err.field };
    throw err;
  }
  revalidatePath(`/app/people/${id.data}`);
  return { saved: true };
}

export async function revealBankAction(_prev: BankState, formData: FormData): Promise<BankState> {
  const actor = await getCurrentActor();
  requireRole(actor, "hr_admin");
  const values = formValues(formData);
  const id = idSchema.safeParse(values.employeeId);
  const field = z.enum(BANK_REVEAL_FIELDS).safeParse(values.field);
  if (!id.success || !field.success) return { error: "Something went wrong. Please reload the page." };
  try {
    return { revealed: await revealBankField(actor, id.data, field.data) };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
}
