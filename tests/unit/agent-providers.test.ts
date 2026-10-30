import { describe, expect, it, vi } from "vitest";
import { createGeminiProvider, fromGeminiResponse, toGeminiRequest } from "@/modules/agent/gemini";
import { createGroqProvider, fromGroqResponse, toGroqRequest } from "@/modules/agent/groq";
import { DEFAULT_MODELS, getProvider } from "@/modules/agent/provider";
import { ProviderError, type ChatMessage, type ToolSpec } from "@/modules/agent/types";

const tools: ToolSpec[] = [{ name: "get_my_leave_balances", description: "Balances", parameters: { type: "object", properties: {}, additionalProperties: false } }];
const history: ChatMessage[] = [
  { role: "user", content: "How many CL do I have?" },
  { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_my_leave_balances", args: {} }, { id: "c2", name: "list_my_leave_requests", args: {} }] },
  { role: "tool", toolCallId: "c1", toolName: "get_my_leave_balances", content: '{"CL":5}' },
  { role: "tool", toolCallId: "c2", toolName: "list_my_leave_requests", content: "[]" },
];

describe("Gemini request and response", () => {
  it("builds the request with the system text, tool declarations and merged tool results", () => {
    const r = toGeminiRequest({ system: "Be brief.", messages: history, tools });
    expect(r.systemInstruction.parts[0].text).toBe("Be brief.");
    expect(r.tools?.[0].functionDeclarations[0].name).toBe("get_my_leave_balances");
    expect(r.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(r.contents[1].parts.map((p) => p.functionCall?.name)).toEqual(["get_my_leave_balances", "list_my_leave_requests"]);
    expect(r.contents[2].parts).toHaveLength(2); // both results in one turn
    expect(JSON.stringify(r)).not.toContain("api");
  });

  it("omits tools when there are none", () => {
    expect(toGeminiRequest({ system: "x", messages: [{ role: "user", content: "hi" }], tools: [] })).not.toHaveProperty("tools");
  });

  it("reads text and tool calls from an answer", () => {
    expect(fromGeminiResponse({ candidates: [{ content: { parts: [{ text: "You have " }, { text: "5 days." }] } }] })).toEqual({ text: "You have 5 days.", toolCalls: [] });
    const r = fromGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "get_my_leave_balances", args: {} } }] } }] });
    expect(r).toEqual({ text: null, toolCalls: [{ id: "call_0", name: "get_my_leave_balances", args: {} }] });
  });

  it("treats a blocked or empty answer as a provider error", () => {
    expect(() => fromGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(ProviderError);
    expect(() => fromGeminiResponse({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] })).toThrow(/empty/);
  });

  it("sends the key in a header, never in the address, and never leaks the body in errors", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "secret details" }) });
    const p = createGeminiProvider({ apiKey: "KEY123", model: "m", fetchFn: fetchFn as unknown as typeof fetch });
    await expect(p.generate({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] })).rejects.toThrow("Gemini answered with status 429");
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).not.toContain("KEY123");
    expect((init as RequestInit & { headers: Record<string, string> }).headers["x-goog-api-key"]).toBe("KEY123");
  });

  it("turns a network failure or timeout into a provider error", async () => {
    const down = createGeminiProvider({ apiKey: "k", model: "m", fetchFn: (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch });
    await expect(down.generate({ system: "s", messages: [], tools: [] })).rejects.toThrow(/could not be reached/);
    const slow = createGeminiProvider({
      apiKey: "k",
      model: "m",
      timeoutMs: 20,
      fetchFn: ((_u: unknown, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch,
    });
    await expect(slow.generate({ system: "s", messages: [], tools: [] })).rejects.toThrow(/timed out/);
  });
});

describe("Groq request and response", () => {
  it("builds an OpenAI-style request with tool calls and results", () => {
    const r = toGroqRequest({ system: "Be brief.", messages: history, tools }, "llama");
    expect(r.messages[0]).toEqual({ role: "system", content: "Be brief." });
    const assistant = r.messages[2] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    expect(assistant.tool_calls.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(assistant.tool_calls[0].function.arguments).toBe("{}");
    expect(r.messages[3]).toEqual({ role: "tool", tool_call_id: "c1", content: '{"CL":5}' });
    expect(r.tools?.[0].function.name).toBe("get_my_leave_balances");
  });

  it("reads text and tool calls, and makes broken arguments fail validation later", () => {
    expect(fromGroqResponse({ choices: [{ message: { content: "5 days." } }] })).toEqual({ text: "5 days.", toolCalls: [] });
    const ok = fromGroqResponse({ choices: [{ message: { content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "x", arguments: '{"month":"2026-10"}' } }] } }] });
    expect(ok.toolCalls[0]).toEqual({ id: "t1", name: "x", args: { month: "2026-10" } });
    const bad = fromGroqResponse({ choices: [{ message: { content: null, tool_calls: [{ id: "t2", type: "function", function: { name: "x", arguments: "{not json" } }] } }] });
    expect(bad.toolCalls[0].args).toEqual({ __invalid_arguments__: true });
  });

  it("treats an empty answer as a provider error and keeps the key in a header", async () => {
    expect(() => fromGroqResponse({ choices: [] })).toThrow(ProviderError);
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Hello" } }] }) });
    const p = createGroqProvider({ apiKey: "GKEY", model: "llama", fetchFn: fetchFn as unknown as typeof fetch });
    expect(await p.generate({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] })).toEqual({ text: "Hello", toolCalls: [] });
    const [url, init] = fetchFn.mock.calls[0];
    expect(String(url)).not.toContain("GKEY");
    expect((init as RequestInit & { headers: Record<string, string> }).headers.authorization).toBe("Bearer GKEY");
  });
});

describe("getProvider", () => {
  it("is null when no key is set, so the page can say it is not set up", () => {
    expect(getProvider({})).toBeNull();
    expect(getProvider({ GEMINI_API_KEY: "  ", GROQ_API_KEY: "" })).toBeNull();
    expect(getProvider({ AGENT_PROVIDER: "groq", GEMINI_API_KEY: "g" })).toBeNull(); // the chosen provider has no key
  });

  it("uses whichever key exists, Gemini first, unless a provider is chosen", () => {
    expect(getProvider({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })?.name).toBe("gemini");
    expect(getProvider({ GROQ_API_KEY: "q" })?.name).toBe("groq");
    expect(getProvider({ AGENT_PROVIDER: "groq", GEMINI_API_KEY: "g", GROQ_API_KEY: "q" })?.name).toBe("groq");
  });

  it("has default model names that can be overridden", () => {
    expect(DEFAULT_MODELS.gemini).toBeTruthy();
    expect(getProvider({ GEMINI_API_KEY: "g", AGENT_MODEL: "my-model" })?.name).toBe("gemini");
  });
});

describe("Gemini live-service findings", () => {
  const spec = (parameters: any) => ({ name: "t", description: "d", parameters });

  it("leaves out additionalProperties, and leaves parameters out for tools with no arguments", () => {
    const req = toGeminiRequest({
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [spec({ type: "object", properties: {}, additionalProperties: false }), spec({ type: "object", properties: { month: { type: "string" } }, additionalProperties: false })],
    });
    const [none, withArg] = req.tools![0].functionDeclarations as any[];
    expect(none.parameters).toBeUndefined();
    expect(withArg.parameters).toEqual({ type: "object", properties: { month: { type: "string" } } });
  });

  it("sends back the thought signature that came with a tool call", () => {
    const result = fromGeminiResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "t", args: {} }, thoughtSignature: "sig" }] } }] });
    expect(result.toolCalls[0].signature).toBe("sig");
    const req = toGeminiRequest({ system: "s", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "", toolCalls: result.toolCalls }], tools: [] });
    expect((req.contents[1].parts[0] as any).thoughtSignature).toBe("sig");
  });
});
