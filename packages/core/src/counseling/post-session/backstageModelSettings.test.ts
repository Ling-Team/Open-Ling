// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { UserSettings } from "@shared/index";
import {
  resolveSessionLetterModelSettings,
  resolveConceptualizationModelSettings
} from "./backstageModelSettings";

const baseSettings: UserSettings = {
  api: {
    apiBaseUrl: "https://api.deepseek.com",
    apiKey: "",
    modelName: "deepseek-v4-flash"
  },
  defaultCounselorId: "chengling",
  defaultRoomThemeId: "warm-study"
};

describe("backstage model settings", () => {
  it("uses deepseek v4.1 flash as the default conceptualization model", () => {
    expect(resolveConceptualizationModelSettings(baseSettings)).toEqual({
      apiBaseUrl: "https://api.deepseek.com",
      modelName: "deepseek-flash"
    });
  });

  it("uses Flash for letters by default", () => {
    expect(resolveSessionLetterModelSettings(baseSettings).modelName).toBe("deepseek-flash");
  });

  it("uses configured conceptualization model when present", () => {
    expect(
      resolveConceptualizationModelSettings({
        ...baseSettings,
        backstageModels: {
          conceptualizationModelName: "custom-conceptualization-model"
        }
      })
    ).toEqual({
      apiBaseUrl: "https://api.deepseek.com",
      modelName: "custom-conceptualization-model"
    });
  });

  it("falls back to default when configured conceptualization model is blank", () => {
    expect(
      resolveConceptualizationModelSettings({
        ...baseSettings,
        backstageModels: {
          conceptualizationModelName: "   "
        }
      })
    ).toEqual({
      apiBaseUrl: "https://api.deepseek.com",
      modelName: "deepseek-flash"
    });
  });

  it("follows the selected conversation model for a non-DeepSeek compatible service", () => {
    const compatibleSettings: UserSettings = {
      ...baseSettings,
      api: {
        ...baseSettings.api,
        apiBaseUrl: "https://models.example.com/v1",
        modelName: "future-provider-model"
      }
    };

    expect(resolveConceptualizationModelSettings(compatibleSettings)).toEqual({
      apiBaseUrl: "https://models.example.com/v1",
      modelName: "future-provider-model"
    });
  });
});
