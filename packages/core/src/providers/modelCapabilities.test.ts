import { describe, expect, it } from "vitest";
import {
  getDefaultModelReasoningEffort,
  getModelReasoningOptions,
  modelSupportsImageInput,
  normalizeModelReasoningEffort
} from "./modelCapabilities";

describe("model capabilities", () => {
  it("exposes only DeepSeek V4's effective reasoning levels", () => {
    const api = {
      apiBaseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash-vision-exp",
      remoteProvider: "deepseek" as const
    };
    expect(getModelReasoningOptions(api).map((option) => option.value)).toEqual(["none", "high", "max"]);
    expect(getDefaultModelReasoningEffort(api)).toBe("high");
    expect(normalizeModelReasoningEffort({ ...api, reasoningEffort: "low" })).toBe("high");
    expect(getModelReasoningOptions({
      apiBaseUrl: "https://api.deepseek.com",
      modelName: "deepseek-v4-flash"
    }).map((option) => option.value)).toEqual(["none", "high", "max"]);
  });

  it("uses provider-specific options for GLM, Kimi, and Qwen", () => {
    expect(getModelReasoningOptions({ apiBaseUrl: "https://open.bigmodel.cn/api/paas/v4", modelName: "glm-5.2", remoteProvider: "glm" }).map((item) => item.value)).toEqual(["none", "high", "max"]);
    expect(getModelReasoningOptions({ apiBaseUrl: "https://api.moonshot.cn/v1", modelName: "kimi-k2.5", remoteProvider: "kimi" }).map((item) => item.value)).toEqual(["none", "high"]);
    expect(getModelReasoningOptions({ apiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelName: "qwen3.7-plus", remoteProvider: "qwen" }).map((item) => item.value)).toEqual(["none", "low", "medium", "high", "max"]);
  });

  it("recognizes the new DeepSeek vision model and other known multimodal families", () => {
    expect(modelSupportsImageInput("deepseek-v4-flash-vision-exp")).toBe(true);
    expect(modelSupportsImageInput("deepseek-v4-flash")).toBe(true);
    expect(modelSupportsImageInput("deepseek-flash")).toBe(true);
    expect(modelSupportsImageInput("kimi-k2.5")).toBe(true);
    expect(modelSupportsImageInput("qwen3.7-plus")).toBe(true);
  });
});
