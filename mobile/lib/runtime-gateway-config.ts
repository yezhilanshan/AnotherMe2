/**
 * Runtime Gateway 配置
 *
 * 允许在 App 运行时修改 Gateway 地址（host + port），无需重新 build。
 * 配置持久化到 AsyncStorage，重启 App 后自动恢复。
 *
 * 所有模块应通过 `getGatewayUrl()` / `getWebUrl()` 读取地址，
 * 而不是编译期的 `GATEWAY_URL` 常量。
 */

import { getSafeStorage } from "./safeStorage";

const STORAGE_KEY = "@anotherme/gateway-config";

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

// ── 默认值（来自 .env 编译期变量） ──
const DEFAULT_HOST =
  process.env.EXPO_PUBLIC_DEV_SERVER_HOST?.trim() || "127.0.0.1";
const DEFAULT_GATEWAY_PORT =
  process.env.EXPO_PUBLIC_GATEWAY_PORT?.trim() || "8083";
const DEFAULT_WEB_PORT = process.env.EXPO_PUBLIC_WEB_PORT?.trim() || "3000";

// ── 运行时状态 ──
let _host = DEFAULT_HOST;
let _gatewayPort = DEFAULT_GATEWAY_PORT;
let _webPort = DEFAULT_WEB_PORT;
let _initialized = false;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => {
    try { fn(); } catch { /* 防止一个监听器异常影响其他 */ }
  });
}

// ── Getters ──

export function getGatewayHost(): string {
  return _host;
}

export function getGatewayPort(): string {
  return _gatewayPort;
}

export function getWebPort(): string {
  return _webPort;
}

export function getGatewayUrl(): string {
  return normalizeUrl(`http://${_host}:${_gatewayPort}`);
}

export function getWebUrl(): string {
  return normalizeUrl(`http://${_host}:${_webPort}`);
}

// ── 订阅配置变更 ──

/**
 * 订阅配置变更。返回取消订阅函数。
 * 当 updateGatewayConfig() 被调用或 init 完成后触发。
 */
export function onGatewayConfigChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

// ── 持久化 & 初始化 ──

async function persist(): Promise<void> {
  try {
    const storage = getSafeStorage();
    await storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ host: _host, gatewayPort: _gatewayPort, webPort: _webPort }),
    );
  } catch {
    // 静默失败，不影响使用
  }
}

/**
 * 更新运行时配置并持久化。
 * 调用后所有 getter 返回新值，并通知订阅者。
 */
export async function updateGatewayConfig(partial: {
  host?: string;
  gatewayPort?: string;
  webPort?: string;
}): Promise<void> {
  if (partial.host !== undefined && partial.host.trim()) {
    _host = partial.host.trim();
  }
  if (partial.gatewayPort !== undefined && partial.gatewayPort.trim()) {
    _gatewayPort = partial.gatewayPort.trim();
  }
  if (partial.webPort !== undefined && partial.webPort.trim()) {
    _webPort = partial.webPort.trim();
  }
  await persist();
  notify();
}

/**
 * 从 AsyncStorage 加载已保存的配置。
 * 应在 App 启动时尽早调用。
 */
export async function initGatewayConfig(): Promise<void> {
  if (_initialized) return;
  _initialized = true;
  try {
    const storage = getSafeStorage();
    const raw = await storage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      let changed = false;
      if (typeof saved.host === "string" && saved.host.trim()) {
        _host = saved.host.trim();
        changed = true;
      }
      if (typeof saved.gatewayPort === "string" && saved.gatewayPort.trim()) {
        _gatewayPort = saved.gatewayPort.trim();
        changed = true;
      }
      if (typeof saved.webPort === "string" && saved.webPort.trim()) {
        _webPort = saved.webPort.trim();
        changed = true;
      }
      if (changed) {
        notify();
      }
    }
  } catch {
    // 加载失败使用默认值
  }
}

// ── 重置 ──

export async function resetGatewayConfig(): Promise<void> {
  _host = DEFAULT_HOST;
  _gatewayPort = DEFAULT_GATEWAY_PORT;
  _webPort = DEFAULT_WEB_PORT;
  await persist();
  notify();
}
