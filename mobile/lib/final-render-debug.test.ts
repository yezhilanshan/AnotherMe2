/**
 * 调试最终渲染内容重复问题
 * 运行: npx tsx lib/final-render-debug.test.ts
 */
import { parseMarkdown } from "./latex-utils";

const correctContent = `你好！我是 AnotherMe，你的智能 AI 学习助手。很高兴为你讲解数学中非常经典且重要的定理——**勾股定理**（Pythagorean theorem）。

让我们一步步来拆解这个定理，让你不仅能记住它，还能真正理解它！

---

### 1. 核心定义与公式
**勾股定理**描述的是**直角三角形**三条边之间的长度关系。

* **文字表述**：在一个直角三角形中，两条直角边的平方和，等于斜边的平方。
* **数学公式**：$$a^2 + b^2 = c^2$$

⚠️ **关键提醒**：在这个公式中，**$c$ 必须代表斜边**（也就是直角对面那条最长的边），而 $a$ 和 $b$ 代表两条直角边。

### 2. 直观理解：面积的魔法 🧩
不要只把它当成死记硬背的公式，我们可以用**面积**来直观地理解它：

想象你在直角三角形的三条边上，分别向外画三个正方形：
* 在直角边 $a$ 上画一个正方形，面积是 $a^2$。
* 在直角边 $b$ 上画一个正方形，面积是 $b^2$。
* 在斜边 $c$ 上画一个正方形，面积是 $c^2$。

**勾股定理的几何意义就是**：两个较小正方形的面积加起来，刚好等于最大正方形的面积！你可以把它想象成一种“面积守恒”的拼图游戏。

### 3. 动手算一算：经典例子 📝
让我们通过一个例子来应用它。

**例子 1：已知两条直角边，求斜边**
假设一个直角三角形的两条直角边分别是 3 和 4。求斜边 $c$。
* 代入公式：$3^2 + 4^2 = c^2$
* 计算平方：$9 + 16 = c^2$
* 相加：$25 = c^2$
* 开平方根：$c = \\sqrt{25} = 5$
*(这就是中国古代数学中著名的“勾三，股四，弦五”！)*

**例子 2：已知斜边和一条直角边，求另一条直角边**
假设斜边 $c = 13$，一条直角边 $a = 5$。求另一条直角边 $b$。
* 代入公式：$5^2 + b^2 = 13^2$
* 计算平方：$25 + b^2 = 169$
* 移项：$b^2 = 169 - 25$
* 相减：$b^2 = 144$
* 开平方根：$b = \\sqrt{144} = 12$

### 4. 勾股定理的“逆定理” 🔄
勾股定理不仅能帮你**算边长**，还能帮你**判断形状**。

**逆定理**：如果一个三角形的三边长 $a, b, c$ 满足 $a^2 + b^2 = c^2$，那么这个三角形**一定是直角三角形**（且 $c$ 边对应的角是直角）。
* *应用*：如果你想知道一个墙角是不是完美的 90 度直角，你可以从墙角量出 3 米和 4 米做记号，如果这两个记号之间的直线距离刚好是 5 米，那这个墙角就是绝对标准的直角！（建筑工人常用这个方法）。

### 5. 历史小趣闻 📜
* **在中国**：这个定理最早记录于《周髀算经》中。古人把直角三角形中较短的直角边称为“勾”，较长的直角边称为“股”，斜边称为“弦”，因此得名“勾股定理”。
* **在西方**：古希腊数学家毕达哥拉斯（Pythagoras）也独立发现并证明了这个定理，所以在西方它被称为“毕达哥拉斯定理”（或“百牛定理”，传说毕达哥拉斯发现它后高兴得杀了一百头牛来庆祝）。

---

**总结一下**：勾股定理是连接代数（平方、方程）和几何（三角形、面积）的一座重要桥梁。

你目前是在学习勾股定理的哪个部分呢？是刚开始接触概念，还是在做一些复杂的综合应用题（比如结合坐标系、立体图形）？如果有具体的题目或疑惑，随时发给我，我们一起解决！`;

function summarizeBlock(block: any, i: number) {
  const preview = (block.content || "").slice(0, 60).replace(/\n/g, "\\n");
  return `${i}: ${block.type}${block.level ? "(h" + block.level + ")" : ""} "${preview}"`;
}

console.log("=== 最终内容 parseMarkdown 分块 ===");
const blocks = parseMarkdown(correctContent, false);
console.log(`blocks count: ${blocks.length}`);
blocks.forEach((b, i) => console.log(summarizeBlock(b, i)));

function normalizeHtmlLineBreaks(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n");
}

// 模拟 answerBlocks 提取（与后端 _extract_answer_blocks 逻辑对齐）
function extractAnswerBlocks(markdown: string) {
  const blocks: { type: string; content: string; index: number }[] = [];
  const text_lines: string[] = [];
  const lines = normalizeHtmlLineBreaks(markdown).split(/\r?\n/);
  let i = 0;

  function flushText() {
    const content = text_lines.join("\n").trim();
    text_lines.length = 0;
    if (!content) return;
    blocks.push({ type: "markdown", content, index: blocks.length });
  }

  while (i < lines.length) {
    const line = lines[i];
    const stripped = line.trim();

    if (stripped.startsWith("```") || stripped.startsWith("~~~")) {
      const fence = stripped.slice(0, 3);
      text_lines.push(line);
      i++;
      while (i < lines.length) {
        text_lines.push(lines[i]);
        if (lines[i].trim().startsWith(fence)) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (stripped.startsWith("$$")) {
      flushText();
      const first = stripped.slice(2);
      if (first.endsWith("$$") && first.length > 2) {
        const formula = first.slice(0, -2).trim();
        if (formula) blocks.push({ type: "math", content: formula, index: blocks.length });
        i++;
        continue;
      }
      const formulaLines: string[] = [];
      if (first) formulaLines.push(first);
      i++;
      while (i < lines.length) {
        const current = lines[i].trim();
        if (current.endsWith("$$")) {
          const tail = current.slice(0, -2).trim();
          if (tail) formulaLines.push(tail);
          i++;
          break;
        }
        formulaLines.push(lines[i]);
        i++;
      }
      const formula = formulaLines.join("\n").trim();
      if (formula) blocks.push({ type: "math", content: formula, index: blocks.length });
      continue;
    }

    if (stripped === "") {
      // 空行分块，与后端对齐：HTML <br><br> 规范化后是 \n\n，不能合并成一个大块
      if (text_lines.length > 0) {
        flushText();
      }
      i++;
      continue;
    }

    if (text_lines.length > 0 && (
      /^#{1,6}\s+/.test(stripped) ||
      /^\*\*\s*(?:\d+[.、]|步骤|Step\b)/.test(stripped)
    )) {
      flushText();
    }
    text_lines.push(line);
    i++;
  }

  flushText();
  return blocks;
}

console.log("\n=== 模拟后端 answerBlocks 提取 ===");
const answerBlocks = extractAnswerBlocks(correctContent);
console.log(`answerBlocks count: ${answerBlocks.length}`);
answerBlocks.forEach((b, i) => console.log(summarizeBlock(b, i)));

// 模拟 HTML <br> 版本的 answerBlocks
const htmlContent = correctContent.replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>");
console.log("\n=== 模拟后端对 HTML <br> 内容的 answerBlocks 提取 ===");
const htmlAnswerBlocks = extractAnswerBlocks(htmlContent);
console.log(`htmlAnswerBlocks count: ${htmlAnswerBlocks.length}`);
htmlAnswerBlocks.forEach((b, i) => console.log(summarizeBlock(b, i)));

const aligned =
  answerBlocks.length === htmlAnswerBlocks.length &&
  answerBlocks.every(
    (b, i) =>
      b.type === htmlAnswerBlocks[i].type &&
      b.content === htmlAnswerBlocks[i].content,
  );
console.log("\n=== Markdown 与 HTML <br> 版本分块是否一致 ===");
console.log(aligned ? "一致 ✅" : "不一致 ❌");
if (!aligned) {
  process.exit(1);
}
