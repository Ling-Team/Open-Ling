import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CounselingSession, SessionLetter } from "@shared/index";
import { resetSettingsStore, useSettingsStore } from "../../../../stores/settingsStore";
import { resetSessionStore, useSessionStore, type PrototypeSession } from "../../../../stores/sessionStore";
import { SofaLettersFeature } from "./SofaLettersFeature";

const sessions: CounselingSession[] = [
  {
    id: "session-ready",
    title: "关于最近的疲惫",
    counselorId: "chengling",
    roomThemeId: "warm-study",
    teamId: "one-way-mirror",
    modelName: "deepseek-v4-pro",
    status: "ended",
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T09:00:00.000Z",
    endedAt: "2026-07-12T09:00:00.000Z"
  },
  {
    id: "session-failed",
    title: "一次没有说完的告别",
    counselorId: "zhouzhou",
    roomThemeId: "warm-study",
    teamId: "one-way-mirror",
    modelName: "deepseek-v4-pro",
    status: "ended",
    createdAt: "2026-07-09T08:00:00.000Z",
    updatedAt: "2026-07-09T09:00:00.000Z",
    endedAt: "2026-07-09T09:00:00.000Z"
  }
];

const readyLetter: SessionLetter = {
  id: "letter-ready",
  sessionId: "session-ready",
  counselorId: "chengling",
  modelName: "deepseek-v4-pro",
  status: "ready",
  letterMd: "亲爱的你：\n\n我记得你提到最近总觉得很疲惫。\n\n愿你先允许自己慢一点。",
  createdAt: "2026-07-12T09:01:00.000Z",
  updatedAt: "2026-07-12T09:01:00.000Z"
};

const failedLetter: SessionLetter = {
  id: "letter-failed",
  sessionId: "session-failed",
  counselorId: "zhouzhou",
  modelName: "deepseek-v4-pro",
  status: "failed",
  letterMd: "",
  errorMessage: "模型暂时不可用",
  createdAt: "2026-07-09T09:01:00.000Z",
  updatedAt: "2026-07-09T09:01:00.000Z"
};

describe("SofaLettersFeature", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
    resetSessionStore();
    resetSettingsStore();
  });

  it("loads real local letters into the two-column archive", async () => {
    const { sessionsList } = stubDesktopLetters([readyLetter, failedLetter]);
    render(<SofaLettersFeature />);

    expect((await screen.findAllByText("关于最近的疲惫")).length).toBeGreaterThan(0);
    expect(sessionsList).not.toHaveBeenCalled();
    expect(screen.getByRole("navigation", { name: "按咨询师筛选来信" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "来信列表" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "来信预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开完整信件" })).toBeInTheDocument();
    expect(screen.getAllByText("一次没有说完的告别").length).toBeGreaterThan(0);
    expect(screen.getByText("群心心理工作室")).toBeInTheDocument();
    expect(screen.getByText("PRIVATE LETTER ARCHIVE")).toBeInTheDocument();
  });

  it("filters letters by counselor and search", async () => {
    stubDesktopLetters([readyLetter, failedLetter]);
    render(<SofaLettersFeature />);
    await screen.findAllByText("关于最近的疲惫");

    fireEvent.click(screen.getByRole("button", { name: "周舟" }));
    expect(screen.queryByText("关于最近的疲惫")).not.toBeInTheDocument();
    expect(screen.getAllByText("一次没有说完的告别").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "全部咨询师" }));
    fireEvent.change(screen.getByPlaceholderText("搜索来信、会谈或咨询师"), { target: { value: "疲惫" } });
    expect(screen.getAllByText("关于最近的疲惫").length).toBeGreaterThan(0);
    expect(screen.queryByText("一次没有说完的告别")).not.toBeInTheDocument();
  });

  it("does not read full letter markdown until a text query needs it", async () => {
    const readLetterMarkdown = vi.fn(() => "正文里的唯一词");
    const trackedLetter = { ...failedLetter };
    Object.defineProperty(trackedLetter, "letterMd", { get: readLetterMarkdown });
    stubDesktopLetters([trackedLetter]);

    render(<SofaLettersFeature />);
    await screen.findAllByText("一次没有说完的告别");
    expect(readLetterMarkdown).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("搜索来信、会谈或咨询师"), { target: { value: "唯一词" } });
    await waitFor(() => expect(readLetterMarkdown).toHaveBeenCalled());
    expect(screen.getAllByText("一次没有说完的告别").length).toBeGreaterThan(0);
  });

  it("ignores an older load response that finishes after a newer refresh", async () => {
    const olderLoad = createDeferred<LetterListResult>();
    const newerLoad = createDeferred<LetterListResult>();
    const lettersList = vi.fn()
      .mockImplementationOnce(() => olderLoad.promise)
      .mockImplementationOnce(() => newerLoad.promise);
    stubDesktopLetters([], vi.fn(), lettersList);

    render(<SofaLettersFeature />);
    await waitFor(() => expect(lettersList).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(lettersList).toHaveBeenCalledTimes(2));

    await act(async () => {
      newerLoad.resolve({ ok: true, data: [readyLetter] });
      await newerLoad.promise;
    });
    expect((await screen.findAllByText("关于最近的疲惫")).length).toBeGreaterThan(0);

    await act(async () => {
      olderLoad.resolve({ ok: true, data: [failedLetter] });
      await olderLoad.promise;
    });
    expect(screen.getAllByText("关于最近的疲惫").length).toBeGreaterThan(0);
    expect(screen.queryByText("一次没有说完的告别")).not.toBeInTheDocument();
  });

  it("reuses the complete letter reader and closes it before the archive", async () => {
    useSettingsStore.setState({ profile: { displayName: "小满", background: "" } });
    stubDesktopLetters([readyLetter]);
    render(<SofaLettersFeature />);
    await screen.findAllByText("关于最近的疲惫");

    fireEvent.click(screen.getByRole("button", { name: "打开完整信件" }));
    const dialog = screen.getByRole("dialog", { name: "程灵写给你的信" });
    expect(within(dialog).getByText("小满：")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "程灵写给你的信" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "咨询师的信" })).toBeInTheDocument();
  });

  it("cleans a saved address label in both the preview and the full letter reader", async () => {
    useSettingsStore.setState({ profile: { displayName: "小满", background: "" } });
    stubDesktopLetters([{ ...readyLetter, letterMd: "小满：\n\n用户称呼：小满\n\n我记得你提到最近总觉得很疲惫。" }]);
    render(<SofaLettersFeature />);
    await screen.findAllByText("关于最近的疲惫");
    const preview = screen.getByRole("complementary", { name: "来信预览" });
    expect(within(preview).getByText("小满：")).toBeInTheDocument();
    expect(screen.queryByText(/用户称呼/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开完整信件" }));
    const dialog = screen.getByRole("dialog", { name: "程灵写给你的信" });
    expect(within(dialog).getAllByText("小满：")).toHaveLength(1);
    expect(within(dialog).queryByText(/用户称呼/)).not.toBeInTheDocument();
    expect(within(dialog).getByText("我记得你提到最近总觉得很疲惫。")).toBeInTheDocument();
  });

  it("opens a ready letter directly when its row is double-clicked", async () => {
    stubDesktopLetters([readyLetter]);
    render(<SofaLettersFeature />);
    const letterRows = await screen.findAllByRole("button", { name: /关于最近的疲惫/ });

    fireEvent.doubleClick(letterRows[0]);

    expect(screen.getByRole("dialog", { name: "程灵写给你的信" })).toBeInTheDocument();
  });

  it("regenerates a failed letter", async () => {
    const regenerate = vi.fn(async () => ({ ok: true as const, data: { ...failedLetter, status: "pending" as const } }));
    stubDesktopLetters([failedLetter], regenerate);
    render(<SofaLettersFeature />);
    await screen.findAllByText("一次没有说完的告别");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(regenerate).toHaveBeenCalledWith("session-failed");
  });

  it("shows the empty state without exposing private content", async () => {
    stubDesktopLetters([]);
    render(<SofaLettersFeature />);
    expect(await screen.findByText("还没有来信")).toBeInTheDocument();
    expect(screen.getByText(/结束一次咨询后/)).toBeInTheDocument();
  });
});

type LetterListResult = { ok: true; data: SessionLetter[] };

function stubDesktopLetters(
  letters: SessionLetter[],
  regenerate = vi.fn(),
  lettersList = vi.fn(async (): Promise<LetterListResult> => ({ ok: true, data: letters }))
) {
  useSessionStore.setState({
    sessions: sessions.map((session): PrototypeSession => ({
      ...session,
      messages: [],
      preview: "",
      time: ""
    }))
  });
  const sessionsList = vi.fn(async () => ({ ok: true as const, data: sessions }));
  vi.stubGlobal("lingDesktop", {
    sessions: { list: sessionsList },
    sessionLetters: {
      list: lettersList,
      regenerate
    }
  });
  return { lettersList, sessionsList };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
