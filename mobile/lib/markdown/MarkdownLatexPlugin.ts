// Adapted from ChatterUI: lib/markdown/MarkdownLatexPlugin.jsx
// Detects LaTeX math: $$...$$, \[...\], \(...\), $...$

export default function latexDetectorPlugin(md: any) {
  // ── Block math: \[...\] and $$...$$ ──
  md.block.ruler.before(
    "fence",
    "latex_block_math",
    function (state: any, startLine: number, endLine: number, silent: boolean) {
      const start = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];
      const line = state.src.slice(start, max).trim();

      const isBracket = line.startsWith("\\[");
      const isDollar = line.startsWith("$$");

      if (!isBracket && !isDollar) return false;

      let nextLine = startLine;
      let content = "";
      let found = false;

      if (isBracket && line.endsWith("\\]")) {
        content = line.slice(2, -2).trim();
        found = true;
        nextLine++;
      } else if (isDollar && line.endsWith("$$") && line.length > 4) {
        content = line.slice(2, -2).trim();
        found = true;
        nextLine++;
      } else {
        content = line.slice(2) + "\n";
        nextLine++;
        while (nextLine < endLine) {
          const nextStart = state.bMarks[nextLine] + state.tShift[nextLine];
          const nextMax = state.eMarks[nextLine];
          const nextLineText = state.src.slice(nextStart, nextMax).trim();

          if (
            (isBracket && nextLineText.endsWith("\\]")) ||
            (isDollar && nextLineText === "$$")
          ) {
            content += isBracket ? nextLineText.slice(0, -2) : "";
            found = true;
            nextLine++;
            break;
          }

          content += nextLineText + "\n";
          nextLine++;
        }
      }

      if (!found) return false;
      if (silent) return true;

      const token = state.push("latex_block", "math", 0);
      token.block = true;
      token.content = content.trim();
      token.map = [startLine, nextLine];
      state.line = nextLine;
      return true;
    },
  );

  // ── Inline math: $...$, $$...$$, \[...\], \(...\) ──
  md.inline.ruler.before("escape", "latex_inline", function (state: any, silent: boolean) {
    const start = state.pos;
    const max = state.posMax;
    const src = state.src;

    if (start >= max) return false;

    // --- $$...$$ inline ---
    if (src[start] === "$" && src[start + 1] === "$") {
      let end = start + 2;
      while (end < max) {
        if (src[end] === "$" && src[end + 1] === "$") {
          if (silent) return true;
          const token = state.push("latex_inline", "math", 0);
          token.content = src.slice(start + 2, end);
          state.pos = end + 2;
          return true;
        }
        end++;
      }
    }

    // --- \[...\] inline ---
    if (src.startsWith("\\[", start)) {
      const end = src.indexOf("\\]", start + 2);
      if (end !== -1 && end < max) {
        if (silent) return true;
        const token = state.push("latex_inline", "math", 0);
        token.content = src.slice(start + 2, end);
        state.pos = end + 2;
        return true;
      }
    }

    // --- \(...\) inline ---
    if (src.startsWith("\\(", start)) {
      const end = src.indexOf("\\)", start + 2);
      if (end !== -1 && end < max) {
        if (silent) return true;
        const token = state.push("latex_inline", "math", 0);
        token.content = src.slice(start + 2, end);
        state.pos = end + 2;
        return true;
      }
    }

    // --- $...$ (not $$...$$) ---
    if (
      src[start] === "$" &&
      src[start + 1] !== "$" &&
      (start === 0 || src[start - 1] !== "$")
    ) {
      let end = start + 1;
      while (end < max) {
        if (src[end] === "$") {
          // Ensure not escaped
          let backslashes = 0;
          let k = end - 1;
          while (k >= 0 && src[k] === "\\") {
            backslashes++;
            k--;
          }
          if (backslashes % 2 === 0) break;
        }
        end++;
      }

      if (end < max && src[end] === "$") {
        if (silent) return true;
        const token = state.push("latex_inline", "math", 0);
        token.content = src.slice(start + 1, end);
        state.pos = end + 1;
        return true;
      }
    }

    return false;
  });
}
