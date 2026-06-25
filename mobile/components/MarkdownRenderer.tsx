// MarkdownRenderer — 自研轻量渲染器，基于 parseMarkdown + MathJax SVG
// 不依赖 react-native-markdown-display，避免与 React 19 / RN 0.85 的兼容性问题

import React, { useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import MathJax from "react-native-mathjax-svg";

import {
  parseMarkdown,
  normalizeStructuredTutorResponse,
  simplifyLatex,
  type MarkdownBlock,
} from "../lib/latex-utils";
import { colors } from "../lib/theme";

const BASE_FONT_SIZE = 15;
const BASE_LINE_HEIGHT = 23;
const SMALL_FONT_SIZE = 13;
const MATH_FONT_SIZE = 15;
const HEADING_SIZES: Record<number, number> = {
  1: 18,
  2: 17,
  3: 16,
  4: 15,
};

// ── 将教学语义行转换为 markdown 引用块格式 ──
const TEACHING_PATTERNS: Array<{ regex: RegExp; emoji: string }> = [
  { regex: /^(提示|Hint|思路|启发)[:：]/i, emoji: "💡" },
  { regex: /^(步骤|解题步骤|推导过程)[:：]/i, emoji: "👣" },
  { regex: /^(知识点|关键点|核心概念|概念)[:：]/i, emoji: "📚" },
  { regex: /^(错因分析|常见错误|易错点|误区|错因)[:：]/i, emoji: "⚠️" },
  { regex: /^(小测|练习|问题|自测)[:：]/i, emoji: "📝" },
  { regex: /^(学习状态|掌握情况)[:：]/i, emoji: "📊" },
  { regex: /^(下一步|接下来|建议)[:：]/i, emoji: "👉" },
];

function preprocessTeachingLines(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      for (const { regex, emoji } of TEACHING_PATTERNS) {
        const match = line.trim().match(regex);
        if (match) {
          const rest = line
            .slice(line.indexOf(match[0]) + match[0].length)
            .trim();
          return `> **${emoji} ${match[1]}：** ${rest}`;
        }
      }
      return line;
    })
    .join("\n");
}

// ── 代码块语法高亮 ──
const KEYWORDS: Record<string, string> = {
  const: "#c678dd",
  let: "#c678dd",
  var: "#c678dd",
  function: "#c678dd",
  return: "#c678dd",
  if: "#c678dd",
  else: "#c678dd",
  for: "#c678dd",
  while: "#c678dd",
  import: "#c678dd",
  from: "#c678dd",
  export: "#c678dd",
  default: "#c678dd",
  class: "#c678dd",
  extends: "#c678dd",
  new: "#c678dd",
  this: "#c678dd",
  super: "#c678dd",
  async: "#c678dd",
  await: "#c678dd",
  try: "#c678dd",
  catch: "#c678dd",
  throw: "#c678dd",
  typeof: "#c678dd",
  instanceof: "#c678dd",
  in: "#c678dd",
  of: "#c678dd",
  switch: "#c678dd",
  case: "#c678dd",
  break: "#c678dd",
  continue: "#c678dd",
  do: "#c678dd",
  yield: "#c678dd",
  delete: "#c678dd",
  void: "#c678dd",
  with: "#c678dd",
  finally: "#c678dd",
  def: "#c678dd",
  elif: "#c678dd",
  pass: "#c678dd",
  lambda: "#c678dd",
  global: "#c678dd",
  nonlocal: "#c678dd",
  assert: "#c678dd",
  raise: "#c678dd",
  as: "#c678dd",
  True: "#d19a66",
  False: "#d19a66",
  None: "#d19a66",
  print: "#61afef",
  console: "#61afef",
  log: "#61afef",
  len: "#61afef",
  range: "#61afef",
  type: "#61afef",
  int: "#61afef",
  str: "#61afef",
  float: "#61afef",
  list: "#61afef",
  dict: "#61afef",
  set: "#61afef",
  tuple: "#61afef",
  bool: "#61afef",
  map: "#61afef",
  filter: "#61afef",
  reduce: "#61afef",
  null: "#d19a66",
  undefined: "#d19a66",
  true: "#d19a66",
  false: "#d19a66",
  NaN: "#d19a66",
  Infinity: "#d19a66",
};

interface Token {
  text: string;
  color: string;
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const regex =
    /(#.*$|\/\/.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|\b[a-zA-Z_]\w*\b|[^\s\w]|[\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const text = match[0];
    if (text.startsWith("#") || text.startsWith("//")) {
      tokens.push({ text, color: "#5c6370" });
    } else if (
      text.startsWith('"') ||
      text.startsWith("'") ||
      text.startsWith("`")
    ) {
      tokens.push({ text, color: "#98c379" });
    } else if (/^\d/.test(text)) {
      tokens.push({ text, color: "#d19a66" });
    } else if (/^[a-zA-Z_]/.test(text)) {
      tokens.push({ text, color: KEYWORDS[text] || "#abb2bf" });
    } else {
      tokens.push({ text, color: "#abb2bf" });
    }
  }
  return tokens;
}

// ── 代码块渲染组件 ──
function FenceBlock({
  content,
  sourceInfo,
  blockKey,
}: {
  content: string;
  sourceInfo?: string;
  blockKey: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const lines: string[] = content.split("\n");

  const handleCopy = () => {
    try {
      const Clipboard = require("expo-clipboard");
      Clipboard.setStringAsync(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } catch {
      // fallback
    }
  };

  return (
    <View key={blockKey} style={fenceStyles.container}>
      <View style={fenceStyles.header}>
        <Text style={fenceStyles.langLabel}>{sourceInfo || "Code"}</Text>
        <TouchableOpacity onPress={handleCopy} style={fenceStyles.copyBtn}>
          <Ionicons
            name={copied ? "checkmark-circle" : "copy-outline"}
            size={14}
            color={copied ? colors.success : "#abb2bf"}
          />
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={fenceStyles.codeArea}>
          {lines.map((line, i) => (
            <View key={i} style={fenceStyles.lineRow}>
              <Text style={fenceStyles.lineNumber}>{i + 1}</Text>
              <Text style={fenceStyles.codeText}>
                {tokenizeLine(line).map((token, j) => (
                  <Text key={j} style={{ color: token.color }}>
                    {token.text}
                  </Text>
                ))}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const fenceStyles = StyleSheet.create({
  container: {
    backgroundColor: "#282c34",
    borderRadius: 8,
    marginVertical: 6,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#21252b",
  },
  langLabel: { color: "#5c6370", fontSize: 12, fontFamily: "monospace" },
  copyBtn: { padding: 4 },
  codeArea: {
    padding: 12,
    maxHeight: 300,
  },
  lineRow: { flexDirection: "row" },
  lineNumber: {
    color: "#4b5263",
    fontSize: 13,
    fontFamily: "monospace",
    width: 28,
    textAlign: "right",
    marginRight: 12,
  },
  codeText: {
    color: "#abb2bf",
    fontSize: 13,
    fontFamily: "monospace",
    flexShrink: 1,
  },
});

// ── 行内元素正则 ──
const INLINE_RE =
  /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\$\$[^$]+\$\$|\$[^$]+\$|\\\((?:[^\\]|\\(?!\)))*\\\)|\\\[(?:[^\\]|\\(?!\]))*\\\])/g;

function isMathToken(token: string): boolean {
  return (
    (token.startsWith("$$") && token.endsWith("$$")) ||
    (token.startsWith("$") && token.endsWith("$")) ||
    (token.startsWith("\\(") && token.endsWith("\\)")) ||
    (token.startsWith("\\[") && token.endsWith("\\]"))
  );
}

function unwrapMathToken(token: string): string {
  if (token.startsWith("$$") && token.endsWith("$$")) return token.slice(2, -2).trim();
  if (token.startsWith("$") && token.endsWith("$")) return token.slice(1, -1).trim();
  if (token.startsWith("\\(") && token.endsWith("\\)")) return token.slice(2, -2).trim();
  if (token.startsWith("\\[") && token.endsWith("\\]")) return token.slice(2, -2).trim();
  return token;
}

function InlineMath({
  formula,
  color,
  blockKey,
}: {
  formula: string;
  color: string;
  blockKey: string;
}) {
  return (
    <ScrollView
      key={blockKey}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={styles.inlineMathScroll}
      contentContainerStyle={styles.inlineMathContent}
    >
      <MathJax
        style={styles.latexInline as any}
        fontSize={MATH_FONT_SIZE}
        color={color}
      >
        {formula}
      </MathJax>
    </ScrollView>
  );
}

/** 行内渲染：粗体、斜体、行内代码、链接、行内 LaTeX */
function renderInlineNodes(
  text: string,
  color: string,
  keyPrefix: string,
  textStyle?: StyleProp<TextStyle>,
  renderMath = true,
) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    // 匹配前的普通文本
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`${keyPrefix}-t${idx++}`} style={[styles.inlineText, textStyle, { color }]}>
          {text.slice(lastIndex, match.index)}
        </Text>,
      );
    }

    const token = match[0];

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <Text
          key={`${keyPrefix}-b${idx++}`}
          style={[styles.inlineText, textStyle, { color, fontWeight: "700" }]}
        >
          {token.slice(2, -2)}
        </Text>,
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(
        <Text
          key={`${keyPrefix}-i${idx++}`}
          style={[styles.inlineText, textStyle, { color, fontStyle: "italic" }]}
        >
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <Text
          key={`${keyPrefix}-c${idx++}`}
          style={styles.inlineCode}
        >
          {token.slice(1, -1)}
        </Text>,
      );
    } else if (token.startsWith("[")) {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        parts.push(
          <Text
            key={`${keyPrefix}-l${idx++}`}
            style={[styles.link, { color: colors.primary }]}
            onPress={() => Linking.openURL(m[2]).catch(() => {})}
          >
            {m[1]}
          </Text>,
        );
      }
    } else if (isMathToken(token)) {
      if (!renderMath) {
        parts.push(
          <Text key={`${keyPrefix}-mtext${idx++}`} style={[styles.inlineText, textStyle, { color }]}>
            {token}
          </Text>,
        );
        lastIndex = match.index + token.length;
        continue;
      }
      parts.push(
        <InlineMath
          key={`${keyPrefix}-m${idx}`}
          blockKey={`${keyPrefix}-m${idx++}`}
          formula={unwrapMathToken(token)}
          color={color}
        />,
      );
    }

    lastIndex = match.index + token.length;
  }

  // 尾部文本
  if (lastIndex < text.length) {
    parts.push(
      <Text key={`${keyPrefix}-t${idx++}`} style={[styles.inlineText, textStyle, { color }]}>
        {text.slice(lastIndex)}
      </Text>,
    );
  }

  return parts.length > 0
    ? parts
    : [
        <Text key={`${keyPrefix}-0`} style={[styles.inlineText, textStyle, { color }]}>
          {text}
        </Text>,
      ];
}

function InlineFlow({
  text,
  color,
  blockKey,
  style,
  textStyle,
  renderMath = true,
}: {
  text: string;
  color: string;
  blockKey: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  renderMath?: boolean;
}) {
  return (
    <View style={[styles.inlineFlow, style]}>
      {renderInlineNodes(text, color, blockKey, textStyle, renderMath)}
    </View>
  );
}

// ── 教学引用块样式映射 ──
const TEACHING_BG: Record<string, string> = {
  hint: "#fff8e1",
  steps: "#e8f5e9",
  knowledge: "#e3f2fd",
  mistake: "#fce4ec",
  quiz: "#f3e5f5",
  learning: "#e0f7fa",
  next: "#fff3e0",
};

const TEACHING_BORDER: Record<string, string> = {
  hint: "#ffc107",
  steps: "#4caf50",
  knowledge: "#2196f3",
  mistake: "#e91e63",
  quiz: "#9c27b0",
  learning: "#00bcd4",
  next: "#ff9800",
};

// ── 单个 Block 渲染 ──
function BlockRenderer({
  block,
  index,
  color,
  renderMath,
}: {
  block: MarkdownBlock;
  index: number;
  color: string;
  renderMath: boolean;
}) {
  const key = `block-${index}`;

  switch (block.type) {
    case "empty":
      return <View key={key} style={{ height: 8 }} />;

    case "heading": {
      const level = block.level || 1;
      const fontSize = HEADING_SIZES[level] || HEADING_SIZES[4];
      return (
        <View key={key} style={styles.heading}>
          <InlineFlow
            text={block.content}
            color={color}
            blockKey={key}
            style={{ minHeight: Math.ceil(fontSize * 1.4) }}
            textStyle={{
              fontSize,
              lineHeight: Math.ceil(fontSize * 1.38),
              fontWeight: "700",
            }}
            renderMath={renderMath}
          />
        </View>
      );
    }

    case "code":
      return (
        <FenceBlock
          key={key}
          blockKey={key}
          content={block.content}
          sourceInfo={block.language}
        />
      );

    case "latex_display":
      if (!renderMath) {
        return (
          <ScrollView
            key={key}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            style={styles.latexBlock}
            contentContainerStyle={styles.streamingFormulaContent}
          >
            <Text style={[styles.inlineText, styles.streamingFormulaText, { color }]}>
              {block.content}
            </Text>
          </ScrollView>
        );
      }
      return (
        <View key={key} style={styles.latexBlock}>
          <ScrollView
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.latexBlockContent}
          >
            <MathJax
              style={styles.latexBlockInner as any}
              color={color}
              fontSize={MATH_FONT_SIZE}
            >
              {block.content}
            </MathJax>
          </ScrollView>
        </View>
      );

    case "list":
    case "ordered_list": {
      const isOrdered = block.type === "ordered_list";
      const indent = (block.level || 0) * 16;
      return (
        <View key={key} style={[styles.listItem, { marginLeft: 12 + indent }]}>
          <Text style={styles.listMarker}>
            {isOrdered ? `${block.order ?? 1}.` : "•"}
          </Text>
          <View style={styles.listContent}>
            <InlineFlow
              text={block.content}
              color={color}
              blockKey={key}
              renderMath={renderMath}
            />
          </View>
        </View>
      );
    }

    case "blockquote":
      return (
        <View key={key} style={styles.blockquote}>
          <InlineFlow
            text={block.content}
            color={colors.textSecondary}
            blockKey={key}
            renderMath={renderMath}
          />
        </View>
      );

    case "teaching": {
      const kind = block.teachingKind || "hint";
      return (
        <View
          key={key}
          style={[
            styles.teaching,
            {
              backgroundColor: TEACHING_BG[kind] || TEACHING_BG.hint,
              borderLeftColor: TEACHING_BORDER[kind] || TEACHING_BORDER.hint,
            },
          ]}
        >
          {block.title ? (
            <Text style={[styles.teachingTitle, { color: TEACHING_BORDER[kind] || colors.textPrimary }]}>
              {block.title}
            </Text>
          ) : null}
          <InlineFlow
            text={block.content}
            color={color}
            blockKey={key}
            renderMath={renderMath}
          />
        </View>
      );
    }

    case "hr":
      return <View key={key} style={styles.hr} />;

    case "table": {
      const headers = block.headers || [];
      const rows = block.rows || [];
      return (
        <View key={key} style={styles.table}>
          <View style={styles.tableRow}>
            {headers.map((h, ci) => (
              <View key={ci} style={styles.tableCell}>
                <Text style={{ fontWeight: "600", color }}>
                  {h.trim()}
                </Text>
              </View>
            ))}
          </View>
          {rows.map((row, ri) => (
            <View
              key={ri}
              style={[
                styles.tableRow,
                { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
              ]}
            >
              {row.map((cell, ci) => (
                <View key={ci} style={styles.tableCell}>
                  <Text style={{ color }}>
                    {cell.trim()}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
    }

    case "paragraph":
    default:
      return (
        <View key={key} style={styles.paragraph}>
          <InlineFlow
            text={block.content}
            color={color}
            blockKey={key}
            renderMath={renderMath}
          />
        </View>
      );
  }
}

// ── 主组件 Props ──
interface MarkdownRendererProps {
  content: string;
  color?: string;
  isStreaming?: boolean;
}

export const MarkdownRenderer = React.memo(function MarkdownRenderer({
  content,
  color = colors.textPrimary,
  isStreaming = false,
}: MarkdownRendererProps) {
  // 预处理：结构化 tutor 响应 + 教学语义行
  const normalized = preprocessTeachingLines(
    normalizeStructuredTutorResponse(content),
  );

  // 解析为 Block 数组（useMemo 稳定引用）
  const blocks = useMemo(
    () => parseMarkdown(normalized, isStreaming),
    [normalized, isStreaming],
  );

  if (!normalized || blocks.length === 0) return null;
  const renderMath = !isStreaming;

  return (
    <View style={styles.root}>
      {blocks.map((block, i) => (
        <BlockRenderer
          key={i}
          block={block}
          index={i}
          color={color}
          renderMath={renderMath}
        />
      ))}
    </View>
  );
});

// ── 样式 ──
const styles = StyleSheet.create({
  root: {
    width: "100%",
  },
  heading: {
    marginTop: 10,
    marginBottom: 6,
  },
  paragraph: {
    marginVertical: 3,
  },
  inlineFlow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    width: "100%",
    rowGap: 2,
  },
  inlineText: {
    fontSize: BASE_FONT_SIZE,
    lineHeight: BASE_LINE_HEIGHT,
    color: colors.textPrimary,
  },
  paragraphText: {
    fontSize: BASE_FONT_SIZE,
    lineHeight: BASE_LINE_HEIGHT,
  },
  inlineCode: {
    backgroundColor: colors.bgInput,
    color: colors.error,
    fontFamily: "monospace",
    fontSize: SMALL_FONT_SIZE,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  link: {
    color: colors.primary,
    textDecorationLine: "underline",
    fontSize: BASE_FONT_SIZE,
    lineHeight: BASE_LINE_HEIGHT,
  },
  blockquote: {
    backgroundColor: colors.quoteBg,
    borderLeftColor: colors.quoteBorder,
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 6,
    borderRadius: 4,
  },
  teaching: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 6,
    marginVertical: 6,
    borderRadius: 4,
  },
  teachingTitle: {
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 2,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginVertical: 3,
  },
  listMarker: {
    width: 20,
    color: colors.textSecondary,
    fontSize: BASE_FONT_SIZE,
    lineHeight: BASE_LINE_HEIGHT,
  },
  listContent: {
    flex: 1,
    minWidth: 0,
  },
  hr: {
    backgroundColor: colors.divider,
    height: 1,
    marginVertical: 10,
  },
  latexBlock: {
    marginTop: 8,
    marginBottom: 6,
    maxWidth: "100%",
  },
  latexBlockInner: {
    color: colors.textPrimary,
  },
  latexBlockContent: {
    minHeight: 34,
    alignItems: "center",
    paddingVertical: 4,
    paddingRight: 8,
  },
  streamingFormulaContent: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  streamingFormulaText: {
    fontFamily: "monospace",
  },
  inlineMathScroll: {
    maxWidth: "100%",
    marginHorizontal: 1,
  },
  inlineMathContent: {
    minHeight: BASE_LINE_HEIGHT,
    alignItems: "center",
    paddingHorizontal: 1,
  },
  latexInline: {
    color: colors.textPrimary,
    fontSize: MATH_FONT_SIZE,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    marginVertical: 6,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
  },
  tableCell: {
    flex: 1,
    padding: 8,
  },
});

export default MarkdownRenderer;
