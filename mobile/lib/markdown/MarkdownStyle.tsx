// Markdown 渲染样式和规则配置
// 基于 ChatterUI 的架构，适配 AnotherMe 项目

import { useMemo } from "react";
import { Platform, StyleSheet } from "react-native";
import { MarkdownIt } from "react-native-markdown-display";
import MathJax from "react-native-mathjax-svg";

import { colors } from "../theme";
import latexPlugin from "./MarkdownLatexPlugin";

// ── markdown-it 实例（带 LaTeX 插件） ──
const mdIt = MarkdownIt({ typographer: true }).use(latexPlugin);

// ── 自定义渲染规则 ──
export const RenderRules: Record<string, any> = {
  // LaTeX 块级公式
  latex_block: (node: any) => {
    const { content } = node;
    return (
      <MathJax
        key={node.key}
        style={defaultStyles.latex_block as any}
        color={(defaultStyles.latex_block as any).color ?? colors.textPrimary}
      >
        {content}
      </MathJax>
    );
  },
  // LaTeX 行内公式（Android 上 SVG 在 Text 内需显式设置行高避免重叠）
  latex_inline: (node: any) => {
    const { content } = node;
    return (
      <MathJax
        key={node.key}
        style={defaultStyles.latex_inline as any}
        color={(defaultStyles.latex_inline as any).color ?? colors.textPrimary}
        // 禁止 SVG 内部的字体缩放，匹配外层文本大小
        fontSize={15}
      >
        {content}
      </MathJax>
    );
  },
};

// ── 默认样式 ──
const defaultStyles = StyleSheet.create({
  // body 是最外层容器，必须设置 flex 以配合 flexWrap 正确计算高度
  body: { flexShrink: 1 },

  heading1: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 6,
  },
  heading2: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 10,
    marginBottom: 4,
  },
  heading3: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 8,
    marginBottom: 4,
  },
  heading4: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 6,
    marginBottom: 3,
  },
  heading5: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 4,
    marginBottom: 2,
  },
  heading6: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 4,
    marginBottom: 2,
  },

  hr: { backgroundColor: colors.divider, height: 1, marginVertical: 10 },

  strong: { fontWeight: "700", color: colors.textPrimary },
  em: { fontStyle: "italic", color: colors.textSecondary },
  s: { textDecorationLine: "line-through", color: colors.textMuted },

  blockquote: {
    backgroundColor: colors.quoteBg,
    borderLeftColor: colors.quoteBorder,
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 6,
    borderRadius: 4,
  },

  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: {
    flexDirection: "row",
    justifyContent: "flex-start",
    color: colors.textPrimary,
  },
  bullet_list_icon: { color: colors.textSecondary, marginLeft: 8, marginRight: 8 },
  bullet_list_content: { flex: 1 },
  ordered_list_icon: { color: colors.textSecondary, marginLeft: 8, marginRight: 8 },
  ordered_list_content: { flex: 1 },

  code_inline: {
    backgroundColor: colors.bgInput,
    color: colors.error,
    fontFamily: "monospace",
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  code_block: {
    color: colors.codeText,
    backgroundColor: colors.codeBg,
    padding: 12,
    borderRadius: 8,
    ...Platform.select({
      ios: { fontFamily: "Courier" },
      android: { fontFamily: "monospace" },
    }),
  },
  fence: {
    color: colors.codeText,
    backgroundColor: colors.codeBg,
    padding: 12,
    borderRadius: 8,
    marginVertical: 6,
    overflow: "hidden",
    ...Platform.select({
      ios: { fontFamily: "Courier" },
      android: { fontFamily: "monospace" },
    }),
  },

  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    marginVertical: 6,
    overflow: "hidden",
  },
  thead: { backgroundColor: colors.bgInput },
  tbody: {},
  th: { flex: 1, padding: 8, fontWeight: "600" },
  tr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    flexDirection: "row",
  },
  td: { flex: 1, padding: 8 },

  link: {
    color: colors.primary,
    textDecorationLine: "underline",
  },

  text: { fontSize: 15 },
  textgroup: { color: colors.textPrimary, fontSize: 15, lineHeight: 22 },

  paragraph: {
    flexWrap: "wrap",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    width: "100%",
    color: colors.textPrimary,
    marginVertical: 4,
  },

  latex_inline: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  latex_block: {
    color: colors.textPrimary,
    marginTop: 8,
    marginBottom: 4,
  },

  hardbreak: { width: "100%", height: 1, color: colors.textPrimary },
  softbreak: {},

  // 以下样式对防止文字重叠至关重要
  pre: {},
  inline: { fontSize: 15, lineHeight: 22 },
  span: { fontSize: 15, lineHeight: 22 },
});

// ── 导出 hook 供组件使用 ──
export function useMarkdownConfig() {
  return useMemo(
    () => ({
      markdownit: mdIt,
      rules: RenderRules,
      style: defaultStyles,
    }),
    [],
  );
}
