import { app, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import type {
  CreateCounselingSessionOptions,
  CounselingSession,
  CounselingStreamEvent,
  CounselingStreamRequest,
  DataExportScope,
  ConsultationPreparation,
  ImportedDocument,
  MemoryItem,
  ApiSettings,
  SessionMessage,
  SessionMetadataChanges,
  SupportedLocale,
  ModelUsageRecord,
  UserSettings
} from "../../../../../packages/shared/src/index.js";
import {
  type IpcSuccess,
  type IpcFailure,
  type IpcHandlerResult,
  IPC_CHANNELS,
  failure,
  ERROR_CODES,
  wrapIpcHandler as wrapIpcHandlerBase,
  validateId,
  validateSettings,
  validateSessionPayload,
  validateSessionUpdatePayload,
  validateMessagePayload,
  validateMessageBatchPayload,
  validateCounselingStreamRequest,
  validateImportedDocumentPayload,
  validateMemoryPayload,
  validateMemoryUpdatePayload,
  getDefaultCounselors,
  counselorPackageRegistry,
  CounselorPackageRegistry,
  compareCounselorPackageVersions
} from "../../../../../packages/shared/src/index.js";
import { createOpenAICompatibleProvider } from "../../../../../packages/core/src/providers/openAICompatibleProvider.js";
import type { LlmProvider, LlmProviderUsage } from "../../../../../packages/core/src/providers/llmProvider.js";
import {
  DEFAULT_CONCEPTUALIZATION_MODEL_NAME,
  resolveConceptualizationModelSettings,
  resolveSessionLetterModelSettings
} from "../../../../../packages/core/src/counseling/post-session/backstageModelSettings.js";
import {
  buildCounselingMessages,
  DEFAULT_CONSULTATION_MEMO_CONTEXT_BUDGET
} from "../../../../../packages/core/src/counseling/conversation/contextBuilder.js";
import { createSessionLetterDraft } from "../../../../../packages/core/src/counseling/post-session/sessionLetter.js";
import {
  buildCounselingSystemPrompt,
  ensureCounselingPromptSnapshot,
  getCounselingPromptLocale,
  getSnapshotCounselorCorePrompt,
  getSnapshotCounselorVoicePrompt
} from "../../../../../packages/core/src/counseling/conversation/promptSnapshot.js";
import {
  buildContextPlanAudit,
  buildCounselingContextPlan
} from "../../../../../packages/core/src/counseling/conversation/contextBudgetPlanner.js";
import { classifySafetyLane } from "../../../../../packages/core/src/counseling/guards/safetyRouter.js";
import { buildCounselorSafetyPrompt } from "../../../../../packages/core/src/safety/counselorPackageSafety.js";
import {
  installCounselorPackageFromDirectory,
  removeInstalledCounselorPackage,
  updateCounselorPackageFromDirectory
} from "../../../../../packages/core/src/counselors/counselorPackageInstaller.js";
import {
  createCounselorPackageContentHash,
  loadDirectoryCounselorPackage
} from "../../../../../packages/core/src/counselors/directoryCounselorPackageLoader.js";
import {
  createImportedDocumentSummary,
  expandImportedDocumentMessages,
  getImportedDocumentReferences,
  LONG_INPUT_FULL_TEXT_CONTEXT_LIMIT_CHARS,
  stripImportedDocumentFullText
} from "../../../../../packages/core/src/counseling/documents/importedDocumentContext.js";
import {
  createRollingSummaryDraft,
  filterSummarizableMessages,
  shouldUpdateRollingSummary
} from "../../../../../packages/core/src/counseling/conversation/rollingSummary.js";
import {
  createSessionTitleDraft,
  isDefaultSessionTitle
} from "../../../../../packages/core/src/counseling/shared/sessionTitle.js";
import {
  buildAssistantStreamDraftMessage,
  buildAssistantStreamProgressMessage,
  buildAssistantStreamResultMessage
} from "../../../../../packages/core/src/counseling/shared/streamResult.js";
import {
  createMemoryRepository,
  createConsultationMemoRepository,
  createConsultationPreparationRepository,
  createMessageRepository,
  createImportedDocumentRepository,
  createLongTermConceptualizationRepository,
  createRollingSummaryRepository,
  createSecretRepository,
  createSessionConceptualizationRepository,
  createSessionLetterRepository,
  createSessionRepository,
  createSessionSupervisionRepository,
  createSettingsRepository,
  createUsageRepository,
  type SecretRepository,
  type UsageRepository,
  type LingDatabase
} from "../../../../../packages/database/src/index.js";
import { writeContextPlanAudit } from "../counseling/contextAuditWriter.js";
import { loadOrCreateSessionMemoryContext } from "../counseling/sessionMemorySnapshot.js";
import { runConsultationPreparation } from "../counseling/consultationPreparation.js";
import { collectDataExport, saveCollectedDataExport } from "../data/dataExport.js";
import { createLocalBackupFileName, RecoveryRequiredError } from "../data/localDataBackup.js";
import { isTrustedRendererUrl } from "../security/rendererUrlPolicy.js";
import {
  KeyedExclusiveQueue,
  SessionRuntimeCoordinator,
  validateCounselingStreamTarget
} from "../counseling/sessionRuntimeCoordinator.js";

const sessionRuntime = new SessionRuntimeCoordinator();
const counselorSessionCreationQueue = new KeyedExclusiveQueue();
const postSessionArtifactQueue = new KeyedExclusiveQueue();
const activeRollingSummaryUpdates = new Set<string>();
const activeSessionTitleUpdates = new Set<string>();
const activeConsultationPreparationUpdates = new Map<string, string>();
const activeSessionLetterUpdates = new Map<string, string>();
const pendingSessionLetterCycles = new Map<string, string>();
const pendingCounselorPackageImports = new Map<string, {
  contentHash: string;
  expiresAt: number;
  mode: "install" | "update";
  sourceDirectory: string;
}>();
const COUNSELOR_PACKAGE_IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1000;

function pruneExpiredCounselorPackageImports(now = Date.now()) {
  for (const [token, pendingImport] of pendingCounselorPackageImports) {
    if (pendingImport.expiresAt <= now) pendingCounselorPackageImports.delete(token);
  }
}

function sessionBusyFailure() {
  return failure(ERROR_CODES.BUSY, "这次咨询正在执行其他操作，请稍后再试。");
}

function isTrustedIpcSender(event: IpcMainInvokeEvent) {
  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  return isTrustedRendererUrl(senderUrl);
}

function wrapIpcHandler<T, Args extends unknown[]>(
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<IpcHandlerResult<T>>
) {
  return wrapIpcHandlerBase(async (event: IpcMainInvokeEvent, ...args: Args) => {
    if (!isTrustedIpcSender(event)) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "当前页面没有权限访问 Ling 本地数据。");
    }
    return handler(event, ...args);
  });
}

export interface IpcRepositories {
  settings: ReturnType<typeof createSettingsRepository>;
  secrets: SecretRepository;
  sessions: ReturnType<typeof createSessionRepository>;
  messages: ReturnType<typeof createMessageRepository>;
  documents: ReturnType<typeof createImportedDocumentRepository>;
  memories: ReturnType<typeof createMemoryRepository>;
  rollingSummaries: ReturnType<typeof createRollingSummaryRepository>;
  preparations: ReturnType<typeof createConsultationPreparationRepository>;
  supervisions: ReturnType<typeof createSessionSupervisionRepository>;
  memos: ReturnType<typeof createConsultationMemoRepository>;
  conceptualizations: ReturnType<typeof createSessionConceptualizationRepository>;
  sessionLetters: ReturnType<typeof createSessionLetterRepository>;
  longTermConceptualizations: ReturnType<typeof createLongTermConceptualizationRepository>;
  usage: UsageRepository;
}

export interface LocalBackupActions {
  create: (filePath: string) => Promise<string>;
  restore: (filePath: string, recoveryPhrase?: string) => Promise<string>;
}

export function createIpcRepositories(
  db: LingDatabase,
  secrets: SecretRepository = createSecretRepository(db)
): IpcRepositories {
  return {
    settings: createSettingsRepository(db),
    secrets,
    sessions: createSessionRepository(db),
    messages: createMessageRepository(db),
    documents: createImportedDocumentRepository(db),
    memories: createMemoryRepository(db),
    rollingSummaries: createRollingSummaryRepository(db),
    preparations: createConsultationPreparationRepository(db),
    supervisions: createSessionSupervisionRepository(db),
    memos: createConsultationMemoRepository(db),
    conceptualizations: createSessionConceptualizationRepository(db),
    sessionLetters: createSessionLetterRepository(db),
    longTermConceptualizations: createLongTermConceptualizationRepository(db),
    usage: createUsageRepository(db)
  };
}

export function createLazyIpcRepositories(holder: { current: IpcRepositories | null }): IpcRepositories {
  return new Proxy({} as IpcRepositories, {
    get(_target, property) {
      const current = holder.current;
      if (!current) throw new Error("请先解锁本地资料。");
      const value = (current as unknown as Record<string | symbol, unknown>)[property];
      if (typeof value === "function") return value.bind(current);
      return value;
    }
  });
}

export function registerIpcHandlers(repositories?: IpcRepositories, localBackupActions?: LocalBackupActions) {
  ipcMain.handle(IPC_CHANNELS.APP_INFO, wrapIpcHandler(async () => ({
    name: app.getName(),
    version: app.getVersion(),
    mode: process.env.NODE_ENV ?? "development"
  })));

  ipcMain.handle(IPC_CHANNELS.COUNSELOR_PACKAGES_LIST, wrapIpcHandler(async () =>
    counselorPackageRegistry.list()
      .filter(({ source }) => source.kind === "directory")
      .map(({ manifest }) => manifest)
  ));

  if (!repositories) return;

  ipcMain.handle(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_PREVIEW, wrapIpcHandler(async () => {
    pruneExpiredCounselorPackageImports();
    const openResult = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "选择 Ling AI 咨询角色包文件夹"
    });
    const sourceDirectory = openResult.filePaths[0];
    if (openResult.canceled || !sourceDirectory) return { status: "cancelled" as const };
    try {
      const registration = loadDirectoryCounselorPackage(sourceDirectory, {
        registry: new CounselorPackageRegistry()
      });
      const current = counselorPackageRegistry.get(registration.manifest.id);
      if (current?.source.kind === "builtin") {
        return failure(ERROR_CODES.VALIDATION_ERROR, "不能通过本地导入替换 Ling 官方咨询师。");
      }
      if (current?.source.kind === "host") {
        return failure(ERROR_CODES.VALIDATION_ERROR, "咨询师包状态尚未同步，请重新打开 Ling 后再试。");
      }
      if (
        current &&
        compareCounselorPackageVersions(registration.manifest.version, current.manifest.version) <= 0
      ) {
        return failure(
          ERROR_CODES.VALIDATION_ERROR,
          `导入版本必须高于当前版本 ${current.manifest.version}，所选版本为 ${registration.manifest.version}。`
        );
      }
      while (pendingCounselorPackageImports.size >= 10) {
        const oldestToken = pendingCounselorPackageImports.keys().next().value;
        if (!oldestToken) break;
        pendingCounselorPackageImports.delete(oldestToken);
      }
      const token = randomUUID();
      pendingCounselorPackageImports.set(token, {
        contentHash: createCounselorPackageContentHash(sourceDirectory, registration.manifest),
        expiresAt: Date.now() + COUNSELOR_PACKAGE_IMPORT_PREVIEW_TTL_MS,
        mode: current ? "update" : "install",
        sourceDirectory
      });
      return {
        status: "preview" as const,
        manifest: registration.manifest,
        previewToken: token,
        ...(current ? { currentVersion: current.manifest.version } : {})
      };
    } catch (error) {
      return failure(
        ERROR_CODES.VALIDATION_ERROR,
        `咨询师包校验失败：${error instanceof Error ? error.message : "包内容不完整"}`
      );
    }
  }));

  ipcMain.handle(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_COMMIT, wrapIpcHandler(async (_event, previewToken: unknown) => {
    if (typeof previewToken !== "string" || !previewToken.trim()) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "咨询师包导入确认信息不合法。");
    }
    const pendingImport = pendingCounselorPackageImports.get(previewToken);
    pendingCounselorPackageImports.delete(previewToken);
    if (!pendingImport || pendingImport.expiresAt <= Date.now()) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "咨询师包导入预览已失效，请重新选择。");
    }
    try {
      const inspected = loadDirectoryCounselorPackage(pendingImport.sourceDirectory, {
        registry: new CounselorPackageRegistry()
      });
      const contentHash = createCounselorPackageContentHash(
        pendingImport.sourceDirectory,
        inspected.manifest
      );
      if (contentHash !== pendingImport.contentHash) {
        return failure(
          ERROR_CODES.VALIDATION_ERROR,
          "咨询师包在预览后已发生变化，请重新选择并确认。"
        );
      }
      const installationDirectory = join(app.getPath("userData"), "counselor-packages");
      if (pendingImport.mode === "update") {
        const result = updateCounselorPackageFromDirectory(
          pendingImport.sourceDirectory,
          installationDirectory
        );
        return {
          status: "updated" as const,
          manifest: result.registration.manifest,
          previousVersion: result.previousVersion
        };
      }
      const registration = installCounselorPackageFromDirectory(
        pendingImport.sourceDirectory,
        installationDirectory
      );
      return { status: "installed" as const, manifest: registration.manifest };
    } catch (error) {
      return failure(
        ERROR_CODES.VALIDATION_ERROR,
        `咨询师包导入失败：${error instanceof Error ? error.message : "包内容不完整"}`
      );
    }
  }));

  ipcMain.handle(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_CANCEL, wrapIpcHandler(async (_event, previewToken: unknown) => {
    if (typeof previewToken !== "string" || !previewToken.trim()) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "咨询师包导入确认信息不合法。");
    }
    pendingCounselorPackageImports.delete(previewToken);
  }));

  ipcMain.handle(IPC_CHANNELS.COUNSELOR_PACKAGES_REMOVE, wrapIpcHandler(async (_event, packageId: unknown) => {
    const err = validateId(packageId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const registration = counselorPackageRegistry.get(packageId as string);
    if (!registration || registration.source.kind !== "directory") {
      return failure(ERROR_CODES.NOT_FOUND, "未找到可移除的本地导入咨询师包。");
    }
    const hasSessions = (await repositories.sessions.list()).some(
      (session) => session.counselorId === packageId
    );
    if (hasSessions) {
      return failure(
        ERROR_CODES.VALIDATION_ERROR,
        "该咨询师已有本地会谈记录。为了保留历史与会后材料，当前不能移除。"
      );
    }
    const confirmation = await dialog.showMessageBox({
      type: "warning",
      buttons: ["取消", "移除"],
      cancelId: 0,
      defaultId: 0,
      message: `确定移除咨询师“${registration.manifest.localizations["zh-CN"].name}”吗？`,
      detail: "这会删除导入到 Ling 的该咨询师包，不会删除你原来选择的源文件夹。"
    });
    if (confirmation.response !== 1) return { status: "cancelled" as const };
    removeInstalledCounselorPackage(
      packageId as string,
      join(app.getPath("userData"), "counselor-packages")
    );
    return { status: "removed" as const, packageId: packageId as string };
  }));

  ipcMain.handle(IPC_CHANNELS.DATA_EXPORT, wrapIpcHandler(async (_event, scope: unknown) => {
    const locale = (await repositories.settings.read())?.locale ?? "zh-CN";
    if (scope !== "all" && scope !== "sessions" && scope !== "letters") {
      return failure(ERROR_CODES.VALIDATION_ERROR, mainCopy(locale, "无效的导出范围", "Invalid export scope"));
    }
    const archive = await collectDataExport(repositories, scope as DataExportScope, new Date().toISOString(), locale);
    if (archive.sessionCount === 0 && archive.letterCount === 0) {
      return failure(ERROR_CODES.NOT_FOUND, mainCopy(locale, "当前没有符合所选范围的会谈或来信可供导出。", "There are no sessions or letters in the selected scope to export."));
    }
    const saveResult = await dialog.showSaveDialog({
      defaultPath: archive.fileName,
      filters: [{ name: mainCopy(locale, "Markdown 文档", "Markdown document"), extensions: ["md"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
      title: "导出 Ling 本地资料"
    });
    if (saveResult.canceled || !saveResult.filePath) {
      return { status: "cancelled" as const, sessionCount: archive.sessionCount, letterCount: archive.letterCount };
    }
    await saveCollectedDataExport(archive, saveResult.filePath);
    return { status: "saved" as const, fileName: basename(saveResult.filePath), sessionCount: archive.sessionCount, letterCount: archive.letterCount };
  }));

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_CREATE, wrapIpcHandler(async () => {
    if (!localBackupActions) return failure(ERROR_CODES.INTERNAL_ERROR, "当前无法创建本地备份");
    const saveResult = await dialog.showSaveDialog({
      defaultPath: createLocalBackupFileName(),
      filters: [{ name: "Ling 本地备份", extensions: ["ling-backup"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
      title: "创建 Ling 本地备份"
    });
    if (saveResult.canceled || !saveResult.filePath) return { status: "cancelled" as const };
    return { status: "saved" as const, fileName: await localBackupActions.create(saveResult.filePath) };
  }));

  ipcMain.handle(IPC_CHANNELS.DATA_BACKUP_RESTORE, wrapIpcHandler(async (_event, recoveryPhrase: unknown) => {
    if (!localBackupActions) return failure(ERROR_CODES.INTERNAL_ERROR, "当前无法恢复本地备份");
    if (recoveryPhrase !== undefined && typeof recoveryPhrase !== "string") {
      return failure(ERROR_CODES.VALIDATION_ERROR, "恢复凭据格式不正确。");
    }
    if (sessionRuntime.hasActiveStreams()) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "当前仍有会谈正在生成回应。请等待完成或停止生成，再恢复备份。");
    }
    const openResult = await dialog.showOpenDialog({
      filters: [{ name: "Ling 本地备份", extensions: ["ling-backup", "sqlite"] }],
      properties: ["openFile"],
      title: "选择要恢复的 Ling 本地备份"
    });
    const filePath = openResult.filePaths[0];
    if (openResult.canceled || !filePath) return { status: "cancelled" as const };
    try {
      return { status: "restored" as const, fileName: await localBackupActions.restore(filePath, recoveryPhrase) };
    } catch (error) {
      if (error instanceof RecoveryRequiredError) {
        return failure("RECOVERY_REQUIRED", "这份备份来自另一台设备，请使用原来的恢复码。");
      }
      return failure(ERROR_CODES.INTERNAL_ERROR, "恢复失败，现有本地资料没有被替换。");
    }
  }));

  // ---- Settings ----
  ipcMain.handle(IPC_CHANNELS.SETTINGS_READ, wrapIpcHandler(async () => {
    const settings = await repositories.settings.read();
    if (!settings) return null;
    const [hasApiKey, hasDoubaoAccessToken, hasTencentSecretId, hasTencentSecretKey, hasAliyunApiKey] = await Promise.all([
      repositories.secrets.hasApiKey(),
      repositories.secrets.hasDoubaoAccessToken(),
      repositories.secrets.hasTencentSecretId(),
      repositories.secrets.hasTencentSecretKey(),
      repositories.secrets.hasAliyunApiKey()
    ]);
    return {
      ...settings,
      api: {
        ...settings.api,
        apiKey: "",
        apiKeySaved: hasApiKey,
        apiKeyPreview: undefined
      },
      voiceInput: settings.voiceInput
        ? {
            ...settings.voiceInput,
            doubao: {
              ...settings.voiceInput.doubao,
              accessToken: "",
              accessTokenSaved: hasDoubaoAccessToken
            },
            tencent: {
              ...settings.voiceInput.tencent,
              secretId: "",
              secretIdSaved: hasTencentSecretId,
              secretKey: "",
              secretKeySaved: hasTencentSecretKey
            },
            aliyun: {
              ...settings.voiceInput.aliyun,
              apiKey: "",
              apiKeySaved: hasAliyunApiKey
            }
          }
        : undefined
    };
  }));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_SAVE, wrapIpcHandler(async (_event, settings: unknown) => {
    const err = validateSettings(settings);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const nextSettings = settings as UserSettings;
    const apiUrlError = validateApiBaseUrl(nextSettings.api.apiBaseUrl, nextSettings.api.connectionKind);
    if (apiUrlError) return failure(ERROR_CODES.VALIDATION_ERROR, apiUrlError);
    const nextApiKey = nextSettings.api.apiKey?.trim() ?? "";
    if (nextApiKey) {
      await repositories.secrets.saveApiKey(nextApiKey);
    } else if (nextSettings.api.apiKeySaved === false) {
      await repositories.secrets.deleteApiKey();
    }
    const nextDoubaoToken = nextSettings.voiceInput?.doubao.accessToken?.trim() ?? "";
    if (nextDoubaoToken) {
      await repositories.secrets.saveDoubaoAccessToken(nextDoubaoToken);
    } else if (nextSettings.voiceInput?.doubao.accessTokenSaved === false) {
      await repositories.secrets.deleteDoubaoAccessToken();
    }
    const nextTencentSecretId = nextSettings.voiceInput?.tencent.secretId?.trim() ?? "";
    if (nextTencentSecretId) {
      await repositories.secrets.saveTencentSecretId(nextTencentSecretId);
    } else if (nextSettings.voiceInput?.tencent.secretIdSaved === false) {
      await repositories.secrets.deleteTencentSecretId();
    }
    const nextTencentSecretKey = nextSettings.voiceInput?.tencent.secretKey?.trim() ?? "";
    if (nextTencentSecretKey) {
      await repositories.secrets.saveTencentSecretKey(nextTencentSecretKey);
    } else if (nextSettings.voiceInput?.tencent.secretKeySaved === false) {
      await repositories.secrets.deleteTencentSecretKey();
    }
    const nextAliyunApiKey = nextSettings.voiceInput?.aliyun.apiKey?.trim() ?? "";
    if (nextAliyunApiKey) {
      await repositories.secrets.saveAliyunApiKey(nextAliyunApiKey);
    } else if (nextSettings.voiceInput?.aliyun.apiKeySaved === false) {
      await repositories.secrets.deleteAliyunApiKey();
    }
    await repositories.settings.save(nextSettings);
  }));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_API_KEY_HAS, wrapIpcHandler(async () => {
    return repositories.secrets.hasApiKey();
  }));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_API_KEY_DELETE, wrapIpcHandler(async () => {
    await repositories.secrets.deleteApiKey();
    const settings = await repositories.settings.read();
    if (settings) {
      await repositories.settings.save({
        ...settings,
        api: {
          ...settings.api,
          apiKey: "",
          apiKeySaved: false,
          apiKeyPreview: undefined
        }
      });
    }
  }));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_TEST_CONNECTION, wrapIpcHandler(async (_event, api: unknown) => {
    const err = validateApiSettings(api);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);

    const input = api as ApiSettings;
    const locale = (await repositories.settings.read())?.locale ?? "zh-CN";
    // Test the current draft without persisting it. Never use a development
    // environment key to make user configuration appear valid.
    const apiKey = requiresApiKey(input) ? input.apiKey?.trim() || await repositories.secrets.readApiKey() || "" : "";
    if (requiresApiKey(input) && !apiKey) {
      return { connected: false, message: mainCopy(locale, "请先输入 API Key，再测试连接。", "Enter an API key before testing the connection.") };
    }

    try {
      const provider = createOpenAICompatibleProvider({
        apiBaseUrl: input.apiBaseUrl,
        apiKey,
        modelName: input.modelName,
        remoteProvider: input.remoteProvider,
        reasoningEffort: input.reasoningEffort,
        onUsage: (usage) => recordModelUsage(repositories, {
          apiBaseUrl: input.apiBaseUrl,
          modelName: input.modelName,
          connectionKind: input.connectionKind,
          scope: "connection-test"
        }, usage)
      });
      await provider.complete({
        messages: [
          {
            id: "connection-test-user",
            sessionId: "connection-test",
            role: "user",
            content: mainCopy(locale, "请只回复：连接成功。", "Reply only: Connection successful."),
            createdAt: new Date().toISOString()
          }
        ]
      });
      return { connected: true, message: mainCopy(locale, input.connectionKind === "local" ? "本机模型已连接，可以使用当前配置。" : "连接成功，可以使用当前模型配置。", input.connectionKind === "local" ? "Local model connected. The current configuration is ready to use." : "Connection successful. The current model configuration is ready to use.") };
    } catch {
      return { connected: false, message: mainCopy(locale, input.connectionKind === "local" ? "没有连接到本机模型。请确认服务已启动、地址和模型名正确。" : "连接失败，请检查 Base URL、模型名或 API Key。", input.connectionKind === "local" ? "Ling could not reach the local model. Make sure the service is running and check its URL and model name." : "Connection failed. Check the Base URL, model name, and API key.") };
    }
  }));

  ipcMain.handle(IPC_CHANNELS.SETTINGS_LIST_MODELS, wrapIpcHandler(async (_event, api: unknown) => {
    const err = validateApiSettings(api, { requireModel: false });
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);

    const input = api as ApiSettings;
    const locale = (await repositories.settings.read())?.locale ?? "zh-CN";
    const apiKey = requiresApiKey(input) ? input.apiKey?.trim() || await repositories.secrets.readApiKey() || "" : "";
    if (requiresApiKey(input) && !apiKey) {
      return {
        models: [],
        message: mainCopy(locale, "请先输入或保存 API Key，再读取可用模型。", "Enter or save an API key before loading available models."),
        source: "empty" as const
      };
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-cache" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const response = await fetch(buildModelsEndpoint(input.apiBaseUrl), {
        method: "GET",
        headers
      });
      if (!response.ok) {
        return {
          models: [],
          message: mainCopy(locale, "读取模型失败，请检查 Base URL 或 API Key。", "Models could not be loaded. Check the Base URL and API key."),
          source: "failed" as const
        };
      }
      const payload = (await response.json()) as { data?: Array<{ id?: unknown; name?: unknown; owned_by?: unknown }> };
      const models = (payload.data ?? [])
        .filter((model) => typeof model.id === "string" && model.id.trim().length > 0)
        .map((model) => ({
          id: (model.id as string).trim(),
          name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : (model.id as string).trim(),
          ownedBy: typeof model.owned_by === "string" ? model.owned_by : undefined
        }));

      return {
        models,
        message: models.length > 0
          ? mainCopy(locale, "已读取可用模型。", "Available models loaded.")
          : mainCopy(locale, "没有读取到可用模型。请确认服务地址、API Key 和接口兼容性。", "No available models were returned. Check the service URL, API key, and API compatibility."),
        source: "remote" as const
      };
    } catch {
      return {
        models: [],
        message: mainCopy(locale, "读取模型失败，请稍后再试。", "Models could not be loaded. Please try again."),
        source: "failed" as const
      };
    }
  }));

  ipcMain.handle(IPC_CHANNELS.USAGE_GET, wrapIpcHandler(async () => {
    return { days: await repositories.usage.listRecentDays(7) };
  }));

  // ---- Sessions ----
  ipcMain.handle(IPC_CHANNELS.SESSIONS_LIST, wrapIpcHandler(async () => {
    // Earlier builds could leave an assistant-only cancellation placeholder in
    // an active session. It is not a user consultation and must not block entry.
    await repositories.sessions.deleteActiveSessionsWithoutUserMessages();
    const sessions = await repositories.sessions.list();
    void resumeInterruptedPostSessionArtifacts(repositories, sessions).catch(() => {
      // 恢复后台收尾不能阻塞会谈列表；具体失败会写回各自的任务状态。
    });
    return sessions;
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_GET, wrapIpcHandler(async (_event, id: unknown) => {
    const err = validateId(id);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const session = await repositories.sessions.getById(id as string);
    return session === null ? failure(ERROR_CODES.NOT_FOUND, "未找到该会谈") : session;
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_CREATE, wrapIpcHandler(async (
    _event,
    session: unknown,
    creationOptions: unknown
  ) => {
    const err = validateSessionPayload(session);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const input = session as CounselingSession;
    if (input.status !== "draft") {
      return failure(ERROR_CODES.VALIDATION_ERROR, "新咨询必须先创建为尚未开始的预约。");
    }
    if (
      creationOptions !== undefined &&
      (creationOptions === null || typeof creationOptions !== "object" || Array.isArray(creationOptions))
    ) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "新咨询创建选项不合法。");
    }
    const options = (creationOptions ?? {}) as CreateCounselingSessionOptions;
    if (
      options.replaceUnfinishedSessionId !== undefined &&
      validateId(options.replaceUnfinishedSessionId)
    ) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "需要结束的旧咨询 id 不合法。");
    }
    return counselorSessionCreationQueue.run(input.counselorId, async () => {
      const settings = await repositories.settings.read();
      if (settings?.disabledCounselorIds?.includes(input.counselorId)) {
        return failure(
          ERROR_CODES.VALIDATION_ERROR,
          "这位咨询师已停用。如需开始新的咨询，请先在“咨询师扩展”中重新启用。"
        );
      }
      const shouldBringPastUnderstanding = settings?.counseling?.bringPastUnderstandingToNewSessions ?? true;
      // Freeze only material that is already complete when the user chooses to
      // start anew. The just-ended consultation keeps preparing in the background
      // and must never mutate this new session halfway through a conversation.
      const latestMemo = shouldBringPastUnderstanding
        ? await repositories.memos.getLatestReadyByCounselorId(input.counselorId)
        : null;
      const allSessions = await repositories.sessions.list();
      const unfinishedForCounselor = allSessions.filter(
        (existing) =>
          existing.id !== input.id &&
          existing.counselorId === input.counselorId &&
          (existing.status === "active" || existing.status === "draft")
      );
      let endedForPreparation: CounselingSession[] = [];
      const mutationSessionIds: string[] = [];

      if (options.replaceUnfinishedSessionId) {
        const replacementTarget = allSessions.find((existing) => existing.id === options.replaceUnfinishedSessionId);
        if (!replacementTarget) {
          return failure(ERROR_CODES.NOT_FOUND, "没有找到需要结束的旧咨询，请重新读取会谈列表。");
        }
        if (replacementTarget.counselorId !== input.counselorId) {
          return failure(ERROR_CODES.VALIDATION_ERROR, "旧咨询与新咨询不属于同一位咨询师。");
        }

        for (const unfinished of unfinishedForCounselor) {
          if (!sessionRuntime.beginMutation(unfinished.id)) {
            mutationSessionIds.forEach((sessionId) => sessionRuntime.finishMutation(sessionId));
            return sessionBusyFailure();
          }
          mutationSessionIds.push(unfinished.id);
        }

        // The replacement itself is performed atomically below, after the new
        // draft payload is ready. Do not end the old consultation before a new
        // one can be created successfully.
      } else if (unfinishedForCounselor.length > 0) {
        return failure(ERROR_CODES.VALIDATION_ERROR, "这位咨询师还有一次尚未完成的咨询，请先继续或结束它。");
      }

      const sessionWithSnapshot = ensureCounselingPromptSnapshot(
        {
          ...input,
          // A new consultation must never inherit a renderer-supplied snapshot from
          // another counselor/session. Main freezes the prompt identity at creation.
          promptSnapshot: undefined,
          memorySnapshot: {
            version: 2,
            enabled: shouldBringPastUnderstanding,
            ...(latestMemo ? { consultationMemo: latestMemo.memoMd, sourceMemoId: latestMemo.id } : {}),
            createdAt: input.createdAt ?? input.startedAt ?? new Date().toISOString()
          }
        },
        settings?.locale === "en-US" ? "en-US" : "zh-CN",
        settings?.api
          ? {
              apiBaseUrl: settings.api.apiBaseUrl,
              modelName: settings.api.modelName,
              remoteProvider: settings.api.remoteProvider,
              reasoningEffort: settings.api.reasoningEffort
            }
          : undefined
      );
      if (options.replaceUnfinishedSessionId) {
        let replacement;
        try {
          replacement = await repositories.sessions.replaceUnfinishedWithDraft(sessionWithSnapshot, options.replaceUnfinishedSessionId);
        } finally {
          mutationSessionIds.forEach((sessionId) => sessionRuntime.finishMutation(sessionId));
        }
        if (!replacement.ok) {
          if (replacement.reason === "not-found") {
            return failure(ERROR_CODES.NOT_FOUND, "没有找到需要结束的旧咨询，请重新读取会谈列表。");
          }
          if (replacement.reason === "wrong-counselor") {
            return failure(ERROR_CODES.VALIDATION_ERROR, "旧咨询与新咨询不属于同一位咨询师。");
          }
          return failure(ERROR_CODES.VALIDATION_ERROR, "旧咨询的状态已经变化，请重新读取会谈列表。");
        }
        endedForPreparation = replacement.endedSessions;
      } else {
        const created = await repositories.sessions.createDraftIfNoUnfinishedForCounselor(sessionWithSnapshot);
        if (!created) {
          return failure(ERROR_CODES.VALIDATION_ERROR, "这位咨询师还有一次尚未完成的咨询，请先继续或结束它。");
        }
      }

      if (endedForPreparation.length > 0) {
        await Promise.all(endedForPreparation.map((ended) => ensurePostSessionArtifacts(repositories, ended)));
      } else {
        const latestEndedSession = await repositories.sessions.getLatestEndedByCounselorId(input.counselorId);
        if (latestEndedSession) await ensurePostSessionArtifacts(repositories, latestEndedSession);
      }
    });
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_UPDATE, wrapIpcHandler(async (_event, id: unknown, changes: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const changesErr = validateSessionUpdatePayload(changes);
    if (changesErr) return failure(ERROR_CODES.VALIDATION_ERROR, changesErr);
    await repositories.sessions.update(id as string, changes as SessionMetadataChanges);
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_DELETE, wrapIpcHandler(async (_event, id: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const sessionId = id as string;
    if (!sessionRuntime.beginMutation(sessionId)) return sessionBusyFailure();
    try {
      const session = await repositories.sessions.getById(sessionId);
      if (session?.status === "draft") {
        return failure(ERROR_CODES.VALIDATION_ERROR, "这次咨询还没有开始，请返回开场并选择取消。");
      }
      if (session?.status === "active") {
        return failure(ERROR_CODES.VALIDATION_ERROR, "进行中的咨询不能直接删除，请先结束咨询。");
      }
      await repositories.sessions.delete(sessionId);
    } finally {
      sessionRuntime.finishMutation(sessionId);
    }
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_ACTIVATE_DRAFT, wrapIpcHandler(async (_event, id: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const sessionId = id as string;
    if (!sessionRuntime.beginMutation(sessionId)) return sessionBusyFailure();
    try {
      const session = await repositories.sessions.getById(sessionId);
      if (!session) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
      if (session.status !== "draft") return failure(ERROR_CODES.VALIDATION_ERROR, "这次咨询的状态已经改变，请重新进入后再试。");
      const messages = await repositories.messages.listBySessionId(sessionId);
      if (messages.length > 0) return failure(ERROR_CODES.VALIDATION_ERROR, "已有消息的会谈不能作为空白预约激活。");
      const startedAt = new Date().toISOString();
      await repositories.sessions.update(sessionId, { status: "active", startedAt, updatedAt: startedAt });
    } finally {
      sessionRuntime.finishMutation(sessionId);
    }
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_CANCEL_DRAFT, wrapIpcHandler(async (_event, id: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const sessionId = id as string;
    if (!sessionRuntime.beginMutation(sessionId)) return sessionBusyFailure();
    try {
      const session = await repositories.sessions.getById(sessionId);
      if (!session) return;
      if (session.status !== "draft") return failure(ERROR_CODES.VALIDATION_ERROR, "这次咨询已经开始，不能作为未开始记录取消。你可以返回咨询室继续，或结束咨询。");
      const messages = await repositories.messages.listBySessionId(sessionId);
      if (messages.length > 0) return failure(ERROR_CODES.VALIDATION_ERROR, "这次咨询已有消息，不能作为空白预约删除。");
      await repositories.sessions.delete(sessionId);
    } finally {
      sessionRuntime.finishMutation(sessionId);
    }
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_END, wrapIpcHandler(async (_event, id: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const sessionId = id as string;
    if (!sessionRuntime.beginMutation(sessionId)) return sessionBusyFailure();
    try {
      const session = await repositories.sessions.getById(sessionId);
      if (!session) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
      if (session.status === "ended") {
        await ensurePostSessionArtifacts(repositories, session);
        return;
      }
      if (session.status !== "active") return failure(ERROR_CODES.VALIDATION_ERROR, "咨询尚未正式开始，不能结束。");
      const messages = await repositories.messages.listBySessionId(session.id);
      if (!messages.some((message) => message.role === "user")) {
        // 没有任何已发送消息的咨询不是完成的会谈，不能触发来信或后台整理。
        await repositories.sessions.delete(session.id);
        return;
      }
      const previousPreparation = await repositories.preparations.getBySessionId(session.id);
      const endedAt = createMonotonicEndingTimestamp(
        new Date().toISOString(),
        previousPreparation?.sourceEndedAt
      );
      await repositories.sessions.update(session.id, {
        status: "ended",
        endedAt,
        updatedAt: endedAt
      });
      await ensurePostSessionArtifacts(repositories, {
        ...session,
        status: "ended",
        endedAt,
        updatedAt: endedAt
      });
    } finally {
      sessionRuntime.finishMutation(sessionId);
    }
  }));

  ipcMain.handle(IPC_CHANNELS.SESSIONS_RESUME, wrapIpcHandler(async (_event, id: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const sessionId = id as string;
    const target = await repositories.sessions.getById(sessionId);
    if (!target) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
    return counselorSessionCreationQueue.run(target.counselorId, async () => {
      if (!sessionRuntime.beginMutation(sessionId)) return sessionBusyFailure();
      try {
        const session = await repositories.sessions.getById(sessionId);
        if (!session) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
        if (session.status !== "ended") return failure(ERROR_CODES.VALIDATION_ERROR, "只有已经结束的咨询可以继续。");
        const latestEnded = await repositories.sessions.getLatestEndedByCounselorId(session.counselorId);
        if (latestEnded?.id !== session.id) {
          return failure(ERROR_CODES.VALIDATION_ERROR, "为了保持咨询脉络，只能继续与这位咨询师最近结束的一次咨询。");
        }
        const otherUnfinished = (await repositories.sessions.list()).find(
          (existing) =>
            existing.id !== session.id &&
            existing.counselorId === session.counselorId &&
            (existing.status === "active" || existing.status === "draft")
        );
        if (otherUnfinished) {
          return failure(ERROR_CODES.VALIDATION_ERROR, "这位咨询师还有一次尚未完成的咨询，请先继续或结束它。");
        }
        const updatedAt = new Date().toISOString();
        const resumed = await repositories.preparations.resumeSessionAndInvalidatePublished(session.id, updatedAt);
        if (!resumed) return failure(ERROR_CODES.VALIDATION_ERROR, "咨询状态已经变化，请重新读取后再试。");
      } finally {
        sessionRuntime.finishMutation(sessionId);
      }
    });
  }));

  ipcMain.handle(IPC_CHANNELS.CONSULTATION_PREPARATION_GET_BY_SESSION, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const session = await repositories.sessions.getById(sessionId as string);
    if (session?.status === "ended") await ensurePostSessionArtifacts(repositories, session);
    return repositories.preparations.getBySessionId(sessionId as string);
  }));

  ipcMain.handle(IPC_CHANNELS.CONSULTATION_PREPARATION_GET_LATEST_BY_COUNSELOR, wrapIpcHandler(async (_event, counselorId: unknown) => {
    const err = validateId(counselorId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    return repositories.preparations.getLatestByCounselorId(counselorId as string);
  }));

  ipcMain.handle(IPC_CHANNELS.CONSULTATION_PREPARATION_RETRY, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const session = await repositories.sessions.getById(sessionId as string);
    if (!session) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
    if (session.status !== "ended" || !session.endedAt) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "只有已经结束的会谈可以重新进行后台整理。");
    }
    const latestEndedSession = await repositories.sessions.getLatestEndedByCounselorId(session.counselorId);
    const existingPreparation = await repositories.preparations.getBySessionId(session.id);
    if (latestEndedSession?.id !== session.id || existingPreparation?.status !== "failed") {
      return failure(ERROR_CODES.VALIDATION_ERROR, "只能重试这位咨询师最近一次失败的会谈整理。");
    }
    const preparation = await createAndQueueConsultationPreparation(repositories, session);
    return preparation ?? failure(ERROR_CODES.VALIDATION_ERROR, "咨询状态已经变化，请重新读取后再试。");
  }));

  ipcMain.handle(IPC_CHANNELS.SESSION_LETTERS_LIST, wrapIpcHandler(async () => {
    return repositories.sessionLetters.list();
  }));

  ipcMain.handle(IPC_CHANNELS.SESSION_LETTERS_GET_BY_SESSION, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const session = await repositories.sessions.getById(sessionId as string);
    if (session?.status === "ended") await ensurePostSessionArtifacts(repositories, session);
    return repositories.sessionLetters.getBySessionId(sessionId as string);
  }));

  ipcMain.handle(IPC_CHANNELS.SESSION_LETTERS_REGENERATE, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const session = await repositories.sessions.getById(sessionId as string);
    if (!session) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
    if (session.status !== "ended" || !session.endedAt) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "只有已经结束的咨询可以重新生成来信。");
    }
    const preparation = await repositories.preparations.getBySessionId(session.id);
    if (preparation?.status !== "ready" || preparation.sourceEndedAt !== session.endedAt) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "这次咨询的整理完成后，才能重新生成来信。");
    }
    const settings = await repositories.settings.read();
    const letterModelName = settings
      ? resolveSessionLetterModelSettings(settings).modelName
      : DEFAULT_CONCEPTUALIZATION_MODEL_NAME;
    const markedPending = await repositories.sessionLetters.markPendingForEndedCycle({
      id: `session-letter-${session.id}`,
      sessionId: session.id,
      counselorId: session.counselorId,
      modelName: letterModelName,
      now: new Date().toISOString()
    }, session.endedAt);
    if (!markedPending) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "咨询状态已经变化，请重新读取后再试。");
    }
    queueSessionLetterUpdate(repositories, session.id, session.endedAt);
    return repositories.sessionLetters.getBySessionId(session.id);
  }));

  // ---- Messages ----
  ipcMain.handle(IPC_CHANNELS.MESSAGES_LIST, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    return repositories.messages.listBySessionId(sessionId as string);
  }));

  ipcMain.handle(IPC_CHANNELS.MESSAGES_APPEND, wrapIpcHandler(async (_event, message: unknown) => {
    const err = validateMessagePayload(message);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const appended = await repositories.messages.appendForActiveSession(message as SessionMessage);
    if (!appended) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "这场咨询当前不能发送消息。若已结束，请先选择“继续咨询”。");
    }
  }));

  ipcMain.handle(IPC_CHANNELS.MESSAGES_APPEND_MANY, wrapIpcHandler(async (_event, messages: unknown) => {
    const err = validateMessageBatchPayload(messages);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const appended = await repositories.messages.appendManyForActiveSession(messages as SessionMessage[]);
    if (!appended) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "这场咨询当前不能发送消息。若已结束，请先选择“继续咨询”。");
    }
  }));

  // ---- Imported documents ----
  ipcMain.handle(IPC_CHANNELS.DOCUMENTS_CREATE, wrapIpcHandler(async (_event, document: unknown) => {
    const err = validateImportedDocumentPayload(document);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    const created = await repositories.documents.createForActiveSession(document as ImportedDocument);
    if (!created) {
      return failure(ERROR_CODES.VALIDATION_ERROR, "这场咨询当前不能添加附件。若已结束，请先选择“继续咨询”。");
    }
  }));

  ipcMain.handle(IPC_CHANNELS.DOCUMENTS_GET, wrapIpcHandler(async (_event, id: unknown) => {
    const err = validateId(id);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    return repositories.documents.getById(id as string);
  }));

  ipcMain.handle(IPC_CHANNELS.DOCUMENTS_LIST_BY_SESSION, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    return repositories.documents.listBySessionId(sessionId as string);
  }));

  // ---- Memories ----
  ipcMain.handle(IPC_CHANNELS.MEMORIES_LIST, wrapIpcHandler(async () => {
    return repositories.memories.list();
  }));

  ipcMain.handle(IPC_CHANNELS.MEMORIES_CREATE, wrapIpcHandler(async (_event, memory: unknown) => {
    const err = validateMemoryPayload(memory);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    await repositories.memories.create(memory as MemoryItem);
  }));

  ipcMain.handle(IPC_CHANNELS.MEMORIES_UPDATE, wrapIpcHandler(async (_event, id: unknown, changes: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    const changesErr = validateMemoryUpdatePayload(changes);
    if (changesErr) return failure(ERROR_CODES.VALIDATION_ERROR, changesErr);
    await repositories.memories.update(id as string, changes as Partial<Omit<MemoryItem, "id" | "createdAt">>);
  }));

  ipcMain.handle(IPC_CHANNELS.MEMORIES_DELETE, wrapIpcHandler(async (_event, id: unknown) => {
    const idErr = validateId(id);
    if (idErr) return failure(ERROR_CODES.VALIDATION_ERROR, idErr);
    await repositories.memories.delete(id as string);
  }));

  // ---- Counseling stream ----
  ipcMain.handle(IPC_CHANNELS.COUNSELING_STREAM_START, wrapIpcHandler(async (event, request: unknown) => {
    const err = validateCounselingStreamRequest(request);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);

    const input = request as CounselingStreamRequest;
    const apiError = validateApiBaseUrl(input.api.apiBaseUrl, input.api.connectionKind);
    if (apiError) return failure(ERROR_CODES.VALIDATION_ERROR, apiError);
    const controller = new AbortController();
    if (!sessionRuntime.beginStream(input.sessionId, input.requestId, controller)) return sessionBusyFailure();
    const releaseStream = () => sessionRuntime.finishStream(input.sessionId, input.requestId);
    let started = false;
    try {
      const session = await repositories.sessions.getById(input.sessionId);
      if (!session) return failure(ERROR_CODES.NOT_FOUND, "未找到该会谈");
      const targetError = validateCounselingStreamTarget(session, input);
      if (targetError) return failure(ERROR_CODES.VALIDATION_ERROR, targetError);
      started = true;
      void runCounselingStream(event.sender, repositories, input, controller, session, releaseStream)
        .catch(async () => {
          try {
            await repositories.messages.append(
              buildAssistantStreamResultMessage({
                id: input.assistantMessageId,
                sessionId: input.sessionId,
                content: "",
                finishedAt: new Date().toISOString(),
                outcome: "error"
              })
            );
          } catch {
            // The terminal event must still reach the renderer when local persistence fails.
          }
          releaseStream();
          try {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.COUNSELING_STREAM_EVENT, {
                requestId: input.requestId,
                type: "error",
                message: "消息没有完成本机保存或模型请求。请重新读取会谈后再重试。"
              } satisfies CounselingStreamEvent);
            }
          } catch {
            // A destroyed renderer has no listener to clean up.
          }
        })
        .finally(releaseStream);
      return { requestId: input.requestId };
    } finally {
      if (!started) releaseStream();
    }
  }));

  ipcMain.handle(IPC_CHANNELS.COUNSELING_STREAM_CANCEL, wrapIpcHandler(async (_event, requestId: unknown) => {
    const err = validateId(requestId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    if (!sessionRuntime.abort(requestId as string)) {
      return failure(ERROR_CODES.NOT_FOUND, "这次生成已经结束，无需再次停止。");
    }
  }));

  ipcMain.handle(IPC_CHANNELS.COUNSELING_STREAM_GET_ACTIVE, wrapIpcHandler(async (_event, sessionId: unknown) => {
    const err = validateId(sessionId);
    if (err) return failure(ERROR_CODES.VALIDATION_ERROR, err);
    return sessionRuntime.getActiveStream(sessionId as string);
  }));
}

async function runCounselingStream(
  sender: WebContents,
  repositories: IpcRepositories,
  input: CounselingStreamRequest,
  controller: AbortController,
  persistedSession: CounselingSession,
  releaseStream: () => void
) {
  const sessionLocale = getCounselingPromptLocale(persistedSession.promptSnapshot);
  const emit = (streamEvent: CounselingStreamEvent) => {
    if (
      streamEvent.type === "done" ||
      streamEvent.type === "error" ||
      (streamEvent.type === "status" && streamEvent.status === "cancelled")
    ) {
      // The terminal message is already persisted at this point. Release the
      // lifecycle lock before the renderer becomes interactive again, so an
      // immediate "new consultation" action cannot race the stream's finally.
      releaseStream();
    }
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.COUNSELING_STREAM_EVENT, streamEvent);
    }
  };

  let content = "";
  let provider: LlmProvider | undefined;
  try {
    const apiKey = requiresApiKey(input.api)
      ? input.api.apiKey?.trim() || await repositories.secrets.readApiKey() || process.env.DEEPSEEK_API_KEY || ""
      : "";
    if (requiresApiKey(input.api) && !apiKey) {
      const failedUserMessage = stripImportedDocumentFullText({ ...input.message, status: "failed" as const });
      await repositories.messages.append(failedUserMessage);
      await repositories.messages.append(
        buildAssistantStreamResultMessage({
          id: input.assistantMessageId,
          sessionId: input.sessionId,
          content: mainCopy(sessionLocale, "请先到“设置 → 模型接入”保存 API Key，再开始咨询。", "Save an API key under Settings → Model connection before beginning counseling."),
          finishedAt: new Date().toISOString(),
          outcome: "error"
        })
      );
      emit({
        requestId: input.requestId,
        type: "error",
        message: mainCopy(sessionLocale, "请先到“设置 → 模型接入”保存 API Key，再开始咨询。", "Save an API key under Settings → Model connection before beginning counseling."),
        failedUserMessageId: input.message.id
      });
      return;
    }

    provider = createOpenAICompatibleProvider({
      apiBaseUrl: input.api.apiBaseUrl,
      apiKey,
      modelName: input.api.modelName,
      remoteProvider: input.api.remoteProvider,
      reasoningEffort: input.api.reasoningEffort,
      onUsage: (usage) => recordModelUsage(repositories, {
        apiBaseUrl: input.api.apiBaseUrl,
        modelName: input.api.modelName,
        connectionKind: input.api.connectionKind,
        scope: "counseling"
      }, usage)
    });

    await repositories.messages.append(stripImportedDocumentFullText({ ...input.message, status: "sent" }));
    const assistantDraftCreatedAt = new Date().toISOString();
    const sessionWithPromptSnapshot = ensureCounselingPromptSnapshot(persistedSession, undefined, {
      apiBaseUrl: input.api.apiBaseUrl,
      modelName: input.api.modelName,
      remoteProvider: input.api.remoteProvider,
      reasoningEffort: input.api.reasoningEffort
    });
    if (!persistedSession.promptSnapshot?.systemPrompt.trim() && sessionWithPromptSnapshot.promptSnapshot) {
      await repositories.sessions.update(persistedSession.id, { promptSnapshot: sessionWithPromptSnapshot.promptSnapshot });
    }
    const persistedMessages = await repositories.messages.listBySessionId(input.sessionId);
    const rollingSummary = await repositories.rollingSummaries.getBySessionId(input.sessionId);
    const rawContextMessages = persistedMessages.length > 0 ? persistedMessages : [...(input.contextMessages ?? []), input.message];
    const promptLocale = getCounselingPromptLocale(sessionWithPromptSnapshot.promptSnapshot);
    await ensureImportedDocumentSummaries({
      messages: rawContextMessages,
      provider,
      documents: repositories.documents,
      signal: controller.signal,
      locale: promptLocale
    });
    throwIfAborted(controller.signal);
    const contextMessages = await expandImportedDocumentMessages(rawContextMessages, (id) => repositories.documents.getById(id), promptLocale);
    throwIfAborted(controller.signal);
    const counselorId = sessionWithPromptSnapshot.counselorId;
    const teamId = sessionWithPromptSnapshot.teamId ?? "one-way-mirror";
    const systemPrompt =
      sessionWithPromptSnapshot.promptSnapshot?.systemPrompt.trim() ||
      buildCounselingSystemPrompt({
        counselorId,
        teamId,
        locale: promptLocale
      });
    const effectiveRollingSummary = rollingSummary?.summary || input.rollingSummary;
    const userSettings = await repositories.settings.read();
    const basicProfile = buildBasicProfileContext(userSettings?.profile, promptLocale);
    const shouldBringPastUnderstanding =
      userSettings?.counseling?.bringPastUnderstandingToNewSessions ??
      (
        userSettings?.counseling as
          | {
              bringMemoryToNewSessions?: boolean;
            }
          | undefined
      )?.bringMemoryToNewSessions ??
      true;
    const shouldLoadConsultationMemo = shouldBringPastUnderstanding;
    const loadCurrentMemoryContext = async () => {
      if (!shouldLoadConsultationMemo) return {};
      const memo = await repositories.memos.getLatestReadyByCounselorId(counselorId);
      return memo ? { consultationMemo: memo.memoMd, sourceMemoId: memo.id } : {};
    };
    const crossSessionMemory = await loadOrCreateSessionMemoryContext({
      session: sessionWithPromptSnapshot,
      enabled: shouldLoadConsultationMemo,
      loadCurrentContext: loadCurrentMemoryContext,
      saveSnapshot: async (memorySnapshot) => {
        await repositories.sessions.update(input.sessionId, { memorySnapshot });
      }
    });
    const contextPlan = buildCounselingContextPlan({
      messages: contextMessages,
      rollingSummary: effectiveRollingSummary,
      basicProfile,
      consultationMemo: crossSessionMemory.consultationMemo,
      systemPrompt: [systemPrompt, buildCounselorSafetyPrompt(counselorId, promptLocale)].join("\n\n"),
      budget: {
        consultationMemoBudgetTokens: DEFAULT_CONSULTATION_MEMO_CONTEXT_BUDGET
      }
    });
    void writeContextPlanAudit(
      buildContextPlanAudit({
        requestId: input.requestId,
        sessionId: input.sessionId,
        source: "electron",
        modelName: input.api.modelName,
        plan: contextPlan
      })
    ).catch(() => {
      // Context audits are best-effort local diagnostics and must not affect the user conversation.
    });
    const latestUserText = [...contextMessages].reverse().find((message) => message.role === "user")?.content ?? input.message.content;
    const modelMessages = buildCounselingMessages({
      counselorId,
      teamId,
      messages: contextMessages,
      promptSnapshot: sessionWithPromptSnapshot.promptSnapshot,
      rollingSummary: effectiveRollingSummary,
      basicProfile,
      consultationMemo: crossSessionMemory.consultationMemo,
      safetyLane: classifySafetyLane(latestUserText)
    });

    await repositories.messages.append(
      buildAssistantStreamDraftMessage({
        id: input.assistantMessageId,
        sessionId: input.sessionId,
        createdAt: assistantDraftCreatedAt
      })
    );

    for await (const event of provider.stream({ messages: modelMessages, imageInputs: input.imageInputs, signal: controller.signal })) {
      // Some providers can yield one buffered event after AbortController.abort().
      // Do not persist or render it as a counselor response after the user stopped.
      throwIfAborted(controller.signal);
      if (event.type === "status") {
        emit({ requestId: input.requestId, type: "status", status: event.status });
        continue;
      }
      if (event.type === "usage") continue;

      content += event.content;
      await repositories.messages.append(
        buildAssistantStreamProgressMessage({
          id: input.assistantMessageId,
          sessionId: input.sessionId,
          content,
          createdAt: assistantDraftCreatedAt
        })
      );
      emit({ requestId: input.requestId, type: "chunk", content: event.content });
    }

    throwIfAborted(controller.signal);
    const assistantMessage = buildAssistantStreamResultMessage({
      id: input.assistantMessageId,
      sessionId: input.sessionId,
      content,
      finishedAt: new Date().toISOString(),
      outcome: "done"
    });
    await repositories.messages.append(assistantMessage);
    const trustedInput = {
      ...input,
      counselorId: persistedSession.counselorId,
      teamId: persistedSession.teamId
    };
    queueRollingSummaryUpdate(repositories, trustedInput, provider, assistantMessage);
    queueSessionTitleUpdate(sender, repositories, trustedInput, provider, assistantMessage);
    emit({ requestId: input.requestId, type: "done", content });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const assistantMessage = buildAssistantStreamResultMessage({
      id: input.assistantMessageId,
      sessionId: input.sessionId,
      content,
      finishedAt: new Date().toISOString(),
      outcome: aborted ? "cancelled" : "error"
    });
    await repositories.messages.append(assistantMessage);
    if (aborted) {
      if (provider) {
        queueRollingSummaryUpdate(repositories, input, provider, assistantMessage);
      }
      emit({ requestId: input.requestId, type: "status", status: "cancelled" });
      return;
    }
    emit({ requestId: input.requestId, type: "error", message: mainCopy(sessionLocale, "没有连接到模型服务。请到“设置 → 模型接入”测试当前配置后重试。", "Ling could not connect to the model service. Test the current configuration under Settings → Model connection and try again.") });
  }
}

function buildBasicProfileContext(profile: UserSettings["profile"], locale: SupportedLocale) {
  const lines: string[] = [];
  const displayName = profile?.displayName?.trim();
  const background = profile?.background?.trim();
  if (displayName) lines.push(mainCopy(locale, `- 希望被称呼为：${displayName}`, `- Preferred name: ${displayName}`));
  if (background) lines.push(mainCopy(locale, `- 用户愿意提前告知的背景：${background}`, `- Background the user chose to share: ${background}`));
  return lines.join("\n") || undefined;
}

function mainCopy(locale: SupportedLocale, zhCN: string, enUS: string) {
  return locale === "en-US" ? enUS : zhCN;
}

function createMonotonicEndingTimestamp(now: string, previous?: string) {
  if (!previous) return now;
  const nowMs = Date.parse(now);
  const previousMs = Date.parse(previous);
  if (!Number.isFinite(nowMs) || !Number.isFinite(previousMs) || nowMs > previousMs) return now;
  return new Date(previousMs + 1).toISOString();
}

async function createAndQueueConsultationPreparation(
  repositories: IpcRepositories,
  session: CounselingSession
): Promise<ConsultationPreparation | null> {
  if (session.status !== "ended" || !session.endedAt) {
    throw new Error("只有已经结束的会谈可以进入后台整理流程。");
  }
  const settings = await repositories.settings.read();
  const modelName = settings
    ? resolveConceptualizationModelSettings(settings).modelName
    : DEFAULT_CONCEPTUALIZATION_MODEL_NAME;
  const now = new Date().toISOString();
  const preparation: ConsultationPreparation = {
    id: `consultation-preparation-${session.id}-${Date.now()}`,
    sessionId: session.id,
    counselorId: session.counselorId,
    sourceEndedAt: session.endedAt,
    modelName,
    status: "pending",
    phase: "session-conceptualization",
    createdAt: now,
    updatedAt: now
  };
  const inserted = await repositories.preparations.upsertForEndedCycle(preparation);
  if (!inserted) return null;
  queueConsultationPreparationUpdate(repositories, preparation);
  return preparation;
}

async function ensurePostSessionArtifacts(
  repositories: IpcRepositories,
  session: CounselingSession
) {
  if (session.status !== "ended" || !session.endedAt) {
    throw new Error("只有已经结束的会谈可以准备收尾材料。");
  }
  await postSessionArtifactQueue.run(session.id, async () => {
    const latest = await repositories.sessions.getById(session.id);
    if (
      !latest ||
      latest.status !== "ended" ||
      !latest.endedAt ||
      latest.endedAt !== session.endedAt
    ) return;
    await performPostSessionArtifactEnsure(repositories, latest);
  });
}

async function resumeInterruptedPostSessionArtifacts(
  repositories: IpcRepositories,
  sessions: CounselingSession[]
) {
  for (const session of sessions) {
    if (session.status !== "ended" || !session.endedAt) continue;
    const [preparation, letter] = await Promise.all([
      repositories.preparations.getBySessionId(session.id),
      repositories.sessionLetters.getBySessionId(session.id)
    ]);
    const preparationInterrupted = preparation?.sourceEndedAt === session.endedAt
      && (preparation.status === "pending" || preparation.status === "processing");
    const letterInterrupted = letter?.status === "pending";
    if (preparationInterrupted || letterInterrupted) {
      await ensurePostSessionArtifacts(repositories, session);
    }
  }
}

async function performPostSessionArtifactEnsure(
  repositories: IpcRepositories,
  session: CounselingSession
) {
  if (session.status !== "ended" || !session.endedAt) {
    throw new Error("只有已经结束的会谈可以准备收尾材料。");
  }
  const preparation = await repositories.preparations.getBySessionId(session.id);
  const isNewEndingCycle =
    !preparation || preparation.sourceEndedAt !== session.endedAt || preparation.status === "stale";
  const existingLetter = await repositories.sessionLetters.getBySessionId(session.id);
  if (!existingLetter || isNewEndingCycle) {
    const settings = await repositories.settings.read();
    const letterModelName = settings
      ? resolveSessionLetterModelSettings(settings).modelName
      : DEFAULT_CONCEPTUALIZATION_MODEL_NAME;
    const markedPending = await repositories.sessionLetters.markPendingForEndedCycle({
      id: `session-letter-${session.id}`,
      sessionId: session.id,
      counselorId: session.counselorId,
      modelName: letterModelName,
      now: session.endedAt
    }, session.endedAt);
    if (!markedPending) return;
  }

  if (isNewEndingCycle) {
    await createAndQueueConsultationPreparation(repositories, session);
    queueSessionLetterUpdate(repositories, session.id, session.endedAt);
    return;
  }
  if (!preparation) return;
  if (preparation.status === "pending" || preparation.status === "processing") {
    queueConsultationPreparationUpdate(repositories, preparation);
    if (!existingLetter || existingLetter.status === "pending") {
      queueSessionLetterUpdate(repositories, session.id, session.endedAt);
    }
  } else if (preparation.status === "ready" && (!existingLetter || existingLetter.status === "pending")) {
    queueSessionLetterUpdate(repositories, session.id, session.endedAt);
  }
}

function queueConsultationPreparationUpdate(
  repositories: IpcRepositories,
  preparation: ConsultationPreparation
) {
  if (activeConsultationPreparationUpdates.has(preparation.sessionId)) return;
  activeConsultationPreparationUpdates.set(preparation.sessionId, preparation.id);
  void updateConsultationPreparation(repositories, preparation)
    .finally(async () => {
      activeConsultationPreparationUpdates.delete(preparation.sessionId);
      const latest = await repositories.preparations.getBySessionId(preparation.sessionId);
      if (latest && latest.id !== preparation.id && latest.status === "pending") {
        queueConsultationPreparationUpdate(repositories, latest);
      }
    })
    .catch(() => {
      activeConsultationPreparationUpdates.delete(preparation.sessionId);
    });
}

async function updateConsultationPreparation(
  repositories: IpcRepositories,
  preparation: ConsultationPreparation
) {
  try {
    const settings = await repositories.settings.read();
    if (!settings) throw new Error("没有可用的模型配置。请到“设置 → 模型接入”保存配置后重试。");
    const apiKey = requiresApiKey(settings.api)
      ? settings.api.apiKey?.trim()
        || await repositories.secrets.readApiKey()
        || process.env.DEEPSEEK_API_KEY
        || ""
      : "";
    if (requiresApiKey(settings.api) && !apiKey) throw new Error("没有可用的 API Key。请到“设置 → 模型接入”保存后重试。");
    const model = resolveConceptualizationModelSettings(settings);
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: model.apiBaseUrl,
      apiKey,
      modelName: model.modelName,
      remoteProvider: settings.api.remoteProvider,
      reasoningEffort: settings.api.reasoningEffort,
      samplingProfile: "deterministic_task",
      onUsage: (usage) => recordModelUsage(repositories, {
        apiBaseUrl: model.apiBaseUrl,
        modelName: model.modelName,
        connectionKind: settings.api.connectionKind,
        scope: "post-session"
      }, usage)
    });
    const result = await runConsultationPreparation({
      sessionId: preparation.sessionId,
      preparationId: preparation.id,
      sourceEndedAt: preparation.sourceEndedAt,
      provider,
      modelName: model.modelName,
      repositories
    });
    if (result === "published") {
      const letter = await repositories.sessionLetters.getBySessionId(preparation.sessionId);
      if (letter?.status === "pending") {
        queueSessionLetterUpdate(repositories, preparation.sessionId, preparation.sourceEndedAt);
      }
    }
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : "本次会谈的后台整理没有完成，请稍后重新整理这次咨询。";
    await repositories.preparations.markFailed(preparation.id, message, new Date().toISOString());
  }
}

function queueRollingSummaryUpdate(
  repositories: IpcRepositories,
  input: CounselingStreamRequest,
  provider: LlmProvider,
  assistantMessage: SessionMessage
) {
  if (assistantMessage.status !== "sent" || !assistantMessage.content.trim()) return;
  void updateRollingSummaryIfNeeded(repositories, input, provider).catch(() => {
    // 后台摘要失败会记录在 rolling_summaries，不能影响当前流式对话。
  });
}

function queueSessionTitleUpdate(
  sender: WebContents,
  repositories: IpcRepositories,
  input: CounselingStreamRequest,
  provider: LlmProvider,
  assistantMessage: SessionMessage
) {
  if (assistantMessage.status !== "sent" || !assistantMessage.content.trim()) return;
  void updateSessionTitleIfNeeded(sender, repositories, input, provider).catch(() => {
    // 标题生成是会谈列表增强，失败不能影响主对话。
  });
}

function queueSessionLetterUpdate(
  repositories: IpcRepositories,
  sessionId: string,
  sourceEndedAt: string
) {
  const activeCycle = activeSessionLetterUpdates.get(sessionId);
  if (activeCycle) {
    if (activeCycle !== sourceEndedAt) pendingSessionLetterCycles.set(sessionId, sourceEndedAt);
    return;
  }
  activeSessionLetterUpdates.set(sessionId, sourceEndedAt);
  void updateSessionLetter(repositories, sessionId, sourceEndedAt)
    .finally(() => {
      if (activeSessionLetterUpdates.get(sessionId) === sourceEndedAt) activeSessionLetterUpdates.delete(sessionId);
      const pendingCycle = pendingSessionLetterCycles.get(sessionId);
      if (pendingCycle) {
        pendingSessionLetterCycles.delete(sessionId);
        queueSessionLetterUpdate(repositories, sessionId, pendingCycle);
      }
    })
    .catch(() => {
      if (activeSessionLetterUpdates.get(sessionId) === sourceEndedAt) activeSessionLetterUpdates.delete(sessionId);
    });
}

async function updateSessionLetter(
  repositories: IpcRepositories,
  sessionId: string,
  sourceEndedAt: string
) {
  const session = await repositories.sessions.getById(sessionId);
  if (!session || session.status !== "ended" || session.endedAt !== sourceEndedAt) return;
  const settings = await repositories.settings.read();
  const letterModelName = settings
    ? resolveSessionLetterModelSettings(settings).modelName
    : DEFAULT_CONCEPTUALIZATION_MODEL_NAME;
  const failureBase = {
    id: `session-letter-${sessionId}`,
    sessionId,
    counselorId: session.counselorId,
    modelName: letterModelName,
    failedAt: new Date().toISOString()
  };

  try {
    if (!settings) {
      await repositories.sessionLetters.markFailedForEndedCycle({
        ...failureBase,
        errorMessage: "来信生成失败：没有可用的模型配置。"
      }, sourceEndedAt);
      return;
    }

    const apiKey = requiresApiKey(settings.api)
      ? settings.api.apiKey?.trim() || await repositories.secrets.readApiKey() || process.env.DEEPSEEK_API_KEY || ""
      : "";
    if (requiresApiKey(settings.api) && !apiKey) {
      await repositories.sessionLetters.markFailedForEndedCycle({
        ...failureBase,
        errorMessage: "来信生成失败：没有可用的 API Key。"
      }, sourceEndedAt);
      return;
    }

    const [messages, conceptualization] = await Promise.all([
      repositories.messages.listBySessionId(sessionId),
      repositories.conceptualizations.getBySessionId(sessionId)
    ]);
    const letterModel = resolveSessionLetterModelSettings(settings);
    const provider = createOpenAICompatibleProvider({
      apiBaseUrl: letterModel.apiBaseUrl,
      apiKey,
      modelName: letterModel.modelName,
      remoteProvider: settings.api.remoteProvider,
      reasoningEffort: settings.api.reasoningEffort,
      samplingProfile: "deterministic_task",
      onUsage: (usage) => recordModelUsage(repositories, {
        apiBaseUrl: letterModel.apiBaseUrl,
        modelName: letterModel.modelName,
        connectionKind: settings.api.connectionKind,
        scope: "post-session"
      }, usage)
    });
    const locale = getCounselingPromptLocale(session.promptSnapshot);
    const counselorName =
      getDefaultCounselors(locale).find((counselor) => counselor.id === session.counselorId)?.name ??
      (locale === "en-US" ? "Counselor" : "咨询师");
    const draft = await createSessionLetterDraft({
      provider,
      sessionId,
      counselorId: session.counselorId,
      counselorName,
      locale,
      counselorCorePrompt: getSnapshotCounselorCorePrompt(session.promptSnapshot),
      counselorVoicePrompt: getSnapshotCounselorVoicePrompt(session.promptSnapshot),
      clientDisplayName: settings.profile?.displayName,
      sessionMessages: messages,
      sessionConceptualization: conceptualization,
      modelName: letterModel.modelName,
      now: new Date().toISOString()
    });
    await repositories.sessionLetters.upsertForEndedCycle(draft, sourceEndedAt);
  } catch {
    await repositories.sessionLetters.markFailedForEndedCycle({
      ...failureBase,
      failedAt: new Date().toISOString(),
      errorMessage: "咨询师来信生成失败，可以稍后重新生成。"
    }, sourceEndedAt);
  }
}

async function updateSessionTitleIfNeeded(
  sender: WebContents,
  repositories: IpcRepositories,
  input: CounselingStreamRequest,
  provider: LlmProvider
) {
  if (activeSessionTitleUpdates.has(input.sessionId)) return;
  activeSessionTitleUpdates.add(input.sessionId);

  try {
    const session = await repositories.sessions.getById(input.sessionId);
    if (!session || !isDefaultSessionTitle(session.title)) return;
    const locale = getCounselingPromptLocale(session.promptSnapshot);

    const messages = await repositories.messages.listBySessionId(input.sessionId);
    const title = await createSessionTitleDraft({
      provider,
      sessionId: input.sessionId,
      messages,
      locale
    });
    if (!title) return;

    const latestSession = await repositories.sessions.getById(input.sessionId);
    if (!latestSession || !isDefaultSessionTitle(latestSession.title)) return;

    await repositories.sessions.update(input.sessionId, {
      title,
      updatedAt: new Date().toISOString()
    });
    if (!sender.isDestroyed()) {
      sender.send(IPC_CHANNELS.APP_SESSION_CHANGED, input.sessionId);
    }
  } finally {
    activeSessionTitleUpdates.delete(input.sessionId);
  }
}

async function updateRollingSummaryIfNeeded(
  repositories: IpcRepositories,
  input: CounselingStreamRequest,
  provider: LlmProvider
) {
  if (activeRollingSummaryUpdates.has(input.sessionId)) return;
  activeRollingSummaryUpdates.add(input.sessionId);

  try {
    const session = await repositories.sessions.getById(input.sessionId);
    const locale = getCounselingPromptLocale(session?.promptSnapshot);
    const messages = await repositories.messages.listBySessionId(input.sessionId);
    const existing = await repositories.rollingSummaries.getBySessionId(input.sessionId);
    if (!shouldUpdateRollingSummary({ messages, existing })) return;

    const attemptedMessageCount = filterSummarizableMessages(messages).length;
    try {
      const draft = await createRollingSummaryDraft({
        provider,
        messages,
        existing,
        sessionId: input.sessionId,
        locale
      });
      const now = new Date().toISOString();
      await repositories.rollingSummaries.upsertForExistingSession({
        sessionId: input.sessionId,
        counselorId: input.counselorId ?? "chengling",
        summary: draft.summary,
        coveredMessageCount: draft.coveredMessageCount,
        coveredUntilMessageId: draft.coveredUntilMessageId,
        lastAttemptedMessageCount: attemptedMessageCount,
        sourceHash: draft.sourceHash,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        status: "active"
      });
    } catch {
      await repositories.rollingSummaries.markFailedForExistingSession({
        sessionId: input.sessionId,
        counselorId: input.counselorId ?? "chengling",
        attemptedMessageCount,
        errorMessage: "rolling summary 更新失败，已保留上一版摘要。",
        failedAt: new Date().toISOString()
      });
    }
  } finally {
    activeRollingSummaryUpdates.delete(input.sessionId);
  }
}

async function ensureImportedDocumentSummaries({
  messages,
  provider,
  documents,
  signal,
  locale
}: {
  messages: SessionMessage[];
  provider: LlmProvider;
  documents: IpcRepositories["documents"];
  signal: AbortSignal;
  locale: SupportedLocale;
}) {
  const seen = new Set<string>();
  for (const message of messages) {
    throwIfAborted(signal);
    for (const reference of getImportedDocumentReferences(message)) {
      throwIfAborted(signal);
      if (seen.has(reference.id)) continue;
      seen.add(reference.id);

      const document = await documents.getById(reference.id);
      if (!document || document.summary?.trim()) continue;
      if (document.content.length <= LONG_INPUT_FULL_TEXT_CONTEXT_LIMIT_CHARS) continue;

      try {
        const summary = await createImportedDocumentSummary({ document, provider, signal, locale });
        throwIfAborted(signal);
        if (summary) {
          await documents.updateSummary(document.id, summary);
        }
      } catch {
        if (signal.aborted) throw createAbortError();
        // 资料摘要失败不能阻断主对话；上下文展开会退回为“超出全文预算”的资料说明。
      }
    }
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw createAbortError();
}

function createAbortError() {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

function validateApiSettings(payload: unknown, options: { requireModel?: boolean } = {}): string | null {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    return "api settings 必须是一个对象";
  }
  const api = payload as Partial<ApiSettings>;
  const urlError = validateApiBaseUrl(api.apiBaseUrl, api.connectionKind);
  if (urlError) return urlError;
  if (options.requireModel !== false && !api.modelName) return "缺少 modelName";
  return null;
}

function validateApiBaseUrl(value: unknown, connectionKind?: ApiSettings["connectionKind"]): string | null {
  if (typeof value !== "string" || !value.trim()) return "缺少 apiBaseUrl";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "apiBaseUrl 不是有效地址";
  }
  if (url.username || url.password) return "apiBaseUrl 不能包含账号或密码";
  if (url.protocol !== "http:" && url.protocol !== "https:") return "apiBaseUrl 只支持 http 或 https";

  const hostname = url.hostname.toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost");
  if (connectionKind === "local") {
    if (!isLoopback) return "本地模型地址只能使用 http://127.0.0.1 或 http://localhost";
  } else if (url.protocol !== "https:" && !isLoopback) {
    return "远程模型地址必须使用 https";
  }
  return null;
}

function buildModelsEndpoint(apiBaseUrl: string) {
  return `${apiBaseUrl.replace(/\/+$/, "")}/models`;
}

function requiresApiKey(api: Pick<ApiSettings, "connectionKind">) {
  return api.connectionKind !== "local";
}

function recordModelUsage(
  repositories: IpcRepositories,
  input: {
    apiBaseUrl: string;
    modelName: string;
    connectionKind?: ApiSettings["connectionKind"];
    scope: ModelUsageRecord["scope"];
  },
  usage: LlmProviderUsage
) {
  void repositories.usage
    .record({
      id: `model-usage-${randomUUID()}`,
      providerName: detectProviderName(input.apiBaseUrl, input.connectionKind),
      modelName: input.modelName,
      connectionKind: input.connectionKind ?? "remote",
      scope: input.scope,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      createdAt: new Date().toISOString()
    })
    .catch(() => {
      // Usage bookkeeping is best-effort local data and must never affect the conversation.
    });
}

function detectProviderName(
  apiBaseUrl: string,
  connectionKind?: ApiSettings["connectionKind"]
): string {
  if (connectionKind === "local") return "local";
  let hostname = "";
  try {
    hostname = new URL(apiBaseUrl).hostname.toLowerCase();
  } catch {
    hostname = apiBaseUrl.toLowerCase();
  }
  if (hostname.includes("deepseek.com")) return "DeepSeek";
  if (hostname.includes("moonshot.cn")) return "Kimi";
  if (hostname.includes("bigmodel.cn")) return "GLM";
  if (hostname.includes("dashscope.aliyuncs.com")) return "Qwen";
  if (hostname.includes("openai.com")) return "OpenAI";
  return "custom";
}
