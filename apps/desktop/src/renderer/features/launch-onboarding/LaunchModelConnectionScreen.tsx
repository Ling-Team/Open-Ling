import { useEffect, useState } from "react";
import { Cloud, HardDrives } from "@phosphor-icons/react";
import { useLingua } from "../../localization/useLingua";
import { useSettingsStore } from "../../stores/settingsStore";
import { LaunchWelcomeShell } from "../launch-welcome";

const DEEPSEEK_API_KEYS_URL = "https://platform.deepseek.com/api_keys";
const DEFAULT_API_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL_NAME = "deepseek-flash";

type ConnectionChoice = "local" | "remote";
type LocalRuntimeChoice = "ollama" | "lm-studio";
type RemoteProviderChoice = "deepseek" | "kimi" | "glm" | "qwen";

interface LaunchModelConnectionScreenProps {
  onBack: () => void;
  onComplete: () => void;
  presentation?: "launch" | "embedded";
}

export function LaunchModelConnectionScreen({ onBack, onComplete, presentation = "launch" }: LaunchModelConnectionScreenProps) {
  const { l, t } = useLingua();
  const [choice, setChoice] = useState<ConnectionChoice | null>(null);
  const [localRuntime, setLocalRuntime] = useState<LocalRuntimeChoice>("ollama");
  const [remoteProvider, setRemoteProvider] = useState<RemoteProviderChoice>("deepseek");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const status = useSettingsStore((state) => state.status);
  const connectionStatus = useSettingsStore((state) => state.connectionStatus);
  const modelListStatus = useSettingsStore((state) => state.modelListStatus);
  const message = useSettingsStore((state) => state.message);
  const api = useSettingsStore((state) => state.api);
  const availableModels = useSettingsStore((state) => state.availableModels);
  const updateApi = useSettingsStore((state) => state.updateApi);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const testConnection = useSettingsStore((state) => state.testConnection);
  const loadModels = useSettingsStore((state) => state.loadModels);
  const clearMessage = useSettingsStore((state) => state.clearMessage);
  const isBusy = status === "saving" || status === "testing" || modelListStatus === "loading";

  useEffect(() => {
    clearMessage();
  }, [clearMessage]);

  const connectRemote = async () => {
    const nextKey = apiKey.trim();
    if (!nextKey) return;
    const preset = {
      deepseek: { apiBaseUrl: DEFAULT_API_BASE_URL, modelName: DEFAULT_MODEL_NAME },
      kimi: { apiBaseUrl: "https://api.moonshot.cn/v1", modelName: "kimi-k2.5" },
      glm: { apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4", modelName: "glm-5.2" },
      qwen: { apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelName: "qwen3.7-plus" }
    }[remoteProvider];
    updateApi({
      connectionKind: "remote",
      remoteProvider,
      apiBaseUrl: preset.apiBaseUrl,
      remoteApiBaseUrl: preset.apiBaseUrl,
      apiKey: nextKey,
      modelName: preset.modelName,
      remoteModelName: preset.modelName,
      modelAssignments: {
        conversation: preset.modelName,
        caseConceptualization: preset.modelName,
        consultationTeam: preset.modelName
      }
    });
    await saveAndFinish();
  };

  const detectLocalModels = async () => {
    const apiBaseUrl = localRuntime === "ollama"
      ? "http://127.0.0.1:11434/v1"
      : "http://127.0.0.1:1234/v1";
    updateApi({
      connectionKind: "local",
      localRuntime,
      apiBaseUrl,
      localApiBaseUrl: apiBaseUrl,
      modelName: "",
      localModelName: ""
    });
    await loadModels();
  };

  const connectLocal = async () => {
    if (!api.modelName.trim()) return;
    updateApi({
      connectionKind: "local",
      localRuntime,
      localApiBaseUrl: api.apiBaseUrl,
      localModelName: api.modelName,
      modelAssignments: {
        ...api.modelAssignments,
        conversation: api.modelName
      }
    });
    await saveAndFinish();
  };

  const saveAndFinish = async () => {
    await saveSettings();
    if (useSettingsStore.getState().status === "error") return;
    await testConnection();
    if (useSettingsStore.getState().connectionStatus === "success") onComplete();
  };

  const isError = status === "error" || connectionStatus === "failed" || modelListStatus === "failed";

  const content = (
    <>
      <div className="launch-onboarding-page launch-model-page">
        <header className="launch-onboarding-heading">
          <p className="launch-onboarding-kicker">{t("launch.model.kicker")}</p>
          <h1 id="launch-model-title">{l("连接模型服务", "Connect a model service")}</h1>
          <p>{l("选择模型在哪里运行。之后也可以随时到系统设置中更改。", "Choose where the model runs. You can change this later in System Settings.")}</p>
        </header>

        <div className="launch-model-choice-list" role="group" aria-label={l("选择模型连接方式", "Choose a model connection") }>
          <button className={choice === "remote" ? "selected" : ""} onClick={() => setChoice("remote")} type="button">
            <span className="launch-model-choice-icon" aria-hidden="true"><Cloud /></span>
            <span><strong>{l("使用 API 服务", "Use an API service")}</strong><small>{l("选择模型服务商并填写 API Key，无需在本机部署模型。", "Choose a model provider and enter an API key; no local model setup is needed.")}</small></span>
          </button>
          <button className={choice === "local" ? "selected" : ""} onClick={() => setChoice("local")} type="button">
            <span className="launch-model-choice-icon" aria-hidden="true"><HardDrives /></span>
            <span><strong>{l("在这台设备上运行", "Run on this device")}</strong><small>{l("连接 Ollama 或 LM Studio，模型调用留在本机。", "Connect Ollama or LM Studio so model calls stay on this device.")}</small></span>
          </button>
        </div>

        {choice === "local" && (
          <section className="launch-model-compact-panel" aria-label={l("本机模型设置", "Local model setup")}>
            <div className="launch-local-runtime-switch" role="group" aria-label={l("本机模型服务", "Local model service")}>
              <button className={localRuntime === "ollama" ? "selected" : ""} onClick={() => setLocalRuntime("ollama")} type="button">Ollama</button>
              <button className={localRuntime === "lm-studio" ? "selected" : ""} onClick={() => setLocalRuntime("lm-studio")} type="button">LM Studio</button>
            </div>
            {availableModels.length > 0 && api.connectionKind === "local" && api.modelName && (
              <label className="launch-local-model-select">
                <span>{l("使用模型", "Model")}</span>
                <select onChange={(event) => updateApi({ modelName: event.target.value, localModelName: event.target.value })} value={api.modelName}>
                  {availableModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </label>
            )}
            <p>{l("请先在所选工具中启动服务并准备好模型，Ling 不会自行下载或启动模型。", "Start the service and prepare a model in the selected tool first. Ling does not download or start models.")}</p>
          </section>
        )}

        {choice === "remote" && (
          <section className="launch-model-compact-panel launch-model-online-panel" aria-labelledby="launch-model-guide-title">
            <div className="launch-api-provider-options" role="group" aria-label={l("选择 API 服务商", "Choose an API provider")}>
              {([
                ["deepseek", "DeepSeek", l("推荐", "Recommended")],
                ["kimi", "Kimi", ""],
                ["glm", "GLM", ""],
                ["qwen", l("千问", "Qwen"), ""]
              ] as const).map(([id, label, note]) => (
                <button className={remoteProvider === id ? "selected" : ""} key={id} onClick={() => setRemoteProvider(id)} type="button">
                  {label}{note && <small>{note}</small>}
                </button>
              ))}
            </div>
            {remoteProvider === "deepseek" && <a className="launch-api-key-link" href={DEEPSEEK_API_KEYS_URL} rel="noreferrer" target="_blank">{t("launch.model.openKeys")}</a>}
            <div className="launch-model-input-wrap">
              <input autoComplete="off" aria-label={l("API Key", "API key")} onChange={(event) => setApiKey(event.target.value)} placeholder={l("粘贴所选服务商的 API Key", "Paste the selected provider's API key")} spellCheck={false} type={showKey ? "text" : "password"} value={apiKey} />
              <button onClick={() => setShowKey((visible) => !visible)} type="button">{showKey ? t("launch.model.hide") : t("launch.model.show")}</button>
            </div>
          </section>
        )}

        {message && <p className={`launch-model-status ${isError ? "is-error" : connectionStatus === "success" ? "is-success" : "is-neutral"}`} role="status">{message}</p>}
      </div>

      <div aria-label={t("launch.model.actionsLabel")} className="launch-onboarding-actions" role="group">
        {choice === "local" && (!api.modelName || api.connectionKind !== "local") && (
          <button className="launch-welcome-button is-primary" disabled={isBusy} onClick={() => void detectLocalModels()} type="button">
            {modelListStatus === "loading" ? l("正在检测……", "Detecting…") : l("检测本机模型", "Detect local models")}
          </button>
        )}
        {choice === "local" && api.modelName && api.connectionKind === "local" && (
          <button className="launch-welcome-button is-primary" disabled={isBusy} onClick={() => void connectLocal()} type="button">
            {isBusy ? l("正在连接……", "Connecting…") : l("使用这个模型", "Use this model")}
          </button>
        )}
        {choice === "remote" && (
          <button className="launch-welcome-button is-primary" disabled={isBusy || !apiKey.trim()} onClick={() => void connectRemote()} type="button">
            {isBusy ? t("launch.model.connecting") : t("launch.model.connect")}
          </button>
        )}
        <button className="launch-welcome-button is-secondary launch-model-skip" disabled={isBusy} onClick={onComplete} type="button">{l("暂时跳过，继续", "Skip for now and continue")}</button>
        <button className="launch-onboarding-back" disabled={isBusy} onClick={choice ? () => setChoice(null) : onBack} type="button">{t("common.back")}</button>
      </div>
    </>
  );

  if (presentation === "embedded") return content;

  return (
    <LaunchWelcomeShell
      footer={<span className="launch-welcome-progress" aria-label={t("launch.model.progressLabel")}>02 / 03</span>}
      labelledBy="launch-model-title"
    >
      {content}
    </LaunchWelcomeShell>
  );
}
