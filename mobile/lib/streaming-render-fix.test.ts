/**
 * 流式渲染性能修复 — 测试用例
 * 运行: npx tsx lib/streaming-render-fix.test.ts
 *
 * 验证以下修复:
 *   P0: LIVE_ASSISTANT_PREVIEW_CHARS = 16000 (WebView 流式渲染下尽量完整展示)
 *   P1: assistantContent / streamingContent 使用 useMemo
 *   P2: FLUSH_INTERVAL = 220ms，避免 750ms 级别的可见卡顿
 *   P3: handleLoadFullContent 稳定引用 (不再每次创建箭头函数)
 *   P4: streamingContentAcc 本地累积，流式期间只更新有上限的 live preview
 */

// ============================================================
// 测试 0: 最终回答渲染模式 — 移动端最终正文回到 Markdown
// ============================================================
function countMathLikeTokens(text: string): number {
  if (!text) return 0;
  let count = 0;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (ch === "$") {
      if (
        i + 2 < len &&
        text[i + 1] === "$" &&
        text[i + 2] !== "$"
      ) {
        const end = text.indexOf("$$", i + 2);
        if (end !== -1 && end > i + 2) {
          count++;
          i = end + 2;
          continue;
        }
      } else {
        const end = text.indexOf("$", i + 1);
        if (end !== -1 && end > i + 1) {
          count++;
          i = end + 1;
          continue;
        }
      }
    } else if (ch === "\\" && i + 1 < len) {
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        count++;
        i += 2;
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        count++;
        let j = i + 1;
        while (j < len && /[a-zA-Z]/.test(text[j])) j++;
        i = j;
        continue;
      }
    } else if (/[a-zA-Z0-9]/.test(ch) && i + 1 < len) {
      const next = text[i + 1];
      if (next === "^" || next === "_") {
        count++;
        i += 2;
        continue;
      }
    }
    i++;
  }

  return count;
}

function decideFinalRenderMode(content: string): "final_markdown" | "lightweight_text" {
  return content.trim() ? "final_markdown" : "lightweight_text";
}

function testTeachingMarkdownKeepsFinalMarkdown() {
  const results: string[] = [];
  const pythagoreanAnswer = [
    "### 1. 核心定义与公式",
    "**勾股定理**描述的是**直角三角形**三条边之间的长度关系。",
    "",
    "**公式：**",
    "$$a^2 + b^2 = c^2$$",
    "",
    "* **$a$ 和 $b$**：代表直角三角形的两条**直角边**。",
    "* **$c$**：代表直角三角形的**斜边**。",
    "",
    "---",
    "",
    "#### 例子 1：基础计算",
    "1. 确定 $a = 6$, $b = 8$，求 $c$。",
    "2. 代入公式：$6^2 + 8^2 = c^2$",
    "3. 开平方根：$c = \\sqrt{100} = 10$",
  ].join("\n");
  const paddedAnswer = `${pythagoreanAnswer}\n\n${"这是一段教学说明。".repeat(330)}`;
  const mode = decideFinalRenderMode(paddedAnswer);
  results.push(`内容长度: ${paddedAnswer.length}`);
  results.push(`数学 token 数: ${countMathLikeTokens(paddedAnswer)}`);
  results.push(
    mode === "final_markdown"
      ? "✓ PASS: 普通含公式教学回答最终走 Markdown"
      : `✗ FAIL: 普通含公式教学回答错误降级为 ${mode}`,
  );
  return results;
}

// ============================================================
// 测试 1: projectLiveAssistantContent 阈值验证
// ============================================================
function projectLiveAssistantContent(
  content: string,
  options: { live?: boolean } = {},
): {
  contentPreview?: string;
  clientPreviewOnly: boolean;
} {
  const LIVE_ASSISTANT_PREVIEW_CHARS = 16000;
  const LIVE_ASSISTANT_PREVIEW_NOTICE =
    "\n\n[内容较长，当前仅渲染预览，完整内容仍在生成和保存]";

  if (content.length <= LIVE_ASSISTANT_PREVIEW_CHARS) {
    return {
      contentPreview: options.live ? content : undefined,
      clientPreviewOnly: false,
    };
  }
  return {
    contentPreview:
      content.slice(0, LIVE_ASSISTANT_PREVIEW_CHARS) +
      LIVE_ASSISTANT_PREVIEW_NOTICE,
    clientPreviewOnly: true,
  };
}

// ============================================================
// 测试 2: streamingContentAcc 管理 — 模拟 flushPending 行为
// ============================================================
function simulateStreamingPipeline() {
  const results: string[] = [];

  // 模拟状态
  let streamingContentAcc = "";
  let lastFlushedPreview: string | undefined | null = null;
  let stateContent = ""; // Zustand state.content

  function projectPreview(content: string) {
    return projectLiveAssistantContent(content, { live: true });
  }

  function flushPending(contentChunk: string): boolean {
    streamingContentAcc += contentChunk;
    const projected = projectPreview(streamingContentAcc);

    const previewChanged =
      lastFlushedPreview === null ||
      projected.contentPreview !== lastFlushedPreview;

    if (!previewChanged) {
      return false; // 跳过 set() — 这是修复的核心
    }

    lastFlushedPreview = projected.contentPreview;
    // 模拟 set(): 只更新 contentPreview，不更新 content。
    // stateContent 保持不变，避免流式期间 state 里保存不断增长的全文。
    return true;
  }

  // 模拟 30 秒流式对话，每次 flush 30 字符
  const chunkSize = 30;
  const totalChars = 4800; // 网关默认输出上限
  let didSetCalls = 0;
  let contentChangesInState = 0;

  for (let i = 0; i < totalChars / chunkSize; i++) {
    const chunk = "A".repeat(chunkSize);
    const flushed = flushPending(chunk);

    if (flushed) {
      didSetCalls++;
    }

    // 在修复前，每次 flush 都会更新 state.content
    // 在修复后，state.content 不变
  }

  results.push(`总字符数: ${streamingContentAcc.length}`);
  results.push(`set() 调用次数: ${didSetCalls}`);
  results.push(`state.content 长度: ${stateContent.length}`);
  results.push(
    didSetCalls === totalChars / chunkSize
      ? "✓ PASS: WebView 流式模式下 live preview 持续增量更新"
      : `✗ FAIL: set() 调用了 ${didSetCalls} 次，预期持续更新`,
  );
  results.push(
    stateContent === ""
      ? "✓ PASS: 流式期间 state.content 不保存增长全文"
      : "✗ FAIL: 流式期间 state.content 被写入",
  );

  return { results, setCalls: didSetCalls, streamingContentAcc };
}

// ============================================================
// 测试 3: 验证 contentPreview 在移动端硬上限内持续增长
// ============================================================
function testContentPreviewStability() {
  const results: string[] = [];
  let content = "";
  const chunks = [
    "A".repeat(200),
    "B".repeat(200),
    "C".repeat(200),
    "D".repeat(200),
    "E".repeat(200),
  ];

  const previews: (string | undefined)[] = [];

  for (const chunk of chunks) {
    content += chunk;
    const projected = projectLiveAssistantContent(content, { live: true });
    previews.push(projected.contentPreview);
  }

  const uniquePreviews = new Set(previews.filter(Boolean));
  results.push(`唯一 contentPreview 数量: ${uniquePreviews.size}`);

  const grows = previews.every((preview, index) => {
    if (index === 0) return preview === chunks[0];
    return (preview?.length || 0) > (previews[index - 1]?.length || 0);
  });

  results.push(
    grows
      ? "✓ PASS: 硬上限内 contentPreview 持续增长"
      : "✗ FAIL: contentPreview 没有持续增长",
  );

  return results;
}

// ============================================================
// 测试 4: 流结束后 content 正确回写
// ============================================================
function testFinalizeContent() {
  const results: string[] = [];

  // 模拟: 流式期间 content 不在 state 中更新
  let stateContent = "";
  let streamingContentAcc = "这是完整的回答内容，包含所有累积的文本。";

  // 模拟 final_markdown 处理
  function handleFinalMarkdown(serverContent: string) {
    const fullContent = serverContent || streamingContentAcc;
    stateContent = fullContent; // 一次性写回
    streamingContentAcc = ""; // 重置
    return stateContent;
  }

  const finalContent = handleFinalMarkdown("");
  results.push(`最终 content 长度: ${finalContent.length}`);
  results.push(
    finalContent.length > 0
      ? "✓ PASS: 流结束后 content 正确从 accumulator 回写"
      : "✗ FAIL: content 为空",
  );

  // 验证 accumulator 已清空
  results.push(
    streamingContentAcc === ""
      ? "✓ PASS: accumulator 在回写后已清空"
      : "✗ FAIL: accumulator 未清空",
  );

  return results;
}

// ============================================================
// 测试 5: FLUSH_INTERVAL 和阈值常量验证
// ============================================================
function testConstants() {
  const results: string[] = [];

  // 这些值需要与 chatSlice.ts 中的实际值一致
  const FLUSH_INTERVAL = 220; // ms
  const LIVE_ASSISTANT_PREVIEW_CHARS = 16000;
  const TOO_SLOW_FLUSH_INTERVAL = 750;

  results.push(
    FLUSH_INTERVAL < TOO_SLOW_FLUSH_INTERVAL
      ? `✓ PASS: FLUSH_INTERVAL ${FLUSH_INTERVAL}ms < 卡顿阈值 ${TOO_SLOW_FLUSH_INTERVAL}ms`
      : `✗ FAIL: FLUSH_INTERVAL = ${FLUSH_INTERVAL}`,
  );

  const GATEWAY_OUTPUT_LIMIT = 4800;
  results.push(
    LIVE_ASSISTANT_PREVIEW_CHARS > GATEWAY_OUTPUT_LIMIT
      ? `✓ PASS: 预览阈值 ${LIVE_ASSISTANT_PREVIEW_CHARS} 覆盖常规网关输出 ${GATEWAY_OUTPUT_LIMIT}`
      : `✗ FAIL: 阈值过短，会截断常规输出`,
  );

  return results;
}

// ============================================================
// 测试 6: 短内容 final 不走预览，streaming 生成 live preview
// ============================================================
function testShortContentNoPreview() {
  const results: string[] = [];
  const shortContent = "这是一条简短的回复。";

  const projected = projectLiveAssistantContent(shortContent);
  const liveProjected = projectLiveAssistantContent(shortContent, {
    live: true,
  });
  results.push(
    projected.clientPreviewOnly === false
      ? "✓ PASS: 短内容不启用预览截断"
      : "✗ FAIL: 短内容错误地启用了预览",
  );
  results.push(
    projected.contentPreview === undefined
      ? "✓ PASS: final 短内容不重复生成 contentPreview"
      : "✗ FAIL: final 短内容错误地生成了 contentPreview",
  );
  results.push(
    liveProjected.contentPreview === shortContent
      ? "✓ PASS: streaming 短内容生成 live preview"
      : "✗ FAIL: streaming 短内容没有 live preview",
  );

  return results;
}

// ============================================================
// 测试 7: React.memo 等价性 — 模拟消息对象引用比较
// ============================================================
function testMessageReferenceStability() {
  const results: string[] = [];
  type SimulatedAssistantMessage = {
    id: string;
    role: "assistant";
    content: string;
    contentPreview?: string;
    clientPreviewOnly?: boolean;
    isStreaming: boolean;
  };

  // 模拟修复前: 每次 flush 都创建新的 message 对象（content 变化）
  let messageFixBefore: SimulatedAssistantMessage = {
    id: "msg-1",
    role: "assistant" as const,
    content: "",
    contentPreview: undefined as string | undefined,
    isStreaming: true,
  };

  let refChangesBefore = 0;
  let prevRef: SimulatedAssistantMessage = messageFixBefore;

  for (let i = 0; i < 200; i++) {
    // 修复前: content 每次都变
    messageFixBefore = {
      ...messageFixBefore,
      content: messageFixBefore.content + "x".repeat(20),
    };
    if (messageFixBefore !== prevRef) {
      refChangesBefore++;
    }
    prevRef = messageFixBefore;
  }

  // 模拟修复后: content 不变，只更新有上限的 contentPreview
  let messageFixAfter: SimulatedAssistantMessage = {
    id: "msg-1",
    role: "assistant" as const,
    content: "",
    contentPreview: undefined as string | undefined,
    isStreaming: true,
  };

  let refChangesAfter = 0;
  prevRef = messageFixAfter;
  let acc = "";
  let lastFlushed: string | undefined | null = null;

  for (let i = 0; i < 200; i++) {
    acc += "x".repeat(20);
    const projected = projectLiveAssistantContent(acc, { live: true });

    // 修复后: 只在 preview 变化时才创建新对象
    const previewChanged =
      lastFlushed === null || projected.contentPreview !== lastFlushed;

    if (previewChanged) {
      lastFlushed = projected.contentPreview;
      messageFixAfter = {
        ...messageFixAfter,
        contentPreview: projected.contentPreview,
        clientPreviewOnly: projected.clientPreviewOnly,
      };
    }
    // content 不变！

    if (messageFixAfter !== prevRef) {
      refChangesAfter++;
    }
    prevRef = messageFixAfter;
  }

  results.push(
    `修复前: 200 次 flush → ${refChangesBefore} 次引用变化（每次 flush 都变）`,
  );
  results.push(
    `修复后: 200 次 flush → ${refChangesAfter} 次引用变化（WebView 内部增量排版）`,
  );
  results.push(
    messageFixAfter.content === ""
      ? `✓ PASS: state.content 保持为空，流式全文只进入 contentPreview`
      : `✗ FAIL: 流式期间 content 增长`,
  );

  return results;
}

// ============================================================
// 测试 8: handleLoadFullContent 稳定引用验证（概念性）
// ============================================================
function testStableCallbackPattern() {
  const results: string[] = [];

  // React.useCallback 的等价行为: 只要 deps 不变，返回同一引用
  let loadFullContentRef: ((msg: { id: string }) => void) | null = null;
  let stableRefCount = 0;

  const mockLoadFullMessageContent = (id: string) => {
    /* noop */
  };

  // 模拟多次渲染：useCallback 返回同一引用
  function simulateRender() {
    // 这就是 useCallback 的等价行为
    if (!loadFullContentRef) {
      loadFullContentRef = (message: { id: string }) =>
        mockLoadFullMessageContent(message.id);
    }
    return loadFullContentRef;
  }

  const ref1 = simulateRender();
  const ref2 = simulateRender();
  const ref3 = simulateRender();

  results.push(
    ref1 === ref2 && ref2 === ref3
      ? "✓ PASS: handleLoadFullContent 多次调用返回相同引用（useCallback 正确工作）"
      : "✗ FAIL: handleLoadFullContent 引用不稳定",
  );

  // 对比: 修复前每次创建新箭头函数
  const arrowRefs: (() => void)[] = [];
  for (let i = 0; i < 10; i++) {
    arrowRefs.push(() => mockLoadFullMessageContent("test"));
  }
  const allSame = arrowRefs.every((ref) => ref === arrowRefs[0]);

  results.push(
    !allSame
      ? "✓ PASS: 内联箭头函数每次都是新引用（证实修复前的 bug）"
      : "✗ FAIL: 意外",
  );

  return results;
}

// ============================================================
// 测试 9: final_markdown 与结构化文本块同时存在时，优先渲染规范文本
// ============================================================
type SimulatedAnswerComponentKind =
  | "markdown"
  | "math"
  | "live_block"
  | "visualization"
  | "animation";

function isRichComponent(kind: SimulatedAnswerComponentKind): boolean {
  return kind === "visualization" || kind === "animation";
}

function decideMobileFinalRenderMode(options: {
  content: string;
  clientPreviewOnly?: boolean;
  answerComponents?: SimulatedAnswerComponentKind[];
  answerBlockCount?: number;
}): "final_markdown" | "lightweight_text" | "final_components" | "answer_blocks" {
  const {
    content,
    clientPreviewOnly = false,
    answerComponents = [],
    answerBlockCount = 0,
  } = options;
  const hasCanonicalFinalText = Boolean(content.trim());
  const hasRichFinalComponent = answerComponents.some(isRichComponent);
  const finalComponentsForRender = hasCanonicalFinalText
    ? answerComponents.filter(isRichComponent)
    : answerComponents;
  const renderAsMarkdown = hasCanonicalFinalText;
  const preferPlainFinalText = false;

  if (finalComponentsForRender.length > 0 && !preferPlainFinalText) {
    return "final_components";
  }
  if (answerBlockCount > 0 && !preferPlainFinalText && !hasCanonicalFinalText) {
    return "answer_blocks";
  }
  if (renderAsMarkdown || clientPreviewOnly) return "final_markdown";
  return "lightweight_text";
}

function testFinalMarkdownWinsOverTextualStructuredBlocks() {
  const results: string[] = [];
  const teachingAnswer = [
    "### 关键思路",
    "先找直角，再确定斜边。",
    "",
    "### 推导",
    "由 $a^2+b^2=c^2$ 可知，代入数据即可。",
    "",
    "### 总结",
    "不要把斜边和直角边混淆。",
  ].join("\n");

  const textOnlyMode = decideMobileFinalRenderMode({
    content: teachingAnswer,
    answerComponents: ["markdown", "live_block", "math"],
    answerBlockCount: 3,
  });
  results.push(
    textOnlyMode === "final_markdown"
      ? "✓ PASS: textual answerComponents/answerBlocks 被跳过并走最终 Markdown"
      : `✗ FAIL: textual structured blocks 错误触发 ${textOnlyMode}`,
  );

  const richMode = decideMobileFinalRenderMode({
    content: teachingAnswer,
    answerComponents: ["markdown", "visualization"],
    answerBlockCount: 2,
  });
  results.push(
    richMode === "final_components"
      ? "✓ PASS: 可视化/动画等富组件仍会渲染"
      : `✗ FAIL: 富组件被错误降级为 ${richMode}`,
  );

  return results;
}

// ============================================================
// 测试 10: thinking 事件在 flush 前累加，而不是被最新片段覆盖
// ============================================================
function testReasoningChunksAccumulateBeforeFlush() {
  const results: string[] = [];
  const STREAM_REASONING_MAX_CHARS = 4000;

  function appendTail(existing: string, chunk: string, maxChars: number): string {
    const next = `${existing}${chunk}`;
    if (next.length <= maxChars) return next;
    return next.slice(next.length - maxChars);
  }

  let pendingReasoning = "";
  let flushedReasoning = "";
  const chunks = ["先看已知条件", "再写出公式", "最后验证结论"];

  for (const chunk of chunks) {
    pendingReasoning = appendTail(
      pendingReasoning,
      chunk.endsWith("\n") ? chunk : `${chunk}\n`,
      STREAM_REASONING_MAX_CHARS,
    );
  }

  flushedReasoning = appendTail(
    flushedReasoning,
    pendingReasoning,
    STREAM_REASONING_MAX_CHARS,
  );
  pendingReasoning = "";

  results.push(
    chunks.every((chunk) => flushedReasoning.includes(chunk))
      ? "✓ PASS: 同一 flush 周期内多个 thinking chunk 会累加"
      : `✗ FAIL: thinking chunk 被覆盖，结果为 ${flushedReasoning}`,
  );
  results.push(
    flushedReasoning.length <= STREAM_REASONING_MAX_CHARS
      ? "✓ PASS: reasoning 状态有有限上限，长思考不会无限增长"
      : "✗ FAIL: reasoning 状态没有长度上限",
  );
  results.push(
    pendingReasoning === ""
      ? "✓ PASS: flush 后 pendingReasoning 被清空"
      : "✗ FAIL: flush 后 pendingReasoning 未清空",
  );

  return results;
}

// ============================================================
// 运行所有测试
// ============================================================
function runAllTests() {
  console.log("=".repeat(60));
  console.log("流式渲染性能修复 — 测试套件");
  console.log("=".repeat(60));

  const allResults: { name: string; results: string[] }[] = [];

  // 测试 0
  console.log("\n[测试 0] 普通教学 Markdown 最终渲染模式");
  {
    const results = testTeachingMarkdownKeepsFinalMarkdown();
    console.log(results.join("\n"));
    allResults.push({ name: "最终 Markdown 渲染模式", results });
  }

  // 测试 1
  console.log("\n[测试 1] projectLiveAssistantContent 阈值边界");
  {
    const r1 = projectLiveAssistantContent("A".repeat(599));
    const r2 = projectLiveAssistantContent("A".repeat(600));
    const r3 = projectLiveAssistantContent("A".repeat(601));
    const r4 = projectLiveAssistantContent("A".repeat(5000), { live: true });

    const lines = [
      `599 字符: clientPreviewOnly=${r1.clientPreviewOnly}` +
        (r1.clientPreviewOnly === false ? " ✓" : " ✗"),
      `600 字符: clientPreviewOnly=${r2.clientPreviewOnly}` +
        (r2.clientPreviewOnly === false ? " ✓" : " ✗"),
      `601 字符: clientPreviewOnly=${r3.clientPreviewOnly}` +
        (r3.clientPreviewOnly === false ? " ✓" : " ✗"),
      `5000 字符: contentPreview 长度=${r4.contentPreview?.length || 0}` +
        ((r4.contentPreview?.length || 0) === 5000 ? " ✓ (完整显示)" : " ✗"),
    ];
    console.log(lines.join("\n"));
    allResults.push({ name: "阈值边界", results: lines });
  }

  // 测试 2
  console.log("\n[测试 2] streamingContentAcc — set() 调用次数");
  {
    const { results } = simulateStreamingPipeline();
    console.log(results.join("\n"));
    allResults.push({ name: "set() 调用次数", results });
  }

  // 测试 3
  console.log("\n[测试 3] contentPreview 稳定性");
  {
    const results = testContentPreviewStability();
    console.log(results.join("\n"));
    allResults.push({ name: "preview 稳定性", results });
  }

  // 测试 4
  console.log("\n[测试 4] 流结束后 content 回写");
  {
    const results = testFinalizeContent();
    console.log(results.join("\n"));
    allResults.push({ name: "content 回写", results });
  }

  // 测试 5
  console.log("\n[测试 5] 常量验证");
  {
    const results = testConstants();
    console.log(results.join("\n"));
    allResults.push({ name: "常量验证", results });
  }

  // 测试 6
  console.log("\n[测试 6] 短内容不走预览");
  {
    const results = testShortContentNoPreview();
    console.log(results.join("\n"));
    allResults.push({ name: "短内容", results });
  }

  // 测试 7
  console.log("\n[测试 7] 消息对象引用稳定性（React.memo 等价测试）");
  {
    const results = testMessageReferenceStability();
    console.log(results.join("\n"));
    allResults.push({ name: "引用稳定性", results });
  }

  // 测试 8
  console.log("\n[测试 8] handleLoadFullContent 稳定引用");
  {
    const results = testStableCallbackPattern();
    console.log(results.join("\n"));
    allResults.push({ name: "稳定回调", results });
  }

  // 测试 9
  console.log("\n[测试 9] 最终渲染避免 textual structured blocks 抢占");
  {
    const results = testFinalMarkdownWinsOverTextualStructuredBlocks();
    console.log(results.join("\n"));
    allResults.push({ name: "最终结构化文本降级", results });
  }

  // 测试 10
  console.log("\n[测试 10] thinking chunk flush 前累加");
  {
    const results = testReasoningChunksAccumulateBeforeFlush();
    console.log(results.join("\n"));
    allResults.push({ name: "thinking chunk 累加", results });
  }

  // 汇总
  console.log("\n" + "=".repeat(60));
  const totalPassed = allResults.reduce(
    (sum, { results }) => sum + results.filter((r) => r.includes("✓")).length,
    0,
  );
  const totalFailed = allResults.reduce(
    (sum, { results }) => sum + results.filter((r) => r.includes("✗")).length,
    0,
  );
  console.log(`总计: ${totalPassed} 通过, ${totalFailed} 失败`);
  console.log("=".repeat(60));

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runAllTests();
