// streaming.ts 纯逻辑单元测试
// 运行: npx tsx lib/streaming-pure.test.ts

import {
  extractJsonStringField,
  parseSSELine,
  parseOversizedSSEPayload,
  isAbortLikeError,
  isRetryableStreamError,
  isNetworkError,
  splitTextDeltaContent,
  TEXT_DELTA_CHUNK_SIZE,
  OVERSIZED_SSE_NOTICE,
  type StreamEvent,
} from "./streaming-pure";

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
// 1. extractJsonStringField
// ============================================================
section("extractJsonStringField");

eq(
  extractJsonStringField('{"type":"text_delta","messageId":"m1"}', "type"),
  "text_delta",
  "提取 type 字段",
);
eq(
  extractJsonStringField('{"type":"text_delta","messageId":"m1"}', "messageId"),
  "m1",
  "提取 messageId 字段",
);
eq(
  extractJsonStringField('{"type":"text_delta"}', "missing"),
  undefined,
  "缺失字段返回 undefined",
);
eq(
  extractJsonStringField('{"content":"say \\"hi\\""}', "content"),
  'say "hi"',
  "转义引号正确还原",
);
eq(
  extractJsonStringField('{"path":"C:\\\\Users\\\\file"}', "path"),
  "C:\\Users\\file",
  "转义反斜杠正确还原",
);

// ============================================================
// 2. parseSSELine
// ============================================================
section("parseSSELine");

eq(parseSSELine(""), null, "空行返回 null");
eq(parseSSELine(": comment"), null, "注释行返回 null");
eq(parseSSELine("event: message"), null, "非 data: 行返回 null");
eq(parseSSELine("data: [DONE]"), null, "[DONE] 返回 null");

deepEq(
  parseSSELine('data: {"type":"text_delta","data":{"content":"hi","messageId":"m1"}}'),
  { type: "text_delta", data: { content: "hi", messageId: "m1" } },
  "解析 text_delta SSE 行",
);

deepEq(
  parseSSELine(
    'data: {"type":"final_markdown","data":{"content":"# 答案","messageId":"m1"}}',
  ),
  {
    type: "final_markdown",
    data: { content: "# 答案", messageId: "m1" },
  } as StreamEvent,
  "解析 final_markdown SSE 行",
);

deepEq(
  parseSSELine('data: {"type":"done","data":{"totalActions":3,"totalAgents":1,"agentHadContent":true}}'),
  {
    type: "done",
    data: { totalActions: 3, totalAgents: 1, agentHadContent: true },
  } as StreamEvent,
  "解析 done SSE 行",
);

eq(
  parseSSELine('data: {invalid json}'),
  null,
  "非法 JSON 返回 null",
);

deepEq(
  parseSSELine('data:   {"type":"heartbeat","data":{"ts":123}}'),
  { type: "heartbeat", data: { ts: 123 } },
  "data: 后多个空格也能解析",
);

deepEq(
  parseSSELine('data: {"type":"text_delta","data":{"content":"hi","messageId":"m1"}}\r'),
  { type: "text_delta", data: { content: "hi", messageId: "m1" } },
  "去除末尾 \\r",
);

// ============================================================
// 3. parseOversizedSSEPayload
// ============================================================
section("parseOversizedSSEPayload");

deepEq(
  parseOversizedSSEPayload('{"type":"final_markdown","messageId":"m2"}'),
  {
    type: "final_markdown",
    data: {
      content: OVERSIZED_SSE_NOTICE,
      messageId: "m2",
      partial: true,
      finish_reason: "server_char_limit",
    },
  } as StreamEvent,
  " oversized final_markdown 事件",
);

deepEq(
  parseOversizedSSEPayload('{"type":"text_delta","messageId":"m2"}'),
  {
    type: "text_delta",
    data: { content: OVERSIZED_SSE_NOTICE, messageId: "m2" },
  } as StreamEvent,
  "oversized text_delta 事件",
);

deepEq(
  parseOversizedSSEPayload('{"type":"done"}'),
  {
    type: "done",
    data: {
      totalActions: 0,
      totalAgents: 0,
      agentHadContent: true,
      partial: true,
      finish_reason: "server_char_limit",
    },
  } as StreamEvent,
  "oversized done 事件",
);

deepEq(
  parseOversizedSSEPayload('{"type":"error"}'),
  {
    type: "error",
    data: { message: "响应过大，移动端已停止解析" },
  } as StreamEvent,
  "oversized error 事件",
);

eq(
  parseOversizedSSEPayload('{"type":"unknown"}'),
  null,
  "未知 oversized 类型返回 null",
);

// ============================================================
// 4. isAbortLikeError
// ============================================================
section("isAbortLikeError");

assert(isAbortLikeError(new DOMException("aborted", "AbortError")), "AbortError");
assert(
  isAbortLikeError(new Error("Request was canceled")),
  "message 含 canceled",
);
assert(
  isAbortLikeError(new Error("Request was cancelled")),
  "message 含 cancelled",
);
assert(
  isAbortLikeError(new Error("The user aborted the request")),
  "message 含 aborted",
);
assert(!isAbortLikeError(new Error("network down")), "普通错误不是 abort");
assert(!isAbortLikeError("string error"), "非 Error 实例返回 false");

// ============================================================
// 5. isRetryableStreamError
// ============================================================
section("isRetryableStreamError");

assert(
  !isRetryableStreamError(new DOMException("aborted", "AbortError")),
  "abort 类错误不可重试",
);
assert(
  !isRetryableStreamError(new Error("请求超时")),
  "超时错误不可重试",
);
assert(
  !isRetryableStreamError(new Error("http 404")),
  "HTTP 4xx 不可重试",
);
assert(
  !isRetryableStreamError(new Error("invalid_model")),
  "invalid_model 不可重试",
);
assert(
  !isRetryableStreamError(new Error("model_capability_mismatch")),
  "model_capability_mismatch 不可重试",
);
assert(
  isRetryableStreamError(new Error("http 503")),
  "HTTP 5xx 可重试",
);
assert(
  isRetryableStreamError(new Error("ECONNRESET")),
  "网络层错误可重试",
);

// ============================================================
// 6. isNetworkError
// ============================================================
section("isNetworkError");

assert(
  !isNetworkError(new DOMException("aborted", "AbortError")),
  "abort 不计入网络错误",
);
assert(
  isNetworkError(new Error("http 500")),
  "HTTP 5xx 计入网络错误",
);
assert(
  isNetworkError(new Error("HTTP 503 Service Unavailable")),
  "HTTP 503 计入网络错误",
);
assert(
  !isNetworkError(new Error("http 400")),
  "HTTP 4xx 不计入网络错误",
);
assert(
  isNetworkError(new TypeError("Network request failed")),
  "fetch TypeError 计入网络错误",
);
assert(
  isNetworkError(new Error("ECONNREFUSED")),
  "ECONNREFUSED 计入网络错误",
);
assert(
  isNetworkError(new Error("ENOTFOUND")),
  "ENOTFOUND 计入网络错误",
);
assert(
  isNetworkError(new Error("请求超时，网络连接失败")),
  "建连超时计入网络错误",
);
assert(
  !isNetworkError(new Error("响应超时")),
  "响应超时不计入网络错误",
);
assert(
  !isNetworkError(new Error("长时间没有返回内容")),
  "长时间无内容不计入网络错误",
);
assert(
  !isNetworkError(new Error("invalid capability")),
  "业务错误不计入网络错误",
);
assert(
  !isNetworkError(new Error("something weird")),
  "未知错误默认不计入网络错误",
);

// ============================================================
// 7. splitTextDeltaContent
// ============================================================
section("splitTextDeltaContent");

deepEq(splitTextDeltaContent(""), [""], "空字符串返回包含空串的数组");
deepEq(splitTextDeltaContent("abc"), ["abc"], "短文本不拆分");

deepEq(
  splitTextDeltaContent("a".repeat(TEXT_DELTA_CHUNK_SIZE)),
  ["a".repeat(TEXT_DELTA_CHUNK_SIZE)],
  "刚好等于 chunkSize 不拆分",
);

const long = "b".repeat(TEXT_DELTA_CHUNK_SIZE + 1);
const chunks = splitTextDeltaContent(long);
assert(
  chunks.length === 2 &&
    chunks[0].length === TEXT_DELTA_CHUNK_SIZE &&
    chunks[1].length === 1,
  "超过 chunkSize 拆成两段",
);

const custom = splitTextDeltaContent("1234567890", 3);
deepEq(custom, ["123", "456", "789", "0"], "自定义 chunkSize 拆分正确");

const multi = splitTextDeltaContent("x".repeat(TEXT_DELTA_CHUNK_SIZE * 3 + 5));
assert(
  multi.length === 4 &&
    multi[0].length === TEXT_DELTA_CHUNK_SIZE &&
    multi[1].length === TEXT_DELTA_CHUNK_SIZE &&
    multi[2].length === TEXT_DELTA_CHUNK_SIZE &&
    multi[3].length === 5,
  "大文本拆分成长度均匀的小块",
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
