// MarkdownRenderer 纯逻辑提取，方便在 Node 环境下做单元测试。
// 注意：这里只放与 React / React Native 渲染无关的纯函数和常量。

import {
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
  HEADING_SIZES,
  SMALL_FONT_SIZE,
  SMALL_LINE_HEIGHT,
} from "../components/message-renderers/rendererTokens";

// ── 将教学语义行转换为 markdown 引用块格式 ──
export const TEACHING_PATTERNS: Array<{ regex: RegExp; emoji: string }> = [
  { regex: /^(提示|Hint|思路|启发)[:：]/i, emoji: "💡" },
  { regex: /^(步骤|解题步骤|推导过程)[:：]/i, emoji: "👣" },
  { regex: /^(知识点|关键点|核心概念|概念)[:：]/i, emoji: "📚" },
  { regex: /^(错因分析|常见错误|易错点|误区|错因)[:：]/i, emoji: "⚠️" },
  { regex: /^(小测|练习|问题|自测)[:：]/i, emoji: "📝" },
  { regex: /^(学习状态|掌握情况)[:：]/i, emoji: "📊" },
  { regex: /^(下一步|接下来|建议)[:：]/i, emoji: "👉" },
];

export function preprocessTeachingLines(text: string): string {
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
export const KEYWORDS: Record<string, string> = {
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

export interface Token {
  text: string;
  color: string;
}

export function tokenizeLine(line: string): Token[] {
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

// ── 行内元素正则 ──
export const LONG_TOKEN_RE_FINAL = /([^\s]{20})(?=[^\s])/g;
export const SOFT_WRAP_FINAL = String.fromCharCode(0x200b);

export function softWrapLongTokens(text: string): string {
  return text.replace(LONG_TOKEN_RE_FINAL, `$1${SOFT_WRAP_FINAL}`);
}

// ── 表格列宽计算 ──
export const DEFAULT_TABLE_CELL_WIDTH = 80;
export const MAX_TABLE_CELL_WIDTH = 240;
export const TABLE_CHAR_WIDTH = 8;
export const TABLE_CELL_PADDING = 20;

export function estimateTableCellWidth(text: string): number {
  if (!text) return DEFAULT_TABLE_CELL_WIDTH;
  let charCount = 0;
  for (const char of text) {
    charCount += char.charCodeAt(0) > 127 ? 1.5 : 1;
  }
  return Math.min(
    Math.max(charCount * TABLE_CHAR_WIDTH + TABLE_CELL_PADDING, DEFAULT_TABLE_CELL_WIDTH),
    MAX_TABLE_CELL_WIDTH,
  );
}

export function calculateTableColumnWidths(
  headers: string[],
  rows: string[][],
): number[] {
  const colCount = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  const widths: number[] = [];
  for (let i = 0; i < colCount; i++) {
    const headerWidth = estimateTableCellWidth(headers[i]?.trim() ?? "");
    const maxRowWidth = rows.reduce((max, row) => {
      return Math.max(max, estimateTableCellWidth(row[i]?.trim() ?? ""));
    }, 0);
    widths.push(Math.max(headerWidth, maxRowWidth));
  }
  return widths;
}

// 段落中无空格连续字符超过此阈值时，降级为 flex row wrap 布局
export const FLEX_WRAP_TOKEN_THRESHOLD = 50;

export function hasLongUnbreakableToken(text: string): boolean {
  for (const token of text.split(/\s+/)) {
    if (token.length > FLEX_WRAP_TOKEN_THRESHOLD) {
      return true;
    }
  }
  return false;
}

export const INLINE_RE =
  /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|\$\$[^$]{1,500}\$\$|\$[^$]{1,200}\$|\\\((?:[^\\]|\\(?!\))){1,300}\\\)|\\\[(?:[^\\]|\\(?!\])){1,800}\\\]|\\[a-zA-Z]+(?:\{[^{}]*\})*|[a-zA-Z0-9]\^(?:\{[^{}]*\}|[a-zA-Z0-9])|[a-zA-Z0-9]_(?:\{[^{}]*\}|[a-zA-Z0-9]))/g;

export function isMathToken(token: string): boolean {
  return (
    (token.startsWith("$$") && token.endsWith("$$")) ||
    (token.startsWith("$") && token.endsWith("$")) ||
    (token.startsWith("\\(") && token.endsWith("\\)")) ||
    (token.startsWith("\\[") && token.endsWith("\\]")) ||
    (token.startsWith("\\") &&
      !token.startsWith("\\(") &&
      !token.startsWith("\\[")) ||
    /[a-zA-Z0-9][\^_]/.test(token)
  );
}

export function unwrapMathToken(token: string): string {
  if (token.startsWith("$$") && token.endsWith("$$"))
    return token.slice(2, -2).trim();
  if (token.startsWith("$") && token.endsWith("$"))
    return token.slice(1, -1).trim();
  if (token.startsWith("\\(") && token.endsWith("\\)"))
    return token.slice(2, -2).trim();
  if (token.startsWith("\\[") && token.endsWith("\\]"))
    return token.slice(2, -2).trim();
  return token;
}

// 复用 rendererTokens 中的基础字号，便于在测试中验证常量
export {
  BODY_FONT_SIZE,
  BODY_LINE_HEIGHT,
  HEADING_SIZES,
  SMALL_FONT_SIZE,
  SMALL_LINE_HEIGHT,
};
