import { Router } from "express";
import { getDb, nowIso } from "../services/storage/db";
import { getProvider, getProviderModels, normalizeModel } from "../services/llm";

const router = Router();

type ProviderId = "openai" | "anthropic";
type ChatMode = "no_context_fast" | "pdf_fast" | "pdf_thinking";
type ModelChoice = { provider: ProviderId; model: string };
type AppSettings = {
  defaultProvider: ProviderId;
  providers: Record<ProviderId, { model: string; hasKey: boolean; apiKey?: string }>;
  modelMode: "single" | "detailed";
  chatModels: Record<ChatMode, ModelChoice>;
  privacyAcknowledged: boolean;
  keyStorageWarning: string;
};

const defaults: AppSettings = {
  defaultProvider: "openai",
  providers: {
    openai: { model: "gpt-4.1-mini", hasKey: false },
    anthropic: { model: "claude-sonnet-4-6", hasKey: false }
  },
  modelMode: "single",
  chatModels: {
    no_context_fast: { provider: "openai", model: "gpt-4.1-mini" },
    pdf_fast: { provider: "openai", model: "gpt-4.1-mini" },
    pdf_thinking: { provider: "openai", model: "gpt-4.1" }
  },
  privacyAcknowledged: false,
  keyStorageWarning: "MVP stores API keys in the project-local SQLite database. Do not commit studyreader-data."
};

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), nowIso());
}

export function getApiKey(provider: string) {
  return getSetting<string | null>(`llm.${provider}.apiKey`, null);
}

export function getAppSettings() {
  return normalizeSettings(getSetting<AppSettings>("app.settings", defaults));
}

router.get("/", (_req, res) => {
  const settings = getAppSettings();
  setSetting("app.settings", settings);
  res.json({ ...settings, models: getProviderModels() });
});

router.patch("/", (req, res) => {
  const current = getAppSettings();
  const defaultProvider = normalizeProvider(req.body.defaultProvider ?? current.defaultProvider);
  const next: AppSettings = {
    ...current,
    ...req.body,
    defaultProvider,
    providers: {
      openai: { ...current.providers.openai, ...(req.body.providers?.openai ?? {}) },
      anthropic: { ...current.providers.anthropic, ...(req.body.providers?.anthropic ?? {}) }
    },
    chatModels: normalizeChatModels({ ...current.chatModels, ...(req.body.chatModels ?? {}) }, defaultProvider)
  };
  next.providers.openai.model = normalizeProviderModel("openai", next.providers.openai.model);
  next.providers.anthropic.model = normalizeProviderModel("anthropic", next.providers.anthropic.model);
  next.modelMode = req.body.modelMode === "detailed" ? "detailed" : "single";

  for (const provider of ["openai", "anthropic"]) {
    const apiKey = req.body.providers?.[provider]?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) {
      setSetting(`llm.${provider}.apiKey`, apiKey.trim());
      next.providers[provider as ProviderId].hasKey = true;
    }
    delete next.providers[provider as ProviderId].apiKey;
  }
  const savedSettings = normalizeSettings(next);
  setSetting("app.settings", savedSettings);
  res.json({ ...savedSettings, models: getProviderModels() });
});

router.post("/llm/test", async (req, res, next) => {
  try {
    const { provider = "openai", model } = req.body;
    const normalizedModel = normalizeModel(provider, model);
    const apiKey = getApiKey(provider);
    if (!apiKey) {
      res.status(400).json({ error: `Missing ${provider} API key.` });
      return;
    }
    const llm = getProvider(provider);
    const response = await llm.chat(
      {
        model: normalizedModel,
        maxTokens: 40,
        messages: [
          { role: "system", content: "Reply with a short confirmation." },
          { role: "user", content: "Connection test for StudyReader AI." }
        ]
      },
      apiKey
    );
    res.json({ ok: true, provider, model: normalizedModel, message: response.content });
  } catch (error) {
    next(error);
  }
});

router.delete("/llm/:provider/key", (req, res) => {
  const provider = req.params.provider;
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(`llm.${provider}.apiKey`);
  const settings = getAppSettings();
  if (provider === "openai" || provider === "anthropic") {
    settings.providers[provider].hasKey = false;
    setSetting("app.settings", settings);
  }
  res.json({ ok: true });
});

function normalizeSettings(settings: AppSettings): AppSettings {
  const defaultProvider = normalizeProvider(settings.defaultProvider);
  const providers = {
    openai: {
      ...defaults.providers.openai,
      ...(settings.providers?.openai ?? {}),
      model: normalizeProviderModel("openai", settings.providers?.openai?.model)
    },
    anthropic: {
      ...defaults.providers.anthropic,
      ...(settings.providers?.anthropic ?? {}),
      model: normalizeProviderModel("anthropic", settings.providers?.anthropic?.model)
    }
  };
  delete providers.openai.apiKey;
  delete providers.anthropic.apiKey;
  return {
    ...defaults,
    ...settings,
    defaultProvider,
    modelMode: settings.modelMode === "detailed" ? "detailed" : "single",
    chatModels: normalizeChatModels(settings.chatModels, defaultProvider),
    providers
  };
}

function normalizeChatModels(value: Partial<Record<ChatMode, Partial<ModelChoice>>> | undefined, defaultProvider: ProviderId) {
  return {
    no_context_fast: normalizeChoice(value?.no_context_fast, defaultProvider, "no_context_fast"),
    pdf_fast: normalizeChoice(value?.pdf_fast, defaultProvider, "pdf_fast"),
    pdf_thinking: normalizeChoice(value?.pdf_thinking, defaultProvider, "pdf_thinking")
  };
}

function normalizeChoice(value: Partial<ModelChoice> | undefined, defaultProvider: ProviderId, chatMode: ChatMode): ModelChoice {
  const candidateProvider = normalizeProvider(value?.provider);
  const candidateModel = typeof value?.model === "string" ? value.model.trim() : "";
  if (candidateProvider === defaultProvider && candidateModel) {
    return { provider: defaultProvider, model: normalizeProviderModel(defaultProvider, candidateModel) };
  }
  return { provider: defaultProvider, model: defaultChatModel(defaultProvider, chatMode) };
}

function normalizeProvider(value: unknown): ProviderId {
  return value === "anthropic" ? "anthropic" : "openai";
}

function normalizeProviderModel(provider: ProviderId, model: string | undefined) {
  const trimmed = typeof model === "string" ? model.trim() : "";
  return normalizeModel(provider, trimmed || undefined) ?? defaults.providers[provider].model;
}

function defaultChatModel(provider: ProviderId, chatMode: ChatMode) {
  if (provider === "openai" && defaults.chatModels[chatMode].provider === "openai") {
    return defaults.chatModels[chatMode].model;
  }
  return defaults.providers[provider].model;
}

export default router;
