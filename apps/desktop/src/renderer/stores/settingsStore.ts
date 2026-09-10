import { create } from "zustand";
import type {
  ApiSettings,
  BackstageModelSettings,
  CounselingExperienceSettings,
  ModelAssignments,
  ModelInfo,
  ReadingAppearanceSettings,
  SupportedLocale,
  UserProfileSettings,
  UserSettings,
  VoiceInputSettings
} from "@shared/index";
import { isSupportedLocale, localize, readInitialLocale, rememberLocale } from "../localization";
import { getDefaultModelReasoningEffort } from "@core/providers/modelCapabilities";

type SettingsStatus = "idle" | "loading" | "saving" | "testing" | "saved" | "error";
type ConnectionStatus = "idle" | "success" | "failed";
type ModelListStatus = "idle" | "loading" | "loaded" | "empty" | "failed";
type SettingsSection = "model" | "voice" | "profile" | "counseling" | "appearance";
type DirtySections = Record<SettingsSection, boolean>;

interface SettingsState {
  api: ApiSettings;
  backstageModels: BackstageModelSettings;
  availableModels: ModelInfo[];
  appearance: ReadingAppearanceSettings;
  counseling: CounselingExperienceSettings;
  voiceInput: VoiceInputSettings;
  locale: SupportedLocale;
  defaultCounselorId: string;
  disabledCounselorIds: string[];
  defaultRoomThemeId: string;
  profile: UserProfileSettings;
  savedApi: ApiSettings;
  savedBackstageModels: BackstageModelSettings;
  savedAppearance: ReadingAppearanceSettings;
  savedCounseling: CounselingExperienceSettings;
  savedVoiceInput: VoiceInputSettings;
  savedLocale: SupportedLocale;
  savedProfile: UserProfileSettings;
  dirtySections: DirtySections;
  status: SettingsStatus;
  connectionStatus: ConnectionStatus;
  modelListStatus: ModelListStatus;
  message: string;
  updateApi: (api: Partial<ApiSettings>) => void;
  updateAppearance: (appearance: Partial<ReadingAppearanceSettings>) => void;
  updateBackstageModels: (backstageModels: Partial<BackstageModelSettings>) => void;
  updateCounseling: (counseling: Partial<CounselingExperienceSettings>) => void;
  updateVoiceInput: (
    voiceInput: Partial<Omit<VoiceInputSettings, "doubao" | "tencent" | "aliyun">> & {
      doubao?: Partial<VoiceInputSettings["doubao"]>;
      tencent?: Partial<VoiceInputSettings["tencent"]>;
      aliyun?: Partial<VoiceInputSettings["aliyun"]>;
    }
  ) => void;
  updateLocale: (locale: SupportedLocale) => void;
  updateDefaultCounselor: (id: string) => Promise<void>;
  updateDisabledCounselors: (ids: string[]) => Promise<boolean>;
  updateProfile: (profile: Partial<UserProfileSettings>) => void;
  loadSettings: () => Promise<UserSettings | null>;
  loadModels: () => Promise<void>;
  saveSettings: () => Promise<void>;
  saveAppearance: () => Promise<void>;
  saveCounseling: () => Promise<void>;
  saveVoiceInput: () => Promise<void>;
  saveLocale: (locale: SupportedLocale) => Promise<void>;
  saveProfile: () => Promise<void>;
  restoreRecommendedSettings: () => Promise<void>;
  testConnection: () => Promise<void>;
  deleteApiKey: () => Promise<void>;
  discardUnsavedChanges: () => void;
  clearMessage: () => void;
}

const defaultApi: ApiSettings = {
  connectionKind: "remote",
  localRuntime: "ollama",
  remoteProvider: "deepseek",
  apiBaseUrl: "https://api.deepseek.com",
  apiKey: "",
  modelName: "deepseek-flash",
  reasoningEffort: "high",
  localApiBaseUrl: "http://127.0.0.1:11434/v1",
  localModelName: "",
  remoteApiBaseUrl: "https://api.deepseek.com",
  remoteModelName: "deepseek-flash",
  modelAssignments: {
    conversation: "deepseek-flash",
    caseConceptualization: "deepseek-flash",
    consultationTeam: "deepseek-flash"
  }
};

const defaultBackstageModels: BackstageModelSettings = {};

const defaultCounseling: CounselingExperienceSettings = {
  bringPastUnderstandingToNewSessions: true
};

export const defaultVoiceInput: VoiceInputSettings = {
  provider: "local",
  shortcut: "",
  doubao: {
    appId: "",
    accessToken: "",
    model: "seed-asr-2.0-hourly"
  },
  tencent: {
    appId: "",
    secretId: "",
    secretKey: "",
    model: "16k_zh"
  },
  aliyun: {
    apiKey: "",
    model: "fun-asr-realtime",
    region: "beijing",
    workspaceId: ""
  }
};

export const defaultReadingAppearance: ReadingAppearanceSettings = {
  textSize: "standard",
  lineSpacing: "standard",
  cursorTheme: "d"
};

export const defaultDeepSeekModels: ModelInfo[] = [
  { id: "deepseek-flash", name: "DeepSeek V4.1 Flash", ownedBy: "deepseek" }
];

const defaultProfile: UserProfileSettings = {
  displayName: "",
  background: ""
};

const defaultCounselorId = "chengling";
const defaultRoomThemeId = "warm-study";
const initialLocale = readInitialLocale();

function settingsCopy(zhCN: string, enUS: string) {
  return localize(useSettingsStore.getState().locale, zhCN, enUS);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  api: {
    ...defaultApi
  },
  backstageModels: {
    ...defaultBackstageModels
  },
  availableModels: [...defaultDeepSeekModels],
  appearance: { ...defaultReadingAppearance },
  counseling: {
    ...defaultCounseling
  },
  voiceInput: structuredClone(defaultVoiceInput),
  locale: initialLocale,
  defaultCounselorId,
  disabledCounselorIds: [],
  defaultRoomThemeId,
  profile: {
    ...defaultProfile
  },
  savedApi: { ...defaultApi },
  savedBackstageModels: { ...defaultBackstageModels },
  savedAppearance: { ...defaultReadingAppearance },
  savedCounseling: { ...defaultCounseling },
  savedVoiceInput: structuredClone(defaultVoiceInput),
  savedLocale: initialLocale,
  savedProfile: { ...defaultProfile },
  dirtySections: { model: false, voice: false, profile: false, counseling: false, appearance: false },
  status: "idle",
  connectionStatus: "idle",
  modelListStatus: "idle",
  message: "",
  clearMessage: () => set({ message: "" }),
  updateApi: (api) =>
    set((state) => ({
      api: { ...state.api, ...api },
      connectionStatus: "idle",
      dirtySections: { ...state.dirtySections, model: true },
      status: state.status === "testing" || state.status === "saving" ? state.status : "idle",
      message: ""
    })),
  updateAppearance: (appearance) =>
    set((state) => ({
      appearance: { ...state.appearance, ...appearance },
      dirtySections: { ...state.dirtySections, appearance: true },
      status: "idle",
      message: ""
    })),
  updateBackstageModels: (backstageModels) =>
    set((state) => ({
      backstageModels: { ...state.backstageModels, ...backstageModels },
      dirtySections: { ...state.dirtySections, model: true },
      status: "idle",
      message: ""
    })),
  updateCounseling: (counseling) =>
    set((state) => ({
      counseling: { ...state.counseling, ...counseling },
      dirtySections: { ...state.dirtySections, counseling: true },
      status: "idle",
      message: ""
    })),
  updateVoiceInput: (voiceInput) =>
    set((state) => ({
      voiceInput: {
        ...state.voiceInput,
        ...voiceInput,
        doubao: { ...state.voiceInput.doubao, ...voiceInput.doubao },
        tencent: { ...state.voiceInput.tencent, ...voiceInput.tencent },
        aliyun: { ...state.voiceInput.aliyun, ...voiceInput.aliyun }
      },
      dirtySections: { ...state.dirtySections, voice: true },
      status: "idle",
      message: ""
    })),
  updateLocale: (locale) => {
    rememberLocale(locale);
    set({
      locale,
      status: "idle",
      message: ""
    });
  },
  updateDefaultCounselor: async (id) => {
    const previous = get().defaultCounselorId;
    set({ defaultCounselorId: id, message: "" });
    if (!window.lingDesktop?.settings) return;
    const result = await writeSettingsPatch({ defaultCounselorId: id });
    if (!result.ok) {
      set({ defaultCounselorId: get().defaultCounselorId === id ? previous : get().defaultCounselorId, status: "error", message: result.message });
    }
  },
  updateDisabledCounselors: async (ids) => {
    const previous = get().disabledCounselorIds;
    const disabledCounselorIds = [...new Set(ids)].sort();
    set({ disabledCounselorIds, message: "" });
    if (!window.lingDesktop?.settings) return true;
    const result = await writeSettingsPatch({ disabledCounselorIds });
    if (!result.ok) {
      set({ disabledCounselorIds: get().disabledCounselorIds === disabledCounselorIds ? previous : get().disabledCounselorIds, status: "error", message: result.message });
      return false;
    }
    return true;
  },
  updateProfile: (profile) =>
    set((state) => ({
      profile: { ...state.profile, ...profile },
      dirtySections: { ...state.dirtySections, profile: true },
      status: "idle",
      message: ""
    })),
  loadSettings: async () => {
    if (!window.lingDesktop?.settings) return null;
    set({ status: "loading", message: "" });
    try {
      const result = await window.lingDesktop.settings.read();
      if (!result.ok) {
        set({ status: "error", message: result.error.message });
        return null;
      }
      if (result.data) {
        const locale = isSupportedLocale(result.data.locale) ? result.data.locale : "zh-CN";
        rememberLocale(locale);
        set({
          api: normalizeApiSettings(result.data.api),
          savedApi: normalizeApiSettings(result.data.api),
          savedBackstageModels: { ...defaultBackstageModels, ...result.data.backstageModels },
          backstageModels: { ...defaultBackstageModels, ...result.data.backstageModels },
          appearance: normalizeAppearanceSettings(result.data.appearance),
          savedAppearance: normalizeAppearanceSettings(result.data.appearance),
          counseling: normalizeCounselingSettings(result.data.counseling),
          savedCounseling: normalizeCounselingSettings(result.data.counseling),
          voiceInput: normalizeVoiceInputSettings(result.data.voiceInput),
          savedVoiceInput: normalizeVoiceInputSettings(result.data.voiceInput),
          locale,
          savedLocale: locale,
          defaultCounselorId: result.data.defaultCounselorId,
          disabledCounselorIds: result.data.disabledCounselorIds ?? [],
          defaultRoomThemeId: result.data.defaultRoomThemeId,
          profile: { ...defaultProfile, ...result.data.profile },
          savedProfile: { ...defaultProfile, ...result.data.profile },
          dirtySections: { model: false, voice: false, profile: false, counseling: false, appearance: false },
          status: "idle"
        });
        return result.data;
      }
      set({ status: "idle" });
      return null;
    } catch {
      set({ status: "error", message: settingsCopy("设置读取失败，请重试。现有设置没有被修改。", "Settings could not be loaded. Please try again. Existing settings were not changed.") });
      return null;
    }
  },
  loadModels: async () => {
    if (!window.lingDesktop?.settings?.listModels) {
      set({
        modelListStatus: "failed",
        message: settingsCopy("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app.")
      });
      return;
    }
    if (get().modelListStatus === "loading" || get().status === "saving" || get().status === "testing") return;
    const requestedApi = get().api;
    set({ modelListStatus: "loading", message: "" });
    try {
      const result = await window.lingDesktop.settings.listModels(requestedApi);
      if (get().api !== requestedApi) {
        set({ modelListStatus: "idle" });
        return;
      }
      if (!result.ok) {
        set({ modelListStatus: "failed", message: result.error.message });
        return;
      }
      if (result.data.source !== "remote") {
        set({ modelListStatus: result.data.source === "empty" ? "empty" : "failed", message: result.data.message });
        return;
      }
      // A successful response is authoritative, including an empty model list.
      const nextModels = result.data.models;
      set((state) => ({
        availableModels: nextModels,
        api: nextModels.length === 0 || nextModels.some((model) => model.id === state.api.modelName)
          ? state.api
          : normalizeApiSettings({
              ...state.api,
              modelName: nextModels[0]?.id ?? state.api.modelName,
              ...(state.api.connectionKind === "local"
                ? { localModelName: nextModels[0]?.id ?? state.api.modelName }
                : { remoteModelName: nextModels[0]?.id ?? state.api.modelName }),
              modelAssignments: {
                ...state.api.modelAssignments,
                conversation: nextModels[0]?.id ?? state.api.modelName
              }
            }),
        dirtySections: {
          ...state.dirtySections,
          model:
            state.dirtySections.model ||
            (nextModels.length > 0 && !nextModels.some((model) => model.id === state.api.modelName))
        },
        connectionStatus: nextModels.length === 0 || nextModels.some((model) => model.id === state.api.modelName) ? state.connectionStatus : "idle",
        modelListStatus: nextModels.length > 0 ? "loaded" : "empty",
        message: result.data.message
      }));
    } catch {
      if (get().api !== requestedApi) {
        set({ modelListStatus: "idle" });
        return;
      }
      set({ modelListStatus: "failed", message: settingsCopy("读取模型失败，请重试。", "Could not load models. Please try again.") });
    }
  },
  saveSettings: async () => {
    if (get().status === "saving" || get().status === "testing" || get().modelListStatus === "loading") return;
    const requestedApi = get().api;
    const requestedBackstage = get().backstageModels;
    set({ status: "saving", message: "" });
    const result = await writeSettingsPatch({ api: requestedApi, backstageModels: requestedBackstage }, true);
    if (!result.ok) {
      set({ status: "error", message: result.message });
      return;
    }
    const savedApi = result.refreshed?.api ? normalizeApiSettings(result.refreshed.api) : {
      ...requestedApi,
      apiKey: "",
      apiKeySaved: Boolean(requestedApi.apiKey?.trim()) || Boolean(requestedApi.apiKeySaved),
      apiKeyPreview: requestedApi.apiKey?.trim() ? undefined : requestedApi.apiKeyPreview
    };
    const unchanged = get().api === requestedApi;
    set({
      api: unchanged ? savedApi : get().api,
      savedApi,
      savedBackstageModels: requestedBackstage,
      dirtySections: { ...get().dirtySections, model: !unchanged || get().backstageModels !== requestedBackstage },
      status: "saved",
      message: settingsCopy("配置已保存。", "Configuration saved.")
    });
  },
  saveAppearance: async () => {
    const requested = get().appearance;
    set({ status: "saving", message: "" });
    const result = await writeSettingsPatch({ appearance: requested });
    if (!result.ok) { set({ status: "error", message: result.message }); return; }
    set({ savedAppearance: requested, dirtySections: { ...get().dirtySections, appearance: get().appearance !== requested }, status: "saved", message: settingsCopy("界面设置已保存在这台设备上。", "Display settings were saved on this device.") });
  },
  saveCounseling: async () => {
    const requested = get().counseling;
    set({ status: "saving", message: "" });
    const result = await writeSettingsPatch({ counseling: requested });
    if (!result.ok) { set({ status: "error", message: result.message }); return; }
    set({ savedCounseling: requested, dirtySections: { ...get().dirtySections, counseling: get().counseling !== requested }, status: "saved", message: settingsCopy("连续性设置已保存。", "Counseling continuity settings saved.") });
  },
  saveLocale: async (locale) => {
    rememberLocale(locale);
    set({ locale });
    if (!window.lingDesktop?.settings) { set({ savedLocale: locale }); return; }
    const result = await writeSettingsPatch({ locale });
    if (!result.ok) {
      if (get().locale === locale) {
        rememberLocale(get().savedLocale);
        set({ locale: get().savedLocale });
      }
      set({ status: "error", message: result.message });
      return;
    }
    set({ savedLocale: locale });
  },
  saveProfile: async () => {
    const profile = get().profile;
    const locale = get().locale;
    set({ status: "saving", message: "" });
    const result = await writeSettingsPatch({ profile, locale });
    if (!result.ok) { set({ status: "error", message: result.message }); return; }
    set({ savedLocale: locale, savedProfile: profile, dirtySections: { ...get().dirtySections, profile: get().profile !== profile }, status: "saved", message: settingsCopy("个人资料已保存在这台设备上。", "Your profile was saved on this device.") });
  },
  restoreRecommendedSettings: async () => {
    const requested = get();
    set({ status: "saving", message: "" });
    const result = await writeSettingsPatch((base) => ({
      api: normalizeApiSettings({
        ...base.api,
        ...(base.api.connectionKind !== "local" && inferRemoteProvider(base.api.remoteProvider, base.api.apiBaseUrl) === "deepseek"
          ? { modelName: defaultApi.modelName, remoteModelName: defaultApi.modelName, modelAssignments: defaultApi.modelAssignments }
          : {})
      }),
      appearance: { ...defaultReadingAppearance },
      counseling: { ...defaultCounseling },
      backstageModels: { ...defaultBackstageModels }
    }));
    if (!result.ok) { set({ status: "error", message: result.message }); return; }
    const api = normalizeApiSettings(result.written.api);
    const appearance = normalizeAppearanceSettings(result.written.appearance);
    const counseling = normalizeCounselingSettings(result.written.counseling);
    const backstageModels = result.written.backstageModels ?? {};
    set((state) => ({
      api: state.api === requested.api ? api : state.api,
      savedApi: api,
      appearance: state.appearance === requested.appearance ? appearance : state.appearance,
      savedAppearance: appearance,
      counseling: state.counseling === requested.counseling ? counseling : state.counseling,
      savedCounseling: counseling,
      backstageModels: state.backstageModels === requested.backstageModels ? backstageModels : state.backstageModels,
      savedBackstageModels: backstageModels,
      dirtySections: {
        ...state.dirtySections,
        model: state.api !== requested.api || state.backstageModels !== requested.backstageModels,
        appearance: state.appearance !== requested.appearance,
        counseling: state.counseling !== requested.counseling
      },
      status: "saved",
      connectionStatus: "idle",
      message: settingsCopy("已恢复推荐设置。阅读显示、咨询连续性和模型选择已更新；会谈、来信、备份、个人资料与 API Key 均未改动。", "Recommended settings restored. Reading display, counseling continuity, and model selections were updated; sessions, letters, backups, your profile, and API keys were not changed.")
    }));
  },
  testConnection: async () => {
    if (!window.lingDesktop?.settings) {
      set({ status: "error", connectionStatus: "failed", message: settingsCopy("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app.") });
      return;
    }
    if (get().status === "saving" || get().status === "testing" || get().modelListStatus === "loading") return;
    const requestedApi = get().api;
    set({ status: "testing", connectionStatus: "idle", message: "" });
    try {
      const result = await window.lingDesktop.settings.testConnection(requestedApi);
      if (get().api !== requestedApi) { set({ status: "idle", connectionStatus: "idle" }); return; }
      if (!result.ok) { set({ status: "error", connectionStatus: "failed", message: result.error.message }); return; }
      set({
        status: "idle",
        connectionStatus: result.data.connected ? "success" : "failed",
        message: result.data.connected && get().dirtySections.model
          ? settingsCopy("连接成功。当前修改尚未保存，请点击保存配置。", "Connection successful. Save the configuration to keep these changes.")
          : result.data.message
      });
    } catch {
      if (get().api !== requestedApi) { set({ status: "idle", connectionStatus: "idle" }); return; }
      set({ status: "error", connectionStatus: "failed", message: settingsCopy("测试未完成，请检查网络后重试。", "The test could not finish. Check your network and try again.") });
    }
  },
  deleteApiKey: async () => {
    if (!window.lingDesktop?.settings) {
      set({ status: "error", message: settingsCopy("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app.") });
      return;
    }
    const requestedApi = get().api;
    const bridge = window.lingDesktop.settings;
    set({ status: "saving", message: "" });
    const operation = settingsWriteQueue.then(() => bridge.deleteApiKey());
    settingsWriteQueue = operation.catch(() => undefined);
    try {
      const result = await operation;
      if (!result.ok) { set({ status: "error", message: result.error.message }); return; }
      set({
        api: { ...get().api, apiKey: get().api === requestedApi ? "" : get().api.apiKey, apiKeySaved: false, apiKeyPreview: undefined },
        savedApi: { ...get().savedApi, apiKey: "", apiKeySaved: false, apiKeyPreview: undefined },
        status: "saved",
        connectionStatus: "idle",
        message: settingsCopy("API Key 已删除。", "API key deleted.")
      });
    } catch {
      set({ status: "error", message: settingsCopy("未能确认密钥是否删除，请重新读取设置后重试。", "Could not confirm whether the key was deleted. Reload settings and try again.") });
    }
  },
  saveVoiceInput: async () => {
    if (!window.lingDesktop?.settings) {
      set({ status: "error", message: settingsCopy("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app.") });
      return;
    }
    const voiceInput = get().voiceInput;
    if (voiceInput.provider === "volcengine" && !voiceInput.doubao.appId.trim()) {
      set({ status: "error", message: settingsCopy("请填写火山引擎 App ID。", "Enter the Volcengine App ID.") });
      return;
    }
    if (
      voiceInput.provider === "volcengine" &&
      !voiceInput.doubao.accessToken?.trim() &&
      !voiceInput.doubao.accessTokenSaved
    ) {
      set({ status: "error", message: settingsCopy("请填写火山引擎 Access Token。", "Enter the Volcengine Access Token.") });
      return;
    }
    if (voiceInput.provider === "tencent" && !voiceInput.tencent.appId.trim()) {
      set({ status: "error", message: settingsCopy("请填写腾讯云 AppID。", "Enter the Tencent Cloud AppID.") });
      return;
    }
    if (
      voiceInput.provider === "tencent" &&
      (!voiceInput.tencent.secretId?.trim() && !voiceInput.tencent.secretIdSaved ||
        !voiceInput.tencent.secretKey?.trim() && !voiceInput.tencent.secretKeySaved)
    ) {
      set({ status: "error", message: settingsCopy("请填写腾讯云 SecretID 和 SecretKey。", "Enter the Tencent Cloud SecretID and SecretKey.") });
      return;
    }
    if (
      voiceInput.provider === "aliyun" &&
      (!voiceInput.aliyun.apiKey?.trim() && !voiceInput.aliyun.apiKeySaved)
    ) {
      set({ status: "error", message: settingsCopy("请填写阿里云百炼 API Key。", "Enter the Alibaba Cloud Model Studio API key.") });
      return;
    }
    if (voiceInput.provider === "aliyun" && !voiceInput.aliyun.workspaceId.trim()) {
      set({ status: "error", message: settingsCopy("请填写阿里云百炼 Workspace ID。", "Enter the Alibaba Cloud Model Studio Workspace ID.") });
      return;
    }
    set({ status: "saving", message: "" });
    const result = await writeSettingsPatch({ voiceInput }, true);
    if (!result.ok) { set({ status: "error", message: result.message }); return; }
    const savedVoiceInput = result.refreshed?.voiceInput
      ? normalizeVoiceInputSettings(result.refreshed.voiceInput)
      : normalizeVoiceInputSettings({
          ...voiceInput,
          doubao: {
            ...voiceInput.doubao,
            accessToken: "",
            accessTokenSaved:
              Boolean(voiceInput.doubao.accessToken?.trim()) || voiceInput.doubao.accessTokenSaved
          },
          tencent: {
            ...voiceInput.tencent,
            secretId: "",
            secretIdSaved: Boolean(voiceInput.tencent.secretId?.trim()) || voiceInput.tencent.secretIdSaved,
            secretKey: "",
            secretKeySaved: Boolean(voiceInput.tencent.secretKey?.trim()) || voiceInput.tencent.secretKeySaved
          },
          aliyun: {
            ...voiceInput.aliyun,
            apiKey: "",
            apiKeySaved: Boolean(voiceInput.aliyun.apiKey?.trim()) || voiceInput.aliyun.apiKeySaved
          }
        });
    set({
      voiceInput: get().voiceInput === voiceInput ? savedVoiceInput : get().voiceInput,
      savedVoiceInput,
      dirtySections: { ...get().dirtySections, voice: get().voiceInput !== voiceInput },
      status: "saved",
      message: voiceInput.provider === "local"
        ? settingsCopy("已使用内置本地语音，录音不会上传。", "Built-in local voice input is selected; recordings are not uploaded.")
        : settingsCopy("云端语音识别配置已保存在这台设备上。", "Cloud speech-recognition settings were saved on this device.")
    });
  },
  discardUnsavedChanges: () =>
    set((state) => ({
      api: { ...state.savedApi },
      backstageModels: { ...state.savedBackstageModels },
      connectionStatus: "idle",
      appearance: { ...state.savedAppearance },
      counseling: { ...state.savedCounseling },
      voiceInput: structuredClone(state.savedVoiceInput),
      locale: state.savedLocale,
      profile: { ...state.savedProfile },
      dirtySections: { model: false, voice: false, profile: false, counseling: false, appearance: false },
      message: ""
    }))
}));

let settingsWriteQueue: Promise<unknown> = Promise.resolve();

type SettingsWriteResult = { ok: true; written: UserSettings; refreshed?: UserSettings | null } | { ok: false; message: string };

function writeSettingsPatch(patch: Partial<UserSettings> | ((base: UserSettings) => Partial<UserSettings>), refresh = false): Promise<SettingsWriteResult> {
  const bridge = window.lingDesktop?.settings;
  const operation = settingsWriteQueue.then(async (): Promise<SettingsWriteResult> => {
    if (!bridge) return { ok: false, message: settingsCopy("此功能只能在 Ling 桌面 App 中使用。", "This feature is available only in the Ling desktop app.") };
    try {
      const read = typeof bridge.read === "function" ? await bridge.read() : undefined;
      if (read && !read.ok) return { ok: false, message: read.error.message };
      const base = read?.data ?? createSavedUserSettings(useSettingsStore.getState());
      const written = { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
      const result = await bridge.save(written);
      if (!result.ok) return { ok: false, message: result.error.message };
      if (refresh && typeof bridge.read === "function") {
        try {
          const refreshed = await bridge.read();
          if (refreshed.ok) return { ok: true, written, refreshed: refreshed.data };
        } catch { /* Saving succeeded; retain its sanitized snapshot. */ }
      }
      return { ok: true, written };
    } catch {
      return { ok: false, message: settingsCopy("设置未能保存，请重试。", "Settings could not be saved. Please try again.") };
    }
  });
  settingsWriteQueue = operation;
  return operation;
}

export function resetSettingsStore() {
  useSettingsStore.setState({
    api: { ...defaultApi },
    backstageModels: { ...defaultBackstageModels },
    availableModels: [...defaultDeepSeekModels],
    appearance: { ...defaultReadingAppearance },
    counseling: { ...defaultCounseling },
    voiceInput: structuredClone(defaultVoiceInput),
    locale: "zh-CN",
    defaultCounselorId,
    disabledCounselorIds: [],
    defaultRoomThemeId,
    profile: { ...defaultProfile },
    savedApi: { ...defaultApi },
    savedBackstageModels: { ...defaultBackstageModels },
    savedAppearance: { ...defaultReadingAppearance },
    savedCounseling: { ...defaultCounseling },
    savedVoiceInput: structuredClone(defaultVoiceInput),
    savedLocale: "zh-CN",
    savedProfile: { ...defaultProfile },
    dirtySections: { model: false, voice: false, profile: false, counseling: false, appearance: false },
    status: "idle",
    connectionStatus: "idle",
    modelListStatus: "idle",
    message: ""
  });
}

function createSavedUserSettings(
  state: Pick<SettingsState, "savedApi" | "savedAppearance" | "savedCounseling" | "savedVoiceInput" | "savedLocale" | "savedProfile" | "defaultCounselorId" | "disabledCounselorIds" | "defaultRoomThemeId" | "savedBackstageModels">
): UserSettings {
  return {
    api: state.savedApi,
    appearance: state.savedAppearance,
    backstageModels: state.savedBackstageModels,
    counseling: state.savedCounseling,
    voiceInput: state.savedVoiceInput,
    locale: state.savedLocale,
    defaultCounselorId: state.defaultCounselorId,
    disabledCounselorIds: state.disabledCounselorIds,
    defaultRoomThemeId: state.defaultRoomThemeId,
    profile: state.savedProfile
  };
}

function normalizeVoiceInputSettings(voiceInput: Partial<VoiceInputSettings> | undefined): VoiceInputSettings {
  const legacyProvider = (voiceInput?.provider as string | undefined) === "doubao"
    ? "volcengine"
    : voiceInput?.provider;
  return {
    provider:
      legacyProvider === "volcengine" || legacyProvider === "tencent" || legacyProvider === "aliyun"
        ? legacyProvider
        : "local",
    shortcut: typeof voiceInput?.shortcut === "string" ? voiceInput.shortcut : "",
    doubao: {
      ...defaultVoiceInput.doubao,
      ...voiceInput?.doubao,
      accessToken: voiceInput?.doubao?.accessToken ?? "",
      model:
        voiceInput?.doubao?.model === "seed-asr-1.0-hourly" ||
        voiceInput?.doubao?.model === "seed-asr-1.0-concurrent"
          ? voiceInput.doubao.model
          : "seed-asr-2.0-hourly"
    },
    tencent: {
      ...defaultVoiceInput.tencent,
      ...voiceInput?.tencent,
      secretId: voiceInput?.tencent?.secretId ?? "",
      secretKey: voiceInput?.tencent?.secretKey ?? "",
      model: "16k_zh"
    },
    aliyun: {
      ...defaultVoiceInput.aliyun,
      ...voiceInput?.aliyun,
      apiKey: voiceInput?.aliyun?.apiKey ?? "",
      model:
        voiceInput?.aliyun?.model === "qwen3-asr-flash-realtime"
          ? "qwen3-asr-flash-realtime"
          : "fun-asr-realtime",
      region: voiceInput?.aliyun?.region === "singapore" ? "singapore" : "beijing"
    }
  };
}

function normalizeApiSettings(api: ApiSettings): ApiSettings {
  const connectionKind = api.connectionKind === "local" ? "local" : "remote";
  const modelName = api.modelName || (connectionKind === "local" ? api.localModelName ?? "" : defaultApi.modelName);
  const defaultAssignments = defaultApi.modelAssignments as ModelAssignments;
  const remoteProvider = inferRemoteProvider(api.remoteProvider, api.remoteApiBaseUrl || api.apiBaseUrl);
  const reasoningEffort = api.reasoningEffort ?? getDefaultModelReasoningEffort({
    apiBaseUrl: api.apiBaseUrl,
    modelName,
    remoteProvider
  });
  return {
    ...defaultApi,
    ...api,
    connectionKind,
    localRuntime:
      api.localRuntime === "lm-studio" || api.localRuntime === "custom"
        ? api.localRuntime
        : "ollama",
    remoteProvider,
    reasoningEffort,
    apiKey: api.apiKey ?? "",
    modelName,
    localApiBaseUrl: api.localApiBaseUrl || (connectionKind === "local" ? api.apiBaseUrl : defaultApi.localApiBaseUrl),
    localModelName: api.localModelName ?? (connectionKind === "local" ? modelName : ""),
    remoteApiBaseUrl: api.remoteApiBaseUrl || (connectionKind === "remote" ? api.apiBaseUrl : defaultApi.remoteApiBaseUrl),
    remoteModelName: api.remoteModelName || (connectionKind === "remote" ? modelName : defaultApi.remoteModelName),
    modelAssignments: {
      ...defaultAssignments,
      ...api.modelAssignments,
      conversation: api.modelAssignments?.conversation ?? modelName
    }
  };
}

function inferRemoteProvider(
  provider: ApiSettings["remoteProvider"],
  apiBaseUrl: string
): NonNullable<ApiSettings["remoteProvider"]> {
  if (provider === "deepseek" || provider === "kimi" || provider === "glm" || provider === "qwen" || provider === "custom") {
    return provider;
  }

  const normalizedUrl = apiBaseUrl.toLowerCase();
  if (normalizedUrl.includes("deepseek.com")) return "deepseek";
  if (normalizedUrl.includes("moonshot.cn") || normalizedUrl.includes("moonshot.ai")) return "kimi";
  if (normalizedUrl.includes("bigmodel.cn") || normalizedUrl.includes("z.ai")) return "glm";
  if (normalizedUrl.includes("dashscope") || normalizedUrl.includes("maas.aliyuncs.com")) return "qwen";
  return "custom";
}

function normalizeCounselingSettings(
  counseling:
    | (Partial<CounselingExperienceSettings> & {
        bringMemoryToNewSessions?: boolean;
      })
    | undefined
): CounselingExperienceSettings {
  return {
    bringPastUnderstandingToNewSessions:
      counseling?.bringPastUnderstandingToNewSessions ??
      counseling?.bringMemoryToNewSessions ??
      defaultCounseling.bringPastUnderstandingToNewSessions
  };
}

function normalizeAppearanceSettings(
  appearance: Partial<ReadingAppearanceSettings> | undefined
): ReadingAppearanceSettings {
  return {
    textSize: appearance?.textSize === "small" || appearance?.textSize === "large"
      ? appearance.textSize
      : defaultReadingAppearance.textSize,
    lineSpacing: appearance?.lineSpacing === "compact" || appearance?.lineSpacing === "relaxed"
      ? appearance.lineSpacing
      : defaultReadingAppearance.lineSpacing,
    cursorTheme:
      appearance?.cursorTheme === "a" ||
      appearance?.cursorTheme === "b" ||
      appearance?.cursorTheme === "c" ||
      appearance?.cursorTheme === "d" ||
      appearance?.cursorTheme === "e"
        ? appearance.cursorTheme
        : defaultReadingAppearance.cursorTheme
  };
}
