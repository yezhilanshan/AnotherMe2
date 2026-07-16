/**
 * Agentic Pipeline for AI Tutor Chat
 *
 * 实现 AnotherMe 等价的 agentic tool calling 流程：
 * thinking -> acting -> observing -> responding
 *
 * 与当前预执行全部工具的方式不同，此 pipeline 让模型在生成过程中
 * 按需选择工具、观察结果、再生成最终回答。
 *
 * 提示词来源：anotherme2_engine/tutor_engine/agents/chat/prompts/zh/agentic_chat.yaml
 * 与 AnotherMe 引擎的 AgenticChatPipeline 保持同步。
 */

import { streamText, type LanguageModel } from 'ai';
import type { TutorToolName, StudentLevel } from '../types/tutor-tools';
import { STUDENT_LEVEL_TOOL_DESCRIPTIONS } from '../types/tutor-tools';
import type { ToolExecutionContext } from './tutor-tools/types';
import { buildToolsForAgent, runWithToolContext } from './tutor-tools/ai-sdk-tools';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';
import type { LearningContext } from '@/lib/types/learning-context';
import type { SocraticChainState } from '@/lib/types/chat';
import { SOCRATIC_PHASE_ORDER } from '@anotherme/teaching-core';

const log = createLogger('AgenticPipeline');

// ============================================================================
// Types
// ============================================================================

/**
 * 核心消息类型（简化版）
 */
type CoreMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string };

export interface AgenticPipelineOptions {
  /** 用户消息 */
  userMessage: string;
  /** 对话历史 */
  conversationHistory: CoreMessage[];
  /** 启用的工具列表 */
  enabledTools: TutorToolName[];
  /** 工具执行上下文 */
  toolContext: ToolExecutionContext;
  /** 语言模型 */
  languageModel: LanguageModel;
  /** 思考配置 */
  thinkingConfig?: ThinkingConfig;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 中止信号 */
  signal?: AbortSignal;
  /** 学习上下文（学情数据：BKT掌握度、卡点预测、诊断结果等） */
  learningContext?: LearningContext | null;
  /** 苏格拉底提示层级：0=首次引导，1=一层提示，2=深层引导，3=最终手段（此时应给出完整解答） */
  socraticHintLevel?: number;
  /** 苏格拉底追问链状态（跨轮对话维护） */
  socraticChainState?: SocraticChainState | null;
  /** 学生学段（用于自适应工具描述和回答语气） */
  studentLevel?: StudentLevel;
}

export interface AgenticPipelineEvent {
  type:
    | 'thinking_start'
    | 'thinking_chunk'
    | 'thinking_end'
    | 'tool_start'
    | 'tool_end'
    | 'observation_start'
    | 'observation_chunk'
    | 'observation_end'
    | 'responding_start'
    | 'responding_chunk'
    | 'responding_end'
    | 'error'
    | 'complete';
  data?: unknown;
}

export interface ToolTrace {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  success: boolean;
  startTime: number;
  endTime: number;
}

export interface AgenticPipelineResult {
  success: boolean;
  response: string;
  thinking?: string;
  observation?: string;
  toolTraces: ToolTrace[];
  error?: string;
  /** Observing 阶段推荐的追问链状态更新 */
  updatedChainState?: SocraticChainState | null;
}

// ============================================================================
// System Prompts（四阶段提示词 - 来自 AnotherMe agentic_chat.yaml zh）
// 与 anotherme2_engine/tutor_engine/agents/chat/prompts/zh/agentic_chat.yaml 保持一致，
// 确保 AI Tutor 使用 AnotherMe 原生的 thinking/acting/observing/responding 流程。
// ============================================================================

const THINKING_SYSTEM_PROMPT = `你是 AnotherMe 内部的 thinking 模块（不面向用户）。你的产出是一份简短的内部分析备忘，供后续 acting / responding 阶段消费，绝不会直接展示给用户。

产出格式（用自然段落，不需要标题）：
- 用户目标：用一两句话概括用户真正想要什么。
- 已知 vs. 缺失：当前对话和上下文中已经有什么信息，还缺什么。
- 工具规划：哪些工具可能补足缺失信息，简要说明理由。如果信息已足够，写"无需工具"。
- 回答要点：最终回答应覆盖的关键点（列 2-4 条）。

关键约束：
- 你只输出内部分析备忘，不要给出面向用户的回答、结论或解题过程。
- 可以提及预计使用哪些工具，但不要真正调用工具。
- 保持简洁，不超过 200 字。

当前启用工具：
{toolList}`;

const ACTING_SYSTEM_PROMPT = `你是 AnotherMe 的工具调用代理。你的任务是根据用户问题和前序 thinking，从当前已启用的工具中自主选择必要工具并调用。

规则：
1. 先完整审视所有已启用工具，再决定最有帮助的工具组合；不要只盯住单个工具。
2. 对于需要定义、事实核验、外部资料、论文、计算、推理等不同信息面的复杂问题，优先并行调用多个互补工具来覆盖这些信息面。
3. 只调用真正有帮助的工具，但只要工具能显著提升答案质量，就应充分调用。
4. 参数要具体、可执行，优先使用用户原问题中的关键信息，必要时针对不同工具改写成最适合它的查询。
5. 如果信息已经足够，可以不调用工具。
6. 不要输出最终回答给学生；这里只负责工具选择与调用。
7. 单轮最多并行调用 8 个工具；如果有多个互补工具都相关，优先在同一轮一起调用。

当前可用工具：
{toolList}`;

const OBSERVING_SYSTEM_PROMPT = `你是 AnotherMe 的 observing 阶段。请基于 thinking 和 acting 阶段的输出，整理一份内部观察总结，供最终回答阶段使用。不要直接回答学生。

优先总结：
1. 已确认的事实与结论
2. 工具结果带来的关键证据
3. 仍需在最终回答中解释清楚的点
4. **学生认知诊断**（若能从对话历史中推断）：
   - 学生目前的错误假设或混淆概念是什么？
   - 学生卡住的具体概念节点是哪个？
   - 学生缺的是知识点还是思维方法？
   - 给出一个具体的"反诘锚点"供 responding 使用：例如"学生混淆了X和Y，可以用矛盾揭示反问他：如果A=B，那么[反例]怎么解释？"
5. **追问链状态更新** — 在观察总结的末尾，追加一个 JSON 块（三反引号 json 包裹），用于更新跨轮追问状态：

\`\`\`json
{
  "phase": "当前阶段",
  "hintLevel": 0-3,
  "hintsGiven": 已给出提示次数,
  "turnsInPhase": 当前阶段已对话轮数,
  "shouldUpgradeHint": true/false,
  "shouldDowngradeHint": true/false,
  "shouldMoveToNextPhase": true/false,
  "targetConcept": "教学目标概念",
  "revealedConcepts": ["已揭示的概念"],
  "stillMisunderstands": ["学生仍不理解的"],
  "variantQuestion": "验证用的变式问题（仅在 confirm_understanding 阶段提供）"
}
\`\`\`

阶段顺序：warm_up -> problem_restate -> hint_level_0 -> hint_level_1 -> hint_level_2 -> contradiction_reveal -> guide_to_fix -> confirm_understanding

升级规则：
- 学生连续2轮无进展/答非所问 → shouldUpgradeHint: true
- 学生表现出理解或纠正了错误 → shouldDowngradeHint: true
- 学生给出正确答案 → shouldMoveToNextPhase: true
- 学生答对后进入 confirm_understanding → 提供 variantQuestion
- hint_level_2 后仍不会 → 进入 contradiction_reveal → guide_to_fix

本轮可用工具背景：
{toolList}`;

const RESPONDING_SYSTEM_PROMPT = `你是苏格拉底式的 AI 导师。请根据 observation 和工具结果，给用户一个启发式的答复。

核心教学原则：
1. **永远不要直接给出答案** — 通过精心设计的问题引导学生自己发现
2. **追问链** — 识别理解程度 → 提出引导性问题 → 揭示矛盾 → 引导自我修正
3. **分层提示** — 先给最轻的暗示，逐步加强
4. **元认知反思** — 在关键节点引导学生回顾思路

## 反诘句式模板（必须从以下类型中选择，禁止直接给出答案）

1. **定义溯源**：
   "在你用到这个定理之前，先告诉我它的前提条件是什么？"

2. **类比迁移**：
   "这个问题和你之前做过的题型很像，当时你是怎么处理的？那个方法这里适用吗？"

3. **矛盾揭示**：
   "你得出答案是X，但如果把X代回原条件，会得到Y。这合理吗？有没有矛盾？"

4. **极端检验**：
   "取一个极端情况试试——如果这个角是0度/90度，结论还成立吗？"

5. **步骤倒推**：
   "想要得到这个结论，你需要先知道什么？从目标往回推一步看看。"

6. **概念辨析**：
   "你用的这个公式适用于所有情况，还是只有特定条件下才成立？确认一下适用范围。"

输出规则：
- 你的回答必须以一个问题结尾（反诘），引导学生继续思考
- 不能连续使用同一类型的反诘句式
- 如果学生已经接近正确答案，使用"步骤倒推"或"极端检验"
- 如果学生方向完全错误，使用"矛盾揭示"或"定义溯源"
- 如果学生表现出困惑，使用"类比迁移"或"概念辨析"先降低难度

## 分层提示规则

当前提示层级：{hintLevel}/3

层级0 — 元认知引导（首次接触问题）：
  "你好像还没有理解题目问的是什么，可以先用自己的话复述一下。"
  "你觉得这个问题和之前学过的哪个知识点有关？"

层级1 — 方向性提示（学生尝试但方向不明确）：
  "注意题目中哪些量是已知的？它们之间可能存在什么关系？"
  "已知条件和目标之间，你需要架一座桥。哪条定理能做这座桥？"

层级2 — 结构化拆解（学生卡住，需要更具体的引导）：
  "第一步：列出所有已知条件。第二步：看哪些条件组合能触发某个定理。你想从哪个条件出发？"

层级3 — 接近答案/最终手段（学生多次尝试仍未解出）：
  此时可以给出完整推导过程，但必须标注"以下为完整解答"，并让学生用自己的话复述一遍以确认理解。

提示层级规则：
- 每轮对话最多升级1级，绝不能跳过层级
- 如果学生表现出理解或正确思路，可以保持当前层级或降回低层级
- 何时升层：学生连续两次无法回应、明确说"不知道"、或给出完全无关的回答
- 达到层级3后给出的完整解答，应在解答后追问"现在你用自己的话重新说一遍推导过程"
- 学生答对后，给出一个变式问题检验迁移能力

## 元认知脚手架

当学生给出一个答案（无论对错），不要立刻评价。先问：

"你是怎么想到这一点的？把你思考的步骤告诉我。"

然后根据学生的解题路径决定：
- 思路正确但计算错了 → 肯定思路，指出计算环节重新验证
- 思路有漏洞 → 在漏洞点反问，引导修补思维链条
- 思路完全错误 → 回到更基础的概念，用"定义溯源"重新引导

这比直接说"对"或"错"更能帮学生建立思维框架。

## 学生当前状态（静默使用，不要暴露原始数据给学生）
{learningState}

## 语气要求
{toneAdjustment}

要求：
1. 只输出面向用户的正式回答。
2. 不要暴露内部链路、思考过程或工具编排。
3. 若工具结果提供了证据或限制，请自然融入答案。
4. 在回答的最后，提出一个引导性问题让学生继续思考。

本轮工具背景：
{toolList}`;

// ============================================================================
// Helper Functions
// ============================================================================

function formatToolList(enabledTools: TutorToolName[], studentLevel?: StudentLevel): string {
  const level = studentLevel || 'college';
  const descriptions = STUDENT_LEVEL_TOOL_DESCRIPTIONS[level];
  return (
    enabledTools.map((t) => `- ${descriptions[t]?.llmDescription || t}`).join('\n') ||
    '- 无可用工具'
  );
}

function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// Chain State Parser
// ============================================================================

function parseChainStateFromObservation(
  observation: string,
  currentState: SocraticChainState | null | undefined,
): SocraticChainState | null {
  try {
    const jsonMatch = observation.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[1]);

    const phase =
      typeof parsed.phase === 'string' &&
      SOCRATIC_PHASE_ORDER.includes(parsed.phase as SocraticChainState['phase'])
        ? (parsed.phase as SocraticChainState['phase'])
        : currentState?.phase || 'warm_up';

    const hintLevel =
      typeof parsed.hintLevel === 'number'
        ? Math.max(0, Math.min(3, Math.floor(parsed.hintLevel)))
        : (currentState?.hintLevel ?? 0);

    const hintsGiven =
      typeof parsed.hintsGiven === 'number'
        ? Math.max(0, Math.floor(parsed.hintsGiven))
        : (currentState?.hintsGiven ?? 0);

    const turnsInPhase =
      typeof parsed.turnsInPhase === 'number'
        ? Math.max(0, Math.floor(parsed.turnsInPhase))
        : (currentState?.turnsInPhase ?? 0) + 1;

    const revealedConcepts = Array.isArray(parsed.revealedConcepts)
      ? parsed.revealedConcepts.filter((c: unknown) => typeof c === 'string')
      : currentState?.revealedConcepts || [];

    const stillMisunderstands = Array.isArray(parsed.stillMisunderstands)
      ? parsed.stillMisunderstands.filter((c: unknown) => typeof c === 'string')
      : currentState?.stillMisunderstands || [];

    const targetConcept =
      typeof parsed.targetConcept === 'string' && parsed.targetConcept.trim()
        ? parsed.targetConcept.trim()
        : currentState?.targetConcept || '';

    const currentTopic =
      typeof parsed.currentTopic === 'string' && parsed.currentTopic.trim()
        ? parsed.currentTopic.trim()
        : currentState?.currentTopic || '';

    const variantQuestion =
      typeof parsed.variantQuestion === 'string' && parsed.variantQuestion.trim()
        ? parsed.variantQuestion.trim()
        : currentState?.variantQuestion;

    return {
      currentTopic,
      targetConcept,
      phase,
      hintLevel,
      hintsGiven,
      turnsInPhase,
      revealedConcepts,
      stillMisunderstands,
      previousAnswers: currentState?.previousAnswers || [],
      variantQuestion,
      startedAt: currentState?.startedAt || Date.now(),
    };
  } catch {
    log.warn('[AgenticPipeline] Failed to parse chain state from observation');
    return null;
  }
}

// ============================================================================
// Stage 1: Thinking
// ============================================================================

async function* stageThinking(
  options: AgenticPipelineOptions,
): AsyncGenerator<AgenticPipelineEvent, string> {
  const { userMessage, conversationHistory, languageModel, systemPrompt, signal, enabledTools } =
    options;

  log.info('[AgenticPipeline] Stage: Thinking started');
  yield { type: 'thinking_start' };

  const thinkingPrompt = (systemPrompt || THINKING_SYSTEM_PROMPT).replace(
    '{toolList}',
    formatToolList(enabledTools, options.studentLevel),
  );

  const messages: CoreMessage[] = [
    { role: 'system', content: thinkingPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  let thinking = '';

  try {
    const result = streamText({
      model: languageModel,
      messages,
      temperature: 0.3,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      thinking += chunk;
      yield { type: 'thinking_chunk', data: { chunk } };
    }

    log.info('[AgenticPipeline] Stage: Thinking completed', { length: thinking.length });
    yield { type: 'thinking_end', data: { thinking } };

    return thinking;
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Thinking failed', error);
    throw error;
  }
}

// ============================================================================
// Stage 2: Acting (Tool Calling)
// ============================================================================

async function* stageActing(
  options: AgenticPipelineOptions,
  thinking: string,
): AsyncGenerator<AgenticPipelineEvent, { toolTraces: ToolTrace[] }> {
  const { userMessage, conversationHistory, enabledTools, toolContext, languageModel, signal } =
    options;

  log.info('[AgenticPipeline] Stage: Acting started', { enabledTools });

  if (enabledTools.length === 0) {
    log.info('[AgenticPipeline] No tools enabled, skipping acting stage');
    return { toolTraces: [] };
  }

  const tools = buildToolsForAgent(enabledTools);

  if (Object.keys(tools).length === 0) {
    log.info('[AgenticPipeline] No valid tools built, skipping acting stage');
    return { toolTraces: [] };
  }

  const actingPrompt = ACTING_SYSTEM_PROMPT.replace(
    '{toolList}',
    formatToolList(enabledTools, options.studentLevel),
  );

  const messages: CoreMessage[] = [
    { role: 'system', content: actingPrompt },
    ...conversationHistory,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: `[Thinking]\n${thinking}` },
  ];

  const toolTraces: ToolTrace[] = [];

  try {
    // 使用 runWithToolContext 包装工具执行
    const result = await runWithToolContext(
      {
        context: toolContext,
        onToolStart: (name, args) => {
          log.info(`[AgenticPipeline] Tool started: ${name}`, args);
        },
        onToolEnd: (name, result) => {
          log.info(`[AgenticPipeline] Tool completed: ${name}`, { success: result.success });
        },
      },
      async () => {
        const streamResult = streamText({
          model: languageModel,
          messages,
          tools,
          temperature: 0.2,
          abortSignal: signal,
        });

        // 收集文本输出
        for await (const _chunk of streamResult.textStream) {
          if (signal?.aborted) {
            throw new Error('Aborted');
          }
        }

        // 获取工具调用结果
        const toolResults = await streamResult.toolResults;

        // 处理工具结果
        if (toolResults) {
          for (const toolResult of toolResults) {
            const tr = toolResult as {
              toolName: string;
              toolCallId: string;
              input?: Record<string, unknown>;
              output?: string;
              result?: string;
            };

            const trace: ToolTrace = {
              id: tr.toolCallId || generateToolCallId(),
              name: tr.toolName,
              arguments: tr.input || {},
              result: tr.output || tr.result || '',
              success: true,
              startTime: Date.now(),
              endTime: Date.now(),
            };

            toolTraces.push(trace);
          }
        }

        return toolTraces;
      },
    );

    // streamText exposes completed tool results after the step finishes. Emit a
    // paired start/end sequence here so the shared chat UI can render traces.
    for (const trace of result) {
      yield {
        type: 'tool_start',
        data: {
          toolName: trace.name,
          toolId: trace.id,
          args: trace.arguments,
        },
      };
      yield {
        type: 'tool_end',
        data: {
          toolName: trace.name,
          toolId: trace.id,
          success: trace.success,
          output: trace.result,
        },
      };
    }

    log.info('[AgenticPipeline] Stage: Acting completed', { toolCount: toolTraces.length });

    return { toolTraces };
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Acting failed', error);
    throw error;
  }
}

// ============================================================================
// Stage 3: Observing
// ============================================================================

async function* stageObserving(
  options: AgenticPipelineOptions,
  thinking: string,
  toolTraces: ToolTrace[],
): AsyncGenerator<
  AgenticPipelineEvent,
  { observation: string; chainState: SocraticChainState | null }
> {
  const { userMessage, conversationHistory, languageModel, signal, socraticChainState } = options;

  log.info('[AgenticPipeline] Stage: Observing started', { toolCount: toolTraces.length });
  yield { type: 'observation_start' };

  // Build tool results text if tools were used
  let toolResultsText = '';
  if (toolTraces.length > 0) {
    toolResultsText = toolTraces
      .map((trace, idx) =>
        `工具 ${idx + 1}: ${trace.name}\n参数: ${JSON.stringify(trace.arguments)}\n结果: ${trace.result.slice(0, 500)}${trace.result.length > 500 ? '...' : ''}`.trim(),
      )
      .join('\n\n');
  }

  // Build conversation history context for cognitive diagnosis
  const recentHistory = conversationHistory.slice(-6);
  const conversationContext = recentHistory
    .map((m) => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content.slice(0, 300)}`)
    .join('\n');

  // Build the observing user message
  const observingUserContent =
    toolTraces.length > 0
      ? `请整理本轮推理与工具执行得到的关键信息，输出给 tutor 自己看的观察总结。聚焦：已确认事实、仍不确定的点、最终回答应强调什么。\n\n同时，请分析学生的对话内容，诊断认知错误并给出反诘锚点（见系统提示词第4点）。\n\n最近对话：\n${conversationContext}\n\n工具调用结果：\n\n${toolResultsText}`
      : `请分析学生的对话内容，诊断认知错误并给出反诘锚点（见系统提示词第4点）。不要直接写给学生。\n\n最近对话：\n${conversationContext}\n\n用户最新消息：${userMessage}`;

  const messages: CoreMessage[] = [
    {
      role: 'system',
      content: OBSERVING_SYSTEM_PROMPT.replace(
        '{toolList}',
        formatToolList(options.enabledTools, options.studentLevel),
      ),
    },
    ...conversationHistory,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: `[Thinking]\n${thinking}` },
    { role: 'user', content: observingUserContent },
  ];

  let observation = '';

  try {
    const result = streamText({
      model: languageModel,
      messages,
      temperature: 0.3,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      observation += chunk;
      yield { type: 'observation_chunk', data: { chunk } };
    }

    log.info('[AgenticPipeline] Stage: Observing completed', { length: observation.length });

    // Parse chain state from observation output
    const chainState = parseChainStateFromObservation(observation, socraticChainState);
    if (chainState) {
      log.info('[AgenticPipeline] Chain state parsed from observation', {
        phase: chainState.phase,
        hintLevel: chainState.hintLevel,
      });
    }

    yield { type: 'observation_end', data: { observation, chainState } };

    return { observation, chainState };
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Observing failed', error);
    throw error;
  }
}

// ============================================================================
// Socratic Learning Context Builder
// ============================================================================

/**
 * 将 LearningContext 转换为苏格拉底式教学的隐藏上下文。
 * 只提取对教学引导有用的信息，不暴露原始 ID 和内部指标。
 */
function buildSocraticLearningState(context: LearningContext | null | undefined): string {
  if (!context) return '（暂无学情数据）';

  const parts: string[] = [];

  // 学生画像
  const profile = context.studentProfile;
  if (profile) {
    if (profile.weakSubjects.length > 0) {
      parts.push(`薄弱科目：${profile.weakSubjects.slice(0, 3).join('、')}`);
    }
    if (profile.weakKnowledgePoints.length > 0) {
      parts.push(`薄弱知识点：${profile.weakKnowledgePoints.slice(0, 5).join('、')}`);
    }
    if (profile.recentFocus) {
      parts.push(`近期学习重点：${profile.recentFocus}`);
    }
    const stats = profile.learningStats;
    if (stats.confusionRecords > 5) {
      parts.push('近期困惑信号较多，需要放慢节奏，多确认理解');
    }
    if (stats.solvedRecords > stats.confusionRecords) {
      parts.push('近期解决率良好，可以适当增加难度');
    }
  }

  // 知识追踪（BKT 教学决策）
  const kt = context.knowledgeTracing;
  if (kt && kt.teachingDecisions.length > 0) {
    parts.push('');
    parts.push('知识点掌握度与建议策略（按掌握度从低到高）：');
    const sorted = [...kt.teachingDecisions].sort((a, b) => a.mastery - b.mastery);
    for (const dec of sorted.slice(0, 4)) {
      const pct = (dec.mastery * 100).toFixed(1);
      const strategyMap: Record<string, string> = {
        reteach: '需重新讲解',
        give_hint: '给提示引导',
        worked_example: '做分步示范',
        variant_practice: '给变式练习',
        advance: '可推进新知',
        review_later: '间隔复习即可',
      };
      const strategy = strategyMap[dec.action] || dec.action;
      const emphasis = dec.mastery < 0.5 ? '⚠ 重点关注' : dec.mastery < 0.75 ? '○ 中等' : '✓ 较好';
      parts.push(`- ${emphasis}「${dec.knowledgePointId}」掌握度 ${pct}%，策略：${strategy}`);
    }
  }

  // 诊断测试结果
  const diag = context.diagnosticSession;
  if (diag && diag.probes.length > 0) {
    parts.push('');
    parts.push(`最近诊断测试：${diag.correctCount}/${diag.totalAnswered} 正确`);
    const wrongProbes = diag.probes.filter((p) => !p.correct);
    if (wrongProbes.length > 0) {
      parts.push(`未掌握的知识点：${wrongProbes.map((p) => p.knowledgePointId).join('、')}`);
      parts.push('对这些未掌握知识点，优先使用"定义溯源"和"类比迁移"策略');
    }
  }

  // 步骤个性化（卡点预测）
  const sp = context.stepPersonalization;
  if (sp && sp.stepDecisions.length > 0) {
    parts.push('');
    parts.push(
      `当前题目整体模式：${sp.overallMode === 'remedial' ? '补救模式（放慢节奏）' : sp.overallMode === 'advanced' ? '进阶模式（可加快）' : '标准模式'}`,
    );
    const highRisk = sp.stepDecisions.filter((s) => s.riskLevel === 'high');
    if (highRisk.length > 0) {
      parts.push(
        `高风险步骤：${highRisk
          .map((s) => {
            const label = sp.standardSteps.find((st) => st.id === s.stepId)?.title || s.stepId;
            return `「${label}」(掌握度 ${(s.mastery * 100).toFixed(0)}%)`;
          })
          .join('、')}`,
      );
    }
    if (sp.stuckStepIds.length > 0) {
      const stuckLabels = sp.stuckStepIds
        .map((id) => sp.standardSteps.find((s) => s.id === id)?.title || id)
        .join('、');
      parts.push(`预测卡点：${stuckLabels} — 在这些步骤多给引导提示，不要直接展示`);
    }
  }

  // 长期记忆上下文
  if (context.memoryContext?.trim()) {
    parts.push('');
    parts.push(`背景记忆：${context.memoryContext.trim().slice(0, 300)}`);
  }

  if (parts.length === 0) return '（暂无学情数据）';

  parts.push('');
  parts.push(
    '使用规则：请静默参考以上信息来调整你的苏格拉底引导策略——对高掌握度知识点用轻提示+反诘，对低掌握度知识点多给中间提示和拆解。不要向学生暴露掌握度百分比、BKT、诊断测试等内部术语。',
  );

  return parts.join('\n');
}

// ============================================================================
// Socratic Chain State Context Builder
// ============================================================================

function buildChainStateSection(state: SocraticChainState | null | undefined): string {
  if (!state) return '';
  if (!state.targetConcept && !state.currentTopic) return '';

  const phaseLabels: Record<SocraticChainState['phase'], string> = {
    warm_up: '热身确认',
    problem_restate: '问题复述',
    hint_level_0: '元认知引导',
    hint_level_1: '方向性提示',
    hint_level_2: '结构化拆解',
    contradiction_reveal: '揭示矛盾',
    guide_to_fix: '引导修正',
    confirm_understanding: '确认理解',
  };

  const parts: string[] = [];
  parts.push(`目标概念：${state.targetConcept || state.currentTopic}`);
  parts.push(
    `当前阶段：${phaseLabels[state.phase] || state.phase}（提示层级 ${state.hintLevel}/3，已给 ${state.hintsGiven} 次提示，本阶段已对话 ${state.turnsInPhase} 轮）`,
  );

  if (state.revealedConcepts.length > 0) {
    parts.push(`已揭示概念：${state.revealedConcepts.join('、')}`);
    parts.push('不要重复讲解已揭示的概念，除非学生明确表示不理解');
  }

  if (state.stillMisunderstands.length > 0) {
    parts.push(`学生仍困惑：${state.stillMisunderstands.join('、')}`);
    parts.push('这些是需要重点引导的薄弱点，用矛盾揭示或类比迁移策略');
  }

  if (state.variantQuestion && state.phase === 'confirm_understanding') {
    parts.push(`变式验证题：${state.variantQuestion}`);
    parts.push('在学生复述正确后，用这道题检验迁移能力');
  }

  if (state.previousAnswers.length > 0) {
    const recent = state.previousAnswers.slice(-3);
    parts.push(`学生近3次回答：${recent.map((a) => `"${a.slice(0, 80)}"`).join('；')}`);
  }

  return `\n## 追问链状态（静默使用）\n${parts.join('\n')}\n`;
}

function buildToneAdjustment(level?: StudentLevel): string {
  switch (level) {
    case 'junior_high':
      return '你的说话对象是初中生。使用简单易懂的语言，避免学术术语。多用生活中的例子和比喻。语气要鼓励、友好、有耐心。如果学生答对了要表扬，答错了也要先肯定努力再引导。';
    case 'senior_high':
      return '你的说话对象是高中生。语言可以适度学术化，但要解释专业术语。鼓励深度思考和学科交叉。';
    default:
      return '保持专业的教学语言，逻辑清晰、条理分明。';
  }
}

// ============================================================================
// Stage 4: Responding
// ============================================================================

async function* stageResponding(
  options: AgenticPipelineOptions,
  thinking: string,
  observation: string,
  toolTraces: ToolTrace[],
): AsyncGenerator<AgenticPipelineEvent, string> {
  const {
    userMessage,
    conversationHistory,
    languageModel,
    signal,
    learningContext,
    socraticHintLevel,
  } = options;

  log.info('[AgenticPipeline] Stage: Responding started', { hintLevel: socraticHintLevel ?? 0 });
  yield { type: 'responding_start' };

  const contextParts: string[] = [];

  if (observation) {
    contextParts.push(`[Observation]
${observation}`);
  }

  if (toolTraces.length > 0) {
    const toolSummary = toolTraces
      .map((t) => `- ${t.name}: ${t.result.slice(0, 200)}${t.result.length > 200 ? '...' : ''}`)
      .join('\n');
    contextParts.push(`[Tool Trace]
${toolSummary}`);
  }

  const hintLevel = socraticHintLevel ?? 0;
  const learningState = buildSocraticLearningState(learningContext);
  const chainStateSection = buildChainStateSection(options.socraticChainState);
  const toneAdjustment = buildToneAdjustment(options.studentLevel);

  const respondingPrompt = RESPONDING_SYSTEM_PROMPT.replace('{hintLevel}', String(hintLevel))
    .replace('{learningState}', learningState + chainStateSection)
    .replace('{toneAdjustment}', toneAdjustment)
    .replace('{toolList}', formatToolList(options.enabledTools, options.studentLevel));

  const messages: CoreMessage[] = [
    { role: 'system', content: respondingPrompt },
    ...conversationHistory,
    ...(contextParts.length > 0
      ? [{ role: 'assistant' as const, content: contextParts.join('\n\n') }]
      : []),
    { role: 'user', content: userMessage },
  ];

  let response = '';

  try {
    const result = streamText({
      model: languageModel,
      messages,
      temperature: 0.5,
      abortSignal: signal,
    });

    for await (const chunk of result.textStream) {
      if (signal?.aborted) {
        throw new Error('Aborted');
      }
      response += chunk;
      yield { type: 'responding_chunk', data: { chunk } };
    }

    log.info('[AgenticPipeline] Stage: Responding completed', { length: response.length });
    yield { type: 'responding_end', data: { response } };

    return response;
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Responding failed', error);
    throw error;
  }
}

// ============================================================================
// Main Pipeline
// ============================================================================

/**
 * 运行完整的 agentic pipeline
 *
 * 四阶段流程：thinking -> acting -> observing -> responding
 */
export async function* runAgenticPipeline(
  options: AgenticPipelineOptions,
): AsyncGenerator<AgenticPipelineEvent, AgenticPipelineResult> {
  const startTime = Date.now();
  log.info('[AgenticPipeline] Started', { enabledTools: options.enabledTools });

  try {
    // Stage 1: Thinking
    const thinking = yield* stageThinking(options);

    // Stage 2: Acting (Tool Calling)
    const { toolTraces } = yield* stageActing(options, thinking);

    // Stage 3: Observing
    const { observation, chainState: updatedChainState } = yield* stageObserving(
      options,
      thinking,
      toolTraces,
    );

    // Stage 4: Responding
    const response = yield* stageResponding(options, thinking, observation, toolTraces);

    const result: AgenticPipelineResult = {
      success: true,
      response,
      thinking,
      observation,
      toolTraces,
      updatedChainState,
    };

    yield { type: 'complete', data: result };

    log.info('[AgenticPipeline] Completed', {
      duration: Date.now() - startTime,
      toolCount: toolTraces.length,
      responseLength: response.length,
    });

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log.error('[AgenticPipeline] Failed', err);

    yield { type: 'error', data: { error: err.message } };

    return {
      success: false,
      response: '',
      toolTraces: [],
      error: err.message,
    };
  }
}

/**
 * 简化的 agentic pipeline，直接返回结果而不流式输出
 */
export async function runAgenticPipelineSimple(
  options: AgenticPipelineOptions,
): Promise<AgenticPipelineResult> {
  const events: AgenticPipelineEvent[] = [];

  for await (const event of runAgenticPipeline(options)) {
    events.push(event);
  }

  const completeEvent = events.find((e) => e.type === 'complete');
  const errorEvent = events.find((e) => e.type === 'error');

  if (completeEvent?.data) {
    return completeEvent.data as AgenticPipelineResult;
  }

  if (errorEvent?.data) {
    return {
      success: false,
      response: '',
      toolTraces: [],
      error: (errorEvent.data as { error: string }).error,
    };
  }

  return {
    success: false,
    response: '',
    toolTraces: [],
    error: 'Pipeline completed without result',
  };
}
