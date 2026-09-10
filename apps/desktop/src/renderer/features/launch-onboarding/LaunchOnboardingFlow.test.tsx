import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../../stores/settingsStore";
import { LaunchOnboardingFlow } from "./LaunchOnboardingFlow";

describe("首次启动引导", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: "zh-CN",
      savedLocale: "zh-CN",
      profile: { displayName: "", background: "" },
      savedProfile: { displayName: "", background: "" },
      status: "idle",
      connectionStatus: "idle",
      message: ""
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("按欢迎、模型、数据安全的顺序前进，并在第三页查看隐私说明", async () => {
    render(<LaunchOnboardingFlow onComplete={() => undefined} />);

    const scene = screen.getByRole("figure", { name: "从湖边门廊望进群心心理工作室的等待室" });
    expect(screen.getByText("01 / 03")).toBeInTheDocument();
    expect(screen.getByLabelText("你希望我们怎么称呼你？")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "先进入工作室看看" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("你希望我们怎么称呼你？"), { target: { value: "小满" } });
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByRole("heading", { name: "连接模型服务" })).toBeInTheDocument();
    expect(useSettingsStore.getState().profile.displayName).toBe("小满");
    expect(screen.getByText("02 / 03")).toBeInTheDocument();
    expect(screen.getByRole("figure", { name: "从湖边门廊望进群心心理工作室的等待室" })).toBe(scene);
    expect(screen.getByRole("button", { name: /在这台设备上运行/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /使用 API 服务/ }));
    expect(screen.getByRole("link", { name: "打开 DeepSeek API Keys" })).toHaveAttribute(
      "href",
      "https://platform.deepseek.com/api_keys"
    );
    expect(screen.getByLabelText("API Key")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂时跳过，继续" }));
    expect(await screen.findByRole("heading", { name: "为你的本地资料设置一把锁" })).toBeInTheDocument();
    expect(screen.getByText("03 / 03")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "在工作室里，你始终保有选择" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看隐私说明" }));
    expect(screen.getByRole("heading", { name: "Ling 隐私说明" })).toBeInTheDocument();
    expect(screen.getAllByText(/上海啸群教育科技有限公司/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "关闭隐私说明" }));

  });

  it("在第一屏切换英文后，后续引导立即使用英文", async () => {
    render(<LaunchOnboardingFlow onComplete={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Welcome to Qunxin Psychology Studio" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Connect a model service" })).toBeInTheDocument();
    expect(useSettingsStore.getState().locale).toBe("en-US");
  });

  it("允许暂时跳过模型连接后进入数据安全设置", () => {
    const onComplete = vi.fn();
    render(<LaunchOnboardingFlow initialStep="model" onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "暂时跳过，继续" }));
    expect(screen.getByRole("heading", { name: "为你的本地资料设置一把锁" })).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "稍后设置，先进工作室看看" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("进入模型页时不会展示上一步遗留的内部错误", () => {
    useSettingsStore.setState({ status: "error", message: "服务器内部错误，请稍后重试" });
    render(<LaunchOnboardingFlow initialStep="model" onComplete={() => undefined} />);

    expect(screen.queryByText("服务器内部错误，请稍后重试")).not.toBeInTheDocument();
  });

  it("本机尚未建立加密保险箱时可以先进入工作室看看", async () => {
    const onComplete = vi.fn();
    render(<LaunchOnboardingFlow onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    await screen.findByRole("heading", { name: "连接模型服务" });
    fireEvent.click(screen.getByRole("button", { name: "暂时跳过，继续" }));
    fireEvent.click(await screen.findByRole("button", { name: "稍后设置，先进工作室看看" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("新设备按欢迎、模型、数据安全的三步顺序前进", async () => {
    const onComplete = vi.fn();
    const onSecuritySetupComplete = vi.fn();
    const setup = vi.fn(async () => ({ ok: true as const, data: undefined }));
    vi.stubGlobal("lingDesktop", { accessLock: { setup } });
    render(
      <LaunchOnboardingFlow
        onComplete={onComplete}
        onSecuritySetupComplete={onSecuritySetupComplete}
      />
    );

    expect(screen.getByText("01 / 03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(await screen.findByRole("heading", { name: "连接模型服务" })).toBeInTheDocument();
    expect(screen.getByText("02 / 03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "暂时跳过，继续" }));
    expect(await screen.findByRole("heading", { name: "为你的本地资料设置一把锁" })).toBeInTheDocument();
    expect(screen.getByText("03 / 03")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("数字密码"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("再次输入"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /我已保存恢复码/ }));
    fireEvent.click(screen.getByRole("button", { name: "设置完成，进入工作室" }));

    await waitFor(() => expect(setup).toHaveBeenCalledTimes(1));
    expect(onSecuritySetupComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("保存推荐配置并在连接成功后完成引导", async () => {
    const onComplete = vi.fn();
    const save = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true as const,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...st",
          modelName: "deepseek-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    const testConnection = vi.fn(async () => ({
      ok: true as const,
      data: { connected: true, message: "连接成功。" }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save, testConnection } });

    render(<LaunchOnboardingFlow initialStep="model" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /使用 API 服务/ }));
    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "连接并继续" }));

    await screen.findByRole("heading", { name: "为你的本地资料设置一把锁" });
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "稍后设置，先进工作室看看" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      api: expect.objectContaining({
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "sk-test",
        modelName: "deepseek-flash"
      })
    }));
    expect(testConnection).toHaveBeenCalledTimes(1);
  });

  it("可检测无 API Key 的本机模型并完成连接", async () => {
    const onComplete = vi.fn();
    const save = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const listModels = vi.fn(async () => ({
      ok: true as const,
      data: { models: [{ id: "qwen3:8b", name: "Qwen3 8B" }], message: "已读取可用模型。", source: "remote" as const }
    }));
    const read = vi.fn(async () => ({
      ok: true as const,
      data: {
        api: {
          connectionKind: "local" as const,
          localRuntime: "ollama" as const,
          apiBaseUrl: "http://127.0.0.1:11434/v1",
          apiKey: "",
          apiKeySaved: false,
          modelName: "qwen3:8b"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    const testConnection = vi.fn(async () => ({ ok: true as const, data: { connected: true, message: "本机模型已连接。" } }));
    vi.stubGlobal("lingDesktop", { settings: { read, save, listModels, testConnection } });

    render(<LaunchOnboardingFlow initialStep="model" onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /在这台设备上运行/ }));
    fireEvent.click(screen.getByRole("button", { name: "检测本机模型" }));
    await screen.findByRole("button", { name: "使用这个模型" });
    fireEvent.click(screen.getByRole("button", { name: "使用这个模型" }));

    await screen.findByRole("heading", { name: "为你的本地资料设置一把锁" });
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "稍后设置，先进工作室看看" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledWith(expect.objectContaining({
      connectionKind: "local",
      apiBaseUrl: "http://127.0.0.1:11434/v1"
    }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ api: expect.objectContaining({ connectionKind: "local", modelName: "qwen3:8b" }) }));
  });
});
