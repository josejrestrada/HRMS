import { notFound } from "next/navigation";
import { previewClear, previewConfirm, previewSend } from "./actions";
import { ChatPanel } from "../../(clerk)/app/assistant/_components/chat-panel";

// Development-only design preview with a scripted assistant. It reads no database, no session and calls no
// model, and it returns 404 in production. Use ?view=empty | draft | off
const draft = { draftId: "d1", leaveType: "Casual leave", from: "3 Nov 2026", to: "5 Nov 2026", dayPart: "full", days: 3, balanceAfter: 2, unpaidDays: 0, certificateNeeded: false, skipped: [], expiresInMinutes: 30 };

export default async function AssistantPreview({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view = "draft" } = await searchParams;
  return (
    <div className="app-shell">
      <div className="app-body">
        <main id="main" className="app-main">
          <div className="page-head">
            <h1>HR assistant</h1>
          </div>
          <ChatPanel
            setUp={view !== "off"}
            initialConversationId={null}
            initialMessages={
              view === "empty" || view === "off"
                ? []
                : [
                    { role: "user", text: "Apply casual leave from 3 to 5 Nov" },
                    { role: "assistant", text: "Your draft is ready. Please check it and press Confirm and send." },
                  ]
            }
            initialDraft={view === "draft" ? draft : null}
            send={previewSend}
            confirm={previewConfirm}
            clear={previewClear}
          />
        </main>
      </div>
    </div>
  );
}
