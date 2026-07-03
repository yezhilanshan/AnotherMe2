// MarkdownRenderer 纯逻辑单元测试
// 运行: npx tsx lib/markdown-renderer-pure.test.ts

import {
  TEACHING_PATTERNS,
  preprocessTeachingLines,
  KEYWORDS,
  tokenizeLine,
  softWrapLongTokens,
  LONG_TOKEN_RE_FINAL,
  SOFT_WRAP_FINAL,
  estimateTableCellWidth,
  calculateTableColumnWidths,
  DEFAULT_TABLE_CELL_WIDTH,
  MAX_TABLE_CELL_WIDTH,
  TABLE_CHAR_WIDTH,
  TABLE_CELL_PADDING,
  FLEX_WRAP_TOKEN_THRESHOLD,
  hasLongUnbreakableToken,
  INLINE_RE,
  isMathToken,
  unwrapMathToken,
} from "./markdown-renderer-pure";

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
// 1. preprocessTeachingLines
// ============================================================
section("preprocessTeachingLines");

eq(
  preprocessTeachingLines("提示：先画图"),
  "> **💡 提示：** 先画图",
  "中文提示转换为引用块",
);
eq(
  preprocessTeachingLines("Hint: draw first"),
  "> **💡 Hint：** draw first",
  "英文 Hint 转换为引用块",
);
eq(
  preprocessTeachingLines("步骤：代入公式"),
  "> **👣 步骤：** 代入公式",
  "步骤标签",
);
eq(
  preprocessTeachingLines("知识点：勾股定理"),
  "> **📚 知识点：** 勾股定理",
  "知识点标签",
);
eq(
  preprocessTeachingLines("错因分析：符号错误"),
  "> **⚠️ 错因分析：** 符号错误",
  "错因分析标签",
);
eq(
  preprocessTeachingLines("小测：试算一下"),
  "> **📝 小测：** 试算一下",
  "小测标签",
);
eq(
  preprocessTeachingLines("学习状态：已掌握"),
  "> **📊 学习状态：** 已掌握",
  "学习状态标签",
);
eq(
  preprocessTeachingLines("下一步：做练习"),
  "> **👉 下一步：** 做练习",
  "下一步标签",
);
eq(
  preprocessTeachingLines("普通段落 unaffected"),
  "普通段落 unaffected",
  "无教学标签保持不变",
);
eq(
  preprocessTeachingLines("提示：A\n普通\nHint: B"),
  "> **💡 提示：** A\n普通\n> **💡 Hint：** B",
  "多行混合处理",
);
assert(TEACHING_PATTERNS.length === 7, "教学标签共 7 组");

// ============================================================
// 2. tokenizeLine
// ============================================================
section("tokenizeLine");

deepEq(tokenizeLine(""), [], "空行返回空数组");

deepEq(
  tokenizeLine("const x = 1;"),
  [
    { text: "const", color: KEYWORDS.const },
    { text: " ", color: "#abb2bf" },
    { text: "x", color: "#abb2bf" },
    { text: " ", color: "#abb2bf" },
    { text: "=", color: "#abb2bf" },
    { text: " ", color: "#abb2bf" },
    { text: "1", color: "#d19a66" },
    { text: ";", color: "#abb2bf" },
  ],
  "关键字、标识符、数字、运算符分色正确",
);

deepEq(
  tokenizeLine('const s = "hello";'),
  [
    { text: "const", color: KEYWORDS.const },
    { text: " ", color: "#abb2bf" },
    { text: "s", color: "#abb2bf" },
    { text: " ", color: "#abb2bf" },
    { text: "=", color: "#abb2bf" },
    { text: " ", color: "#abb2bf" },
    { text: '"hello"', color: "#98c379" },
    { text: ";", color: "#abb2bf" },
  ],
  "字符串使用字符串色",
);

deepEq(
  tokenizeLine("// comment"),
  [{ text: "// comment", color: "#5c6370" }],
  "单行注释使用注释色",
);

deepEq(
  tokenizeLine("True False null undefined"),
  [
    { text: "True", color: KEYWORDS.True },
    { text: " ", color: "#abb2bf" },
    { text: "False", color: KEYWORDS.False },
    { text: " ", color: "#abb2bf" },
    { text: "null", color: KEYWORDS.null },
    { text: " ", color: "#abb2bf" },
    { text: "undefined", color: KEYWORDS.undefined },
  ],
  "常量字面量使用常量色",
);

// ============================================================
// 3. softWrapLongTokens
// ============================================================
section("softWrapLongTokens");

eq(
  softWrapLongTokens("short"),
  "short",
  "短文本不插入零宽空格",
);

const twenty = "a".repeat(20);
eq(
  softWrapLongTokens(twenty),
  twenty,
  "刚好 20 个字符且后续无字符，不插入",
);

const twentyOne = "b".repeat(21);
eq(
  softWrapLongTokens(twentyOne),
  `${"b".repeat(20)}${SOFT_WRAP_FINAL}b`,
  "21 个连续字符在第 20 位后插入零宽空格",
);

const fifty = "c".repeat(50);
const wrapped50 = softWrapLongTokens(fifty);
assert(
  wrapped50.length === 50 + 2 && wrapped50.split(SOFT_WRAP_FINAL).length === 3,
  "50 个连续字符插入 2 个零宽空格",
);

const mixed = `prefix${"d".repeat(25)}suffix`;
assert(
  softWrapLongTokens(mixed).includes(SOFT_WRAP_FINAL),
  "混合文本中的长段被断开",
);

// ============================================================
// 4. estimateTableCellWidth
// ============================================================
section("estimateTableCellWidth");

eq(
  estimateTableCellWidth(""),
  DEFAULT_TABLE_CELL_WIDTH,
  "空文本使用默认宽度",
);

eq(
  estimateTableCellWidth("ab"),
  DEFAULT_TABLE_CELL_WIDTH,
  "短 ASCII 文本使用最小宽度",
);

// 30 个 ASCII 字符：30*8+20 = 260，被上限截断到 240
eq(
  estimateTableCellWidth("a".repeat(30)),
  MAX_TABLE_CELL_WIDTH,
  "超长 ASCII 文本被上限截断",
);

// 25 个 ASCII：25*8+20 = 220
eq(
  estimateTableCellWidth("a".repeat(25)),
  25 * TABLE_CHAR_WIDTH + TABLE_CELL_PADDING,
  "中等长度 ASCII 文本按公式计算",
);

// 10 个中文字符：10*1.5*8+20 = 140
eq(
  estimateTableCellWidth("中文字符十个中文字符"),
  10 * 1.5 * TABLE_CHAR_WIDTH + TABLE_CELL_PADDING,
  "中文字符按 1.5 倍宽度估算",
);

// 混合：5 中文 + 5 ASCII = 5*1.5*8 + 5*8 + 20 = 60+40+20=120
eq(
  estimateTableCellWidth("中文中文中abcde"),
  5 * 1.5 * TABLE_CHAR_WIDTH + 5 * TABLE_CHAR_WIDTH + TABLE_CELL_PADDING,
  "中英混合宽度估算正确",
);

// ============================================================
// 5. calculateTableColumnWidths
// ============================================================
section("calculateTableColumnWidths");

deepEq(
  calculateTableColumnWidths(["A", "B"], []),
  [estimateTableCellWidth("A"), estimateTableCellWidth("B")],
  "无行时返回表头宽度",
);

deepEq(
  calculateTableColumnWidths(["A"], [["longertext"]]),
  [estimateTableCellWidth("longertext")],
  "行内容更宽时取行最大值",
);

deepEq(
  calculateTableColumnWidths(["A"], [["a", "bbb"]]),
  [
    estimateTableCellWidth("a"),
    estimateTableCellWidth("bbb"),
  ],
  "行比表头多列时补充列宽",
);

deepEq(
  calculateTableColumnWidths(["Name", "Score"], [
    ["Alice", "90"],
    ["Bob", "100"],
  ]),
  [
    estimateTableCellWidth("Alice"),
    estimateTableCellWidth("Score"),
  ],
  "多行取每列最宽值",
);

// ============================================================
// 6. hasLongUnbreakableToken
// ============================================================
section("hasLongUnbreakableToken");

assert(
  !hasLongUnbreakableToken("普通文本没有超长 token"),
  "普通文本返回 false",
);
assert(
  !hasLongUnbreakableToken("a".repeat(FLEX_WRAP_TOKEN_THRESHOLD)),
  "刚好阈值长度返回 false",
);
assert(
  hasLongUnbreakableToken("a".repeat(FLEX_WRAP_TOKEN_THRESHOLD + 1)),
  "超过阈值的无空格串返回 true",
);
assert(
  hasLongUnbreakableToken(`start ${"x".repeat(60)} end`),
  "中间存在超长 token 返回 true",
);

// ============================================================
// 7. INLINE_RE 行内元素匹配
// ============================================================
section("INLINE_RE token matching");

function matchInline(text: string): string[] {
  INLINE_RE.lastIndex = 0;
  return Array.from(text.matchAll(INLINE_RE)).map((m) => m[0]);
}

deepEq(
  matchInline("`code`"),
  ["`code`"],
  "匹配行内代码",
);

deepEq(
  matchInline("**bold**"),
  ["**bold**"],
  "匹配粗体",
);

deepEq(
  matchInline("*italic*"),
  ["*italic*"],
  "匹配斜体",
);

deepEq(
  matchInline("[link](https://a.com)"),
  ["[link](https://a.com)"],
  "匹配链接",
);

deepEq(
  matchInline("$x^2$"),
  ["$x^2$"],
  "匹配行内公式",
);

deepEq(
  matchInline("$$a^2+b^2=c^2$$"),
  ["$$a^2+b^2=c^2$$"],
  "匹配 display 公式",
);

deepEq(
  matchInline("\\(\\alpha\\)"),
  ["\\(\\alpha\\)"],
  "匹配 \\( \\) 公式",
);

deepEq(
  matchInline("\\[\\frac{1}{2}\\]"),
  ["\\[\\frac{1}{2}\\]"],
  "匹配 \\[ \\] 公式",
);

deepEq(
  matchInline("\\sqrt{x}"),
  ["\\sqrt{x}"],
  "匹配裸 LaTeX 命令",
);

deepEq(
  matchInline("x^2 and a_i"),
  ["x^2", "a_i"],
  "匹配上下标",
);

deepEq(
  matchInline("$a$ and $b$"),
  ["$a$", "$b$"],
  "多个行内公式不互相吞噬",
);

// ============================================================
// 8. isMathToken
// ============================================================
section("isMathToken");

assert(isMathToken("$$x$$"), "display math 是数学 token");
assert(isMathToken("$x$"), "inline math 是数学 token");
assert(isMathToken("\\(x\\)"), "\\( \\) 是数学 token");
assert(isMathToken("\\[x\\]"), "\\[ \\] 是数学 token");
assert(isMathToken("\\alpha"), "裸 LaTeX 命令是数学 token");
assert(isMathToken("x^2"), "上标是数学 token");
assert(isMathToken("a_i"), "下标是数学 token");
assert(!isMathToken("**bold**"), "粗体不是数学 token");
assert(!isMathToken("`code`"), "行内代码不是数学 token");
assert(!isMathToken("plain text"), "普通文本不是数学 token");

// ============================================================
// 9. unwrapMathToken
// ============================================================
section("unwrapMathToken");

eq(unwrapMathToken("$$x$$"), "x", "unwrap display math");
eq(unwrapMathToken("$x$"), "x", "unwrap inline math");
eq(unwrapMathToken("\\(x\\)"), "x", "unwrap \\( \\)");
eq(unwrapMathToken("\\[x\\]"), "x", "unwrap \\[ \\]");
eq(unwrapMathToken("\\alpha"), "\\alpha", "裸命令保持不变");
eq(unwrapMathToken("x^2"), "x^2", "上下标保持不变");

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
