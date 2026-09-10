import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSettingsStore, useSettingsStore } from "./settingsStore";

describe("settingsStore", () => {
  beforeEach(() => {
    resetSettingsStore();
    vi.unstubAllGlobals();
  });

  it("ignores a stale connection result and prevents overlapping tests", async () => {
    let resolve!: (value: unknown) => void;
    const testConnection = vi.fn(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal("lingDesktop", { settings: { testConnection } });
    useSettingsStore.getState().updateApi({ apiKey: "first-key" });
    const pending = useSettingsStore.getState().testConnection();
    useSettingsStore.getState().updateApi({ apiKey: "second-key" });
    await useSettingsStore.getState().testConnection();
    expect(testConnection).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: { connected: true, message: "Old result" } });
    await pending;
    expect(useSettingsStore.getState().connectionStatus).toBe("idle");
    expect(useSettingsStore.getState().message).not.toBe("Old result");
  });

  it("invalidates a successful test when the configuration changes", async () => {
    vi.stubGlobal("lingDesktop", { settings: { testConnection: vi.fn(async () => ({ ok: true, data: { connected: true, message: "OK" } })) } });
    await useSettingsStore.getState().testConnection();
    useSettingsStore.getState().updateApi({ apiKey: "replacement" });
    expect(useSettingsStore.getState().connectionStatus).toBe("idle");
  });

  it("recovers from a rejected test without losing the draft", async () => {
    vi.stubGlobal("lingDesktop", { settings: { testConnection: vi.fn(async () => { throw new Error("IPC closed"); }) } });
    useSettingsStore.getState().updateApi({ apiKey: "draft-key" });
    await useSettingsStore.getState().testConnection();
    expect(useSettingsStore.getState().status).toBe("error");
    expect(useSettingsStore.getState().api.apiKey).toBe("draft-key");
    expect(useSettingsStore.getState().dirtySections.model).toBe(true);
  });

  it("preserves newer edits while a save is pending", async () => {
    let resolve!: (value: unknown) => void;
    const save = vi.fn(() => new Promise((done) => { resolve = done; }));
    vi.stubGlobal("lingDesktop", { settings: { save, read: vi.fn().mockResolvedValueOnce({ ok: true, data: null }).mockRejectedValue(new Error("Read unavailable")) } });
    useSettingsStore.getState().updateApi({ apiKey: "saved-draft" });
    const pending = useSettingsStore.getState().saveSettings();
    useSettingsStore.getState().updateApi({ apiKey: "newer-draft" });
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    resolve({ ok: true });
    await pending;
    expect(useSettingsStore.getState().api.apiKey).toBe("newer-draft");
    expect(useSettingsStore.getState().savedApi.apiKey).toBe("");
    expect(useSettingsStore.getState().savedApi.apiKeySaved).toBe(true);
    expect(useSettingsStore.getState().dirtySections.model).toBe(true);
  });

  it("keeps a draft after saving fails", async () => {
    vi.stubGlobal("lingDesktop", { settings: { save: vi.fn(async () => ({ ok: false, error: { message: "Storage unavailable" } })) } });
    useSettingsStore.getState().updateApi({ apiKey: "draft" });
    await useSettingsStore.getState().saveSettings();
    expect(useSettingsStore.getState().api.apiKey).toBe("draft");
    expect(useSettingsStore.getState().dirtySections.model).toBe(true);
    expect(useSettingsStore.getState().status).toBe("error");
  });

  it("discards model discovery results after changing providers", async () => {
    let resolve!: (value: unknown) => void;
    vi.stubGlobal("lingDesktop", { settings: { listModels: vi.fn(() => new Promise((done) => { resolve = done; })) } });
    const pending = useSettingsStore.getState().loadModels();
    useSettingsStore.getState().updateApi({ apiBaseUrl: "https://new.example.com", modelName: "new-model" });
    resolve({ ok: true, data: { models: [{ id: "old-model", name: "old-model" }], source: "remote", message: "Old models" } });
    await pending;
    expect(useSettingsStore.getState().api.modelName).toBe("new-model");
    expect(useSettingsStore.getState().modelListStatus).toBe("idle");
  });

  it("loads sanitized model settings from the desktop bridge", async () => {
    vi.stubGlobal("lingDesktop", {
      settings: {
        read: vi.fn(async () => ({
          ok: true,
          data: {
            api: {
              apiBaseUrl: "https://api.deepseek.com",
              apiKey: "",
              apiKeySaved: true,
              apiKeyPreview: "sk...cd",
              modelName: "deepseek-v4-flash"
            },
            defaultCounselorId: "chengling",
            defaultRoomThemeId: "warm-study",
            counseling: {
              bringPastUnderstandingToNewSessions: false
            },
            appearance: {
              textSize: "large",
              lineSpacing: "relaxed"
            },
            profile: {
              displayName: "灵",
              background: "最近想慢一点。",
              avatarDataUrl: "data:image/png;base64,avatar",
              avatarFileName: "avatar.png"
            }
          }
        }))
      }
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().api).toEqual({
      connectionKind: "remote",
      localRuntime: "ollama",
      remoteProvider: "deepseek",
      apiBaseUrl: "https://api.deepseek.com",
      apiKey: "",
      apiKeySaved: true,
      apiKeyPreview: "sk...cd",
      modelName: "deepseek-v4-flash",
      reasoningEffort: "high",
      localApiBaseUrl: "http://127.0.0.1:11434/v1",
      localModelName: "",
      remoteApiBaseUrl: "https://api.deepseek.com",
      remoteModelName: "deepseek-v4-flash",
      modelAssignments: {
        conversation: "deepseek-v4-flash",
        caseConceptualization: "deepseek-flash",
        consultationTeam: "deepseek-flash"
      }
    });
    expect(useSettingsStore.getState().profile).toEqual({
      displayName: "灵",
      background: "最近想慢一点。",
      avatarDataUrl: "data:image/png;base64,avatar",
      avatarFileName: "avatar.png"
    });
    expect(useSettingsStore.getState().counseling).toEqual({
      bringPastUnderstandingToNewSessions: false
    });
    expect(useSettingsStore.getState().appearance).toEqual({
      textSize: "large",
      lineSpacing: "relaxed",
      cursorTheme: "d"
    });
  });

  it("persists imported counselors disabled for new consultations", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    vi.stubGlobal("lingDesktop", { settings: { save } });

    await expect(
      useSettingsStore.getState().updateDisabledCounselors(["professional-b", "professional-a", "professional-b"])
    ).resolves.toBe(true);

    expect(useSettingsStore.getState().disabledCounselorIds).toEqual(["professional-a", "professional-b"]);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      disabledCounselorIds: ["professional-a", "professional-b"]
    }));
  });

  it("saves reading appearance without changing personal data or model access", async () => {
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
        defaultRoomThemeId: "warm-study",
        profile: { displayName: "Bella", background: "已保存背景" }
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    useSettingsStore.getState().updateAppearance({ textSize: "large", lineSpacing: "relaxed", cursorTheme: "e" });
    await useSettingsStore.getState().saveAppearance();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      appearance: { textSize: "large", lineSpacing: "relaxed", cursorTheme: "e" },
      profile: { displayName: "Bella", background: "已保存背景" },
      api: expect.objectContaining({ apiBaseUrl: "https://api.deepseek.com" })
    }));
    expect(useSettingsStore.getState().dirtySections.appearance).toBe(false);
    expect(useSettingsStore.getState().message).toBe("界面设置已保存在这台设备上。");
  });

  it("saves Volcengine voice credentials and clears the token from renderer state", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          modelName: "deepseek-v4-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    useSettingsStore.getState().updateVoiceInput({
      provider: "volcengine",
      doubao: {
        appId: "123456",
        accessToken: "secret-token",
        model: "seed-asr-2.0-hourly"
      }
    });
    await useSettingsStore.getState().saveVoiceInput();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      voiceInput: expect.objectContaining({
        provider: "volcengine",
        doubao: expect.objectContaining({
          appId: "123456",
          accessToken: "secret-token",
          model: "seed-asr-2.0-hourly"
        })
      })
    }));
    expect(useSettingsStore.getState().voiceInput.doubao.accessToken).toBe("");
    expect(useSettingsStore.getState().voiceInput.doubao.accessTokenSaved).toBe(true);
  });

  it("saves language immediately without clearing unsaved profile changes", async () => {
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
        locale: "zh-CN" as const,
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study",
        profile: { displayName: "Saved name", background: "" }
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    useSettingsStore.getState().updateProfile({ displayName: "Unsaved name" });
    await useSettingsStore.getState().saveLocale("en-US");

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ locale: "en-US" }));
    expect(useSettingsStore.getState()).toMatchObject({
      locale: "en-US",
      savedLocale: "en-US",
      dirtySections: { profile: true }
    });
  });

  it("saves model settings and clears the full api key from renderer state", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...cd",
          modelName: "deepseek-v4-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });
    useSettingsStore.getState().updateApi({ apiKey: "sk-test-secret" });

    await useSettingsStore.getState().saveSettings();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        api: expect.objectContaining({ apiKey: "sk-test-secret" })
      })
    );
    expect(useSettingsStore.getState().api.apiKey).toBe("");
    expect(useSettingsStore.getState().api.apiKeySaved).toBe(true);
    expect(useSettingsStore.getState().status).toBe("saved");
  });

  it("preserves loaded backstage model settings when saving model settings", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...cd",
          modelName: "deepseek-v4-flash"
        },
        backstageModels: {
          conceptualizationModelName: "custom-conceptualization-model"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    await useSettingsStore.getState().loadSettings();
    useSettingsStore.getState().updateApi({ modelName: "deepseek-v4-flash-new" });
    await useSettingsStore.getState().saveSettings();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        backstageModels: {
          conceptualizationModelName: "custom-conceptualization-model"
        },
        api: expect.objectContaining({ modelName: "deepseek-v4-flash-new" })
      })
    );
  });

  it("updates and saves the separate models used after a session ends", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...cd",
          modelName: "deepseek-v4-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study"
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    useSettingsStore.getState().updateBackstageModels({
      conceptualizationModelName: "deepseek-v4-pro",
      letterModelName: "deepseek-v4-flash"
    });
    await useSettingsStore.getState().saveSettings();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        backstageModels: {
          conceptualizationModelName: "deepseek-v4-pro",
          letterModelName: "deepseek-v4-flash"
        }
      })
    );
    expect(useSettingsStore.getState().dirtySections.model).toBe(false);
  });

  it("tests the current model connection through main process", async () => {
    const testConnection = vi.fn(async () => ({
      ok: true,
      data: { connected: true, message: "连接成功。" }
    }));
    vi.stubGlobal("lingDesktop", { settings: { testConnection } });

    await useSettingsStore.getState().testConnection();

    expect(testConnection).toHaveBeenCalled();
    expect(useSettingsStore.getState().connectionStatus).toBe("success");
    expect(useSettingsStore.getState().message).toBe("连接成功。");
  });

  it("loads DeepSeek models through main process and selects the first returned model when needed", async () => {
    const listModels = vi.fn(async () => ({
      ok: true,
      data: {
        models: [
          { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", ownedBy: "deepseek" },
          { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", ownedBy: "deepseek" }
        ],
        message: "已读取 DeepSeek 模型列表。",
        source: "remote" as const
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { listModels } });
    useSettingsStore.getState().updateApi({ modelName: "legacy-model" });

    await useSettingsStore.getState().loadModels();

    expect(listModels).toHaveBeenCalled();
    expect(useSettingsStore.getState().availableModels).toHaveLength(2);
    expect(useSettingsStore.getState().api.modelName).toBe("deepseek-v4-pro");
    expect(useSettingsStore.getState().api.modelAssignments?.conversation).toBe("deepseek-v4-pro");
    expect(useSettingsStore.getState().modelListStatus).toBe("loaded");
  });

  it("replaces the model list with each fresh official response", async () => {
    const latest = [{ id: "deepseek-flash", name: "Official Flash" }, { id: "future-model", name: "Future model" }];
    const listModels = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { models: latest, source: "remote", message: "loaded" } })
      .mockResolvedValueOnce({ ok: true, data: { models: [latest[1]], source: "remote", message: "loaded" } });
    vi.stubGlobal("lingDesktop", { settings: { listModels } });
    await useSettingsStore.getState().loadModels();
    expect(useSettingsStore.getState().availableModels).toEqual(latest);
    await useSettingsStore.getState().loadModels();
    expect(useSettingsStore.getState().availableModels).toEqual([latest[1]]);
    expect(useSettingsStore.getState().api.modelName).toBe("future-model");
  });

  it.each(["failed", "empty", "remote"])("does not substitute built-in models for an empty %s response", async (source) => {
    const previous = [{ id: "custom-model", name: "Custom" }];
    useSettingsStore.setState({ availableModels: previous });
    const api = useSettingsStore.getState().api;
    const listModels = vi.fn(async () => ({ ok: true, data: { models: [], source, message: "No models" } }));
    vi.stubGlobal("lingDesktop", { settings: { listModels } });
    await useSettingsStore.getState().loadModels();
    expect(useSettingsStore.getState().availableModels).toEqual(source === "remote" ? [] : previous);
    expect(useSettingsStore.getState().api).toEqual(api);
    expect(useSettingsStore.getState().modelListStatus).toBe(source === "failed" ? "failed" : "empty");
  });

  it("keeps a clear error message when saving model settings fails", async () => {
    vi.stubGlobal("lingDesktop", {
      settings: {
        save: vi.fn(async () => ({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "缺少 Base URL" }
        }))
      }
    });

    await useSettingsStore.getState().saveSettings();

    expect(useSettingsStore.getState().status).toBe("error");
    expect(useSettingsStore.getState().message).toBe("缺少 Base URL");
  });

  it("saves profile settings to the desktop bridge", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...cd",
          modelName: "deepseek-v4-flash"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study",
        profile: {
          displayName: "旧称呼",
          background: "",
          avatarDataUrl: undefined,
          avatarFileName: undefined
        }
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    useSettingsStore.getState().updateProfile({
      displayName: "Bella",
      background: "希望对话慢一点。",
      avatarDataUrl: "data:image/png;base64,avatar",
      avatarFileName: "avatar.png"
    });
    await useSettingsStore.getState().saveProfile();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: {
          displayName: "Bella",
          background: "希望对话慢一点。",
          avatarDataUrl: "data:image/png;base64,avatar",
          avatarFileName: "avatar.png"
        }
      })
    );
    expect(useSettingsStore.getState().status).toBe("saved");
    expect(useSettingsStore.getState().message).toBe("个人资料已保存在这台设备上。");
  });

  it("preserves backstage model settings when saving profile settings", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://api.deepseek.com",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...cd",
          modelName: "deepseek-v4-flash"
        },
        backstageModels: {
          conceptualizationModelName: "custom-conceptualization-model"
        },
        defaultCounselorId: "chengling",
        defaultRoomThemeId: "warm-study",
        profile: {
          displayName: "旧称呼",
          background: ""
        }
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    useSettingsStore.getState().updateProfile({ displayName: "Bella" });
    await useSettingsStore.getState().saveProfile();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        backstageModels: {
          conceptualizationModelName: "custom-conceptualization-model"
        },
        profile: expect.objectContaining({ displayName: "Bella" })
      })
    );
  });

  it("does not persist an unsaved profile draft when saving continuity settings", async () => {
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
        defaultRoomThemeId: "warm-study",
        counseling: { bringPastUnderstandingToNewSessions: true },
        profile: { displayName: "已保存称呼", background: "已保存背景" }
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    await useSettingsStore.getState().loadSettings();
    useSettingsStore.getState().updateProfile({ displayName: "未保存称呼" });
    useSettingsStore.getState().updateCounseling({ bringPastUnderstandingToNewSessions: false });
    await useSettingsStore.getState().saveCounseling();

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        counseling: { bringPastUnderstandingToNewSessions: false },
        profile: expect.objectContaining({ displayName: "已保存称呼" })
      })
    );
    expect(useSettingsStore.getState().dirtySections).toEqual({ model: false, voice: false, profile: true, counseling: false, appearance: false });
  });

  it("restores recommended preferences without changing API access or personal profile data", async () => {
    const save = vi.fn(async () => ({ ok: true, data: undefined }));
    const read = vi.fn(async () => ({
      ok: true,
      data: {
        api: {
          apiBaseUrl: "https://model.example.com/v1",
          apiKey: "",
          apiKeySaved: true,
          apiKeyPreview: "sk...kept",
          modelName: "custom-conversation-model",
          modelAssignments: {
            conversation: "custom-conversation-model",
            caseConceptualization: "custom-conceptualization-model",
            consultationTeam: "custom-team-model"
          }
        },
        backstageModels: {
          conceptualizationModelName: "custom-conceptualization-model",
          letterModelName: "custom-letter-model"
        },
        counseling: { bringPastUnderstandingToNewSessions: false },
        appearance: { textSize: "large" as const, lineSpacing: "relaxed" as const },
        defaultCounselorId: "zhouzhou",
        defaultRoomThemeId: "rain-night",
        profile: {
          displayName: "Bella",
          background: "希望慢一点。",
          avatarDataUrl: "data:image/png;base64,avatar",
          avatarFileName: "avatar.png"
        }
      }
    }));
    vi.stubGlobal("lingDesktop", { settings: { read, save } });

    await useSettingsStore.getState().restoreRecommendedSettings();

    expect(save).toHaveBeenCalledWith({
      api: {
        connectionKind: "remote",
        localRuntime: "ollama",
        remoteProvider: "custom",
        apiBaseUrl: "https://model.example.com/v1",
        apiKey: "",
        apiKeySaved: true,
        apiKeyPreview: "sk...kept",
        modelName: "custom-conversation-model",
        reasoningEffort: undefined,
        localApiBaseUrl: "http://127.0.0.1:11434/v1",
        localModelName: "",
        remoteApiBaseUrl: "https://model.example.com/v1",
        remoteModelName: "custom-conversation-model",
        modelAssignments: {
          conversation: "custom-conversation-model",
          caseConceptualization: "custom-conceptualization-model",
          consultationTeam: "custom-team-model"
        }
      },
      backstageModels: {},
      counseling: { bringPastUnderstandingToNewSessions: true },
        appearance: { textSize: "standard", lineSpacing: "standard", cursorTheme: "d" },
      defaultCounselorId: "zhouzhou",
      defaultRoomThemeId: "rain-night",
      profile: {
        displayName: "Bella",
        background: "希望慢一点。",
        avatarDataUrl: "data:image/png;base64,avatar",
        avatarFileName: "avatar.png"
      }
    });
    expect(useSettingsStore.getState().message).toContain("API Key 均未改动");
    expect(useSettingsStore.getState().dirtySections).toEqual({ model: false, voice: false, profile: false, counseling: false, appearance: false });
  });

  it("restores each dirty section to its last saved value when discarding", () => {
    useSettingsStore.getState().updateApi({ modelName: "draft-model" });
    useSettingsStore.getState().updateProfile({ displayName: "草稿称呼" });
    useSettingsStore.getState().updateCounseling({ bringPastUnderstandingToNewSessions: false });
    useSettingsStore.getState().updateAppearance({ textSize: "large", lineSpacing: "relaxed" });

    useSettingsStore.getState().discardUnsavedChanges();

    expect(useSettingsStore.getState().api.modelName).toBe("deepseek-flash");
    expect(useSettingsStore.getState().profile.displayName).toBe("");
    expect(useSettingsStore.getState().counseling.bringPastUnderstandingToNewSessions).toBe(true);
    expect(useSettingsStore.getState().appearance).toEqual({ textSize: "standard", lineSpacing: "standard", cursorTheme: "d" });
    expect(useSettingsStore.getState().dirtySections).toEqual({ model: false, voice: false, profile: false, counseling: false, appearance: false });
  });
});
