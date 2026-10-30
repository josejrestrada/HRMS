"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentActor } from "@/shared/auth";
import { requireRole } from "@/shared/roles";
import { archiveOpenConversation } from "@/modules/agent/data";
import { runAssistant, type AssistantReply } from "@/modules/agent/orchestrator";
import { getProvider } from "@/modules/agent/provider";
import { confirmLeaveDraft } from "@/modules/agent/service";

// Every action checks sign-in and role on the server. The person asking always comes from the session.

async function requireActor() {
  const actor = await getCurrentActor();
  requireRole(actor, "employee");
  return actor;
}

const askSchema = z.object({ text: z.string().max(5000), conversationId: z.string().uuid().nullable().optional() });

export async function sendMessageAction(input: { text: string; conversationId?: string | null }): Promise<AssistantReply | { notSetUp: true }> {
  const actor = await requireActor();
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { conversationId: "", reply: "Please type a shorter question.", refused: true };
  const provider = getProvider();
  if (!provider) return { notSetUp: true };
  return runAssistant(actor, { text: parsed.data.text, conversationId: parsed.data.conversationId ?? null }, provider);
}

export async function confirmDraftAction(draftId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireActor();
  if (!z.string().uuid().safeParse(draftId).success) return { ok: false, error: "This draft is no longer available. Please ask again." };
  const result = await confirmLeaveDraft(actor, draftId);
  if (result.ok) revalidatePath("/app/leave");
  return result;
}

export async function clearChatAction(): Promise<void> {
  const actor = await requireActor();
  await archiveOpenConversation(actor);
  revalidatePath("/app/assistant");
}
