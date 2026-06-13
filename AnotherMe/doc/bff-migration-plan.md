# AnotherMe BFF (Backend-for-Frontend) 改造计划

## 1. 现状分析

### 1.1 结论：当前不是严格的 BFF 模式

| 维度 | 现状 | 是否合规 |
|------|------|----------|
| **API 路由层** | 大部分模块已使用 Next.js API Route 代理到 Gateway | ✅ 合规 |
| **客户端直接请求** | `live-book` 模块的前端代码直接调用 Gateway | ❌ 不合规 |
| **WebSocket** | Messages 模块通过 `/api/messages/ws-config` 获取 Gateway WS 地址后直连 | ⚠️ 半合规 |
| **静态资源** | `AnimationBlock` 使用 `apiUrl()` 拼接 Gateway 地址渲染视频/图片 | ❌ 不合规 |
| **CORS** | Gateway 刚添加 CORS 配置，但不应依赖它 | ⚠️ 需移除 |

### 1.2 客户端直连 Gateway 的代码清单

```
lib/live-book/api.ts          ← 浏览器端 fetch 直接访问 Gateway HTTP API
lib/live-book/api.ts          ← 浏览器端 new WebSocket 直接连接 Gateway WS
features/live-book/components/blocks/AnimationBlock.tsx  ← 使用 apiUrl() 拼接资源地址
features/messages/client/messages-client.tsx             ← 通过 ws-config 获取地址后直连 WS
```

### 1.3 已有的合规 BFF 路由（正确示例）

```
app/api/co-writer/[...path]/route.ts       ← 代理 /co-writer/* 到 Gateway
app/api/live-book/[...path]/route.ts       ← 代理 /live-book/* 到 Gateway（本次新增）
app/api/messages/ws-config/route.ts        ← 返回 Gateway WS 地址（供前端直连，需改造）
app/api/problem-video/route.ts             ← 代理题目视频相关请求
app/api/ai/sessions/route.ts               ← 使用 gatewayFetch 调用 Gateway
app/api/messages/conversations/route.ts    ← 使用 gatewayFetch 调用 Gateway
app/api/students/[userId]/profile/route.ts ← 使用 gatewayFetch 调用 Gateway
... 等 16+ 个 API Route
```

### 1.4 服务端调用 Gateway 的工具（正确示例）

```
lib/server/anotherme2-gateway/core.ts      ← gatewayFetch，自动注入 Authorization
lib/server/anotherme2-gateway/ai.ts        ← AI 会话相关 Gateway 调用
lib/server/anotherme2-gateway/messages.ts  ← 消息相关 Gateway 调用
lib/server/anotherme2-gateway/learning.ts  ← 学习记录相关 Gateway 调用
lib/server/anotherme2-gateway/problem-video.ts ← 题目视频相关 Gateway 调用
```

---

## 2. 问题与风险

### 2.1 安全风险

| 风险点 | 说明 |
|--------|------|
| **Token 泄露** | `ANOTHERME2_GATEWAY_TOKEN` 是服务器端密钥。若暴露给浏览器，用户可在 DevTools 中窃取并直接访问 Gateway |
| **CORS 滥用** | Gateway 开放 CORS 后，任何网站都可向 Gateway 发起请求（如果知道地址和 token） |
| **绕过前端权限控制** | 恶意用户可直接调用 Gateway API，绕过 Next.js 中的权限校验逻辑 |

### 2.2 架构风险

| 风险点 | 说明 |
|--------|------|
| **前后端耦合** | 前端硬编码 Gateway 地址，部署环境变化时需要重新构建前端 |
| **无法做请求转换** | 直连模式下，Next.js 层无法对请求/响应做转换、缓存、限流 |
| **无法统一错误处理** | 前端需要处理 Gateway 的各种错误格式，增加复杂度 |

---

## 3. 改造目标

> **所有浏览器发出的 HTTP/WS 请求，必须先经过 Next.js API Route，再由 Next.js 服务器转发到 Gateway。**

即：
```
Browser → Next.js API Route (/api/*) → Gateway (127.0.0.1:8080)
```

而不是：
```
Browser ──❌──→ Gateway (127.0.0.1:8080)
```

---

## 4. 改造计划

### Phase 1：HTTP API 代理（高优先级）

#### 4.1.1 已完成 ✅
- [x] `app/api/live-book/[...path]/route.ts` — 代理 `/live-book/*` 到 Gateway
- [x] `lib/live-book/api.ts` — 浏览器端使用 `/api/live-book/*` 而非直连 Gateway

#### 4.1.2 待完成
- [ ] `app/api/co-writer/[...path]/route.ts` — **补充 Authorization header**
  - 当前该路由没有传递 `Authorization: Bearer <token>`
  - 若 Gateway 启用了 token 校验，所有 co-writer 请求会 401
  - **修改**：参照 `live-book` 代理，添加 TOKEN 读取和 header 注入

- [ ] `lib/live-book/api.ts` 中的 `wsUrl()` — WebSocket 仍需直连，需单独处理（见 Phase 2）

### Phase 2：WebSocket 代理（高优先级）

#### 4.2.1 Live-Book WebSocket

当前：`lib/live-book/api.ts` 中 `openBookSocket()` 直接连接 `ws://127.0.0.1:8080/live-book/ws`

**方案 A（推荐）：Next.js Edge Runtime WebSocket 代理**

创建 `app/api/live-book/ws/route.ts`：
```typescript
export const runtime = 'edge';

export async function GET(req: NextRequest) {
  const upgrade = req.headers.get('upgrade');
  if (upgrade !== 'websocket') {
    return new NextResponse('Expected websocket', { status: 400 });
  }

  const gatewayWsUrl = `${GATEWAY_WS_BASE}/live-book/ws`;
  // Edge Runtime 中使用 WebSocket 客户端连接 Gateway，然后 pipe 到客户端
  // ...
}
```

**方案 B：Socket.io 或自定义 WS 中继**

如果 Edge Runtime WebSocket 代理有兼容性问题，可创建一个独立的 Node.js WS 中继服务，或直接使用 Next.js App Router 的 experimental websocket 支持。

**方案 C（过渡方案）：通过 API Route 获取临时 token**

创建 `app/api/live-book/ws-token/route.ts`，返回一个短期有效的 WS 连接 token，前端用这个 token 直连 Gateway WS。Gateway 验证 token 而非长期有效的 `ANOTHERME2_GATEWAY_TOKEN`。

#### 4.2.2 Messages WebSocket

当前：`features/messages/client/messages-client.tsx` 通过 `/api/messages/ws-config` 获取 Gateway WS 地址后直连。

改造方式同 Phase 2.1，创建 `app/api/messages/ws/route.ts` 作为 WS 代理。

### Phase 3：静态资源代理（中优先级）

#### 4.3.1 AnimationBlock 资源 URL

当前：`features/live-book/components/blocks/AnimationBlock.tsx` 使用 `apiUrl(url)` 拼接 Gateway 地址，浏览器直接加载视频/图片。

**改造方案**：

创建 `app/api/live-book/assets/[...path]/route.ts`：
```typescript
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const gatewayUrl = `${GATEWAY}/live-book/assets/${path.join('/')}`;
  const res = await fetch(gatewayUrl, {
    headers: { Authorization: TOKEN ? `Bearer ${TOKEN}` : '' },
  });
  return new NextResponse(res.body, { status: res.status, headers: res.headers });
}
```

修改 `AnimationBlock.tsx` 中的 `resolveAssetUrl()`：
```typescript
function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `/api/live-book/assets${url.startsWith('/') ? url : `/${url}`}`;
}
```

### Phase 4：移除 Gateway CORS（低优先级）

当所有前端请求都通过 Next.js API Route 后，Gateway 不再需要 CORS：

- [ ] 移除 `anotherme2_engine/api_gateway/app.py` 中的 `CORSMiddleware`
- [ ] 或限制 `allow_origins=[]`（仅保留用于开发调试）

这样 Gateway 只接受来自 Next.js 服务器的请求，安全性大幅提升。

### Phase 5：统一代理模式规范（长期）

#### 4.5.1 建立代理路由模板

所有新的 Gateway 代理路由应遵循统一模板：

```typescript
// app/api/{module}/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.ANOTHERME2_GATEWAY_BASE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.ANOTHERME2_GATEWAY_TOKEN?.trim();

async function proxy(req: NextRequest, path: string[]) {
  const url = `${GATEWAY}/{module}/${path.join('/')}`;
  const headers: Record<string, string> = {};

  const contentType = req.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;

  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined,
    cache: 'no-store',
  });

  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}

export async function GET(...) { return proxy(...); }
export async function POST(...) { return proxy(...); }
// ... PUT, PATCH, DELETE
```

#### 4.5.2 建立客户端 API 模板

浏览器端 API 客户端统一使用相对路径：

```typescript
// lib/{module}/api.ts
const BASE = '/api/{module}';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  // ...
}
```

#### 4.5.3 废弃 `NEXT_PUBLIC_GATEWAY_URL`

浏览器端不应知道 Gateway 的存在。移除所有 `NEXT_PUBLIC_GATEWAY_URL` 的使用，统一通过 `/api/*` 访问。

---

## 5. 文件变更清单

### 已修改（本次）
| 文件 | 变更 |
|------|------|
| `anotherme2_engine/api_gateway/app.py` | 添加 CORS Middleware（过渡方案） |
| `app/api/live-book/[...path]/route.ts` | 新建 — 代理 live-book HTTP API |
| `lib/live-book/api.ts` | 修改 — 浏览器端使用 `/api/live-book/*` |

### 待修改（Phase 1）
| 文件 | 变更 |
|------|------|
| `app/api/co-writer/[...path]/route.ts` | 补充 `Authorization: Bearer <token>` header |

### 待修改（Phase 2）
| 文件 | 变更 |
|------|------|
| `app/api/live-book/ws/route.ts` | 新建 — WebSocket 代理 |
| `lib/live-book/api.ts` | 修改 — `wsUrl()` 使用 `/api/live-book/ws` |
| `app/api/messages/ws/route.ts` | 新建 — Messages WebSocket 代理 |
| `features/messages/client/messages-client.tsx` | 修改 — 使用 `/api/messages/ws` |
| `app/api/messages/ws-config/route.ts` | 可废弃或改为返回 `/api/messages/ws` |

### 待修改（Phase 3）
| 文件 | 变更 |
|------|------|
| `app/api/live-book/assets/[...path]/route.ts` | 新建 — 静态资源代理 |
| `features/live-book/components/blocks/AnimationBlock.tsx` | 修改 — `resolveAssetUrl()` 使用 `/api/live-book/assets` |

### 待修改（Phase 4）
| 文件 | 变更 |
|------|------|
| `anotherme2_engine/api_gateway/app.py` | 移除 CORS Middleware |

---

## 6. 验证清单

改造完成后，验证以下场景：

- [ ] Live-Book 列表页正常加载（`/api/live-book/books`）
- [ ] Live-Book WebSocket 连接正常（`/api/live-book/ws`）
- [ ] Live-Book 视频/图片资源正常播放（`/api/live-book/assets`）
- [ ] Messages WebSocket 连接正常（`/api/messages/ws`）
- [ ] Co-Writer 功能正常（`/api/co-writer/*`）
- [ ] 浏览器 Network 面板中不再出现对 `127.0.0.1:8080` 的直接请求
- [ ] Gateway 日志中所有请求来源都是 `127.0.0.1`（Next.js 服务器）
- [ ] 移除 Gateway CORS 后，前端功能不受影响

---

## 7. 时间估算

| Phase | 工作量 | 预估时间 |
|-------|--------|----------|
| Phase 1：HTTP API 代理补全 | 1 个文件修改 | 30 分钟 |
| Phase 2：WebSocket 代理 | 2-3 个文件新建 + 2 个文件修改 | 2-4 小时 |
| Phase 3：静态资源代理 | 1 个文件新建 + 1 个文件修改 | 1 小时 |
| Phase 4：移除 CORS | 1 个文件修改 | 15 分钟 |
| Phase 5：规范统一 | 文档 + 模板 | 1 小时 |
| **总计** | | **4-7 小时** |

---

*计划制定时间：2026-05-25*
*适用范围：AnotherMe 全项目*
