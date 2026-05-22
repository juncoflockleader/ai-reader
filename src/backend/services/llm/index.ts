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
