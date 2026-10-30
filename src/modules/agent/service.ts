import "server-only";
import { recordAudit } from "@/shared/audit";
import { DomainError } from "@/shared/errors";
import { requireRole, type Actor } from "@/shared/roles";
import { applyLeave } from "@/modules/leave/data";
import { applyLeaveSchema } from "@/modules/leave/schemas";
import { getUsableDraft, markDraftUsed } from "./data";

export type ConfirmResult = { ok: true } | { ok: false; error: string };

/**
 * The employee pressed Confirm on a draft the assistant prepared. The draft must be theirs, unused and
 * not expired. The saved fields go through the normal leave application, with every normal check, so
 * the assistant has no way around the rules.
 */
export async function confirmLeaveDraft(actor: Actor | null, draftId: string): Promise<ConfirmResult> {
  requireRole(actor, "employee");
  const draft = await getUsableDraft(actor, draftId);
  if (!draft || draft.kind !== "leave_application") {
    return { ok: false, error: "That draft has expired or was already used. Please ask me to prepare it again." };
  }
  const payload = draft.payload as { input?: unknown };
  const parsed = applyLeaveSchema.safeParse(payload?.input);
  if (!parsed.success) return { ok: false, error: "That draft is no longer valid. Please ask me to prepare it again." };

  try {
    await applyLeave(actor, parsed.data);
  } catch (err) {
    if (err instanceof DomainError) return { ok: false, error: err.message };
    throw err;
  }
  await markDraftUsed(actor, draftId);
  await recordAudit({ actorEmployeeId: actor.employeeId, action: "agent_leave_confirmed", entity: "agent_draft", entityId: draftId, summary: "Leave application confirmed from the assistant" });
  return { ok: true };
}
