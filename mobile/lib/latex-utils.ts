import { sanitizeIncompleteMarkdown } from "./incomplete-markdown";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { debugLog } from "./debug";

// ============================================================
// LaTeX → Unicode 工具函数（纯函数，无 React 依赖，可独立测试）
// ============================================================

const SIMPLIFY_LATEX_CACHE = new Map<string, string>();
const SIMPLIFY_LATEX_CACHE_LIMIT = 200;

function getCachedSimplifyLatex(formula: string): string | undefined {
  return SIMPLIFY_LATEX_CACHE.get(formula);
}

function setCachedSimplifyLatex(formula: string, result: string): void {
  if (SIMPLIFY_LATEX_CACHE.size >= SIMPLIFY_LATEX_CACHE_LIMIT) {
    const firstKey = SIMPLIFY_LATEX_CACHE.keys().next().value;
    if (firstKey !== undefined) {
      SIMPLIFY_LATEX_CACHE.delete(firstKey);
    }
  }
  SIMPLIFY_LATEX_CACHE.set(formula, result);
}

const LATEX_UNICODE: Record<string, string> = {
  // 希腊字母
  alpha: "α",
  beta: "β",
  gamma: "γ",
  Gamma: "Γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  Theta: "Θ",
  vartheta: "ϑ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  Lambda: "Λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  Xi: "Ξ",
  pi: "π",
  Pi: "Π",
  varpi: "ϖ",
  rho: "ρ",
  varrho: "ϱ",
  sigma: "σ",
  Sigma: "Σ",
  varsigma: "ς",
  tau: "τ",
  upsilon: "υ",
  Upsilon: "Υ",
  phi: "φ",
  Phi: "Φ",
  varphi: "ϕ",
  chi: "χ",
  psi: "ψ",
  Psi: "Ψ",
  omega: "ω",
  Omega: "Ω",
  // 运算符 / 关系符
  times: "×",
  div: "÷",
  cdot: "·",
  pm: "±",
  mp: "∓",
  circ: "°",
  leq: "≤",
  geq: "≥",
  neq: "≠",
  approx: "≈",
  equiv: "≡",
  sim: "∼",
  propto: "∝",
  ll: "≪",
  gg: "≫",
  simeq: "≃",
  // 箭头
  to: "→",
  rightarrow: "→",
  Rightarrow: "⇒",
  longrightarrow: "⟶",
  leftarrow: "←",
  Leftarrow: "⇐",
  longleftarrow: "⟵",
  leftrightarrow: "↔",
  Leftrightarrow: "⇔",
  implies: "⇒",
  iff: "⇔",
  uparrow: "↑",
  downarrow: "↓",
  mapsto: "↦",
  // 大型运算符
  sum: "∑",
  prod: "∏",
  int: "∫",
  oint: "∮",
  coprod: "∐",
  bigcup: "⋃",
  bigcap: "⋂",
  bigvee: "⋁",
  bigwedge: "⋀",
  // 集合 / 逻辑
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  emptyset: "∅",
  exists: "∃",
  forall: "∀",
  neg: "¬",
  in: "∈",
  notin: "∉",
  ni: "∋",
  subset: "⊂",
  supset: "⊃",
  subseteq: "⊆",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  setminus: "∖",
  complement: "∁",
  // 杂项
  perp: "⊥",
  parallel: "∥",
  angle: "∠",
  triangle: "△",
  square: "□",
  diamond: "◇",
  cdots: "⋯",
  vdots: "⋮",
  ddots: "⋱",
  ldots: "…",
  hbar: "ℏ",
  ell: "ℓ",
  aleph: "ℵ",
  wp: "℘",
  Re: "ℜ",
  Im: "ℑ",
  prime: "′",
};

/** 将字符串转为上标 Unicode */
export function superscript(s: string): string {
  const map: Record<string, string> = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹",
    "+": "⁺",
    "-": "⁻",
    "=": "⁼",
    "(": "⁽",
    ")": "⁾",
    n: "ⁿ",
    i: "ⁱ",
    // Extended superscript letters
    a: "ᵃ",
    b: "ᵇ",
    c: "ᶜ",
    d: "ᵈ",
    e: "ᵉ",
    f: "ᶠ",
    g: "ᵍ",
    h: "ʰ",
    j: "ʲ",
    k: "ᵏ",
    l: "ˡ",
    m: "ᵐ",
    o: "ᵒ",
    p: "ᵖ",
    r: "ʳ",
    s: "ˢ",
    t: "ᵗ",
    u: "ᵘ",
    v: "ᵛ",
    w: "ʷ",
    x: "ˣ",
    y: "ʸ",
    z: "ᶻ",
    A: "ᴬ",
    B: "ᴮ",
    D: "ᴰ",
    E: "ᴱ",
    G: "ᴳ",
    H: "ᴴ",
    I: "ᴵ",
    J: "ᴶ",
    K: "ᴷ",
    L: "ᴸ",
    M: "ᴹ",
    N: "ᴺ",
    O: "ᴼ",
    P: "ᴾ",
    R: "ᴿ",
    T: "ᵀ",
    U: "ᵁ",
    V: "ⱽ",
    W: "ᵂ",
  };
  return [...s].map((c) => map[c] || c).join("");
}

/** 将字符串转为下标 Unicode */
export function subscript(s: string): string {
  const map: Record<string, string> = {
    "0": "₀",
    "1": "₁",
    "2": "₂",
    "3": "₃",
    "4": "₄",
    "5": "₅",
    "6": "₆",
    "7": "₇",
    "8": "₈",
    "9": "₉",
    "+": "₊",
    "-": "₋",
    "=": "₌",
    "(": "₍",
    ")": "₎",
    a: "ₐ",
    e: "ₑ",
    h: "ₕ",
    i: "ᵢ",
    j: "ⱼ",
    k: "ₖ",
    l: "ₗ",
    m: "ₘ",
    n: "ₙ",
    o: "ₒ",
    p: "ₚ",
    r: "ᵣ",
    s: "ₛ",
    t: "ₜ",
    u: "ᵤ",
    v: "ᵥ",
    x: "ₓ",
  };
  return [...s].map((c) => map[c] || c).join("");
}

/**
 * 简化 LaTeX 公式字符串：常用命令 → Unicode 符号
 */
export function simplifyLatex(formula: string): string {
  const cached = getCachedSimplifyLatex(formula);
  if (cached !== undefined) return cached;

  // 辅助：从 pos 位置开始匹配平衡花括号 {...}，返回内容和结束位置
  function matchBrace(s: string, pos: number): [string, number] | null {
    if (pos >= s.length || s[pos] !== "{") return null;
    let depth = 0;
    const start = pos + 1;
    for (let i = pos; i < s.length; i++) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") {
        depth--;
        if (depth === 0) return [s.slice(start, i), i + 1];
      }
    }
    return null;
  }

  // 辅助：扫描字符串，替换 \cmd{...}{...} 等模式（平衡花括号匹配）
  // 从 prefix 之后开始查找 { 并匹配平衡花括号
  function replacePattern(
    s: string,
    prefix: string,
    paramCount: number,
    handler: (...groups: string[]) => string,
  ): string {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const idx = s.indexOf(prefix, i);
      if (idx === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, idx);
      let pos = idx + prefix.length;
      const groups: string[] = [];
      let ok = true;
      for (let b = 0; b < paramCount; b++) {
        // 找到下一个 { 并匹配平衡花括号
        const bracePos = s.indexOf("{", pos);
        if (bracePos === -1) { ok = false; break; }
        const result = matchBrace(s, bracePos);
        if (!result) { ok = false; break; }
        groups.push(result[0]);
        pos = result[1];
      }
      if (ok) {
        out += handler(...groups);
        i = pos;
      } else {
        out += prefix;
        i = idx + prefix.length;
      }
    }
    return out;
  }

  let result = formula
    // 先将 JSON 转义的双反斜杠还原为单反斜杠
    .replace(/\\\\/g, "\\")
    // \mathbb{...} / \mathcal{...} / \mathbf{...} ... → 保留内容
    .replace(
      /\\(?:mathbb|mathcal|mathbf|mathit|mathrm|mathfrak|mathsf|mathtt)\{([^{}]*)\}/g,
      "$1",
    )
    // \vec{AB} / \overrightarrow{AB} → →AB
    .replace(/\\(?:vec|overrightarrow)\{([^{}]*)\}/g, "→$1")
    // \text{...} / \textrm{...} → 保留文字内容
    .replace(/\\(?:text|textrm)\{([^{}]*)\}/g, "$1");

  // Pass 1: superscripts/subscripts（先展平嵌套，让后续 \frac 更容易匹配）
  const resolveInner = (s: string) =>
    s.replace(/\\([a-zA-Z]+)/g, (_, cmd: string) => LATEX_UNICODE[cmd] || cmd);

  result = result
    .replace(/\^{([^{}]*)}/g, (_, inner: string) =>
      superscript(resolveInner(inner)),
    )
    .replace(/_{([^{}]*)}/g, (_, inner: string) =>
      subscript(resolveInner(inner)),
    )
    // 单字符上下标（无花括号）
    .replace(
      /([^\s^_])\^([a-zA-Z0-9])/g,
      (_, base: string, exp: string) => base + superscript(exp),
    )
    .replace(
      /([^\s^_])_([a-zA-Z0-9])/g,
      (_, base: string, sub: string) => base + subscript(sub),
    );

  // Pass 2: \frac — 用平衡花括号匹配，避免正则嵌套量词导致的灾难性回溯
  result = replacePattern(result, "\\frac", 2, (num, den) =>
    `(${num})/(${den})`,
  );
  // \sqrt 用简单正则即可（单花括号组无嵌套量词问题）
  result = result
    .replace(
      /\\sqrt\[([^\]]+)\]\{([^{}]*)\}/g,
      (_, idx: string, inner: string) => superscript(idx) + "√(" + inner + ")",
    )
    .replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");

  // Pass 3: LaTeX 符号 → Unicode（必须在 \frac/\sqrt 之后，确保它们不被吃掉）
  result = result.replace(
    /\\([a-zA-Z]+)/g,
    (_, cmd: string) => LATEX_UNICODE[cmd] || cmd,
  );

  // 清理残留花括号
  result = result.replace(/[{}]/g, "").trim();
  const finalResult = result || formula;
  setCachedSimplifyLatex(formula, finalResult);
  return finalResult;
}

// ============================================================
// 结构化内容规范化
// ============================================================

export function normalizeStructuredContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === "string" ? `- ${item}` : `- ${String(item)}`,
      )
      .join("\n")
      .trim();
  }
  if (value == null) return "";
  return String(value).trim();
}

export function normalizeStructuredTutorResponse(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return text;

  try {
    const payload = JSON.parse(trimmed) as unknown;
    const rawBlocks = Array.isArray(payload)
      ? payload
      : payload &&
          typeof payload === "object" &&
          Array.isArray((payload as Record<string, unknown>).blocks)
        ? ((payload as Record<string, unknown>).blocks as unknown[])
        : null;

    if (!rawBlocks) return text;

    const parts = rawBlocks
      .map((rawBlock) => {
        if (!rawBlock || typeof rawBlock !== "object") return "";
        const block = rawBlock as Record<string, unknown>;
        const rawType =
          typeof block.type === "string" ? block.type : "markdown";
        const type =
          rawType === "text"
            ? "markdown"
            : rawType === "knowledge_card"
              ? "knowledge"
              : rawType;
        const title = typeof block.title === "string" ? block.title.trim() : "";

        if (type === "markdown") {
          return normalizeStructuredContent(block.content ?? block.text);
        }

        const contentParts: string[] = [];
        const content = normalizeStructuredContent(block.content ?? block.text);
        if (content) contentParts.push(content);

        if (type === "quiz") {
          const question = normalizeStructuredContent(block.question);
          const options = normalizeStructuredContent(block.options);
          const answer = normalizeStructuredContent(block.answer);
          if (question) contentParts.push(`题目：${question}`);
          if (options) contentParts.push(`选项：\n${options}`);
          if (answer) contentParts.push(`参考答案：${answer}`);
        }

        if (type === "learning_state") {
          const mastered = normalizeStructuredContent(block.mastered);
          const weak = normalizeStructuredContent(block.weak);
          const nextSuggestion = normalizeStructuredContent(
            block.nextSuggestion ?? block.next,
          );
          if (mastered) contentParts.push(`已掌握：\n${mastered}`);
          if (weak) contentParts.push(`需要加强：\n${weak}`);
          if (nextSuggestion) contentParts.push(`下一步：${nextSuggestion}`);
        }

        const mappedTitle =
          title ||
          (type === "hint"
            ? "提示"
            : type === "steps"
              ? "步骤"
              : type === "knowledge"
                ? "知识点"
                : type === "mistake"
                  ? "错因分析"
                  : type === "quiz"
                    ? "小测"
                    : type === "learning_state"
                      ? "学习状态"
                      : "");

        if (!mappedTitle || contentParts.length === 0) return "";
        return `## ${mappedTitle}\n${contentParts.join("\n\n")}`;
      })
      .filter(Boolean);

    return parts.length > 0 ? parts.join("\n\n") : text;
  } catch {
    return text;
  }
}

// ============================================================
// Markdown 块解析
// ============================================================

export interface MarkdownBlock {
  type:
    | "heading"
    | "code"
    | "list"
    | "ordered_list"
    | "paragraph"
    | "empty"
    | "blockquote"
    | "hr"
    | "table"
    | "latex_display"
    | "latex_inline"
    | "teaching";
  content: string;
  level?: number;
  language?: string;
  rows?: string[][];
  headers?: string[];
  order?: number;
  checked?: boolean | null;
  teachingKind?: string;
  title?: string;
}

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath);

type MdastNode = {
  type: string;
  value?: string;
  lang?: string | null;
  depth?: number;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  children?: MdastNode[];
  align?: Array<"left" | "right" | "center" | null>;
  position?: {
    start?: { line?: number; column?: number; offset?: number };
    end?: { line?: number; column?: number; offset?: number };
  };
};

function getNodeSource(text: string, node: MdastNode): string {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start === "number" && typeof end === "number") {
    return text.slice(start, end);
  }
  return "";
}

function inlineMarkdownFromNode(text: string, node: MdastNode): string {
  const source = getNodeSource(text, node);
  if (source) return source.trim();
  return extractText(node).trim();
}

function extractText(node: MdastNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children || []).map((child) => extractText(child)).join("");
}

function headingContent(text: string, node: MdastNode): string {
  const source = getNodeSource(text, node);
  if (source) {
    return source.replace(/^#{1,6}[ \t]+/, "").trim();
  }
  return extractText(node).trim();
}

function paragraphContent(text: string, node: MdastNode): string {
  const source = getNodeSource(text, node);
  if (source) return source.replace(/\n+/g, " ").trim();
  return extractText(node).trim();
}

function blockquoteContent(text: string, node: MdastNode): string {
  const source = getNodeSource(text, node);
  if (source) {
    return source
      .split("\n")
      .map((line) => line.replace(/^\s*> ?/, ""))
      .join("\n")
      .trim();
  }
  return (node.children || [])
    .map((child) => blockContent(text, child))
    .join("\n\n")
    .trim();
}

function blockContent(text: string, node: MdastNode): string {
  switch (node.type) {
    case "paragraph":
      return paragraphContent(text, node);
    case "heading":
      return headingContent(text, node);
    case "code":
    case "math":
      return node.value || "";
    case "blockquote":
      return blockquoteContent(text, node);
    default:
      return inlineMarkdownFromNode(text, node);
  }
}

function tableCellText(cell: MdastNode | undefined): string {
  return extractText(cell).trim();
}

function blankLineBlocksBetween(
  lines: string[],
  previousEndLine: number,
  nextStartLine: number,
): MarkdownBlock[] {
  if (previousEndLine <= 0 || nextStartLine <= previousEndLine + 1) {
    return [];
  }
  const blocks: MarkdownBlock[] = [];
  for (let lineNo = previousEndLine + 1; lineNo < nextStartLine; lineNo++) {
    if ((lines[lineNo - 1] ?? "").trim() === "") {
      blocks.push({ type: "empty", content: "" });
    }
  }
  return blocks;
}

function paragraphIsSingleLineDisplayMath(
  text: string,
  node: MdastNode,
): string | null {
  const source = getNodeSource(text, node).trim();
  if (!source.startsWith("$$") || !source.endsWith("$$")) return null;
  if ((node.children || []).length !== 1) return null;
  const child = node.children?.[0];
  if (child?.type !== "inlineMath") return null;
  return child.value?.trim() || null;
}

function listItemContent(text: string, item: MdastNode): string {
  const contentChildren = (item.children || []).filter(
    (child) => child.type !== "list",
  );
  const paragraph = contentChildren.find((child) => child.type === "paragraph");
  if (paragraph) return paragraphContent(text, paragraph);
  return contentChildren
    .map((child) => blockContent(text, child))
    .filter(Boolean)
    .join("\n\n");
}

function appendListBlocks(
  text: string,
  list: MdastNode,
  blocks: MarkdownBlock[],
  level = 0,
) {
  const start = list.start ?? 1;
  (list.children || []).forEach((item, index) => {
    const block: MarkdownBlock = {
      type: list.ordered ? "ordered_list" : "list",
      content: listItemContent(text, item),
      level,
      order: list.ordered ? start + index : undefined,
    };
    if (typeof item.checked === "boolean") {
      block.checked = item.checked;
    }
    blocks.push(block);

    for (const child of item.children || []) {
      if (child.type === "list") {
        appendListBlocks(text, child, blocks, level + 1);
      }
    }
  });
}

function hasUnclosedDisplayMath(text: string): boolean {
  let count = 0;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "\\" && text[i + 1] === "$") {
      i += 1;
      continue;
    }
    if (text[i] === "$" && text[i + 1] === "$") {
      count += 1;
      i += 1;
    }
  }
  return count % 2 === 1;
}

function convertMdastNode(text: string, node: MdastNode): MarkdownBlock[] {
  switch (node.type) {
    case "heading":
      return [
        {
          type: "heading",
          content: headingContent(text, node),
          level: node.depth || 1,
        },
      ];
    case "code":
      return [
        {
          type: "code",
          content: node.value || "",
          language: node.lang || undefined,
        },
      ];
    case "math":
      return [{ type: "latex_display", content: node.value || "" }];
    case "paragraph": {
      const displayMath = paragraphIsSingleLineDisplayMath(text, node);
      if (displayMath) {
        return [{ type: "latex_display", content: displayMath }];
      }
      return [{ type: "paragraph", content: paragraphContent(text, node) }];
    }
    case "blockquote": {
      const content = blockquoteContent(text, node);
      const firstLine = content.split("\n")[0] || "";
      const firstTeachingLine = detectTeachingLine(firstLine);
      if (firstTeachingLine) {
        return [
          {
            type: "teaching",
            content: [firstTeachingLine.content, ...content.split("\n").slice(1)]
              .filter(Boolean)
              .join("\n"),
            teachingKind: firstTeachingLine.kind,
            title: firstTeachingLine.title,
          },
        ];
      }
      return [{ type: "blockquote", content }];
    }
    case "list": {
      const blocks: MarkdownBlock[] = [];
      appendListBlocks(text, node, blocks);
      return blocks;
    }
    case "thematicBreak":
      return [{ type: "hr", content: "" }];
    case "table": {
      const rows = node.children || [];
      const headerRow = rows[0];
      const headers = (headerRow?.children || []).map(tableCellText);
      const dataRows = rows
        .slice(1)
        .map((row) => (row.children || []).map(tableCellText));
      return [{ type: "table", content: "", headers, rows: dataRows }];
    }
    case "html":
      return [
        {
          type: "paragraph",
          content: getNodeSource(text, node) || node.value || "",
        },
      ];
    default: {
      const content = blockContent(text, node);
      return content ? [{ type: "paragraph", content }] : [];
    }
  }
}

function detectTeachingLine(
  line: string,
): { kind: string; title: string; content: string } | null {
  const trimmed = line.trim();
  const match = trimmed.match(
    /^(提示|Hint|思路|启发|步骤|解题步骤|推导过程|知识点|关键点|核心概念|概念|错因分析|常见错误|易错点|误区|错因|小测|练习|问题|自测|学习状态|掌握情况|下一步|接下来|建议)[:：]\s*(.*)$/i,
  );
  if (!match) return null;

  const label = match[1].toLowerCase();
  let kind = "hint";
  if (/(步骤|解题步骤|推导过程)/.test(label)) {
    kind = "steps";
  } else if (/(知识点|关键点|核心概念|概念)/.test(label)) {
    kind = "knowledge";
  } else if (/(错因分析|常见错误|易错点|误区|错因)/.test(label)) {
    kind = "mistake";
  } else if (/(小测|练习|问题|自测)/.test(label)) {
    kind = "quiz";
  } else if (/(学习状态|掌握情况)/.test(label)) {
    kind = "learning";
  } else if (/(下一步|接下来|建议)/.test(label)) {
    kind = "next";
  }

  return { kind, title: match[1], content: match[2] };
}

function detectTeachingHeading(
  title: string,
): { kind: string; title: string } | null {
  const normalized = title
    .replace(/^[\s#>*-]+/, "")
    .replace(/^\d+[.、)]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/[：:]\s*$/, "")
    .trim();
  if (!normalized) return null;

  const line = detectTeachingLine(`${normalized}：`);
  if (!line) return null;
  return { kind: line.kind, title: normalized };
}

const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g;
const EMPTY_HTML_BLOCK_REGEX =
  /<(p|div|section|article|aside|blockquote)(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/\1>/gi;
const EMPTY_DETAILS_REGEX =
  /<details(?:\s[^>]*)?>\s*(<summary(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/summary>\s*)?<\/details>/gi;
const EMPTY_SUMMARY_REGEX =
  /<summary(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/summary>/gi;
const EMPTY_PROGRESS_REGEX =
  /<progress(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/progress>/gi;
const RAW_INPUT_REGEX = /<input(?:\s[^>]*)?>/gi;
const EMPTY_FORM_CONTROL_REGEX =
  /<(textarea|select|button|meter)(?:\s[^>]*)?>\s*(?:&nbsp;|\s|<br\s*\/?>)*\s*<\/\1>/gi;
const EMPTY_FENCED_CODE_BLOCK_REGEX = /```[^\n`]*\n?\s*```/g;
const HTML_LIKE_TAG_REGEX = /<\/?([A-Za-z][A-Za-z0-9_-]*)\b[^<>]*?\/?>/g;
const PROTECTED_SPAN_REGEX = /```[\s\S]*?```|`[^`\n]*`/g;
const PROTECTED_PLACEHOLDER_REGEX = /\u0000PROTECTED_(\d+)\u0000/g;

// 允许直接透传的 HTML 标签集合。不在此集合内的形如 <tag> 的 token
// 会被转义成行内代码，避免 remark-parse 把它们解析成奇怪结构。
const ALLOWED_HTML_TAGS = new Set<string>([
  "p",
  "div",
  "span",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "address",
  "a",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "small",
  "sub",
  "sup",
  "mark",
  "kbd",
  "code",
  "samp",
  "var",
  "q",
  "cite",
  "abbr",
  "time",
  "wbr",
  "br",
  "hr",
  "ol",
  "ul",
  "li",
  "dl",
  "dt",
  "dd",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "figure",
  "figcaption",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "col",
  "colgroup",
  "img",
  "video",
  "audio",
  "source",
  "picture",
  "track",
  "details",
  "summary",
  "progress",
  "meter",
  "math",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "mrow",
  "mfrac",
  "msup",
  "msub",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mroot",
  "msqrt",
  "menclose",
  "mspace",
  "mtable",
  "mtr",
  "mtd",
]);

function stripInvisibleCharacters(value: string): string {
  return value.replace(ZERO_WIDTH_REGEX, "");
}

function escapeUnknownHtmlTags(content: string): string {
  if (!content || (!content.includes("<") && !content.includes(">"))) {
    return content;
  }
  const protectedSpans: string[] = [];
  const masked = content.replace(PROTECTED_SPAN_REGEX, (match) => {
    protectedSpans.push(match);
    return `\u0000PROTECTED_${protectedSpans.length - 1}\u0000`;
  });
  const escaped = masked.replace(HTML_LIKE_TAG_REGEX, (match, name: string) => {
    const lower = String(name).toLowerCase();
    if (ALLOWED_HTML_TAGS.has(lower)) return match;
    return `\`${match}\``;
  });
  return escaped.replace(
    PROTECTED_PLACEHOLDER_REGEX,
    (_, idx: string) => protectedSpans[Number(idx)] ?? "",
  );
}

function removeEmptyHtmlBlocks(content: string): string {
  return content
    .replace(EMPTY_DETAILS_REGEX, "")
    .replace(EMPTY_SUMMARY_REGEX, "")
    .replace(EMPTY_PROGRESS_REGEX, "")
    .replace(RAW_INPUT_REGEX, "")
    .replace(EMPTY_FORM_CONTROL_REGEX, "")
    .replace(EMPTY_HTML_BLOCK_REGEX, "");
}

/**
 * 清理模型输出的特殊控制 token，避免它们进入 Markdown 解析器造成结构异常。
 *
 * 借鉴 Open WebUI 的 sanitizeResponseContent：
 * - 移除 <|...|> 形式（DeepSeek/Qwen/Llama 等）的完整 special token
 * - 移除末尾未闭合的 <|... 片段
 * - 移除常见的 EOS/BOS token（<s>, </s>, <|endoftext|>, <|im_start|>, <|im_end|>）
 *
 * 注意：这里不像 Open WebUI 那样把所有 < > 转义为 &lt; / &gt;，
 * 因为移动端已有 escapeUnknownHtmlTags 把未知标签转义成行内代码，
 * 保留合法 HTML（如 <details>）的渲染能力。
 */
export function sanitizeResponseContent(content: string): string {
  return (
    content
      // 完整 special token，如 <|end▁of▁sentence|>、<|tool_call_begin|> 等
      .replace(/<\|[a-zA-Z0-9_\u4e00-\u9fa5▁]+\|>/g, " ")
      // 末尾未闭合的 <|... 片段
      .replace(/<\|[a-zA-Z0-9_\u4e00-\u9fa5▁]*$/, "")
      .replace(/<\|[a-zA-Z0-9_\u4e00-\u9fa5▁]+\|?$/, "")
      // 常见 EOS/BOS / role token
      .replace(/<\|endoftext\|>/gi, " ")
      .replace(/<\|im_(start|end)\|>/gi, " ")
      .replace(/<s>|<\/s>/gi, " ")
      .trim()
  );
}

export function normalizeHtmlLineBreaks(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n");
}

/**
 * 移动端 Markdown 显示前归一化。
 *
 * 处理内容：
 * - 清理模型 special token
 * - 去除零宽字符
 * - 把 \r\n 统一为 \n
 * - HTML 换行标签归一化为 \n
 * - 清理空的 HTML 块级标签 / details / form 控件
 * - 把未在白名单内的伪 HTML 标签（如 <think>、<tool_call>）转义成行内代码
 * - 折叠连续 3 行及以上空行为 2 行
 */
export function normalizeMarkdownForDisplay(content: string): string {
  if (!content) return "";
  const sanitized = sanitizeResponseContent(String(content));
  const normalized = stripInvisibleCharacters(sanitized)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
  const cleaned = removeEmptyHtmlBlocks(normalized);
  const withLineBreaks = normalizeHtmlLineBreaks(cleaned);
  const safe = escapeUnknownHtmlTags(withLineBreaks)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
  return safe;
}

/**
 * 判断一段 Markdown 是否包含可见内容。
 *
 * 会把 Markdown 语法（链接、图片、代码围栏、HTML 标签、标题标记等）剥离后，
 * 再检查是否还有非空白字符。比简单 trim().length > 0 更可靠。
 */
export function hasVisibleMarkdownContent(content: string): boolean {
  if (!content) return false;
  const normalized = normalizeMarkdownForDisplay(content);
  if (!normalized.trim()) return false;

  const withoutEmptyBlocks = normalized
    .replace(EMPTY_FENCED_CODE_BLOCK_REGEX, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/!\[(.*?)\]\([^)]+\)/g, "$1")
    .replace(/^[\s>*\-+|#`]+$/gm, "");

  return stripInvisibleCharacters(withoutEmptyBlocks).trim().length > 0;
}

export function parseMarkdown(
  text: string,
  isStreaming = false,
): MarkdownBlock[] {
  const startedAt = Date.now();
  const rawText = normalizeMarkdownForDisplay(normalizeStructuredTutorResponse(text));
  if (isStreaming && hasUnclosedDisplayMath(rawText)) {
    debugLog("latex-utils", "parse_markdown_bypass_unclosed_math", {
      chars: rawText.length,
      isStreaming,
    });
    return [{ type: "paragraph", content: rawText }];
  }
  // 流式传输时，先对未闭合的 Markdown 标记（粗体、斜体、代码、公式、链接等）
  // 进行安全补全或中和，避免解析器输出异常结构导致渲染崩溃。
  const safeText = isStreaming
    ? sanitizeIncompleteMarkdown(rawText)
    : rawText;
  const parseStartedAt = Date.now();
  const tree = markdownProcessor.runSync(markdownProcessor.parse(safeText)) as MdastNode;
  const parserMs = Date.now() - parseStartedAt;
  const lines = safeText.split("\n");
  const blocks: MarkdownBlock[] = [];
  let previousEndLine = 0;

  for (const node of tree.children || []) {
    const startLine = node.position?.start?.line ?? previousEndLine + 1;
    blocks.push(...blankLineBlocksBetween(lines, previousEndLine, startLine));
    blocks.push(...convertMdastNode(safeText, node));
    previousEndLine = node.position?.end?.line ?? startLine;
  }

  for (let lineNo = previousEndLine + 1; lineNo <= lines.length; lineNo++) {
    if ((lines[lineNo - 1] ?? "").trim() === "") {
      blocks.push({ type: "empty", content: "" });
    }
  }

  const totalMs = Date.now() - startedAt;
  if (totalMs > 24 || parserMs > 16 || safeText.length > 1200 || blocks.length > 24) {
    debugLog("latex-utils", "parse_markdown", {
      chars: safeText.length,
      isStreaming,
      parserMs,
      totalMs,
      lines: lines.length,
      nodes: tree.children?.length || 0,
      blocks: blocks.length,
    });
  }
  return blocks;
}

// ============================================================
// 行内 token 提取（从 renderInline 中提取的正则逻辑）
// ============================================================

export interface InlineToken {
  type: "text" | "code" | "bold" | "italic" | "link" | "latex";
  content: string;
  url?: string;
}

const INLINE_REGEX =
  /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|\$[^$]+?\$|\\[a-zA-Z]+(?:\{[^{}]*\})*|[a-zA-Z0-9]\^(?:\{[^{}]*\}|[a-zA-Z0-9])|[a-zA-Z0-9]_(?:\{[^{}]*\}|[a-zA-Z0-9]))/g;

/**
 * 将行内文本拆分为 token 数组（纯数据结构，不含 JSX）
 */
export function tokenizeInline(text: string): InlineToken[] {
  if (!text) return [];
  const tokens: InlineToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      tokens.push({ type: "code", content: token.slice(1, -1) });
    } else if (token.startsWith("**") && token.endsWith("**")) {
      tokens.push({ type: "bold", content: token.slice(2, -2) });
    } else if (
      token.startsWith("*") &&
      token.endsWith("*") &&
      token.length > 2
    ) {
      tokens.push({ type: "italic", content: token.slice(1, -1) });
    } else if (token.startsWith("[")) {
      const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        tokens.push({ type: "link", content: m[1], url: m[2] });
      }
    } else if (token.startsWith("$") && token.endsWith("$")) {
      tokens.push({
        type: "latex",
        content: simplifyLatex(token.slice(1, -1)),
      });
    } else if (token.startsWith("\\")) {
      tokens.push({ type: "latex", content: simplifyLatex(token) });
    } else {
      tokens.push({ type: "latex", content: simplifyLatex(token) });
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", content: text.slice(lastIndex) });
  }
  return tokens;
}
