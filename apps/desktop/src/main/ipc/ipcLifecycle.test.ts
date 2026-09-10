// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLingDatabase, type LingDatabase } from "../../../../../packages/database/src/index";
import {
  IPC_CHANNELS,
  counselorPackageRegistry,
  type CounselingStreamEvent,
  type CounselingSession,
  type ImportedDocument,
  type SessionMessage
} from "../../../../../packages/shared/src/index";

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>());
const electronMocks = vi.hoisted(() => ({
  userDataPath: "",
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    getName: () => "Ling",
    getVersion: () => "1.0.0",
    getPath: () => electronMocks.userDataPath,
    getAppPath: () => "/ling"
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
    showMessageBox: electronMocks.showMessageBox
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      ipcHandlers.set(channel, handler);
    }
  }
}));

import { createIpcRepositories, registerIpcHandlers, type IpcRepositories } from "./index";

describe("main IPC consultation lifecycle boundaries", () => {
  let db: LingDatabase;
  let repositories: IpcRepositories;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ling-ipc-lifecycle-"));
    electronMocks.userDataPath = tempDir;
    electronMocks.showOpenDialog.mockReset();
    electronMocks.showMessageBox.mockReset();
    db = createLingDatabase({ path: join(tempDir, "ling.sqlite") });
    repositories = createIpcRepositories(db);
    ipcHandlers.clear();
    registerIpcHandlers(repositories);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (counselorPackageRegistry.get("ipc-professional-listener")?.source.kind === "directory") {
      counselorPackageRegistry.unregister("ipc-professional-listener");
    }
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("serializes concurrent same-counselor draft creation and rebuilds renderer-supplied prompt identity", async () => {
    const originalList = repositories.sessions.list;
    let releaseFirstList!: () => void;
    let announceFirstList!: () => void;
    let firstList = true;
    const firstListEntered = new Promise<void>((resolve) => {
      announceFirstList = resolve;
    });
    const firstListGate = new Promise<void>((resolve) => {
      releaseFirstList = resolve;
    });
    repositories.sessions.list = async () => {
      const snapshot = await originalList();
      if (firstList) {
        firstList = false;
        announceFirstList();
        await firstListGate;
      }
      return snapshot;
    };
    const create = handler(IPC_CHANNELS.SESSIONS_CREATE);
    const first = create({}, draftSession("draft-1", "chengling", {
      counselorId: "zhouzhou",
      modelName: "wrong-model",
      systemPrompt: "wrong counselor prompt",
      createdAt: "2026-07-12T10:00:00.000Z",
      version: 1
    }));
    const second = create({}, draftSession("draft-2", "chengling"));

    await firstListEntered;
    releaseFirstList();
    const results = await Promise.all([first, second]);

    expect(results.filter(isSuccess)).toHaveLength(1);
    expect(results.filter((result) => !isSuccess(result))).toHaveLength(1);
    const sessions = await originalList();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      counselorId: "chengling",
      status: "draft",
      promptSnapshot: {
        version: 5,
        counselorId: "chengling",
        modelName: "test",
        counselorPackageVersion: "1.0.0",
        promptContentHash: expect.stringMatching(/^fnv1a32:/),
        counselorVoicePrompt: expect.stringContaining("程灵｜语言与表达风格"),
        sharedCounselingValuesPrompt: expect.stringContaining("共同咨询价值观")
      }
    });
    expect(sessions[0].promptSnapshot?.systemPrompt).not.toContain("wrong counselor prompt");
  });

  it("rejects a new consultation with a disabled imported counselor", async () => {
    await repositories.settings.save({
      api: { apiBaseUrl: "https://api.example.test/v1", modelName: "test" },
      defaultCounselorId: "chengling",
      disabledCounselorIds: ["disabled-professional-counselor"],
      defaultRoomThemeId: "warm-study"
    });

    const result = await handler(IPC_CHANNELS.SESSIONS_CREATE)(
      {},
      draftSession("draft-disabled-counselor", "disabled-professional-counselor")
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("已停用")
      }
    });
    await expect(repositories.sessions.getById("draft-disabled-counselor")).resolves.toBeNull();
  });

  it("returns the Ling application name and package version", async () => {
    await expect(handler(IPC_CHANNELS.APP_INFO)({})).resolves.toEqual({
      ok: true,
      data: { name: "Ling", version: "1.0.0", mode: "test" }
    });
  });

  it("lists no host paths when only builtin counselor packages are installed", async () => {
    await expect(handler(IPC_CHANNELS.COUNSELOR_PACKAGES_LIST)({})).resolves.toEqual({
      ok: true,
      data: []
    });
  });

  it("previews a valid local counselor package before importing it", async () => {
    const sourceDirectory = join(tempDir, "source-package");
    const scaffold = spawnSync(process.execPath, [
      join(process.cwd(), "scripts/create-counselor-package.mjs"),
      sourceDirectory,
      "ipc-professional-listener"
    ], { encoding: "utf8" });
    expect(scaffold.status, scaffold.stderr).toBe(0);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceDirectory] });

    const chooseResult = await handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_PREVIEW)({});
    expect(chooseResult).toMatchObject({
      ok: true,
      data: {
        status: "preview",
        manifest: { id: "ipc-professional-listener" },
        previewToken: expect.any(String)
      }
    });
    const previewToken = (chooseResult as { data: { previewToken: string } }).data.previewToken;
    expect(counselorPackageRegistry.get("ipc-professional-listener")).toBeUndefined();

    const importResult = await handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_COMMIT)({}, previewToken);
    expect(importResult).toMatchObject({
      ok: true,
      data: { status: "installed", manifest: { id: "ipc-professional-listener" } }
    });
    expect(counselorPackageRegistry.get("ipc-professional-listener")?.source.kind).toBe("directory");

    const updateDirectory = join(tempDir, "update-package");
    const updateScaffold = spawnSync(process.execPath, [
      join(process.cwd(), "scripts/create-counselor-package.mjs"),
      updateDirectory,
      "ipc-professional-listener"
    ], { encoding: "utf8" });
    expect(updateScaffold.status, updateScaffold.stderr).toBe(0);
    const updateManifestPath = join(updateDirectory, "manifest.json");
    const updateManifest = JSON.parse(readFileSync(updateManifestPath, "utf8")) as { version: string };
    updateManifest.version = "0.2.0";
    writeFileSync(updateManifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [updateDirectory] });

    const updatePreview = await handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_PREVIEW)({});
    expect(updatePreview).toMatchObject({
      ok: true,
      data: {
        status: "preview",
        currentVersion: "0.1.0",
        manifest: { version: "0.2.0" }
      }
    });
    const updateToken = (updatePreview as { data: { previewToken: string } }).data.previewToken;
    const updateResult = await handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_COMMIT)({}, updateToken);
    expect(updateResult).toMatchObject({
      ok: true,
      data: {
        status: "updated",
        previousVersion: "0.1.0",
        manifest: { version: "0.2.0" }
      }
    });
    expect(counselorPackageRegistry.require("ipc-professional-listener").manifest.version).toBe("0.2.0");
  });

  it("rejects a changed or cancelled counselor package preview", async () => {
    const sourceDirectory = join(tempDir, "mutable-source-package");
    const scaffold = spawnSync(process.execPath, [
      join(process.cwd(), "scripts/create-counselor-package.mjs"),
      sourceDirectory,
      "ipc-professional-listener"
    ], { encoding: "utf8" });
    expect(scaffold.status, scaffold.stderr).toBe(0);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [sourceDirectory] });

    const preview = await handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_PREVIEW)({});
    const previewToken = (preview as { data: { previewToken: string } }).data.previewToken;
    writeFileSync(join(sourceDirectory, "prompts/voice-zh.md"), "# 预览后被修改\n", "utf8");

    await expect(handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_COMMIT)({}, previewToken)).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("预览后已发生变化") }
    });
    expect(counselorPackageRegistry.get("ipc-professional-listener")).toBeUndefined();

    const nextPreview = await handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_PREVIEW)({});
    const nextToken = (nextPreview as { data: { previewToken: string } }).data.previewToken;
    await expect(handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_CANCEL)({}, nextToken)).resolves.toEqual({
      ok: true,
      data: undefined
    });
    await expect(handler(IPC_CHANNELS.COUNSELOR_PACKAGES_IMPORT_COMMIT)({}, nextToken)).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("已失效") }
    });
  });

  it("does not use a development environment key for settings connection or model discovery", async () => {
    const previousDevelopmentKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "development-only-key";
    try {
      const api = {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "",
        apiKeySaved: false,
        modelName: "deepseek-v4-flash"
      };

      await expect(handler(IPC_CHANNELS.SETTINGS_TEST_CONNECTION)({}, api)).resolves.toMatchObject({
        ok: true,
        data: { connected: false, message: "请先输入 API Key，再测试连接。" }
      });
      await expect(handler(IPC_CHANNELS.SETTINGS_LIST_MODELS)({}, api)).resolves.toMatchObject({
        ok: true,
        data: { models: [], source: "empty" }
      });
    } finally {
      if (previousDevelopmentKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousDevelopmentKey;
    }
  });

  it.each([
    ["", "  draft-key  ", "draft-key"],
    ["saved-key", "new-key", "new-key"],
    ["saved-key", "", "saved-key"],
    ["saved-key", "   ", "saved-key"]
  ])("tests and discovers with the current key without saving (%s, %s)", async (savedKey, draftKey, expectedKey) => {
    if (savedKey) await repositories.secrets.saveApiKey(savedKey);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "连接成功" } }],
      data: [{ id: "test-model" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const api = { apiBaseUrl: "https://models.example.com/v1", apiKey: draftKey, modelName: "test-model" };
    await expect(handler(IPC_CHANNELS.SETTINGS_TEST_CONNECTION)({}, api)).resolves.toMatchObject({
      ok: true, data: { connected: true }
    });
    await expect(handler(IPC_CHANNELS.SETTINGS_LIST_MODELS)({}, api)).resolves.toMatchObject({
      ok: true, data: { source: "remote" }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(options.headers).toMatchObject({ Authorization: `Bearer ${expectedKey}` });
    }
    expect(await repositories.secrets.readApiKey()).toBe(savedKey || null);
  });

  it("does not retry an invalid replacement with the saved key or persist it", async () => {
    await repositories.secrets.saveApiKey("valid-saved-key");
    const fetchMock = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(handler(IPC_CHANNELS.SETTINGS_TEST_CONNECTION)({}, {
      apiBaseUrl: "https://models.example.com/v1", apiKey: "invalid-new-key", modelName: "test-model"
    })).resolves.toMatchObject({ ok: true, data: { connected: false } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer invalid-new-key" })
    }));
    expect(await repositories.secrets.readApiKey()).toBe("valid-saved-key");
  });

  it("saves a trimmed key, reads only a masked key, keeps a blank replacement, and deletes explicitly", async () => {
    const settings = {
      api: { apiBaseUrl: "https://api.deepseek.com", apiKey: "  synthetic-test-key  ", modelName: "deepseek-v4-flash" },
      defaultCounselorId: "chengling", defaultRoomThemeId: "warm-study"
    };
    const save = handler(IPC_CHANNELS.SETTINGS_SAVE);
    await expect(save({}, settings)).resolves.toMatchObject({ ok: true });
    expect(await repositories.secrets.readApiKey()).toBe("synthetic-test-key");
    const read = await handler(IPC_CHANNELS.SETTINGS_READ)({}) as { ok: boolean; data: typeof settings };
    expect(read).toMatchObject({ ok: true, data: { api: { apiKey: "", apiKeySaved: true } } });
    expect(JSON.stringify(await repositories.settings.read())).not.toContain("synthetic-test-key");
    await expect(save({}, read.data)).resolves.toMatchObject({ ok: true });
    expect(await repositories.secrets.readApiKey()).toBe("synthetic-test-key");
    await expect(handler(IPC_CHANNELS.SETTINGS_API_KEY_DELETE)({})).resolves.toMatchObject({ ok: true });
    expect(await repositories.secrets.readApiKey()).toBeNull();
  });

  it("returns every valid model id from an OpenAI-compatible models endpoint", async () => {
    await repositories.secrets.saveApiKey("saved-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: "deepseek-v4-flash", owned_by: "deepseek" },
        { id: "future-provider-model", name: " Official future model ", owned_by: "future-provider" },
        { id: "   " },
        { owned_by: "missing-id" }
      ]
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(handler(IPC_CHANNELS.SETTINGS_LIST_MODELS)({}, {
      apiBaseUrl: "https://models.example.com/v1",
      apiKey: "",
      apiKeySaved: true,
      modelName: "future-provider-model"
    })).resolves.toMatchObject({
      ok: true,
      data: {
        models: [
          { id: "deepseek-v4-flash", name: "deepseek-v4-flash", ownedBy: "deepseek" },
          { id: "future-provider-model", name: "Official future model", ownedBy: "future-provider" }
        ],
        source: "remote"
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://models.example.com/v1/models", expect.objectContaining({ headers: expect.objectContaining({ "Cache-Control": "no-cache" }) }));
  });

  it("discovers local models without requiring or sending an API key", async () => {
    await repositories.secrets.saveApiKey("saved-remote-key-that-must-not-leak");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "qwen3:8b", owned_by: "library" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(handler(IPC_CHANNELS.SETTINGS_LIST_MODELS)({}, {
      connectionKind: "local",
      localRuntime: "ollama",
      apiBaseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "",
      apiKeySaved: false,
      modelName: ""
    })).resolves.toMatchObject({
      ok: true,
      data: { models: [{ id: "qwen3:8b" }], source: "remote" }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/models",
      expect.objectContaining({ headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } })
    );
  });

  it("replaces every legacy unfinished session for the counselor and creates the new draft", async () => {
    await repositories.sessions.create({ ...draftSession("active-legacy-1", "linleshui"), status: "active" });
    await repositories.sessions.create({ ...draftSession("active-legacy-2", "linleshui"), status: "active" });
    await appendUserMessage(repositories, "active-legacy-1");
    await appendUserMessage(repositories, "active-legacy-2");

    const result = await handler(IPC_CHANNELS.SESSIONS_CREATE)(
      {},
      draftSession("draft-new", "linleshui"),
      { replaceUnfinishedSessionId: "active-legacy-2" }
    );

    expect(result).toMatchObject({ ok: true });
    await expect(repositories.sessions.getById("active-legacy-1")).resolves.toMatchObject({ status: "ended" });
    await expect(repositories.sessions.getById("active-legacy-2")).resolves.toMatchObject({ status: "ended" });
    await expect(repositories.sessions.getById("draft-new")).resolves.toMatchObject({ status: "draft" });
    await expect(repositories.preparations.getBySessionId("active-legacy-1")).resolves.toMatchObject({
      sessionId: "active-legacy-1"
    });
    await expect(repositories.preparations.getBySessionId("active-legacy-2")).resolves.toMatchObject({
      sessionId: "active-legacy-2"
    });
  });

  it("new draft creation fails without ending the old consultation", async () => {
    await repositories.sessions.create({ ...draftSession("active-atomic", "chengling"), status: "active" });
    await repositories.sessions.create({
      ...draftSession("draft-conflict", "chengling"),
      status: "ended",
      endedAt: "2026-07-12T11:00:00.000Z"
    });

    const result = await handler(IPC_CHANNELS.SESSIONS_CREATE)(
      {},
      draftSession("draft-conflict", "chengling"),
      { replaceUnfinishedSessionId: "active-atomic" }
    );

    expect(result).toMatchObject({ ok: false });
    await expect(repositories.sessions.getById("active-atomic")).resolves.toMatchObject({ status: "active" });
  });

  it("releases the stream lock before a terminal event can immediately create a new consultation", async () => {
    const session = { ...draftSession("active-stream-finished", "chengling"), status: "active" as const };
    await repositories.sessions.create(session);
    await repositories.secrets.saveApiKey("saved-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      'data: {"choices":[{"delta":{"content":"我在。"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    )));

    const create = handler(IPC_CHANNELS.SESSIONS_CREATE);
    let replacementPromise: Promise<unknown> | undefined;
    let resolveTerminal!: () => void;
    const terminalReceived = new Promise<void>((resolve) => {
      resolveTerminal = resolve;
    });
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: CounselingStreamEvent) => {
        if (event.type !== "done") return;
        replacementPromise = create(
          {},
          draftSession("draft-immediately-after-stream", "chengling"),
          { replaceUnfinishedSessionId: session.id }
        );
        resolveTerminal();
      }
    };

    await expect(handler(IPC_CHANNELS.COUNSELING_STREAM_START)({ sender }, {
      requestId: "stream-finished",
      sessionId: session.id,
      counselorId: "chengling",
      teamId: "one-way-mirror",
      api: {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "",
        apiKeySaved: true,
        modelName: "deepseek-v4-flash"
      },
      message: {
        id: "stream-user-message",
        sessionId: session.id,
        role: "user",
        content: "现在可以开始新咨询吗？",
        createdAt: "2026-07-12T10:01:00.000Z",
        status: "sent"
      },
      assistantMessageId: "stream-assistant-message",
      contextMessages: []
    })).resolves.toMatchObject({ ok: true });

    await terminalReceived;
    await expect(replacementPromise).resolves.toMatchObject({ ok: true });
    await expect(repositories.sessions.getById(session.id)).resolves.toMatchObject({ status: "ended" });
    await expect(repositories.sessions.getById("draft-immediately-after-stream")).resolves.toMatchObject({ status: "draft" });
    await expect(repositories.messages.listBySessionId(session.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "stream-assistant-message", content: "我在。", status: "sent" })
      ])
    );
  });

  it("allows a new draft while the latest ended consultation is still preparing", async () => {
    const ended = endedSession("ended-preparing", "zhouzhou");
    await repositories.sessions.create(ended);
    await repositories.preparations.upsert({
      id: "preparation-pending",
      sessionId: ended.id,
      counselorId: ended.counselorId,
      sourceEndedAt: ended.endedAt!,
      modelName: "test",
      status: "processing",
      phase: "supervision",
      createdAt: ended.endedAt!,
      updatedAt: ended.endedAt!
    });

    const result = await handler(IPC_CHANNELS.SESSIONS_CREATE)({}, draftSession("draft-during-preparation", "zhouzhou"));

    expect(result).toMatchObject({ ok: true });
    const created = await repositories.sessions.getById("draft-during-preparation");
    expect(created).toMatchObject({
      status: "draft",
      memorySnapshot: {
        version: 2,
        enabled: true
      }
    });
    expect(created?.memorySnapshot).not.toHaveProperty("consultationMemo");
    expect(created?.memorySnapshot).not.toHaveProperty("sourceMemoId");
  });

  it("requeues interrupted preparation and letter work when the app reloads sessions", async () => {
    const ended = endedSession("ended-interrupted", "zhouzhou");
    await repositories.sessions.create(ended);
    await repositories.preparations.upsert({
      id: "preparation-interrupted",
      sessionId: ended.id,
      counselorId: ended.counselorId,
      sourceEndedAt: ended.endedAt!,
      modelName: "test",
      status: "processing",
      phase: "session-conceptualization",
      createdAt: ended.endedAt!,
      updatedAt: ended.endedAt!
    });
    await repositories.sessionLetters.markPendingForEndedCycle({
      id: `session-letter-${ended.id}`,
      sessionId: ended.id,
      counselorId: ended.counselorId,
      modelName: "test",
      now: ended.endedAt!
    }, ended.endedAt!);

    const result = await handler(IPC_CHANNELS.SESSIONS_LIST)({});
    expect(result).toMatchObject({ ok: true });

    await vi.waitFor(async () => {
      await expect(repositories.preparations.getBySessionId(ended.id)).resolves.toMatchObject({ status: "failed" });
      await expect(repositories.sessionLetters.getBySessionId(ended.id)).resolves.toMatchObject({ status: "failed" });
    });
  });

  it("freezes the last ready memo and does not wait for the just-ended consultation memo", async () => {
    const earlier = {
      ...endedSession("ended-with-ready-memo", "chengling"),
      endedAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:00.000Z"
    };
    await repositories.sessions.create(earlier);
    await repositories.memos.upsert({
      id: "memo-ready-earlier",
      preparationId: "preparation-ready-earlier",
      sourceSessionId: earlier.id,
      counselorId: earlier.counselorId,
      modelName: "test",
      memoMd: "上一份已经完成的咨询备忘录",
      status: "ready",
      createdAt: earlier.endedAt!,
      updatedAt: earlier.endedAt!
    });
    await repositories.sessions.create({ ...draftSession("active-current", "chengling"), status: "active" });
    await appendUserMessage(repositories, "active-current");

    const result = await handler(IPC_CHANNELS.SESSIONS_CREATE)(
      {},
      draftSession("draft-with-frozen-context", "chengling"),
      { replaceUnfinishedSessionId: "active-current" }
    );

    expect(result).toMatchObject({ ok: true });
    await expect(repositories.sessions.getById("draft-with-frozen-context")).resolves.toMatchObject({
      memorySnapshot: {
        enabled: true,
        consultationMemo: "上一份已经完成的咨询备忘录",
        sourceMemoId: "memo-ready-earlier"
      }
    });
  });

  it("rejects resuming old history while the same counselor has another unfinished session", async () => {
    await repositories.sessions.create({ ...draftSession("active-current", "chengling"), status: "active" });
    await repositories.sessions.create(endedSession("ended-old", "chengling"));

    const result = await handler(IPC_CHANNELS.SESSIONS_RESUME)({}, "ended-old");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("尚未完成") }
    });
    await expect(repositories.sessions.getById("ended-old")).resolves.toMatchObject({ status: "ended" });
  });

  it("rejects resuming an older ended session after a newer counselor session exists", async () => {
    await repositories.sessions.create({
      ...endedSession("ended-older", "chengling"),
      endedAt: "2026-07-12T11:00:00.000Z",
      updatedAt: "2026-07-12T11:00:00.000Z"
    });
    await repositories.sessions.create(endedSession("ended-newer", "chengling"));

    const result = await handler(IPC_CHANNELS.SESSIONS_RESUME)({}, "ended-older");

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("最近结束") }
    });
    await expect(repositories.sessions.getById("ended-older")).resolves.toMatchObject({ status: "ended" });
  });

  it("assigns a monotonic ending cycle even when the system clock repeats", async () => {
    const originalEndedAt = "2026-07-12T12:00:00.000Z";
    const session = endedSession("reended-same-clock", "chengling");
    await repositories.sessions.create(session);
    await appendUserMessage(repositories, session.id);
    await repositories.preparations.upsert({
      id: "preparation-original-cycle",
      sessionId: session.id,
      counselorId: session.counselorId,
      sourceEndedAt: originalEndedAt,
      modelName: "test",
      status: "ready",
      phase: "complete",
      createdAt: originalEndedAt,
      updatedAt: originalEndedAt
    });
    await expect(handler(IPC_CHANNELS.SESSIONS_RESUME)({}, session.id)).resolves.toMatchObject({ ok: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(originalEndedAt));

    await expect(handler(IPC_CHANNELS.SESSIONS_END)({}, session.id)).resolves.toMatchObject({ ok: true });

    await expect(repositories.sessions.getById(session.id)).resolves.toMatchObject({
      status: "ended",
      endedAt: "2026-07-12T12:00:00.001Z"
    });
  });

  it("deletes an empty active session instead of creating a letter or preparation", async () => {
    const session = { ...draftSession("active-empty", "chengling"), status: "active" as const };
    await repositories.sessions.create(session);

    await expect(handler(IPC_CHANNELS.SESSIONS_END)({}, session.id)).resolves.toMatchObject({ ok: true });

    await expect(repositories.sessions.getById(session.id)).resolves.toBeNull();
    await expect(repositories.preparations.getBySessionId(session.id)).resolves.toBeNull();
    await expect(repositories.sessionLetters.getBySessionId(session.id)).resolves.toBeNull();
  });

  it("also deletes a session that only contains a stray assistant status message", async () => {
    const session = { ...draftSession("active-assistant-only", "chengling"), status: "active" as const };
    await repositories.sessions.create(session);
    await repositories.messages.append({
      id: "assistant-only-status",
      sessionId: session.id,
      role: "assistant",
      content: "已停止，可重试。",
      createdAt: "2026-07-12T10:01:00.000Z",
      status: "failed"
    });

    await expect(handler(IPC_CHANNELS.SESSIONS_END)({}, session.id)).resolves.toMatchObject({ ok: true });

    await expect(repositories.sessions.getById(session.id)).resolves.toBeNull();
    await expect(repositories.sessionLetters.getBySessionId(session.id)).resolves.toBeNull();
  });

  it("cleans historical assistant-only active sessions before showing the session list", async () => {
    const session = { ...draftSession("historical-assistant-only", "chengling"), status: "active" as const };
    await repositories.sessions.create(session);
    await repositories.messages.append({
      id: "historical-status",
      sessionId: session.id,
      role: "assistant",
      content: "已停止，可重试。",
      createdAt: "2026-07-12T10:01:00.000Z",
      status: "failed"
    });

    const result = await handler(IPC_CHANNELS.SESSIONS_LIST)({});

    expect(result).toMatchObject({ ok: true, data: [] });
    await expect(repositories.sessions.getById(session.id)).resolves.toBeNull();
  });

  it("replacing an empty active session deletes it without queuing post-session work", async () => {
    await repositories.sessions.create({ ...draftSession("active-empty-replacement", "zhouzhou"), status: "active" });

    await expect(handler(IPC_CHANNELS.SESSIONS_CREATE)(
      {},
      draftSession("draft-after-empty", "zhouzhou"),
      { replaceUnfinishedSessionId: "active-empty-replacement" }
    )).resolves.toMatchObject({ ok: true });

    await expect(repositories.sessions.getById("active-empty-replacement")).resolves.toBeNull();
    await expect(repositories.sessions.getById("draft-after-empty")).resolves.toMatchObject({ status: "draft" });
    await expect(repositories.preparations.getBySessionId("active-empty-replacement")).resolves.toBeNull();
  });

  it("rejects stale external message, document, and letter writes for an ended session", async () => {
    const session = endedSession("ended-boundary", "chengling");
    await repositories.sessions.create(session);
    const message: SessionMessage = {
      id: "stale-message",
      sessionId: session.id,
      role: "user",
      content: "不应进入已结束会谈",
      createdAt: session.endedAt!,
      status: "failed"
    };
    const document: ImportedDocument = {
      id: "stale-document",
      sessionId: session.id,
      title: "过期资料.md",
      kind: "pasted-text",
      content: "不应写入",
      contentLength: 4,
      createdAt: session.endedAt!,
      status: "ready"
    };

    const [messageResult, documentResult] = await Promise.all([
      handler(IPC_CHANNELS.MESSAGES_APPEND)({}, message),
      handler(IPC_CHANNELS.DOCUMENTS_CREATE)({}, document)
    ]);
    const messageBatchResult = await handler(IPC_CHANNELS.MESSAGES_APPEND_MANY)({}, [message, {
      ...message,
      id: "stale-assistant",
      role: "assistant"
    }]);
    const regenerateResult = await handler(IPC_CHANNELS.SESSION_LETTERS_REGENERATE)({}, session.id);

    expect(messageResult).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(documentResult).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(messageBatchResult).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    // The ended session has no ready preparation, so regenerate must not create
    // a permanent pending letter.
    expect(regenerateResult).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    await expect(repositories.messages.listBySessionId(session.id)).resolves.toEqual([]);
    await expect(repositories.documents.listBySessionId(session.id)).resolves.toEqual([]);
    await expect(repositories.sessionLetters.getBySessionId(session.id)).resolves.toBeNull();
  });
});

function handler(channel: string) {
  const registered = ipcHandlers.get(channel);
  if (!registered) throw new Error(`Missing IPC handler: ${channel}`);
  return (...args: unknown[]) => {
    const [event, ...rest] = args;
    const eventValue = event && typeof event === "object" ? event as Record<string, unknown> : {};
    const nextEvent = {
      senderFrame: eventValue.senderFrame ?? { url: "file:///ling/dist/index.html" },
      sender: {
        getURL: () => "file:///ling/dist/index.html",
        isDestroyed: () => false,
        send: () => {},
        ...(eventValue.sender && typeof eventValue.sender === "object"
          ? eventValue.sender as Record<string, unknown>
          : {})
      }
    };
    return registered(nextEvent, ...rest);
  };
}

function isSuccess(result: unknown) {
  return Boolean(result && typeof result === "object" && (result as { ok?: unknown }).ok === true);
}

function draftSession(
  id: string,
  counselorId: string,
  promptSnapshot?: CounselingSession["promptSnapshot"]
): CounselingSession {
  const createdAt = "2026-07-12T10:00:00.000Z";
  return {
    id,
    title: "尚未开始的咨询",
    counselorId,
    roomThemeId: "warm-study",
    teamId: "one-way-mirror",
    modelName: "test",
    promptSnapshot,
    status: "draft",
    createdAt,
    startedAt: createdAt,
    updatedAt: createdAt
  };
}

function endedSession(id: string, counselorId: string): CounselingSession {
  const endedAt = "2026-07-12T12:00:00.000Z";
  return {
    ...draftSession(id, counselorId),
    status: "ended",
    endedAt,
    updatedAt: endedAt
  };
}

async function appendUserMessage(repositories: IpcRepositories, sessionId: string) {
  await repositories.messages.append({
    id: `message-${sessionId}`,
    sessionId,
    role: "user",
    content: "已经发送的内容",
    createdAt: "2026-07-12T10:01:00.000Z",
    status: "sent"
  });
}
