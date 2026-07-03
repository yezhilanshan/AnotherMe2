import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "../../lib/theme";
import { BODY_FONT_SIZE, BODY_LINE_HEIGHT } from "./rendererTokens";

const STREAM_VISIBLE_CHARS = 4000;
const LONG_TOKEN_RE = /([^\s]{20})(?=[^\s])/g;
const SOFT_WRAP = String.fromCharCode(0x200b);

function softWrapLongTokens(text: string): string {
  return text.replace(LONG_TOKEN_RE, `$1${SOFT_WRAP}`);
}

export function StreamingMathRenderer({
  content,
  color = colors.textPrimary,
  maxVisibleChars = STREAM_VISIBLE_CHARS,
  showFromStart = false,
}: {
  content: string;
  color?: string;
  maxVisibleChars?: number;
  showFromStart?: boolean;
}) {
  const visibleContent = useMemo(() => {
    if (!content) return "";
    if (content.length <= maxVisibleChars) return content;
    if (showFromStart) {
      return content.slice(0, maxVisibleChars) + "\n\n...[内容较长，已截断显示]";
    }
    return `...\n${content.slice(content.length - maxVisibleChars)}`;
  }, [content, maxVisibleChars, showFromStart]);

  if (!visibleContent) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color }]}>
        {softWrapLongTokens(visibleContent)}
      </Text>
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
});
