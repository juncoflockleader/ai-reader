import { Router } from "express";
import { getDb, nowIso } from "../services/storage/db";
import { getProvider, normalizeModel, providerModels } from "../services/llm";

const router = Router();

type ProviderId = "openai" | "anthropic";
type AppSettings = {
  defaultProvider: ProviderId;
  providers: Record<ProviderId, { model: string; hasKey: boolean; apiKey?: string }>;
  privacyAcknowledged: boolean;
  keyStorageWarning: string;
};

const defaults: AppSettings = {
  defaultProvider: "openai",
  providers: {
    openai: { model: "gpt-4.1-mini", hasKey: false },
    anthropic: { model: "claude-sonnet-4-20250514", hasKey: false }
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

router.get("/", (_req, res) => {
  const settings = normalizeSettings(getSetting<AppSettings>("app.settings", defaults));
  setSetting("app.settings", settings);
  res.json({ ...settings, models: providerModels });
});

router.patch("/", (req, res) => {
  const current = getSetting<AppSettings>("app.settings", defaults);
  const next: AppSettings = {
    ...current,
    ...req.body,
    providers: {
      openai: { ...current.providers.openai, ...(req.body.providers?.openai ?? {}) },
      anthropic: { ...current.providers.anthropic, ...(req.body.providers?.anthropic ?? {}) }
    }
  };
  next.providers.anthropic.model = normalizeModel("anthropic", next.providers.anthropic.model) ?? defaults.providers.anthropic.model;
  setSetting("app.settings", next);

  for (const provider of ["openai", "anthropic"]) {
    const apiKey = req.body.providers?.[provider]?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) {
      setSetting(`llm.${provider}.apiKey`, apiKey.trim());
      next.providers[provider as ProviderId].hasKey = true;
      delete next.providers[provider as ProviderId].apiKey;
    }
  }
  setSetting("app.settings", next);
  res.json({ ...next, models: providerModels });
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
  const settings = getSetting<AppSettings>("app.settings", defaults);
  if (provider === "openai" || provider === "anthropic") {
    settings.providers[provider].hasKey = false;
    setSetting("app.settings", settings);
  }
  res.json({ ok: true });
});

function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    providers: {
      ...settings.providers,
      anthropic: {
        ...settings.providers.anthropic,
        model: normalizeModel("anthropic", settings.providers.anthropic.model) ?? defaults.providers.anthropic.model
      }
    }
  };
}

export default router;
