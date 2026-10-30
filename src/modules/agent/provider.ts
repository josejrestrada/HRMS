import { createGeminiProvider } from "./gemini";
import { createGroqProvider } from "./groq";
import type { LlmProvider } from "./types";

// Defaults are starting points, not verified against the live services. Set AGENT_MODEL to override.
export const DEFAULT_MODELS = { gemini: "gemini-3.5-flash", groq: "llama-3.3-70b-versatile" } as const;

/**
 * The configured model provider, or null if none is set up. AGENT_PROVIDER picks "gemini" or "groq";
 * if it is not set, whichever key exists is used (Gemini first).
 */
export function getProvider(env: Record<string, string | undefined> = process.env, fetchFn?: typeof fetch): LlmProvider | null {
  const want = env.AGENT_PROVIDER?.toLowerCase();
  const gemini = env.GEMINI_API_KEY?.trim();
  const groq = env.GROQ_API_KEY?.trim();
  const model = env.AGENT_MODEL?.trim();

  if ((want === "gemini" || !want) && gemini) return createGeminiProvider({ apiKey: gemini, model: model || DEFAULT_MODELS.gemini, fetchFn });
  if ((want === "groq" || !want) && groq) return createGroqProvider({ apiKey: groq, model: model || DEFAULT_MODELS.groq, fetchFn });
  return null;
}
