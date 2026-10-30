import "server-only";
import { recordAudit } from "@/shared/audit";
import { todayIST } from "@/shared/dates";
import { requireRole, type Actor } from "@/shared/roles";
import {
  MAX_MESSAGES_PER_DAY,
  MAX_MESSAGES_PER_HOUR,
  appendMessage,
  countRecentUserMessages,
  getOrCreateConversation,
  loadRecent,
} from "./data";
import { buildSystemPrompt } from "./prompts";
import { executeTool, toolsFor, type DraftSummary } from "./tools";
import { ProviderError, type ChatMessage, type LlmProvider } from "./types";

export const MAX_INPUT_CHARS = 600;
export const MAX_TOOL_ROUNDS = 4;
export const MAX_TOOLS_PER_ROUND = 3;
export const MAX_REPLY_CHARS = 1500;
const HISTORY_MESSAGES = 8;

export type AssistantReply = {
  conversationId: string | null;
  reply: string;
  draft?: DraftSummary;
  /** The message was refused or could not be answered; nothing was sent to the model. */
  refused?: boolean;
};

const SORRY = "Sorry, I could not answer just now. Please try again in a moment, or ask HR.";

/**
 * One turn of the conversation. Identity is the signed-in `actor`; the model only ever calls the fixed
 * tools in tools.ts. Everything that happens is stored on the employee's own conversation, and every
 * tool call is audited.
 */
export async function runAssistant(
  actor: Actor | null,
  input: { text: string; conversationId?: string | null },
  provider: LlmProvider,
): Promise<AssistantReply> {
  requireRole(actor, "employee");
  const text = (input.text ?? "").trim();
  if (text.length === 0) return { conversationId: null, reply: "Please type a question.", refused: true };
  if (text.length > MAX_INPUT_CHARS) {
    return { conversationId: null, reply: `That message is too long. Please keep it under ${MAX_INPUT_CHARS} characters.`, refused: true };
  }

  const recent = await countRecentUserMessages(actor);
  if (recent.lastHour >= MAX_MESSAGES_PER_HOUR || recent.lastDay >= MAX_MESSAGES_PER_DAY) {
    return { conversationId: null, reply: "You have asked a lot of questions in a short time. Please try again a little later, or ask HR directly.", refused: true };
  }

  const conversationId = await getOrCreateConversation(actor, input.conversationId);
  await appendMessage(actor, conversationId, "user", text);

  const isHr = actor.roles.includes("hr_admin");
  const system = buildSystemPrompt({ today: todayIST(), roles: { isHr, isManagerOrHr: true } });
  const tools = toolsFor(actor);

  // Earlier turns: only what was said, not old tool results (which could be out of date).
  const history = await loadRecent(actor, conversationId, HISTORY_MESSAGES + 1);
  const messages: ChatMessage[] = history.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }) as ChatMessage);

  let draft: DraftSummary | undefined;
  let reply: string | null = null;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
      const out = await provider.generate({ system, messages, tools });
      if (out.toolCalls.length === 0) {
        reply = out.text;
        break;
      }
      if (round === MAX_TOOL_ROUNDS) break; // still asking for tools after the limit: give up politely

      const calls = out.toolCalls.slice(0, MAX_TOOLS_PER_ROUND);
      messages.push({ role: "assistant", content: out.text ?? "", toolCalls: calls });
      for (const call of calls) {
        const outcome = await executeTool(actor, conversationId, call.name, call.args);
        const content = JSON.stringify(outcome.result);
        if (outcome.draft) draft = outcome.draft;
        await appendMessage(actor, conversationId, "tool", content, call.name);
        await recordAudit({ actorEmployeeId: actor.employeeId, action: "agent_tool", entity: "agent_conversation", entityId: conversationId, summary: call.name });
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content });
      }
    }
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    await appendMessage(actor, conversationId, "assistant", SORRY);
    return { conversationId, reply: SORRY, refused: true };
  }

  const finalText = (reply ?? "").trim().slice(0, MAX_REPLY_CHARS) || SORRY;
  await appendMessage(actor, conversationId, "assistant", finalText);
  return { conversationId, reply: finalText, ...(draft ? { draft } : {}) };
}
