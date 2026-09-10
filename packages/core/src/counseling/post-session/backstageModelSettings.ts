import type { UserSettings } from "@shared/index";

export const DEFAULT_CONCEPTUALIZATION_MODEL_NAME = "deepseek-flash";

export function resolveConceptualizationModelSettings(settings: UserSettings) {
  const modelName =
    settings.backstageModels?.conceptualizationModelName?.trim() ||
    defaultBackstageModelName(settings);
  return {
    apiBaseUrl: settings.api.apiBaseUrl,
    modelName
  };
}

export function resolveSessionLetterModelSettings(settings: UserSettings) {
  const modelName =
    settings.backstageModels?.letterModelName?.trim() ||
    settings.backstageModels?.conceptualizationModelName?.trim() ||
    defaultBackstageModelName(settings);
  return {
    apiBaseUrl: settings.api.apiBaseUrl,
    modelName
  };
}

function defaultBackstageModelName(settings: UserSettings) {
  return isDeepSeekEndpoint(settings.api.apiBaseUrl)
    ? DEFAULT_CONCEPTUALIZATION_MODEL_NAME
    : settings.api.modelName.trim();
}

function isDeepSeekEndpoint(apiBaseUrl: string) {
  try {
    const hostname = new URL(apiBaseUrl).hostname.toLowerCase();
    return hostname === "api.deepseek.com" || hostname.endsWith(".deepseek.com");
  } catch {
    return apiBaseUrl.toLowerCase().includes("deepseek.com");
  }
}
