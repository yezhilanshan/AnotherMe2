import React, { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import MathJax from "react-native-mathjax-svg";

import { debugError, debugLog, elapsedMs, nowMs } from "../../lib/debug";
import { simplifyLatex } from "../../lib/latex-utils";
import { acquireSlot, releaseSlot } from "../../lib/mathjax-render-queue";
import { colors } from "../../lib/theme";
import {
  BLOCK_MATH_FONT_SIZE,
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
} from "./rendererTokens";

/** MathJax 错误边界 — 渲染失败时回退到 simplifyLatex 文本 */
class MathJaxErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode; formulaChars: number },
  { hasError: boolean }
> {
  constructor(props: {
    fallback: React.ReactNode;
    children: React.ReactNode;
    formulaChars: number;
  }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    debugError("MathJax", "render_failed", {
      formulaChars: this.props.formulaChars,
      message: error.message,
      stack: error.stack,
    });
  }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * 带队列的 MathJax 渲染器
 * 流式结束时所有公式同时需要 MathJax 渲染，通过队列限制并发（默认 2），
 * 避免瞬间阻塞主线程。排队期间先显示 simplifyLatex 纯文本。
 */
function QueuedMathJax({
  formula,
  color,
}: {
  formula: string;
  color: string;
}) {
  const [slotReady, setSlotReady] = useState(false);
  const hasSlot = useRef(false);
  const releasedSlot = useRef(false);
  const releaseSlotOnce = useCallback(() => {
    if (!hasSlot.current || releasedSlot.current) return;
    releasedSlot.current = true;
    hasSlot.current = false;
    releaseSlot();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startedAt = nowMs();
    setSlotReady(false);
    acquireSlot().then(() => {
      if (cancelled) {
        releaseSlot();
        return;
      }
      hasSlot.current = true;
      releasedSlot.current = false;
      debugLog("MathJax", "slot_ready", {
        formulaChars: formula.length,
        waitMs: elapsedMs(startedAt),
      });
      setSlotReady(true);
    });
    return () => {
      cancelled = true;
      releaseSlotOnce();
    };
  }, [formula, releaseSlotOnce]);

  useEffect(() => {
    if (!slotReady) return;
    const releaseTimer = setTimeout(releaseSlotOnce, 160);
    return () => clearTimeout(releaseTimer);
  }, [releaseSlotOnce, slotReady]);

  if (!slotReady) {
    return (
      <Text style={[styles.fallbackText, { color }]}>
        {simplifyLatex(formula)}
      </Text>
    );
  }

  return (
    <MathJaxErrorBoundary
      formulaChars={formula.length}
      fallback={
        <Text style={[styles.fallbackText, { color }]}>
          {simplifyLatex(formula)}
        </Text>
      }
    >
      <MathJax
        style={styles.math as any}
        color={color}
        fontSize={BLOCK_MATH_FONT_SIZE}
      >
        {formula}
      </MathJax>
    </MathJaxErrorBoundary>
  );
}

export function MathBlockRenderer({
  formula,
  color = colors.textPrimary,
  renderMath = true,
}: {
  formula: string;
  color?: string;
  renderMath?: boolean;
}) {
  if (!renderMath) {
    return (
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        style={styles.container}
        contentContainerStyle={styles.fallbackContent}
      >
        <Text style={[styles.fallbackText, { color }]}>{formula}</Text>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mathContent}
      >
        <QueuedMathJax formula={formula} color={color} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    marginBottom: 6,
    maxWidth: "100%",
  },
  math: {
    color: colors.textPrimary,
  },
  mathContent: {
    minHeight: 34,
    alignItems: "center",
    paddingVertical: 4,
    paddingRight: 8,
  },
  fallbackContent: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  fallbackText: {
    fontFamily: "monospace",
    fontSize: BODY_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
  },
});
