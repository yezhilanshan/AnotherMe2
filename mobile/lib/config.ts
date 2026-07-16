// Gateway / Web BFF 配置
// 开发时优先使用 .env 显式覆盖；未配置时从 Expo dev server 自动推导电脑局域网 IP。
// 运行时可通过 "我的" → "Gateway 设置" 修改地址，无需重新 build。
import modelConfig from "../config/models.json";
import Constants from "expo-constants";
import { NativeModules } from "react-native";
import {
  getGatewayHost,
  getGatewayPort,
  getWebPort,
  getGatewayUrl,
  getWebUrl,
  onGatewayConfigChange,
} from "./runtime-gateway-config";

// ============================================================
// 开发环境配置
// ============================================================
const normalizeUrl = (url: string) => {
  let result = url.trim().replace(/\/+$/, "");
  // Convert http://host:443 → https://host and https://host:443 → https://host
  result = result.replace(/^http:\/\/(.+):443(\/.*)?$/, "https://$1$2");
  result = result.replace(/^https:\/\/(.+):443(\/.*)?$/, "https://$1$2");
  // Convert http://host:80 → http://host and https://host:80 → http://host
  result = result.replace(/^https?:\/\/(.+):80(\/.*)?$/, "http://$1$2");
  return result;
};

type ExpoHostConstants = {
  expoConfig?: { hostUri?: string };
  expoGoConfig?: { hostUri?: string };
  manifest?: { debuggerHost?: string };
  manifest2?: { extra?: { expoGoConfig?: { hostUri?: string } } };
};

function hostFromUri(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.trim()) return null;
  const withoutScheme = uri.trim().replace(/^[a-z][a-z\d+.-]*:\/\//i, "");
  const authority = withoutScheme.split(/[/?#]/)[0] || "";
  if (!authority) return null;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    return end > 1 ? authority.slice(1, end) : null;
  }
  return authority.split(":")[0] || null;
}

function isLanLikeHost(host: string | null): host is string {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  if (!value || value === "localhost" || value === "0.0.0.0") return false;
  if (value === "127.0.0.1" || value === "::1") return false;
  if (value.includes(".exp.direct")) return false;
  if (value.includes(".loca.lt") || value.includes(".ngrok")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  return value.endsWith(".local");
}

function detectExpoDevHost(): string | null {
  const constants = Constants as unknown as ExpoHostConstants;
  const candidates: unknown[] = [
    constants.expoConfig?.hostUri,
    constants.expoGoConfig?.hostUri,
    constants.manifest?.debuggerHost,
    constants.manifest2?.extra?.expoGoConfig?.hostUri,
  ];

  try {
    candidates.push(NativeModules.SourceCode?.scriptURL);
  } catch {
    // Ignore missing native module in non-native environments.
  }

  for (const candidate of candidates) {
    const host = hostFromUri(candidate);
    if (isLanLikeHost(host)) return host;
  }
  return null;
}

// 电脑局域网 IP（.env 中 EXPO_PUBLIC_DEV_SERVER_HOST 优先；USB reverse 可显式设为 127.0.0.1）
// 运行时可通过 getGatewayHost() 获取用户修改后的值
export let DEV_SERVER_HOST: string =
  process.env.EXPO_PUBLIC_DEV_SERVER_HOST?.trim() ||
  detectExpoDevHost() ||
  "127.0.0.1";

export let GATEWAY_PORT =
  process.env.EXPO_PUBLIC_GATEWAY_PORT?.trim() || "8083";

// Web 端口（Next.js dev server）
let WEB_PORT = process.env.EXPO_PUBLIC_WEB_PORT?.trim() || "3000";

// ============================================================
// 覆盖 URL（local tunnel / ngrok / 自定义域名）
// 设置了覆盖 URL 则直接使用，忽略 DEV_SERVER_HOST
// ============================================================

function buildUrlFromHostPort(host: string, port: string): string {
  const cleanHost = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const cleanPort = String(port || "").trim();

  if (cleanPort === "443") {
    return `https://${cleanHost}`;
  }

  if (cleanPort === "80") {
    return `http://${cleanHost}`;
  }

  return `http://${cleanHost}:${cleanPort}`;
}

const GATEWAY_URL_FROM_ENV = process.env.EXPO_PUBLIC_GATEWAY_URL?.trim();
const GATEWAY_OVERRIDE_URL_FROM_ENV =
  process.env.EXPO_PUBLIC_GATEWAY_OVERRIDE_URL?.trim();
const GATEWAY_OVERRIDE_URL: string | undefined =
  GATEWAY_URL_FROM_ENV || GATEWAY_OVERRIDE_URL_FROM_ENV || undefined;

export let GATEWAY_URL = GATEWAY_OVERRIDE_URL
  ? normalizeUrl(GATEWAY_OVERRIDE_URL)
  : buildUrlFromHostPort(DEV_SERVER_HOST, GATEWAY_PORT);

// localtunnel 需要 bypass header 才能直接返回 API 响应
export let TUNNEL_HEADERS: Record<string, string> =
  GATEWAY_OVERRIDE_URL &&
  (GATEWAY_OVERRIDE_URL.includes(".loca.lt") ||
    GATEWAY_OVERRIDE_URL.includes(".ngrok"))
    ? { "bypass-tunnel-reminder": "true" }
    : {};

console.log("[config] GATEWAY_URL:", GATEWAY_URL);

const WEB_URL_FROM_ENV = process.env.EXPO_PUBLIC_WEB_URL?.trim();
const WEB_OVERRIDE_URL_FROM_ENV =
  process.env.EXPO_PUBLIC_WEB_OVERRIDE_URL?.trim();
const WEB_OVERRIDE_URL: string | undefined =
  WEB_URL_FROM_ENV || WEB_OVERRIDE_URL_FROM_ENV || undefined;

export let WEB_URL = WEB_OVERRIDE_URL
  ? normalizeUrl(WEB_OVERRIDE_URL)
  : buildUrlFromHostPort(DEV_SERVER_HOST, WEB_PORT);

export let WEB_TUNNEL_HEADERS: Record<string, string> =
  WEB_OVERRIDE_URL &&
  (WEB_OVERRIDE_URL.includes(".loca.lt") || WEB_OVERRIDE_URL.includes(".ngrok"))
    ? { "bypass-tunnel-reminder": "true" }
    : {};

console.log("[config] WEB_URL:", WEB_URL);

// ============================================================
// 运行时配置同步 —— 将 runtime-gateway-config 持久化值
// 同步到本模块的 live bindings（ESM import 会实时反映变更）
// ============================================================

let _runtimeSynced = false;

/** 将运行时配置同步到所有 export let 变量 */
export function syncRuntimeConfig(): void {
  DEV_SERVER_HOST = getGatewayHost();
  GATEWAY_PORT = getGatewayPort();
  WEB_PORT = getWebPort();
  GATEWAY_URL = getGatewayUrl();
  WEB_URL = getWebUrl();
  _runtimeSynced = true;
}

/** 确保运行时配置已加载并同步 */
export function ensureRuntimeConfigSynced(): boolean {
  return _runtimeSynced;
}

// ============================================================
// 连接测试
// ============================================================

/** 测试 Gateway 连接，返回是否可达 */
/** 测试 Gateway 连接，返回是否可达 */
export async function testGatewayConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const url = `${GATEWAY_URL}/v1/capabilities`;
  console.log("[gateway-test] request url:", url);

  try {
    const startedAt = Date.now();

    const res = await fetch(url, {
      headers: TUNNEL_HEADERS,
    });

    const elapsed = Date.now() - startedAt;

    console.log("[gateway-test] response:", {
      url,
      status: res.status,
      ok: res.ok,
      elapsed,
    });

    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        message: `连接成功: ${data.service || "Gateway"}\n${url}\nHTTP ${res.status}\n耗时 ${elapsed}ms`,
      };
    }

    return {
      ok: false,
      message: `Gateway HTTP ${res.status}\n${url}\n耗时 ${elapsed}ms`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    console.log("[gateway-test] error:", {
      url,
      message,
      stack: e instanceof Error ? e.stack : undefined,
    });

    return {
      ok: false,
      message: `无法连接 Gateway\n${url}\n${message}`,
    };
  }
}

/** 测试 Web/BFF 连接，区分 Web 不可达和 Gateway 不可达 */
/** 测试 Web/BFF 连接，区分 Web 不可达和 Gateway 不可达 */
export async function testWebBffConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const url = `${WEB_URL}/api/live-book/books`;
  console.log("[web-bff-test] request url:", url);

  try {
    const startedAt = Date.now();

    const res = await fetch(url, {
      headers: WEB_TUNNEL_HEADERS,
    });

    const elapsed = Date.now() - startedAt;

    console.log("[web-bff-test] response:", {
      url,
      status: res.status,
      ok: res.ok,
      elapsed,
    });

    if (res.ok) {
      return {
        ok: true,
        message: `连接成功: Web/BFF 可访问\n${url}\nHTTP ${res.status}\n耗时 ${elapsed}ms`,
      };
    }

    if (res.status === 502) {
      return {
        ok: false,
        message: `Web/BFF 可访问，但它连接不到 Python Gateway。\n${url}`,
      };
    }

    return {
      ok: false,
      message: `Web/BFF HTTP ${res.status}\n${url}\n耗时 ${elapsed}ms`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    console.log("[web-bff-test] error:", {
      url,
      message,
      stack: e instanceof Error ? e.stack : undefined,
    });

    return {
      ok: false,
      message: `无法连接 Web/BFF\n${url}\n${message}`,
    };
  }
}

// ============================================================
// 认证 / 用户
// ============================================================

// 静态 Bearer Token（用于技术验证阶段）
// 后续接入 Supabase Auth 后会替换为 JWT
export const BEARER_TOKEN = "";

// 用户标识（无登录阶段使用固定值，后续接入 Supabase Auth 后替换）
export const USER_ID = "mobile-user";

// API 超时时间（毫秒）
export const API_TIMEOUT = 30000;

// ============================================================
// Capability 归一化（与 tutor_engine orchestrator 一致）
// ============================================================
//
// tutor_engine 注册的 capability id：
//   tutor_engine/runtime/bootstrap/builtin_capabilities.py
//
// 移动端历史上混用 `chat` / `question` / 注册 id，这里集中做归一化，
// 避免前后端对不上。Gateway 侧有镜像归一化，客户端调用前再做一次更直观。
export const CAPABILITY_IDS = {
  /** 智能路由（苏格拉底式启发教学） */
  auto: "auto",
  /** 一般对话 / 辅导聊天 */
  ai_tutor_chat: "chat",
  /** 拍题问答（多模态） */
  deep_solve: "deep_solve",
  /** 深度追问 / 练习生成 */
  deep_question: "deep_question",
  /** 深度资料检索 */
  deep_research: "deep_research",
  /** 课堂生成（异步 job） */
  course_generate: "course_generate",
  /** 拍题视频生成（异步 job） */
  problem_video_generate: "problem_video_generate",
  /** 学科动画 */
  math_animator: "math_animator",
  /** 数据可视化 */
  visualize: "visualize",
  /** 网关内部拍题快答路由 */
  visual_solve_fast: "visual_solve_fast",
  /** 协作写作 */
  co_writer: "co_writer",
  /** 题目练习 */
  quiz_practice: "quiz_practice",
  /** 互动演示 */
  interactive_demo: "interactive_demo",
} as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[keyof typeof CAPABILITY_IDS];

const LIVE_ANSWER_STEP_CAPABILITIES = new Set<string>([
  CAPABILITY_IDS.deep_solve,
]);

/** 把 capability 归一化到 Gateway 注册 id，空值默认 chat */
export function normalizeCapability(raw: string | null | undefined): string {
  return raw || CAPABILITY_IDS.ai_tutor_chat;
}

export function supportsLiveAnswerSteps(
  capability: string | null | undefined,
): boolean {
  return LIVE_ANSWER_STEP_CAPABILITIES.has(normalizeCapability(capability));
}

// ============================================================
// 可用模型列表
// ============================================================

export interface ModelDef {
  id: string;
  label: string;
  provider: string;
  description: string;
  supportsVision: boolean;
  supportsTools: boolean;
  maxInputTokens: number;
  defaultFor?: string[];
}

type ModelCatalog = {
  defaultModel: string;
  capabilityDefaults?: Record<string, string>;
  models: ModelDef[];
};

const typedModelConfig = modelConfig as ModelCatalog;

export const AVAILABLE_MODELS: ModelDef[] = typedModelConfig.models;
export const DEFAULT_MODEL = modelConfig.defaultModel;
export const CAPABILITY_DEFAULT_MODELS =
  typedModelConfig.capabilityDefaults || {};

export function getDefaultModelForCapability(
  capability?: string | null,
): string {
  if (!capability) return DEFAULT_MODEL;
  return CAPABILITY_DEFAULT_MODELS[capability] || DEFAULT_MODEL;
}

export function getMaxOutputTokensForCapability(
  capability?: string | null,
): number {
  switch (normalizeCapability(capability)) {
    case CAPABILITY_IDS.deep_solve:
    case CAPABILITY_IDS.visual_solve_fast:
    case CAPABILITY_IDS.deep_question:
    case CAPABILITY_IDS.deep_research:
      return 4096;
    case CAPABILITY_IDS.math_animator:
    case CAPABILITY_IDS.visualize:
      return 3072;
    default:
      return 4096;
  }
}

export function getModelDefinition(modelId?: string | null): ModelDef | null {
  if (!modelId) return null;
  return AVAILABLE_MODELS.find((item) => item.id === modelId) || null;
}

export function modelSupportsVision(modelId?: string | null): boolean {
  const model = getModelDefinition(modelId);
  return Boolean(model?.supportsVision);
}

export function getDefaultVisionModel(capability?: string | null): string {
  const capabilityModel = getDefaultModelForCapability(capability);
  if (modelSupportsVision(capabilityModel)) return capabilityModel;
  if (modelSupportsVision(DEFAULT_MODEL)) return DEFAULT_MODEL;
  return (
    AVAILABLE_MODELS.find((item) => item.supportsVision)?.id || DEFAULT_MODEL
  );
}

// ============================================================
// AI 对话能力定义（与网页端 features/ai-tutor 对齐）
// ============================================================

export interface CapabilityDef {
  id: string; // Gateway 请求中的 capability 名称
  label: string;
  description: string;
  icon: string; // Ionicons 名称
}

// capability id 必须与 Gateway 的 capabilityHandlers 一致
// Gateway 实际接受: chat, deep_solve, deep_question, deep_research, math_animator, visualize
// 以及内部路由 visual_solve_fast
export const CHAT_CAPABILITIES: CapabilityDef[] = [
  {
    id: "auto",
    label: "智能导师",
    description: "苏格拉底式启发教学",
    icon: "compass",
  },
  {
    id: "",
    label: "聊天",
    description: "灵活对话，可使用多种工具",
    icon: "chatbubbles",
  },
  {
    id: "deep_solve",
    label: "深度解题",
    description: "多步骤推理与问题解决",
    icon: "bulb",
  },
  {
    id: "deep_question",
    label: "练习生成",
    description: "自动生成练习题目",
    icon: "document-text",
  },
  {
    id: "deep_research",
    label: "深度研究",
    description: "多源搜索与研究报告",
    icon: "telescope",
  },
  {
    id: "math_animator",
    label: "数学动画",
    description: "生成数学视频或分镜图",
    icon: "videocam",
  },
  {
    id: "visualize",
    label: "可视化",
    description: "生成图表和示意图",
    icon: "bar-chart",
  },
];

/** 空状态建议卡片 */
export const SUGGESTION_CARDS = [
  {
    title: "解题",
    description: "逐步解答数学问题",
    prompt: "帮我解这道数学题，请给出详细步骤",
    icon: "calculator",
  },
  {
    title: "概念讲解",
    description: "深入理解任何知识点",
    prompt: "用简单的话解释量子力学",
    icon: "bulb",
  },
  {
    title: "代码辅助",
    description: "生成和调试代码",
    prompt: "写一个 Python 函数来排序列表",
    icon: "code-slash",
  },
  {
    title: "深度研究",
    description: "多维度综合分析",
    prompt: "研究人工智能的最新发展",
    icon: "search",
  },
  {
    title: "可视化",
    description: "生成图表和示意图",
    prompt: "创建一个机器学习流程图",
    icon: "bar-chart",
  },
  {
    title: "头脑风暴",
    description: "激发创意灵感",
    prompt: "为科学项目头脑风暴一些创意",
    icon: "bulb",
  },
];
