import {
  AlertTriangle,
  AlignLeft,
  BookOpen,
  Circle,
  Code2,
  FileText,
  Film,
  Image as ImageIcon,
  Layers,
  ListChecks,
  MessageSquare,
  MousePointerClick,
  Sparkles,
  Sticker,
  type LucideIcon,
} from 'lucide-react';
import type { BlockType, LiveBookBlock, LiveBookPage, LiveBookStatus } from './types';

export function statusText(status: LiveBookStatus): string {
  if (status === 'draft') return '草案';
  if (status === 'spine_ready') return '目录就绪';
  if (status === 'compiling') return '编译中';
  if (status === 'ready') return '就绪';
  return '失败';
}

export function statusColor(status: LiveBookStatus): string {
  if (status === 'ready') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (status === 'failed') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'compiling') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'spine_ready') return 'bg-gray-100 text-gray-700 border-gray-200';
  return 'bg-gray-100 text-gray-700 border-gray-200';
}

export function blockTypeColor(type: BlockType): string {
  switch (type) {
    case 'quiz':
      return 'bg-amber-50/70 border-amber-200';
    case 'deep_dive':
      return 'bg-indigo-50/70 border-indigo-200';
    case 'remedial':
      return 'bg-rose-50/70 border-rose-200';
    case 'callout':
      return 'bg-yellow-50/70 border-yellow-200';
    case 'figure':
      return 'bg-emerald-50/70 border-emerald-200';
    case 'flash_cards':
      return 'bg-violet-50/70 border-violet-200';
    case 'interactive':
      return 'bg-teal-50/70 border-teal-200';
    case 'animation':
      return 'bg-sky-50/70 border-sky-200';
    case 'code':
      return 'bg-slate-50/70 border-slate-200';
    case 'timeline':
      return 'bg-cyan-50/70 border-cyan-200';
    case 'concept_graph':
      return 'bg-blue-50/70 border-blue-200';
    case 'section':
      return 'bg-white border-gray-200';
    default:
      return 'bg-white border-gray-200';
  }
}

export function blockTypeAccent(type: BlockType): string {
  switch (type) {
    case 'quiz':
      return 'bg-amber-500';
    case 'deep_dive':
      return 'bg-indigo-500';
    case 'remedial':
      return 'bg-rose-500';
    case 'callout':
      return 'bg-yellow-500';
    case 'figure':
      return 'bg-emerald-500';
    case 'interactive':
      return 'bg-teal-500';
    case 'animation':
      return 'bg-sky-500';
    case 'timeline':
      return 'bg-cyan-500';
    case 'concept_graph':
      return 'bg-blue-500';
    case 'code':
      return 'bg-slate-500';
    default:
      return 'bg-gray-400';
  }
}

export function blockTypeLabel(type: BlockType): string {
  const labels: Record<BlockType, string> = {
    section: '导学',
    text: '讲解',
    quiz: '测验',
    interactive: '互动',
    animation: '演示',
    deep_dive: '深入',
    remedial: '补救',
    callout: '提示',
    figure: '图示',
    flash_cards: '卡片',
    code: '代码',
    timeline: '时间线',
    concept_graph: '概念图',
    user_note: '笔记',
    placeholder: '占位',
  };
  return labels[type] || type;
}

export const BLOCK_TYPE_ICON: Record<BlockType, LucideIcon> = {
  section: BookOpen,
  text: AlignLeft,
  quiz: ListChecks,
  interactive: MousePointerClick,
  animation: Film,
  deep_dive: MessageSquare,
  remedial: AlertTriangle,
  callout: Sparkles,
  figure: ImageIcon,
  flash_cards: Sticker,
  code: Code2,
  timeline: Layers,
  concept_graph: Layers,
  user_note: FileText,
  placeholder: Circle,
};

export const INSERTABLE_BLOCK_TYPES: BlockType[] = [
  'text',
  'callout',
  'quiz',
  'code',
  'timeline',
  'flash_cards',
  'figure',
  'interactive',
  'animation',
  'deep_dive',
  'user_note',
];

export const CHANGEABLE_BLOCK_TYPES: BlockType[] = [
  'section',
  'text',
  'callout',
  'quiz',
  'interactive',
  'animation',
  'deep_dive',
  'remedial',
  'figure',
  'flash_cards',
  'code',
  'timeline',
  'concept_graph',
  'user_note',
];

export function manualBlockDefaults(type: BlockType) {
  const label = blockTypeLabel(type);
  return {
    title: `手动插入${label}`,
    content: `这是一个手动插入的${label}块，可继续重生成或调整类型。`,
  };
}

export function extractBlockSourceLabels(block: LiveBookBlock): string[] {
  const labels: string[] = [];
  const metadataAnchors = Array.isArray(block.metadataJson?.sourceAnchors)
    ? block.metadataJson.sourceAnchors
    : [];
  for (const anchor of metadataAnchors) {
    if (!anchor || typeof anchor !== 'object') continue;
    const record = anchor as Record<string, unknown>;
    const name = typeof record.sourceName === 'string' ? record.sourceName : undefined;
    const snippet = typeof record.contentSnippet === 'string' ? record.contentSnippet : undefined;
    const label = [name, snippet?.slice(0, 36)].filter(Boolean).join(' · ');
    if (label) labels.push(label);
  }
  for (const ref of block.sourceRefsJson || []) {
    const refText = typeof ref.ref === 'string' ? ref.ref : undefined;
    const snippet = typeof ref.snippet === 'string' ? ref.snippet : undefined;
    const label = [refText, snippet?.slice(0, 36)].filter(Boolean).join(' · ');
    if (label) labels.push(label);
  }
  return Array.from(new Set(labels)).slice(0, 3);
}

function getBlockPayload(block: LiveBookBlock): Record<string, unknown> {
  return block.payloadJson && typeof block.payloadJson === 'object'
    ? block.payloadJson
    : block.paramsJson && typeof block.paramsJson === 'object'
      ? block.paramsJson
      : {};
}

export function extractBlockBridgeText(block: LiveBookBlock): string {
  const payload = getBlockPayload(block);
  const candidates = [
    payload.bridge_text,
    payload.bridgeText,
    block.paramsJson?.bridgeText,
    block.metadataJson?.bridgeText,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
}

export function renderBlockPayload(block: LiveBookBlock) {
  const payload = getBlockPayload(block);
  const payloadType = String(payload.type || block.type);

  if (payloadType === 'section' && Array.isArray(payload.subsections)) {
    return (
      <div className="space-y-4">
        {(payload.subsections as Array<Record<string, unknown>>).map((section, index) => (
          <section key={`${block.id}-section-${index}`} className="space-y-1">
            <h4 className="text-sm font-semibold text-gray-900">
              {String(section.heading || block.title)}
            </h4>
            <p className="whitespace-pre-wrap text-[15px] leading-8 text-gray-700">
              {String(section.body || '')}
            </p>
          </section>
        ))}
      </div>
    );
  }

  if (payloadType === 'quiz' && Array.isArray(payload.questions)) {
    return (
      <div className="space-y-3">
        {(payload.questions as Array<Record<string, unknown>>).map((question, index) => (
          <div
            key={`${block.id}-q-${index}`}
            className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3"
          >
            <p className="text-xs font-semibold uppercase text-amber-700">Question {index + 1}</p>
            <p className="mt-1 text-[15px] leading-7 text-gray-800">
              {String(question.prompt || block.content)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (payloadType === 'flash_cards' && Array.isArray(payload.cards)) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {(payload.cards as Array<Record<string, unknown>>).slice(0, 4).map((card, index) => (
          <div
            key={`${block.id}-card-${index}`}
            className="rounded-md border border-violet-200 bg-white/80 px-4 py-3"
          >
            <p className="text-xs font-semibold text-violet-700">{String(card.front || '')}</p>
            <p className="mt-2 text-sm leading-6 text-gray-600">{String(card.back || '')}</p>
          </div>
        ))}
      </div>
    );
  }

  if (payloadType === 'callout') {
    return (
      <div className="rounded-md border border-yellow-200 bg-yellow-50/70 px-4 py-3 text-[15px] leading-7 text-gray-800">
        {String(payload.body || block.content)}
      </div>
    );
  }

  if (payloadType === 'figure') {
    return (
      <div className="space-y-2">
        <pre className="overflow-x-auto rounded-md border border-emerald-200 bg-white px-4 py-3 text-xs text-gray-600">
          {String(payload.code || block.content)}
        </pre>
        {typeof payload.caption === 'string' && (
          <p className="text-xs text-gray-500">{payload.caption}</p>
        )}
      </div>
    );
  }

  if (payloadType === 'code') {
    return (
      <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 px-4 py-3 text-xs leading-6 text-slate-100">
        {String(payload.code || block.content)}
      </pre>
    );
  }

  if (payloadType === 'timeline' && Array.isArray(payload.steps)) {
    return (
      <ol className="space-y-3">
        {(payload.steps as Array<Record<string, unknown>>).map((step, index) => (
          <li key={`${block.id}-step-${index}`} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[11px] font-semibold text-white">
              {index + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{String(step.title || '')}</p>
              <p className="text-sm leading-6 text-gray-600">{String(step.description || '')}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-[15px] leading-8 text-gray-700">{block.content}</div>
  );
}

export function pageStatusBadge(status: LiveBookPage['status']) {
  switch (status) {
    case 'ready':
      return { text: '就绪', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'error':
      return { text: '错误', className: 'bg-red-50 text-red-700 border-red-200' };
    case 'partial':
      return { text: '部分', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    default:
      return { text: '待编译', className: 'bg-gray-50 text-gray-600 border-gray-200' };
  }
}
