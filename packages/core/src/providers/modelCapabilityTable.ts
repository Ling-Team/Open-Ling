import type { ApiSettings, ModelReasoningEffort } from "../../../shared/src/index.js";

export type SamplingProfile = "dialogue" | "deterministic_task" | "eval";

export interface CapabilityLookup {
  apiBaseUrl: string;
  modelName: string;
  remoteProvider?: ApiSettings["remoteProvider"];
}

export interface SamplingParams {
  temperature: number;
  top_p: number;
  seed?: number;
}

export interface ModelCapabilityEntry {
  id: string;
  reasoningOptions: ModelReasoningEffort[];
  defaultReasoningEffort: ModelReasoningEffort;
  acceptsSampling: boolean;
  compiler: "chat-system" | "reasoner-user-prefix";
  match: (api: CapabilityLookup) => boolean;
  wire: (effort: ModelReasoningEffort) => Record<string, unknown>;
}

export interface ModelRuntimeContract {
  capabilityId?: string;
  matched: boolean;
  reasoningEffort?: ModelReasoningEffort;
  samplingProfile: SamplingProfile;
  sampling: SamplingParams | null;
  compilerId: "chat-system" | "chat-split-system" | "reasoner-user-prefix" | "json-task";
  vendorParamsTrusted: boolean;
  wireParams: Record<string, unknown>;
}

export const SAMPLING_PROFILES: Record<SamplingProfile, SamplingParams> = {
  dialogue: { temperature: 0.7, top_p: 0.95 },
  deterministic_task: { temperature: 0.2, top_p: 1 },
  eval: { temperature: 0, top_p: 1, seed: 20260825 }
};

const GLM_THINKING = /^glm-(?:5\.(?:[2-9]|[1-9]\d)|[6-9])/;
const KIMI_THINKING = /^kimi-k2[.-]/;
const DEEPSEEK_REASONER = /^(deepseek-flash|deepseek-reasoner|deepseek-r1(?!-distill)|deepseek-v4-(?:flash|pro))/;
const DEEPSEEK_CHAT = /^deepseek-(chat|v3)/;
const QWEN3 = /^qwen3[.:-]/;
const OPENAI_REASONING = /^(?:gpt-5|o[1-9])/;

function hostnameOf(apiBaseUrl: string) {
  try {
    return new URL(apiBaseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Strip OpenRouter-style `vendor/model` so the capability regex sees the leaf id. */
export function canonicalModelName(modelName: string) {
  const lower = modelName.trim().toLowerCase();
  const slash = lower.lastIndexOf("/");
  return slash >= 0 ? lower.slice(slash + 1) : lower;
}

/** Hostname equals a registered root or is a subdomain of it. Rejects `openai.com.cn-gw.example.io`. */
export function hostIs(host: string, roots: string[]) {
  return roots.some((root) => host === root || host.endsWith(`.${root}`));
}

function haystack(api: CapabilityLookup) {
  return {
    model: canonicalModelName(api.modelName),
    host: hostnameOf(api.apiBaseUrl),
    url: api.apiBaseUrl.toLowerCase(),
    provider: api.remoteProvider
  };
}

function includesHost(api: CapabilityLookup, fragments: string[]) {
  const host = hostnameOf(api.apiBaseUrl);
  return fragments.some((fragment) => hostIs(host, [fragment]));
}

function thinkingToggle(effort: ModelReasoningEffort) {
  return effort === "none" ? { thinking: { type: "disabled" } } : { thinking: { type: "enabled" } };
}

function deepSeekEffort(effort: ModelReasoningEffort) {
  if (effort === "none") return thinkingToggle(effort);
  return {
    ...thinkingToggle(effort),
    reasoning_effort: effort === "max" || effort === "xhigh" ? "max" : "high"
  };
}

function qwenBudget(effort: ModelReasoningEffort) {
  if (effort === "none") return { enable_thinking: false };
  const budgets: Partial<Record<ModelReasoningEffort, number>> = {
    minimal: 2_048,
    low: 4_096,
    medium: 16_384,
    high: 65_536,
    xhigh: 131_072,
    max: 262_144
  };
  return {
    enable_thinking: true,
    ...(effort ? { thinking_budget: budgets[effort] } : {})
  };
}

/**
 * Narrower entries MUST sit above wider ones. UI options and request-body
 * wire params are both derived from the same match — that is the whole point.
 */
export const MODEL_CAPABILITY_TABLE: ModelCapabilityEntry[] = [
  {
    id: "openai-gpt5-pro",
    reasoningOptions: ["high"],
    defaultReasoningEffort: "high",
    acceptsSampling: false,
    compiler: "reasoner-user-prefix",
    match: (api) => {
      const h = haystack(api);
      return hostIs(h.host, ["openai.com", "openai.azure.com"]) && h.model.startsWith("gpt-5-pro");
    },
    wire: (effort) => (effort ? { reasoning_effort: effort } : {})
  },
  {
    id: "openai-reasoning",
    reasoningOptions: ["none", "low", "medium", "high"],
    defaultReasoningEffort: "high",
    acceptsSampling: false,
    compiler: "reasoner-user-prefix",
    match: (api) => {
      const { host, model } = haystack(api);
      return hostIs(host, ["openai.com", "openai.azure.com"]) && OPENAI_REASONING.test(model) && !model.startsWith("gpt-5-pro");
    },
    wire: (effort) => (effort && effort !== "none" ? { reasoning_effort: effort } : {})
  },
  {
    id: "deepseek-reasoner",
    reasoningOptions: ["none", "high", "max"],
    defaultReasoningEffort: "high",
    acceptsSampling: true,
    compiler: "reasoner-user-prefix",
    match: (api) => DEEPSEEK_REASONER.test(haystack(api).model),
    wire: deepSeekEffort
  },
  {
    id: "deepseek-chat",
    reasoningOptions: [],
    defaultReasoningEffort: "none",
    acceptsSampling: true,
    compiler: "chat-system",
    match: (api) => {
      const h = haystack(api);
      return DEEPSEEK_CHAT.test(h.model) || (h.provider === "deepseek" && !DEEPSEEK_REASONER.test(h.model) && h.model.startsWith("deepseek"));
    },
    wire: () => ({})
  },
  {
    id: "glm-5.2+",
    reasoningOptions: ["none", "high", "max"],
    defaultReasoningEffort: "max",
    acceptsSampling: true,
    compiler: "reasoner-user-prefix",
    match: (api) => GLM_THINKING.test(haystack(api).model),
    wire: deepSeekEffort
  },
  {
    id: "kimi-k2.5+",
    reasoningOptions: ["none", "high"],
    defaultReasoningEffort: "high",
    acceptsSampling: true,
    compiler: "reasoner-user-prefix",
    match: (api) => KIMI_THINKING.test(haystack(api).model),
    wire: (effort) => thinkingToggle(effort === "none" ? "none" : "high")
  },
  {
    id: "qwen3",
    reasoningOptions: ["none", "low", "medium", "high", "max"],
    defaultReasoningEffort: "medium",
    acceptsSampling: true,
    compiler: "chat-system",
    match: (api) => QWEN3.test(haystack(api).model),
    wire: qwenBudget
  },
  {
    id: "xai-grok",
    reasoningOptions: [],
    defaultReasoningEffort: "none",
    acceptsSampling: true,
    compiler: "chat-system",
    match: (api) => includesHost(api, ["api.x.ai", "x.ai"]) || /^grok-/i.test(haystack(api).model),
    wire: () => ({})
  }
];

export function matchModelCapability(api: CapabilityLookup) {
  return MODEL_CAPABILITY_TABLE.find((entry) => entry.match(api));
}

export function buildReasoningWireParams(entry: ModelCapabilityEntry, effort: ModelReasoningEffort | undefined) {
  const resolved = effort && entry.reasoningOptions.includes(effort) ? effort : entry.defaultReasoningEffort;
  return entry.wire(resolved);
}

/**
 * Compiler follows the model name (local, zero wire risk).
 * Vendor-private body keys (thinking / reasoning_effort / thinking_budget)
 * only go out when the host is a known root or remoteProvider aligns.
 */
const WIRE_TRUST: Record<string, { hosts: string[]; providers?: Array<NonNullable<ApiSettings["remoteProvider"]>> }> = {
  "openai-gpt5-pro": { hosts: ["openai.com", "openai.azure.com"] },
  "openai-reasoning": { hosts: ["openai.com", "openai.azure.com"] },
  "deepseek-reasoner": { hosts: ["deepseek.com", "openrouter.ai"], providers: ["deepseek"] },
  "deepseek-chat": { hosts: ["deepseek.com", "openrouter.ai"], providers: ["deepseek"] },
  "glm-5.2+": { hosts: ["bigmodel.cn", "z.ai", "openrouter.ai"], providers: ["glm"] },
  "kimi-k2.5+": { hosts: ["moonshot.cn", "moonshot.ai", "openrouter.ai"], providers: ["kimi"] },
  "qwen3": { hosts: ["aliyuncs.com", "openrouter.ai"], providers: ["qwen"] },
  "xai-grok": { hosts: ["x.ai", "openrouter.ai"] }
};

export function vendorParamsAllowed(entry: ModelCapabilityEntry, api: CapabilityLookup) {
  const rule = WIRE_TRUST[entry.id];
  if (!rule) return false;
  const host = hostnameOf(api.apiBaseUrl);
  if (hostIs(host, rule.hosts)) return true;
  return Boolean(rule.providers && api.remoteProvider && rule.providers.includes(api.remoteProvider));
}

export interface RuntimeLogger {
  warn: (message: string) => void;
}

const defaultLogger: RuntimeLogger = {
  warn: (message) => {
    console.warn(message);
  }
};

export function samplingDisabledByEnv() {
  return process.env.LING_DISABLE_SAMPLING === "1";
}

export function chatSceneLastEnabled() {
  return process.env.LING_CHAT_SCENE_LAST === "1";
}

export function resolveModelRuntimeContract(
  api: CapabilityLookup & { reasoningEffort?: ModelReasoningEffort },
  samplingProfile: SamplingProfile = "dialogue",
  logger: RuntimeLogger = defaultLogger
): ModelRuntimeContract {
  const entry = matchModelCapability(api);
  if (!entry) {
    logger.warn(
      `未识别的模型 ${api.modelName}@${api.apiBaseUrl}，reasoning_effort 将不下发；能力表可能已过期，请更新 modelCapabilityTable.ts`
    );
    return {
      matched: false,
      samplingProfile,
      sampling: null,
      compilerId: "chat-system",
      vendorParamsTrusted: false,
      wireParams: {}
    };
  }

  const reasoningEffort = api.reasoningEffort && entry.reasoningOptions.includes(api.reasoningEffort)
    ? api.reasoningEffort
    : entry.defaultReasoningEffort;

  const sampling = !samplingDisabledByEnv() && entry.acceptsSampling
    ? SAMPLING_PROFILES[samplingProfile]
    : null;

  let compilerId: ModelRuntimeContract["compilerId"] = reasoningEffort !== "none" && entry.compiler === "reasoner-user-prefix"
    ? "reasoner-user-prefix"
    : entry.compiler;
  if (compilerId === "chat-system" && chatSceneLastEnabled()) {
    compilerId = "chat-split-system";
  }

  const candidateWire = buildReasoningWireParams(entry, reasoningEffort);
  const trusted = vendorParamsAllowed(entry, api);
  if (!trusted && Object.keys(candidateWire).length > 0) {
    logger.warn(`厂商私有参数已扣留 ${api.modelName}@${api.apiBaseUrl}，compiler 仍按模型名选择`);
  }

  return {
    capabilityId: entry.id,
    matched: true,
    reasoningEffort,
    samplingProfile,
    sampling,
    compilerId,
    vendorParamsTrusted: trusted,
    wireParams: trusted ? candidateWire : {}
  };
}

export function warnOnUnmatchedModel(api: CapabilityLookup, logger: RuntimeLogger = defaultLogger) {
  if (!matchModelCapability(api)) {
    logger.warn(
      `未识别的模型 ${api.modelName}@${api.apiBaseUrl}，reasoning_effort 将不下发；能力表可能已过期，请更新 modelCapabilityTable.ts`
    );
  }
}
