import { useState } from "react";
import { useLingua } from "../../../../localization/useLingua";
import { useSettingsStore } from "../../../../stores/settingsStore";
import { StudioSignature } from "../shared/StudioSignature";
import "./consultation-model-connection.css";

const DEEPSEEK_API_KEYS_URL = "https://platform.deepseek.com/api_keys";
const DEFAULT_API_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL_NAME = "deepseek-flash";

export function ConsultationModelConnectionPage({
  onCancel,
  onConnected
}: {
  onCancel: () => void;
  onConnected: () => void;
}) {
  const { l } = useLingua();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const status = useSettingsStore((state) => state.status);
  const connectionStatus = useSettingsStore((state) => state.connectionStatus);
  const message = useSettingsStore((state) => state.message);
  const updateApi = useSettingsStore((state) => state.updateApi);
  const saveSettings = useSettingsStore((state) => state.saveSettings);
  const testConnection = useSettingsStore((state) => state.testConnection);
  const isBusy = status === "saving" || status === "testing";

  const connect = async () => {
    const nextKey = apiKey.trim();
    if (!nextKey) return;

    updateApi({
      connectionKind: "remote",
      remoteProvider: "deepseek",
      apiBaseUrl: DEFAULT_API_BASE_URL,
      apiKey: nextKey,
      modelName: DEFAULT_MODEL_NAME,
      remoteApiBaseUrl: DEFAULT_API_BASE_URL,
      remoteModelName: DEFAULT_MODEL_NAME,
      modelAssignments: {
        conversation: DEFAULT_MODEL_NAME,
        caseConceptualization: DEFAULT_MODEL_NAME,
        consultationTeam: DEFAULT_MODEL_NAME
      }
    });
    await saveSettings();
    if (useSettingsStore.getState().status === "error") return;

    await testConnection();
    if (useSettingsStore.getState().connectionStatus === "success") onConnected();
  };

  const isError = status === "error" || connectionStatus === "failed";

  return (
    <article aria-label={l("咨询前模型连接", "Model connection before counseling")} className="consultation-model-connection">
      <header className="consultation-model-connection-header">
        <StudioSignature label={l("咨询前准备", "BEFORE COUNSELING")} />
        <p>{l("开始咨询前", "Before counseling begins")}</p>
        <h2>{l("连接 API 服务", "Connect an API service")}</h2>
        <span aria-hidden="true" />
        <div>{l("为了尽快开始咨询，这里提供推荐的 DeepSeek 快速接入。Kimi、GLM、千问和本机模型可在系统设置中选择。", "For a quick start, this page offers the recommended DeepSeek setup. Kimi, GLM, Qwen, and local models are available in Settings.")}</div>
      </header>

      <section aria-labelledby="consultation-model-guide-title" className="consultation-model-connection-body">
        <h3 id="consultation-model-guide-title">{l("获取 API Key", "Get an API key")}</h3>
        <p>{l("在 DeepSeek 开放平台注册或登录，进入 “API Keys” 创建密钥后，复制到这里。", "Register or sign in to the DeepSeek Platform, create a key under “API Keys,” and paste it here.")}</p>
        <a href={DEEPSEEK_API_KEYS_URL} rel="noreferrer" target="_blank">{l("打开 DeepSeek API Keys", "Open DeepSeek API Keys")}</a>

        <label htmlFor="consultation-deepseek-api-key">DeepSeek API Key</label>
        <div className="consultation-model-key-input">
          <input
            autoComplete="off"
            id="consultation-deepseek-api-key"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={l("粘贴 sk- 开头的 API Key", "Paste your sk- API key")}
            spellCheck={false}
            type={showKey ? "text" : "password"}
            value={apiKey}
          />
          <button aria-label={showKey ? l("隐藏 API Key", "Hide API key") : l("显示 API Key", "Show API key")} onClick={() => setShowKey((visible) => !visible)} type="button">
            {showKey ? l("隐藏", "Hide") : l("显示", "Show")}
          </button>
        </div>
        <small>{l("API Key 保存在这台设备上。生成咨询回应时，所需的会谈上下文会发送给当前选择的 API 服务商。", "Your API key is stored on this device. The context needed to generate counseling responses is sent to the selected API provider.")}</small>
        {message && <p className={`consultation-model-status ${isError ? "is-error" : ""}`} role="status">{message}</p>}
      </section>

      <footer className="consultation-model-connection-actions">
        <button className="consultation-model-secondary" disabled={isBusy} onClick={onCancel} type="button">{l("暂不开始", "Not now")}</button>
        <button className="consultation-model-primary" disabled={isBusy || !apiKey.trim()} onClick={() => void connect()} type="button">
          {isBusy ? l("正在连接……", "Connecting…") : l("连接并继续", "Connect and continue")}
        </button>
      </footer>
    </article>
  );
}
