import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSettingsStore, useSettingsStore } from "../../../stores/settingsStore";
import { SettingsSystemPage } from "./SettingsSystemPage";

function createPngFile(name: string, width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new File([bytes], name, { type: "image/png" });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("SettingsSystemPage profile settings", () => {
  beforeEach(() => {
    resetSettingsStore();
    vi.unstubAllGlobals();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:ling-profile-avatar"),
      revokeObjectURL: vi.fn()
    });
  });

  it("shows the desktop application's version in the settings navigation", async () => {
    vi.stubGlobal("lingDesktop", {
      getAppInfo: vi.fn(async () => ({ ok: true, data: { name: "Ling", version: "1.0.0", mode: "development" } }))
    });

    render(<SettingsSystemPage />);

    expect(await screen.findByText("Ling · v1.0.0")).toBeInTheDocument();
  });

  it("opens the official download page for an available update", async () => {
    const openDownloadPage = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", {
      getAppInfo: vi.fn(async () => ({ ok: true, data: { name: "Ling", version: "1.0.0", mode: "production" } })),
      updates: {
        getStatus: vi.fn(async () => ({
          ok: true,
          data: { state: "available", currentVersion: "1.0.0", availableVersion: "1.0.1" }
        })),
        check: vi.fn(),
        openDownloadPage,
        onStatusChanged: vi.fn(() => () => undefined)
      }
    });

    render(<SettingsSystemPage />);

    fireEvent.click(await screen.findByRole("button", { name: "新版本 v1.0.1 · 前往官网下载" }));
    await waitFor(() => expect(openDownloadPage).toHaveBeenCalledOnce());
  });

  it("switches between online and local model connection without adding a settings category", () => {
    render(<SettingsSystemPage />);

    expect(screen.getByRole("heading", { name: "模型接入" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /API 服务/ })).toHaveClass("active");
    expect(screen.getByRole("button", { name: /DeepSeek 推荐/ })).toHaveClass("selected");
    expect(screen.getByRole("button", { name: "Kimi" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GLM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "千问" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /本机模型/ }));

    expect(screen.getAllByRole("button", { name: /Ollama/ }).find((button) => button.classList.contains("selected"))).toBeDefined();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("http://127.0.0.1:11434/v1")).toBeInTheDocument();
    expect(screen.getByText(/当前地址只指向这台设备/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /LM Studio/ }));
    expect(screen.getByDisplayValue("http://127.0.0.1:1234/v1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /本机模型/ })).toHaveLength(1);
  });

  it("exposes professional configuration entries for the three supported cloud ASR providers", () => {
    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /语音输入/ }));
    expect(screen.getByRole("heading", { name: "语音输入" })).toBeInTheDocument();
    expect(screen.getByText(/约 175 MB 已包含在安装包中/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /火山引擎/ }));
    expect(screen.getByText("火山引擎 · Seed-ASR 配置")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Seed-ASR 2.0 小时版（推荐/ })).toBeInTheDocument();
    expect(screen.getByLabelText("App ID")).toBeInTheDocument();
    expect(screen.getByText(/实时音频和鉴权信息会发送给火山引擎/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /腾讯云/ }));
    expect(screen.getByLabelText("AppID")).toBeInTheDocument();
    expect(screen.getByLabelText("SecretID")).toBeInTheDocument();
    expect(screen.getByLabelText("SecretKey")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /16k_zh/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /阿里云百炼/ }));
    expect(screen.getByLabelText("DashScope API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace ID")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /fun-asr-realtime/ })).toBeInTheDocument();
    expect(screen.queryByText(/豆包输入法/)).not.toBeInTheDocument();
    expect(screen.queryByText(/百度/)).not.toBeInTheDocument();
  });

  it("renders the complete voice-input settings flow in English", () => {
    useSettingsStore.getState().updateLocale("en-US");
    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /Voice input/ }));
    expect(screen.getByRole("heading", { name: "Voice input" })).toBeInTheDocument();
    expect(screen.getByText(/About 175 MB is included with Ling/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Volcengine/ }));
    expect(screen.getByText("Volcengine · Seed-ASR configuration")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Tencent Cloud/ }));
    expect(screen.getByText("Tencent Cloud · Real-time speech recognition")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Alibaba Cloud Model Studio/ }));
    expect(screen.getByText("Alibaba Cloud Model Studio · Real-time speech recognition")).toBeInTheDocument();
  });

  it("keeps the voice shortcut unset by default and records an explicit combination", () => {
    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /语音输入/ }));
    expect(screen.getByRole("button", { name: "设置语音输入快捷键" })).toHaveTextContent("未设置");

    const recorder = screen.getByRole("button", { name: "设置语音输入快捷键" });
    fireEvent.click(recorder);
    fireEvent.keyDown(recorder, { key: "v", metaKey: true, shiftKey: true });

    expect(recorder).toHaveTextContent("⌘ ⇧ V");
    expect(useSettingsStore.getState().voiceInput.shortcut).toBe("Meta+Shift+V");
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(useSettingsStore.getState().voiceInput.shortcut).toBe("");
  });

  it("renders the simplified profile fields and previews a selected avatar", () => {
    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));

    expect(screen.getByRole("heading", { name: "个人资料" })).toBeInTheDocument();
    expect(screen.getByLabelText("你希望咨询师如何称呼你？")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("填写你习惯的称呼")).toBeInTheDocument();
    expect(screen.getByText("你愿意让咨询师提前知道的背景")).toBeInTheDocument();
    expect(screen.getByText(/头像只保存在这台设备上，用于界面显示，不会发送给模型/)).toBeInTheDocument();
    expect(screen.getByText(/称呼和背景会提供给三位 AI 咨询师/)).toBeInTheDocument();
    expect(screen.queryByText(/请选择一张清晰/)).not.toBeInTheDocument();

    expect(screen.queryByText("昵称")).not.toBeInTheDocument();
    expect(screen.queryByText("咨询师如何称呼我")).not.toBeInTheDocument();
    expect(screen.queryByText("当前状态")).not.toBeInTheDocument();
    expect(screen.queryByText("时区")).not.toBeInTheDocument();
    expect(screen.queryByText("常用语言")).not.toBeInTheDocument();

    const avatarInput = screen.getByLabelText("选择头像图片");
    fireEvent.change(avatarInput, {
      target: {
        files: [new File(["avatar"], "me.png", { type: "image/png" })]
      }
    });

    expect(screen.getByAltText("个人头像预览")).toHaveAttribute("src", "blob:ling-profile-avatar");
  });

  it("saves profile fields and avatar data to local settings", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          modelName: "deepseek-v4-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));
    await waitFor(() => expect(read).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("你希望咨询师如何称呼你？"), { target: { value: "Bella" } });
    fireEvent.change(screen.getByLabelText("你愿意让咨询师提前知道的背景"), { target: { value: "希望对话慢一点。" } });
    fireEvent.change(screen.getByLabelText("选择头像图片"), {
      target: {
        files: [new File(["avatar"], "me.png", { type: "image/png" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          profile: {
            displayName: "Bella",
            background: "希望对话慢一点。",
            avatarDataUrl: "data:image/png;base64,YXZhdGFy",
            avatarFileName: "me.png"
          }
        })
      );
    });
    expect(screen.getByText("个人资料已保存在这台设备上。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /咨询连续性/ }));
    expect(screen.queryByText("个人资料已保存在这台设备上。")).not.toBeInTheDocument();
  });

  it("downscales a large avatar off the main decode path before storing it", async () => {
    const close = vi.fn();
    const bitmap = { close, height: 128, width: 256 } as ImageBitmap;
    const drawImage = vi.fn();
    const createImageBitmapMock = vi.fn(async () => bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,b3B0aW1pemVk");

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));
    fireEvent.change(screen.getByLabelText("选择头像图片"), {
      target: {
        files: [createPngFile("large.png", 4_000, 2_000)]
      }
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().profile).toMatchObject({
        avatarDataUrl: "data:image/webp;base64,b3B0aW1pemVk",
        avatarFileName: "large.webp"
      });
    });
    expect(createImageBitmapMock).toHaveBeenCalledWith(expect.any(File), {
      resizeHeight: 128,
      resizeQuality: "high",
      resizeWidth: 256
    });
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 256, 128);
    expect(close).toHaveBeenCalledTimes(1);
    getContext.mockRestore();
    toDataUrl.mockRestore();
  });

  it("keeps the newest avatar when an older decode finishes later", async () => {
    const firstDecode = createDeferred<ImageBitmap>();
    const secondDecode = createDeferred<ImageBitmap>();
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const createImageBitmapMock = vi.fn()
      .mockReturnValueOnce(firstDecode.promise)
      .mockReturnValueOnce(secondDecode.promise);
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    const drawImage = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockReturnValueOnce("data:image/webp;base64,bmV3ZXI=")
      .mockReturnValueOnce("data:image/webp;base64,b2xkZXI=");

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));
    const avatarInput = screen.getByLabelText("选择头像图片");
    fireEvent.change(avatarInput, {
      target: { files: [new File(["first"], "first.png", { type: "image/png" })] }
    });
    fireEvent.change(avatarInput, {
      target: { files: [new File(["second"], "second.png", { type: "image/png" })] }
    });
    await waitFor(() => expect(createImageBitmapMock).toHaveBeenCalledTimes(2));

    secondDecode.resolve({ close: secondClose, height: 100, width: 100 } as unknown as ImageBitmap);
    await waitFor(() => expect(useSettingsStore.getState().profile.avatarFileName).toBe("second.webp"));
    firstDecode.resolve({ close: firstClose, height: 100, width: 100 } as unknown as ImageBitmap);
    await waitFor(() => expect(firstClose).toHaveBeenCalled());

    expect(useSettingsStore.getState().profile).toMatchObject({
      avatarDataUrl: "data:image/webp;base64,bmV3ZXI=",
      avatarFileName: "second.webp"
    });
    getContext.mockRestore();
    toDataUrl.mockRestore();
  });

  it("does not restore an avatar whose decode finishes after removal", async () => {
    const decode = createDeferred<ImageBitmap>();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(() => decode.promise));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    const toDataUrl = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/webp;base64,c3RhbGU=");

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));
    fireEvent.change(screen.getByLabelText("选择头像图片"), {
      target: { files: [new File(["avatar"], "avatar.png", { type: "image/png" })] }
    });
    await waitFor(() => expect(createImageBitmap).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "移除头像" }));
    decode.resolve({ close, height: 100, width: 100 } as unknown as ImageBitmap);
    await waitFor(() => expect(close).toHaveBeenCalled());

    expect(useSettingsStore.getState().profile.avatarDataUrl).toBeUndefined();
    expect(useSettingsStore.getState().profile.avatarFileName).toBeUndefined();
    getContext.mockRestore();
    toDataUrl.mockRestore();
  });

  it("rejects an oversized source before asking the browser to decode it", async () => {
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /个人资料/ }));
    fireEvent.change(screen.getByLabelText("选择头像图片"), {
      target: { files: [createPngFile("oversized.png", 20_000, 20_000)] }
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("没有成功处理这张头像");
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it("focuses model access on DeepSeek and saves local API settings", async () => {
    const initialSettings = {
      api: {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "",
        apiKeySaved: false,
        modelName: "deepseek-v4-flash"
      },
      defaultCounselorId: "chengling",
      defaultRoomThemeId: "warm-study"
    };
    const read = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: initialSettings })
      .mockResolvedValue({
        ok: true,
        data: {
          ...initialSettings,
          api: { ...initialSettings.api, apiKeySaved: true, apiKeyPreview: "sk...st" }
        }
      });
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const testConnection = vi.fn(async () => ({ ok: true, data: { connected: true, message: "连接正常。" } }));
    const deleteApiKey = vi.fn(async () => ({ ok: true, data: undefined }));
    const listModels = vi.fn(async () => ({
      ok: true,
      data: {
        models: [
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", ownedBy: "deepseek" },
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", ownedBy: "deepseek" }
        ],
        message: "已读取 DeepSeek 模型列表。",
        source: "remote" as const
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { deleteApiKey, listModels, read, save, testConnection } });
    // Custom choices remain available even though Pro is no longer a built-in default.
    useSettingsStore.setState({ availableModels: [
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", ownedBy: "deepseek" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", ownedBy: "deepseek" }
    ] });

    render(<SettingsSystemPage />);
    await waitFor(() => expect(read).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: "模型接入" })).toBeInTheDocument();
    expect(screen.getByText(/配置之后新建会谈默认使用的模型服务/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /DeepSeek 推荐/ })).toBeInTheDocument();
    expect(screen.queryByText("后续开放")).not.toBeInTheDocument();
    expect(screen.getByLabelText("默认心理咨询对话模型")).toHaveValue("deepseek-v4-flash");
    expect(screen.getAllByRole("option", { name: "DeepSeek V4 Flash（deepseek-v4-flash）" })).toHaveLength(3);
    await waitFor(() => expect(document.getElementById("model-reasoning-effort")).toHaveValue("high"));
    expect(screen.getByRole("button", { name: "读取可用模型" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "咨询结束后的模型用途" })).toBeInTheDocument();
    expect(screen.getByLabelText("会谈整理与连续性理解")).toHaveValue("");
    expect(screen.getByLabelText("咨询师来信")).toHaveValue("");
    expect(screen.queryByText("通义千问 / Qwen")).not.toBeInTheDocument();
    expect(screen.queryByText(/云同步或遥测/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "测试连接" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "读取可用模型" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "接入说明" }));
    expect(screen.getByRole("dialog", { name: "模型服务接入说明" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "第一次连接：按这 5 步操作" })).toBeInTheDocument();
    expect(screen.getByText(/API Key（接口密钥）/)).toBeInTheDocument();
    expect(screen.getByText(/粘贴后就能测试，不需要先保存/)).toBeInTheDocument();
    expect(screen.getByText(/聊天会员不一定包含 API 额度/)).toBeInTheDocument();
    expect(screen.queryByText("默认示例：DeepSeek V4 Pro")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭接入说明" }));
    expect(screen.queryByRole("dialog", { name: "模型服务接入说明" })).not.toBeInTheDocument();

    const apiKeyInput = screen.getByLabelText("API Key");
    expect(apiKeyInput).toHaveAttribute("type", "password");
    fireEvent.change(apiKeyInput, { target: { value: "sk-deepseek-test" } });
    expect(screen.getAllByText("待保存").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "测试连接" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "测试连接" })).toBeEnabled());
    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-deepseek-test" }));
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(apiKeyInput).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "隐藏 API Key" }));
    expect(apiKeyInput).toHaveAttribute("type", "password");

    fireEvent.change(screen.getByLabelText("模型服务地址（Base URL，兼容 OpenAI 接口格式）"), { target: { value: "https://api.deepseek.com" } });
    fireEvent.change(screen.getByLabelText("默认心理咨询对话模型"), { target: { value: "deepseek-v4-pro" } });
    fireEvent.change(screen.getByLabelText("会谈整理与连续性理解"), { target: { value: "deepseek-v4-pro" } });
    fireEvent.change(screen.getByLabelText("咨询师来信"), { target: { value: "deepseek-v4-flash" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          api: expect.objectContaining({
            apiBaseUrl: "https://api.deepseek.com",
            apiKey: "sk-deepseek-test",
            modelName: "deepseek-v4-pro"
          }),
          backstageModels: {
            conceptualizationModelName: "deepseek-v4-pro",
            letterModelName: "deepseek-v4-flash"
          }
        })
      );
    });

    await waitFor(() => expect(apiKeyInput).toHaveValue(""));
    expect(screen.getByRole("button", { name: "显示 API Key" })).toBeDisabled();
    fireEvent.change(apiKeyInput, { target: { value: "replacement-key" } });
    expect(apiKeyInput).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "显示 API Key" }));
    expect(apiKeyInput).toHaveValue("replacement-key");
    expect(apiKeyInput).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "读取可用模型" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "读取可用模型" })).toBeEnabled());
    expect(listModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "replacement-key" }));
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(testConnection).toHaveBeenCalled());
  }, 15_000);

  it("presents a future compatible provider without applying DeepSeek-only background defaults", async () => {
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://models.example.com/v1",
          apiKey: "",
          apiKeySaved: true,
          modelName: "future-provider-model"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read } });

    render(<SettingsSystemPage />);
    await waitFor(() => expect(read).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: /OpenAI 兼容服务/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OpenAI 兼容服务" })).toBeInTheDocument();
    expect(screen.getByLabelText("默认心理咨询对话模型")).toHaveValue("future-provider-model");
    expect(screen.getByRole("option", { name: "跟随会谈模型（推荐）" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "默认 DeepSeek V4.1 Flash（推荐）" })).not.toBeInTheDocument();
  });

  it("saves whether each new session brings previous counselor understanding into context and explains the switch", async () => {
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          modelName: "deepseek-v4-flash"
        },
        counseling: {
          bringPastUnderstandingToNewSessions: true
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /咨询连续性/ }));
    await waitFor(() => expect(read).toHaveBeenCalled());

    expect(screen.getByRole("heading", { name: "咨询连续性" })).toBeInTheDocument();
    expect(screen.queryByText("默认咨询师")).not.toBeInTheDocument();
    expect(screen.queryByText("危机提醒开关")).not.toBeInTheDocument();
    const memorySwitch = screen.getByRole("checkbox", { name: "新会谈承接同一咨询师的后台整理" });
    expect(memorySwitch).toBeChecked();
    const helpButton = screen.getByRole("button", { name: "说明：新会谈承接同一咨询师的后台整理" });
    fireEvent.click(helpButton);
    expect(helpButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "新会谈过去理解说明" })).toBeInTheDocument();
    expect(screen.getByText(/开启后，同一位咨询师的新会谈会承接/)).toBeInTheDocument();
    expect(screen.getByText(/后台整理材料只保留下次承接需要的理解和线索/)).toBeInTheDocument();
    expect(screen.queryByText(/备忘录只保留/)).not.toBeInTheDocument();
    expect(screen.getByText(/不跨咨询师共享/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭新会谈过去理解说明" }));
    expect(screen.queryByRole("dialog", { name: "新会谈过去理解说明" })).not.toBeInTheDocument();

    expect(screen.queryByText("跨咨询师共享资料")).not.toBeInTheDocument();
    expect(screen.queryByText("后续加入")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /跨咨询师/ })).not.toBeInTheDocument();

    const memorySwitchVisual = memorySwitch.closest(".system-toggle-row")?.querySelector(".system-toggle-visual");
    expect(memorySwitchVisual).toBeTruthy();
    fireEvent.click(memorySwitchVisual!);
    fireEvent.click(screen.getByRole("button", { name: "保存连续性设置" }));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          counseling: {
            bringPastUnderstandingToNewSessions: false
          }
        })
      );
    });
  });

  it("only exposes real settings controls and removes unused reading placeholders", () => {
    render(<SettingsSystemPage />);

    expect(screen.queryByRole("button", { name: /记忆设置/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /高级设置/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /数据与隐私/ }));
    expect(screen.getByRole("heading", { name: "导出会谈与来信" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出会谈与来信" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只导出会谈" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只导出咨询师的信" })).toBeInTheDocument();
    expect(screen.queryByText("模型服务")).not.toBeInTheDocument();
    expect(screen.queryByText("云同步和遥测")).not.toBeInTheDocument();
    expect(screen.queryByText("模型会收到什么")).not.toBeInTheDocument();
    expect(screen.queryByText("本机保存的数据")).not.toBeInTheDocument();
    expect(screen.queryByText("数据管理能力")).not.toBeInTheDocument();
    expect(screen.queryByText("完整导出")).not.toBeInTheDocument();
    expect(screen.getByText("完整本地备份")).toBeInTheDocument();
    expect(screen.queryByText("分类删除与重置")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出全部数据" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除本地缓存" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /界面与阅读/ }));
    expect(screen.getByRole("heading", { name: "界面显示" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "文字大小" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "行距" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "鼠标样式" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文字大小：标准" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "行距：标准" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "鼠标样式：月光纯白" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "界面设置已保存" })).toBeDisabled();
    expect(screen.queryByText("当前支持与后续计划")).not.toBeInTheDocument();
    expect(screen.queryByText("减少动态效果")).not.toBeInTheDocument();
    expect(screen.queryByText("阅读辅助")).not.toBeInTheDocument();
  });

  it("previews and saves text size and line spacing", async () => {
    const settings = {
      api: {
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "",
        apiKeySaved: true,
        modelName: "deepseek-v4-flash"
      },
      appearance: { textSize: "standard" as const, lineSpacing: "standard" as const },
      defaultCounselorId: "chengling",
      defaultRoomThemeId: "warm-study"
    };
    const read = vi.fn(async () => ({ ok: true as const, data: settings }));
    const save = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /界面与阅读/ }));
    await waitFor(() => expect(read).toHaveBeenCalled());

    const preview = screen.getByText(/此刻的感受，可以慢慢说/).closest(".reading-preview-paper");
    expect(preview).toHaveStyle({ fontSize: "16px", lineHeight: "1.92" });
    fireEvent.click(screen.getByRole("button", { name: "文字大小：大" }));
    fireEvent.click(screen.getByRole("button", { name: "行距：宽松" }));
    fireEvent.click(screen.getByRole("button", { name: "鼠标样式：琥珀软糖" }));
    expect(preview).toHaveStyle({ fontSize: "17.25px", lineHeight: "2.08" });
    expect(useSettingsStore.getState().appearance.cursorTheme).toBe("e");
    fireEvent.click(screen.getByRole("button", { name: "保存界面设置" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      appearance: { textSize: "large", lineSpacing: "relaxed", cursorTheme: "e" }
    })));
    expect(screen.getByText("界面设置已保存在这台设备上。")).toBeInTheDocument();
  });

  it("exports sessions and ready letters through the desktop bridge", async () => {
    const exportData = vi.fn(async () => ({
      ok: true as const,
      data: {
        status: "saved" as const,
        fileName: "Ling-会谈与来信-2026-07-13.md",
        sessionCount: 3,
        letterCount: 2
      }
    }));
    vi.stubGlobal("lingDesktop", { dataExports: { export: exportData } });

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /数据与隐私/ }));
    fireEvent.click(screen.getByRole("button", { name: "导出会谈与来信" }));

    await waitFor(() => expect(exportData).toHaveBeenCalledWith("all"));
    expect(await screen.findByText(/已导出 3 场会谈、2 封来信，文件为「Ling-会谈与来信-2026-07-13.md」/)).toBeInTheDocument();
  });

  it("shows an explicit preview response when password protection is submitted in a browser", async () => {
    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /数据与隐私/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "开启密码保护" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "开启密码保护" }));
    fireEvent.change(screen.getByLabelText("数字密码"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("再次输入数字密码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /我已保存恢复码/ }));
    fireEvent.click(screen.getByRole("button", { name: "完成设置" }));

    expect(screen.getByRole("button", { name: /正在设置/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("网页预览不能在这台设备上开启本地加密"));
  });

  it("将密码保护的关闭操作与免密时长分开", async () => {
    const disable = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", {
      accessLock: {
        status: vi.fn(async () => ({
          ok: true as const,
          data: { configured: true, enabled: true, unlocked: true, graceMinutes: 0 }
        })),
        disable,
        lockNow: vi.fn(),
        setGraceMinutes: vi.fn()
      }
    });

    render(<SettingsSystemPage />);
    fireEvent.click(screen.getByRole("button", { name: /数据与隐私/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "关闭密码保护" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "每次打开都验证" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /关闭/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭密码保护" }));
    expect(screen.getByText("关闭后，启动 Ling 将不再要求密码")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "确认关闭密码保护" }));

    await waitFor(() => expect(disable).toHaveBeenCalledWith("123456"));
    expect(screen.getByRole("button", { name: "开启密码保护" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("本地资料仍由这台设备加密保护");
  });

  it("confirms before restoring recommended preferences and reports success", async () => {
    const read = vi.fn(async () => ({
      ok: true as const,
      data: {
        api: { apiBaseUrl: "https://api.deepseek.com", apiKey: "", apiKeySaved: true, modelName: "custom-model" },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    const save = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });
    render(<SettingsSystemPage />);

    fireEvent.click(screen.getByRole("button", { name: /数据与隐私/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "恢复推荐设置" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "恢复推荐设置" }));

    const confirmation = screen.getByRole("alertdialog", { name: "确定恢复推荐设置？" });
    expect(confirmation).toHaveTextContent("API Key 都不会被删除或修改");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(within(confirmation).getByRole("button", { name: "恢复推荐设置" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("已恢复推荐设置");
  });
});
