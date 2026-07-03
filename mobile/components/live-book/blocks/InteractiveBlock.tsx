import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { RenderDebugBoundary } from "../../RenderDebugBoundary";
import { colors } from "../../../lib/theme";
import type { Block } from "../types";
import WebViewBlock from "./WebViewBlock";

interface InteractiveBlockProps {
  block: Block;
}

const WRAP_HTML = (content: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=yes">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: transparent;
    color-scheme: light dark;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 8px;
  }
</style>
</head>
<body>
${content}
</body>
</html>`;

export default function InteractiveBlock({ block }: InteractiveBlockProps) {
  const code =
    (block.payload?.code as { language?: string; content?: string } | undefined) ||
    {};
  const content = String(code.content || "");
  const description = block.payload?.description
    ? String(block.payload.description)
    : "";

  const html = useMemo(() => {
    if (!content.trim()) return null;
    return WRAP_HTML(content);
  }, [content]);

  if (!html) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>(Interactive payload is empty)</Text>
      </View>
    );
  }

  return (
    <RenderDebugBoundary
      name="InteractiveBlock"
      meta={{ contentLength: content.length }}
      fallback={
        <View style={styles.container}>
          <View style={[styles.emptyWrap, { height: 120, justifyContent: "center" }]}>
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              交互组件加载失败
            </Text>
          </View>
          {description ? (
            <View style={styles.caption}>
              <MarkdownRenderer content={description} color={colors.textMuted} />
            </View>
          ) : null}
        </View>
      }
    >
      <View style={styles.container}>
        <WebViewBlock html={html} height={380} />
        {description ? (
          <View style={styles.caption}>
            <MarkdownRenderer content={description} color={colors.textMuted} />
          </View>
        ) : null}
      </View>
    </RenderDebugBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
  },
  emptyWrap: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    backgroundColor: colors.bgCard + "66",
    padding: 16,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: "italic",
  },
  caption: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
});
