import { KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AppSettings, type ChatMode, type ModelChoice, type ProviderId } from "../../api";

const chatModeLabels: Record<ChatMode, string> = {
  no_context_fast: "No context",
  pdf_fast: "PDF fast",
  pdf_thinking: "PDF thinking"
};

const chatModeDescriptions: Record<ChatMode, string> = {
  no_context_fast: "Quick general answers without PDF context.",
  pdf_fast: "Cited answers using the current PDF context.",
  pdf_thinking: "Longer, more careful PDF-grounded explanations."
};

const chatModes = Object.keys(chatModeLabels) as ChatMode[];

const providerLabels: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Claude"
};

const providerHeadings: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic Claude"
};

export default function ProviderSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api<AppSettings>("/api/settings").then((result) => {
      setSettings(result);
    });
  }, []);

  async function save() {
    if (!settings) return;
    const next = await api<AppSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings)
    });
    setSettings(next);
    setStatus("Saved");
    onSaved();
  }

  async function test() {
    if (!settings) return;
    const provider = settings.defaultProvider;
    const choices =
      settings.modelMode === "detailed"
        ? uniqueModelChoices(chatModes.map((chatMode) => ({ provider, model: settings.chatModels[chatMode].model })))
        : [{ provider, model: settings.providers[provider].model }];
    if (choices.some((choice) => !choice.model.trim())) {
      setStatus("Choose a model before testing");
      return;
    }
    setStatus(choices.length === 1 ? "Testing..." : `Testing ${choices.length} models...`);
    try {
      const results = await Promise.all(
        choices.map(async (choice) => {
          try {
            const result = await api<{ ok: boolean; message: string }>("/api/settings/llm/test", {
              method: "POST",
              body: JSON.stringify(choice)
            });
            return { ...choice, ok: result.ok, message: result.message };
          } catch (err) {
            return { ...choice, ok: false, message: err instanceof Error ? err.message : "Connection failed" };
          }
        })
      );
      const failed = results.filter((result) => !result.ok);
      if (failed.length === 0) {
        setStatus(results.length === 1 ? "Connection works" : `All ${results.length} model checks work`);
      } else {
        setStatus(`Failed: ${failed.map(formatModelChoice).join(", ")}`);
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Connection failed");
    }
  }

  if (!settings) return null;
  const activeProvider = settings.defaultProvider;
  const activeModels = settings.models[activeProvider];
  const activeModel = settings.providers[activeProvider].model;
  const usesCustomDefaultModel = !activeModels.includes(activeModel);

  function updateDefaultProvider(provider: ProviderId) {
    if (!settings) return;
    const nextModel = modelOrProviderDefault(settings.providers[provider].model, provider, settings);
    setSettings({
      ...settings,
      defaultProvider: provider,
      providers: {
        ...settings.providers,
        [provider]: { ...settings.providers[provider], model: nextModel }
      },
      chatModels: migrateChatModels(settings, provider)
    });
    setStatus(`${providerLabels[provider]} selected as default`);
  }

  function updateDefaultModel(model: string) {
    if (!settings) return;
    const provider = settings.defaultProvider;
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: { ...settings.providers[provider], model }
      }
    });
  }

  function updateApiKey(apiKey: string) {
    if (!settings) return;
    const provider = settings.defaultProvider;
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: { ...settings.providers[provider], apiKey }
      }
    });
  }

  function updateChatModel(chatMode: ChatMode, model: string) {
    if (!settings) return;
    const provider = settings.defaultProvider;
    setSettings({
      ...settings,
      chatModels: {
        ...settings.chatModels,
        [chatMode]: { provider, model }
      }
    });
  }

  function updateModelMode(modelMode: AppSettings["modelMode"]) {
    if (!settings) return;
    setSettings({
      ...settings,
      modelMode,
      chatModels: migrateChatModels(settings, settings.defaultProvider)
    });
  }

  return (
    <div className="modal-backdrop">
      <section className="settings-modal">
        <div className="modal-header">
          <div>
            <h2>LLM Settings</h2>
            <p>Your PDF files stay local. Questions send selected context to the provider you choose.</p>
          </div>
          <button className="icon-button" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="field">
          <span>Default provider</span>
          <div className="provider-switch">
            {(["openai", "anthropic"] as const).map((provider) => (
              <button
                key={provider}
                className={activeProvider === provider ? "mode active" : "mode"}
                onClick={() => updateDefaultProvider(provider)}
              >
                {providerLabels[provider]}
              </button>
            ))}
          </div>
        </div>

        <div className="provider-box">
          <h3>{providerHeadings[activeProvider]}</h3>
          <label className="field">
            <span>API key {settings.providers[activeProvider].hasKey ? "(saved)" : ""}</span>
            <div className="key-input">
              <KeyRound size={16} />
              <input
                type="password"
                placeholder={activeProvider === "openai" ? "sk-..." : "sk-ant-..."}
                value={settings.providers[activeProvider].apiKey ?? ""}
                onChange={(event) => updateApiKey(event.target.value)}
              />
            </div>
          </label>
        </div>

        <div className="provider-switch" aria-label="Model mode">
          <button className={settings.modelMode === "single" ? "mode active" : "mode"} onClick={() => updateModelMode("single")}>
            One model
          </button>
          <button className={settings.modelMode === "detailed" ? "mode active" : "mode"} onClick={() => updateModelMode("detailed")}>
            Detailed
          </button>
        </div>

        {settings.modelMode === "single" ? (
          <label className="field">
            <span>Model</span>
            <select
              value={usesCustomDefaultModel ? "__custom" : activeModel}
              onChange={(event) => updateDefaultModel(event.target.value === "__custom" ? "" : event.target.value)}
            >
              {activeModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="__custom">Custom model...</option>
            </select>
            {usesCustomDefaultModel && (
              <input
                className="text-input"
                value={activeModel}
                placeholder={providerDefaultModel(activeProvider, settings)}
                onChange={(event) => updateDefaultModel(event.target.value)}
              />
            )}
          </label>
        ) : (
          <div className="detailed-models">
            {chatModes.map((chatMode) => {
              const choice = settings.chatModels[chatMode];
              const usesCustomModel = !activeModels.includes(choice.model);
              return (
                <div className="detailed-model-row" key={chatMode}>
                  <div>
                    <strong>{chatModeLabels[chatMode]}</strong>
                    <span>{chatModeDescriptions[chatMode]}</span>
                  </div>
                  <select
                    value={usesCustomModel ? "__custom" : choice.model}
                    onChange={(event) => updateChatModel(chatMode, event.target.value === "__custom" ? "" : event.target.value)}
                  >
                    {activeModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                    <option value="__custom">Custom model...</option>
                  </select>
                  {usesCustomModel && (
                    <input
                      className="text-input detailed-custom-model"
                      value={choice.model}
                      placeholder={chatModeDefaultModel(activeProvider, chatMode, settings)}
                      onChange={(event) => updateChatModel(chatMode, event.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.privacyAcknowledged}
            onChange={(event) => setSettings({ ...settings, privacyAcknowledged: event.target.checked })}
          />
          <span>{settings.keyStorageWarning}</span>
        </label>

        <div className="modal-actions">
          <span>{status}</span>
          <button onClick={test}>Test</button>
          <button className="primary-button compact" onClick={save}>
            Save
          </button>
        </div>
      </section>
    </div>
  );
}

function migrateChatModels(settings: AppSettings, provider: ProviderId) {
  return Object.fromEntries(
    chatModes.map((chatMode) => {
      const current = settings.chatModels[chatMode];
      const model =
        current.provider === provider && current.model.trim()
          ? current.model.trim()
          : chatModeDefaultModel(provider, chatMode, settings);
      return [chatMode, { provider, model }];
    })
  ) as AppSettings["chatModels"];
}

function providerDefaultModel(provider: ProviderId, settings: AppSettings) {
  return settings.models[provider][0] ?? (provider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-6");
}

function chatModeDefaultModel(provider: ProviderId, chatMode: ChatMode, settings: AppSettings) {
  if (provider === "openai" && chatMode === "pdf_thinking" && settings.models.openai.includes("gpt-4.1")) {
    return "gpt-4.1";
  }
  return providerDefaultModel(provider, settings);
}

function modelOrProviderDefault(model: string | undefined, provider: ProviderId, settings: AppSettings) {
  const trimmed = model?.trim();
  return trimmed || providerDefaultModel(provider, settings);
}

function uniqueModelChoices(choices: ModelChoice[]) {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = `${choice.provider}:${choice.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatModelChoice(choice: ModelChoice) {
  return `${providerLabels[choice.provider]} ${choice.model}`;
}
