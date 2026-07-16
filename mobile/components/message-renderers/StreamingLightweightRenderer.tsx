import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { simplifyLatex } from "../../lib/latex-utils";
import { colors } from "../../lib/theme";
import { BODY_FONT_SIZE, BODY_LINE_HEIGHT } from "./rendererTokens";

const STREAM_VISIBLE_CHARS = 6000;
const LONG_TOKEN_RE = /([^\s]{20})(?=[^\s])/g;
const SOFT_WRAP = String.fromCharCode(0x200b);

function softWrapLongTokens(text: string): string {
  return text.replace(LONG_TOKEN_RE, `$1${SOFT_WRAP}`);
}

interface Segment {
  type: "text" | "inline_math";
  content: string;
}

/** 轻量拆分：只识别已闭合的 $...$ 行内公式，不处理 $$...$$ 块级公式。
 *  流式阶段内容不完整，块级公式等 final_markdown 再完整渲染。 */
function splitInlineMath(text: string): Segment[] {
  if (!text) return [];
  const segments: Segment[] = [];
  let lastIndex = 0;
  // 匹配闭合行内公式，避开 $$ 显示公式和未闭合的单 $
  const pattern = /(?<!\$)\$([^\$\n]+?)\$(?!\$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }
    segments.push({ type: "inline_math", content: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  return segments;
}

export function StreamingLightweightRenderer({
  content,
  color = colors.textPrimary,
  maxVisibleChars = STREAM_VISIBLE_CHARS,
}: {
  content: string;
  color?: string;
  maxVisibleChars?: number;
}) {
  const visibleContent = useMemo(() => {
    if (!content) return "";
    if (content.length <= maxVisibleChars) return content;
    return (
      content.slice(0, maxVisibleChars) + "\n\n…[内容较长，已截断显示]"
    );
  }, [content, maxVisibleChars]);

  const segments = useMemo(
    () => splitInlineMath(visibleContent),
    [visibleContent],
  );

  if (!content) return null;

  const children = segments.map((seg, i) => {
    if (seg.type === "text") {
      return (
        <Text key={`t-${i}`}>{softWrapLongTokens(seg.content)}</Text>
      );
    }
    try {
      return (
        <Text key={`im-${i}`} style={styles.inlineMath}>
          {softWrapLongTokens(simplifyLatex(seg.content))}
        </Text>
      );
    } catch {
      return (
        <Text key={`im-${i}`}>{softWrapLongTokens(seg.content)}</Text>
      );
    }
  });

  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minWidth: 0,
  },
  text: {
    fontSize: BODY_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
  },
  inlineMath: {
    fontFamily: "monospace",
    fontSize: BODY_FONT_SIZE,
    lineHeight: BODY_LINE_HEIGHT,
  },
});
