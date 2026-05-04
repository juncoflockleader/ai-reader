import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicProvider } from "./AnthropicProvider";
import { OpenAIProvider } from "./OpenAIProvider";
import type { LLMProvider } from "./LLMProvider";

type ProviderModels = {
  openai: string[];
  anthropic: string[];
};

const providers: Record<string, LLMProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider()
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const modelCatalogPath = path.join(root, "available-models.json");

export function getProvider(id: string) {
  const provider = providers[id];
  if (!provider) throw new Error(`Unsupported provider: ${id}`);
  return provider;
}

const defaultProviderModels: ProviderModels = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-opus-4-7",
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5",
    "claude-opus-4-1-20250805"
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
  if (provider !== "anthropic") return model ?? "gpt-4.1-mini";
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
  return {
    openai: normalizeModelList(candidate.openai, defaultProviderModels.openai),
    anthropic: normalizeModelList(candidate.anthropic, defaultProviderModels.anthropic)
  };
}

function normalizeModelList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const models = value.filter((model): model is string => typeof model === "string" && model.trim().length > 0);
  return models.length > 0 ? Array.from(new Set(models.map((model) => model.trim()))) : fallback;
}
