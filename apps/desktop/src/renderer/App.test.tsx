import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { counselorStatusQuotePools } from "./content/counselorStatusQuotes";
import { markInformedConsentConfirmed } from "./flows/consultation/informedConsentStorage";
import { resetConsultationFlowStore, useConsultationFlowStore } from "./flows/consultation/consultationFlowStore";
import { resetAppStore, useAppStore } from "./stores/appStore";
import { resetSessionStore, useSessionStore, type PrototypeSession } from "./stores/sessionStore";
import { resetSettingsStore, useSettingsStore } from "./stores/settingsStore";
import type { CounselingSession, CounselingStreamEvent, MemoryItem, SessionLetter } from "@shared/index";

const imagePreloadMocks = vi.hoisted(() => ({
  preloadDecodedImage: vi.fn((_url?: string) => Promise.resolve())
}));

vi.mock("./media/imagePreload", async () => {
  const actual = await vi.importActual<typeof import("./media/imagePreload")>("./media/imagePreload");
  return { ...actual, preloadDecodedImage: imagePreloadMocks.preloadDecodedImage };
});

function startNewSessionFromEmptyState() {
  act(() => {
    void useSessionStore.getState().createSession({ counselorId: "chengling" });
    const sessionId = useSessionStore.getState().activeSessionId!;
    useConsultationFlowStore.getState().openActiveSession({ counselorId: "chengling", sessionId });
  });
}

function activateCurrentDraftForTest() {
  const session = useSessionStore.getState().sessions[0];
  if (!session) throw new Error("Expected a draft session");
  act(() => {
    useSessionStore.setState((state) => ({
      isSidebarCollapsed: false,
      sessions: state.sessions.map((item) => item.id === session.id ? { ...item, status: "active" } : item)
    }));
    useConsultationFlowStore.getState().openActiveSession({ counselorId: session.counselorId, sessionId: session.id });
  });
}

function addUserMessageToCurrentSessionForTest() {
  const session = useSessionStore.getState().sessions[0];
  if (!session) throw new Error("Expected an active session");
  act(() => {
    useSessionStore.setState((state) => ({
      sessions: state.sessions.map((item) => item.id === session.id
        ? {
            ...item,
            messages: [...item.messages, {
              id: `${item.id}-user-test`,
              sessionId: item.id,
              role: "user",
              content: "这是一条已发送的测试消息。",
              createdAt: new Date().toISOString(),
              status: "sent"
            }]
          }
        : item)
    }));
  });
}

async function renderApp() {
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(<App />);
  });
  return view!;
}

describe("Ling 首屏", () => {
  beforeEach(() => {
    imagePreloadMocks.preloadDecodedImage.mockReset();
    imagePreloadMocks.preloadDecodedImage.mockResolvedValue(undefined);
    window.localStorage.clear();
    resetAppStore();
    useAppStore.getState().setActivePage("room");
    resetSessionStore();
    resetConsultationFlowStore();
    resetSettingsStore();
    useSettingsStore.setState({
      api: {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "",
        apiKeySaved: true,
        modelName: "deepseek-v4-flash"
      }
    });
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("默认展示值班咨询师的等待室欢迎，而不是旧的像素移动测试场", async () => {
    useAppStore.getState().setActivePage("lobby");
    await renderApp();

    expect(screen.getByRole("dialog", { name: "咨询师的前台对话" })).toBeInTheDocument();
    advanceLobbyWelcomeToChoices();
    expect(screen.getByRole("button", { name: "我想预约心理咨询" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "等待室快捷入口" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "我先自己看看" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "进入现有咨询室" })).not.toBeInTheDocument();
  });

  it("值班咨询师引导预约后进入现有咨询室主页结构", async () => {
    useAppStore.getState().setActivePage("lobby");
    await renderApp();

    advanceLobbyWelcomeToChoices();
    fireEvent.click(screen.getByRole("button", { name: "我想预约心理咨询" }));
    markInformedConsentConfirmed("chengling");
    fireEvent.click(screen.getByRole("button", { name: "预约咨询" }));

    await screen.findByRole("region", { name: "进入咨询室" });
    activateCurrentDraftForTest();

    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "会谈记录" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("button", { name: "咨询师" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "咨询团队" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "记忆" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结束当前咨询并与这位咨询师开始新会谈" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /与程灵的会谈/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结束本次咨询" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回等待室" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "语音输入占位" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加附件" })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("先开始一个新的会谈。")).not.toBeInTheDocument();
    expect(screen.getByLabelText("会谈输入框")).not.toBeDisabled();
    expect(screen.getByAltText("程灵咨询师形象")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "当前会谈信息" })).toBeInTheDocument();
    expect(screen.queryByText("AI 会谈支持流程")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前咨询师/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前团队/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前咨询团队/)).not.toBeInTheDocument();
    expect(screen.queryByText(/会谈状态/)).not.toBeInTheDocument();
    expect(screen.queryByText(/查看会谈总结/)).not.toBeInTheDocument();
    expect(screen.queryByText(/打开记忆/)).not.toBeInTheDocument();
    expect(screen.queryByText(/导出会谈/)).not.toBeInTheDocument();
    expect(screen.queryByText(/不能替代现实中的专业帮助/)).not.toBeInTheDocument();
  });

  it("可以从咨询界面右上角返回等待室", async () => {
    await renderApp();
    startNewSessionFromEmptyState();

    fireEvent.click(screen.getByRole("button", { name: "返回等待室" }));

    expect(screen.getByRole("region", { name: "群心心理工作室 · 等待室" })).toBeInTheDocument();
    expect(useAppStore.getState().activePage).toBe("lobby");
  });

  it("首次启动没有本地会谈时显示空状态而不是示例会谈", async () => {
    await renderApp();

    const messageStream = screen.getByLabelText("消息流");
    expect(within(messageStream).getByRole("heading", { name: "还没有会谈" })).toBeInTheDocument();
    expect(within(messageStream).getByRole("button", { name: "开始新会谈" })).toBeInTheDocument();
    expect(within(messageStream).queryByText("本地保存")).not.toBeInTheDocument();
    expect(within(messageStream).queryByText(/开始一次新的会谈后/)).not.toBeInTheDocument();
    expect(screen.queryByText("关于最近的疲惫感")).not.toBeInTheDocument();
    expect(screen.queryByText("关系里的反复拉扯")).not.toBeInTheDocument();
    expect(screen.queryByText("一次自我整理")).not.toBeInTheDocument();
    expect(screen.getByLabelText("会谈输入框")).toBeDisabled();

    startNewSessionFromEmptyState();
    expect(screen.getByRole("heading", { name: /与程灵的会谈/ })).toBeInTheDocument();
    expect(screen.getByLabelText("会谈输入框")).not.toBeDisabled();
  });

  it("结束本次咨询后进入收尾流程并锁定输入", async () => {
    const end = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", {
      sessions: { end }
    });
    await renderApp();
    startNewSessionFromEmptyState();
    addUserMessageToCurrentSessionForTest();

    fireEvent.click(screen.getByRole("button", { name: "结束本次咨询" }));
    fireEvent.click(screen.getByRole("button", { name: "确认结束" }));

    await waitFor(() => expect(end).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "跳过收尾" })).toBeInTheDocument();
    expect(screen.queryByLabelText("会谈输入框")).not.toBeInTheDocument();
  });

  it("结束后只显示清楚的咨询整理进度", async () => {
    const end = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const getBySessionId = vi.fn(async (sessionId: string) => ({
      ok: true as const,
      data: {
        id: "preparation-1",
        sessionId,
        counselorId: "chengling",
        sourceEndedAt: "2026-07-11T10:00:00.000Z",
        modelName: "deepseek-v4-pro",
        status: "processing" as const,
        phase: "supervision" as const,
        createdAt: "2026-07-11T10:00:00.000Z",
        updatedAt: "2026-07-11T10:01:00.000Z"
      }
    }));
    vi.stubGlobal("lingDesktop", {
      sessions: { end },
      consultationPreparations: { getBySessionId, retry: vi.fn() }
    });
    await renderApp();
    startNewSessionFromEmptyState();
    addUserMessageToCurrentSessionForTest();

    fireEvent.click(screen.getByRole("button", { name: "结束本次咨询" }));
    fireEvent.click(screen.getByRole("button", { name: "确认结束" }));
    fireEvent.click(await screen.findByRole("button", { name: "跳过收尾" }));
    act(() => {
      const endedSession = useSessionStore.getState().sessions[0];
      useConsultationFlowStore.getState().openPersistedSession({
        counselorId: "chengling",
        sessionId: endedSession.id,
        status: "ended"
      });
    });

    expect(await screen.findByRole("heading", { name: "正在整理" })).toBeInTheDocument();
    expect(screen.getByText("Ling 正在整理这次咨询，并准备咨询师来信。你可以先返回等待室，处理会继续进行。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回等待室" })).toBeInTheDocument();
    expect(screen.queryByText(/督导|备忘录|内部复核/)).not.toBeInTheDocument();
  });

  it("启动时加载本地保存的模型设置供咨询室直接使用", async () => {
    const read = vi.fn(async () => ({
      ok: true as const,
      data: {
        api: {
          apiBaseUrl: "https://api.loaded.example",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...ed",
          modelName: "loaded-model"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read } });

    await renderApp();

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().api).toMatchObject({
      apiBaseUrl: "https://api.loaded.example",
      apiKey: "",
      apiKeySaved: true,
      modelName: "loaded-model"
    });
  });

  it("启动时把本地个人头像同步到咨询室用户消息头像", async () => {
    const read = vi.fn(async () => ({
      ok: true as const,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          modelName: "deepseek-v4-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study",
        profile: {
          displayName: "Bella",
          background: "",
          avatarDataUrl: "data:image/png;base64,YXZhdGFy",
          avatarFileName: "avatar.png"
        }
      }
    }));
    vi.stubGlobal("lingDesktop", {
      settings: { read },
      counseling: {
        streamMessage: vi.fn(async (_request, handlers) => {
          handlers.onEvent({ requestId: _request.requestId, type: "done", content: "我听见了。" });
          return { ok: true as const, data: { requestId: _request.requestId } };
        })
      },
      messages: { append: vi.fn(async () => ({ ok: true as const, data: undefined })) }
    });

    await renderApp();

    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    startNewSessionFromEmptyState();
    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), {
      target: { value: "测试头像。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getAllByAltText("Bella头像")[0]).toHaveAttribute("src", "data:image/png;base64,YXZhdGFy");
  });

  it("收到会谈变更通知后刷新会谈标题", async () => {
    let onSessionChanged: ((sessionId: string) => void) | undefined;
    vi.stubGlobal("lingDesktop", {
      settings: {
        read: vi.fn(async () => ({ ok: true, data: null }))
      },
      app: {
        onNewSessionShortcut: vi.fn(() => vi.fn()),
        onSessionChanged: vi.fn((callback: (sessionId: string) => void) => {
          onSessionChanged = callback;
          return vi.fn();
        })
      },
      sessions: {
        list: vi.fn(async () => ({
          ok: true,
          data: [
            {
              id: "session-fatigue",
              title: "旧标题",
              counselorId: "chengling",
              roomThemeId: "warm-study",
              teamId: "one-way-mirror",
              modelName: "deepseek-v4-flash",
              createdAt: "2026-07-05T10:00:00.000Z",
              updatedAt: "2026-07-05T10:01:00.000Z",
              status: "active"
            }
          ]
        })),
        get: vi.fn(async () => ({
          ok: true,
          data: {
            id: "session-fatigue",
            title: "工作压力",
            counselorId: "chengling",
            roomThemeId: "warm-study",
            teamId: "one-way-mirror",
            modelName: "deepseek-v4-flash",
            createdAt: "2026-07-05T10:00:00.000Z",
            updatedAt: "2026-07-05T10:02:00.000Z",
            status: "active",
            summary: "最近在谈工作压力。"
          }
        }))
      },
      messages: {
        listBySessionId: vi.fn(async () => ({ ok: true, data: [] }))
      }
    });
    await renderApp();
    await waitFor(() => expect(window.lingDesktop?.app?.onSessionChanged).toHaveBeenCalledTimes(1));

    act(() => {
      onSessionChanged?.("session-fatigue");
    });

    await waitFor(() => expect(screen.getByRole("heading", { name: "工作压力" })).toBeInTheDocument());
  });

  it("支持主页会谈原型交互", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("dev server unavailable");
    }));
    await renderApp();
    startNewSessionFromEmptyState();

    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), {
      target: { value: "我今天有点焦虑。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const messageStream = screen.getByLabelText("消息流");
    expect(within(messageStream).getByText("我今天有点焦虑。")).toBeInTheDocument();
    expect(await within(messageStream).findByText("网页测试连接失败，请检查本地 dev server。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "会谈记录" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭会谈记录" }));
    expect(screen.getByRole("button", { name: "会谈记录" })).toHaveAttribute("aria-expanded", "false");
  });

  it("支持 Command+N 直接新建会谈，不再跳转预约页", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const previousSessionId = useSessionStore.getState().activeSessionId;

    fireEvent.keyDown(document, { key: "n", metaKey: true });

    await waitFor(() => expect(useSessionStore.getState().activeSessionId).not.toBe(previousSessionId));
    expect(screen.getByRole("region", { name: "进入咨询室" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "预约咨询" })).not.toBeInTheDocument();
  });

  it("支持右键重命名会谈", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const recordsButton = screen.getByRole("button", { name: "会谈记录" });
    if (recordsButton.getAttribute("aria-expanded") === "false") fireEvent.click(recordsButton);
    const sessionList = screen.getByRole("complementary", { name: "会谈记录" });
    const firstSessionButton = within(sessionList).getByText(/与程灵的会谈/).closest("button");
    expect(firstSessionButton).toBeTruthy();

    fireEvent.contextMenu(firstSessionButton!);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const renameInput = screen.getByLabelText("重命名会谈");
    fireEvent.change(renameInput, { target: { value: "用户改过的标题" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    await waitFor(() => expect(within(sessionList).getByText("用户改过的标题")).toBeInTheDocument());
    const renamedSessionButton = within(sessionList).getByText("用户改过的标题").closest("button");
    expect(renamedSessionButton).toBeTruthy();
  });

  it("停止生成后忽略迟到的流式片段，并显示可重试状态", async () => {
    let onEvent: ((event: CounselingStreamEvent) => void) | undefined;
    let requestId = "";
    const cancel = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", {
      platform: "darwin",
      counseling: {
        streamMessage: vi.fn((_request, handlers) => {
          requestId = _request.requestId;
          onEvent = handlers.onEvent;
          return Promise.resolve({ ok: true as const, data: { requestId: _request.requestId } });
        }),
        cancel
      }
    });
    useSettingsStore.setState({
      api: {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "sk-test",
        modelName: "deepseek-v4-flash"
      }
    });
    await renderApp();
    startNewSessionFromEmptyState();

    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), {
      target: { value: "我想测试停止。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();
    expect(screen.getAllByText("程灵正在听你说").length).toBeGreaterThan(0);
    expect(screen.queryByText("正在连接 DeepSeek")).not.toBeInTheDocument();
    const messageStream = screen.getByLabelText("消息流");
    expect(within(messageStream).getByText("程灵正在听你说")).toBeInTheDocument();
    expect(within(messageStream).queryByText("正在连接你的模型，稍等一下。")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "停止" }));
    await act(async () => {
      onEvent?.({ requestId, type: "chunk", content: "不该出现" });
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("不该出现")).not.toBeInTheDocument();
    expect(screen.getByText("已停止，可重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("另一个会谈正在生成时不会清空当前会谈输入", async () => {
    const streamMessage = vi.fn((_request, handlers) => {
      handlers.onEvent({ requestId: _request.requestId, type: "status", status: "streaming" });
      return new Promise(() => undefined);
    });
    vi.stubGlobal("lingDesktop", {
      platform: "darwin",
      counseling: {
        streamMessage,
        cancel: vi.fn(async () => ({ ok: true as const, data: undefined }))
      }
    });
    useSettingsStore.setState({
      api: {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "sk-test",
        modelName: "deepseek-v4-flash"
      }
    });
    await renderApp();
    startNewSessionFromEmptyState();

    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), {
      target: { value: "第一场会谈正在生成。" }
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument();

    const newSessionButton = screen.getByRole("button", { name: "结束当前咨询并与这位咨询师开始新会谈" });
    expect(newSessionButton).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), {
      target: { value: "切换后先写下这一句。" }
    });

    expect(screen.getByPlaceholderText("慢慢说，发生了什么？")).toHaveValue("切换后先写下这一句。");
    expect(streamMessage).toHaveBeenCalledTimes(1);
  });

  it("切换会谈时隔离并恢复各自的未发送草稿", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const firstSessionId = useSessionStore.getState().activeSessionId!;
    let secondSessionId = "";
    const composer = screen.getByPlaceholderText("慢慢说，发生了什么？");

    fireEvent.change(composer, {
      target: { value: "这是疲惫会谈里还没发送的话。" }
    });
    act(() => {
      void useSessionStore.getState().createSession({ counselorId: "chengling" });
      const nextSession = useSessionStore.getState().sessions[0];
      secondSessionId = nextSession.id;
      useConsultationFlowStore.getState().openActiveSession({ counselorId: "chengling", sessionId: nextSession.id });
    });

    expect(screen.getByPlaceholderText("慢慢说，发生了什么？")).toHaveValue("");

    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), {
      target: { value: "这是关系会谈里的草稿。" }
    });
    act(() => {
      useSessionStore.getState().setActiveSession(firstSessionId);
      useConsultationFlowStore.getState().openActiveSession({ counselorId: "chengling", sessionId: firstSessionId });
    });

    expect(screen.getByPlaceholderText("慢慢说，发生了什么？")).toHaveValue("这是疲惫会谈里还没发送的话。");

    act(() => {
      useSessionStore.getState().setActiveSession(secondSessionId);
      useConsultationFlowStore.getState().openActiveSession({ counselorId: "chengling", sessionId: secondSessionId });
    });

    expect(screen.getByPlaceholderText("慢慢说，发生了什么？")).toHaveValue("这是关系会谈里的草稿。");
  });

  it("按 Enter 直接发送当前输入", async () => {
    vi.stubGlobal("lingDesktop", {
      counseling: {
        streamMessage: vi.fn(async (_request, handlers) => {
          handlers.onEvent({ requestId: _request.requestId, type: "done", content: "我听见了。" });
          return { ok: true as const, data: { requestId: _request.requestId } };
        })
      },
      messages: { append: vi.fn(async () => ({ ok: true as const, data: undefined })) }
    });
    await renderApp();
    startNewSessionFromEmptyState();
    const composer = screen.getByPlaceholderText("慢慢说，发生了什么？");

    fireEvent.change(composer, {
      target: { value: "我想用回车发送。" }
    });
    await act(async () => {
      fireEvent.keyDown(composer, { key: "Enter" });
    });

    const messageStream = screen.getByLabelText("消息流");
    expect(within(messageStream).getByText("我想用回车发送。")).toBeInTheDocument();
    expect(composer).toHaveValue("");
  });

  it("Shift Enter 和 Option Enter 只保留草稿不发送", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const composer = screen.getByPlaceholderText("慢慢说，发生了什么？");
    const messageStream = screen.getByLabelText("消息流");

    fireEvent.change(composer, {
      target: { value: "这句话还只是草稿。" }
    });
    fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });

    expect(within(messageStream).queryByText("这句话还只是草稿。")).not.toBeInTheDocument();
    expect(composer).toHaveValue("这句话还只是草稿。");

    fireEvent.keyDown(composer, { key: "Enter", altKey: true });

    expect(within(messageStream).queryByText("这句话还只是草稿。")).not.toBeInTheDocument();
    expect(composer).toHaveValue("这句话还只是草稿。");
  });

  it("允许添加支持格式的待发送附件", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const fileInput = screen.getByLabelText("选择附件文件");
    const file = new File(["一些记录"], "会谈记录.md", { type: "text/markdown" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByText("会谈记录.md")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("拦截不支持的附件格式并保留输入区", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const fileInput = screen.getByLabelText("选择附件文件");
    const blockedFile = new File(["echo"], "run.exe", { type: "application/x-msdownload" });

    fireEvent.change(fileInput, { target: { files: [blockedFile] } });

    expect(screen.getByRole("alert")).toHaveTextContent("暂不支持 run.exe 的格式。请选择图片、TXT、Markdown、PDF、DOC 或 DOCX 文件；PDF 和 Word 当前只保存文件记录，不读取正文。");
    expect(screen.queryByText("run.exe")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("慢慢说，发生了什么？")).toBeInTheDocument();
  });

  it("混合选择支持和不支持格式时只保留支持的附件并提示被拦截项", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const fileInput = screen.getByLabelText("选择附件文件");
    const acceptedFile = new File(["一些记录"], "会谈记录.txt", { type: "text/plain" });
    const blockedFile = new File(["echo"], "run.exe", { type: "application/x-msdownload" });

    fireEvent.change(fileInput, { target: { files: [acceptedFile, blockedFile] } });

    expect(screen.getByText("会谈记录.txt")).toBeInTheDocument();
    expect(screen.queryByText("run.exe")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("暂不支持 run.exe 的格式。请选择图片、TXT、Markdown、PDF、DOC 或 DOCX 文件；PDF 和 Word 当前只保存文件记录，不读取正文。");
  });

  it("发送文本附件时保存为本地资料并随消息进入流式请求", async () => {
    const createDocument = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const streamMessage = vi.fn(async (_request, handlers) => {
      handlers.onEvent({ requestId: _request.requestId, type: "done", content: "我会结合附件看。" });
      return { ok: true as const, data: { requestId: _request.requestId } };
    });
    vi.stubGlobal("lingDesktop", {
      documents: { create: createDocument },
      counseling: { streamMessage },
      messages: { append: vi.fn(async () => ({ ok: true as const, data: undefined })) }
    });
    await renderApp();
    startNewSessionFromEmptyState();
    const fileInput = screen.getByLabelText("选择附件文件");
    const composer = screen.getByPlaceholderText("慢慢说，发生了什么？");
    const fileContent = "这是附件里的文字。";

    fireEvent.change(fileInput, {
      target: { files: [new File([fileContent], "会谈记录.txt", { type: "text/plain" })] }
    });
    expect(await screen.findByText("会谈记录.txt")).toBeInTheDocument();
    fireEvent.change(composer, {
      target: { value: "请帮我看这个附件。" }
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
    });

    await waitFor(() => expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({
      title: "会谈记录.txt",
      content: fileContent,
      contentLength: fileContent.length,
      status: "ready"
    })));
    expect(screen.getByLabelText("消息附件")).toHaveTextContent("会谈记录.txt");
    await waitFor(() => expect(streamMessage).toHaveBeenCalled());
    const request = vi.mocked(streamMessage).mock.calls[0][0];
    expect(request.message.content).toBe("请帮我看这个附件。");
    expect(request.message.metadata).toMatchObject({
      importedDocuments: [expect.objectContaining({ title: "会谈记录.txt", contentLength: fileContent.length })],
      attachments: [expect.objectContaining({ title: "会谈记录.txt", status: "context-ready" })]
    });
    expect(JSON.stringify(request.message)).not.toContain(fileContent);
    expect(composer).toHaveValue("");
    expect(screen.queryByText("会谈记录.txt")).toBeInTheDocument();
  });

  it("使用 DeepSeek 视觉模型时把图片随当前消息发送给模型", async () => {
    const streamMessage = vi.fn(async (_request, handlers) => {
      handlers.onEvent({ requestId: _request.requestId, type: "done", content: "我看到图片了。" });
      return { ok: true as const, data: { requestId: _request.requestId } };
    });
    vi.stubGlobal("lingDesktop", {
      counseling: { streamMessage },
      messages: { append: vi.fn(async () => ({ ok: true as const, data: undefined })) }
    });
    useSettingsStore.setState((state) => ({
      api: { ...state.api, modelName: "deepseek-v4-flash-vision-exp" }
    }));
    await renderApp();
    startNewSessionFromEmptyState();

    fireEvent.change(screen.getByLabelText("选择附件文件"), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" })] }
    });
    expect(await screen.findByText("photo.png")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("慢慢说，发生了什么？"), { target: { value: "这张图里有什么？" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
    });

    await waitFor(() => expect(streamMessage).toHaveBeenCalled());
    const request = vi.mocked(streamMessage).mock.calls[0][0];
    expect(request.api.modelName).toBe("deepseek-flash");
    expect(request.imageInputs).toEqual([
      expect.objectContaining({ name: "photo.png", mimeType: "image/png", dataUrl: expect.stringMatching(/^data:image\/png;base64,/) })
    ]);
    expect(request.message.metadata).toMatchObject({
      attachments: [expect.objectContaining({ title: "photo.png", kind: "image", status: "context-ready" })]
    });
    expect(screen.getByLabelText("消息附件")).toHaveTextContent("已发送给模型识别");
  }, 15_000);

  it("发送纯附件时不在用户气泡里生成额外说明文案", async () => {
    const createDocument = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const streamMessage = vi.fn(async (_request, handlers) => {
      handlers.onEvent({ requestId: _request.requestId, type: "done", content: "我看到了这份附件。" });
      return { ok: true as const, data: { requestId: _request.requestId } };
    });
    vi.stubGlobal("lingDesktop", {
      documents: { create: createDocument },
      counseling: { streamMessage },
      messages: { append: vi.fn(async () => ({ ok: true as const, data: undefined })) }
    });
    await renderApp();
    startNewSessionFromEmptyState();
    const fileInput = screen.getByLabelText("选择附件文件");
    const fileContent = "这是纯附件消息里的文字。";

    fireEvent.change(fileInput, {
      target: { files: [new File([fileContent], "纯附件.txt", { type: "text/plain" })] }
    });
    expect(await screen.findByText("纯附件.txt")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "发送" }));
    });

    await waitFor(() => expect(streamMessage).toHaveBeenCalled());
    const request = vi.mocked(streamMessage).mock.calls[0][0];
    expect(request.message.content).toBe(" ");
    expect(request.message.metadata).toMatchObject({
      importedDocuments: [expect.objectContaining({ title: "纯附件.txt", contentLength: fileContent.length })],
      attachments: [expect.objectContaining({ title: "纯附件.txt", status: "context-ready" })]
    });
    expect(screen.getByLabelText("消息附件")).toHaveTextContent("纯附件.txt");
    expect(screen.queryByText(/我发送了以下资料附件/)).not.toBeInTheDocument();
    expect(screen.queryByText(/请结合这些资料继续和我讨论/)).not.toBeInTheDocument();
  });

  it("从等待室打开木框设置后保留原页背景并可关闭", async () => {
    useAppStore.getState().setActivePage("lobby");
    await renderApp();
    advanceLobbyWelcomeToChoices();
    fireEvent.click(screen.getByRole("button", { name: "我先自己看看" }));

    fireEvent.click(screen.getByRole("button", { name: "系统设置" }));

    expect(screen.getByRole("dialog", { name: "系统设置" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "群心心理工作室 · 等待室" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Ling 设置" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Ling 设置分类" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型接入" })).toBeInTheDocument();
    expect(screen.getByAltText("群心心理工作室标识")).toBeInTheDocument();
    expect(screen.getByText("SETTINGS · 群心心理工作室")).toBeInTheDocument();
    expect(screen.getByText("SETTINGS · 群心心理工作室")).toBeInTheDocument();
    expect(screen.queryByText("心理工作室")).not.toBeInTheDocument();
    expect(screen.getByText("SETTINGS · 群心心理工作室").closest(".settings-sidebar")).toContainElement(
      screen.getByRole("navigation", { name: "Ling 设置分类" })
    );
    expect(screen.queryByRole("button", { name: "咨询团队" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "咨询师" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭系统设置" }));
    expect(screen.getByRole("region", { name: "群心心理工作室 · 等待室" })).toBeInTheDocument();
  });

  it("从正式咨询页打开设置时保留咨询室和当前会谈流程", async () => {
    await renderApp();
    startNewSessionFromEmptyState();
    const activeFlow = useConsultationFlowStore.getState().flow;

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(useAppStore.getState()).toMatchObject({ activePage: "settings", settingsOriginPage: "room" });
    expect(useConsultationFlowStore.getState().flow).toEqual(activeFlow);
    expect(screen.getByRole("region", { name: "程灵的咨询室" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "系统设置" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭系统设置" }));
    expect(useAppStore.getState().activePage).toBe("room");
    expect(useConsultationFlowStore.getState().flow).toEqual(activeFlow);
    expect(screen.getByRole("region", { name: "程灵的咨询室" })).toBeInTheDocument();
  });

  it("选择周舟后咨询室同步周舟立绘和统一背景", async () => {
    await renderApp();

    act(() => {
      useSessionStore.getState().bookCounselor("zhouzhou");
      useAppStore.getState().setActivePage("room");
    });
    await act(async () => {
      await useSessionStore.getState().openBookedCounselorSession();
    });

    await waitFor(() => expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-default-runtime-1280w-v1")
    ));
    expect(screen.getByLabelText("周舟的咨询室").style.getPropertyValue("--room-theme-image")).toContain(
      "zhouzhou-session-one-chair-room-final-v1"
    );
    expect(screen.getByLabelText("周舟的咨询室").style.getPropertyValue("--portrait-backdrop-opacity")).toBe("0");
  });

  it("周舟会在来访者输入时切换到输入倾听立绘", async () => {
    await renderApp();

    act(() => {
      useSessionStore.getState().bookCounselor("zhouzhou");
      useAppStore.getState().setActivePage("room");
    });
    await act(async () => {
      await useSessionStore.getState().openBookedCounselorSession();
    });

    await waitFor(() => expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-default-runtime-1280w-v1")
    ));
    fireEvent.change(screen.getByLabelText("会谈输入框"), {
      target: { value: "我正在输入一些想法。" }
    });

    await waitFor(() => expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-listening-runtime-1280w-v1")
    ));
  });

  it("周舟在输入框仍有文字时会保留倾听态一段较长时间", async () => {
    await renderApp();

    act(() => {
      useSessionStore.getState().bookCounselor("zhouzhou");
      useAppStore.getState().setActivePage("room");
    });
    await act(async () => {
      await useSessionStore.getState().openBookedCounselorSession();
    });

    await waitFor(() => expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-default-runtime-1280w-v1")
    ));
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText("会谈输入框"), {
      target: { value: "我写到一半，停下来想一想。" }
    });

    await act(async () => Promise.resolve());
    expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-listening-runtime-1280w-v1")
    );

    act(() => {
      vi.advanceTimersByTime(9900);
    });

    expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-listening-runtime-1280w-v1")
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(screen.getByAltText("周舟咨询师形象")).toHaveAttribute(
      "src",
      expect.stringContaining("zhouzhou-session-default-runtime-1280w-v1")
    );
  });

  it("支持从等待室沙发进入咨询师的信并查看历史来信", async () => {
    const persistedSessions: CounselingSession[] = [
      {
        id: "session-letter-ready",
        title: "关于边界感的会谈",
        counselorId: "chengling",
        roomThemeId: "warm-study",
        teamId: "one-way-mirror",
        modelName: "deepseek-v4-pro",
        createdAt: "2026-07-04T09:00:00.000Z",
        updatedAt: "2026-07-04T10:00:00.000Z",
        endedAt: "2026-07-04T10:00:00.000Z",
        status: "ended"
      },
      {
        id: "session-letter-pending",
        title: "一次关于疲惫的会谈",
        counselorId: "zhouzhou",
        roomThemeId: "warm-study",
        teamId: "one-way-mirror",
        modelName: "deepseek-v4-pro",
        createdAt: "2026-07-05T09:00:00.000Z",
        updatedAt: "2026-07-05T10:00:00.000Z",
        endedAt: "2026-07-05T10:00:00.000Z",
        status: "ended"
      }
    ];
    const persistedLetters: SessionLetter[] = [
      {
        id: "session-letter-ready-id",
        sessionId: "session-letter-ready",
        counselorId: "chengling",
        modelName: "deepseek-v4-pro",
        letterMd: "亲爱的你：\n\n我记得你说，自己好像总是在照顾别人的情绪。\n\n程灵",
        status: "ready",
        createdAt: "2026-07-04T10:01:00.000Z",
        updatedAt: "2026-07-04T10:01:00.000Z"
      },
      {
        id: "session-letter-pending-id",
        sessionId: "session-letter-pending",
        counselorId: "zhouzhou",
        modelName: "deepseek-v4-pro",
        letterMd: "",
        status: "pending",
        createdAt: "2026-07-05T10:01:00.000Z",
        updatedAt: "2026-07-05T10:01:00.000Z"
      }
    ];
    vi.stubGlobal("lingDesktop", {
      sessions: {
        list: vi.fn(async () => ({ ok: true, data: persistedSessions }))
      },
      sessionLetters: {
        list: vi.fn(async () => ({ ok: true, data: persistedLetters })),
        regenerate: vi.fn(async () => ({ ok: true, data: persistedLetters[0] }))
      }
    });
    useSessionStore.setState({
      sessions: persistedSessions.map((session): PrototypeSession => ({
        ...session,
        messages: [],
        preview: "",
        time: ""
      }))
    });

    useAppStore.getState().setActivePage("lobby");
    window.localStorage.setItem("ling.lobby.hasSeenWelcome", "true");
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "咨询师的信" }));

    expect(screen.getByRole("heading", { name: "咨询师的信" })).toBeInTheDocument();
    expect(screen.getByText("不必急着读完")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "全部咨询师" })).toHaveAttribute("aria-pressed", "true");
    expect((await screen.findAllByText("关于边界感的会谈")).length).toBeGreaterThan(0);
    expect(screen.getByText("一次关于疲惫的会谈")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关于边界感的会谈" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "程灵" }));

    expect(screen.getByRole("button", { name: "程灵" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("关于边界感的会谈").length).toBeGreaterThan(0);
    expect(screen.queryByText("一次关于疲惫的会谈")).not.toBeInTheDocument();
  });

  it("设置导航不再保留重复的咨询师来信入口", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.queryByRole("button", { name: "咨询师的信" })).not.toBeInTheDocument();
  });

  it("支持在设置内进入Ling 设置并切换基础设置分类", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByRole("navigation", { name: "Ling 设置分类" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型接入" })).toBeInTheDocument();
    expect(screen.getAllByText("DeepSeek").length).toBeGreaterThan(0);
    expect(screen.queryByText("后续开放")).not.toBeInTheDocument();
    expect(screen.queryByText("模型用途分配")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "接入说明" })).toBeInTheDocument();
    expect(screen.queryByText("通义千问 / Qwen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存配置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 API Key" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));
    expect(screen.getByRole("heading", { name: "个人资料" })).toBeInTheDocument();
    expect(screen.getByLabelText("你希望咨询师如何称呼你？")).toBeInTheDocument();
    expect(screen.getByText("你愿意让咨询师提前知道的背景")).toBeInTheDocument();
    expect(screen.getByText("更换头像")).toBeInTheDocument();
    expect(screen.getByText(/头像只保存在这台设备上，用于界面显示，不会发送给模型/)).toBeInTheDocument();
    expect(screen.queryByText("当前状态")).not.toBeInTheDocument();
    expect(screen.queryByText("时区")).not.toBeInTheDocument();
    expect(screen.queryByText("常用语言")).not.toBeInTheDocument();
    expect(screen.getByText("保存个人资料")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /数据与隐私/ }));
    expect(screen.getByRole("heading", { name: "数据与隐私" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "导出会谈与来信" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出会谈与来信" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只导出会谈" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只导出咨询师的信" })).toBeInTheDocument();
    expect(screen.queryByText("模型服务")).not.toBeInTheDocument();
    expect(screen.queryByText("云同步和遥测")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级设置/ })).not.toBeInTheDocument();
  });
});

function advanceLobbyWelcomeToChoices() {
  const panel = screen.getByRole("button", { name: /显示完整对白|继续/ });
  if (panel.getAttribute("aria-label") === "显示完整对白") fireEvent.click(panel);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasVisibleCounselorStatusQuote(counselorId: keyof typeof counselorStatusQuotePools) {
  return counselorStatusQuotePools[counselorId].some((quote) => {
    const lines = quote.split("\n").filter(Boolean);
    return lines.every((line) => screen.queryByText(new RegExp(escapeRegExp(line))) !== null);
  });
}
