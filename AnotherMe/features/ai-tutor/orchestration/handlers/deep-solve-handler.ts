/**
 * Deep Solve Capability Handler
 *
 * 多阶段深度解题流程：Planning -> Reasoning -> Writing
 *
 * 阶段说明：
 * 1. Planning: 分析问题，制定解题计划
 * 2. Reasoning: 执行工具调用，进行推理
 * 3. Writing: 生成最终答案
 */

import { streamText } from 'ai';
import type {
  CapabilityHandler,
  CapabilityRequest,
  CapabilityStageResult,
  CapabilityResult,
} from '../capability-runtime';
import type { DeepSolvePayload, DeepSolveResult } from '../../types/capability-payloads';
import type { TutorToolName } from '../../types/tutor-tools';
import type { ToolExecutionContext } from '../tutor-tools/types';
import { executeTool } from '../tutor-tools/registry';
import { DeepSolveScratchpad, parseSolvePlan } from '../deep-solve/scratchpad';
import { buildLearningContextSection } from '@/lib/orchestration/prompt-builder';
import type { LearningContext } from '@/lib/types/learning-context';
import { createLogger } from '@/lib/logger';

const log = createLogger('DeepSolveHandler');

const DEFAULT_DEEP_SOLVE_TOOLS: TutorToolName[] = ['rag', 'web_search', 'code_execution', 'reason'];

const PLANNING_SYSTEM_PROMPT = `你是一位专业的解题专家。请分析用户的问题，制定详细的解题计划。

要求：
1. 理解问题的核心要点
2. 识别问题类型（数学、物理、编程、概念理解等）
3. 列出解题步骤
4. 判断是否需要使用工具辅助（计算、搜索、代码执行等）

请用中文输出你的解题计划，格式如下：

## 问题分析
[问题的核心内容]

## 解题思路
[主要思路和方法]

## 步骤规划
1. [第一步]
2. [第二步]
...

## 工具需求
[是否需要使用工具，以及原因]`;

const REASONING_SYSTEM_PROMPT = `你是一位解题专家。基于已有的解题计划和工具结果，进行详细推理。

要求：
1. 按步骤进行推理
2. 结合工具返回的信息
3. 展示完整的推理过程
4. 验证中间结果

请用中文输出详细的推理过程。`;

const WRITING_SYSTEM_PROMPT = `你是一位专业的教育者。请基于前面的分析和推理，生成清晰、完整的最终答案。

要求：
1. 结构清晰，逻辑严谨
2. 包含关键步骤和结论
3. 适当使用公式、图表说明
4. 语言简洁易懂

请用中文输出最终答案。`;

const SOCRATIC_WRITING_SYSTEM_PROMPT = `你是苏格拉底式的 AI 导师。你手上已经有了完整的解题计划和推理过程，但你不能直接给出答案。

你的任务是用启发式引导，帮助学生自己推导出结论。

## 输出结构
1. **情境确认** — 先用1-2句确认学生的问题，表明你理解了
2. **第一个线索** — 给出解题的第一个关键线索或切入点，但不暴露完整推导
3. **引导性提问** — 提出一个问题，让学生基于线索自己尝试推一步
4. **标注** — "如果你需要下一步线索，请告诉我"

## 当前提示层级：{hintLevel}/3

层级0（首次）：仅给出问题类型的识别线索
  "这其实是一个[问题类型]问题。回忆一下这类问题的通用解法，第一步应该做什么？"

层级1（方向性）：给出一个具体定理或公式的提示
  "这里你需要用到[定理名称]。看看已知条件，哪个能触发它？"

层级2（拆解）：给出第一步的具体做法，让学生继续
  "第一步先把XX代入YY得到ZZ。接下来你应该对ZZ做什么操作？"

层级3（最终）：给出完整推导但让学生复述
  "以下是完整推导过程：[...] 现在请你用自己的话重新说一遍。"

## 反诘句式（必须使用以下类型）
- 定义溯源："这个定理的前提条件是什么？题目满足吗？"
- 类比迁移："这和之前做过的[类似题型]有什么共同点？"
- 矛盾揭示："如果你得到的结果是X，但代回去检查会得到Y，说明什么？"
- 步骤倒推："想要得到最终结论，你需要先求出什么中间量？"

## 学生当前状态（静默使用，不要暴露）
{learningState}

核心要求：
- 绝对不要一次性给出完整答案
- 每轮回复以一个问题结尾
- 如果学生给出正确答案，肯定后给出一个变式检验
- 如果学生连续两次卡住，升级提示层级

请用中文输出。`;

interface ToolTrace {
  name: string;
  input: Record<string, unknown>;
  output: string;
  success: boolean;
}

function buildSocraticLearningStateInline(context: LearningContext | null): string {
  if (!context) return '（暂无学情数据）';
  const parts: string[] = [];
  const kt = context.knowledgeTracing;
  if (kt && kt.teachingDecisions.length > 0) {
    parts.push('知识点掌握度：');
    const sorted = [...kt.teachingDecisions].sort((a, b) => a.mastery - b.mastery);
    for (const dec of sorted.slice(0, 4)) {
      const pct = (dec.mastery * 100).toFixed(0);
      const m: Record<string, string> = {
        reteach: '重新讲解',
        give_hint: '提示引导',
        worked_example: '分步示范',
        variant_practice: '变式练习',
        advance: '推进新知',
        review_later: '间隔复习',
      };
      parts.push(`- ${dec.knowledgePointId}: ${pct}% (${m[dec.action] || dec.action})`);
    }
  }
  const sp = context.stepPersonalization;
  if (sp && sp.stuckStepIds.length > 0) {
    const labels = sp.stuckStepIds
      .map((id) => sp.standardSteps.find((s) => s.id === id)?.title || id)
      .join('、');
    parts.push(`预测卡点：${labels}`);
  }
  if (parts.length === 0) return '（暂无学情数据）';
  return parts.join('\n');
}

export const deepSolveHandler: CapabilityHandler<DeepSolvePayload> = {
  capabilityId: 'deep_solve',

  validatePayload(payload: unknown): DeepSolvePayload {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload: expected object');
    }
    const p = payload as Record<string, unknown>;
    if (!p.message || typeof p.message !== 'string') {
      throw new Error('Invalid payload: message is required');
    }
    return {
      message: p.message,
      attachments: p.attachments as DeepSolvePayload['attachments'],
      enabledTools: p.enabledTools as DeepSolvePayload['enabledTools'],
      knowledgeBases: p.knowledgeBases as string[],
      detailedAnswer: typeof p.detailedAnswer === 'boolean' ? p.detailedAnswer : true,
      languageModel: p.languageModel as DeepSolvePayload['languageModel'],
      conversationContext: p.conversationContext as string,
      maxRounds:
        typeof p.maxRounds === 'number' ? Math.max(1, Math.min(4, Math.floor(p.maxRounds))) : 2,
      teachingMode: p.teachingMode === 'socratic' ? 'socratic' : 'standard',
      socraticHintLevel:
        typeof p.socraticHintLevel === 'number'
          ? Math.max(0, Math.min(3, Math.floor(p.socraticHintLevel)))
          : 0,
    };
  },

  async *execute(
    request: CapabilityRequest<DeepSolvePayload>,
  ): AsyncGenerator<CapabilityStageResult, CapabilityResult, unknown> {
    const startTime = Date.now();
    const {
      message,
      enabledTools,
      knowledgeBases = [],
      detailedAnswer: _detailedAnswer = true,
      languageModel,
      conversationContext,
      maxRounds = 2,
      teachingMode = 'standard',
      socraticHintLevel = 0,
    } = request.payload;
    const signal = request.signal;
    const activeTools = enabledTools?.length
      ? Array.from(new Set(enabledTools))
      : DEFAULT_DEEP_SOLVE_TOOLS;

    const toolTraces: ToolTrace[] = [];
    let planningResult = '';
    let reasoningResult = '';
    let finalResponse = '';
    const scratchpad = new DeepSolveScratchpad();

    // Build learning context section for personalized prompts
    const learningSection = buildLearningContextSection(request.learningContext);

    // ============================================================
    // Stage 1: Planning
    // ============================================================
    const planningStart = Date.now();
    yield {
      stage: 'pre_process',
      success: true,
      output: { stage: 'planning', message: '正在分析问题...' },
      durationMs: Date.now() - planningStart,
      completedAt: Date.now(),
    };

    try {
      const planningMessages = [
        {
          role: 'system' as const,
          content: PLANNING_SYSTEM_PROMPT + (learningSection ? '\n\n' + learningSection : ''),
        },
        ...(conversationContext
          ? [{ role: 'user' as const, content: `[上下文]\n${conversationContext}` }]
          : []),
        { role: 'user' as const, content: message },
      ];

      if (languageModel) {
        const planningStream = streamText({
          model: languageModel,
          messages: planningMessages,
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of planningStream.textStream) {
          planningResult += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { reasoning: chunk, content: chunk, stage: 'planning' },
              },
            },
            durationMs: Date.now() - planningStart,
            completedAt: Date.now(),
          };
        }
      } else {
        planningResult = `## 问题分析\n${message}\n\n## 解题思路\n正在分析中...`;
      }

      yield {
        stage: 'pre_process',
        success: true,
        output: { stage: 'planning', result: planningResult },
        durationMs: Date.now() - planningStart,
        completedAt: Date.now(),
      };
      scratchpad.setPlan(parseSolvePlan(planningResult));
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[DeepSolve] Planning failed:', err);
      yield {
        stage: 'pre_process',
        success: false,
        error: { code: 'PLANNING_FAILED', message: err.message },
        durationMs: Date.now() - planningStart,
        completedAt: Date.now(),
      };
    }

    // ============================================================
    // Stage 2: Reasoning (Tool Execution)
    // ============================================================
    const reasoningStart = Date.now();
    yield {
      stage: 'agent_invoke',
      success: true,
      output: { stage: 'reasoning', message: '正在推理...' },
      durationMs: Date.now() - reasoningStart,
      completedAt: Date.now(),
    };

    let toolResultsText = '';
    if (activeTools.length > 0) {
      try {
        const rounds = Math.max(1, maxRounds);
        for (let round = 0; round < rounds; round++) {
          const toolsForRound =
            round === 0
              ? activeTools
              : activeTools.includes('reason')
                ? (['reason'] as TutorToolName[])
                : [];
          if (!toolsForRound.length) break;

          for (const name of toolsForRound) {
            const toolId = `${name}-${Date.now()}-${round}`;
            const thought =
              round === 0
                ? `Use ${name} to gather or verify information for the solution.`
                : `Use ${name} to refine the current scratchpad and check for gaps.`;
            const toolContext: ToolExecutionContext = {
              message:
                round === 0
                  ? message
                  : `${message}\n\n当前 scratchpad：\n${scratchpad.buildToolContext(4_000)}`,
              config: {
                knowledgeBase: knowledgeBases[0],
                userId: request.userId,
                maxRAGResults: 5,
                maxWebResults: 5,
                codeTimeoutSec: 30,
              },
              stage: null,
              scenes: [],
              apiKey: '',
              languageModel,
            };

            yield {
              stage: 'agent_stream',
              success: true,
              output: {
                agentEvent: {
                  type: 'tool_start',
                  data: { toolName: name, toolId },
                },
              },
              durationMs: Date.now() - reasoningStart,
              completedAt: Date.now(),
            };

            const result = await executeTool(name, toolContext);

            yield {
              stage: 'agent_stream',
              success: true,
              output: {
                agentEvent: {
                  type: 'tool_end',
                  data: {
                    toolName: name,
                    toolId,
                    success: result.success,
                    output: result.output,
                    error: result.error,
                  },
                },
              },
              durationMs: Date.now() - reasoningStart,
              completedAt: Date.now(),
            };

            scratchpad.addEntry({
              stepIndex: Math.min(round, 7),
              round,
              thought,
              action: name,
              observation: result.output || result.error || '',
              success: result.success,
            });
            toolTraces.push({
              name,
              input: { message, round },
              output: result.output || '',
              success: result.success,
            });
          }
        }

        toolResultsText = scratchpad.buildToolContext();
      } catch (error) {
        log.error('[DeepSolve] Tool execution failed:', error);
      }
    }

    // Generate reasoning based on planning and tool results
    try {
      const reasoningMessages = [
        {
          role: 'system' as const,
          content: REASONING_SYSTEM_PROMPT + (learningSection ? '\n\n' + learningSection : ''),
        },
        { role: 'user' as const, content: `问题：${message}\n\n解题计划：\n${planningResult}` },
        ...(toolResultsText
          ? [{ role: 'user' as const, content: `Scratchpad 与工具观察：\n${toolResultsText}` }]
          : []),
      ];

      if (languageModel) {
        const reasoningStream = streamText({
          model: languageModel,
          messages: reasoningMessages,
          temperature: 0.3,
          abortSignal: signal,
        });

        for await (const chunk of reasoningStream.textStream) {
          reasoningResult += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'thinking',
                data: { content: chunk, stage: 'reasoning' },
              },
            },
            durationMs: Date.now() - reasoningStart,
            completedAt: Date.now(),
          };
        }
      }

      yield {
        stage: 'agent_invoke',
        success: true,
        output: { stage: 'reasoning', result: reasoningResult },
        durationMs: Date.now() - reasoningStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[DeepSolve] Reasoning failed:', err);
    }

    // ============================================================
    // Stage 3: Writing
    // ============================================================
    const writingStart = Date.now();
    yield {
      stage: 'post_process',
      success: true,
      output: {
        stage: 'writing',
        message: teachingMode === 'socratic' ? '正在生成启发式引导...' : '正在生成答案...',
      },
      durationMs: Date.now() - writingStart,
      completedAt: Date.now(),
    };

    try {
      const isSocratic = teachingMode === 'socratic';

      // Build the effective system prompt based on teaching mode
      const socraticPromptText = isSocratic
        ? SOCRATIC_WRITING_SYSTEM_PROMPT.replace('{hintLevel}', String(socraticHintLevel)).replace(
            '{learningState}',
            buildSocraticLearningStateInline(request.learningContext ?? null),
          )
        : '';

      const writingMessages = [
        {
          role: 'system' as const,
          content: isSocratic
            ? socraticPromptText
            : WRITING_SYSTEM_PROMPT + (learningSection ? '\n\n' + learningSection : ''),
        },
        { role: 'user' as const, content: `问题：${message}` },
        ...(planningResult
          ? [{ role: 'assistant' as const, content: `[解题计划]\n${planningResult}` }]
          : []),
        ...(reasoningResult
          ? [{ role: 'assistant' as const, content: `[推理过程]\n${reasoningResult}` }]
          : []),
        ...(scratchpad.getEntries().length
          ? [{ role: 'assistant' as const, content: scratchpad.formatSourcesMarkdown() }]
          : []),
        {
          role: 'user' as const,
          content: isSocratic
            ? `问题：${message}\n\n解题计划已完成。请用苏格拉底式启发引导（层级${socraticHintLevel}），不要直接给出答案。`
            : '请生成最终答案。',
        },
      ];

      if (languageModel) {
        const writingStream = streamText({
          model: languageModel,
          messages: writingMessages,
          temperature: 0.5,
          abortSignal: signal,
        });

        for await (const chunk of writingStream.textStream) {
          finalResponse += chunk;
          yield {
            stage: 'agent_stream',
            success: true,
            output: {
              agentEvent: {
                type: 'text_delta',
                data: { content: chunk },
              },
            },
            durationMs: Date.now() - writingStart,
            completedAt: Date.now(),
          };
        }
      } else {
        finalResponse = reasoningResult || planningResult || '无法生成答案，请检查配置。';
      }

      yield {
        stage: 'post_process',
        success: true,
        output: { stage: 'writing', result: finalResponse },
        durationMs: Date.now() - writingStart,
        completedAt: Date.now(),
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log.error('[DeepSolve] Writing failed:', err);
      yield {
        stage: 'post_process',
        success: false,
        error: { code: 'WRITING_FAILED', message: err.message },
        durationMs: Date.now() - writingStart,
        completedAt: Date.now(),
      };
    }

    // ============================================================
    // Stage 4: Complete
    // ============================================================
    const result: DeepSolveResult = {
      success: true,
      response: finalResponse,
      stages: {
        planning: planningResult,
        reasoning: reasoningResult,
        writing: finalResponse,
      },
      toolTraces,
    };

    yield {
      stage: 'complete',
      success: true,
      output: result as unknown as Record<string, unknown>,
      durationMs: Date.now() - startTime,
      completedAt: Date.now(),
    };

    return {
      success: true,
      output: result as unknown as Record<string, unknown>,
      stages: [],
      traceEvents: [],
      totalDurationMs: Date.now() - startTime,
    };
  },
};
