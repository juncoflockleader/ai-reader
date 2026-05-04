import { KeyRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type AppSettings, type ProviderId } from "../../api";

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
    setStatus("Testing...");
    try {
      const provider = settings.defaultProvider;
      const result = await api<{ ok: boolean; message: string }>("/api/settings/llm/test", {
        method: "POST",
        body: JSON.stringify({ provider, model: settings.providers[provider].model })
      });
      setStatus(result.ok ? "Connection works" : result.message);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Connection failed");
    }
  }

  if (!settings) return null;
  const activeModels = settings.models[activeProvider];
  const activeModel = settings.providers[activeProvider].model;
  const defaultValue = `${settings.defaultProvider}:${settings.providers[settings.defaultProvider].model}`;

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
          <label className="field">
            <span>Model</span>
            {customModel ? (
              <input
                className="text-input"
                value={activeModel}
                placeholder={activeProvider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-20250514"}
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
