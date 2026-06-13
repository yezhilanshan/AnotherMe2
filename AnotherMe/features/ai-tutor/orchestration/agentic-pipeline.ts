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
import type { TutorToolName } from '../types/tutor-tools';
import type { ToolExecutionContext } from './tutor-tools/types';
import { buildToolsForAgent, runWithToolContext } from './tutor-tools/ai-sdk-tools';
import { createLogger } from '@/lib/logger';
import type { ThinkingConfig } from '@/lib/types/provider';

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

本轮可用工具背景：
{toolList}`;

const RESPONDING_SYSTEM_PROMPT = `你是 AnotherMe 的最终回答阶段。请根据 observation 和工具结果，给用户一个清晰、直接、结构良好的正式答复。

要求：
1. 只输出面向用户的正式回答。
2. 不要暴露内部链路、思考过程或工具编排。
3. 若工具结果提供了证据或限制，请自然融入答案。

本轮工具背景：
{toolList}`;

// ============================================================================
// Helper Functions
// ============================================================================

function formatToolList(enabledTools: TutorToolName[]): string {
  const toolDescriptions: Record<TutorToolName, string> = {
    brainstorm: 'brainstorm - 头脑风暴，生成创意点子',
    rag: 'rag - 从本地知识库检索信息',
    web_search: 'web_search - 联网搜索最新信息',
    code_execution: 'code_execution - 执行Python代码进行计算',
    reason: 'reason - 深度推理分析',
    paper_search: 'paper_search - 搜索学术论文',
  };

  return enabledTools.map((t) => `- ${toolDescriptions[t]}`).join('\n') || '- 无可用工具';
}

function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
    formatToolList(enabledTools),
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

  const actingPrompt = ACTING_SYSTEM_PROMPT.replace('{toolList}', formatToolList(enabledTools));

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
): AsyncGenerator<AgenticPipelineEvent, string> {
  const { userMessage, conversationHistory, languageModel, signal } = options;

  log.info('[AgenticPipeline] Stage: Observing started');
  yield { type: 'observation_start' };

  if (toolTraces.length === 0) {
    log.info('[AgenticPipeline] No tool traces, skipping observation');
    yield { type: 'observation_end', data: { observation: '' } };
    return '';
  }

  const toolResultsText = toolTraces
    .map((trace, idx) =>
      `
工具 ${idx + 1}: ${trace.name}
参数: ${JSON.stringify(trace.arguments)}
结果: ${trace.result.slice(0, 500)}${trace.result.length > 500 ? '...' : ''}
    `.trim(),
    )
    .join('\n\n');

  const messages: CoreMessage[] = [
    { role: 'system', content: OBSERVING_SYSTEM_PROMPT },
    ...conversationHistory,
    { role: 'user', content: userMessage },
    { role: 'assistant', content: `[Thinking]\n${thinking}` },
    {
      role: 'user',
      content: `请整理本轮推理与工具执行得到的关键信息，输出给 tutor 自己看的观察总结。聚焦：已确认事实、仍不确定的点、最终回答应强调什么。不要直接写给学生。\n\n工具调用结果：\n\n${toolResultsText}`,
    },
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
    yield { type: 'observation_end', data: { observation } };

    return observation;
  } catch (error) {
    log.error('[AgenticPipeline] Stage: Observing failed', error);
    throw error;
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
  const { userMessage, conversationHistory, languageModel, signal } = options;

  log.info('[AgenticPipeline] Stage: Responding started');
  yield { type: 'responding_start' };

  const contextParts: string[] = [];

  if (observation) {
    contextParts.push(`[Observation]\n${observation}`);
  }

  if (toolTraces.length > 0) {
    const toolSummary = toolTraces
      .map((t) => `- ${t.name}: ${t.result.slice(0, 200)}${t.result.length > 200 ? '...' : ''}`)
      .join('\n');
    contextParts.push(`[Tool Trace]\n${toolSummary}`);
  }

  const respondingPrompt = RESPONDING_SYSTEM_PROMPT.replace(
    '{toolList}',
    formatToolList(options.enabledTools),
  );

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
    const observation = yield* stageObserving(options, thinking, toolTraces);

    // Stage 4: Responding
    const response = yield* stageResponding(options, thinking, observation, toolTraces);

    const result: AgenticPipelineResult = {
      success: true,
      response,
      thinking,
      observation,
      toolTraces,
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
