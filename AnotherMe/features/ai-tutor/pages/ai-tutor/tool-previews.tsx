'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { BrainWaveLoader } from '@/features/ai-tutor/components/ai-elements/loader';
import type { QuizPreviewQuestion } from './types';
import {
  buildSvgDataUrl,
  extractMathAnimatorPreview,
  extractSvgPreview,
  extractVisualizePreview,
} from './utils';

export function VisualPreview({ content }: { content: string }) {
  const svg = extractSvgPreview(content);
  if (!svg) return null;

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18]">
      <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-gray-400">
        可视化预览
      </div>
      <div className="flex justify-center bg-white dark:bg-[#171411] p-3">
        <img
          src={buildSvgDataUrl(svg)}
          alt="AI 生成的可视化图形"
          className="max-h-[420px] w-full max-w-full object-contain"
        />
      </div>
    </div>
  );
}

export function VisualizeResultPreview({ result }: { result?: Record<string, unknown> }) {
  const preview = extractVisualizePreview(result);
  if (!preview) return null;

  const normalizedFormat = preview.format.toLowerCase();
  const isSvg = normalizedFormat === 'svg' || preview.content.trim().startsWith('<svg');
  const isHtml =
    normalizedFormat === 'html' ||
    preview.content.trim().startsWith('<!doctype') ||
    preview.content.trim().startsWith('<html');

  if (isSvg) {
    const svg = preview.content.includes('</svg>')
      ? preview.content.slice(
          preview.content.indexOf('<svg'),
          preview.content.lastIndexOf('</svg>') + 6,
        )
      : preview.content;

    return (
      <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18]">
        <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-gray-400">
          可视化预览
        </div>
        <div className="flex justify-center bg-white dark:bg-[#171411] p-3">
          <img
            src={buildSvgDataUrl(svg)}
            alt="AI 生成的可视化图形"
            className="max-h-[460px] w-full max-w-full object-contain"
          />
        </div>
      </div>
    );
  }

  if (isHtml) {
    return (
      <div className="mb-3 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18]">
        <div className="border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-[12px] font-medium text-gray-600 dark:text-gray-400">
          可视化预览
        </div>
        <iframe
          title="AI 生成的可视化图形"
          sandbox=""
          srcDoc={preview.content}
          className="h-[460px] w-full bg-white dark:bg-[#171411]"
        />
      </div>
    );
  }

  return (
    <pre className="mb-3 max-h-[420px] overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-950 p-3 text-[11px] text-gray-100">
      {preview.content}
    </pre>
  );
}

export function MathAnimatorPreview({ result }: { result?: Record<string, unknown> }) {
  const preview = extractMathAnimatorPreview(result);
  if (!preview) return null;
  const videos = [
    ...(preview.outputUrl
      ? [{ type: 'video' as const, url: preview.outputUrl, label: 'Video Output' }]
      : []),
    ...(preview.artifacts || []).filter((item) => item.type === 'video'),
  ];
  const images = (preview.artifacts || []).filter((item) => item.type === 'image');

  return (
    <div className="space-y-3">
      {videos.length > 0 ? (
        <div className="space-y-2">
          {videos.map((video, index) => (
            <div
              key={`${video.url}-${index}`}
              className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-black"
            >
              <video
                controls
                playsInline
                preload="metadata"
                src={video.url}
                className="aspect-video max-h-[520px] w-full object-contain"
              />
            </div>
          ))}
        </div>
      ) : null}

      {images.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {images.map((image, index) => (
            <div
              key={`${image.url}-${index}`}
              className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#201c18]"
            >
              <img
                src={image.url}
                alt={image.label || image.filename || 'Math animation output'}
                className="max-h-[320px] w-full object-contain"
              />
            </div>
          ))}
        </div>
      ) : null}

      {preview.storyboard?.length ? (
        <div className="space-y-2">
          {preview.storyboard.map((frame, index) => (
            <div
              key={`${frame.frame}-${index}`}
              className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18] p-3"
            >
              <div className="mb-1 text-[11px] font-semibold text-orange-700 dark:text-orange-400">
                第{frame.frame || index + 1}帧
              </div>
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
                {frame.description}
              </p>
              {frame.code ? (
                <pre className="mt-2 max-h-[180px] overflow-auto rounded-lg bg-gray-950 p-2 text-[10px] text-gray-100">
                  {frame.code}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {!videos.length && !images.length && preview.renderError ? (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
          动画渲染失败：{preview.renderError}
        </div>
      ) : null}

      {preview.manimCode ? (
        <details className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18] p-3">
          <summary className="cursor-pointer text-[12px] font-semibold text-gray-700 dark:text-gray-300">
            Manim 代码
          </summary>
          <pre className="mt-2 max-h-[260px] overflow-auto rounded-lg bg-gray-950 p-3 text-[10px] text-gray-100">
            {preview.manimCode}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function QuizPreview({ questions }: { questions: QuizPreviewQuestion[] }) {
  if (!questions.length) return null;

  return (
    <div className="space-y-3">
      {questions.map((question, index) => (
        <details
          key={`${question.question}-${index}`}
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#201c18] p-3 text-left"
        >
          <summary className="cursor-pointer list-none">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 rounded-md bg-orange-100 dark:bg-orange-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 dark:text-orange-400">
                Q{index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-relaxed text-gray-800 dark:text-gray-100">
                  {question.question}
                </div>
                {question.difficulty ? (
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {question.difficulty}
                  </div>
                ) : null}
              </div>
            </div>
          </summary>

          {question.options?.length ? (
            <div className="mt-3 space-y-1.5">
              {question.options.map((option, optionIndex) => (
                <div
                  key={`${option}-${optionIndex}`}
                  className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#171411] px-2.5 py-2 text-[12px] text-gray-700 dark:text-gray-300"
                >
                  <span className="mr-1.5 font-semibold text-gray-400 dark:text-gray-500">
                    {String.fromCharCode(65 + optionIndex)}.
                  </span>
                  {option}
                </div>
              ))}
            </div>
          ) : null}

          <div className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/20 px-2.5 py-2 text-[12px] leading-relaxed text-emerald-800 dark:text-emerald-300">
            <div className="font-semibold">答案：{question.answer}</div>
            {question.explanation ? (
              <div className="mt-1 text-emerald-700 dark:text-emerald-400">
                {question.explanation}
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

// 思考过程可折叠组件
export function ReasoningBlock({
  reasoning,
  isStreaming = false,
}: {
  reasoning: string;
  isStreaming?: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={`mb-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-900/20 overflow-hidden animate-thinking-enter ${isStreaming ? 'animate-border-glow' : ''}`}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <BrainWaveLoader size={16} />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-500" />
          )}
          <span
            className={`text-sm font-medium ${isStreaming ? 'thinking-text-shimmer text-transparent' : 'text-amber-800 dark:text-amber-200'}`}
          >
            {isStreaming ? '思考中' : '思考过程'}
          </span>
          {isStreaming && (
            <span className="flex items-center gap-0.5">
              <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
              <span className="neural-dot inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            </span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        )}
      </button>
      {isExpanded && (
        <div className="px-4 pb-3">
          <p className="text-sm text-amber-700 dark:text-amber-300/80 leading-relaxed whitespace-pre-wrap">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
