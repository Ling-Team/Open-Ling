import type { ApiSettings, ModelReasoningEffort } from "../../../shared/src/index.js";
import {
  matchModelCapability,
  type CapabilityLookup
} from "./modelCapabilityTable.js";

export interface ModelReasoningOption {
  value: ModelReasoningEffort;
  label: [string, string];
  description: [string, string];
}

const off: ModelReasoningOption = {
  value: "none",
  label: ["关闭", "Off"],
  description: ["响应最快，不进行额外推理", "Fastest response without extra reasoning"]
};
const low: ModelReasoningOption = {
  value: "low",
  label: ["较低", "Low"],
  description: ["较少推理，速度优先", "Less reasoning with speed prioritized"]
};
const medium: ModelReasoningOption = {
  value: "medium",
  label: ["中等", "Medium"],
  description: ["在速度与深度之间平衡", "Balances speed and depth"]
};
const high: ModelReasoningOption = {
  value: "high",
  label: ["较高", "High"],
  description: ["适合需要更多分析的对话", "For conversations that benefit from more analysis"]
};
const max: ModelReasoningOption = {
  value: "max",
  label: ["最高", "Maximum"],
  description: ["最深推理，等待更久且可能消耗更多 Token", "Deepest reasoning with more latency and possible token use"]
};

const OPTION_BY_VALUE: Record<string, ModelReasoningOption> = {
  none: off,
  low,
  medium,
  high,
  max
};

export function getModelReasoningOptions(api: CapabilityLookup): ModelReasoningOption[] {
  const entry = matchModelCapability(api);
  if (!entry) return [];
  return entry.reasoningOptions.map((value) => OPTION_BY_VALUE[value]).filter(Boolean);
}

export function getDefaultModelReasoningEffort(api: CapabilityLookup): ModelReasoningEffort | undefined {
  return matchModelCapability(api)?.defaultReasoningEffort;
}

export function normalizeModelReasoningEffort(
  api: CapabilityLookup & Pick<ApiSettings, "reasoningEffort">
): ModelReasoningEffort | undefined {
  const entry = matchModelCapability(api);
  if (!entry) return undefined;
  return entry.reasoningOptions.includes(api.reasoningEffort as ModelReasoningEffort)
    ? api.reasoningEffort
    : entry.defaultReasoningEffort;
}

export function modelSupportsImageInput(modelName: string) {
  const model = modelName.toLowerCase();
  return model === "deepseek-flash" || model === "deepseek-v4-flash" || model === "deepseek-v4-flash-vision-exp" ||
    /^kimi-k2\.(?:[5-9]|[1-9]\d)/.test(model) ||
    /^qwen3\.(?:[5-9])-(?:plus|flash|max)/.test(model) ||
    /(?:^|[-_.])(?:vl|vision)(?:$|[-_.])/.test(model) ||
    /^(?:gpt-4o|gpt-4\.1|gpt-5|gemini-|grok-)/.test(model);
}
