# AnotherMe 核心模块改进方案（借鉴 DeepTutor）

## Context

AnotherMe 与 DeepTutor 对比后发现 5 个主要差距（Live Book 除外，由其他人负责）。本方案按优先级改进这些模块，借鉴 DeepTutor 的设计方法但适配 AnotherMe 的 TypeScript/Next.js 技术栈和现有架构。

**核心原则**：保持所有现有接口不变（CapabilityHandler、ToolRegistry、StreamBus），在现有架构内增强。

---

## Phase 1: Deep Research 重写（最大差距）

### 问题
- 单次搜索，无迭代循环
- 扁平 outline，Promise.all 一次性处理，无动态主题发现
- 无引用管理（无去重、无可点击引用）
- 单次 LLM 调用生成报告，无分节写作
- 只有 1 种报告模式

### 新建文件

**`AnotherMe/features/ai-tutor/orchestration/deep-research/`** 目录下：

| 文件 | 职责 |
|------|------|
| `types.ts` | TopicBlock、ToolTrace、ResearchConfig 等类型定义 |
| `dynamic-topic-queue.ts` | 动态主题队列，状态机 PENDING→RESEARCHING→COMPLETED/FAILED，支持动态添加子主题 |
| `citation-manager.ts` | 引用管理：CIT-X-XX 格式、按 title+author 去重、APA 格式、可点击内联引用 |
| `mode-strategy.ts` | 4 种研究模式策略：notes/report/comparison/learning_path，含深度预设配置 |
| `research-agents.ts` | 6 个 agent 函数：rephrase/decompose/manager/research/note/reporting |
| `research-coordinator.ts` | 主编排器：3 阶段流程（Planning→Researching→Reporting） |
| `deep-research-handler.ts` | CapabilityHandler 包装，委托给 coordinator，保持 AsyncGenerator 接口 |

### 核心算法：迭代研究循环

```
Phase 1 (Planning):
  rephraseAgent(topic) → rephrasedTopic
  decomposeAgent(topic, mode) → outline (3-5 子主题)
  yield outline 给用户确认

Phase 2 (Researching):
  初始化 DynamicTopicQueue(outline)
  while queue.hasPending():
    block = queue.getNextPending()
    for round in range(maxIterations):
      // 选择工具（根据 round：早期用 RAG，中期用 web/papers，后期补缺）
      result = executeTool(selectedTool, query)
      note = noteAgent(result)  // 压缩为结构化笔记
      citationManager.add(result)
      sufficient = managerAgent(block, note)  // 评估知识充分性
      if sufficient → break
    block.status = 'completed'

Phase 3 (Reporting):
  if totalBlocks < threshold → singlePassReport(queue, mode)
  else → multiPassReport(queue, mode):
    1. outline = generateOutline(topic, queue.allNotes())
    2. for each section → writeSection(section, block.notes, citationTable)
    3. writeIntroduction(topic, outline)
    4. writeConclusion(topic, queue.allNotes())
  sources = citationManager.formatSourcesMarkdown()
  return report + sources
```

### 修改文件

- **`features/ai-tutor/types/capability-payloads.ts`** — 扩展 DeepResearchPayload 添加 `mode` 和 `maxIterations` 字段

### 复用的现有基础设施
- `executeTool()` from `tutor-tools/registry.ts` — 所有工具调用
- `streamText()` from `ai` package — 所有 LLM 调用
- `CapabilityStageResult` AsyncGenerator — 流式输出

---

## Phase 2: Notebook 服务端化 + 持久记忆

### 2a. Notebook 服务端化

#### 问题
- 纯 localStorage，换浏览器/清缓存即丢失
- 笔记内容不进入 RAG 或 agent 上下文
- `LearningContext.notebookRefs` 已定义但从未被填充

#### 新建文件

| 文件 | 职责 |
|------|------|
| `AnotherMe/lib/server/notebook-service.ts` | 服务端 Notebook 管理器，存储在 `.workbuddy/notebooks/{userId}/` |
| `AnotherMe/app/api/notebooks/route.ts` | REST API: GET(列表) POST(创建) |
| `AnotherMe/app/api/notebooks/[notebookId]/route.ts` | REST API: GET(详情) DELETE(删除) |
| `AnotherMe/app/api/notebooks/[notebookId]/records/route.ts` | REST API: POST(添加记录) |

#### 修改文件

- **`features/notebook/client/notebook-client.tsx`** — localStorage 保存后异步同步到服务端
- **`features/ai-tutor/orchestration/tutor-tools/rag.ts`** — 当 `LearningContext.notebookRefs` 存在时，从 NotebookService 解析内容注入 RAG 上下文

#### 存储格式（复用 classroom-book-service 模式）

```
.workbuddy/notebooks/{userId}/index.json    — 笔记本列表
.workbuddy/notebooks/{userId}/{notebookId}.json — 笔记本记录
```

---

### 2b. 持久记忆系统

#### 问题
- 只有 BKT 算法计算的结构化数据（weakSubjects、abilityScores）
- 没有用户偏好、学习风格、沟通风格的记忆
- 没有学习旅程摘要

#### 新建文件

| 文件 | 职责 |
|------|------|
| `AnotherMe/lib/server/memory-service.ts` | 双文件记忆：PROFILE.md（用户画像）+ SUMMARY.md（学习旅程），LLM 自动更新 |
| `AnotherMe/app/api/memory/route.ts` | REST API: GET(读取) PUT(手动更新) POST(自动刷新) |

#### 修改文件

- **`lib/types/learning-context.ts`** — `LearningContext` 添加 `memoryContext?: string` 字段
- **`features/ai-tutor/orchestration/capability-runtime.ts`** — `run()` 中构建 context 后调用 `memoryService.buildMemoryContext()` 注入
- **`lib/orchestration/prompt-builder.ts`** — 当 `memoryContext` 存在时注入为 `## Background Memory` 段落
- **`features/ai-tutor/orchestration/handlers/chat-handler.ts`** — 对话结束后 fire-and-forget 调用 `refreshFromTurn()`

#### 与 BKT 的关系（互补不冲突）

| 维度 | BKT (现有) | Memory (新增) |
|------|-----------|---------------|
| 数据类型 | 结构化数字 | 非结构化文本 |
| 内容 | 掌握概率、弱项知识点 | 偏好、风格、旅程摘要 |
| 更新方式 | 算法（事件驱动） | LLM（对话后增量更新） |
| 注入位置 | `knowledgeTracing` 字段 | `memoryContext` 字段 |

---

## Phase 3: Teaching Trace 可观测性 + Deep Solve 增强

### 3a. Teaching Trace 补全

#### 问题
- 定义了 13 种事件但只发布了 4 种
- StreamBus 完整可用但没有前端消费者
- 用户无法看到"系统为什么做这个决定"

#### 新建文件

| 文件 | 职责 |
|------|------|
| `features/ai-tutor/components/chat/TeachingTracePanel.tsx` | 教学轨迹面板：时间线视图，展示 KT 决策、工具调用、agent 响应等 |
| `features/ai-tutor/components/chat/use-teaching-trace.ts` | React Hook：订阅 StreamBus，按 requestId 过滤事件 |

#### 修改文件（补发缺失的 trace 事件）

- **`features/ai-tutor/orchestration/handlers/chat-handler.ts`** — 补发 `prompt_built`、`agent_response`（agentic 路径也补上）
- **`features/ai-tutor/orchestration/handlers/deep-research-handler.ts`** — 补发 `stage_start`、`tool_invoked`、`tool_result`、`complete`
- **`features/ai-tutor/orchestration/handlers/deep-solve-handler.ts`** — 同上
- **`features/ai-tutor/components/chat/ModernChatInterface.tsx`** — 添加 TeachingTracePanel 入口（"系统决策"按钮打开侧栏）

#### Trace 事件流

```
Handler: emitTrace(createTraceEvent('tool_invoked', ...))
  → CapabilityRuntime.emitTrace callback
  → StreamBus.publish (内存缓冲 + FileTraceSink JSONL)
  → SSE stream (新 'teaching_trace' 事件类型)
  → useTeachingTrace hook
  → TeachingTracePanel 渲染时间线
```

---

### 3b. Deep Solve 增强

#### 问题
- 工具结果只是拼接成 prompt 文本，无结构化内存
- 工具只执行一次，无 ReAct 循环
- 无 replan 能力
- 无 Scratchpad 统一内存

#### 新建文件

**`AnotherMe/features/ai-tutor/orchestration/deep-solve/`** 目录下：

| 文件 | 职责 |
|------|------|
| `scratchpad.ts` | 统一内存：Plan + ReActEntry[] + 来源收集，支持 token 预算压缩 |
| `solve-tool-runtime.ts` | 包装现有 executeTool，添加 `done`/`replan` 控制动作 |
| `agents.ts` | 3 个 agent：plannerAgent（生成 Plan）、solverAgent（ReAct 循环）、writerAgent（生成最终答案） |
| `deep-solve-handler.ts` | CapabilityHandler 包装，保持 AsyncGenerator 接口 |

#### 核心算法：ReAct 循环

```
1. plannerAgent(question) → Plan { analysis, steps[] }
2. scratchpad.setPlan(plan)

3. for each pending step:
     for round in range(maxRounds):
       result = solverAgent(question, scratchpad, step)
       if action == 'done' → markStepCompleted, break
       if action == 'replan' → plannerAgent() → updatePlan, break
       observation = toolRuntime.execute(action, input)
       scratchpad.addEntry({ step, round, thought, action, observation })

4. writerContext = scratchpad.buildWriterContext()
   finalAnswer = writerAgent(question, writerContext)
   return finalAnswer + scratchpad.formatSourcesMarkdown()
```

#### 修改文件

- **`features/ai-tutor/types/capability-payloads.ts`** — DeepSolvePayload 添加 `maxRounds?: number`

---

## 实施顺序

| 阶段 | 内容 | 预估 |
|------|------|------|
| **Phase 1** | Deep Research 基础设施（queue、citation、mode-strategy、agents、coordinator、handler） | 核心工作量 |
| **Phase 2a** | Notebook 服务端化（service + API + client sync + RAG 集成） | 中等 |
| **Phase 2b** | 持久记忆（memory-service + API + LearningContext 扩展 + prompt 注入） | 中等 |
| **Phase 3a** | Teaching Trace（补发事件 + TeachingTracePanel + useTeachingTrace） | 较小 |
| **Phase 3b** | Deep Solve（scratchpad + tool-runtime + agents + handler） | 中等 |

## 验证方式

1. **Deep Research**: 运行 `deep_research` capability，验证多轮迭代搜索、引用去重、4 种模式报告生成
2. **Notebook**: 创建笔记→切换浏览器→验证笔记同步→验证 RAG 检索到笔记内容
3. **Memory**: 多轮对话→验证 PROFILE.md/SUMMARY.md 自动更新→验证 agent prompt 包含记忆上下文
4. **Teaching Trace**: 打开 TeachingTracePanel→执行任何 capability→验证时间线显示 KT 决策和工具调用
5. **Deep Solve**: 提交复杂问题→验证 ReAct 循环→验证 replan 能力→验证 Scratchpad 来源收集
6. **回归**: `pnpm build` + `pnpm lint` + `npx tsc --noEmit` 全部通过
