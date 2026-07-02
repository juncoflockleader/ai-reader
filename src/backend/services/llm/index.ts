import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import type { LLMProvider } from "./LLMProvider";

export type ProviderId = "openai" | "anthropic" | "deepseek" | "doubao";

type ProviderModels = {
  [provider in ProviderId]: string[];
};

export const providerIds: ProviderId[] = ["openai", "anthropic", "deepseek", "doubao"];

const providers: Record<ProviderId, LLMProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  deepseek: new OpenAIProvider("deepseek", "DeepSeek", "https://api.deepseek.com"),
  doubao: new OpenAIProvider("doubao", "Doubao / Volcengine Ark", "https://ark.cn-beijing.volces.com/api/v3")
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const modelCatalogPath = path.join(root, "available-models.json");

export function getProvider(id: string) {
  const provider = isProviderId(id) ? providers[id] : undefined;
  if (!provider) throw new Error(`Unsupported provider: ${id}`);
  return provider;
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && providerIds.includes(value as ProviderId);
}

/**
 * Whether a provider/model is *known* to be text-only — i.e. we're confident it
 * cannot accept image input. Used to pre-flight screenshot attachments.
 *
 * This is a deliberately small, high-confidence denylist that FAILS OPEN:
 * anything not listed here is allowed to try, and the chat route translates any
 * image-related provider error into a clear message as a backstop
 * (see isImageUnsupportedError). That way a stale list can only cost one wasted
 * round-trip — it can never silently drop an image or wrongly block a
 * newly-released multimodal model.
 *
 * Maintenance: only add a case when you are confident the model stays text-only.
 * Everything else is intentionally handled by the runtime backstop.
 */
export function modelIsKnownTextOnly(provider: ProviderId, model: string): boolean {
  const m = model.toLowerCase();
  // Any explicit multimodal signal means it is NOT text-only.
  if (/vision|multimodal|omni|(^|[-_])vl(\d|[-_]|$)/.test(m)) return false;
  switch (provider) {
    case "openai":
      // Legacy / non-chat text endpoints only. New GPT and o-series families are allowed to try.
      return /gpt-3\.5|text-|davinci|babbage|ada|whisper|embedding/.test(m);
    case "anthropic":
      // Only the frozen legacy line is text-only; Claude 3+ and 4.x are multimodal.
      return /claude-2|claude-instant/.test(m);
    case "deepseek":
      // DeepSeek's chat/reasoner lineup is text-only (its separate -vl line is caught above).
      return true;
    case "doubao":
      // ByteDance Seed models are multimodal; leave any edge cases to the backstop.
      return false;
    default:
      return false; // Unknown provider — let it try; the backstop translates any error.
  }
}

const defaultProviderModels: ProviderModels = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5",
    "claude-opus-4-1-20250805"
  ],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"],
  doubao: [
    "doubao-seed-2-0-lite-260215",
    "doubao-seed-2-0-pro-260215",
    "doubao-seed-2-0-mini-260215",
    "doubao-seed-code-preview-251028",
    "doubao-seed-1-6-251015",
    "doubao-seed-1-6-flash-250828"
  ]
};

export function getProviderModels(): ProviderModels {
  try {
    return normalizeProviderModels(JSON.parse(fs.readFileSync(modelCatalogPath, "utf8")));
  } catch {
    return defaultProviderModels;
  }
}

export function normalizeModel(provider: string, model: string | undefined) {
  if (provider === "openai") return model ?? "gpt-4.1-mini";
  if (provider === "deepseek") return model ?? "deepseek-v4-flash";
  if (provider === "doubao") return model ?? "doubao-seed-2-0-lite-260215";
  if (!model) return "claude-sonnet-4-6";
  const modelMigrations: Record<string, string> = {
    "claude-3-5-sonnet-latest": "claude-sonnet-4-6",
    "claude-sonnet-4-20250514": "claude-sonnet-4-6"
  };
  if (modelMigrations[model]) return modelMigrations[model];
  return model;
}

function normalizeProviderModels(value: unknown): ProviderModels {
  if (!value || typeof value !== "object") return defaultProviderModels;
  const candidate = value as Partial<Record<keyof ProviderModels, unknown>>;
  return Object.fromEntries(
    providerIds.map((providerId) => [providerId, normalizeModelList(candidate[providerId], defaultProviderModels[providerId])])
  ) as ProviderModels;
}

function normalizeModelList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const models = value.filter((model): model is string => typeof model === "string" && model.trim().length > 0);
  return models.length > 0 ? Array.from(new Set(models.map((model) => model.trim()))) : fallback;
}
