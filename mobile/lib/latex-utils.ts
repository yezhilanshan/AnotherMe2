// ============================================================
// LaTeX → Unicode 工具函数（纯函数，无 React 依赖，可独立测试）
// ============================================================

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
  let result = formula
    // 先将 JSON 转义的双反斜杠还原为单反斜杠
    .replace(/\\\\/g, "\\")
    // \mathbb{...} / \mathcal{...} / \mathbf{...} ... → 保留内容
    .replace(
      /\\(?:mathbb|mathcal|mathbf|mathit|mathrm|mathfrak|mathsf|mathtt)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
      "$1",
    )
    // \text{...} / \textrm{...} → 保留文字内容
    .replace(/\\(?:text|textrm)\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, "$1");

  // Pass 1: superscripts/subscripts（先展平嵌套，让后续 \frac 更容易匹配）
  // 先对花括号内容做符号替换，再调用 superscript/subscript
  const resolveInner = (s: string) =>
    s.replace(/\\([a-zA-Z]+)/g, (_, cmd: string) => LATEX_UNICODE[cmd] || cmd);

  result = result
    .replace(/\^{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, (_, inner: string) =>
      superscript(resolveInner(inner)),
    )
    .replace(/_{([^{}]*(?:\{[^{}]*\}[^{}]*)*)}/g, (_, inner: string) =>
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

  // Pass 2: \frac / \sqrt（此时嵌套花括号已被 upper/lower 展开）
  result = result
    .replace(
      /\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
      "($1)/($2)",
    )
    .replace(
      /\\sqrt\[([^\]]+)\]\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
      (_, idx: string, inner: string) => superscript(idx) + "√(" + inner + ")",
    )
    .replace(/\\sqrt\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, "√($1)");

  // Pass 3: LaTeX 符号 → Unicode（必须在 \frac/\sqrt 之后，确保它们不被吃掉）
  result = result.replace(
    /\\([a-zA-Z]+)/g,
    (_, cmd: string) => LATEX_UNICODE[cmd] || cmd,
  );

  // 清理残留花括号
  result = result.replace(/[{}]/g, "").trim();
  return result || formula;
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
  teachingKind?: string;
  title?: string;
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

export function parseMarkdown(
  text: string,
  isStreaming = false,
): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = normalizeStructuredTutorResponse(text).split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行
    if (line.trim() === "") {
      blocks.push({ type: "empty", content: "" });
      i++;
      continue;
    }

    // 分隔线 --- / *** / ___
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: "hr", content: "" });
      i++;
      continue;
    }

    // 代码块 ```
    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", content: codeLines.join("\n"), language });
      i++;
      continue;
    }

    // 显示模式 LaTeX 公式 $$...$$
    if (line.trim().startsWith("$$")) {
      // 流式传输保护：如果是最后一行且未闭合 $$，当作普通段落
      if (isStreaming && i === lines.length - 1) {
        const fl = line.trim().slice(2);
        if (!fl.endsWith("$$")) {
          blocks.push({ type: "paragraph", content: line });
          i++;
          continue;
        }
      }
      const formulaLines: string[] = [];
      const firstLine = line.trim().slice(2);
      if (firstLine.endsWith("$$") && firstLine.length > 2) {
        blocks.push({ type: "latex_display", content: firstLine.slice(0, -2) });
        i++;
        continue;
      }
      // 多行公式
      if (firstLine) formulaLines.push(firstLine);
      i++;
      while (i < lines.length && !lines[i].trim().endsWith("$$")) {
        if (isStreaming && i === lines.length - 1) {
          const allLines = [line, ...formulaLines, lines[i]];
          blocks.push({ type: "paragraph", content: allLines.join("\n") });
          i++;
          // 流式中断后跳过后续清理
          formulaLines.length = 0;
          break;
        }
        formulaLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && formulaLines.length > 0) {
        const lastLine = lines[i].trim();
        const stripped = lastLine.slice(0, -2);
        if (stripped) formulaLines.push(stripped);
        i++;
      }
      if (formulaLines.length > 0) {
        blocks.push({
          type: "latex_display",
          content: formulaLines.join("\n"),
        });
      }
      continue;
    }

    // 表格
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) => row.split("|").slice(1, -1);
        const headers = parseRow(tableLines[0]);
        const dataRows = tableLines.slice(2).map(parseRow);
        blocks.push({ type: "table", content: "", headers, rows: dataRows });
      }
      continue;
    }

    // 引用块 >
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const firstTeachingLine = detectTeachingLine(quoteLines[0] || "");
      if (firstTeachingLine) {
        const content = [firstTeachingLine.content, ...quoteLines.slice(1)]
          .filter(Boolean)
          .join("\n");
        blocks.push({
          type: "teaching",
          content,
          teachingKind: firstTeachingLine.kind,
          title: firstTeachingLine.title,
        });
      } else {
        blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      }
      continue;
    }

    // 教学语义行
    const teachingLine = detectTeachingLine(line);
    if (teachingLine) {
      blocks.push({
        type: "teaching",
        content: teachingLine.content,
        teachingKind: teachingLine.kind,
        title: teachingLine.title,
      });
      i++;
      continue;
    }

    // 标题 # ## ###
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const teachingHeading = detectTeachingHeading(headingMatch[2]);
      if (teachingHeading) {
        const contentLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].match(/^#{1,6}\s+/)) {
          contentLines.push(lines[i]);
          i++;
        }
        blocks.push({
          type: "teaching",
          content: contentLines.join("\n").trim(),
          teachingKind: teachingHeading.kind,
          title: teachingHeading.title,
        });
        continue;
      }
      blocks.push({
        type: "heading",
        content: headingMatch[2],
        level: headingMatch[1].length,
      });
      i++;
      continue;
    }

    // 无序列表
    const listMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (listMatch) {
      const indent = listMatch[1].length;
      blocks.push({
        type: "list",
        content: listMatch[2],
        level: Math.floor(indent / 2),
      });
      i++;
      continue;
    }

    // 有序列表
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (orderedMatch) {
      const indent = orderedMatch[1].length;
      blocks.push({
        type: "ordered_list",
        content: orderedMatch[3],
        level: Math.floor(indent / 2),
        order: Number(orderedMatch[2]),
      });
      i++;
      continue;
    }

    // 普通段落
    let paragraph = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("$$") &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].match(/^\s*[-*]\s/) &&
      !lines[i].match(/^\s*\d+\.\s/) &&
      !lines[i].trim().startsWith(">") &&
      !lines[i].trim().startsWith("|") &&
      !/^[-*_]{3,}\s*$/.test(lines[i].trim())
    ) {
      paragraph += " " + lines[i];
      i++;
    }
    blocks.push({ type: "paragraph", content: paragraph });
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
  /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|\$[^$]+?\$|\\[a-zA-Z]+(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*|[a-zA-Z0-9]\^(?:\{[^{}]*\}|[a-zA-Z0-9])|[a-zA-Z0-9]_(?:\{[^{}]*\}|[a-zA-Z0-9]))/g;

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
