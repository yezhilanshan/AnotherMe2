# @anotherme/api-client

Mobile + Web 共享的 AnotherMe Gateway TypeScript 客户端与类型。

## 1. 生成 OpenAPI 类型

> P0 任务：让前后端共享一份真实、可维护的 OpenAPI 类型。

### 1.1 工作模式

`pnpm generate` 在两种模式之间**自动 fallback**：

| 模式 | 触发条件 | 输出 |
| --- | --- | --- |
| **gateway** | 启动脚本后能访问 `${GATEWAY_URL}/openapi.json`（默认 `http://localhost:8080`） | 直接从 FastAPI 拉最新 spec |
| **local** | Gateway 不可达 / 显式 `--offline` / 环境变量 `GENERATE_OFFLINE=1` | 读本目录的 `openapi.json` 快照 |

`openapi.json` 是兜底快照，**与 FastAPI 路由保持手工对齐**，保证
CI / 离线开发能跑通。

### 1.2 命令

```bash
# 拉取远端最新 spec（拉不到就回落到本地快照）
pnpm generate

# 强制只读本地快照（CI 推荐）
pnpm generate:offline

# 强制只拉远端（拉不到就报错）
pnpm generate:gateway
```

可使用环境变量：

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `GATEWAY_URL` | `http://localhost:8080` | Gateway 根地址 |
| `GENERATE_OFFLINE=1` | — | 强制使用本地快照 |
| `GENERATE_REMOTE=1` | — | 强制拉远端（不回落） |

### 1.3 产物

- 写入 `src/types/generated.ts`（`paths` / `components` / `operations` 全部展开）
- 头部带 `// DO NOT EDIT` 警告，提醒这是生成文件

## 2. 客户端使用

```ts
import { createApiClient } from '@anotherme/api-client';

const api = createApiClient({
  baseUrl: 'http://localhost:8082',
  getToken: () => localStorage.getItem('token') || '',
});

// 类型完全自动推导
const caps = await api.capabilities.list();
const job = await api.jobs.create({ job_type: 'course_generate', payload: {...} });
```

`ApiError`（自动重试 / 401 / 网络异常的归一化）也会在 `client/api.ts` 重新导出。

## 3. P0 完成验收

- [x] `pnpm generate` 跑通，**生成 60+KB 真实类型**（不是空 `Record<never>`）
- [x] 远端/本地双模式 + 兜底快照
- [x] Gateway capability 归一化（`_normalize_capability`）已与客户端别名表同步
- [x] 移动端 capability 收敛到 `ai_tutor_chat` 默认值，保留 `chat` / `question` 等历史别名
- [x] 移动端 typecheck 通过（`pnpm typecheck`）
- [x] 移动端 capability 单元测试通过（`pnpm test:capability`，13/13）

详见：[`P0-验收清单.md`](./P0-验收清单.md)
