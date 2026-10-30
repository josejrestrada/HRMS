// Runs only with RUN_DB_TESTS=yes (npm run test:db). The assistant's storage: scoping to the owner,
// rate-limit counting, and draft expiry / single use. The agent data layer uses the shared query helper,
// so here that helper is pointed at one open transaction which is ALWAYS rolled back.
import { Pool } from "@neondatabase/serverless";
import type { PoolClient } from "@neondatabase/serverless";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseTestsEnabled } from "./enabled";

vi.mock("server-only", () => ({}));

let current: PoolClient | null = null;
vi.mock("@/shared/db", () => ({
  query: async (text: string, params: unknown[] = []) => (await current!.query(text, params)).rows,
}));

const enabled = databaseTestsEnabled();

type Actor = { employeeId: string; employeeCode: string; fullName: string; roles: "employee"[] };

describe.skipIf(!enabled)("HR assistant storage against the database", () => {
  let pool: Pool;
  let agent: typeof import("@/modules/agent/data");
  let me: Actor;
  let other: Actor;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    agent = await import("@/modules/agent/data");
    const rows = (await pool.query("select id, employee_code, full_name from employee where status = 'active' order by employee_code limit 2")).rows;
    const mk = (r: { id: string; employee_code: string; full_name: string }): Actor => ({ employeeId: r.id, employeeCode: r.employee_code, fullName: r.full_name, roles: ["employee"] });
    me = mk(rows[0]);
    other = mk(rows[1]);
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    current = await pool.connect();
    await current.query("begin");
  });
  afterEach(async () => {
    await current!.query("rollback");
    current!.release();
    current = null;
  });

  it("keeps a conversation, its messages and its drafts private to the owner", async () => {
    const conv = await agent.getOrCreateConversation(me);
    await agent.appendMessage(me, conv, "user", "hello");
    await agent.appendMessage(me, conv, "assistant", "hi");
    await agent.appendMessage(me, conv, "tool", "{}", "get_my_leave_balances");

    expect((await agent.loadRecent(me, conv, 10)).map((m) => m.content)).toEqual(["hello", "hi"]); // tool rows hidden
    expect(await agent.loadRecent(me, conv, 10, true)).toHaveLength(3);
    expect(await agent.loadRecent(other, conv, 10)).toEqual([]);
    await expect(agent.appendMessage(other, conv, "user", "sneaky")).rejects.toThrow();
    await expect(agent.createDraft(other, conv, { x: 1 })).rejects.toThrow();
    // Asking for someone else's conversation id gives the asker their own, never the other's.
    expect(await agent.getOrCreateConversation(other, conv)).not.toBe(conv);
  });

  it("counts only the user's own questions", async () => {
    const mineBefore = await agent.countRecentUserMessages(me);
    const otherBefore = await agent.countRecentUserMessages(other);
    const conv = await agent.getOrCreateConversation(me);
    await agent.appendMessage(me, conv, "user", "one");
    await agent.appendMessage(me, conv, "user", "two");
    await agent.appendMessage(me, conv, "assistant", "reply");
    await agent.appendMessage(me, conv, "tool", "{}", "get_my_leave_balances");
    const mine = await agent.countRecentUserMessages(me);
    expect(mine.lastHour - mineBefore.lastHour).toBe(2);
    expect(mine.lastDay - mineBefore.lastDay).toBe(2);
    expect(await agent.countRecentUserMessages(other)).toEqual(otherBefore);
  });

  it("lets a draft be used once, by its owner, before it expires", async () => {
    const conv = await agent.getOrCreateConversation(me);
    const id = await agent.createDraft(me, conv, { input: { a: 1 } });
    expect(await agent.getUsableDraft(other, id)).toBeNull();
    expect(await agent.getUsableDraft(me, id)).toMatchObject({ id, kind: "leave_application" });
    expect(await agent.markDraftUsed(other, id)).toBe(false);
    expect(await agent.markDraftUsed(me, id)).toBe(true);
    expect(await agent.markDraftUsed(me, id)).toBe(false); // single use
    expect(await agent.getUsableDraft(me, id)).toBeNull();

    // Drafts cannot be edited afterwards, so an already-expired one is inserted directly.
    const old = (
      await current!.query(
        "insert into agent_draft (conversation_id, employee_id, kind, payload, created_at, expires_at) values ($1, $2, 'leave_application', '{}', now() - interval '1 hour', now() - interval '1 minute') returning id",
        [conv, me.employeeId],
      )
    ).rows[0].id;
    expect(await agent.getUsableDraft(me, old)).toBeNull();
  });

  it("shows the chat page the open conversation and the newest waiting draft, and clearing archives without deleting", async () => {
    const conv = await agent.getOrCreateConversation(me);
    await agent.appendMessage(me, conv, "user", "apply leave");
    const id = await agent.createDraft(me, conv, { summary: { leaveType: "Casual leave" } });
    const page = await agent.loadChatForPage(me);
    expect(page.conversationId).toBe(conv);
    expect(page.pendingDraft?.id).toBe(id);

    await agent.archiveOpenConversation(me);
    expect((await agent.loadChatForPage(me)).conversationId).not.toBe(conv);
    const kept = await current!.query("select count(*)::int as n from agent_message where conversation_id = $1", [conv]);
    expect(kept.rows[0].n).toBe(1);
  });

  it("refuses to change or delete stored messages", async () => {
    const conv = await agent.getOrCreateConversation(me);
    await agent.appendMessage(me, conv, "user", "keep me");
    await current!.query("savepoint s1");
    await expect(current!.query("update agent_message set content = 'edited' where conversation_id = $1", [conv])).rejects.toThrow();
    await current!.query("rollback to savepoint s1");
    await expect(current!.query("delete from agent_message where conversation_id = $1", [conv])).rejects.toThrow();
  });
});
