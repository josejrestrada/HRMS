import type { ChatMessage, LlmProvider, ProviderResult, ToolSpec } from "../../src/modules/agent/types";
import { ProviderError } from "../../src/modules/agent/types";

export type Step = ProviderResult | Error | ((input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }) => ProviderResult);

/** A provider that plays back a fixed script and records what it was asked. Used only in tests. */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  calls: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }[] = [];
  private index = 0;
  constructor(private steps: Step[]) {}

  async generate(input: { system: string; messages: ChatMessage[]; tools: ToolSpec[] }): Promise<ProviderResult> {
    this.calls.push({ system: input.system, messages: [...input.messages], tools: input.tools });
    const step = this.steps[Math.min(this.index, this.steps.length - 1)];
    this.index += 1;
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(input);
    return step;
  }
}

export const say = (text: string): ProviderResult => ({ text, toolCalls: [] });
export const callTool = (name: string, args: Record<string, unknown> = {}, id = "call_1"): ProviderResult => ({ text: null, toolCalls: [{ id, name, args }] });
export const failing = (message = "boom") => new ProviderError(message);
