import "server-only";
import { query } from "@/shared/db";
import { requireRole, type Actor } from "@/shared/roles";

// Storage for the HR assistant. Every function takes the acting employee and only ever reads or writes
// that employee's own conversations, messages and drafts. Rows are append-only apart from archiving a
// conversation and marking a draft as used (enforced by triggers in migration 012).

export type StoredMessage = { id: string; role: "user" | "assistant" | "tool"; content: string; toolName: string | null; createdAt: string };

export type DraftRecord = {
  id: string;
  conversationId: string;
  kind: "leave_application";
  payload: unknown;
  expiresAt: string;
  consumedAt: string | null;
};

export const MAX_MESSAGES_PER_HOUR = 20;
export const MAX_MESSAGES_PER_DAY = 100;
export const DRAFT_MINUTES = 30;

/** The employee's own open conversation (the given one if it is theirs and open, else the latest, else a new one). */
export async function getOrCreateConversation(actor: Actor | null, conversationId?: string | null): Promise<string> {
  requireRole(actor, "employee");
  const rows = await query<{ id: string }>(
    `select id from agent_conversation
      where employee_id = $1 and archived_at is null and ($2::uuid is null or id = $2::uuid)
      order by created_at desc limit 1`,
    [actor.employeeId, conversationId ?? null],
  );
  if (rows[0]) return rows[0].id;
  const created = await query<{ id: string }>("insert into agent_conversation (employee_id) values ($1) returning id", [actor.employeeId]);
  return created[0].id;
}

export async function appendMessage(
  actor: Actor | null,
  conversationId: string,
  role: StoredMessage["role"],
  content: string,
  toolName?: string,
): Promise<void> {
  requireRole(actor, "employee");
  // The conversation must be the actor's own, checked in the same statement.
  const rows = await query(
    `insert into agent_message (conversation_id, employee_id, role, content, tool_name)
     select c.id, c.employee_id, $3, $4, $5 from agent_conversation c where c.id = $1 and c.employee_id = $2
     returning id`,
    [conversationId, actor.employeeId, role, content.slice(0, 8000), toolName ?? null],
  );
  if (rows.length === 0) throw new Error("conversation not found for this employee");
}

/** The latest messages of a conversation, oldest first. Tool rows are left out unless asked for. */
export async function loadRecent(actor: Actor | null, conversationId: string, limit: number, withTools = false): Promise<StoredMessage[]> {
  requireRole(actor, "employee");
  const rows = await query<{ id: string; role: StoredMessage["role"]; content: string; tool_name: string | null; created_at: string }>(
    `select id::text, role, content, tool_name, created_at::text
       from agent_message
      where conversation_id = $1 and employee_id = $2 and ($4::boolean or role <> 'tool')
      order by agent_message.id desc limit $3`,
    [conversationId, actor.employeeId, limit, withTools],
  );
  return rows.reverse().map((r) => ({ id: r.id, role: r.role, content: r.content, toolName: r.tool_name, createdAt: r.created_at }));
}

/** How many questions this employee has asked in the last hour and day (for the rate limit). */
export async function countRecentUserMessages(actor: Actor | null): Promise<{ lastHour: number; lastDay: number }> {
  requireRole(actor, "employee");
  const rows = await query<{ hour: number; day: number }>(
    `select count(*) filter (where created_at > now() - interval '1 hour')::int as hour,
            count(*)::int as day
       from agent_message
      where employee_id = $1 and role = 'user' and created_at > now() - interval '1 day'`,
    [actor.employeeId],
  );
  return { lastHour: rows[0].hour, lastDay: rows[0].day };
}

export async function createDraft(actor: Actor | null, conversationId: string, payload: unknown): Promise<string> {
  requireRole(actor, "employee");
  const rows = await query<{ id: string }>(
    `insert into agent_draft (conversation_id, employee_id, kind, payload, expires_at)
     select c.id, c.employee_id, 'leave_application', $3::jsonb, now() + ($4 || ' minutes')::interval
       from agent_conversation c where c.id = $1 and c.employee_id = $2
     returning id`,
    [conversationId, actor.employeeId, JSON.stringify(payload), String(DRAFT_MINUTES)],
  );
  if (rows.length === 0) throw new Error("conversation not found for this employee");
  return rows[0].id;
}

/** A draft that belongs to this employee, is not used and has not expired; otherwise null. */
export async function getUsableDraft(actor: Actor | null, draftId: string): Promise<DraftRecord | null> {
  requireRole(actor, "employee");
  const rows = await query<{ id: string; conversation_id: string; kind: "leave_application"; payload: unknown; expires_at: string; consumed_at: string | null }>(
    `select id, conversation_id, kind, payload, expires_at::text, consumed_at::text
       from agent_draft where id = $1 and employee_id = $2 and consumed_at is null and expires_at > now()`,
    [draftId, actor.employeeId],
  );
  const r = rows[0];
  return r ? { id: r.id, conversationId: r.conversation_id, kind: r.kind, payload: r.payload, expiresAt: r.expires_at, consumedAt: r.consumed_at } : null;
}

export async function markDraftUsed(actor: Actor | null, draftId: string): Promise<boolean> {
  requireRole(actor, "employee");
  const rows = await query(
    "update agent_draft set consumed_at = now() where id = $1 and employee_id = $2 and consumed_at is null returning id",
    [draftId, actor.employeeId],
  );
  return rows.length > 0;
}

/** For the chat page: the open conversation's messages and the newest draft still waiting for a decision. */
export async function loadChatForPage(actor: Actor | null): Promise<{
  conversationId: string | null;
  messages: StoredMessage[];
  pendingDraft: { id: string; payload: unknown } | null;
}> {
  requireRole(actor, "employee");
  const conv = await query<{ id: string }>(
    "select id from agent_conversation where employee_id = $1 and archived_at is null order by created_at desc limit 1",
    [actor.employeeId],
  );
  if (!conv[0]) return { conversationId: null, messages: [], pendingDraft: null };
  const [messages, drafts] = await Promise.all([
    loadRecent(actor, conv[0].id, 40),
    query<{ id: string; payload: unknown }>(
      `select id, payload from agent_draft
        where conversation_id = $1 and employee_id = $2 and consumed_at is null and expires_at > now()
        order by created_at desc limit 1`,
      [conv[0].id, actor.employeeId],
    ),
  ]);
  return { conversationId: conv[0].id, messages, pendingDraft: drafts[0] ?? null };
}

/** "Clear chat": archive the employee's open conversation. Nothing is deleted. */
export async function archiveOpenConversation(actor: Actor | null): Promise<void> {
  requireRole(actor, "employee");
  await query("update agent_conversation set archived_at = now() where employee_id = $1 and archived_at is null", [actor.employeeId]);
}
