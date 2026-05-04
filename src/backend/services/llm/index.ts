import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import type { LLMProvider } from "./LLMProvider";

const providers: Record<string, LLMProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider()
};

export function getProvider(id: string) {
  const provider = providers[id];
  if (!provider) throw new Error(`Unsupported provider: ${id}`);
  return provider;
}

export const providerModels = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"],
  anthropic: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest"
  ]
};

export function normalizeModel(provider: string, model: string | undefined) {
  if (provider !== "anthropic") return model ?? "gpt-4.1-mini";
  if (!model || model === "claude-3-5-sonnet-latest") return "claude-sonnet-4-20250514";
  return model;
}
