import { ProviderError, type ChatMessage, type LlmProvider, type ProviderResult, type ToolSpec } from "./types";

// Groq through its OpenAI-compatible chat completions interface. NOTE: not yet tested against the live
// service (no key has been set); the converters are covered by tests with fixtures.

type OaiToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OaiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OaiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export function toGroqRequest(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }, model: string) {
  const messages: OaiMessage[] = [{ role: "system", content: input.system }];
  for (const m of input.messages) {
    if (m.role === "user") messages.push({ role: "user", content: m.content });
    else if (m.role === "assistant") {
      messages.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls && m.toolCalls.length > 0
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    } else messages.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
  }
  return {
    model,
    messages,
    ...(input.tools.length > 0
      ? { tools: input.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: "auto" }
      : {}),
    temperature: 0.2,
    max_tokens: 700,
  };
}

export function fromGroqResponse(body: unknown): ProviderResult {
  const b = body as { choices?: { message?: { content?: string | null; tool_calls?: OaiToolCall[] } }[] };
  const message = b?.choices?.[0]?.message;
  if (!message) throw new ProviderError("Groq returned no answer");
  const toolCalls = (message.tool_calls ?? []).map((c, i) => {
    let args: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(c.function.arguments || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    } catch {
      args = { __invalid_arguments__: true }; // fails the tool's own validation, so nothing runs
    }
    return { id: c.id || `call_${i}`, name: c.function.name, args };
  });
  const text = (message.content ?? "").trim();
  if (!text && toolCalls.length === 0) throw new ProviderError("Groq returned an empty answer");
  return { text: text || null, toolCalls };
}

export function createGroqProvider(opts: { apiKey: string; model: string; fetchFn?: typeof fetch; timeoutMs?: number }): LlmProvider {
  const doFetch = opts.fetchFn ?? fetch;
  return {
    name: "groq",
    async generate(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
      try {
        const res = await doFetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(toGroqRequest(input, opts.model)),
          signal: controller.signal,
        });
        if (!res.ok) throw new ProviderError(`Groq answered with status ${res.status}`);
        return fromGroqResponse(await res.json());
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(err instanceof Error && err.name === "AbortError" ? "Groq timed out" : "Groq could not be reached");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
