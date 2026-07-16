# AnotherMe 活书引擎 & 协作写作 — 架构文档

> 基于 2026-05-25 对话整理。涵盖 DeepTutor 交互式书籍引擎完整迁移到 AnotherMe 的全过程。

---

## 一、项目整体架构

```
AnotherMe-main/
├── AnotherMe/                          # Next.js 16 前端 + Python 后端
│   ├── app/                            # Next.js App Router
│   │   ├── (dashboard)/                # 需登录的页面
│   │   │   ├── live-book/              # 活书引擎入口
│   │   │   └── co-writer/              # 协作写作入口（新）
│   │   └── api/
│   │       └── co-writer/[...path]/    # BFF 代理 → Python 网关
│   │
│   ├── features/                       # 功能模块
│   │   ├── live-book/                  # 活书引擎（25 文件）
│   │   │   ├── client/live-book-client.tsx  # 主容器（458 行）
│   │   │   └── components/             # 24 个 React 组件
│   │   │       ├── blocks/             # 15 Block + BlockRenderer
│   │   │       └── PageReader, BookCreator, ...  # 9 页面组件
│   │   │
│   │   └── co-writer/                  # 协作写作（3 文件）
│   │       └── pages/co-writer/
│   │           ├── page.tsx            # 文档列表（中文）
│   │           ├── editor-page.tsx     # Markdown 编辑器（中文，2232 行）
│   │           └── sampleTemplate.ts
│   │
│   ├── components/                     # 共享 UI 组件
│   │   ├── common/                     # MarkdownRenderer, SimpleMarkdownRenderer
│   │   ├── visualize/                  # VisualizationViewer (SVG/Chart.js/Mermaid)
│   │   └── Mermaid.tsx
│   │
│   ├── lib/                            # TypeScript 纯逻辑库
│   │   ├── live-book/                  # 活书专用（5 文件）
│   │   │   ├── types.ts                # Book/Block/Page 类型定义
│   │   │   ├── api.ts                  # API 客户端 + 网关 URL 配置
│   │   │   ├── progress.ts             # 进度状态机
│   │   │   ├── quiz-question-type.ts   # Quiz 类型逻辑
│   │   │   └── visualize-types.ts      # 可视化类型
│   │   │
│   │   ├── co-writer-api.ts            # 协作写作 API 客户端
│   │   ├── co-writer-events.ts         # 协作写作事件总线
│   │   ├── server/                     # 共享服务端工具（api-response, ssrf-guard 等）
│   │   └── utils/                      # latex.ts, markdown-display.ts, iframe-html.ts
│   │
│   └── anotherme2_engine/             # Python 后端
│       ├── api_gateway/                # FastAPI 网关（端口 8080）
│       │   ├── app.py                  # 主应用（已挂载 live_book + co_writer 路由）
│       │   ├── routes/
│       │   │   ├── live_book.py        # 活书路由适配器
│       │   │   └── co_writer.py        # 协作写作路由（CRUD + 懒加载 AI 编辑）
│       │   └── .env                    # 网关配置
│       │
│       ├── live_book_engine/           # 活书引擎（270 .py，从 DeepTutor vendor）
│       │   ├── book/                   # 书引擎核心（33 文件）
│       │   │   ├── engine.py           # BookEngine 编排器
│       │   │   ├── compiler.py         # BookCompiler
│       │   │   ├── models.py           # 13 种 BlockType 等数据模型
│       │   │   ├── agents/             # 5 个 Agent（Ideation, SourceExplorer, Spine...）
│       │   │   ├── blocks/             # 15 个 Block 生成器
│       │   │   └── prompts/            # LLM 提示词
│       │   │
│       │   ├── co_writer/              # 协作写作引擎
│       │   │   ├── edit_agent.py       # AI 编辑 Agent
│       │   │   └── storage.py          # 文件系统存储
│       │   │
│       │   ├── agents/                 # DeepTutor Agent 基础设施
│       │   ├── services/               # 服务层（llm, prompt, config, path_service）
│       │   ├── core/                   # StreamBus 事件流
│       │   └── ...
│       │
│       ├── agents/                     # AnotherMe 原有 Agent（image→video 管线）
│       └── main.py                     # CLI 入口（image→video）
│
└── DeepTutor/                          # 原始 DeepTutor 项目（仅作参考，不再依赖）
```

---

## 二、活书引擎架构

### 2.1 数据流

```
用户浏览器 (localhost:3000)
  │
  ├─→ live-book-client.tsx (状态管理)
  │     ├─→ bookApi.list() / get() / create()
  │     │     └─→ fetch → 127.0.0.1:8080/live-book/*  (直连网关，同活书 BFF 前缀)
  │     │           └─→ routes/live_book.py (适配器)
  │     │                 └─→ live_book_engine.BookEngine
  │     │
  │     ├─→ openBookSocket()  (WebSocket 实时事件)
  │     │     └─→ ws://127.0.0.1:8080/live-book/ws
  │     │
  │     └─→ PageReader → BlockRenderer → 15 种 Block 组件
  │
  └─→ 视图状态机: list → creator → spine → reader
```

### 2.2 完整编译管线

```
create_book(user_intent)
  → IdeationAgent    → BookProposal（提案）
  → confirm_proposal()
  → SourceExplorer   → RAG 源材料检索
  → SpineSynthesizer → Spine（章节目录 + 概念图）
  → confirm_spine()  → Page 壳创建
  → PagePlanner      → 页面内 Block 编排
  → compile_page()
  → 15 BlockGenerators → 各类型 Block 生成
    ├── TextGenerator
    ├── QuizGenerator
    ├── FigureGenerator   (SVG/Chart.js/Mermaid)
    ├── InteractiveGenerator (HTML)
    ├── AnimationGenerator  (Manim → MP4)
    ├── CodeGenerator
    ├── TimelineGenerator
    ├── FlashCardsGenerator
    ├── DeepDiveGenerator
    ├── CalloutGenerator
    ├── SectionGenerator
    ├── ConceptGraphGenerator
    ├── UserNoteGenerator
    └── generate_bridge_text (块间过渡)
  → RepairAgent → 自动修复生成错误
  → Streaming events → WebSocket → 前端实时更新
```

### 2.3 15 种 Block 类型

| BlockType | 前端组件 | 后端生成器 | 说明 |
|---|---|---|---|
| `text` | TextBlock | TextGenerator | Markdown 正文 |
| `callout` | CalloutBlock | CalloutGenerator | 高亮提示框 |
| `quiz` | QuizBlock | QuizGenerator | 交互式测验（选择/简答） |
| `user_note` | UserNoteBlock | UserNoteGenerator | 用户笔记 |
| `figure` | FigureBlock | FigureGenerator | SVG/Chart.js/Mermaid 图表 |
| `interactive` | InteractiveBlock | InteractiveGenerator | HTML 交互内容 |
| `animation` | AnimationBlock | AnimationGenerator | Manim 动画视频 |
| `code` | CodeBlock | CodeGenerator | 语法高亮代码 |
| `timeline` | TimelineBlock | TimelineGenerator | 时间线步骤 |
| `flash_cards` | FlashCardsBlock | FlashCardsGenerator | 翻转记忆卡片 |
| `deep_dive` | DeepDiveBlock | DeepDiveGenerator | 深度探索子页面 |
| `section` | SectionBlock | SectionGenerator | 长文分节 |
| `concept_graph` | ConceptGraphBlock | ConceptGraphGenerator | 概念图可视化 |
| `placeholder` | PlaceholderBlock | — | 未知类型兜底 |

### 2.4 前端组件树

```
LiveBookPage (live-book-client.tsx)
├── <BookLibrary />           — 书架列表
├── <BookCreator />           — 创建向导（纯文本输入+语言选择）
├── <BookSidebar />           — 侧边章节目录
├── <SpineEditor />           — 目录编辑器
├── <PageReader />            — 页面阅读器
│   ├── <PageOutlineNav />    — 浮动大纲导航
│   └── <BlockRenderer />     — Block 调度器
│       ├── <TextBlock />
│       ├── <QuizBlock />
│       ├── <FigureBlock />
│       │   └── <VisualizationViewer /> — SVG/Chart.js/Mermaid
│       ├── <InteractiveBlock />
│       ├── <AnimationBlock />
│       ├── <CodeBlock />
│       ├── <TimelineBlock />
│       ├── <FlashCardsBlock />
│       ├── <DeepDiveBlock />
│       ├── <CalloutBlock />
│       ├── <SectionBlock />
│       ├── <ConceptGraphBlock />
│       ├── <UserNoteBlock />
│       └── <PlaceholderBlock />
├── <BookProgressTimeline />  — 进度时间线
└── <BookHealthBanner />      — 健康状态横幅
```

---

## 三、协作写作架构

### 3.1 数据流

```
浏览器 (localhost:3000)
  │
  ├─→ /co-writer (文档列表)
  │     └─→ CoWriterHomePage → co-writer-api.ts
  │           └─→ fetch('/api/co-writer/documents')  ← Next.js BFF
  │                 └─→ 127.0.0.1:8080/co-writer/documents
  │                       └─→ co_writer.py → storage.py (文件系统)
  │
  └─→ /co-writer/[docId] (Markdown 编辑器)
        └─→ CoWriterEditorPage
              ├── 工具栏: 撤销/重做、标题、格式、代码块、Mermaid、数学公式
              ├── 分屏: 编辑器 ↔ 预览（MarkdownRenderer + KaTeX + Mermaid）
              ├── 滚动同步
              ├── 自动保存（1.5 秒 debounce）
              ├── 选中文本 AI 编辑（懒加载，待 wiring）
              └── 全文 AI 编辑（懒加载，待 wiring）
```

### 3.2 当前可用的 API

| 方法 | 路径 | 功能 |
|---|---|---|
| `GET` | `/co-writer/documents` | 列出所有文档 |
| `POST` | `/co-writer/documents` | 创建文档 |
| `GET` | `/co-writer/documents/{id}` | 获取文档 |
| `PUT` | `/co-writer/documents/{id}` | 更新文档 |
| `DELETE` | `/co-writer/documents/{id}` | 删除文档 |

### 3.3 待接线的 API（AI 编辑功能）

| 方法 | 路径 | 状态 |
|---|---|---|
| `POST` | `/co-writer/edit` | 全文 AI 编辑 — 返回 501 |
| `POST` | `/co-writer/edit_react/stream` | 选中文本流式编辑 — 返回 501 |
| `POST` | `/co-writer/automark` | 自动标注 — 返回 501 |

这些端点采用懒加载设计：首次调用时才加载 AgenticChatPipeline 和 EditAgent。当前因 Redis/LLM 基础设施未就绪，返回 501 Not Implemented。

---

## 四、关键设计决策

### 4.1 为什么 vendor DeepTutor 而不保持外部依赖

- DeepTutor 的书引擎有 20+ 个内部传递依赖，拆不出独立包
- Vendor 到 `anotherme2_engine/live_book_engine/` 使其成为 AnotherMe 的原生代码
- 381 个 .py 文件精简到 270 个（删除 api/app/capabilities/co_writer/tutorbot）
- 所有 `from deeptutor.` 导入替换为 `from live_book_engine.`

### 4.2 前端 API 调用方式

- **活书 API**：直连网关 `127.0.0.1:8080/live-book/*`，不经过 Next.js BFF
- **协作写作 API**：经过 Next.js BFF `/api/co-writer/*` → 网关 `127.0.0.1:8080/co-writer/*`
  - BFF 模式避免浏览器跨域问题

### 4.3 网关路由挂载

```python
# api_gateway/app.py
app.include_router(create_live_book_router(settings))      # /live-book/*
app.include_router(co_writer_router, prefix="/co-writer")   # /co-writer/*
```

### 4.4 中文化策略

- 删除 `react-i18next` 依赖
- 所有文案硬编码为中文
- 协作写作编辑器保留 `const t = (s: string) => s` 透传函数处理动态标签
- 活书引擎的 BookCreator 从完整版（含知识源选择）精简为纯文本输入

### 4.5 网关启动策略

- `run_gateway.py` 默认使用 `GATEWAY_QUEUE_BACKEND=polling`（无需 Redis）
- `uvicorn` 启用 `reload=True`，监听 `anotherme2_engine/` 目录变更自动重载
- `pnpm dev:gateway` 直接用 conda 环境 Python 路径，避免 `conda run` 环境变量传递问题

---

## 五、运行命令

```bash
# 启动所有服务（Next.js + 网关 + Worker）
pnpm dev:all

# 仅启动 Next.js
pnpm dev

# 仅启动网关
pnpm dev:gateway

# 单独测试网关
PYTHONPATH=anotherme2_engine python anotherme2_engine/run_gateway.py

# TypeScript 类型检查
npx tsc --noEmit

# 验证网关 API
curl http://127.0.0.1:8080/live-book/health   # 活书
curl http://127.0.0.1:8080/co-writer/documents # 协作写作
```

---

## 六、已知问题与注意事项

### 6.1 当前已关闭的功能

| 功能 | 原因 | 恢复条件 |
|---|---|---|
| 活书页内聊天（BookChatPanel） | `/api/v1/chat` WebSocket 端点不存在 | 网关实现聊天端点 |
| 协作写作 AI 编辑 | edit/automark 端点返回 501 | 完成 Agent 管线 wiring |
| 活书创建时的知识源选择 | notebook/KB API 不存在 | AnotherMe 增加对应后端 |
| Manim 动画生成 | 需安装 Manim 渲染环境 | 安装 math-animator 可选依赖 |

### 6.2 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | 活书前端直连网关地址 | `http://127.0.0.1:8080` |
| `ANOTHERME2_GATEWAY_BASE_URL` | dev-all 自动分配的网关地址 | `http://127.0.0.1:8080` |
| `GATEWAY_QUEUE_BACKEND` | 队列后端 (redis/polling/auto) | `polling`（开发） |
| `ANOTHERME2_PYTHON_CMD` | 自定义 Python 解释器路径 | conda AnotherMe-V2 |
| `ANOTHERME2_SKIP_DOCKER` | 跳过 Docker 容器启动 | 未设置 |

### 6.3 TypeScript 类型检查

当前状态：**零错误**（不含 `.next/` 缓存）。

---

## 七、文件统计

| 模块 | 文件数 | 说明 |
|---|---|---|
| `features/live-book/` | 25 | 活书前端（25 组件 + 1 客户端） |
| `features/co-writer/` | 3 | 协作写作前端 |
| `lib/live-book/` | 5 | 活书类型 + API + 进度 |
| `lib/co-writer-*` | 2 | 协作写作 API + 事件 |
| `components/common/` | 2 | MarkdownRenderer |
| `components/visualize/` | 1 | VisualizationViewer |
| `anotherme2_engine/live_book_engine/` | 270 | 活书引擎 Python |
| `anotherme2_engine/api_gateway/routes/` | 2 | 活书 + 协作写作路由 |
