# AnotherMe 移动端升级详细计划

> 文档版本：v1.0  
> 适用项目：AnotherMe  
> 规划周期：约 22 周（~5.5 个月）

---

## 目录

1. [核心原则与决策](#一核心原则与决策)
2. [目标架构](#二目标架构)
3. [阶段零：技术预研 Spike（第 1-2 周）](#三阶段零技术预研-spike第-1-2-周)
4. [阶段一：基础设施升级（第 3-5 周）](#四阶段一基础设施升级第-3-5-周)
5. [阶段二：Gateway 完善 + OpenAPI 客户端（第 6-8 周）](#五阶段二gateway-完善--openapi-客户端第-6-8-周)
6. [阶段三：LLM 流式对话迁移（第 9-12 周）](#六阶段三llm-流式对话迁移第-9-12-周)
7. [阶段四：React Native 应用开发（第 13-20 周）](#七阶段四react-native-应用开发第-13-20-周)
8. [阶段五：生产发布与收尾（第 21-22 周）](#八阶段五生产发布与收尾第-21-22-周)
9. [风险管理](#九风险管理)
10. [技术规范参考](#十技术规范参考)
11. [总体时间线](#十一总体时间线)

---

## 一、核心原则与决策

在进入详细计划之前，先明确几项关键决策，这些决策决定了后续所有工作的边界。

### 1.1 决策一：移动端不依赖 Next.js（放弃方案 B）

**决定**：移动端直接调用 Python Gateway，不经过 Next.js API Routes 层。

**理由**：
- Next.js 不是为移动端设计的 API 网关，Cookie/CORS/Session 机制与移动端行为存在根本性差异
- 引入 Next.js 作为移动端中间层，制造单点故障
- 后期迁移成本会远超初期节省的时间

**影响**：前期需要在 Python Gateway 补充若干 API，这是合理的工程投入。

### 1.2 决策二：使用 Supabase 托管认证

**决定**：用 Supabase Auth 替代自建 JWT 系统。

**理由**：
- 自建认证在移动端场景边界情况极多（token 刷新、设备管理、生物认证、社交登录）
- Supabase Auth 提供完整的 JWT 体系，并原生支持 React Native SDK
- 可以渐进迁移，先对 Gateway 做最小改造

**影响**：需要一次性配置 Supabase 项目，中期用量在免费额度内完全足够。

### 1.3 决策三：用 OpenAPI 自动生成 TypeScript 客户端

**决定**：FastAPI 导出 OpenAPI spec，用 `openapi-generator` 自动生成 TypeScript 客户端，Web 和移动端共享。

**理由**：
- 彻底解决类型手动对齐问题
- 生成的代码质量已被大量生产项目验证
- 不够灵活的地方可以用手写封装层覆盖，两者不冲突

### 1.4 决策四：LLM 流式对话迁移是关键路径

**决定**：将 Vercel AI SDK 的流式处理逻辑迁移到 Python Gateway，作为单独阶段处理，不与其他工作并行。

**理由**：这是整个方案技术复杂度最高的部分，需要独立验证，不能被压缩到其他阶段中。

---

## 二、目标架构

### 2.1 最终目标架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         客户端层                                      │
│                                                                      │
│  ┌─────────────────┐          ┌──────────────────────────────────┐  │
│  │  Web 前端        │          │  移动端（React Native / Expo）    │  │
│  │  (Next.js)      │          │                                  │  │
│  │                 │          │  - iOS / Android                 │  │
│  │  仅保留 SSR 页面  │          │  - Supabase Auth SDK            │  │
│  │  渲染逻辑        │          │  - 共享 @anotherme/api-client    │  │
│  └────────┬────────┘          └──────────────┬───────────────────┘  │
│           │                                  │                       │
│           └──────────────┬───────────────────┘                       │
│                          │ 共享                                       │
│              ┌───────────▼─────────────┐                             │
│              │  @anotherme/api-client  │                             │
│              │  (自动生成 + 手写封装)   │                             │
│              └───────────┬─────────────┘                             │
└──────────────────────────│──────────────────────────────────────────┘
                           │ HTTPS / SSE / WebSocket
┌──────────────────────────│──────────────────────────────────────────┐
│                    服务端层                                           │
│                          │                                           │
│              ┌───────────▼─────────────┐                             │
│              │   Python Gateway        │                             │
│              │   (FastAPI, port 8080)  │                             │
│              │                        │                             │
│              │   - JWT 验证（Supabase） │                             │
│              │   - REST API            │                             │
│              │   - SSE 流式对话         │                             │
│              │   - WebSocket           │                             │
│              │   - OpenAPI spec 导出   │                             │
│              └────────────┬────────────┘                             │
│                           │                                          │
│          ┌────────────────┼────────────────┐                         │
│          ▼                ▼                ▼                         │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐              │
│   │  LLM APIs   │ │  数据库      │ │  Supabase Auth  │              │
│   │ (OpenAI 等)  │ │ (PostgreSQL) │ │  (JWT 验证中心)  │              │
│   └─────────────┘ └─────────────┘ └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Next.js 的角色变化

| 当前职责 | 迁移后职责 |
|---|---|
| BFF 层（认证、数据转换） | 仅保留 Web 页面的 SSR 渲染 |
| LLM 调用（Vercel AI SDK） | 全部迁移到 Python Gateway |
| 静态 Bearer Token 认证 | 使用 Supabase Auth token 验证 |
| 对外暴露 API | 不再对移动端暴露 API |

---

## 三、阶段零：技术预研 Spike（第 1-2 周）

**目标**：验证关键技术假设，避免在错误方向上大量投入。

> 这个阶段不产出任何生产代码，只产出技术结论和决策。

### 3.1 Spike 1：Supabase Auth 与 Python Gateway 集成验证

**目标**：确认 Supabase JWT 可以在 Python FastAPI 里验证通过。

**任务清单**：
- [ ] 创建 Supabase 临时项目，生成测试用户
- [ ] 在 FastAPI 里实现 JWT 验证中间件
- [ ] 验证 Supabase JWT secret 的获取方式（`SUPABASE_JWT_SECRET`）
- [ ] 测试 token 过期、刷新、无效 token 的错误处理

**关键代码验证点**：

```python
# 需要验证这个中间件能正确工作
import jwt
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def verify_supabase_jwt(token = Security(security)):
    try:
        payload = jwt.decode(
            token.credentials,
            os.environ["SUPABASE_JWT_SECRET"],
            algorithms=["HS256"],
            audience="authenticated"
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

**验收标准**：能从 React Native 客户端获取 Supabase token 并成功调用受保护的 FastAPI 端点。

**风险**：低。Supabase 官方文档有此场景的详细说明。

---

### 3.2 Spike 2：Python Gateway SSE 流式输出验证

**目标**：确认 Python Gateway 可以稳定地向 React Native 推送 SSE 流。

**任务清单**：
- [ ] 在 FastAPI 实现最小可行的 SSE 端点（直接转发 OpenAI stream）
- [ ] 用 React Native 的 `fetch` 消费 SSE（`EventSource` 在 RN 中不原生支持）
- [ ] 验证移动网络切换时（4G → WiFi）的重连行为
- [ ] 压测流式连接的内存占用（模拟 10 个并发流）

**需要验证的 React Native SSE 消费方案**：

```typescript
// React Native 没有原生 EventSource，需要验证以下方案之一：
// 方案 A：使用 react-native-sse 库
// 方案 B：自行用 fetch + ReadableStream 实现
// 方案 C：使用 WebSocket 替代 SSE

// 验证方案 B 的可行性：
const response = await fetch('/v1/ai/chat/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello' }),
});

const reader = response.body?.getReader();
const decoder = new TextDecoder();
while (true) {
  const { done, value } = await reader!.read();
  if (done) break;
  const chunk = decoder.decode(value);
  // 解析 SSE 格式
}
```

**验收标准**：React Native 能稳定接收并渲染流式文字，模拟网络切换后能自动重连。

**风险**：中高。这是整个方案的技术难点，Spike 结论将直接决定阶段三的实现方案。

---

### 3.3 Spike 3：OpenAPI 代码生成质量评估

**目标**：确认 FastAPI 导出的 OpenAPI spec 生成的 TypeScript 客户端质量是否可用。

**任务清单**：
- [ ] 从现有 FastAPI 导出 `openapi.json`
- [ ] 用 `openapi-generator-cli` 生成 `typescript-axios` 客户端
- [ ] 人工审查生成代码，标记不可接受的问题
- [ ] 确认生成代码在 React Native 环境下能运行（无 Node.js 依赖）

**验收标准**：生成代码覆盖 80% 以上的现有 API，剩余 20% 可手写封装层处理。

---

### 3.4 Spike 阶段产出物

- `spike-report.md`：三个 Spike 的结论、遇到的问题、最终决策
- 对阶段三实现方案的确认（SSE vs WebSocket）
- 更新后的风险登记册

---

## 四、阶段一：基础设施升级（第 3-5 周）

**目标**：完成认证系统迁移，为后续所有工作打好地基。

### 4.1 Supabase 项目配置（第 3 周）

#### 4.1.1 Supabase 项目初始化

**任务清单**：
- [ ] 创建生产和 staging 两个 Supabase 项目
- [ ] 配置认证提供商（邮箱/密码必选，Google/Apple 可选）
- [ ] 设置 Row Level Security (RLS) 基础策略
- [ ] 导出 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_JWT_SECRET` 到环境变量管理

#### 4.1.2 用户数据迁移策略

当前系统只有静态 Bearer Token，没有用户体系，所以迁移相对简单：

```sql
-- 在 Supabase 创建用户扩展表，关联现有业务数据
CREATE TABLE public.user_profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 启用 RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 用户只能读写自己的数据
CREATE POLICY "Users can view own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id);
```

#### 4.1.3 现有业务数据与用户关联

审查并更新现有数据表，为需要用户隔离的表添加 `user_id` 字段：

```sql
-- 示例：为课程表添加用户关联
ALTER TABLE courses ADD COLUMN user_id UUID REFERENCES auth.users(id);
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access own courses"
  ON courses FOR ALL
  USING (auth.uid() = user_id);
```

---

### 4.2 Python Gateway 认证中间件（第 4 周）

#### 4.2.1 JWT 验证中间件实现

```python
# gateway/middleware/auth.py

import os
import jwt
from fastapi import HTTPException, Request, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Optional

security = HTTPBearer(auto_error=False)

SUPABASE_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]

class AuthenticatedUser:
    def __init__(self, user_id: str, email: str, role: str):
        self.user_id = user_id
        self.email = email
        self.role = role

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
) -> AuthenticatedUser:
    if not credentials:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    try:
        payload = jwt.decode(
            credentials.credentials,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )
        return AuthenticatedUser(
            user_id=payload["sub"],
            email=payload.get("email", ""),
            role=payload.get("role", "authenticated")
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
```

#### 4.2.2 渐进式认证迁移策略

为了不中断现有 Web 服务，采用**双模式认证**：

```python
# 临时过渡方案：同时支持旧 Bearer Token 和新 JWT
async def get_current_user_transitional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
) -> AuthenticatedUser:
    
    # 先尝试旧的静态 token（向后兼容）
    LEGACY_TOKEN = os.environ.get("LEGACY_BEARER_TOKEN")
    if credentials and credentials.credentials == LEGACY_TOKEN:
        return AuthenticatedUser(user_id="legacy", email="web@legacy", role="admin")
    
    # 再尝试新的 Supabase JWT
    return await get_current_user(credentials)
```

> **注意**：双模式认证只是过渡，在阶段四结束后需要删除 `get_current_user_transitional`，强制使用 JWT。

#### 4.2.3 现有 API 端点更新

批量为现有 API 端点添加认证依赖：

```python
# 修改前
@router.get("/v1/courses")
async def get_courses():
    return course_service.get_all()

# 修改后
from middleware.auth import get_current_user, AuthenticatedUser

@router.get("/v1/courses")
async def get_courses(current_user: AuthenticatedUser = Depends(get_current_user)):
    return course_service.get_by_user(user_id=current_user.user_id)
```

---

### 4.3 Next.js 认证层更新（第 5 周）

Web 端同步迁移到 Supabase Auth：

```typescript
// lib/auth/supabase-client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

```typescript
// 替换现有的认证调用
// 修改前：
const headers = { 'Authorization': `Bearer ${STATIC_TOKEN}` }

// 修改后：
const supabase = createClient()
const { data: { session } } = await supabase.auth.getSession()
const headers = { 'Authorization': `Bearer ${session?.access_token}` }
```

### 4.4 阶段一验收标准

- [ ] Web 端用户可以通过 Supabase 注册/登录，获取 JWT
- [ ] JWT 在 Python Gateway 验证通过，返回受保护资源
- [ ] 旧的静态 Bearer Token 仍可访问（向后兼容）
- [ ] Supabase Auth 的登录/注册页面在 Web 端可用

---

## 五、阶段二：Gateway 完善 + OpenAPI 客户端（第 6-8 周）

**目标**：让 Python Gateway 成为移动端可直接调用的完整后端，并自动化生成客户端代码。

### 5.1 API 完整性审查与补充（第 6 周）

#### 5.1.1 现有 API 审查

对照 Next.js BFF 层（`app/api/*`），列出所有在 Gateway 中缺失的端点：

| BFF 端点 | 迁移状态 | Gateway 对应端点 | 优先级 |
|---|---|---|---|
| `POST /api/courses/generate` | 需迁移 | `POST /v1/courses/generate` | P0 |
| `GET /api/courses/:id` | 已有 | `GET /v1/courses/{id}` | - |
| `POST /api/chat` (流式) | 阶段三处理 | - | P0（阶段三） |
| `GET /api/knowledge-trace` | 需迁移 | `GET /v1/knowledge-trace` | P1 |
| `POST /api/videos/render` | 已有 | `POST /v1/videos/render` | - |
| `GET /api/user/profile` | 需新建 | `GET /v1/users/me` | P0 |

> **实际操作**：根据真实的 `app/api/*` 目录内容，补全此表，以此驱动 Gateway 开发优先级。

#### 5.1.2 新增用户相关 API

```python
# gateway/routers/users.py

@router.get("/v1/users/me")
async def get_current_user_profile(
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    profile = db.query(UserProfile).filter(
        UserProfile.user_id == current_user.user_id
    ).first()
    
    if not profile:
        # 首次登录自动创建 profile
        profile = UserProfile(user_id=current_user.user_id)
        db.add(profile)
        db.commit()
    
    return profile

@router.put("/v1/users/me")
async def update_user_profile(
    body: UpdateProfileRequest,
    current_user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # 更新逻辑...
```

#### 5.1.3 统一错误响应格式

移动端需要一致的错误格式：

```python
# gateway/models/error.py

class ErrorResponse(BaseModel):
    code: str           # 机器可读的错误码，如 "COURSE_NOT_FOUND"
    message: str        # 人类可读的错误描述
    details: dict = {}  # 附加信息

# 全局异常处理器
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            code=f"HTTP_{exc.status_code}",
            message=exc.detail
        ).dict()
    )
```

---

### 5.2 OpenAPI 客户端自动生成流水线（第 7 周）

#### 5.2.1 构建自动化脚本

```bash
#!/bin/bash
# scripts/generate-client.sh

set -e

echo "1. 从 Gateway 导出 OpenAPI spec..."
curl http://localhost:8080/openapi.json > openapi.json

echo "2. 生成 TypeScript 客户端..."
npx @openapitools/openapi-generator-cli generate \
  -i openapi.json \
  -g typescript-axios \
  -o packages/api-client/src/generated \
  --additional-properties=supportsES6=true,withSeparateModelsAndApi=true

echo "3. 运行类型检查..."
cd packages/api-client && npx tsc --noEmit

echo "✅ 客户端生成完成"
```

#### 5.2.2 共享包结构

```
packages/
  api-client/
    src/
      generated/          # 自动生成，不手动修改
        api/              # API 类
        models/           # 类型定义
        index.ts
      wrappers/           # 手写封装层
        auth.ts           # 认证相关封装
        courses.ts        # 课程 API 封装（处理生成代码的边缘情况）
        streaming.ts      # SSE 流式处理封装
      index.ts            # 对外导出入口
    package.json
    tsconfig.json
```

#### 5.2.3 手写封装层示例

生成的代码通常缺乏对 SSE 等特殊场景的支持，用封装层补充：

```typescript
// packages/api-client/src/wrappers/auth.ts

import { Configuration } from '../generated';

let _token: string | null = null;

export function setAuthToken(token: string) {
  _token = token;
}

export function getApiConfig(): Configuration {
  return new Configuration({
    basePath: process.env.GATEWAY_URL || 'http://localhost:8080',
    accessToken: _token ?? undefined,
  });
}
```

```typescript
// packages/api-client/src/wrappers/courses.ts

import { CoursesApi } from '../generated';
import { getApiConfig } from './auth';

// 对外暴露的是封装后的函数，而非生成的类
export async function getCourse(courseId: string) {
  const api = new CoursesApi(getApiConfig());
  const response = await api.v1CoursesIdGet(courseId);
  return response.data;
}

export async function generateCourse(params: GenerateCourseParams) {
  const api = new CoursesApi(getApiConfig());
  const response = await api.v1CoursesGeneratePost(params);
  return response.data;
}
```

#### 5.2.4 集成到 CI 流水线

```yaml
# .github/workflows/generate-client.yml

name: Generate API Client

on:
  push:
    paths:
      - 'gateway/**/*.py'  # Gateway 代码变更时自动触发

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Start Gateway
        run: docker-compose up -d gateway
      - name: Generate Client
        run: ./scripts/generate-client.sh
      - name: Commit if changed
        uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: regenerate API client'
          file_pattern: 'packages/api-client/src/generated/**'
```

---

### 5.3 Web 端迁移到共享客户端（第 8 周）

将 Next.js 中现有的 Gateway 调用逐步替换为共享客户端：

```typescript
// 修改前（Next.js 直接调用）
// lib/server/anotherme2-gateway/courses.ts
const response = await fetch(`${GATEWAY_URL}/v1/courses/${id}`, {
  headers: { Authorization: `Bearer ${token}` }
});

// 修改后（使用共享客户端）
// 同一份代码，Web 和移动端都用
import { getCourse } from '@anotherme/api-client';
const course = await getCourse(id);
```

### 5.4 阶段二验收标准

- [ ] Python Gateway 覆盖所有非流式 API（对照审查表 100% 完成）
- [ ] `openapi.json` 可以正常导出，内容完整
- [ ] 自动生成的 TypeScript 客户端通过类型检查
- [ ] Web 端至少 50% 的 Gateway 调用已迁移到共享客户端
- [ ] CI 流水线在 Gateway 变更时自动重新生成客户端

---

## 六、阶段三：LLM 流式对话迁移（第 9-12 周）

**目标**：将 LLM 流式对话从 Vercel AI SDK / Next.js 完整迁移到 Python Gateway。

> ⚠️ 这是整个计划中技术复杂度最高的部分。建议单独安排，不与其他模块并行。

### 6.1 Python Gateway 流式端点实现（第 9-10 周）

#### 6.1.1 基础 SSE 流式框架

```python
# gateway/routers/ai.py

import asyncio
import json
from typing import AsyncGenerator
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from openai import AsyncOpenAI

router = APIRouter()
client = AsyncOpenAI()

async def stream_llm_response(
    messages: list[dict],
    model: str = "gpt-4o"
) -> AsyncGenerator[str, None]:
    """核心流式生成器：将 OpenAI stream 转换为 SSE 格式"""
    
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        
        async for chunk in stream:
            delta = chunk.choices[0].delta
            
            if delta.content:
                # SSE 格式：data: {...}\n\n
                data = json.dumps({
                    "type": "text_delta",
                    "text": delta.content
                })
                yield f"data: {data}\n\n"
        
        # 流结束标志
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        
    except Exception as e:
        error_data = json.dumps({"type": "error", "message": str(e)})
        yield f"data: {error_data}\n\n"

@router.post("/v1/ai/chat/stream")
async def chat_stream(
    request: ChatStreamRequest,
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    # 1. 从数据库加载对话历史
    history = await conversation_service.get_history(
        conversation_id=request.conversation_id,
        user_id=current_user.user_id
    )
    
    # 2. 构建消息列表
    messages = build_messages(history, request.message)
    
    # 3. 异步保存用户消息
    asyncio.create_task(
        conversation_service.save_message(
            conversation_id=request.conversation_id,
            role="user",
            content=request.message
        )
    )
    
    # 4. 返回 SSE 流
    return StreamingResponse(
        stream_llm_response(messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 禁用 Nginx 缓冲
        }
    )
```

#### 6.1.2 对话历史持久化

流式对话必须解决响应持久化问题：

```python
# gateway/services/conversation.py

class ConversationService:
    
    async def stream_and_persist(
        self,
        conversation_id: str,
        user_id: str,
        messages: list[dict]
    ) -> AsyncGenerator[str, None]:
        """流式输出的同时，将完整响应持久化到数据库"""
        
        full_response = []
        
        async for chunk in stream_llm_response(messages):
            yield chunk
            # 收集完整响应
            if '"type": "text_delta"' in chunk:
                data = json.loads(chunk.replace("data: ", ""))
                full_response.append(data.get("text", ""))
        
        # 流结束后保存完整响应
        await self.save_message(
            conversation_id=conversation_id,
            role="assistant",
            content="".join(full_response)
        )
```

#### 6.1.3 LangGraph 集成（如果现有逻辑依赖 LangChain）

如果当前 Vercel AI SDK 调用包含了工具调用（Tool Use）或复杂的 Agent 逻辑：

```python
# 工具调用需要单独处理，SSE 格式需要包含工具调用事件
async def stream_with_tools(messages: list) -> AsyncGenerator[str, None]:
    
    async for event in agent.astream_events({"messages": messages}):
        kind = event["event"]
        
        if kind == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            if chunk.content:
                yield f"data: {json.dumps({'type': 'text_delta', 'text': chunk.content})}\n\n"
        
        elif kind == "on_tool_start":
            yield f"data: {json.dumps({'type': 'tool_start', 'tool': event['name']})}\n\n"
        
        elif kind == "on_tool_end":
            yield f"data: {json.dumps({'type': 'tool_end', 'tool': event['name']})}\n\n"
```

---

### 6.2 React Native SSE 客户端封装（第 11 周）

基于 Spike 2 的结论，实现客户端封装：

```typescript
// packages/api-client/src/wrappers/streaming.ts

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_end'; tool: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface StreamChatOptions {
  conversationId: string;
  message: string;
  onEvent: (event: StreamEvent) => void;
  onComplete: () => void;
  onError: (error: Error) => void;
  signal?: AbortSignal;
}

export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { conversationId, message, onEvent, onComplete, onError, signal } = options;
  
  const token = await getAuthToken();
  
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/ai/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({ conversation_id: conversationId, message }),
      signal,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            onEvent(event);
            if (event.type === 'done') {
              onComplete();
              return;
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }
    }
  } catch (error) {
    if ((error as Error).name !== 'AbortError') {
      onError(error as Error);
    }
  }
}
```

#### 断线重连机制

```typescript
export async function streamChatWithRetry(
  options: StreamChatOptions,
  maxRetries = 3
): Promise<void> {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      await streamChat(options);
      return;
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        options.onError(error as Error);
        return;
      }
      // 指数退避
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
  }
}
```

---

### 6.3 Web 端迁移（第 12 周）

将 Next.js 中的 Vercel AI SDK 调用替换为共享客户端：

```typescript
// 修改前（Vercel AI SDK）
import { useChat } from 'ai/react';

const { messages, input, handleSubmit } = useChat({
  api: '/api/chat',
});

// 修改后（共享客户端）
import { streamChat } from '@anotherme/api-client';
import { useState } from 'react';

function useChatStream(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const sendMessage = async (text: string) => {
    setIsStreaming(true);
    let currentText = '';
    
    await streamChat({
      conversationId,
      message: text,
      onEvent: (event) => {
        if (event.type === 'text_delta') {
          currentText += event.text;
          setMessages(prev => updateLastMessage(prev, currentText));
        }
      },
      onComplete: () => setIsStreaming(false),
      onError: (err) => {
        console.error(err);
        setIsStreaming(false);
      }
    });
  };
  
  return { messages, sendMessage, isStreaming };
}
```

### 6.4 阶段三验收标准

- [ ] Python Gateway 的 SSE 端点可以稳定流式输出（测试 100 次无中断）
- [ ] 对话历史正确持久化到数据库（流结束后记录完整）
- [ ] Web 端 AI 对话功能从 Vercel AI SDK 完整迁移，用户无感知
- [ ] React Native 的流式客户端通过模拟网络切换测试
- [ ] 压测：10 个并发流式连接，内存和 CPU 在合理范围内

---

## 七、阶段四：React Native 应用开发（第 13-20 周）

**目标**：基于前三个阶段的基础，开发 React Native 移动端应用。

### 7.1 项目初始化（第 13 周）

#### 7.1.1 技术栈选型

| 模块 | 选型 | 理由 |
|---|---|---|
| 框架 | React Native + Expo SDK 52 | 简化构建流程，支持 OTA 更新 |
| 导航 | Expo Router（基于 React Navigation） | 与 Next.js App Router 开发习惯接近 |
| 状态管理 | Zustand（与 Web 端统一） | 可复用 Web 端的 store 设计模式 |
| UI 组件库 | React Native Paper | Material Design 3，社区活跃 |
| 认证 | @supabase/supabase-js | 官方 React Native 支持 |
| 本地存储 | expo-secure-store + MMKV | token 用 Keychain，其他用 MMKV |
| 网络请求 | axios（通过共享客户端） | 与生成的客户端一致 |
| 测试 | Jest + React Native Testing Library | 与 Web 端测试工具链统一 |

#### 7.1.2 项目结构

```
mobile/
  app/                        # Expo Router 页面
    (auth)/
      login.tsx
      register.tsx
    (tabs)/
      index.tsx               # 首页
      courses.tsx             # 课程列表
      chat.tsx                # AI 对话
      profile.tsx             # 个人中心
    course/
      [id].tsx                # 课程详情
  components/                 # 移动端专属组件
    ChatBubble.tsx
    CourseCard.tsx
    StreamingText.tsx         # 流式文字渲染组件（重要）
  hooks/                      # 移动端 hooks
    useStreamChat.ts
    useNetworkStatus.ts       # 网络状态监听
  store/                      # Zustand stores（可复用 Web 端逻辑）
    auth.store.ts
    chat.store.ts
  lib/
    supabase.ts               # Supabase 客户端初始化
    api-client.ts             # 共享客户端初始化
```

#### 7.1.3 Supabase 认证集成

```typescript
// mobile/lib/supabase.ts

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,  // 移动端不使用 URL scheme 检测
    },
  }
);
```

---

### 7.2 核心功能开发（第 14-18 周）

按优先级排列，每周完成一个核心模块：

#### 第 14 周：认证流程

```typescript
// mobile/app/(auth)/login.tsx

import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { router } from 'expo-router';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      Alert.alert('登录失败', error.message);
    } else {
      router.replace('/(tabs)');
    }
    
    setLoading(false);
  }

  // 生物认证（Face ID / 指纹）
  async function handleBiometricLogin() {
    const { success } = await LocalAuthentication.authenticateAsync({
      promptMessage: '使用生物认证登录',
    });
    
    if (success) {
      // 从 SecureStore 读取已保存的凭证
      const savedToken = await SecureStore.getItemAsync('refresh_token');
      if (savedToken) {
        await supabase.auth.refreshSession({ refresh_token: savedToken });
        router.replace('/(tabs)');
      }
    }
  }

  return (
    // UI 实现...
  );
}
```

#### 第 15 周：课程列表与详情

这部分可以大量复用共享客户端，相对简单：

```typescript
// mobile/hooks/useCourses.ts

import { useEffect, useState } from 'react';
import { getCourses, getCourse } from '@anotherme/api-client';

export function useCourseList() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    getCourses()
      .then(setCourses)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  return { courses, loading, error };
}
```

#### 第 16 周：AI 流式对话（关键模块）

```typescript
// mobile/components/StreamingText.tsx
// 核心挑战：流式文字更新时避免整个列表重渲染

import { memo, useRef } from 'react';
import { Text } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';

export const StreamingText = memo(({ text, isStreaming }: { 
  text: string; 
  isStreaming: boolean;
}) => {
  // 使用光标动画表示正在流式输出
  const cursorOpacity = useSharedValue(1);
  
  return (
    <Text>
      {text}
      {isStreaming && <Animated.Text style={{ opacity: cursorOpacity }}>▊</Animated.Text>}
    </Text>
  );
});
```

```typescript
// mobile/hooks/useStreamChat.ts

import { useCallback, useRef, useState } from 'react';
import { streamChatWithRetry } from '@anotherme/api-client';

export function useStreamChat(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (text: string) => {
    // 取消进行中的流
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    
    // 立即添加用户消息和空的 AI 消息
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      { role: 'assistant', content: '', isStreaming: true }
    ]);
    
    setIsStreaming(true);
    
    await streamChatWithRetry({
      conversationId,
      message: text,
      signal: abortControllerRef.current.signal,
      onEvent: (event) => {
        if (event.type === 'text_delta') {
          // 只更新最后一条消息，避免整个列表重渲染
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: updated[updated.length - 1].content + event.text,
            };
            return updated;
          });
        }
      },
      onComplete: () => {
        setIsStreaming(false);
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            isStreaming: false,
          };
          return updated;
        });
      },
      onError: (err) => {
        console.error('Stream error:', err);
        setIsStreaming(false);
      },
    });
  }, [conversationId]);

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  return { messages, sendMessage, stopStreaming, isStreaming };
}
```

#### 第 17 周：离线支持与网络状态

移动端特有的离线处理：

```typescript
// mobile/hooks/useNetworkStatus.ts

import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';

export function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [isInternetReachable, setIsInternetReachable] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected ?? false);
      setIsInternetReachable(state.isInternetReachable ?? false);
    });
    return unsubscribe;
  }, []);

  return { isConnected, isInternetReachable };
}

// 请求队列：离线时缓存操作，上线后自动同步
// mobile/lib/offline-queue.ts

interface QueuedAction {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

export class OfflineQueue {
  private queue: QueuedAction[] = [];
  
  enqueue(action: Omit<QueuedAction, 'id' | 'createdAt'>) {
    this.queue.push({
      ...action,
      id: Math.random().toString(36),
      createdAt: Date.now(),
    });
    // 持久化到 MMKV
    this.persist();
  }
  
  async flush() {
    while (this.queue.length > 0) {
      const action = this.queue[0];
      try {
        await this.execute(action);
        this.queue.shift();
        this.persist();
      } catch {
        break; // 执行失败则停止，等下次网络恢复
      }
    }
  }
  
  private async execute(action: QueuedAction) {
    // 根据 action.type 执行对应操作
  }
  
  private persist() {
    storage.set('offline_queue', JSON.stringify(this.queue));
  }
}
```

#### 第 18 周：推送通知

```typescript
// mobile/lib/notifications.ts

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export async function registerForPushNotifications() {
  if (!Device.isDevice) return null;
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') return null;
  
  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  });
  
  // 将 token 注册到 Gateway
  await updateUserPushToken(token.data);
  
  return token.data;
}
```

```python
# Gateway 端需要新增推送 token 管理
@router.post("/v1/users/me/push-token")
async def register_push_token(
    body: PushTokenRequest,
    current_user: AuthenticatedUser = Depends(get_current_user)
):
    await user_service.save_push_token(
        user_id=current_user.user_id,
        token=body.token,
        platform=body.platform  # "ios" | "android"
    )
    return {"success": True}
```

---

### 7.3 性能优化（第 19 周）

#### 7.3.1 列表渲染优化

```typescript
// 使用 FlashList 替代 FlatList（性能提升 5-10x）
import { FlashList } from '@shopify/flash-list';

function MessageList({ messages }: { messages: Message[] }) {
  return (
    <FlashList
      data={messages}
      renderItem={({ item }) => <MessageBubble message={item} />}
      estimatedItemSize={80}
      // 只有最后一条消息是流式的，用 keyExtractor 避免不必要重渲染
      keyExtractor={(item) => item.id}
    />
  );
}
```

#### 7.3.2 图片和媒体优化

```typescript
// 使用 expo-image 替代 RN Image，支持渐进加载和缓存
import { Image } from 'expo-image';

const blurhash = '|rF?hV%2WCj[ayj[a|j[az_NaeWBj@ayfRayfQfQM{M|azj[azf6fQfQfQIpWXofj[ayj[j[fQayWCoeoeaya}j[ayfQa{oLj?j[WVj[ayayj[fQoff7azayj[ayj[j[ayofayayayj[fQj[ayayj[ayfjj[j[ayjuayj[';

<Image
  source={course.thumbnailUrl}
  placeholder={blurhash}
  contentFit="cover"
  transition={200}
/>
```

---

### 7.4 测试（第 20 周）

#### 7.4.1 单元测试

```typescript
// mobile/__tests__/useStreamChat.test.ts

import { renderHook, act } from '@testing-library/react-hooks';
import { useStreamChat } from '../hooks/useStreamChat';

// Mock 共享客户端
jest.mock('@anotherme/api-client', () => ({
  streamChatWithRetry: jest.fn(async ({ onEvent, onComplete }) => {
    onEvent({ type: 'text_delta', text: 'Hello' });
    onEvent({ type: 'text_delta', text: ' World' });
    onEvent({ type: 'done' });
    onComplete();
  }),
}));

test('流式消息正确累积', async () => {
  const { result } = renderHook(() => useStreamChat('test-conversation-id'));
  
  await act(async () => {
    await result.current.sendMessage('Hi');
  });
  
  expect(result.current.messages).toHaveLength(2);
  expect(result.current.messages[1].content).toBe('Hello World');
  expect(result.current.isStreaming).toBe(false);
});
```

#### 7.4.2 E2E 测试

使用 Maestro 做移动端 E2E 测试：

```yaml
# mobile/e2e/login-flow.yaml
appId: com.anotherme.app
---
- launchApp
- tapOn: "邮箱"
- inputText: "test@example.com"
- tapOn: "密码"
- inputText: "password123"
- tapOn: "登录"
- assertVisible: "我的课程"
```

### 7.5 阶段四验收标准

- [ ] 完整的登录/注册流程（包括生物认证）
- [ ] 课程列表和详情页正常显示
- [ ] AI 流式对话在 iOS 和 Android 上稳定运行
- [ ] 网络断开时有友好提示，重连后自动恢复
- [ ] 推送通知正常接收
- [ ] 单元测试覆盖率 ≥ 70%（核心 hooks 和 store）
- [ ] E2E 测试覆盖主要用户流程

---

## 八、阶段五：生产发布与收尾（第 21-22 周）

### 8.1 CI/CD 流水线配置（第 21 周）

```yaml
# .github/workflows/mobile-release.yml

name: Mobile Release

on:
  push:
    tags:
      - 'mobile-v*'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: expo/expo-github-action@v8
        with:
          expo-version: latest
          token: ${{ secrets.EXPO_TOKEN }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test --workspace=mobile
      
      - name: Build for iOS (TestFlight)
        run: eas build --platform ios --profile production
        env:
          EXPO_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          EXPO_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          EXPO_PUBLIC_GATEWAY_URL: ${{ secrets.GATEWAY_URL }}
      
      - name: Build for Android (Play Store)
        run: eas build --platform android --profile production
      
      - name: Submit to stores
        run: eas submit --platform all
```

### 8.2 应用商店合规检查

在提交审核前，需要确认以下 AI 内容相关合规项：

**Apple App Store：**
- [ ] 隐私政策中说明 AI 生成内容的使用方式
- [ ] App Store Connect 中正确填写 AI 功能声明（2024 年新要求）
- [ ] 用户可以举报不当的 AI 生成内容

**Google Play Store：**
- [ ] 声明使用了生成式 AI
- [ ] 用户协议中包含 AI 使用条款

### 8.3 监控与报警配置（第 22 周）

```python
# Gateway 端：关键指标监控
# 使用 Prometheus + Grafana 或 Sentry

from prometheus_client import Counter, Histogram

stream_requests = Counter('ai_stream_requests_total', 'Total streaming requests')
stream_duration = Histogram('ai_stream_duration_seconds', 'Streaming duration')
stream_errors = Counter('ai_stream_errors_total', 'Streaming errors', ['error_type'])

@router.post("/v1/ai/chat/stream")
async def chat_stream(request: ChatStreamRequest, ...):
    stream_requests.inc()
    with stream_duration.time():
        try:
            # 流式逻辑
        except Exception as e:
            stream_errors.labels(error_type=type(e).__name__).inc()
            raise
```

**报警规则**：
- 流式请求错误率 > 5%：立即报警
- P95 流式延迟 > 10s：警告
- Gateway 内存使用 > 80%：警告
- 移动端崩溃率 > 1%：立即报警（Sentry）

### 8.4 阶段五验收标准

- [ ] iOS 和 Android 应用成功上传到 TestFlight / Play Console 内部测试
- [ ] CI/CD 流水线：代码合并后 30 分钟内完成构建
- [ ] 监控看板正常显示关键指标
- [ ] 完成内部测试（至少 10 名测试用户试用 3 天无严重 bug）
- [ ] 旧的静态 Bearer Token 已从 Gateway 代码中删除

---

## 九、风险管理

### 9.1 风险登记册

| 风险 | 概率 | 影响 | 缓解措施 | 应急预案 |
|---|---|---|---|---|
| SSE 在 React Native 某版本表现异常 | 中 | 高 | Spike 2 提前验证 | 降级为 WebSocket 实现 |
| Vercel AI SDK 迁移遗漏复杂 Agent 逻辑 | 中 | 高 | 阶段三前完整梳理现有逻辑 | 保留 Next.js 端点作为备用 |
| Apple 审核因 AI 内容被拒 | 低 | 高 | 提前阅读最新审核指南 | 准备内容过滤机制 |
| 团队对 React Native 不熟悉 | 高 | 中 | 阶段四前安排 RN 基础培训 | 引入外部顾问 |
| Gateway 并发流式连接超出服务器容量 | 低 | 高 | 压测 + 自动扩缩容配置 | 限流 + 用户排队机制 |
| Supabase Auth 服务不稳定 | 极低 | 极高 | 监控 Supabase 状态页 | 准备自托管 Supabase 方案 |

### 9.2 里程碑 Go/No-Go 决策点

在以下节点，需要团队评估是否继续：

- **第 2 周末（Spike 结束）**：如果 SSE Spike 验证失败，决定是否改用 WebSocket
- **第 5 周末（阶段一结束）**：如果认证迁移影响到现有 Web 端用户，决定是否回滚
- **第 12 周末（阶段三结束）**：如果流式迁移稳定性不达标，移动端 AI 对话可以降级为轮询

---

## 十、技术规范参考

### 10.1 API 命名规范

```
GET    /v1/resources          # 列表
GET    /v1/resources/{id}     # 详情
POST   /v1/resources          # 创建
PUT    /v1/resources/{id}     # 全量更新
PATCH  /v1/resources/{id}     # 部分更新
DELETE /v1/resources/{id}     # 删除

# 特殊操作用动词
POST   /v1/courses/{id}/publish
POST   /v1/ai/chat/stream

# 用户自身资源
GET    /v1/users/me
PUT    /v1/users/me
```

### 10.2 SSE 数据格式规范

```typescript
// 所有 SSE 事件的统一格式
type SSEEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_end'; tool: string; output: unknown }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number } };
```

### 10.3 错误码规范

```typescript
// 统一的机器可读错误码
type ErrorCode =
  | 'UNAUTHORIZED'           // 401，token 无效或缺失
  | 'FORBIDDEN'              // 403，无权访问
  | 'NOT_FOUND'              // 404，资源不存在
  | 'RATE_LIMITED'           // 429，请求过于频繁
  | 'COURSE_NOT_FOUND'       // 业务错误：课程不存在
  | 'CONVERSATION_NOT_FOUND' // 业务错误：对话不存在
  | 'LLM_ERROR'              // LLM 调用失败
  | 'INTERNAL_ERROR';        // 500，服务器内部错误
```

---

## 十一、总体时间线

```
第 1-2 周    [阶段零] 技术预研 Spike
              ├── Spike 1: Supabase Auth + FastAPI 集成
              ├── Spike 2: Python SSE → React Native
              └── Spike 3: OpenAPI 代码生成质量评估

第 3-5 周    [阶段一] 基础设施升级
              ├── Supabase 项目配置
              ├── Gateway 认证中间件
              └── Web 端认证迁移

第 6-8 周    [阶段二] Gateway 完善 + OpenAPI 客户端
              ├── API 完整性审查与补充
              ├── OpenAPI 自动生成流水线
              └── Web 端迁移到共享客户端

第 9-12 周   [阶段三] LLM 流式对话迁移 ⚠️ 关键路径
              ├── Python Gateway SSE 端点实现
              ├── React Native SSE 客户端封装
              └── Web 端 Vercel AI SDK 替换

第 13-20 周  [阶段四] React Native 应用开发
              ├── 项目初始化 + 架构搭建
              ├── 认证流程
              ├── 课程列表/详情
              ├── AI 流式对话
              ├── 离线支持 + 推送通知
              ├── 性能优化
              └── 测试

第 21-22 周  [阶段五] 生产发布与收尾
              ├── CI/CD 配置
              ├── 应用商店提交
              └── 监控报警配置

总计：约 22 周（5.5 个月）
```

### 关键里程碑

| 时间节点 | 里程碑 | 标志 |
|---|---|---|
| 第 2 周末 | Spike 结论确认 | 三个 Spike 报告完成，技术路径确定 |
| 第 5 周末 | 认证系统上线 | Web 端使用 Supabase 登录 |
| 第 8 周末 | Gateway API 完整 + 客户端自动化 | CI 自动生成客户端，Web 端迁移完成 |
| 第 12 周末 | LLM 迁移完成 | Next.js 端 AI 对话代码清零 |
| 第 20 周末 | 移动端功能完整 | 内测版本发布 |
| 第 22 周末 | 生产发布 | 上架 App Store + Google Play |

---

*文档结束*  
*如需调整具体模块的优先级或技术选型，请基于 Spike 阶段的实际结论更新本计划。*
