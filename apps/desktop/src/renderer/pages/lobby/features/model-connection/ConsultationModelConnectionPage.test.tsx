import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSettingsStore, useSettingsStore } from "../../../../stores/settingsStore";
import { ConsultationModelConnectionPage } from "./ConsultationModelConnectionPage";

describe("ConsultationModelConnectionPage", () => {
  beforeEach(() => {
    resetSettingsStore();
    vi.unstubAllGlobals();
  });

  it("给出简洁的 API 获取说明，并允许暂不开始", () => {
    const onCancel = vi.fn();
    render(<ConsultationModelConnectionPage onCancel={onCancel} onConnected={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "连接 API 服务" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 DeepSeek API Keys" })).toHaveAttribute(
      "href",
      "https://platform.deepseek.com/api_keys"
    );
    expect(screen.getByText(/API Key 保存在这台设备上/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "暂不开始" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("保存默认推荐配置，验证成功后进入知情同意", async () => {
    const onConnected = vi.fn();
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
    const testConnection = vi.fn(async () => ({ ok: true as const, data: { connected: true, message: "连接成功。" } }));
    vi.stubGlobal("lingDesktop", { settings: { read, save, testConnection } });

    render(<ConsultationModelConnectionPage onCancel={vi.fn()} onConnected={onConnected} />);
    fireEvent.change(screen.getByLabelText("DeepSeek API Key"), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "连接并继续" }));

    await waitFor(() => expect(onConnected).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      api: expect.objectContaining({
        apiBaseUrl: "https://api.deepseek.com",
        apiKey: "sk-test",
        modelName: "deepseek-flash"
      })
    }));
    expect(useSettingsStore.getState().api.apiKeySaved).toBe(true);
  });
});
