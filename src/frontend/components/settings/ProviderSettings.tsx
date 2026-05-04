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

export default function ProviderSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderId>("openai");
  const [customModel, setCustomModel] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api<AppSettings>("/api/settings").then((result) => {
      setSettings(result);
      setActiveProvider(result.defaultProvider);
      setCustomModel(!result.models[result.defaultProvider].includes(result.providers[result.defaultProvider].model));
    });
  }, []);

  async function save() {
    if (!settings) return;
    const next = await api<AppSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings)
    });
    setSettings(next);
    setActiveProvider(next.defaultProvider);
    setStatus("Saved");
    onSaved();
  }

  async function test() {
    if (!settings) return;
    const choices = settings.modelMode === "detailed" ? uniqueModelChoices(Object.values(settings.chatModels)) : [
      {
        provider: settings.defaultProvider,
        model: settings.providers[settings.defaultProvider].model
      }
    ];
    if (choices.some((choice) => !choice.model.trim())) {
      setStatus("Choose a model for each row before testing");
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
  const activeModels = settings.models[activeProvider];
  const activeModel = settings.providers[activeProvider].model;
  const defaultValue = `${settings.defaultProvider}:${settings.providers[settings.defaultProvider].model}`;
  const detailedMode = settings.modelMode === "detailed";

  function updateChatModel(chatMode: ChatMode, choice: Partial<ModelChoice>) {
    if (!settings) return;
    const currentSettings = settings;
    const current = currentSettings.chatModels[chatMode];
    const provider = choice.provider ?? current.provider;
    const fallbackModel = currentSettings.providers[provider].model;
    setSettings({
      ...currentSettings,
      chatModels: {
        ...currentSettings.chatModels,
        [chatMode]: {
          provider,
          model: choice.model ?? (provider === current.provider ? current.model : fallbackModel)
        }
      }
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

        <div className="provider-switch">
          <button
            className={settings.modelMode === "single" ? "mode active" : "mode"}
            onClick={() => setSettings({ ...settings, modelMode: "single" })}
          >
            One model
          </button>
          <button
            className={settings.modelMode === "detailed" ? "mode active" : "mode"}
            onClick={() => setSettings({ ...settings, modelMode: "detailed" })}
          >
            Detailed
          </button>
        </div>

        {settings.modelMode === "single" ? (
          <label className="field">
            <span>Default model</span>
            <select
              value={defaultValue}
              onChange={(event) => {
                const [provider, model] = event.target.value.split(":") as [ProviderId, string];
                setActiveProvider(provider);
                setCustomModel(false);
                setSettings({
                  ...settings,
                  defaultProvider: provider,
                  providers: {
                    ...settings.providers,
                    [provider]: { ...settings.providers[provider], model }
                  }
                });
              }}
            >
              <optgroup label="OpenAI">
                {settings.models.openai.map((model) => (
                  <option key={model} value={`openai:${model}`}>
                    {model}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Claude">
                {settings.models.anthropic.map((model) => (
                  <option key={model} value={`anthropic:${model}`}>
                    {model}
                  </option>
                ))}
              </optgroup>
              {!settings.models[settings.defaultProvider].includes(settings.providers[settings.defaultProvider].model) && (
                <option value={defaultValue}>{settings.providers[settings.defaultProvider].model}</option>
              )}
            </select>
          </label>
        ) : (
          <div className="detailed-models">
            {(Object.keys(chatModeLabels) as ChatMode[]).map((chatMode) => {
              const choice = settings.chatModels[chatMode];
              const models = settings.models[choice.provider];
              const usesCustomModel = !models.includes(choice.model);
              return (
                <div className="detailed-model-row" key={chatMode}>
                  <div>
                    <strong>{chatModeLabels[chatMode]}</strong>
                    <span>{chatModeDescriptions[chatMode]}</span>
                  </div>
                  <select value={choice.provider} onChange={(event) => updateChatModel(chatMode, { provider: event.target.value as ProviderId })}>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Claude</option>
                  </select>
                  <select
                    value={usesCustomModel ? "__custom" : choice.model}
                    onChange={(event) =>
                      updateChatModel(chatMode, {
                        model: event.target.value === "__custom" ? "" : event.target.value
                      })
                    }
                  >
                    {models.map((model) => (
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
                      placeholder={choice.provider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-6"}
                      onChange={(event) => updateChatModel(chatMode, { model: event.target.value })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="provider-switch">
          {(["openai", "anthropic"] as const).map((provider) => (
            <button
              key={provider}
              className={activeProvider === provider ? "mode active" : "mode"}
              onClick={() => {
                setActiveProvider(provider);
                setCustomModel(!settings.models[provider].includes(settings.providers[provider].model));
              }}
            >
              {provider === "openai" ? "OpenAI" : "Claude"}
            </button>
          ))}
        </div>

        <div className="provider-box">
          <h3>{activeProvider === "openai" ? "OpenAI" : "Anthropic Claude"}</h3>
          <label className="field">
            <span>API key {settings.providers[activeProvider].hasKey ? "(saved)" : ""}</span>
            <div className="key-input">
              <KeyRound size={16} />
              <input
                type="password"
                placeholder={activeProvider === "openai" ? "sk-..." : "sk-ant-..."}
                value={settings.providers[activeProvider].apiKey ?? ""}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    providers: {
                      ...settings.providers,
                      [activeProvider]: { ...settings.providers[activeProvider], apiKey: event.target.value }
                    }
                  })
                }
              />
            </div>
          </label>
          <label className={detailedMode ? "field disabled-field" : "field"}>
            <span>Model</span>
            {customModel ? (
              <input
                className="text-input"
                disabled={detailedMode}
                value={activeModel}
                placeholder={activeProvider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-6"}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    defaultProvider: activeProvider,
                    providers: {
                      ...settings.providers,
                      [activeProvider]: { ...settings.providers[activeProvider], model: event.target.value }
                    }
                  })
                }
              />
            ) : (
              <select
                disabled={detailedMode}
                value={activeModels.includes(activeModel) ? activeModel : "__custom"}
                onChange={(event) =>
                  event.target.value === "__custom"
                    ? setCustomModel(true)
                    : setSettings({
                        ...settings,
                        defaultProvider: activeProvider,
                        providers: {
                          ...settings.providers,
                          [activeProvider]: { ...settings.providers[activeProvider], model: event.target.value }
                        }
                      })
                }
              >
                {activeModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                <option value="__custom">Custom model...</option>
              </select>
            )}
          </label>
          <button
            className="link-button"
            disabled={detailedMode}
            onClick={() => {
              setSettings({ ...settings, defaultProvider: activeProvider });
              setStatus(`${activeProvider === "openai" ? "OpenAI" : "Claude"} selected as default`);
            }}
          >
            Use this provider as default
          </button>
        </div>

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
          <button className="primary-button compact" onClick={save}>Save</button>
        </div>
      </section>
    </div>
  );
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
  return `${choice.provider === "openai" ? "OpenAI" : "Claude"} ${choice.model}`;
}
