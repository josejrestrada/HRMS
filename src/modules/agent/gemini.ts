import { ProviderError, type ChatMessage, type LlmProvider, type ProviderResult, type ToolSpec } from "./types";

// Google Gemini through its REST interface. The request and response shapes follow Google's published
// generateContent format. NOTE: not yet tested against the live service (no key has been set); the
// converters below are covered by tests with recorded-style fixtures.

type GeminiPart = { text?: string; functionCall?: { name: string; args?: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export function toGeminiRequest(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }) {
  const contents: GeminiContent[] = [];
  for (const m of input.messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.content }] });
    } else if (m.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: c.args } });
      if (parts.length > 0) contents.push({ role: "model", parts });
    } else {
      // Tool results go back as one "user" turn; consecutive results share a turn.
      const part: GeminiPart = { functionResponse: { name: m.toolName, response: { content: m.content } } };
      const last = contents[contents.length - 1];
      if (last && last.role === "user" && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  return {
    systemInstruction: { parts: [{ text: input.system }] },
    contents,
    ...(input.tools.length > 0
      ? { tools: [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }] }
      : {}),
    generationConfig: { temperature: 0.2, maxOutputTokens: 700 },
  };
}

export function fromGeminiResponse(body: unknown): ProviderResult {
  const b = body as { candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  const candidate = b?.candidates?.[0];
  if (!candidate) throw new ProviderError(`Gemini returned no answer${b?.promptFeedback?.blockReason ? ` (blocked: ${b.promptFeedback.blockReason})` : ""}`);
  const parts = candidate.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("").trim();
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `call_${i}`, name: p.functionCall!.name, args: (p.functionCall!.args ?? {}) as Record<string, unknown> }));
  if (!text && toolCalls.length === 0) throw new ProviderError(`Gemini returned an empty answer (${candidate.finishReason ?? "no reason"})`);
  return { text: text || null, toolCalls };
}

export function createGeminiProvider(opts: { apiKey: string; model: string; fetchFn?: typeof fetch; timeoutMs?: number }): LlmProvider {
  const doFetch = opts.fetchFn ?? fetch;
  return {
    name: "gemini",
    async generate(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
      try {
        const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify(toGeminiRequest(input)),
          signal: controller.signal,
        });
        if (!res.ok) throw new ProviderError(`Gemini answered with status ${res.status}`);
        return fromGeminiResponse(await res.json());
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        throw new ProviderError(err instanceof Error && err.name === "AbortError" ? "Gemini timed out" : "Gemini could not be reached");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
