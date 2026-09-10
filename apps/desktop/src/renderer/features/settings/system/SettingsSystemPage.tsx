import { type ChangeEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppUpdateStatus, CursorTheme, DataExportScope, ReadingLineSpacing, ReadingTextSize, SupportedLocale } from "@shared/index";
import { getDefaultModelReasoningEffort, getModelReasoningOptions, normalizeModelReasoningEffort } from "@core/providers/modelCapabilities";
import { createRecoveryPhrase } from "../../access-lock/recoveryPhrase";
import { getReadingPreviewStyle } from "../../reading-appearance/readingAppearance";
import { formatVoiceShortcut, voiceShortcutFromEvent } from "../../voice-input/voiceShortcut";
import { useLingua } from "../../../localization/useLingua";
import { useSettingsStore } from "../../../stores/settingsStore";
import { PrivacyNoticeDialog } from "../../../components/legal/PrivacyNoticeDialog";
import { prepareAvatarForStorage } from "./avatarImage";
import { CounselorExtensionsSettings } from "../extensions/CounselorExtensionsSettings";
import { UsageSettings } from "./UsageSettings";
import cursorADefault from "../../../styles/cursors/ling-q-arrow-default.svg";
import cursorAHand from "../../../styles/cursors/ling-q-hand-action.svg";
import cursorAText from "../../../styles/cursors/ling-q-arrow-text.svg";
import cursorBDefault from "../../../styles/cursors/ling-q-arrow-b-default.svg";
import cursorBHand from "../../../styles/cursors/ling-q-hand-b-action.svg";
import cursorBText from "../../../styles/cursors/ling-q-arrow-b-text.svg";
import cursorCDefault from "../../../styles/cursors/ling-q-arrow-c-default.svg";
import cursorCHand from "../../../styles/cursors/ling-q-hand-c-action.svg";
import cursorCText from "../../../styles/cursors/ling-q-arrow-c-text.svg";
import cursorDDefault from "../../../styles/cursors/ling-q-arrow-d-default.svg";
import cursorDHand from "../../../styles/cursors/ling-q-hand-d-action.svg";
import cursorDText from "../../../styles/cursors/ling-q-arrow-d-text.svg";
import cursorEDefault from "../../../styles/cursors/ling-q-arrow-e-default.svg";
import cursorEHand from "../../../styles/cursors/ling-q-hand-e-action.svg";
import cursorEText from "../../../styles/cursors/ling-q-arrow-e-text.svg";
import "./settings-system.css";

export type SystemSettingsTab = "profile" | "model" | "usage" | "voice" | "counseling" | "extensions" | "appearance" | "privacy";
type SystemIconName =
  | "person"
  | "box"
  | "coin"
  | "chat"
  | "microphone"
  | "book"
  | "screen"
  | "shield"
  | "eye"
  | "eyeOff";

interface SystemTabItem {
  id: SystemSettingsTab;
  label: [string, string];
  description: [string, string];
  icon: SystemIconName;
}

const systemTabs: SystemTabItem[] = [
  { id: "model", label: ["模型接入", "Model connection"], description: ["配置模型地址、密钥与心理咨询对话模型", "Configure the provider, API key, and counseling model"], icon: "box" },
  { id: "usage", label: ["用量与费用", "Usage & fees"], description: ["查看 Token 消耗与费用说明", "Review token usage and fee guidance"], icon: "coin" },
  { id: "voice", label: ["语音输入", "Voice input"], description: ["配置本地或云端语音识别服务", "Configure local or cloud speech recognition"], icon: "microphone" },
  { id: "profile", label: ["个人资料", "Profile"], description: ["管理称呼、背景与头像", "Manage your name, background, and avatar"], icon: "person" },
  { id: "counseling", label: ["咨询连续性", "Counseling continuity"], description: ["设置同一咨询师如何承接过去理解", "Choose how a counselor carries understanding forward"], icon: "chat" },
  { id: "extensions", label: ["咨询师扩展", "Counselor extensions"], description: ["导入第三方发布的 AI 咨询角色包", "Import third-party AI counselor character packages"], icon: "book" },
  { id: "privacy", label: ["数据与隐私", "Data & privacy"], description: ["导出、备份与恢复本机资料", "Export, back up, and restore local information"], icon: "shield" },
  { id: "appearance", label: ["界面与阅读", "Display & reading"], description: ["调整文字、行距与鼠标样式", "Adjust text, spacing, and cursor style"], icon: "screen" }
];

const cursorThemeOptions: Array<{
  description: [string, string];
  hand: string;
  id: CursorTheme;
  label: [string, string];
  pointer: string;
  text: string;
}> = [
  { id: "a", label: ["奶油经典", "Cream classic"], description: ["温暖稳重", "Warm and balanced"], pointer: cursorADefault, hand: cursorAHand, text: cursorAText },
  { id: "b", label: ["鼠尾草", "Sage"], description: ["圆润饱满", "Soft and full"], pointer: cursorBDefault, hand: cursorBHand, text: cursorBText },
  { id: "c", label: ["桃杏轻巧", "Peach"], description: ["轻快清晰", "Light and clear"], pointer: cursorCDefault, hand: cursorCHand, text: cursorCText },
  { id: "d", label: ["月光纯白", "Moonlight white"], description: ["克制专业", "Clean and professional"], pointer: cursorDDefault, hand: cursorDHand, text: cursorDText },
  { id: "e", label: ["琥珀软糖", "Amber gummy"], description: ["暖黄柔和", "Soft warm amber"], pointer: cursorEDefault, hand: cursorEHand, text: cursorEText }
];


function getProviderPresentation(apiBaseUrl: string, locale: SupportedLocale) {
  let hostname = "";
  try {
    hostname = new URL(apiBaseUrl).hostname.toLowerCase();
  } catch {
    hostname = apiBaseUrl.toLowerCase();
  }
  if (hostname.includes("deepseek.com")) return { abbreviation: "DS", name: "DeepSeek", isDeepSeek: true };
  if (hostname.includes("openai.com")) return { abbreviation: "OA", name: "OpenAI", isDeepSeek: false };
  return { abbreviation: "API", name: locale === "en-US" ? "OpenAI-compatible service" : "OpenAI 兼容服务", isDeepSeek: false };
}

function SystemIcon({ name }: { name: SystemIconName }) {
  const icons: Record<SystemIconName, ReactNode> = {
    person: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M6.9 18.7c.8-3 2.5-4.5 5.1-4.5s4.3 1.5 5.1 4.5" />
      </>
    ),
    box: (
      <>
        <path d="m12 4.7 6.2 3.4v7.8L12 19.3l-6.2-3.4V8.1z" />
        <path d="m5.8 8.1 6.2 3.4 6.2-3.4" />
        <path d="M12 11.5v7.8" />
      </>
    ),
    coin: (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="M12 7.2v9.6M9.4 9.5c.2-1 1-1.6 2.2-1.6 1.5 0 2.3.6 2.3 1.7 0 2.5-4.8 1.2-4.8 3.7 0 1 .8 1.7 2.2 1.7 1.4 0 2.2-.7 2.4-1.9" />
      </>
    ),
    chat: (
      <>
        <path d="M5.5 7.6c1.8-2.1 4-2.9 6.6-2.7 3.8.3 6.4 2.8 6.4 6.1 0 3.7-3 6.2-7 6.2-.9 0-1.8-.1-2.7-.4l-3.2 1.5.8-3.1a5.6 5.6 0 0 1-.9-7.6z" />
        <path d="M8.8 10.9h6.1" />
        <path d="M8.8 13.5h3.9" />
      </>
    ),
    microphone: (
      <>
        <rect x="9" y="4.5" width="6" height="10" rx="3" />
        <path d="M6.8 11.2a5.2 5.2 0 0 0 10.4 0M12 16.4V20M9.3 20h5.4" />
      </>
    ),
    book: (
      <>
        <path d="M5.4 6.3c2.5-.8 4.6-.5 6.3.8v11.1c-1.7-1.2-3.8-1.5-6.3-.8z" />
        <path d="M18.6 6.3c-2.5-.8-4.6-.5-6.3.8v11.1c1.7-1.2 3.8-1.5 6.3-.8z" />
      </>
    ),
    screen: (
      <>
        <rect x="5" y="6" width="14" height="10.2" rx="1.6" />
        <path d="M9.1 19h5.8" />
        <path d="M12 16.2V19" />
      </>
    ),
    shield: (
      <>
        <path d="M12 4.8 18 7v4.4c0 3.4-2.1 5.9-6 7.8-3.9-1.9-6-4.4-6-7.8V7z" />
        <path d="m9.1 12 1.9 1.8 3.9-4.1" />
      </>
    ),
    eye: (
      <>
        <path d="M4.8 12s2.5-4.6 7.2-4.6 7.2 4.6 7.2 4.6-2.5 4.6-7.2 4.6S4.8 12 4.8 12z" />
        <circle cx="12" cy="12" r="2.3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M4.8 12s2.5-4.6 7.2-4.6c1.1 0 2.1.2 3 .7" />
        <path d="M19.2 12s-2.5 4.6-7.2 4.6c-1.1 0-2.1-.2-3-.7" />
        <path d="M5.5 5.5 18.5 18.5" />
        <path d="M10.3 10.3a2.3 2.3 0 0 0 3.3 3.3" />
      </>
    )
  };

  return (
    <svg className="system-icon" viewBox="0 0 24 24" aria-hidden="true">
      {icons[name]}
    </svg>
  );
}

function HelpToggleRow({
  checked,
  closeLabel,
  disabled = false,
  helpId,
  helpOpen,
  helpParagraphs,
  id,
  label,
  onChange,
  onHelpOpenChange,
  popoverLabel
}: {
  checked: boolean;
  closeLabel: string;
  disabled?: boolean;
  helpId: string;
  helpOpen: boolean;
  helpParagraphs: string[];
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
  onHelpOpenChange: (open: boolean) => void;
  popoverLabel: string;
}) {
  const { l } = useLingua();
  return (
    <div className={disabled ? "system-toggle-row system-toggle-row-with-help disabled" : "system-toggle-row system-toggle-row-with-help"}>
      <label className="system-toggle-copy" htmlFor={id}>
        {label}
      </label>
      <span className="system-inline-help-anchor">
        <button
          aria-controls={helpId}
          aria-label={l(`说明：${label}`, `About: ${label}`)}
          aria-expanded={helpOpen}
          className={`system-inline-help-button${helpOpen ? " active" : ""}`}
          onClick={() => onHelpOpenChange(!helpOpen)}
          type="button"
        >
          <svg aria-hidden="true" className="system-inline-help-icon" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" />
            <path d="M7.8 7.7a2.3 2.3 0 0 1 4.5.6c0 1.6-1.7 2.1-2.1 3.1" />
            <path d="M10 14.4h.01" />
          </svg>
        </button>
        {helpOpen && (
          <div aria-label={popoverLabel} className="system-inline-help-popover" id={helpId} role="dialog">
            <button
              aria-label={closeLabel}
              className="system-inline-help-close"
              onClick={() => onHelpOpenChange(false)}
              type="button"
            >
              ×
            </button>
            {helpParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        )}
      </span>
      <input checked={checked} disabled={disabled} id={id} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <label className="system-toggle-visual" htmlFor={id} />
    </div>
  );
}

function TextInput({
  label,
  defaultValue,
  disabled,
  onChange,
  placeholder,
  readOnly,
  type = "text",
  value
}: {
  label: string;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  type?: string;
  value?: string;
}) {
  return (
    <label className="system-field">
      <span>{label}</span>
      <input
        defaultValue={value === undefined ? defaultValue : undefined}
        disabled={disabled}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        placeholder={placeholder}
        readOnly={readOnly}
        type={type}
        value={value}
      />
    </label>
  );
}

export function SettingSectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="setting-section-card">
      <header>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      {children}
    </section>
  );
}

function PrimaryButton({ children, disabled, onClick, type = "button" }: { children: ReactNode; disabled?: boolean; onClick?: () => void; type?: "button" | "submit" }) {
  return (
    <button className="system-primary-button" disabled={disabled} onClick={onClick} type={type}>
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  onClick,
  tone,
  type = "button"
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  tone?: "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      className={tone === "danger" ? "system-secondary-button danger" : "system-secondary-button"}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

function SettingsConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  tone = "default"
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  tone?: "default" | "danger";
}) {
  const { l } = useLingua();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [onCancel]);

  return (
    <div className="settings-confirm-backdrop" onMouseDown={onCancel}>
      <section aria-labelledby="settings-confirm-title" aria-modal="true" className="settings-confirm-dialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog">
        <h2 id="settings-confirm-title">{title}</h2>
        <p>{description}</p>
        <div>
          <button className="system-secondary-button" onClick={onCancel} ref={cancelRef} type="button">{l("取消", "Cancel")}</button>
          <button className={tone === "danger" ? "system-secondary-button danger" : "system-primary-button"} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function ModelAccessSettings() {
  const { locale, l } = useLingua();
  const {
    api,
    availableModels,
    backstageModels,
    connectionStatus,
    dirtySections,
    deleteApiKey,
    loadModels,
    message,
    modelListStatus,
    saveSettings,
    status,
    testConnection,
    updateApi,
    updateBackstageModels
  } = useSettingsStore();
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const isLocal = api.connectionKind === "local";
  const isBusy = status === "loading" || status === "saving" || status === "testing" || modelListStatus === "loading";
  const isLoadingModels = modelListStatus === "loading";
  const modelOptions = buildModelOptions(availableModels, [api.modelName]);
  const selectedModel = modelOptions.find((model) => model.id === api.modelName) ?? modelOptions[0];
  const reasoningOptions = getModelReasoningOptions(api);
  const selectedReasoningEffort = normalizeModelReasoningEffort(api);
  const remotePresentation = {
    deepseek: { abbreviation: "DS", name: "DeepSeek", isDeepSeek: true },
    kimi: { abbreviation: "KI", name: "Kimi", isDeepSeek: false },
    glm: { abbreviation: "GL", name: "GLM", isDeepSeek: false },
    qwen: { abbreviation: "QW", name: l("千问", "Qwen"), isDeepSeek: false },
    custom: getProviderPresentation(api.apiBaseUrl, locale)
  }[api.remoteProvider ?? "deepseek"];
  const providerPresentation = isLocal
    ? {
        abbreviation: api.localRuntime === "lm-studio" ? "LM" : api.localRuntime === "custom" ? "API" : "OL",
        name: api.localRuntime === "lm-studio" ? "LM Studio" : api.localRuntime === "custom" ? l("其他本机服务", "Other local service") : "Ollama",
        isDeepSeek: false
      }
    : remotePresentation;
  useEffect(() => {
    if (!api.apiKey || isLocal) setApiKeyVisible(false);
  }, [api.apiKey, isLocal]);
  const hasUnsavedApiKey = dirtySections.model;
  const isConfigured = Boolean(api.apiBaseUrl.trim() && api.modelName.trim() && (isLocal || api.apiKeySaved || api.apiKey?.trim()));
  const providerStatus = connectionStatus === "success"
    ? "ok"
    : connectionStatus === "failed"
      ? "failed"
      : hasUnsavedApiKey
        ? "pending"
        : isConfigured
          ? "saved"
          : "empty";
  const providerStatusText =
    status === "loading"
      ? l("读取中", "Loading")
      : connectionStatus === "success"
        ? l("连接正常", "Connected")
        : connectionStatus === "failed"
          ? l("连接失败", "Connection failed")
          : hasUnsavedApiKey
            ? l("待保存", "Save required")
            : isConfigured
              ? l("已保存", "Saved")
              : l("未配置", "Not configured");
  const connectionText =
    status === "testing"
      ? l("测试中", "Testing")
      : connectionStatus === "success"
        ? l("连接正常", "Connected")
        : connectionStatus === "failed"
          ? l("连接失败", "Connection failed")
          : hasUnsavedApiKey
            ? l("待保存", "Save required")
            : isConfigured
              ? l("已保存", "Saved")
              : l("等待配置", "Awaiting configuration");

  function updateEndpoint(next: Partial<typeof api>) {
    const nextApi = { ...api, ...next };
    const profilePatch = isLocal
      ? {
          ...(next.apiBaseUrl !== undefined ? { localApiBaseUrl: next.apiBaseUrl } : {}),
          ...(next.modelName !== undefined ? { localModelName: next.modelName } : {})
        }
      : {
          ...(next.apiBaseUrl !== undefined ? { remoteApiBaseUrl: next.apiBaseUrl } : {}),
          ...(next.modelName !== undefined ? { remoteModelName: next.modelName } : {})
        };
    updateApi({
      ...next,
      ...(next.modelName !== undefined
        ? { reasoningEffort: getDefaultModelReasoningEffort(nextApi) }
        : {}),
      ...profilePatch,
      ...(next.modelName !== undefined
        ? { modelAssignments: { ...api.modelAssignments, conversation: next.modelName } }
        : {})
    });
  }

  function switchConnectionKind(kind: "local" | "remote") {
    if ((kind === "local") === isLocal) return;
    const leavingProfile = isLocal
      ? { localApiBaseUrl: api.apiBaseUrl, localModelName: api.modelName }
      : { remoteApiBaseUrl: api.apiBaseUrl, remoteModelName: api.modelName };
    const apiBaseUrl = kind === "local"
      ? api.localApiBaseUrl || "http://127.0.0.1:11434/v1"
      : api.remoteApiBaseUrl || "https://api.deepseek.com";
    const modelName = kind === "local"
      ? api.localModelName || ""
      : api.remoteModelName || "deepseek-flash";
    useSettingsStore.setState({ availableModels: [], modelListStatus: "idle", connectionStatus: "idle", message: "" });
    updateApi({
      ...leavingProfile,
      connectionKind: kind,
      apiBaseUrl,
      modelName,
      reasoningEffort: getDefaultModelReasoningEffort({ ...api, apiBaseUrl, modelName }),
      modelAssignments: { ...api.modelAssignments, conversation: modelName }
    });
  }

  function selectLocalRuntime(runtime: "ollama" | "lm-studio" | "custom") {
    const apiBaseUrl = runtime === "ollama"
      ? "http://127.0.0.1:11434/v1"
      : runtime === "lm-studio"
        ? "http://127.0.0.1:1234/v1"
        : api.localRuntime === "custom"
          ? api.apiBaseUrl
          : "http://127.0.0.1:8080/v1";
    useSettingsStore.setState({ availableModels: [], modelListStatus: "idle", connectionStatus: "idle", message: "" });
    updateApi({ localRuntime: runtime, apiBaseUrl, localApiBaseUrl: apiBaseUrl, modelName: "", localModelName: "" });
  }

  function selectRemoteProvider(provider: "deepseek" | "kimi" | "glm" | "qwen" | "custom") {
    const preset = {
      deepseek: { apiBaseUrl: "https://api.deepseek.com", modelName: "deepseek-flash" },
      kimi: { apiBaseUrl: "https://api.moonshot.cn/v1", modelName: "kimi-k2.5" },
      glm: { apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4", modelName: "glm-5.2" },
      qwen: { apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelName: "qwen3.7-plus" },
      custom: { apiBaseUrl: api.remoteProvider === "custom" ? api.apiBaseUrl : "https://", modelName: api.remoteProvider === "custom" ? api.modelName : "" }
    }[provider];
    useSettingsStore.setState({ availableModels: [], modelListStatus: "idle", connectionStatus: "idle", message: "" });
    updateApi({
      remoteProvider: provider,
      apiBaseUrl: preset.apiBaseUrl,
      remoteApiBaseUrl: preset.apiBaseUrl,
      modelName: preset.modelName,
      reasoningEffort: getDefaultModelReasoningEffort({ ...api, apiBaseUrl: preset.apiBaseUrl, modelName: preset.modelName, remoteProvider: provider }),
      remoteModelName: preset.modelName,
      modelAssignments: { ...api.modelAssignments, conversation: preset.modelName }
    });
  }

  const canReadModels = !isBusy && !isLoadingModels && (isLocal || Boolean(api.apiKeySaved || api.apiKey?.trim()));
  const canTest = !isBusy && isConfigured;

  return (
    <div className="model-access-grid">
      <header className="system-content-header">
        <div>
          <h1>{l("模型接入", "Model connection")}</h1>
          <p>{l("配置之后新建会谈默认使用的模型服务。已有会谈会保留创建时使用的模型。", "Configure the model service used by new sessions. Existing sessions retain the model selected when they were created.")}</p>
        </div>
        <button className="system-help-button" onClick={() => setIsGuideOpen(true)} type="button">
          <SystemIcon name="book" />
          {l("接入说明", "Connection guide")}
        </button>
      </header>

      <div className="model-connection-kind" aria-label={l("模型运行位置", "Where the model runs")} role="group">
        <button disabled={isBusy} className={!isLocal ? "active" : ""} onClick={() => switchConnectionKind("remote")} type="button">
          <strong>{l("API 服务", "API service")}</strong>
          <small>{l("通过 API Key 连接模型服务商", "Connect to a model provider with an API key")}</small>
        </button>
        <button disabled={isBusy} className={isLocal ? "active" : ""} onClick={() => switchConnectionKind("local")} type="button">
          <strong>{l("本机模型", "Local model")}</strong>
          <small>{l("连接这台设备上的模型服务", "Connect to a model service on this device")}</small>
        </button>
      </div>

      <section className="deepseek-provider-layout" aria-label={l("模型服务接入", "Model service connection")}>
        <aside className="deepseek-provider-list">
          <div className="deepseek-provider-group-label">{l("当前配置", "Current configuration")}</div>
          <button className="deepseek-provider-item active" type="button">
            <span className={`deepseek-status-dot ${providerStatus}`} aria-hidden="true" />
            <span className="provider-logo">{providerPresentation.abbreviation}</span>
            <span className="deepseek-provider-copy">
              <strong>{providerPresentation.name}</strong>
              <small>{providerStatusText}</small>
            </span>
          </button>
        </aside>

        <div className="deepseek-provider-detail">
          <section className="deepseek-config-card">
            <header className="deepseek-detail-header">
              <div>
                <h2>{providerPresentation.name}</h2>
                <p>{isLocal
                  ? l("Ling 会连接已经在这台设备上启动的模型服务，不负责下载或启动模型。", "Ling connects to a model service already running on this device. It does not download or start models.")
                  : l("API Key 保存在这台设备上。生成会谈回应和会谈后内容时，所需上下文会发送到这里配置的服务。", "Your API key is stored on this device. Context needed for responses and post-session work is sent to this service.")}</p>
              </div>
              <span className={`deepseek-state-badge ${providerStatus}`}>
                <span aria-hidden="true" />
                {connectionText}
              </span>
            </header>

            <fieldset className="deepseek-config-form" disabled={isBusy}>
              {isLocal && (
                <fieldset className="local-runtime-options">
                  <legend>{l("本机服务", "Local service")}</legend>
                  {([
                    ["ollama", "Ollama", l("默认端口 11434", "Default port 11434")],
                    ["lm-studio", "LM Studio", l("默认端口 1234", "Default port 1234")],
                    ["custom", l("其他兼容服务", "Other compatible service"), l("手动填写地址", "Enter the address manually")]
                  ] as const).map(([id, label, note]) => (
                    <button className={api.localRuntime === id ? "selected" : ""} key={id} onClick={() => selectLocalRuntime(id)} type="button">
                      <strong>{label}</strong><small>{note}</small>
                    </button>
                  ))}
                </fieldset>
              )}
              {!isLocal && (
                <fieldset className="remote-provider-options">
                  <legend>{l("模型服务商", "Model provider")}</legend>
                  {([
                    ["deepseek", "DeepSeek", l("推荐", "Recommended")],
                    ["kimi", "Kimi", ""],
                    ["glm", "GLM", ""],
                    ["qwen", l("千问", "Qwen"), ""],
                    ["custom", l("其他兼容服务", "Other compatible service"), l("自定义", "Custom")]
                  ] as const).map(([id, label, note]) => (
                    <button className={api.remoteProvider === id ? "selected" : ""} key={id} onClick={() => selectRemoteProvider(id)} type="button">
                      <strong>{label}</strong>{note && <small>{note}</small>}
                    </button>
                  ))}
                </fieldset>
              )}
              {!isLocal && <div className="system-field wide">
                <label htmlFor="model-api-key">API Key</label>
                <span className="api-key-input-wrap">
                  <input
                    autoComplete="off"
                    spellCheck={false}
                    id="model-api-key"
                    aria-describedby="model-api-key-note"
                    onChange={(event) => updateApi({ apiKey: event.target.value })}
                    placeholder={api.apiKeySaved ? `${l("已保存", "Saved")} ${api.apiKeyPreview ?? ""}` : l("输入 API Key", "Enter API key")}
                    type={apiKeyVisible ? "text" : "password"}
                    value={api.apiKey ?? ""}
                  />
                  <button
                    aria-label={apiKeyVisible ? l("隐藏 API Key", "Hide API key") : l("显示 API Key", "Show API key")}
                    aria-pressed={apiKeyVisible}
                    disabled={!api.apiKey}
                    title={l("仅显示或隐藏本次输入的密钥", "Show or hide only the key entered here")}
                    className="api-key-visibility-button"
                    onClick={() => setApiKeyVisible((visible) => !visible)}
                    type="button"
                  >
                    <SystemIcon name={apiKeyVisible ? "eyeOff" : "eye"} />
                  </button>
                </span>
                <small className="system-field-note" id="model-api-key-note">
                  {api.apiKeySaved
                    ? l("密钥已保存，不回显完整内容。留空沿用已保存密钥；输入新密钥后可先测试，再保存替换。", "The saved key is not revealed. Leave this blank to keep it, or enter a new key, test it, then save to replace it.")
                    : l("粘贴后可直接测试，无需先保存。小眼睛仅显示或隐藏本次输入的密钥。", "Test immediately after pasting; no need to save first. The eye only shows or hides the key entered here.")}
                </small>
              </div>}
              <label className="system-field wide">
                <span>{l("模型服务地址（Base URL，兼容 OpenAI 接口格式）", "Model service URL (Base URL, OpenAI-compatible API)")}</span>
                <input
                  onChange={(event) => updateEndpoint({ apiBaseUrl: event.target.value })}
                  placeholder={isLocal ? "http://127.0.0.1:11434/v1" : "https://api.deepseek.com"}
                  value={api.apiBaseUrl}
                />
              </label>
              <div className="model-select-row">
                <label className="system-field wide">
                  <span>{l("默认心理咨询对话模型", "Default counseling conversation model")}</span>
                  <select onChange={(event) => updateEndpoint({ modelName: event.target.value })} value={api.modelName || selectedModel?.id || ""}>
                    {!api.modelName && <option value="">{l("先读取可用模型", "Load available models first")}</option>}
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}{locale === "zh-CN" ? `（${model.id}）` : ` (${model.id})`}
                      </option>
                    ))}
                  </select>
                </label>
                <SecondaryButton disabled={!canReadModels} onClick={() => void loadModels()}>
                  {isLoadingModels ? l("正在读取……", "Loading…") : isLocal ? l("检测并读取模型", "Detect and load models") : l("读取可用模型", "Load available models")}
                </SecondaryButton>
              </div>
              {reasoningOptions.length > 0 && <label className="system-field wide" htmlFor="model-reasoning-effort">
                <span>{l("推理强度", "Reasoning effort")}</span>
                <select
                  id="model-reasoning-effort"
                  onChange={(event) => updateApi({ reasoningEffort: event.target.value as typeof api.reasoningEffort })}
                  value={selectedReasoningEffort ?? ""}
                >
                  {reasoningOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label[locale === "en-US" ? 1 : 0]} — {option.description[locale === "en-US" ? 1 : 0]}
                    </option>
                  ))}
                </select>
                <small className="system-field-note">
                  {l("只显示当前模型官方实际支持的档位；更高强度通常会增加等待时间和 Token 消耗。", "Only levels actually supported by the current model are shown. Higher effort usually increases latency and token use.")}
                </small>
              </label>}
              <section className="backstage-model-settings" aria-labelledby="backstage-model-settings-title">
                <div>
                  <h3 id="backstage-model-settings-title">{l("咨询结束后的模型用途", "Models for post-session work")}</h3>
                  <p>{l("实时心理咨询对话使用上方模型；下面两项只在结束咨询后运行，可按需要选择更适合整理或写信的模型。", "Live counseling uses the model above. The following models run only after a session ends and can be selected separately for clinical organization and counselor letters.")}</p>
                </div>
                <label className="system-field wide">
                  <span>{l("会谈整理与连续性理解", "Session organization and continuity")}</span>
                  <select
                    onChange={(event) => updateBackstageModels({ conceptualizationModelName: event.target.value })}
                    value={backstageModels.conceptualizationModelName ?? ""}
                  >
                    <option value="">
                      {providerPresentation.isDeepSeek ? l("默认 DeepSeek V4.1 Flash（推荐）", "Default: DeepSeek V4.1 Flash (recommended)") : l("跟随会谈模型（推荐）", "Use the session model (recommended)")}
                    </option>
                    {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}{locale === "zh-CN" ? `（${model.id}）` : ` (${model.id})`}</option>)}
                  </select>
                </label>
                <label className="system-field wide">
                  <span>{l("咨询师来信", "Counselor letters")}</span>
                  <select
                    onChange={(event) => updateBackstageModels({ letterModelName: event.target.value })}
                    value={backstageModels.letterModelName ?? ""}
                  >
                    <option value="">{l("跟随会谈整理模型（推荐）", "Use the session-organization model (recommended)")}</option>
                    {modelOptions.map((model) => <option key={model.id} value={model.id}>{model.name}{locale === "zh-CN" ? `（${model.id}）` : ` (${model.id})`}</option>)}
                  </select>
                </label>
              </section>
            </fieldset>

            <div className="deepseek-action-row">
              <SecondaryButton disabled={!canTest} onClick={() => void testConnection()}>
                {status === "testing" ? l("正在测试……", "Testing…") : l("测试连接", "Test connection")}
              </SecondaryButton>
              <PrimaryButton disabled={isBusy || !isConfigured} onClick={() => void saveSettings()}>
                {status === "saving" ? l("正在保存……", "Saving…") : isLocal ? l("保存并使用", "Save and use") : l("保存配置", "Save configuration")}
              </PrimaryButton>
              {!isLocal && <SecondaryButton disabled={isBusy || !api.apiKeySaved} onClick={() => setIsDeleteConfirmOpen(true)} tone="danger">
                {l("删除 API Key", "Delete API key")}
              </SecondaryButton>}
            </div>
            <p className="system-field-note">{l("测试连接和读取模型使用当前填写的配置，不会自动保存。确认后点击保存配置，新会谈才会使用它。", "Testing and loading models use the current form without saving. Save the configuration to use it for new sessions.")}</p>
            {message && <p className="system-feedback" role="status">{message}</p>}
            <div className="system-truth-note">
              {isLocal
                ? isLoopbackAddress(api.apiBaseUrl)
                  ? l("当前地址只指向这台设备，模型调用不会因此离开本机。本机模型的质量、速度和上下文长度取决于所选模型与设备。", "This address points only to this device, so model calls do not leave it. Quality, speed, and context length depend on the selected model and hardware.")
                  : l("这个地址不在当前设备上。会谈内容将发送到该网络地址，请确认它由你信任的人或设备管理。", "This address is not on the current device. Counseling content will be sent to that network address; make sure you trust whoever manages it.")
                : l("模型请求会发送到你填写的 Base URL。请求可能包含会谈、个人资料片段、后台整理材料和附件；保存、使用与删除规则由对应服务商决定。", "Model requests are sent to the Base URL you enter. They may include session content, parts of your profile, background materials, and attachments. The provider determines how those data are retained, used, and deleted.")}
            </div>
          </section>
        </div>
      </section>
      {isGuideOpen && <ModelAccessGuideDialog onClose={() => setIsGuideOpen(false)} />}
      {isDeleteConfirmOpen && (
        <SettingsConfirmDialog
          confirmLabel={l("删除 API Key", "Delete API key")}
          description={l("删除后，Ling 将无法生成新的回应以及咨询结束后的相关内容，直到你重新填写并保存 API Key。已有本机资料不会被删除。", "After deletion, Ling cannot generate new responses or post-session materials until you enter and save an API key again. Existing information on this device will not be deleted.")}
          onCancel={() => setIsDeleteConfirmOpen(false)}
          onConfirm={() => {
            setIsDeleteConfirmOpen(false);
            void deleteApiKey();
          }}
          title={l("确定删除 API Key？", "Delete the API key?")}
          tone="danger"
        />
      )}
    </div>
  );
}

function ModelAccessGuideDialog({ onClose }: { onClose: () => void }) {
  const { l } = useLingua();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="model-guide-backdrop" onClick={onClose}>
      <section
        aria-modal="true"
        aria-labelledby="model-guide-title"
        className="model-guide-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="model-guide-title">{l("模型服务接入说明", "Model service connection guide")}</h2>
            <p>{l("第一次使用也没关系，按下面的步骤连接即可。", "New to this? Follow the steps below to connect.")}</p>
          </div>
          <button aria-label={l("关闭接入说明", "Close connection guide")} className="model-guide-close" onClick={onClose} ref={closeRef} type="button">
            ×
          </button>
        </header>

        <h3>{l("先认识两个词", "Two terms to know")}</h3>
        <p>{l("模型服务商：提供 AI 回答能力的平台，例如 DeepSeek、Kimi、GLM、千问。Ling 是你使用的咨询应用，回答能力由你选择的平台提供。", "A model provider is a platform such as DeepSeek, Kimi, GLM, or Qwen that generates AI answers. Ling is your counseling app; your chosen provider supplies the AI responses.")}</p>
        <p>{l("API Key（接口密钥）：平台发给你的一串专用字符，相当于允许 Ling 调用你账户中 AI 服务的通行证。它不是登录密码、验证码，也不是聊天网址。请像密码一样保管，不要发给别人或公开截图。", "An API key is a string issued by that platform, like a pass allowing Ling to use AI services through your account. It is not your login password, verification code, or chat URL. Keep it private like a password; do not share it or publish screenshots of it.")}</p>

        <h3>{l("第一次连接：按这 5 步操作", "First connection: follow these 5 steps")}</h3>
        <ol>
          <li><strong>{l("获取密钥。", "Get a key.")}</strong>{l("打开你选择的服务商官方网站，注册或登录，进入「开放平台 / 开发者平台 / API 控制台」，找到「API Key / API 密钥」并创建、复制密钥。具体名称以平台为准；普通聊天页面的登录密码不能填在这里。", "Open your chosen provider's official website, sign up or log in, then open its developer platform or API console. Find API Keys, create a key, and copy it. Labels vary by provider. Do not use your chat account password here.")}</li>
          <li><strong>{l("回到 Ling，选择同一家服务商并粘贴。", "Return to Ling, select the same provider, and paste.")}</strong>{l("把完整密钥粘贴到「API Key」输入框。小眼睛可以检查本次输入。不要复制引号或说明文字；密钥首尾多余空白会在测试和保存时自动去除。", "Paste the complete key into the API Key field. Use the eye to check this input. Do not include quotes or explanatory text; surrounding whitespace is trimmed when testing and saving.")}</li>
          <li><strong>{l("选择模型。", "Choose a model.")}</strong>{l("模型就是具体负责回答的 AI。初次使用可以保留默认选择；也可点击「读取可用模型」查看账户能用的模型。服务地址（Base URL）是 Ling 发送请求的入口，选择预设服务商后通常不用改。", "A model is the specific AI that answers you. You can keep the default or load available models to see your account's options. The Base URL is the address Ling sends requests to; usually keep the preset for your provider.")}</li>
          <li><strong>{l("点击「测试连接」。", "Click Test connection.")}</strong>{l("粘贴后就能测试，不需要先保存。Ling 会用当前填写的密钥、地址和模型发送一次简短请求，确认能否收到回答。测试和读取模型都不会自动保存或替换旧配置。", "You can test right after pasting, without saving first. Ling sends a short request using the key, URL, and model currently in the form to check for a response. Testing and loading models do not save or replace your previous configuration.")}</li>
          <li><strong>{l("成功后点击「保存配置」。", "After success, click Save configuration.")}</strong>{l("看到「配置已保存」就完成了，不需要再确认一次。新建会谈会使用这份配置。保存后密钥输入框会清空并显示「已保存」，这是正常的，不代表密钥丢失。", "When Configuration saved appears, setup is complete; no second confirmation is needed. New sessions use this configuration. The key field then clears and shows Saved. This is normal and does not mean the key was lost.")}</li>
        </ol>

        <h3>{l("测试失败怎么办？", "What if the test fails?")}</h3>
        <p>{l("先确认密钥完整、服务商选对、网络可用；再到服务商平台检查密钥是否有效、账户是否有 API 额度或余额，以及是否允许使用所选模型。仍失败时，重新复制密钥或换一个账户可用的模型再测，不需要为了重试先保存。", "Check that the key is complete, the provider matches, and the network works. On the provider's platform, check that the key is active, API credit or balance is available, and your account has access to the model. If needed, copy the key again or select another available model and retry without saving first.")}</p>
        <p>{l("费用由服务商收取，聊天会员不一定包含 API 额度。测试也可能产生少量费用；开始使用前请查看平台的 API 计费说明。", "The provider charges for API usage. A chat subscription may not include API credit. Testing may also incur a small charge; check the platform's API pricing before use.")}</p>

        <h3>{l("以后更换或删除密钥", "Replacing or deleting a key later")}</h3>
        <p>{l("更换：直接粘贴新密钥，测试成功后保存。留空：继续使用已保存的密钥，不会删除它。删除：点击「删除 API Key」并确认。小眼睛只能显示本次输入，不能查看已经保存的完整密钥。", "Replace: paste a new key, test it, then save. Leave blank: keep using the saved key; this does not delete it. Delete: click Delete API key and confirm. The eye reveals only your current input, never the full saved key.")}</p>
        <p>{l("如果选择「本机模型」：先在 Ollama 或 LM Studio 启动模型服务，再回 Ling 检测并选择模型、测试，最后保存并使用。这条路径不需要填写上述 API Key。", "If you choose Local model, first start a model service in Ollama or LM Studio. Then detect and select a model in Ling, test, and save. This path does not require the API key described above.")}</p>
        <p className="model-guide-note">
          {l("密钥保存在这台设备上。使用 API 服务时，生成回答所需的会谈内容会发送给你选择的服务商；咨询结束后的整理和来信也可能调用它。请了解该平台的隐私与数据处理规则。", "The key is stored on this device. When using an API service, counseling content needed for responses is sent to your chosen provider. Post-session organization and letters may use it too. Review that platform's privacy and data-handling terms.")}
        </p>
      </section>
    </div>,
    document.body
  );
}

function isLoopbackAddress(value: string) {
  const hostname = value.trim().match(/^https?:\/\/(\[[^\]]+\]|[^/:]+)/i)?.[1]?.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function buildModelOptions(models: Array<{ id: string; name: string }>, selectedModelIds: string[]) {
  const optionMap = new Map(models.map((model) => [model.id, model]));
  for (const id of selectedModelIds) {
    if (!id || optionMap.has(id)) continue;
    optionMap.set(id, { id, name: id });
  }
  return Array.from(optionMap.values());
}

function ProfileSettings() {
  const { locale, l, t } = useLingua();
  const { message, profile, saveLocale, saveProfile, status, updateProfile } = useSettingsStore();
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const avatarReadTaskRef = useRef<Promise<void> | null>(null);
  const avatarTaskVersionRef = useRef(0);

  useEffect(() => () => {
    avatarTaskVersionRef.current += 1;
  }, []);

  useEffect(() => {
    if (profile.avatarDataUrl) {
      setAvatarPreviewUrl(profile.avatarDataUrl);
    }
  }, [profile.avatarDataUrl]);

  useEffect(() => {
    if (avatarPreviewUrl.startsWith("blob:")) {
      return () => {
        URL.revokeObjectURL(avatarPreviewUrl);
      };
    }
    return undefined;
  }, [avatarPreviewUrl]);

  async function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError(l("请选择 PNG、JPEG 或 WebP 图片。", "Choose a PNG, JPEG, or WebP image."));
      event.target.value = "";
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setAvatarError(l("头像文件不能超过 3 MB。", "The avatar file must be no larger than 3 MB."));
      event.target.value = "";
      return;
    }
    setAvatarError("");
    const taskVersion = avatarTaskVersionRef.current + 1;
    avatarTaskVersionRef.current = taskVersion;
    const nextPreviewUrl = URL.createObjectURL(file);
    setAvatarPreviewUrl((previousUrl) => {
      if (previousUrl.startsWith("blob:")) {
        URL.revokeObjectURL(previousUrl);
      }
      return nextPreviewUrl;
    });
    const readTask = prepareAvatarForStorage(file)
      .then(({ avatarDataUrl, avatarFileName }) => {
        if (avatarTaskVersionRef.current !== taskVersion) return;
        updateProfile({ avatarDataUrl, avatarFileName });
      })
      .catch(() => {
        if (avatarTaskVersionRef.current !== taskVersion) return;
        setAvatarError(l("没有成功处理这张头像，请换一张图片重试。", "This image could not be prepared as an avatar. Choose another image and try again."));
      });
    avatarReadTaskRef.current = readTask;
    await readTask;
  }

  async function handleSaveProfile() {
    await avatarReadTaskRef.current;
    await saveProfile();
  }

  function removeAvatar() {
    avatarTaskVersionRef.current += 1;
    avatarReadTaskRef.current = null;
    if (avatarPreviewUrl.startsWith("blob:")) URL.revokeObjectURL(avatarPreviewUrl);
    setAvatarPreviewUrl("");
    setAvatarError("");
    updateProfile({ avatarDataUrl: undefined, avatarFileName: undefined });
  }

  return (
    <div className="system-simple-page">
      <header className="system-content-header">
        <div>
          <h1>{l("个人资料", "Profile")}</h1>
          <p>{l("这些信息完全由你选择填写，用来帮助三位 AI 咨询师称呼你，并了解你愿意提前说明的背景。", "Everything here is optional. It helps the three AI counselors address you and understand any background you choose to share in advance.")}</p>
        </div>
      </header>

      <section className="profile-settings-layout">
        <aside className="profile-avatar-card">
          <div className="profile-avatar-preview" aria-label={l("当前头像预览", "Current avatar preview")}>
            {avatarPreviewUrl ? <img alt={l("个人头像预览", "Profile avatar preview")} src={avatarPreviewUrl} /> : <span>{l("头像", "Avatar")}</span>}
          </div>
          <label className="profile-avatar-upload">
            <input accept="image/png,image/jpeg,image/webp" aria-label={l("选择头像图片", "Choose an avatar image")} onChange={(event) => void handleAvatarChange(event)} type="file" />
            <span>{l("更换头像", "Change avatar")}</span>
          </label>
          {avatarPreviewUrl && <button className="profile-avatar-remove" onClick={removeAvatar} type="button">{l("移除头像", "Remove avatar")}</button>}
          <small className="profile-avatar-hint">{l("支持 PNG、JPEG、WebP；文件不超过 3 MB，保存时会缩放为头像尺寸。", "PNG, JPEG, and WebP are supported. Files must be no larger than 3 MB and are resized when saved.")}</small>
        </aside>

        <SettingSectionCard title={l("你愿意提前告诉咨询师什么", "What would you like counselors to know?")} description={l("这不是必填档案。称呼会用于对话；背景会作为你主动提供的会谈上下文。", "This is not a required profile. Your name is used in conversation, and your background becomes context you have chosen to provide.")}>
          <fieldset className="reading-choice-group profile-language-choice">
            <legend>{t("settings.profile.languageTitle")}</legend>
            <div className="reading-segmented-control">
              {(["zh-CN", "en-US"] as const satisfies readonly SupportedLocale[]).map((option) => (
                <button
                  aria-pressed={locale === option}
                  className={locale === option ? "active" : ""}
                  key={option}
                  onClick={() => void saveLocale(option)}
                  type="button"
                >
                  {t(`language.${option}`)}
                </button>
              ))}
            </div>
            <small className="profile-language-hint">{t("language.settingsHint")}</small>
          </fieldset>
          <div className="system-form-grid profile">
            <TextInput
              label={l("你希望咨询师如何称呼你？", "How would you like your counselor to address you?")}
              onChange={(value) => updateProfile({ displayName: value })}
              placeholder={l("填写你习惯的称呼", "Enter your preferred form of address")}
              value={profile.displayName}
            />
            <label className="system-field wide">
              <span>{l("你愿意让咨询师提前知道的背景", "Background you would like counselors to know")}</span>
              <textarea
                aria-label={l("你愿意让咨询师提前知道的背景", "Background you would like counselors to know")}
                maxLength={1000}
                onChange={(event) => updateProfile({ background: event.target.value })}
                placeholder={l("例如：最近想整理亲密关系、工作压力，或者只是希望对话慢一点。", "For example: I want to reflect on a relationship, work stress, or I simply prefer a slower conversation.")}
                value={profile.background}
              />
              <small className="profile-character-count">{profile.background.length}/1000</small>
            </label>
          </div>
          <div className="profile-boundary-note">
            {l("头像只保存在这台设备上，用于界面显示，不会发送给模型。称呼和背景会提供给三位 AI 咨询师，并随相关会谈、咨询结束后的整理和来信请求发送到你配置的模型服务。", "Your avatar stays on this device for interface display and is not sent to the model. Your name and background are provided to the three AI counselors and may be sent to your configured model service with related sessions, post-session organization, and letter requests.")}
          </div>
          <div className="system-form-actions">
            <PrimaryButton disabled={status === "saving"} onClick={() => void handleSaveProfile()}>
              {status === "saving" ? l("正在保存……", "Saving…") : t("settings.profile.save")}
            </PrimaryButton>
          </div>
          {message && <p className="system-feedback">{message}</p>}
          {avatarError && <p className="system-feedback error" role="alert">{avatarError}</p>}
        </SettingSectionCard>
      </section>
    </div>
  );
}

function CounselingSettings() {
  const { l } = useLingua();
  const { counseling, message, saveCounseling, status, updateCounseling } = useSettingsStore();
  const [isPastUnderstandingHelpOpen, setIsPastUnderstandingHelpOpen] = useState(false);
  const isBusy = status === "loading" || status === "saving";
  const shouldBringPastUnderstanding = counseling.bringPastUnderstandingToNewSessions;

  function handlePastUnderstandingChange(checked: boolean) {
    updateCounseling({ bringPastUnderstandingToNewSessions: checked });
  }

  return (
    <div className="system-simple-page">
      <header className="system-content-header">
        <div>
          <h1>{l("咨询连续性", "Counseling continuity")}</h1>
          <p>{l("决定同一位咨询师的新会谈是否承接上一阶段的后台整理材料。", "Choose whether a new session with the same counselor can draw on background materials organized after the previous session.")}</p>
        </div>
      </header>
      <SettingSectionCard
        title={l("让新会谈承接同一咨询师的后台整理", "Carry background understanding into new sessions")}
        description={l("只作用于之后新建的会谈，不会改写已经存在的会谈。", "This affects only sessions created afterward and does not rewrite existing sessions.")}
      >
        <div className="system-toggle-group" aria-label={l("会谈理解带入设置", "Session continuity setting")}>
          <HelpToggleRow
            checked={shouldBringPastUnderstanding}
            closeLabel={l("关闭新会谈过去理解说明", "Close continuity explanation")}
            helpId="past-understanding-help"
            helpOpen={isPastUnderstandingHelpOpen}
            helpParagraphs={[
              l("开启后，同一位咨询师的新会谈会承接 Ling 在上次会谈结束后生成的后台整理材料。这部分仅在后台生成和使用，不作为可阅读的咨询总结展示。", "When enabled, a new session with the same counselor can use background materials Ling organized after the previous session. These materials are generated and used in the background and are not presented as a counseling summary."),
              l("后台整理材料只保留下次承接需要的理解和线索，不跨咨询师共享，也不是事实定论或固定计划；你在当下的表达始终优先。", "Background materials retain only the understanding and threads needed for continuity. They are not shared between counselors and are neither settled facts nor a fixed plan; what you say in the present session always takes priority."),
              l("关闭只影响之后新建的会谈，不会删除已经保存在本机的历史资料。", "Turning this off affects only future sessions and does not delete history already stored on this device.")
            ]}
            id="bring-past-understanding-to-new-sessions"
            label={l("新会谈承接同一咨询师的后台整理", "Use background understanding in new sessions with the same counselor")}
            onChange={handlePastUnderstandingChange}
            onHelpOpenChange={setIsPastUnderstandingHelpOpen}
            popoverLabel={l("新会谈过去理解说明", "About carrying understanding into new sessions")}
          />
        </div>
        <div className="system-form-actions">
          <PrimaryButton disabled={isBusy} onClick={() => void saveCounseling()}>
            {l("保存连续性设置", "Save continuity settings")}
          </PrimaryButton>
        </div>
        {message && <p className="system-feedback">{message}</p>}
      </SettingSectionCard>
    </div>
  );
}

function AppearanceSettings() {
  const { locale, l } = useLingua();
  const { appearance, dirtySections, message, saveAppearance, status, updateAppearance } = useSettingsStore();
  const isBusy = status === "loading" || status === "saving";

  return (
    <div className="system-simple-page reading-appearance-page">
      <header className="system-content-header">
        <div>
          <h1>{l("界面与阅读", "Display & reading")}</h1>
          <p>{l("调整 Ling 中主要文字的大小、行距与鼠标样式。修改会立即显示，保存后会在下次打开时继续使用。", "Adjust primary text size, line spacing, and cursor style in Ling. Changes appear immediately and continue to apply after they are saved.")}</p>
        </div>
      </header>
      <SettingSectionCard title={l("界面显示", "Display preferences")} description={l("文字档位与光标方案都适配固定桌面窗口，变化清楚，但不会挤压主要操作。", "Text levels and cursor themes are designed for Ling's fixed desktop layout, so changes remain clear without crowding essential controls.")}>
        <div className="reading-settings-layout">
          <ReadingChoiceGroup<ReadingTextSize>
            label={l("文字大小", "Text size")}
            onChange={(textSize) => updateAppearance({ textSize })}
            options={[
              { label: l("小", "Small"), value: "small" },
              { label: l("标准", "Standard"), value: "standard" },
              { label: l("大", "Large"), value: "large" }
            ]}
            value={appearance.textSize}
          />
          <ReadingChoiceGroup<ReadingLineSpacing>
            label={l("行距", "Line spacing")}
            onChange={(lineSpacing) => updateAppearance({ lineSpacing })}
            options={[
              { label: l("紧凑", "Compact"), value: "compact" },
              { label: l("标准", "Standard"), value: "standard" },
              { label: l("宽松", "Relaxed"), value: "relaxed" }
            ]}
            value={appearance.lineSpacing}
          />
          <CursorThemeChoice
            label={l("鼠标样式", "Cursor style")}
            locale={locale}
            onChange={(cursorTheme) => updateAppearance({ cursorTheme })}
            value={appearance.cursorTheme ?? "d"}
          />
          <section className="reading-preview" aria-labelledby="reading-preview-title">
            <div className="reading-preview-heading">
              <div>
                <h3 id="reading-preview-title">{l("阅读预览", "Reading preview")}</h3>
                <span>{l("会谈与来信会使用相同的阅读偏好", "Sessions and letters use the same reading preferences")}</span>
              </div>
              <small>{formatReadingSelection(appearance.textSize, appearance.lineSpacing, locale)}</small>
            </div>
            <div className="reading-preview-paper" style={getReadingPreviewStyle(appearance)}>
              <p className="reading-preview-salutation">{l("你好，", "Hello,")}</p>
              <p>{l("此刻的感受，可以慢慢说。我们不急着得到答案，先给正在发生的心情留一点位置。", "Take your time with what you are feeling. We do not need to rush toward an answer; first, we can make room for what is happening inside.")}</p>
            </div>
          </section>
        </div>
        <div className="system-form-actions reading-settings-actions">
          <PrimaryButton disabled={isBusy || !dirtySections.appearance} onClick={() => void saveAppearance()}>
            {status === "saving" ? l("正在保存……", "Saving…") : dirtySections.appearance ? l("保存界面设置", "Save display settings") : l("界面设置已保存", "Display settings saved")}
          </PrimaryButton>
        </div>
        {message && <p className="system-feedback">{message}</p>}
      </SettingSectionCard>
    </div>
  );
}

function CursorThemeChoice({
  label,
  locale,
  onChange,
  value
}: {
  label: string;
  locale: SupportedLocale;
  onChange: (value: CursorTheme) => void;
  value: CursorTheme;
}) {
  return (
    <fieldset className="reading-choice-group cursor-theme-choice">
      <legend>{label}</legend>
      <div className="cursor-theme-grid">
        {cursorThemeOptions.map((option) => {
          const optionLabel = option.label[locale === "en-US" ? 1 : 0];
          const optionDescription = option.description[locale === "en-US" ? 1 : 0];
          return (
            <button
              aria-label={`${label}：${optionLabel}`}
              aria-pressed={value === option.id}
              className={value === option.id ? "active" : ""}
              key={option.id}
              onClick={() => onChange(option.id)}
              type="button"
            >
              <span className="cursor-theme-icons" aria-hidden="true">
                <img alt="" src={option.pointer} />
                <img alt="" src={option.hand} />
                <img alt="" src={option.text} />
              </span>
              <span className="cursor-theme-copy">
                <strong>{optionLabel}</strong>
                <small>{optionDescription}</small>
              </span>
            </button>
          );
        })}
      </div>
      <p className="cursor-theme-hint">{locale === "en-US" ? "Move over the options, buttons, and text fields to feel each cursor state." : "选择后立即生效；可在选项、按钮和输入框之间移动，体验不同状态。"}</p>
    </fieldset>
  );
}

function ReadingChoiceGroup<T extends string>({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
  value: T;
}) {
  return (
    <fieldset className="reading-choice-group">
      <legend>{label}</legend>
      <div className="reading-segmented-control">
        {options.map((option) => (
          <button
            aria-label={`${label}：${option.label}`}
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function formatReadingSelection(textSize: ReadingTextSize, lineSpacing: ReadingLineSpacing, locale: SupportedLocale) {
  const textSizeLabel = locale === "en-US"
    ? { small: "Small text", standard: "Standard text", large: "Large text" }[textSize]
    : { small: "小号文字", standard: "标准文字", large: "大号文字" }[textSize];
  const lineSpacingLabel = locale === "en-US"
    ? { compact: "Compact spacing", standard: "Standard spacing", relaxed: "Relaxed spacing" }[lineSpacing]
    : { compact: "紧凑行距", standard: "标准行距", relaxed: "宽松行距" }[lineSpacing];
  return `${textSizeLabel} · ${lineSpacingLabel}`;
}

function PrivacySettings() {
  const { l } = useLingua();
  const [exportingScope, setExportingScope] = useState<DataExportScope | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [backupStatus, setBackupStatus] = useState<"idle" | "creating" | "restoring">("idle");
  const [backupFeedback, setBackupFeedback] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [isRestoreConfirmOpen, setIsRestoreConfirmOpen] = useState(false);
  const [isRestoreRecoveryOpen, setIsRestoreRecoveryOpen] = useState(false);
  const [restoreRecoveryCode, setRestoreRecoveryCode] = useState("");
  const [isPrivacyNoticeOpen, setIsPrivacyNoticeOpen] = useState(false);

  async function handleExport(scope: DataExportScope) {
    if (!window.lingDesktop?.dataExports) {
      setExportFeedback({ message: l("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app."), tone: "error" });
      return;
    }

    setExportingScope(scope);
    setExportFeedback(null);
    try {
      const result = await window.lingDesktop.dataExports.export(scope);
      if (!result.ok) {
        setExportFeedback({ message: result.error.message, tone: "error" });
        return;
      }
      if (result.data.status === "cancelled") {
        setExportFeedback({ message: l("已取消，未创建导出文件。", "Export canceled. No file was created."), tone: "success" });
        return;
      }
      const parts = [
        result.data.sessionCount > 0 ? l(`${result.data.sessionCount} 场会谈`, `${result.data.sessionCount} session${result.data.sessionCount === 1 ? "" : "s"}`) : "",
        result.data.letterCount > 0 ? l(`${result.data.letterCount} 封来信`, `${result.data.letterCount} letter${result.data.letterCount === 1 ? "" : "s"}`) : ""
      ].filter(Boolean);
      setExportFeedback({
        message: l(`已导出 ${parts.join("、")}，文件为「${result.data.fileName ?? "Markdown 文件"}」。`, `Exported ${parts.join(" and ")} to “${result.data.fileName ?? "Markdown file"}.”`),
        tone: "success"
      });
    } catch {
      setExportFeedback({ message: l("没有完成导出。请确认保存位置可用后重试。", "The export did not finish. Check that the destination is available and try again."), tone: "error" });
    } finally {
      setExportingScope(null);
    }
  }

  async function createBackup() {
    if (!window.lingDesktop?.localBackups) {
      setBackupFeedback({ message: l("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app."), tone: "error" });
      return;
    }
    setBackupStatus("creating");
    setBackupFeedback(null);
    try {
      const result = await window.lingDesktop.localBackups.create();
      if (!result.ok) {
        setBackupFeedback({ message: result.error.message, tone: "error" });
      } else if (result.data.status === "cancelled") {
        setBackupFeedback({ message: l("已取消，未创建备份文件。", "Backup canceled. No file was created."), tone: "success" });
      } else {
        setBackupFeedback({ message: l(`已创建本地备份「${result.data.fileName ?? "备份文件"}」。`, `Created local backup “${result.data.fileName ?? "backup file"}.”`), tone: "success" });
      }
    } catch {
      setBackupFeedback({ message: l("没有创建备份。请确认保存位置可用后重试。", "The backup was not created. Check that the destination is available and try again."), tone: "error" });
    } finally {
      setBackupStatus("idle");
    }
  }

  async function restoreBackup(recoveryPhrase?: string) {
    setIsRestoreConfirmOpen(false);
    setIsRestoreRecoveryOpen(false);
    if (!window.lingDesktop?.localBackups) {
      setBackupFeedback({ message: l("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app."), tone: "error" });
      return;
    }
    setBackupStatus("restoring");
    setBackupFeedback(null);
    try {
      const result = await window.lingDesktop.localBackups.restore(recoveryPhrase);
      if (!result.ok) {
        if (result.error.code === "RECOVERY_REQUIRED") {
          setBackupFeedback({ message: result.error.message, tone: "error" });
          setIsRestoreRecoveryOpen(true);
          return;
        }
        setBackupFeedback({ message: result.error.message, tone: "error" });
      } else if (result.data.status === "cancelled") {
        setBackupFeedback({ message: l("已取消恢复，现有本机资料没有改变。", "Restore canceled. Existing local information was not changed."), tone: "success" });
      } else {
        setBackupFeedback({ message: l("本地备份已恢复，Ling 正在重新启动。", "The local backup was restored. Ling is restarting."), tone: "success" });
      }
    } catch {
      setBackupFeedback({ message: l("恢复失败，现有本地资料没有被替换。", "Restore failed. Existing local information was not replaced."), tone: "error" });
    } finally {
      setBackupStatus("idle");
    }
  }

  return (
    <div className="system-simple-page">
      <header className="system-content-header">
        <div>
          <h1>{l("数据与隐私", "Data & privacy")}</h1>
          <p>{l("把这台设备上的会谈记录和已完成来信导出到你选择的位置，或创建用于迁移与恢复的完整本地备份。", "Export session records and completed letters from this device, or create a complete local backup for migration and recovery.")}</p>
        </div>
      </header>
      <SettingSectionCard
        title={l("隐私说明", "Privacy notice")}
        description={l("查看个人信息处理主体、模型服务、本机保存、安全边界和你的权利。", "Review the processor, model services, local storage, security boundaries, and your rights.")}
      >
        <div>
          <p>{l("完整说明同时随安装包提供；涉及隐私或个人信息权利的问题，可以联系 openling@xiaoqunpsy.cn。", "The full notice is also included with the installation package. For privacy or personal-information rights questions, contact openling@xiaoqunpsy.cn.")}</p>
          <SecondaryButton onClick={() => setIsPrivacyNoticeOpen(true)}>
            {l("查看完整隐私说明", "Read the full privacy notice")}
          </SecondaryButton>
        </div>
      </SettingSectionCard>
      <PasswordProtectionSection />
      <SettingSectionCard
        title={l("导出会谈与来信", "Export sessions and letters")}
        description={l("导出为一个 Markdown 文件，按咨询师分组，每位咨询师内按时间从新到旧排列。", "Export one Markdown file grouped by counselor, with each counselor's records ordered from newest to oldest.")}
      >
        <div className="privacy-export-grid">
          <article>
            <strong>{l("会谈与来信", "Sessions and letters")}</strong>
            <p>{l("导出全部会谈记录，以及已经完成的咨询师来信。", "Export all session records and completed counselor letters.")}</p>
            <PrimaryButton disabled={exportingScope !== null} onClick={() => void handleExport("all")}>
              {exportingScope === "all" ? l("正在准备……", "Preparing…") : l("导出会谈与来信", "Export sessions and letters")}
            </PrimaryButton>
          </article>
          <article>
            <strong>{l("会谈记录", "Session records")}</strong>
            <p>{l("导出你与咨询师之间的会谈消息，不包含系统提示和仅供 Ling 使用的后台整理材料。", "Export messages exchanged with counselors. System prompts and background materials used only by Ling are excluded.")}</p>
            <SecondaryButton disabled={exportingScope !== null} onClick={() => void handleExport("sessions")}>
              {exportingScope === "sessions" ? l("正在准备……", "Preparing…") : l("只导出会谈", "Export sessions only")}
            </SecondaryButton>
          </article>
          <article>
            <strong>{l("咨询师的信", "Counselor letters")}</strong>
            <p>{l("只导出已经完成的来信，生成中或失败的来信不会写入文件。", "Export completed letters only. Pending or failed letters are not included.")}</p>
            <SecondaryButton disabled={exportingScope !== null} onClick={() => void handleExport("letters")}>
              {exportingScope === "letters" ? l("正在准备……", "Preparing…") : l("只导出咨询师的信", "Export letters only")}
            </SecondaryButton>
          </article>
        </div>
        <div className="privacy-export-note">
          {l("导出文件会保存到你在系统窗口中选择的位置，不包含附件原文件、API Key、系统提示或仅供 Ling 使用的后台整理材料。Markdown 文件没有加密；请保存到只有你或你信任的人能访问的位置。", "The export is saved to the location you choose in the system dialog. It excludes original attachment files, API keys, system prompts, and background materials used only by Ling. The Markdown file is not encrypted; keep it somewhere accessible only to you or people you trust.")}
        </div>
        {exportFeedback && (
          <p aria-live="polite" className={`privacy-export-feedback ${exportFeedback.tone}`} role="status">
            {exportFeedback.message}
          </p>
        )}
      </SettingSectionCard>
      <SettingSectionCard title={l("完整本地备份", "Complete local backup")} description={l("用于迁移或恢复 Ling 的本地资料；它和供阅读的 Markdown 导出不同。", "Use this to migrate or restore Ling's local information. It is different from the human-readable Markdown export.")}>
        <div className="local-backup-layout">
          <div>
            <strong>{l("创建本地备份", "Create a local backup")}</strong>
            <p>{l("备份会谈、来信、后台整理材料、设置、个人资料和头像。备份文件会加密；换设备恢复时需要原恢复码。API Key 不会写入备份，恢复后需要重新配置。", "Back up sessions, letters, background materials, settings, profile information, and your avatar. The backup file is encrypted; restoring it on another device requires the original recovery code. API keys are not included and must be configured again after restoring.")}</p>
            <PrimaryButton disabled={backupStatus !== "idle" || exportingScope !== null} onClick={() => void createBackup()}>
              {backupStatus === "creating" ? l("正在创建……", "Creating…") : l("创建本地备份", "Create local backup")}
            </PrimaryButton>
          </div>
          <div>
            <strong>{l("恢复本地备份", "Restore a local backup")}</strong>
            <p>{l("恢复会替换当前这台设备上的 Ling 本地资料，并在完成后重新启动 App。", "Restoring replaces Ling's local information on this device and restarts the app when complete.")}</p>
            <SecondaryButton disabled={backupStatus !== "idle" || exportingScope !== null} onClick={() => setIsRestoreConfirmOpen(true)} tone="danger">
              {backupStatus === "restoring" ? l("正在恢复……", "Restoring…") : l("恢复本地备份", "Restore local backup")}
            </SecondaryButton>
          </div>
        </div>
        {backupFeedback && (
          <p aria-live="polite" className={`privacy-export-feedback ${backupFeedback.tone}`} role="status">
            {backupFeedback.message}
          </p>
        )}
      </SettingSectionCard>
      <RecommendedSettingsRestoreSection />
      {isRestoreConfirmOpen && (
        <SettingsConfirmDialog
          confirmLabel={l("选择备份并恢复", "Choose backup and restore")}
          description={l("恢复会先替换这台设备上现有的 Ling 本地资料，然后重新启动 App。当前资料不会自动另存；API Key 也不会从备份中恢复。", "Restoring replaces Ling's existing local information on this device and then restarts the app. Current information is not backed up automatically, and API keys are not restored.")}
          onCancel={() => setIsRestoreConfirmOpen(false)}
          onConfirm={() => void restoreBackup()}
          title={l("确定恢复本地备份？", "Restore a local backup?")}
          tone="danger"
        />
      )}
      {isRestoreRecoveryOpen && (
        <div className="settings-confirm-backdrop" onMouseDown={() => setIsRestoreRecoveryOpen(false)}>
          <section aria-labelledby="restore-recovery-title" aria-modal="true" className="settings-confirm-dialog" onMouseDown={(event) => event.stopPropagation()} role="alertdialog">
            <h2 id="restore-recovery-title">{l("输入原恢复码", "Enter the original recovery code")}</h2>
            <p>{l("这份备份来自另一台设备。请输入创建备份时保存的恢复码，Ling 会用它打开备份并安全地保存到这台设备。", "This backup was created on another device. Enter the recovery code saved when it was created, and Ling will open it and store it securely on this device.")}</p>
            <input autoComplete="off" className="system-field" onChange={(event) => setRestoreRecoveryCode(event.target.value)} placeholder={l("输入恢复码", "Enter the recovery code")} value={restoreRecoveryCode} />
            <div>
              <button className="system-secondary-button" onClick={() => setIsRestoreRecoveryOpen(false)} type="button">{l("取消", "Cancel")}</button>
              <button className="system-secondary-button danger" disabled={!restoreRecoveryCode.trim()} onClick={() => void restoreBackup(restoreRecoveryCode.trim())} type="button">{l("确认恢复", "Confirm restore")}</button>
            </div>
          </section>
        </div>
      )}
      {isPrivacyNoticeOpen && <PrivacyNoticeDialog onClose={() => setIsPrivacyNoticeOpen(false)} />}
    </div>
  );
}

function RecommendedSettingsRestoreSection() {
  const { l } = useLingua();
  const { message, restoreRecommendedSettings, status } = useSettingsStore();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const isBusy = status === "loading" || status === "saving";

  async function restore() {
    setIsConfirmOpen(false);
    await restoreRecommendedSettings();
  }

  return (
    <SettingSectionCard
      title={l("恢复推荐设置", "Restore recommended settings")}
      description={l("把常用偏好带回 Ling 的推荐状态，不会清空你的咨询内容或个人资料。", "Return common preferences to Ling's recommended values without clearing counseling content or profile information.")}
    >
      <div className="recommended-settings-restore">
        <div>
          <strong>{l("将恢复的偏好", "Preferences that will be restored")}</strong>
          <p>{l("阅读文字与行距、咨询连续性、默认心理咨询模型，以及咨询结束后的模型选择。", "Reading text and spacing, counseling continuity, the default counseling model, and post-session model selections.")}</p>
        </div>
        <div>
          <strong>{l("始终保留的内容", "Information that will remain unchanged")}</strong>
          <p>{l("会谈、来信、备份、头像、个人背景、模型服务地址和 API Key 都不会被修改。", "Sessions, letters, backups, your avatar and background, the model service URL, and API keys will not be changed.")}</p>
        </div>
      </div>
      <div className="system-form-actions recommended-settings-restore-action">
        <SecondaryButton disabled={isBusy} onClick={() => setIsConfirmOpen(true)}>
          {status === "saving" ? l("正在恢复……", "Restoring…") : l("恢复推荐设置", "Restore recommended settings")}
        </SecondaryButton>
      </div>
      {message && <p aria-live="polite" className={`privacy-export-feedback ${status === "error" ? "error" : "success"}`} role="status">{message}</p>}
      {isConfirmOpen && (
        <SettingsConfirmDialog
          confirmLabel={l("恢复推荐设置", "Restore recommended settings")}
          description={l("这会把阅读显示、咨询连续性和模型选择恢复为推荐值。会谈、来信、备份、头像、个人背景、模型服务地址和 API Key 都不会被删除或修改。", "This restores reading display, counseling continuity, and model selections to their recommended values. Sessions, letters, backups, your avatar and background, the model service URL, and API keys will not be deleted or changed.")}
          onCancel={() => setIsConfirmOpen(false)}
          onConfirm={() => void restore()}
          title={l("确定恢复推荐设置？", "Restore recommended settings?")}
        />
      )}
    </SettingSectionCard>
  );
}

function PasswordProtectionSection() {
  const { locale, l } = useLingua();
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [graceMinutes, setGraceMinutes] = useState(5);
  const [mode, setMode] = useState<"summary" | "setup" | "change" | "disable">("summary");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState(() => createRecoveryPhrase());
  const [hasStoredPhrase, setHasStoredPhrase] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isDesktopApp = Boolean(window.lingDesktop?.accessLock);

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    setRecoveryCode(createRecoveryPhrase());
    setHasStoredPhrase(false);
  }, [locale]);

  async function refreshStatus() {
    if (!window.lingDesktop?.accessLock) {
      setConfigured(false);
      setEnabled(false);
      return;
    }
    const result = await window.lingDesktop.accessLock.status();
    if (result.ok) {
      setConfigured(result.data.configured ?? result.data.enabled);
      setEnabled(result.data.enabled);
      setGraceMinutes(result.data.graceMinutes ?? 5);
    } else {
      setEnabled(false);
    }
  }

  async function updateGraceMinutes(minutes: number) {
    if (!window.lingDesktop?.accessLock) return;
    const result = await window.lingDesktop.accessLock.setGraceMinutes(minutes);
    if (result.ok) {
      setGraceMinutes(minutes);
      setFeedback({ message: l("免密窗口已更新。", "The unlock grace period has been updated."), tone: "success" });
    } else {
      setFeedback({ message: result.error.message, tone: "error" });
    }
  }

  function resetForm(nextMode: typeof mode) {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setFeedback(null);
  }

  async function setupPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setFeedback({ message: l("两次输入的密码不一致。", "The two passwords do not match."), tone: "error" });
      return;
    }
    if (!hasStoredPhrase) {
      setFeedback({ message: l("请先保存恢复码，并确认不会把它发给别人。", "Save the recovery code first, and confirm that you will not share it with anyone."), tone: "error" });
      return;
    }
    if (!window.lingDesktop?.accessLock) {
      setIsBusy(true);
      setFeedback(null);
      window.setTimeout(() => {
        setIsBusy(false);
        setFeedback({ message: l("网页预览不能在这台设备上开启本地加密。请在 Ling 桌面版中设置。", "This web preview cannot enable local encryption on this device. Set it up in the Ling desktop app."), tone: "error" });
      }, 420);
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const result = await window.lingDesktop.accessLock.setup({ password, recoveryPhrase: recoveryCode });
      if (!result.ok) {
        setFeedback({ message: result.error.message, tone: "error" });
        return;
      }
      setEnabled(true);
      setConfigured(true);
      resetForm("summary");
      setFeedback({ message: l("本地资料已加密。下次打开 Ling 时需要输入密码。", "Local information is now encrypted. You will need the password the next time Ling opens."), tone: "success" });
    } catch {
      setFeedback({ message: l("没有成功设置密码，请稍后重试。", "The password could not be set. Please try again."), tone: "error" });
    } finally {
      setIsBusy(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.lingDesktop?.accessLock) return;
    if (password !== confirmPassword) {
      setFeedback({ message: l("两次输入的新密码不一致。", "The two new passwords do not match."), tone: "error" });
      return;
    }
    setIsBusy(true);
    setFeedback(null);
    try {
      const result = await window.lingDesktop.accessLock.changePassword({ currentPassword, newPassword: password });
      if (!result.ok) {
        setFeedback({ message: result.error.message, tone: "error" });
        return;
      }
      resetForm("summary");
      setFeedback({ message: l("密码已更新。", "Password updated."), tone: "success" });
    } catch {
      setFeedback({ message: l("没有成功修改密码，请稍后重试。", "The password could not be changed. Please try again."), tone: "error" });
    } finally {
      setIsBusy(false);
    }
  }

  async function lockNow() {
    if (!window.lingDesktop?.accessLock) return;
    setIsBusy(true);
    const result = await window.lingDesktop.accessLock.lockNow();
    if (result.ok) window.location.reload();
    else {
      setIsBusy(false);
      setFeedback({ message: result.error.message, tone: "error" });
    }
  }

  async function disablePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.lingDesktop?.accessLock) return;
    setIsBusy(true);
    setFeedback(null);
    try {
      const result = await window.lingDesktop.accessLock.disable(currentPassword);
      if (!result.ok) {
        setFeedback({ message: result.error.message, tone: "error" });
        return;
      }
      setEnabled(false);
      setConfigured(true);
      resetForm("summary");
      setFeedback({
        message: l("已关闭启动密码。本地资料仍由这台设备加密保护。", "Startup password disabled. Local information remains encrypted on this device."),
        tone: "success"
      });
    } catch {
      setFeedback({ message: l("没有成功关闭密码保护，请稍后重试。", "Password protection could not be disabled. Please try again."), tone: "error" });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <SettingSectionCard
      title={l("解锁密码", "Unlock password")}
      description={enabled === false && configured
        ? l("本地资料仍由这台设备加密保护，打开 Ling 时不需要输入密码。", "Local information remains encrypted by this device, and Ling opens without asking for a password.")
        : enabled
          ? l("你的本地资料已加密保存。每次打开 Ling 需要输入密码；忘记密码时，需要恢复码才能重设。", "Your local information is encrypted. Ling requires the password each time it opens; the recovery code is needed to reset it if you forget it.")
          : l("你可以开启启动密码，让 Ling 在打开时先验证身份。", "You can enable a startup password so Ling verifies your identity when it opens.")}
    >
      {enabled === null ? <p className="system-feedback">{l("正在读取本地加密状态……", "Checking local encryption status…")}</p> : mode === "summary" ? (
        <div className={`password-protection-summary${enabled ? " is-enabled" : " is-disabled"}`}>
          <div className="password-protection-state">
            <span className="password-protection-status">{enabled ? l("已开启", "On") : l("未开启", "Off")}</span>
            <div>
              <strong>{enabled ? l("这台设备的密码保护已开启", "Password protection is enabled on this device") : configured ? l("密码保护已关闭", "Password protection is disabled") : l("还没有设置解锁密码", "No unlock password has been set")}</strong>
              <p>{enabled ? l("开启后，Ling 会在启动时验证密码；忘记时可使用恢复码重设。", "When enabled, Ling verifies your password at startup; the recovery code can reset it if forgotten.") : configured ? l("启动时直接进入 Ling。数据库仍保持加密，密钥由系统安全存储保管。", "Ling opens directly. The database stays encrypted and its key is protected by system secure storage.") : l("开启后，Ling 会加密本地资料，并在启动时验证密码。", "When enabled, Ling encrypts local information and verifies your password at startup.")}</p>
            </div>
          </div>
          <div className="password-protection-actions">
            {enabled ? (
              <>
                <PrimaryButton disabled={isBusy} onClick={() => void lockNow()}>{isBusy ? l("正在锁定……", "Locking…") : l("立即锁定", "Lock now")}</PrimaryButton>
                <SecondaryButton onClick={() => resetForm("change")}>{l("修改密码", "Change password")}</SecondaryButton>
                <SecondaryButton onClick={() => resetForm("disable")} tone="danger">{l("关闭密码保护", "Disable password")}</SecondaryButton>
              </>
            ) : <PrimaryButton onClick={() => resetForm("setup")}>{l("开启密码保护", "Enable password")}</PrimaryButton>}
          </div>
          {enabled && (
            <label className="grace-period-select">
              <span>{l("免密时长", "Password-free duration")}</span>
              <select onChange={(event) => void updateGraceMinutes(Number(event.target.value))} value={graceMinutes}>
                <option value={0}>{l("每次打开都验证", "Verify every time")}</option>
                <option value={5}>{l("5 分钟", "5 minutes")}</option>
                <option value={15}>{l("15 分钟", "15 minutes")}</option>
                <option value={30}>{l("30 分钟", "30 minutes")}</option>
              </select>
              <small>{l("这里只设置重新打开 Ling 时多久内无需重复验证，不会关闭密码保护。离开设备时可点“立即锁定”。", "This only controls how long Ling can reopen without another verification; it does not disable password protection. Use Lock now when leaving your device.")}</small>
            </label>
          )}
        </div>
      ) : mode === "setup" ? (
        <form className={`password-protection-form${isBusy ? " is-submitting" : ""}`} onSubmit={(event) => void setupPassword(event)}>
          <p>{l("请设置至少 6 位的数字密码。恢复码用于忘记密码时重设密码。", "Set a numeric password of at least six digits. The recovery code can reset it if you forget it.")}</p>
          {!isDesktopApp && <p className="password-protection-preview-hint">{l("当前是网页预览：填写与点击会展示提交反馈，但不会在浏览器里保存密码。", "This is a web preview: the form demonstrates submission feedback but does not save a password in your browser.")}</p>}
          <label className="system-field">
            <span>{l("数字密码", "Numeric password")}</span>
            <input autoComplete="new-password" inputMode="numeric" onChange={(event) => setPassword(event.target.value.replace(/\D/gu, ""))} pattern="[0-9]*" type="password" value={password} />
          </label>
          <label className="system-field">
            <span>{l("再次输入数字密码", "Enter the numeric password again")}</span>
            <input autoComplete="new-password" inputMode="numeric" onChange={(event) => setConfirmPassword(event.target.value.replace(/\D/gu, ""))} pattern="[0-9]*" type="password" value={confirmPassword} />
          </label>
          <div className="recovery-phrase-card">
            <span>{l("恢复码", "Recovery code")}</span>
            <code>{recoveryCode}</code>
            <button onClick={() => { setRecoveryCode(createRecoveryPhrase()); setHasStoredPhrase(false); }} type="button">{l("换一个", "Choose another")}</button>
            <p>{l("请把恢复码抄写或复制到安全的地方。不要发给别人；Ling 不会以可读形式保存在这台设备上。", "Save the recovery code or copy it to a password manager you trust. Do not share it; Ling does not store it in readable form on this device.")}</p>
            <label className="recovery-phrase-confirm">
              <input checked={hasStoredPhrase} onChange={(event) => setHasStoredPhrase(event.target.checked)} type="checkbox" />
              <span>{l("我已保存恢复码，并且不会把它发给别人。", "I saved the recovery code, and I will not share it with anyone.")}</span>
            </label>
          </div>
          <div className="system-form-actions">
            <PrimaryButton disabled={isBusy || !password || !confirmPassword || !hasStoredPhrase} type="submit">{isBusy ? <><span aria-hidden="true" className="password-protection-spinner" />{l("正在设置……", "Setting up…")}</> : l("完成设置", "Finish setup")}</PrimaryButton>
            <SecondaryButton disabled={isBusy} onClick={() => resetForm("summary")}>{l("取消", "Cancel")}</SecondaryButton>
          </div>
        </form>
      ) : mode === "change" ? (
        <form className="password-protection-form" onSubmit={(event) => void changePassword(event)}>
          <label className="system-field"><span>{l("当前密码", "Current password")}</span><input autoComplete="current-password" onChange={(event) => setCurrentPassword(event.target.value)} type="password" value={currentPassword} /></label>
          <label className="system-field"><span>{l("新密码", "New password")}</span><input autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>
          <label className="system-field"><span>{l("再次输入新密码", "Enter new password again")}</span><input autoComplete="new-password" onChange={(event) => setConfirmPassword(event.target.value)} type="password" value={confirmPassword} /></label>
          <div className="system-form-actions"><PrimaryButton disabled={isBusy || !currentPassword || !password || !confirmPassword} type="submit">{l("保存新密码", "Save new password")}</PrimaryButton><SecondaryButton disabled={isBusy} onClick={() => resetForm("summary")}>{l("取消", "Cancel")}</SecondaryButton></div>
        </form>
      ) : (
        <form className="password-protection-form password-protection-disable-form" onSubmit={(event) => void disablePassword(event)}>
          <div className="password-protection-disable-notice">
            <strong>{l("关闭后，启动 Ling 将不再要求密码", "Ling will no longer ask for a password at startup")}</strong>
            <p>{l("本地数据库仍保持加密，密钥改由这台设备的系统安全存储保管。关闭前需要验证当前密码。", "The local database remains encrypted, with its key protected by this device's system secure storage. Your current password is required before disabling it.")}</p>
          </div>
          <label className="system-field">
            <span>{l("当前密码", "Current password")}</span>
            <input autoComplete="current-password" autoFocus inputMode="numeric" onChange={(event) => setCurrentPassword(event.target.value.replace(/\D/gu, ""))} pattern="[0-9]*" type="password" value={currentPassword} />
          </label>
          <div className="system-form-actions">
            <SecondaryButton disabled={isBusy || !currentPassword} tone="danger" type="submit">{isBusy ? l("正在关闭……", "Disabling…") : l("确认关闭密码保护", "Disable password protection")}</SecondaryButton>
            <SecondaryButton disabled={isBusy} onClick={() => resetForm("summary")}>{l("取消", "Cancel")}</SecondaryButton>
          </div>
        </form>
      )}
      {feedback && <p className={`privacy-export-feedback ${feedback.tone}`} role="status">{feedback.message}</p>}
    </SettingSectionCard>
  );
}

function VoiceInputSettingsPanel() {
  const { l } = useLingua();
  const { dirtySections, message, saveVoiceInput, status, updateVoiceInput, voiceInput } = useSettingsStore();
  const [visibleSecret, setVisibleSecret] = useState<"volcengine" | "tencent-id" | "tencent-key" | "aliyun" | null>(null);
  const isBusy = status === "loading" || status === "saving";

  return (
    <div className="system-simple-page voice-settings-page">
      <header className="system-content-header">
        <div>
          <h1>{l("语音输入", "Voice input")}</h1>
          <p>{l("默认使用随 Ling 安装的本地模型；也可以接入你自己的云端语音识别服务。", "Ling uses its bundled local model by default. You can also connect your own cloud speech-recognition service.")}</p>
        </div>
      </header>

      <SettingSectionCard title={l("快捷键", "Shortcut")} description={l("可选。仅在 Ling 窗口处于前台时生效，默认不设置，避免与系统或其他应用冲突。", "Optional. It works only while the Ling window is active and is unset by default to avoid conflicts with the system or other apps.")}>
        <VoiceShortcutRecorder
          onChange={(shortcut) => updateVoiceInput({ shortcut })}
          value={voiceInput.shortcut}
        />
      </SettingSectionCard>

      <SettingSectionCard title={l("识别服务", "Recognition service")} description={l("选择后，下一次语音输入将使用对应服务。云端服务需要单独开通并由你的服务商账号承担费用。", "Your next voice input will use the selected service. Cloud services require a separate account and may charge your provider account.")}>
        <div className="voice-provider-options" role="radiogroup" aria-label={l("语音识别方式", "Speech-recognition service")}>
          <button aria-checked={voiceInput.provider === "local"} className={voiceInput.provider === "local" ? "voice-provider-option selected" : "voice-provider-option"} onClick={() => updateVoiceInput({ provider: "local" })} role="radio" type="button">
            <strong>{l("内置本地模型", "Built-in local model")} <span>{l("默认", "Default")}</span></strong>
            <small>{l("X-ASR 流式中英识别，约 175 MB 已包含在安装包中；离线运行，录音不上传。", "X-ASR streaming recognition for Chinese and English. About 175 MB is included with Ling; it runs offline and does not upload recordings.")}</small>
          </button>
          <button aria-checked={voiceInput.provider === "volcengine"} className={voiceInput.provider === "volcengine" ? "voice-provider-option selected" : "voice-provider-option"} onClick={() => updateVoiceInput({ provider: "volcengine" })} role="radio" type="button">
            <strong>{l("火山引擎", "Volcengine")} <span>Seed-ASR</span></strong>
            <small>{l("火山引擎流式语音识别大模型，使用 App ID 和 Access Token 鉴权。", "Volcengine streaming speech recognition, authenticated with an App ID and Access Token.")}</small>
          </button>
          <button aria-checked={voiceInput.provider === "tencent"} className={voiceInput.provider === "tencent" ? "voice-provider-option selected" : "voice-provider-option"} onClick={() => updateVoiceInput({ provider: "tencent" })} role="radio" type="button">
            <strong>{l("腾讯云", "Tencent Cloud")} <span>{l("实时 ASR", "Real-time ASR")}</span></strong>
            <small>{l("腾讯云实时语音识别 V2，通过 AppID、SecretID 和 SecretKey 接入。", "Tencent Cloud Real-time Speech Recognition V2, connected with AppID, SecretID, and SecretKey.")}</small>
          </button>
          <button aria-checked={voiceInput.provider === "aliyun"} className={voiceInput.provider === "aliyun" ? "voice-provider-option selected" : "voice-provider-option"} onClick={() => updateVoiceInput({ provider: "aliyun" })} role="radio" type="button">
            <strong>{l("阿里云百炼", "Alibaba Cloud Model Studio")} <span>Fun-ASR</span></strong>
            <small>{l("百炼实时语音识别，通过工作空间和 DashScope API Key 接入。", "Model Studio real-time speech recognition, connected with a workspace and DashScope API key.")}</small>
          </button>
        </div>
      </SettingSectionCard>

      {voiceInput.provider === "volcengine" && (
        <SettingSectionCard title={l("火山引擎 · Seed-ASR 配置", "Volcengine · Seed-ASR configuration")} description={l("推荐 Seed-ASR 2.0 小时版。请先在火山引擎语音技术控制台开通对应资源。", "Seed-ASR 2.0 Hourly is recommended. Enable the corresponding resource in the Volcengine Speech Technology console first.")}>
          <div className="system-form-grid two">
            <TextInput label="App ID" onChange={(appId) => updateVoiceInput({ doubao: { appId } })} placeholder={l("在火山引擎语音技术控制台查看", "Find this in the Volcengine Speech Technology console")} value={voiceInput.doubao.appId} />
            <label className="system-field">
              <span>Access Token</span>
              <span className="api-key-input-wrap">
                <input autoComplete="off" onChange={(event) => updateVoiceInput({ doubao: { accessToken: event.target.value } })} placeholder={voiceInput.doubao.accessTokenSaved ? `${l("已保存", "Saved")} ${voiceInput.doubao.accessTokenPreview ?? ""}` : l("输入 Access Token", "Enter Access Token")} type={visibleSecret === "volcengine" ? "text" : "password"} value={voiceInput.doubao.accessToken ?? ""} />
                <button aria-label={visibleSecret === "volcengine" ? l("隐藏 Access Token", "Hide Access Token") : l("显示 Access Token", "Show Access Token")} className="api-key-visibility-button" onClick={() => setVisibleSecret((value) => value === "volcengine" ? null : "volcengine")} type="button">
                  <SystemIcon name={visibleSecret === "volcengine" ? "eyeOff" : "eye"} />
                </button>
              </span>
            </label>
          </div>
          <label className="system-field wide voice-model-select">
            <span>{l("资源规格", "Resource tier")}</span>
            <select onChange={(event) => updateVoiceInput({ doubao: { model: event.target.value as typeof voiceInput.doubao.model } })} value={voiceInput.doubao.model}>
              <option value="seed-asr-2.0-hourly">{l("Seed-ASR 2.0 小时版（推荐 · volc.seedasr.sauc.duration）", "Seed-ASR 2.0 Hourly (recommended · volc.seedasr.sauc.duration)")}</option>
              <option value="seed-asr-1.0-hourly">{l("大模型 ASR 1.0 小时版（volc.bigasr.sauc.duration）", "Large-model ASR 1.0 Hourly (volc.bigasr.sauc.duration)")}</option>
              <option value="seed-asr-1.0-concurrent">{l("大模型 ASR 1.0 并发版（volc.bigasr.sauc.concurrent）", "Large-model ASR 1.0 Concurrent (volc.bigasr.sauc.concurrent)")}</option>
            </select>
          </label>
          <div className="system-truth-note">
            {l("Access Token 只保存在本机独立的凭据存储中。使用时，实时音频和鉴权信息会发送给火山引擎。", "The Access Token is stored only in this device's credential store. During use, live audio and authentication information are sent to Volcengine.")}
          </div>
        </SettingSectionCard>
      )}

      {voiceInput.provider === "tencent" && (
        <SettingSectionCard title={l("腾讯云 · 实时语音识别配置", "Tencent Cloud · Real-time speech recognition")} description={l("对应腾讯云实时语音识别 V2（WebSocket）接口。请先开通语音识别服务并创建 API 密钥。", "Uses Tencent Cloud Real-time Speech Recognition V2 over WebSocket. Enable the service and create API credentials first.")}>
          <div className="system-form-grid two">
            <TextInput label="AppID" onChange={(appId) => updateVoiceInput({ tencent: { appId } })} placeholder={l("腾讯云账号的 AppID", "AppID for your Tencent Cloud account")} value={voiceInput.tencent.appId} />
            <SecretInput
              label="SecretID"
              onChange={(secretId) => updateVoiceInput({ tencent: { secretId } })}
              onToggle={() => setVisibleSecret((value) => value === "tencent-id" ? null : "tencent-id")}
              placeholder={voiceInput.tencent.secretIdSaved ? `${l("已保存", "Saved")} ${voiceInput.tencent.secretIdPreview ?? ""}` : l("输入 SecretID", "Enter SecretID")}
              value={voiceInput.tencent.secretId ?? ""}
              visible={visibleSecret === "tencent-id"}
            />
            <SecretInput
              label="SecretKey"
              onChange={(secretKey) => updateVoiceInput({ tencent: { secretKey } })}
              onToggle={() => setVisibleSecret((value) => value === "tencent-key" ? null : "tencent-key")}
              placeholder={voiceInput.tencent.secretKeySaved ? `${l("已保存", "Saved")} ${voiceInput.tencent.secretKeyPreview ?? ""}` : l("输入 SecretKey", "Enter SecretKey")}
              value={voiceInput.tencent.secretKey ?? ""}
              visible={visibleSecret === "tencent-key"}
            />
            <label className="system-field">
              <span>{l("引擎类型", "Engine type")}</span>
              <select onChange={(event) => updateVoiceInput({ tencent: { model: event.target.value as typeof voiceInput.tencent.model } })} value={voiceInput.tencent.model}>
                <option value="16k_zh">{l("16k_zh（中文普通话）", "16k_zh (Mandarin Chinese)")}</option>
              </select>
            </label>
          </div>
          <div className="system-truth-note">
            {l("SecretID 和 SecretKey 只保存在本机独立的凭据存储中。使用时，实时音频和签名鉴权信息会发送给腾讯云。", "SecretID and SecretKey are stored only in this device's credential store. During use, live audio and signed authentication information are sent to Tencent Cloud.")}
          </div>
        </SettingSectionCard>
      )}

      {voiceInput.provider === "aliyun" && (
        <SettingSectionCard title={l("阿里云百炼 · 实时语音识别配置", "Alibaba Cloud Model Studio · Real-time speech recognition")} description={l("对应百炼 WebSocket 实时语音识别接口。API Key 必须与所选地域的工作空间一致。", "Uses the Model Studio real-time WebSocket API. The API key must belong to a workspace in the selected region.")}>
          <div className="system-form-grid two">
            <SecretInput
              label="DashScope API Key"
              onChange={(apiKey) => updateVoiceInput({ aliyun: { apiKey } })}
              onToggle={() => setVisibleSecret((value) => value === "aliyun" ? null : "aliyun")}
              placeholder={voiceInput.aliyun.apiKeySaved ? `${l("已保存", "Saved")} ${voiceInput.aliyun.apiKeyPreview ?? ""}` : l("输入 DashScope API Key", "Enter DashScope API key")}
              value={voiceInput.aliyun.apiKey ?? ""}
              visible={visibleSecret === "aliyun"}
            />
            <TextInput label="Workspace ID" onChange={(workspaceId) => updateVoiceInput({ aliyun: { workspaceId } })} placeholder={l("百炼工作空间 ID", "Model Studio workspace ID")} value={voiceInput.aliyun.workspaceId} />
            <label className="system-field">
              <span>{l("地域", "Region")}</span>
              <select onChange={(event) => updateVoiceInput({ aliyun: { region: event.target.value as typeof voiceInput.aliyun.region } })} value={voiceInput.aliyun.region}>
                <option value="beijing">{l("中国（北京）", "China (Beijing)")}</option>
                <option value="singapore">{l("新加坡", "Singapore")}</option>
              </select>
            </label>
            <label className="system-field">
              <span>{l("实时模型", "Real-time model")}</span>
              <select onChange={(event) => updateVoiceInput({ aliyun: { model: event.target.value as typeof voiceInput.aliyun.model } })} value={voiceInput.aliyun.model}>
                <option value="fun-asr-realtime">{l("fun-asr-realtime（推荐）", "fun-asr-realtime (recommended)")}</option>
                <option value="qwen3-asr-flash-realtime">qwen3-asr-flash-realtime</option>
              </select>
            </label>
          </div>
          <div className="system-truth-note">
            {l("API Key 只保存在本机独立的凭据存储中。使用时，实时音频和鉴权信息会发送给阿里云百炼。", "The API key is stored only in this device's credential store. During use, live audio and authentication information are sent to Alibaba Cloud Model Studio.")}
          </div>
        </SettingSectionCard>
      )}

      <div className="voice-settings-actions">
        <PrimaryButton disabled={isBusy || !dirtySections.voice} onClick={() => void saveVoiceInput()}>
          {status === "saving" ? l("正在保存……", "Saving…") : dirtySections.voice ? l("保存语音设置", "Save voice settings") : l("语音设置已保存", "Voice settings saved")}
        </PrimaryButton>
      </div>
      {message && <p className="system-feedback">{message}</p>}
    </div>
  );
}

function VoiceShortcutRecorder({
  onChange,
  value
}: {
  onChange: (shortcut: string) => void;
  value: string;
}) {
  const { locale, l } = useLingua();
  const [isRecording, setIsRecording] = useState(false);
  const [hint, setHint] = useState("");

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isRecording) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setIsRecording(false);
      setHint("");
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      onChange("");
      setIsRecording(false);
      setHint("");
      return;
    }
    const shortcut = voiceShortcutFromEvent(event.nativeEvent);
    if (!shortcut) {
      setHint(l("请使用 ⌘、Control 或 Option 搭配字母、数字，也可以直接使用 F1–F12。", "Use ⌘, Control, or Option with a letter or number, or use F1–F12 on its own."));
      return;
    }
    onChange(shortcut);
    setIsRecording(false);
    setHint("");
  };

  return (
    <div className="voice-shortcut-setting">
      <div className="voice-shortcut-copy">
        <strong>{l("开始或停止语音输入", "Start or stop voice input")}</strong>
        <small>{l("按一次开始，再按一次停止。Fn 单键无法被桌面应用稳定识别，因此不作为可选快捷键。", "Press once to start and again to stop. Desktop apps cannot reliably detect Fn by itself, so it is not available as a shortcut.")}</small>
      </div>
      <button
        aria-label={l("设置语音输入快捷键", "Set the voice-input shortcut")}
        className={`voice-shortcut-recorder${isRecording ? " recording" : ""}`}
        onBlur={() => setIsRecording(false)}
        onClick={() => {
          setIsRecording(true);
          setHint("");
        }}
        onKeyDown={onKeyDown}
        type="button"
      >
        {isRecording ? l("请按下组合键…", "Press a key combination…") : formatVoiceShortcut(value, locale)}
      </button>
      {value && !isRecording && (
        <button className="voice-shortcut-clear" onClick={() => onChange("")} type="button">
          {l("清除", "Clear")}
        </button>
      )}
      {hint && <p className="voice-shortcut-hint" role="status">{hint}</p>}
    </div>
  );
}

function SecretInput({
  label,
  onChange,
  onToggle,
  placeholder,
  value,
  visible
}: {
  label: string;
  onChange: (value: string) => void;
  onToggle: () => void;
  placeholder: string;
  value: string;
  visible: boolean;
}) {
  const { l } = useLingua();
  return (
    <label className="system-field">
      <span>{label}</span>
      <span className="api-key-input-wrap">
        <input autoComplete="off" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={visible ? "text" : "password"} value={value} />
        <button aria-label={visible ? l(`隐藏 ${label}`, `Hide ${label}`) : l(`显示 ${label}`, `Show ${label}`)} className="api-key-visibility-button" onClick={onToggle} type="button">
          <SystemIcon name={visible ? "eyeOff" : "eye"} />
        </button>
      </span>
    </label>
  );
}

export function SystemSettingsNavigation({
  activeTab,
  onTabChange
}: {
  activeTab: SystemSettingsTab;
  onTabChange: (tab: SystemSettingsTab) => void;
}) {
  const { locale, l } = useLingua();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);

  useEffect(() => {
    void window.lingDesktop?.getAppInfo?.().then((result) => {
      if (result.ok) setAppVersion(result.data.version);
    });
  }, []);

  useEffect(() => {
    const updates = window.lingDesktop?.updates;
    if (!updates) return;
    let cancelled = false;
    void updates.getStatus().then((result) => {
      if (!cancelled && result.ok) setUpdateStatus(result.data);
    });
    const unsubscribe = updates.onStatusChanged((status) => {
      if (!cancelled) setUpdateStatus(status);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  async function handleUpdateAction() {
    const updates = window.lingDesktop?.updates;
    if (!updates || !updateStatus) return;
    if (updateStatus.state === "available") {
      await updates.openDownloadPage();
      return;
    }
    const result = await updates.check();
    if (result.ok) setUpdateStatus(result.data);
  }

  const updateActionLabel = updateStatus && updateStatus.state !== "disabled"
    ? getUpdateActionLabel(updateStatus, locale)
    : null;
  const updateActionDisabled = updateStatus?.state === "checking";

  return (
    <nav aria-label={l("Ling 设置分类", "Ling settings categories")} className="system-category-nav">
      {systemTabs.map((tab) => (
        <button
          className={tab.id === activeTab ? "system-category-item active" : "system-category-item"}
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          type="button"
        >
          <SystemIcon name={tab.icon} />
          <span>
            <strong>{tab.label[locale === "en-US" ? 1 : 0]}</strong>
            <small>{tab.description[locale === "en-US" ? 1 : 0]}</small>
          </span>
        </button>
      ))}
      {appVersion && (
        <div className="system-app-update">
          <p className="system-app-version">Ling · v{appVersion}</p>
          {updateActionLabel && (
            <button
              className="system-update-button"
              disabled={updateActionDisabled}
              onClick={() => void handleUpdateAction()}
              type="button"
            >
              {updateActionLabel}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}

function getUpdateActionLabel(status: AppUpdateStatus, locale: SupportedLocale) {
  const english = locale === "en-US";
  switch (status.state) {
    case "checking":
      return english ? "Checking for updates…" : "正在检查更新…";
    case "up-to-date":
      return english ? "Up to date · Check again" : "已是最新版 · 再次检查";
    case "available":
      return english
        ? `New v${status.availableVersion ?? ""} · Official download`
        : `新版本 v${status.availableVersion ?? ""} · 前往官网下载`;
    case "error":
      return english ? "Update failed · Try again" : "更新失败 · 重试";
    default:
      return english ? "Check for updates" : "检查更新";
  }
}

export function SettingsSystemPage({
  activeTab: controlledActiveTab,
  onTabChange,
  showNavigation = true
}: {
  activeTab?: SystemSettingsTab;
  onTabChange?: (tab: SystemSettingsTab) => void;
  showNavigation?: boolean;
} = {}) {
  const [internalActiveTab, setInternalActiveTab] = useState<SystemSettingsTab>("model");
  const clearMessage = useSettingsStore((state) => state.clearMessage);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const activeTab = controlledActiveTab ?? internalActiveTab;

  function handleTabChange(tab: SystemSettingsTab) {
    if (onTabChange) onTabChange(tab);
    else setInternalActiveTab(tab);
  }

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    clearMessage();
  }, [activeTab, clearMessage]);

  return (
    <section className={showNavigation ? "settings-system-page" : "settings-system-page navigationless"}>
      {showNavigation && (
        <aside className="system-category-panel">
          <SystemSettingsNavigation activeTab={activeTab} onTabChange={handleTabChange} />
        </aside>
      )}

      <main className="system-content-panel">
        <div className="system-content-transition" key={activeTab}>
          {activeTab === "profile" && <ProfileSettings />}
          {activeTab === "model" && <ModelAccessSettings />}
          {activeTab === "usage" && <UsageSettings />}
          {activeTab === "voice" && <VoiceInputSettingsPanel />}
          {activeTab === "counseling" && <CounselingSettings />}
          {activeTab === "extensions" && <CounselorExtensionsSettings />}
          {activeTab === "appearance" && <AppearanceSettings />}
          {activeTab === "privacy" && <PrivacySettings />}
        </div>
      </main>
    </section>
  );
}
