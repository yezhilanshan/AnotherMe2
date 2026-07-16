'use client';

import { useMemo } from 'react';
import type { TeachingTraceEvent } from '@/lib/types/teaching-trace';

export interface TeachingTraceItem {
  id: string;
  time: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
}

function textValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatTitle(event: TeachingTraceEvent): string {
  switch (event.type) {
    case 'stage_start':
      return `阶段：${textValue(event.payload.stage, event.stage || 'processing')}`;
    case 'learning_context_loaded':
      return '学习上下文已加载';
    case 'capability_guard_passed':
      return '能力检查通过';
    case 'prompt_built':
      return '提示词已构建';
    case 'agent_response':
      return 'Agent 响应';
    case 'tool_invoked':
      return `调用工具：${textValue(event.payload.toolId, 'tool')}`;
    case 'tool_result':
      return `工具返回：${textValue(event.payload.toolId, 'tool')}`;
    case 'complete':
      return '执行完成';
    case 'error':
      return '执行异常';
    default:
      return event.type;
  }
}

function formatDetail(event: TeachingTraceEvent): string {
  switch (event.type) {
    case 'learning_context_loaded': {
      const weak = Array.isArray(event.payload.weakKnowledgePoints)
        ? event.payload.weakKnowledgePoints.slice(0, 3).join(', ')
        : '';
      const decisions = typeof event.payload.teachingDecisionCount === 'number'
        ? event.payload.teachingDecisionCount
        : 0;
      return weak ? `弱项：${weak}；教学决策 ${decisions} 条` : `教学决策 ${decisions} 条`;
    }
    case 'prompt_built':
      return `长度 ${event.payload.promptLength || 0}，KT: ${event.payload.includesKtContext ? 'yes' : 'no'}`;
    case 'tool_invoked':
      return JSON.stringify(event.payload.params || {}).slice(0, 120);
    case 'tool_result':
      return textValue(event.payload.errorMessage, textValue(event.payload.resultSummary, event.payload.success ? '成功' : '失败'));
    case 'complete':
      return `耗时 ${Math.round(Number(event.payload.totalDurationMs || event.durationMs || 0))}ms`;
    case 'error':
      return textValue(event.payload.message, 'Unknown error');
    default:
      return event.stage || textValue(event.payload.capabilityId, '');
  }
}

function toneFor(event: TeachingTraceEvent): TeachingTraceItem['tone'] {
  if (event.type === 'error') return 'error';
  if (event.type === 'complete') return event.payload.success === false ? 'error' : 'success';
  if (event.type === 'tool_result' && event.payload.success === false) return 'warning';
  return 'neutral';
}

export function useTeachingTrace(events: TeachingTraceEvent[]): TeachingTraceItem[] {
  return useMemo(
    () =>
      events.map((event, index) => ({
        id: `${event.requestId}-${event.timestamp}-${index}`,
        time: new Date(event.timestamp).toLocaleTimeString(),
        title: formatTitle(event),
        detail: formatDetail(event),
        tone: toneFor(event),
      })),
    [events],
  );
}
