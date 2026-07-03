// 借鉴 DeepTutor web/hooks/useSmoothStreamText 的思路，适配 React Native。
// 流式期间用 requestAnimationFrame / setTimeout 控制每帧展开字符数，
// 把后端推送频率和 UI 渲染频率解耦，减少低端机因突发大 chunk 导致的卡顿。

import { useEffect, useRef, useState } from "react";

interface SmoothStreamOptions {
  /**
   * 每帧最多展开的字符数。backlog 大时会自动加速，但不超过此上限。
   */
  maxCharsPerFrame?: number;
  /**
   * 每帧最少展开的字符数，保证光标始终前进。
   */
  minCharsPerFrame?: number;
  /**
   * backlog 追赶除数。越大展开越慢，越小越快。建议 4-6。
   */
  catchUpDivisor?: number;
  /**
   * 是否启用平滑流式。false 时直接透传 content。
   */
  enabled?: boolean;
}

/**
 * 平滑流式文本 hook。
 *
 * 行为：
 * - 未启用 / 非流式：直接返回完整 content。
 * - 流式中：按帧逐步 reveal content，避免单个 delta 过长时一次重渲染大量文本。
 * - content 缩短（如重新生成、切换分支）：立即 snap 到新长度，避免残留旧尾巴。
 * - 流式结束：下一帧立即 snap 到完整 content，用户不会看到半拉尾巴。
 *
 * 注意：RN 没有 DOM rAF，但全局 requestAnimationFrame 由 RN 引擎提供；
 * 若不可用则降级到 setTimeout。
 */
export function useSmoothStreamText(
  content: string,
  isStreaming: boolean,
  options: SmoothStreamOptions = {},
): string {
  const {
    maxCharsPerFrame = 80,
    minCharsPerFrame = 2,
    catchUpDivisor = 5,
    enabled = true,
  } = options;

  const [shown, setShown] = useState<string>(content);
  const shownLenRef = useRef<number>(content.length);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearLoops = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const snapTo = (value: string) => {
      if (shownLenRef.current !== value.length || shown !== value) {
        shownLenRef.current = value.length;
        setShown(value);
      }
    };

    if (!enabled) {
      snapTo(content);
      return clearLoops;
    }

    // 流式结束：立刻 snap 到完整内容
    if (!isStreaming) {
      snapTo(content);
      return clearLoops;
    }

    // content 缩短：立即 snap，避免旧尾巴残留
    if (shownLenRef.current > content.length) {
      snapTo(content);
      return clearLoops;
    }

    // 已经追上：等待下一个 delta
    if (shownLenRef.current >= content.length) {
      return clearLoops;
    }

    const scheduleFrame = (fn: () => void) => {
      if (typeof requestAnimationFrame === "function") {
        rafRef.current = requestAnimationFrame(fn);
      } else {
        timerRef.current = setTimeout(fn, 16);
      }
    };

    const step = () => {
      rafRef.current = null;
      timerRef.current = null;

      const target = content.length;
      const current = shownLenRef.current;
      if (current >= target) return;

      const backlog = target - current;
      const advance = Math.min(
        maxCharsPerFrame,
        Math.max(minCharsPerFrame, Math.ceil(backlog / catchUpDivisor)),
      );
      const next = Math.min(target, current + advance);
      shownLenRef.current = next;
      setShown(content.slice(0, next));

      if (next < target) {
        scheduleFrame(step);
      }
    };

    if (rafRef.current === null && timerRef.current === null) {
      scheduleFrame(step);
    }

    return clearLoops;
    // shown 故意不放进 deps：包含它会导致每前进一次就重启循环，丢失 rAF 链。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    content,
    isStreaming,
    enabled,
    maxCharsPerFrame,
    minCharsPerFrame,
    catchUpDivisor,
  ]);

  return shown;
}
