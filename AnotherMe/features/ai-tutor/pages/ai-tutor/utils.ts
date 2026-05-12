import type { ToolExecutionTrace } from '@/features/ai-tutor/components/chat/tool-trace-panel';
import { CAPABILITIES, CHAT_TOOLS, TOOL_CONFIG_BY_CAPABILITY } from './constants';
import type {
  CapabilityId,
  MathAnimatorPreviewData,
  QuizPreviewQuestion,
  TutorMessage,
  TutorSession,
  TutorToolName,
  TutorToolTrace,
  VisualizePreviewData,
} from './types';

export function parseSSEChunk(buffer: string) {
  const events: string[] = [];
  let rest = buffer;
  while (true) {
    const separatorIndex = rest.indexOf('\n\n');
    if (separatorIndex < 0) break;
    const one = rest.slice(0, separatorIndex);
    rest = rest.slice(separatorIndex + 2);
    events.push(one);
  }
  return { events, rest };
}

export async function parseApiError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; details?: string };
    return payload.error || payload.details || '';
  } catch {
    return await response.text();
  }
}

export function sessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSession(): TutorSession {
  const now = new Date().toISOString();
  return {
    id: sessionId(),
    title: '新会话',
    autoTitle: true,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function deriveSessionTitle(messages: TutorMessage[]): string {
  const firstUser = messages.find((item) => item.role === 'user' && item.content.trim());
  if (!firstUser) return '新会话';
  const normalized = firstUser.content.replace(/\s+/g, ' ').trim();
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized;
}

export function safeParseSessions(raw: string | null): TutorSession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as TutorSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.messages))
      .map((item) => ({
        id: item.id,
        title: typeof item.title === 'string' && item.title.trim() ? item.title : '新会话',
        autoTitle: Boolean(item.autoTitle),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || item.createdAt || new Date().toISOString(),
        messages: item.messages
          .filter((msg) => msg && typeof msg.id === 'string')
          .map((msg) => {
            const rawMessage = msg as Record<string, unknown>;
            return {
              id: rawMessage.id as string,
              role: rawMessage.role === 'assistant' ? 'assistant' : 'user',
              content: typeof rawMessage.content === 'string' ? rawMessage.content : '',
              capability: asCapabilityId(rawMessage.capability),
              feedback: asFeedback(rawMessage.feedback),
              toolTraces: parseToolTraces(rawMessage.toolTraces),
              capabilityResult: asRecord(rawMessage.capabilityResult),
            };
          }),
      }));
  } catch {
    return [];
  }
}

export function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function extractSvgPreview(content: string): string | null {
  const fenced = content.match(/```svg\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || content.match(/<svg[\s\S]*?<\/svg>/i)?.[0];
  if (!candidate) return null;

  const svg = candidate.trim();
  if (!/^<svg[\s>]/i.test(svg)) return null;
  return svg;
}

export function buildSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function stringifyEventValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function asTutorToolName(value: unknown): TutorToolName | null {
  if (typeof value !== 'string') return null;
  return CHAT_TOOLS.some((tool) => tool.id === value) ? (value as TutorToolName) : null;
}

export function asCapabilityId(value: unknown): CapabilityId | undefined {
  if (value === '') return '';
  if (typeof value !== 'string') return undefined;
  return CAPABILITIES.some((capability) => capability.id === value)
    ? (value as CapabilityId)
    : undefined;
}

export function asFeedback(value: unknown): TutorMessage['feedback'] {
  return value === 'up' || value === 'down' || value === null ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseToolTraces(value: unknown): TutorToolTrace[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const traces = value
    .map((trace): TutorToolTrace | null => {
      if (!trace || typeof trace !== 'object') return null;
      const item = trace as Record<string, unknown>;
      const toolName = asTutorToolName(item.toolName);
      const status = item.status;
      const startTime = item.startTime;
      if (
        !toolName ||
        (status !== 'running' && status !== 'success' && status !== 'error') ||
        typeof item.id !== 'string' ||
        typeof startTime !== 'number'
      ) {
        return null;
      }

      return {
        id: item.id,
        toolName,
        status,
        startTime,
        endTime: typeof item.endTime === 'number' ? item.endTime : undefined,
        output: typeof item.output === 'string' ? item.output : undefined,
        error: typeof item.error === 'string' ? item.error : undefined,
      };
    })
    .filter((trace): trace is TutorToolTrace => Boolean(trace));

  return traces.length ? traces : undefined;
}

export function getDefaultTools(capability: CapabilityId): TutorToolName[] {
  return [...TOOL_CONFIG_BY_CAPABILITY[capability].defaultTools];
}

export function extractQuizPreviewQuestions(
  result: Record<string, unknown> | undefined,
): QuizPreviewQuestion[] {
  const output = result?.output;
  if (!output || typeof output !== 'object') return [];

  const questions = (output as Record<string, unknown>).questions;
  if (!Array.isArray(questions)) return [];

  return questions
    .map((item): QuizPreviewQuestion | null => {
      if (!item || typeof item !== 'object') return null;
      const question = item as Record<string, unknown>;
      const title = typeof question.question === 'string' ? question.question.trim() : '';
      const answer = typeof question.answer === 'string' ? question.answer.trim() : '';
      if (!title || !answer) return null;

      return {
        question: title,
        options: Array.isArray(question.options)
          ? question.options.filter(
              (option): option is string => typeof option === 'string' && option.trim().length > 0,
            )
          : undefined,
        answer,
        explanation: typeof question.explanation === 'string' ? question.explanation : undefined,
        difficulty: typeof question.difficulty === 'string' ? question.difficulty : undefined,
      };
    })
    .filter((item): item is QuizPreviewQuestion => Boolean(item));
}

export function getCapabilityOutput(
  result: Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  const output = result?.output;
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
}

export function extractVisualizePreview(
  result: Record<string, unknown> | undefined,
): VisualizePreviewData | null {
  const output = getCapabilityOutput(result);
  if (!output) return null;

  const format =
    typeof output.render_type === 'string'
      ? output.render_type
      : typeof output.format === 'string'
        ? output.format
        : 'svg';
  const preview = typeof output.preview === 'string' ? output.preview.trim() : '';
  const codeRaw = output.code;
  const code =
    typeof codeRaw === 'string'
      ? codeRaw.trim()
      : codeRaw &&
          typeof codeRaw === 'object' &&
          typeof (codeRaw as Record<string, unknown>).content === 'string'
        ? String((codeRaw as Record<string, unknown>).content).trim()
        : '';
  const content = preview || code;

  if (!content) return null;
  return { format, content };
}

export function extractMathAnimatorPreview(
  result: Record<string, unknown> | undefined,
): MathAnimatorPreviewData | null {
  const output = getCapabilityOutput(result);
  if (!output) return null;

  const storyboard = Array.isArray(output.storyboard)
    ? output.storyboard
        .map((item): { frame: number; description: string; code?: string } | null => {
          if (!item || typeof item !== 'object') return null;
          const frame = item as Record<string, unknown>;
          const description = typeof frame.description === 'string' ? frame.description.trim() : '';
          if (!description) return null;
          return {
            frame: typeof frame.frame === 'number' ? frame.frame : 0,
            description,
            code: typeof frame.code === 'string' ? frame.code : undefined,
          };
        })
        .filter((item): item is { frame: number; description: string; code?: string } =>
          Boolean(item),
        )
    : undefined;

  const artifacts = Array.isArray(output.artifacts)
    ? output.artifacts
        .map(
          (
            item,
          ): { type: 'video' | 'image'; url: string; filename?: string; label?: string } | null => {
            if (!item || typeof item !== 'object') return null;
            const artifact = item as Record<string, unknown>;
            const type =
              artifact.type === 'image' ? 'image' : artifact.type === 'video' ? 'video' : null;
            const url = typeof artifact.url === 'string' ? artifact.url : '';
            if (!type || !url) return null;
            return {
              type,
              url,
              filename: typeof artifact.filename === 'string' ? artifact.filename : undefined,
              label: typeof artifact.label === 'string' ? artifact.label : undefined,
            };
          },
        )
        .filter(
          (
            item,
          ): item is { type: 'video' | 'image'; url: string; filename?: string; label?: string } =>
            Boolean(item),
        )
    : undefined;

  const codeRaw = output.code;
  const codeContent =
    typeof codeRaw === 'object' &&
    codeRaw &&
    typeof (codeRaw as Record<string, unknown>).content === 'string'
      ? String((codeRaw as Record<string, unknown>).content)
      : undefined;
  const render =
    output.render && typeof output.render === 'object'
      ? (output.render as Record<string, unknown>)
      : undefined;
  const toolArtifacts =
    output.toolArtifacts && typeof output.toolArtifacts === 'object'
      ? (output.toolArtifacts as Record<string, unknown>)
      : undefined;

  const preview: MathAnimatorPreviewData = {
    response: typeof output.response === 'string' ? output.response : undefined,
    outputUrl: typeof output.outputUrl === 'string' ? output.outputUrl : undefined,
    artifacts,
    storyboard,
    manimCode: typeof output.manimCode === 'string' ? output.manimCode : codeContent,
    renderError:
      typeof render?.renderError === 'string'
        ? render.renderError
        : typeof toolArtifacts?.renderError === 'string'
          ? toolArtifacts.renderError
          : undefined,
  };

  if (
    preview.outputUrl ||
    preview.artifacts?.length ||
    preview.storyboard?.length ||
    preview.manimCode ||
    preview.renderError
  ) {
    return preview;
  }

  if (preview.response) {
    return { ...preview, renderError: '未生成可渲染动画结果。' };
  }

  return null;
}

// 将内部 TutorToolTrace 转换为 ToolTracePanel 需要的格式
export function toToolExecutionTraces(traces?: TutorToolTrace[]): ToolExecutionTrace[] {
  if (!traces) return [];
  return traces.map((t) => ({
    id: t.id,
    toolName: t.toolName,
    status: t.status,
    startTime: t.startTime,
    endTime: t.endTime,
    output: t.output,
    error: t.error,
  }));
}
