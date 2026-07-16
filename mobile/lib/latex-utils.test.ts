// ============================================================
// LaTeX 渲染逻辑 — 全面测试用例
// 运行: node lib/latex-utils.test.mjs
// ============================================================

import {
  simplifyLatex,
  superscript,
  subscript,
  tokenizeInline,
  parseMarkdown,
  normalizeStructuredTutorResponse,
  normalizeStructuredContent,
  normalizeMarkdownForDisplay,
  hasVisibleMarkdownContent,
  sanitizeResponseContent,
  normalizeHtmlLineBreaks,
} from "./latex-utils";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`  ✗ ${label}`);
  }
}

function eq(actual: unknown, expected: unknown, label: string) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(
      `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function deepEq(actual: unknown, expected: unknown, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed++;
  } else {
    failed++;
    failures.push(`  ✗ ${label}\n    expected: ${b}\n    actual:   ${a}`);
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

// ============================================================
// 1. superscript / subscript
// ============================================================
section("superscript / subscript");

eq(superscript("0"), "⁰", "digit 0");
eq(superscript("9"), "⁹", "digit 9");
eq(superscript("10"), "¹⁰", "multi-digit 10");
eq(superscript("n"), "ⁿ", "letter n");
eq(superscript("i"), "ⁱ", "letter i");
eq(superscript("+"), "⁺", "plus sign");
eq(superscript("-"), "⁻", "minus sign");
eq(superscript("x"), "ˣ", "letter x (now mapped)");
eq(superscript("$"), "$", "unmapped char returns itself");
eq(superscript(""), "", "empty string");

eq(subscript("0"), "₀", "sub digit 0");
eq(subscript("9"), "₉", "sub digit 9");
eq(subscript("ij"), "ᵢⱼ", "subscript letters ij");
eq(subscript("max"), "ₘₐₓ", "subscript 'max'");
eq(subscript("x"), "ₓ", "subscript x");
eq(subscript(""), "", "sub empty string");

// ============================================================
// 2. simplifyLatex — 希腊字母
// ============================================================
section("simplifyLatex — Greek letters");

eq(simplifyLatex("\\alpha"), "α", "alpha");
eq(simplifyLatex("\\beta"), "β", "beta");
eq(simplifyLatex("\\Gamma"), "Γ", "Gamma (uppercase)");
eq(simplifyLatex("\\Delta"), "Δ", "Delta (uppercase)");
eq(simplifyLatex("\\theta"), "θ", "theta");
eq(simplifyLatex("\\Theta"), "Θ", "Theta");
eq(simplifyLatex("\\pi"), "π", "pi");
eq(simplifyLatex("\\Pi"), "Π", "Pi");
eq(simplifyLatex("\\sigma"), "σ", "sigma");
eq(simplifyLatex("\\Sigma"), "Σ", "Sigma");
eq(simplifyLatex("\\omega"), "ω", "omega");
eq(simplifyLatex("\\Omega"), "Ω", "Omega");
eq(simplifyLatex("\\phi"), "φ", "phi");
eq(simplifyLatex("\\varphi"), "ϕ", "varphi variant");
eq(simplifyLatex("\\epsilon"), "ε", "epsilon");
eq(simplifyLatex("\\varepsilon"), "ε", "varepsilon");

// ============================================================
// 3. simplifyLatex — 运算符 / 关系符
// ============================================================
section("simplifyLatex — operators & relations");

eq(simplifyLatex("\\times"), "×", "times");
eq(simplifyLatex("\\div"), "÷", "div");
eq(simplifyLatex("\\cdot"), "·", "cdot");
eq(simplifyLatex("\\pm"), "±", "pm");
eq(simplifyLatex("\\mp"), "∓", "mp");
eq(simplifyLatex("\\circ"), "°", "circ");
eq(simplifyLatex("\\leq"), "≤", "leq");
eq(simplifyLatex("\\geq"), "≥", "geq");
eq(simplifyLatex("\\neq"), "≠", "neq");
eq(simplifyLatex("\\approx"), "≈", "approx");
eq(simplifyLatex("\\equiv"), "≡", "equiv");
eq(simplifyLatex("\\sim"), "∼", "sim");
eq(simplifyLatex("\\propto"), "∝", "propto");

// ============================================================
// 4. simplifyLatex — 箭头
// ============================================================
section("simplifyLatex — arrows");

eq(simplifyLatex("\\to"), "→", "to");
eq(simplifyLatex("\\rightarrow"), "→", "rightarrow");
eq(simplifyLatex("\\Rightarrow"), "⇒", "Rightarrow");
eq(simplifyLatex("\\leftarrow"), "←", "leftarrow");
eq(simplifyLatex("\\Leftarrow"), "⇐", "Leftarrow");
eq(simplifyLatex("\\leftrightarrow"), "↔", "leftrightarrow");
eq(simplifyLatex("\\mapsto"), "↦", "mapsto");
eq(simplifyLatex("\\implies"), "⇒", "implies");

// ============================================================
// 5. simplifyLatex — 大型运算符 / 集合
// ============================================================
section("simplifyLatex — large operators & sets");

eq(simplifyLatex("\\sum"), "∑", "sum");
eq(simplifyLatex("\\prod"), "∏", "prod");
eq(simplifyLatex("\\int"), "∫", "int");
eq(simplifyLatex("\\oint"), "∮", "oint");
eq(simplifyLatex("\\infty"), "∞", "infty");
eq(simplifyLatex("\\partial"), "∂", "partial");
eq(simplifyLatex("\\nabla"), "∇", "nabla");
eq(simplifyLatex("\\forall"), "∀", "forall");
eq(simplifyLatex("\\exists"), "∃", "exists");
eq(simplifyLatex("\\in"), "∈", "in");
eq(simplifyLatex("\\notin"), "∉", "notin");
eq(simplifyLatex("\\subset"), "⊂", "subset");
eq(simplifyLatex("\\subseteq"), "⊆", "subseteq");
eq(simplifyLatex("\\cup"), "∪", "cup");
eq(simplifyLatex("\\cap"), "∩", "cap");
eq(simplifyLatex("\\emptyset"), "∅", "emptyset");
eq(simplifyLatex("\\perp"), "⊥", "perp");
eq(simplifyLatex("\\parallel"), "∥", "parallel");

// ============================================================
// 6. simplifyLatex — 分数
// ============================================================
section("simplifyLatex — fractions");

eq(simplifyLatex("\\frac{1}{2}"), "(1)/(2)", "simple fraction");
eq(simplifyLatex("\\frac{a}{b}"), "(a)/(b)", "frac a/b");
eq(simplifyLatex("\\frac{x+y}{2}"), "(x+y)/(2)", "frac with sum in numerator");
eq(simplifyLatex("\\frac{\\pi}{2}"), "(π)/(2)", "frac with pi");
eq(simplifyLatex("\\frac{\\alpha}{\\beta}"), "(α)/(β)", "frac with greek");

// ============================================================
// 7. simplifyLatex — 根号
// ============================================================
section("simplifyLatex — sqrt");

eq(simplifyLatex("\\sqrt{x}"), "√(x)", "sqrt x");
eq(simplifyLatex("\\sqrt{x+y}"), "√(x+y)", "sqrt x+y");
eq(simplifyLatex("\\sqrt[3]{x}"), "³√(x)", "cbrt");
eq(simplifyLatex("\\sqrt[n]{x}"), "ⁿ√(x)", "nth root");
eq(simplifyLatex("\\sqrt[2]{\\pi}"), "²√(π)", "sqrt with pi");

// ============================================================
// 8. simplifyLatex — 上下标
// ============================================================
section("simplifyLatex — superscripts & subscripts");

eq(simplifyLatex("x^{2}"), "x²", "x squared");
eq(simplifyLatex("x^{10}"), "x¹⁰", "x to the 10th");
eq(simplifyLatex("x^{n+1}"), "xⁿ⁺¹", "x to the n+1");
eq(simplifyLatex("E=mc^{2}"), "E=mc²", "E=mc^2");
eq(simplifyLatex("a_{1}"), "a₁", "a sub 1");
eq(simplifyLatex("a_{ij}"), "aᵢⱼ", "a sub ij");
eq(simplifyLatex("x_{max}"), "xₘₐₓ", "x sub max");
eq(simplifyLatex("x^2"), "x²", "x^2 no braces");
eq(simplifyLatex("x_i"), "xᵢ", "x_i no braces");
eq(simplifyLatex("n^{\\circ}"), "n°", "n degrees via circ in superscript");

// ============================================================
// 9. simplifyLatex — 样式命令（剥除命令保留内容）
// ============================================================
section("simplifyLatex — style commands");

eq(simplifyLatex("\\mathbb{R}"), "R", "mathbb R");
eq(simplifyLatex("\\mathcal{L}"), "L", "mathcal L");
eq(simplifyLatex("\\mathbf{x}"), "x", "mathbf x");
eq(simplifyLatex("\\mathit{abc}"), "abc", "mathit abc");
eq(simplifyLatex("\\mathrm{d}"), "d", "mathrm d");
eq(simplifyLatex("\\vec{ED}"), "→ED", "vec ED");
eq(simplifyLatex("\\overrightarrow{AB}"), "→AB", "overrightarrow AB");
eq(simplifyLatex("\\text{hello}"), "hello", "text hello");
eq(simplifyLatex("\\textrm{world}"), "world", "textrm world");

// ============================================================
// 10. simplifyLatex — 组合表达式
// ============================================================
section("simplifyLatex — compound expressions");

eq(
  simplifyLatex("\\frac{-b \\pm \\sqrt{b^{2}-4ac}}{2a}"),
  "(-b ± √(b²-4ac))/(2a)",
  "quadratic formula",
);
eq(simplifyLatex("\\sum_{i=1}^{n} x_i"), "∑ᵢ₌₁ⁿ xᵢ", "sum with limits");
eq(
  simplifyLatex("\\int_{0}^{\\infty} e^{-x} dx"),
  "∫₀∞ e⁻ˣ dx",
  "integral with limits",
);
eq(
  simplifyLatex("\\forall \\epsilon > 0, \\exists \\delta > 0"),
  "∀ ε > 0, ∃ δ > 0",
  "epsilon-delta",
);
eq(
  simplifyLatex("\\lim_{x \\to \\infty} \\frac{1}{x} = 0"),
  "limₓ → ∞ (1)/(x) = 0",
  "limit expression",
);

// ============================================================
// 11. simplifyLatex — 边界情况
// ============================================================
section("simplifyLatex — edge cases");

eq(simplifyLatex(""), "", "empty string");
eq(simplifyLatex("plain text"), "plain text", "no latex");
eq(simplifyLatex("\\\\"), "\\", "double backslash → single");
eq(
  simplifyLatex("JSON escaped: \\\\frac{1}{2}"),
  "JSON escaped: (1)/(2)",
  "JSON-escaped frac",
);
eq(
  simplifyLatex("unknown\\cmd"),
  "unknowncmd",
  "unknown command strips backslash",
);
eq(simplifyLatex("x^{}"), "x", "empty superscript braces");
eq(simplifyLatex("{grouped}"), "grouped", "grouping braces removed");

// ============================================================
// 12. normalizeStructuredContent
// ============================================================
section("normalizeStructuredContent");

eq(normalizeStructuredContent("  hello  "), "hello", "trim string");
eq(normalizeStructuredContent(["a", "b", "c"]), "- a\n- b\n- c", "array");
eq(normalizeStructuredContent(null), "", "null");
eq(normalizeStructuredContent(undefined), "", "undefined");
eq(normalizeStructuredContent(42), "42", "number");

// ============================================================
// 13. normalizeStructuredTutorResponse
// ============================================================
section("normalizeStructuredTutorResponse");

// Plain text → pass through
eq(
  normalizeStructuredTutorResponse("普通文本内容"),
  "普通文本内容",
  "plain text passthrough",
);

// JSON with LaTeX inside → should preserve backslashes
const jsonWithLatex = JSON.stringify({
  blocks: [{ type: "markdown", content: "E = mc^{2} and \\pi r^2" }],
});
const normalized = normalizeStructuredTutorResponse(jsonWithLatex);
assert(
  normalized.includes("E = mc^{2}") || normalized.includes("E = mc²"),
  "JSON with LaTeX preserves content",
);

// Non-JSON with curly braces (e.g. set notation) → passthrough
eq(
  normalizeStructuredTutorResponse("{x | x > 0}"),
  "{x | x > 0}",
  "set notation passthrough",
);

// ============================================================
// 14. tokenizeInline — 基本 Markdown
// ============================================================
section("tokenizeInline — basic markdown");

deepEq(
  tokenizeInline("hello world"),
  [{ type: "text", content: "hello world" }],
  "plain text",
);

deepEq(
  tokenizeInline("`code`"),
  [{ type: "code", content: "code" }],
  "inline code",
);

deepEq(tokenizeInline("**bold**"), [{ type: "bold", content: "bold" }], "bold");

deepEq(
  tokenizeInline("*italic*"),
  [{ type: "italic", content: "italic" }],
  "italic",
);

deepEq(
  tokenizeInline("[link](https://example.com)"),
  [{ type: "link", content: "link", url: "https://example.com" }],
  "link",
);

// ============================================================
// 15. tokenizeInline — LaTeX inline
// ============================================================
section("tokenizeInline — LaTeX inline");

deepEq(
  tokenizeInline("$E=mc^2$"),
  [{ type: "latex", content: "E=mc²" }],
  "inline formula dollar-delimited",
);

deepEq(
  tokenizeInline("\\pi"),
  [{ type: "latex", content: "π" }],
  "raw latex command",
);

deepEq(
  tokenizeInline("\\frac{1}{2}"),
  [{ type: "latex", content: "(1)/(2)" }],
  "raw frac command",
);

deepEq(
  tokenizeInline("x^{2}"),
  [{ type: "latex", content: "x²" }],
  "superscript with braces",
);

// ============================================================
// 16. tokenizeInline — mixed content
// ============================================================
section("tokenizeInline — mixed content");

deepEq(
  tokenizeInline("The area is $\\pi r^{2}$."),
  [
    { type: "text", content: "The area is " },
    { type: "latex", content: "π r²" },
    { type: "text", content: "." },
  ],
  "mixed text and latex",
);

deepEq(
  tokenizeInline("**注意** $x \\neq 0$"),
  [
    { type: "bold", content: "注意" },
    { type: "text", content: " " },
    { type: "latex", content: "x ≠ 0" },
  ],
  "bold + latex",
);

deepEq(
  tokenizeInline("**$\\tan B = 2$：** 这意味着 $\\sin B = \\frac{2}{\\sqrt{5}}$"),
  [
    { type: "bold", content: "$\\tan B = 2$：" },
    { type: "text", content: " 这意味着 " },
    { type: "latex", content: "sin B = (2)/(√(5))" },
  ],
  "bold wrapper preserves nested inline math payload",
);

// ============================================================
// 17. tokenizeInline — 多个 $...$ 不互相吞噬
// ============================================================
section("tokenizeInline — multiple $...$ non-greedy");

deepEq(
  tokenizeInline("$a$ and $b$"),
  [
    { type: "latex", content: "a" },
    { type: "text", content: " and " },
    { type: "latex", content: "b" },
  ],
  "two inline formulas separate",
);

deepEq(
  tokenizeInline("cost: $100$ dollars, area: $\\pi r^2$"),
  [
    { type: "text", content: "cost: " },
    { type: "latex", content: "100" },
    { type: "text", content: " dollars, area: " },
    { type: "latex", content: "π r²" },
  ],
  "dollar amounts and latex coexist",
);

// ============================================================
// 18. parseMarkdown — basic blocks
// ============================================================
section("parseMarkdown — basic blocks");

deepEq(
  parseMarkdown("Hello world"),
  [{ type: "paragraph", content: "Hello world" }],
  "single paragraph",
);

deepEq(
  parseMarkdown("# Title\n\nContent"),
  [
    { type: "heading", content: "Title", level: 1 },
    { type: "empty", content: "" },
    { type: "paragraph", content: "Content" },
  ],
  "heading + paragraph",
);

deepEq(
  parseMarkdown("```js\nconst x = 1;\n```"),
  [{ type: "code", content: "const x = 1;", language: "js" }],
  "code block",
);

deepEq(
  parseMarkdown("~~~ts\nconst y = 2;\n~~~"),
  [{ type: "code", content: "const y = 2;", language: "ts" }],
  "tilde code block",
);

deepEq(
  parseMarkdown("- item 1\n- item 2"),
  [
    { type: "list", content: "item 1", level: 0 },
    { type: "list", content: "item 2", level: 0 },
  ],
  "unordered list",
);

deepEq(
  parseMarkdown("> quoted text"),
  [{ type: "blockquote", content: "quoted text" }],
  "blockquote",
);

// ============================================================
// 19. parseMarkdown — LaTeX display
// ============================================================
section("parseMarkdown — LaTeX display");

deepEq(
  parseMarkdown("$$E=mc^2$$"),
  [{ type: "latex_display", content: "E=mc^2" }],
  "single-line display formula",
);

deepEq(
  parseMarkdown("$$\n\\frac{1}{2}\n$$"),
  [{ type: "latex_display", content: "\\frac{1}{2}" }],
  "multi-line display formula",
);

deepEq(
  parseMarkdown("Text before\n$$\n\\pi r^2\n$$\nText after"),
  [
    { type: "paragraph", content: "Text before" },
    { type: "latex_display", content: "\\pi r^2" },
    { type: "paragraph", content: "Text after" },
  ],
  "display formula between paragraphs",
);

// ============================================================
// 20. parseMarkdown — streaming protection
// ============================================================
section("parseMarkdown — streaming protection");

// Unclosed $$ as last line during streaming → paragraph
deepEq(
  parseMarkdown("$$\npartial formula", true),
  [{ type: "paragraph", content: "$$\npartial formula" }],
  "unclosed display math → paragraph when streaming",
);

// Complete $$ even during streaming → still detected
deepEq(
  parseMarkdown("$$E=mc^2$$", true),
  [{ type: "latex_display", content: "E=mc^2" }],
  "complete display math during streaming → still formula",
);

// Without streaming flag → unclosed $$ consumes everything (old behavior)
const noStreamResult = parseMarkdown("$$\npartial formula", false);
assert(
  noStreamResult.length > 0 && noStreamResult[0].type === "latex_display",
  "without streaming flag, unclosed $$ becomes formula block",
);

// ============================================================
// 21. parseMarkdown — mixed content
// ============================================================
section("parseMarkdown — mixed content");

deepEq(
  parseMarkdown(
    "# 求解\n\n已知 $x^2 + y^2 = 1$，求 $x+y$ 的最大值。\n\n$$x + y \\leq \\sqrt{2(x^2 + y^2)} = \\sqrt{2}$$",
  ),
  [
    { type: "heading", content: "求解", level: 1 },
    { type: "empty", content: "" },
    { type: "paragraph", content: "已知 $x^2 + y^2 = 1$，求 $x+y$ 的最大值。" },
    { type: "empty", content: "" },
    {
      type: "latex_display",
      content: "x + y \\leq \\sqrt{2(x^2 + y^2)} = \\sqrt{2}",
    },
  ],
  "typical math response",
);

deepEq(
  parseMarkdown(
    "- **$\\tan B = 2$：** 这意味着 $\\sin B = \\frac{2}{\\sqrt{5}}$。\n- **$\\angle BEB' = 90^\\circ$：** 这是关键。",
  ),
  [
    {
      type: "list",
      content:
        "**$\\tan B = 2$：** 这意味着 $\\sin B = \\frac{2}{\\sqrt{5}}$。",
      level: 0,
    },
    {
      type: "list",
      content: "**$\\angle BEB' = 90^\\circ$：** 这是关键。",
      level: 0,
    },
  ],
  "list items keep bold-wrapped inline math intact",
);

// ============================================================
// 22. parseMarkdown — GFM blocks via remark
// ============================================================
section("parseMarkdown — GFM blocks");

deepEq(
  parseMarkdown("- [x] done\n- [ ] todo"),
  [
    { type: "list", content: "done", level: 0, checked: true },
    { type: "list", content: "todo", level: 0, checked: false },
  ],
  "task list checked state",
);

deepEq(
  parseMarkdown("- parent\n  - child"),
  [
    { type: "list", content: "parent", level: 0 },
    { type: "list", content: "child", level: 1 },
  ],
  "nested unordered list levels",
);

deepEq(
  parseMarkdown("Use this[^1].\n\n[^1]: footnote text"),
  [
    { type: "paragraph", content: "Use this[^1]." },
    { type: "empty", content: "" },
    { type: "paragraph", content: "[^1]: footnote text" },
  ],
  "footnote definitions remain visible",
);

// ============================================================
// 23. parseMarkdown — HTML line breaks normalization
// ============================================================
section("parseMarkdown — HTML line breaks normalization");

const htmlContent = "Hello<br>world<br/>test<br />end";
const htmlBlocks = parseMarkdown(htmlContent);
assert(
  htmlBlocks.length === 1 &&
    htmlBlocks[0].type === "paragraph" &&
    htmlBlocks[0].content === "Hello world test end",
  "single <br> becomes soft line break within one paragraph",
);

const htmlParagraphBreak = "Line one<br><br>Line two";
const paragraphBreakBlocks = parseMarkdown(htmlParagraphBreak);
deepEq(
  paragraphBreakBlocks,
  [
    { type: "paragraph", content: "Line one" },
    { type: "empty", content: "" },
    { type: "paragraph", content: "Line two" },
  ],
  "<br><br> becomes paragraph break",
);

const pythagoreanWithBr =
  "### 1. 核心定义与公式<br><br>**勾股定理**描述的是**直角三角形**三条边之间的长度关系。<br><br>$$a^2 + b^2 = c^2$$";
const brBlocks = parseMarkdown(pythagoreanWithBr);
assert(
  brBlocks.some(
    (b) => b.type === "heading" && b.content === "1. 核心定义与公式",
  ),
  "<br><br> before heading is normalized so heading is parsed",
);
assert(
  brBlocks.some(
    (b) => b.type === "latex_display" && b.content === "a^2 + b^2 = c^2",
  ),
  "display math on its own line after <br><br> is still parsed",
);

// ============================================================
// 24. normalizeMarkdownForDisplay — 借鉴 DeepTutor 的预处理
// ============================================================
section("normalizeMarkdownForDisplay — display normalization");

eq(
  normalizeMarkdownForDisplay("Hello\u200Bworld"),
  "Helloworld",
  "strips zero-width characters",
);
eq(
  normalizeMarkdownForDisplay("Line one\r\nLine two"),
  "Line one\nLine two",
  "normalizes CRLF to LF",
);
eq(
  normalizeMarkdownForDisplay("A<br>B"),
  "A\nB",
  "converts <br> to newline",
);
eq(
  normalizeMarkdownForDisplay("<think>inner thought</think>"),
  "`<think>`inner thought`</think>`",
  "escapes unknown pseudo HTML tags to inline code",
);
eq(
  normalizeMarkdownForDisplay("<p></p><div>  </div>"),
  "",
  "removes empty block-level HTML tags",
);
eq(
  normalizeMarkdownForDisplay("A\n\n\n\nB"),
  "A\n\nB",
  "collapses excessive blank lines",
);

// ============================================================
// 25. hasVisibleMarkdownContent — 可见性判断
// ============================================================
section("hasVisibleMarkdownContent — visible content detection");

assert(hasVisibleMarkdownContent("Hello world"), "plain text is visible");
assert(
  hasVisibleMarkdownContent("# Heading\n\nSome text"),
  "markdown with heading and paragraph is visible",
);
assert(
  !hasVisibleMarkdownContent("<think></think>"),
  "empty pseudo HTML tag is not visible",
);
assert(
  !hasVisibleMarkdownContent("   \n\n   "),
  "only whitespace is not visible",
);
assert(
  !hasVisibleMarkdownContent("```\n\n```"),
  "empty fenced code block is not visible",
);
assert(
  hasVisibleMarkdownContent("[link](https://example.com)"),
  "link text is visible",
);

// ============================================================
// 26. sanitizeResponseContent — 模型特殊 token 过滤
// ============================================================
section("sanitizeResponseContent — special token filtering");

eq(
  sanitizeResponseContent("hello<|endoftext|>world"),
  "hello world",
  "移除 <|endoftext|>",
);
eq(
  sanitizeResponseContent("<|im_start|>system<|im_end|>"),
  "system",
  "移除 <|im_start|> 和 <|im_end|>",
);
eq(
  sanitizeResponseContent("<s>content</s>"),
  "content",
  "移除 <s> 和 </s>",
);
eq(
  sanitizeResponseContent("prefix<|unclosed"),
  "prefix",
  "移除末尾未闭合的 <| 片段",
);
eq(
  sanitizeResponseContent("完整<|end▁of▁sentence|> token"),
  "完整  token",
  "移除带下划线的特殊 token，保留单个空格",
);
eq(
  sanitizeResponseContent("  <|endoftext|>   "),
  "",
  "只剩 token 时 trim 后为空",
);
eq(
  sanitizeResponseContent("没有 token 的文本"),
  "没有 token 的文本",
  "普通文本不受影响",
);

// ============================================================
// 27. normalizeHtmlLineBreaks — HTML 换行归一化
// ============================================================
section("normalizeHtmlLineBreaks — HTML line break normalization");

eq(
  normalizeHtmlLineBreaks("A<br>B"),
  "A\nB",
  "<br> 转 newline",
);
eq(
  normalizeHtmlLineBreaks("A<br/>B"),
  "A\nB",
  "<br/> 转 newline",
);
eq(
  normalizeHtmlLineBreaks("A<br />B"),
  "A\nB",
  "<br /> 转 newline",
);
eq(
  normalizeHtmlLineBreaks("A<p>B</p>C"),
  "A\nB\nC",
  "<p> 与 </p> 均转 newline",
);
eq(
  normalizeHtmlLineBreaks("no html"),
  "no html",
  "无 HTML 标签保持不变",
);

// ============================================================
// Summary
// ============================================================
console.log(`\n${"═".repeat(50)}`);
console.log(`  Passed: ${passed}  |  Failed: ${failed}`);
console.log(`${"═".repeat(50)}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(f);
  }
  process.exit(1);
} else {
  console.log("\n✓ All tests passed!");
}
