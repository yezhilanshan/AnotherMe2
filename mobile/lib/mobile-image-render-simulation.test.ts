/**
 * Mobile image chat render simulation
 *
 * Runs without a React Native test runner. It models the same state transition
 * that chatSlice applies to SSE events, then applies ChatBubble's render-mode
 * decision: streaming messages with answerSteps render as step cards; otherwise
 * visible content renders as markdown/math text.
 */

import { supportsLiveAnswerSteps } from "./config";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  capability?: string;
  isStreaming?: boolean;
  answerSteps?: AnswerStep[];
};

type AnswerStep = {
  id: string;
  index: number;
  title: string;
  content: string;
  status: "streaming" | "done";
};

type StreamEvent =
  | {
      type: "text_delta";
      data: { content: string; messageId?: string };
    }
  | {
      type: "step_start";
      data: {
        id: string;
        index: number;
        title?: string;
        capability?: string;
      };
    }
  | {
      type: "step_delta";
      data: {
        id: string;
        index: number;
        content: string;
        capability?: string;
      };
    }
  | {
      type: "step_done";
      data: { id: string; index: number; capability?: string };
    }
  | {
      type: "final_markdown";
      data: { content: string; messageId?: string };
    };

type RenderMode = "empty" | "streamingMarkdown" | "answerSteps" | "finalMarkdown";

function assertEq<T>(actual: T, expected: T, label = "") {
  if (actual !== expected) {
    throw new Error(
      `${label} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`,
    );
  }
}

function assert(condition: unknown, label: string) {
  if (!condition) throw new Error(label);
}

function shouldAcceptLiveStepEvent(
  step: { capability?: string },
  message: Message,
): boolean {
  if (step.capability) return supportsLiveAnswerSteps(step.capability);
  return supportsLiveAnswerSteps(message.capability);
}

function applyEvent(
  message: Message,
  event: StreamEvent,
  pending: { content: string; stepDeltas: Record<string, string> },
): Message {
  if (event.type === "text_delta") {
    if (!message.answerSteps?.length) {
      pending.content += event.data.content;
    }
    return message;
  }

  if (event.type === "step_start") {
    const step = event.data;
    if (!shouldAcceptLiveStepEvent(step, message)) {
      return message;
    }
    pending.content = "";
    const existing = message.answerSteps || [];
    if (existing.some((item) => item.id === step.id)) return message;
    const nextStep: AnswerStep = {
      id: step.id,
      index: step.index ?? existing.length,
      title: step.title || `解题步骤 ${existing.length + 1}`,
      content: "",
      status: "streaming",
    };
    return {
      ...message,
      answerSteps: [...existing, nextStep].sort(
        (a, b) => (a.index ?? 0) - (b.index ?? 0),
      ),
    };
  }

  if (event.type === "step_delta") {
    const step = event.data;
    if (!shouldAcceptLiveStepEvent(step, message)) {
      return message;
    }
    pending.stepDeltas[step.id] = (pending.stepDeltas[step.id] || "") + step.content;
    if (message.answerSteps?.some((item) => item.id === step.id)) {
      return message;
    }
    const nextStep: AnswerStep = {
      id: step.id,
      index: step.index ?? 0,
      title: `解题步骤 ${(message.answerSteps || []).length + 1}`,
      content: "",
      status: "streaming",
    };
    return {
      ...message,
      answerSteps: [...(message.answerSteps || []), nextStep],
    };
  }

  if (event.type === "step_done") {
    const step = event.data;
    if (!shouldAcceptLiveStepEvent(step, message)) {
      return message;
    }
    return {
      ...message,
    answerSteps: (message.answerSteps || []).map((item) =>
        item.id === step.id ? { ...item, status: "done" as const } : item,
      ),
    };
  }

  if (event.type === "final_markdown") {
    return {
      ...message,
      content: event.data.content || pending.content,
      isStreaming: false,
    };
  }

  return message;
}

function renderMode(message: Message): RenderMode {
  const answerSteps = message.isStreaming ? message.answerSteps || [] : [];
  if (message.isStreaming) {
    if (answerSteps.length > 0) return "answerSteps";
    if (message.content || true) return "streamingMarkdown";
    return "empty";
  }
  return message.content ? "finalMarkdown" : "empty";
}

function simulate(events: StreamEvent[], capability: string): Message {
  let message: Message = {
    id: "assistant-1",
    role: "assistant",
    content: "",
    capability,
    isStreaming: true,
  };
  const pending = { content: "", stepDeltas: {} as Record<string, string> };

  for (const event of events) {
    message = applyEvent(message, event, pending);
    if (message.isStreaming && !message.answerSteps?.length && pending.content) {
      message = { ...message, content: pending.content };
    }
  }
  return message;
}

function testImageChatKeepsMarkdownRender() {
  const events: StreamEvent[] = [
    {
      type: "text_delta",
      data: { content: "## 解题思路\n识别到菱形 ABCD，AD=5，tanB=2。" },
    },
    {
      type: "step_start",
      data: {
        id: "mobile-live-problem5-step-0",
        index: 0,
        title: "解题思路",
        capability: "visual_solve_fast",
      },
    },
    {
      type: "step_delta",
      data: {
        id: "mobile-live-problem5-step-0",
        index: 0,
        content: "最终答案为 D，3√5。",
        capability: "visual_solve_fast",
      },
    },
  ];

  const streamingMessage = simulate(events, "chat");
  assertEq(streamingMessage.answerSteps?.length || 0, 0, "image chat answerSteps");
  assertEq(renderMode(streamingMessage), "streamingMarkdown", "image chat streaming render");

  const finalMessage = simulate(
    [
      ...events,
      {
        type: "final_markdown",
        data: {
          content: "## 解题思路\n识别到菱形 ABCD。\n\n最终答案：D，3√5。",
        },
      },
    ],
    "chat",
  );
  assertEq(renderMode(finalMessage), "finalMarkdown", "image chat final render");
  assert(finalMessage.content.includes("3√5"), "image chat final answer is visible");
}

function testDeepSolveStillUsesAnswerSteps() {
  const message = simulate(
    [
      {
        type: "step_start",
        data: {
          id: "deep-step-0",
          index: 0,
          title: "建立方程",
          capability: "deep_solve",
        },
      },
      {
        type: "step_delta",
        data: {
          id: "deep-step-0",
          index: 0,
          content: "先建立方程。",
          capability: "deep_solve",
        },
      },
    ],
    "deep_solve",
  );

  assertEq(message.answerSteps?.length || 0, 1, "deep_solve answerSteps");
  assertEq(renderMode(message), "answerSteps", "deep_solve render");
}

testImageChatKeepsMarkdownRender();
testDeepSolveStillUsesAnswerSteps();

console.log("mobile image render simulation: PASS");
