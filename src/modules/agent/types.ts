// Small, provider-neutral types for the HR assistant. No database and no server-only code.

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

// `signature` is an opaque value some providers (Gemini 3) require to be sent back with the call.
export type ToolCall = { id: string; name: string; args: Record<string, unknown>; signature?: string };

export type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

export type ToolSpec = { name: string; description: string; parameters: JsonSchema };

export type ProviderResult = { text: string | null; toolCalls: ToolCall[] };

export interface LlmProvider {
  readonly name: string;
  generate(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }): Promise<ProviderResult>;
}

/** The provider failed or refused. The message is safe to log, never shown to the user as is. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
