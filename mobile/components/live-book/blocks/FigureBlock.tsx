import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { MarkdownRenderer } from "../../MarkdownRenderer";
import { colors } from "../../../lib/theme";
import type { Block } from "../types";
import WebViewBlock, {
  wrapChartJsHtml,
  wrapMermaidHtml,
} from "./WebViewBlock";

interface FigureBlockProps {
  block: Block;
}

const SVG_WRAP = (content: string) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>*{margin:0;padding:0}body{background:transparent;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:8px}svg{max-width:100%!important;height:auto!important}</style></head><body>${content}</body></html>`;

export default function FigureBlock({ block }: FigureBlockProps) {
  const code =
    (block.payload?.code as { language?: string; content?: string } | undefined) ||
    {};
  const language = String(code.language || "svg");
  const content = String(code.content || "");
  const description = block.payload?.description
    ? String(block.payload.description)
    : "";
  const renderType = String(block.payload?.render_type || language);

  // 根据渲染类型构建 HTML
  const html = useMemo(() => {
    if (!content.trim()) return null;

    if (renderType === "mermaid" || language === "mermaid") {
      return wrapMermaidHtml(content);
    }
    if (renderType === "chartjs" || language === "chartjs" || language === "javascript") {
      return wrapChartJsHtml(content, "chart");
    }
    // SVG: 直接包裹
    return SVG_WRAP(content);
  }, [content, renderType, language]);

  if (!html) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>(Figure payload is empty)</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebViewBlock html={html} height={300} />
      {description ? (
        <View style={styles.caption}>
          <MarkdownRenderer content={description} color={colors.textMuted} />
        </View>
      ) : null}
    </View>
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
