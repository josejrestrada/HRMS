"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { AssistantReply } from "@/modules/agent/orchestrator";
import type { DraftSummary } from "@/modules/agent/tools";

type Line = { role: "user" | "assistant"; text: string };

const SUGGESTIONS = ["How many casual leaves do I have left?", "Show my attendance this month", "When is the next holiday?", "Apply casual leave tomorrow"];

export function ChatPanel(props: {
  setUp: boolean;
  initialConversationId: string | null;
  initialMessages: Line[];
  initialDraft: DraftSummary | null;
  send: (input: { text: string; conversationId?: string | null }) => Promise<AssistantReply | { notSetUp: true }>;
  confirm: (draftId: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  clear: () => Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>(props.initialMessages);
  const [conversationId, setConversationId] = useState(props.initialConversationId);
  const [draft, setDraft] = useState<DraftSummary | null>(props.initialDraft);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [notSetUp, setNotSetUp] = useState(!props.setUp);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines, draft, pending]);

  function ask(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setLines((l) => [...l, { role: "user", text: q }]);
    setText("");
    setDraft(null);
    start(async () => {
      try {
        const r = await props.send({ text: q, conversationId });
        if ("notSetUp" in r) return setNotSetUp(true);
        if (r.conversationId) setConversationId(r.conversationId);
        setLines((l) => [...l, { role: "assistant", text: r.reply }]);
        if (r.draft) setDraft(r.draft);
      } catch {
        setLines((l) => [...l, { role: "assistant", text: "Sorry, something went wrong. Please try again." }]);
      }
    });
  }

  function confirm() {
    if (!draft) return;
    const id = draft.draftId;
    start(async () => {
      const r = await props.confirm(id).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
      setDraft(null);
      setLines((l) => [...l, { role: "assistant", text: r.ok ? "Done. Your leave request has been sent to your manager. You can see it under Leave." : r.error }]);
    });
  }

  if (notSetUp) {
    return (
      <section className="panel">
        <p className="empty">The assistant is not set up yet. Please ask HR to finish the setup. You can still use the Leave and Attendance pages.</p>
      </section>
    );
  }

  return (
    <section className="panel chat">
      <p className="hint chat-privacy">Please do not type ID numbers, bank details or medical details. The assistant can only see your own leave and attendance.</p>
      <div className="chat-log" role="log" aria-live="polite" aria-label="Conversation">
        {lines.length === 0 ? (
          <div className="chat-empty">
            <p>Hello! What would you like to know?</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip chip-button" onClick={() => ask(s)} disabled={pending}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {lines.map((l, i) => (
          <p key={i} className={`chat-line chat-${l.role}`}>
            {l.text}
          </p>
        ))}
        {draft ? (
          <div className="chat-draft" role="group" aria-label="Leave request waiting for your confirmation">
            <strong>{draft.leaveType}</strong>
            <span>
              {draft.from === draft.to ? draft.from : `${draft.from} to ${draft.to}`} · {draft.days} {draft.days === 1 ? "day" : "days"}
              {draft.unpaidDays > 0 ? ` (${draft.unpaidDays} unpaid)` : ""}
            </span>
            {draft.skipped.length ? <span className="hint">Not counted: {draft.skipped.join(", ")}</span> : null}
            {draft.certificateNeeded ? <span className="hint">A medical certificate will be needed.</span> : null}
            <div className="chat-draft-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={confirm} disabled={pending}>
                Confirm and send
              </button>
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setDraft(null)} disabled={pending}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {pending ? <p className="chat-line chat-assistant chat-wait">Thinking…</p> : null}
        <div ref={end} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Your question
        </label>
        <input id="chat-input" type="text" value={text} maxLength={600} autoComplete="off" placeholder="Type your question" onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-primary" disabled={pending || !text.trim()}>
          Send
        </button>
        {lines.length > 0 ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await props.clear();
                setLines([]);
                setDraft(null);
                setConversationId(null);
              })
            }
          >
            Clear chat
          </button>
        ) : null}
      </form>
    </section>
  );
}
