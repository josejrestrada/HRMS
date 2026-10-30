import { getCurrentActor } from "@/shared/auth";
import { loadChatForPage } from "@/modules/agent/data";
import { getProvider } from "@/modules/agent/provider";
import type { DraftSummary } from "@/modules/agent/tools";
import { NotLinked } from "../_components/ui";
import { clearChatAction, confirmDraftAction, sendMessageAction } from "./actions";
import { ChatPanel } from "./_components/chat-panel";

export default async function AssistantPage() {
  const actor = await getCurrentActor();
  if (!actor) return <NotLinked />;
  const setUp = getProvider() !== null;
  const chat = setUp ? await loadChatForPage(actor) : { conversationId: null, messages: [], pendingDraft: null };
  const summary = (chat.pendingDraft?.payload as { summary?: Omit<DraftSummary, "draftId"> } | null)?.summary;

  return (
    <>
      <div className="page-head">
        <h1>HR assistant</h1>
        <p className="lede">Ask about your leave, attendance or company policy.</p>
      </div>
      <ChatPanel
        setUp={setUp}
        initialConversationId={chat.conversationId}
        initialMessages={chat.messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.content }))}
        initialDraft={chat.pendingDraft && summary ? { ...summary, draftId: chat.pendingDraft.id } : null}
        send={sendMessageAction}
        confirm={confirmDraftAction}
        clear={clearChatAction}
      />
    </>
  );
}
