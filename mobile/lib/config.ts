// Gateway 配置
// 开发时自动从 Expo dev server 获取电脑局域网 IP，无需手动修改
// 如果自动检测失败，可手动设置下面的 DEV_SERVER_HOST

import Constants from "expo-constants";
import { Platform, NativeModules } from "react-native";
import modelConfig from "../config/models.json";

// ============================================================
// 手动覆盖：如果自动检测不准，填入电脑 IP（去掉 undefined 改成实际 IP）
// 在 cmd 中运行 ipconfig 查看 "IPv4 地址"
// ============================================================
const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

const DEV_SERVER_HOST: string | undefined =
  process.env.EXPO_PUBLIC_DEV_SERVER_HOST?.trim() || undefined; // 自动检测，如需手动设置填入电脑 IP

/** 判断是否为有效的局域网 IP（非隧道、非 localhost） */
function isValidLanIp(ip: string): boolean {
  if (!ip || ip === "localhost" || ip === "127.0.0.1") return false;
  // 过滤 Expo 隧道地址
  if (ip.includes(".exp.direct")) return false;
  // 过滤 localtunnel / ngrok 等
  if (ip.includes(".loca.lt") || ip.includes(".ngrok")) return false;
  // 必须是 IPv4 格式或 .local 主机名
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return true;
  if (ip.endsWith(".local")) return true;
  return false;
}

function getDevHostIp(): string {
  // 1. 手动覆盖优先
  if (DEV_SERVER_HOST) {
    console.log("[config] 使用手动配置 IP:", DEV_SERVER_HOST);
    return DEV_SERVER_HOST;
  }

  // 2. 从 expo-constants 自动检测（Expo Go / dev client）
  try {
    const candidates = [
      (Constants as any).expoConfig?.hostUri,
      (Constants as any).expoGoConfig?.hostUri,
      (Constants as any).manifest?.debuggerHost,
      (Constants as any).manifest2?.extra?.expoGoConfig?.hostUri,
    ];

    for (const hostUri of candidates) {
      if (hostUri && typeof hostUri === "string") {
        const ip = hostUri.split(":")[0];
        if (isValidLanIp(ip)) {
          console.log("[config] 自动检测到电脑 IP:", ip);
          return ip;
        }
      }
    }
  } catch (e) {
    console.warn("[config] expo-constants 检测失败:", e);
  }

  // 3. 从 native module 的 scriptURL 提取（Metro bundler 地址）
  try {
    const scriptURL = NativeModules.SourceCode?.scriptURL;
    if (scriptURL && typeof scriptURL === "string") {
      const match = scriptURL.match(/^https?:\/\/([^:/]+)/);
      if (match && isValidLanIp(match[1])) {
        console.log("[config] 从 scriptURL 检测到电脑 IP:", match[1]);
        return match[1];
      }
    }
  } catch {
    // ignore
  }

  console.warn("[config] 无法自动检测电脑 IP，请手动设置 DEV_SERVER_HOST");
  return "localhost";
}

const LOCAL_IP = getDevHostIp();
export const GATEWAY_PORT = process.env.EXPO_PUBLIC_GATEWAY_PORT?.trim() || "8082"; // Gateway 端口（避免与 Expo Metro 8081 冲突）

// Tunnel 模式下，Gateway 也需要通过隧道暴露
// 启动方式: npx localtunnel --port 8082
// 把生成的 URL 填到下面（每次重启会变）
// 同一 WiFi 下设为 undefined，直接用局域网 IP 连接
// 把 localtunnel 生成的 URL 填到这里（每次重启 tunnel 会变）
// 启动命令: npx localtunnel --port 8082
const GATEWAY_TUNNEL_URL: string | undefined =
  process.env.EXPO_PUBLIC_GATEWAY_URL?.trim() || undefined; // 改成 'https://xxx.loca.lt'

export const GATEWAY_URL = __DEV__
  ? (GATEWAY_TUNNEL_URL ? normalizeUrl(GATEWAY_TUNNEL_URL) : `http://${LOCAL_IP}:${GATEWAY_PORT}`)
  : "https://api.anotherme.com";

// localtunnel 需要 bypass header 才能直接返回 API 响应（否则显示警告页面）
export const TUNNEL_HEADERS: Record<string, string> = GATEWAY_TUNNEL_URL
  ? { "bypass-tunnel-reminder": "true" }
  : {};

console.log("[config] GATEWAY_URL:", GATEWAY_URL);

/** 测试 Gateway 连接，返回是否可达 */
export async function testGatewayConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${GATEWAY_URL}/`, {
      signal: controller.signal,
      headers: TUNNEL_HEADERS,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      return { ok: true, message: `连接成功: ${data.service || "Gateway"}` };
    }
    return { ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// Web 端地址（WebView 加载 / BFF 代理）
const WEB_PORT = process.env.EXPO_PUBLIC_WEB_PORT?.trim() || "3000"; // Next.js dev server 端口
const WEB_OVERRIDE_URL: string | undefined = process.env.EXPO_PUBLIC_WEB_URL?.trim() || undefined;
export const WEB_URL = __DEV__
  ? (WEB_OVERRIDE_URL ? normalizeUrl(WEB_OVERRIDE_URL) : `http://${LOCAL_IP}:${WEB_PORT}`)
  : "https://app.anotherme.com";

// localtunnel 需要 bypass header 才能直接返回 API 响应（否则显示警告页面）
export const WEB_TUNNEL_HEADERS: Record<string, string> =
  WEB_OVERRIDE_URL && (WEB_OVERRIDE_URL.includes(".loca.lt") || WEB_OVERRIDE_URL.includes(".ngrok"))
    ? { "bypass-tunnel-reminder": "true" }
    : {};

console.log("[config] WEB_URL:", WEB_URL);

/** 测试 Web/BFF 连接，区分 Web 不可达和 Gateway 不可达 */
export async function testWebBffConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${WEB_URL}/api/live-book/books`, {
      signal: controller.signal,
      headers: WEB_TUNNEL_HEADERS,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      return { ok: true, message: `连接成功: Web/BFF 可访问 (${WEB_URL})` };
    }

    if (res.status === 502) {
      return {
        ok: false,
        message: `Web/BFF 可访问，但它连接不到 Python Gateway。\nWeb/BFF: ${WEB_URL}\n请检查 Web 端 ANOTHERME2_GATEWAY_BASE_URL。`,
      };
    }

    return { ok: false, message: `Web/BFF HTTP ${res.status}: ${WEB_URL}` };
  } catch (e) {
    return {
      ok: false,
      message: `无法连接 Web/BFF：${WEB_URL}\n${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

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
  /** 协作写作 */
  co_writer: "co_writer",
  /** 题目练习 */
  quiz_practice: "quiz_practice",
  /** 互动演示 */
  interactive_demo: "interactive_demo",
} as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[keyof typeof CAPABILITY_IDS];

/** 把 capability 归一化到 Gateway 注册 id，空值默认 chat */
export function normalizeCapability(raw: string | null | undefined): string {
  return raw || CAPABILITY_IDS.ai_tutor_chat;
}

// ============================================================
// 可用模型列表
// ============================================================

export interface ModelDef {
  id: string;
  label: string;
  provider: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelDef[] = modelConfig.availableModels;
export const DEFAULT_MODEL = modelConfig.defaultModel;

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
