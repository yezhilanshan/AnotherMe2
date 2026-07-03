import {
  buildChatWebViewEventScript,
  buildChatWebViewHtml,
  type ChatWebViewMessage,
  type ChatWebViewTheme,
} from "./chat-webview-html";

const theme: ChatWebViewTheme = {
  bgPage: "#ffffff",
  bgCard: "#f8fafc",
  bgInput: "#eef2f7",
  textPrimary: "#111827",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
  textInverse: "#ffffff",
  primary: "#2563eb",
  primaryDark: "#1d4ed8",
  primaryLight: "#dbeafe",
  border: "#d1d5db",
  quoteBg: "#eff6ff",
  warning: "#f59e0b",
  warningLight: "#fffbeb",
  error: "#dc2626",
  success: "#16a34a",
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`  x ${label}`);
  }
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

class MockClassList {
  private values = new Set<string>();

  add(value: string) {
    this.values.add(value);
  }

  remove(value: string) {
    this.values.delete(value);
  }

  contains(value: string) {
    return this.values.has(value);
  }
}

class MockElement {
  id = "";
  className = "";
  parentNode: MockElement | null = null;
  children: MockElement[] = [];
  attributes = new Map<string, string>();
  classList = new MockClassList();
  listeners = new Map<string, Array<(event?: any) => void>>();
  style = {
    values: new Map<string, string>(),
    setProperty: (name: string, value: string) => {
      this.style.values.set(name, value);
    },
  };
  scrollHeight = 1200;
  private html = "";

  constructor(public tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  set innerHTML(value: string) {
    this.html = String(value);
    this.children = [];
  }

  get innerHTML(): string {
    return this.html + this.children.map((child) => child.outerHTML()).join("");
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === "id") this.id = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type: string, handler: (event?: any) => void) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type: string, event?: any) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }

  outerHTML(): string {
    const id = this.id ? ` id="${this.id}"` : "";
    const className = this.className ? ` class="${this.className}"` : "";
    return `<${this.tagName.toLowerCase()}${id}${className}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
  }
}

function findById(node: MockElement, id: string): MockElement | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function createHarness() {
  const root = new MockElement("main");
  root.id = "chat-root";
  const jumpBottom = new MockElement("button");
  jumpBottom.id = "jump-bottom";
  const toast = new MockElement("div");
  toast.id = "toast";
  const documentElement = new MockElement("html");
  const body = new MockElement("body");
  const posted: any[] = [];
  const timers: Array<{ delay: number; fn: () => void }> = [];

  const windowMock: any = {
    innerHeight: 800,
    scrollY: 0,
    katex: {
      renderToString: (formula: string, options: { displayMode?: boolean }) =>
        `<span class="katex-mock">${options.displayMode ? "block" : "inline"}:${formula}</span>`,
    },
    ReactNativeWebView: {
      postMessage: (value: string) => posted.push(JSON.parse(value)),
    },
    addEventListener: () => {},
    scrollTo: (options: { top?: number } | number) => {
      windowMock.scrollY =
        typeof options === "number" ? options : Number(options.top || 0);
    },
  };
  const documentMock: any = {
    readyState: "complete",
    documentElement,
    body,
    scrollingElement: documentElement,
    createElement: (tagName: string) => new MockElement(tagName),
    addEventListener: () => {},
    getElementById: (id: string) => {
      if (id === root.id) return root;
      if (id === jumpBottom.id) return jumpBottom;
      if (id === toast.id) return toast;
      return findById(root, id);
    },
  };
  const setTimeoutMock = (fn: () => void, delay = 0) => {
    timers.push({ delay, fn });
    return timers.length;
  };
  const requestAnimationFrameMock = (fn: () => void) => {
    fn();
    return 1;
  };
  const runTimers = (delay?: number) => {
    let index = 0;
    while (index < timers.length) {
      const timer = timers[index];
      if (delay !== undefined && timer.delay !== delay) {
        index += 1;
        continue;
      }
      timers.splice(index, 1);
      timer.fn();
    }
  };

  return {
    root,
    jumpBottom,
    posted,
    timers,
    windowMock,
    documentMock,
    setTimeoutMock,
    requestAnimationFrameMock,
    runTimers,
  };
}

function bridgeScript(html: string): string {
  const match = html.match(
    /<script id="chat-webview-bridge">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match?.[1]) throw new Error("chat bridge script not found");
  return match[1];
}

function runBridge(html: string) {
  const harness = createHarness();
  const script = bridgeScript(html);
  new Function("window", "document", "setTimeout", "requestAnimationFrame", script)(
    harness.windowMock,
    harness.documentMock,
    harness.setTimeoutMock,
    harness.requestAnimationFrameMock,
  );
  return harness;
}

function message(
  id: string,
  role: ChatWebViewMessage["role"],
  content: string,
  extra: Partial<ChatWebViewMessage> = {},
): ChatWebViewMessage {
  return {
    id,
    role,
    content,
    timestamp: 1782980000000,
    ...extra,
  };
}

function longAssistantContent(index: number): string {
  return [
    `### Round ${index}`,
    "",
    "This is a deliberately long assistant answer used by the session-level WebView stress path.",
    "It includes plain streaming text, a link to [docs](https://example.com/docs), a table, math, and code.",
    "",
    "| Step | Result |",
    "| --- | --- |",
    `| ${index} | $x_${index}^2 + y_${index}^2$ |`,
    "",
    "$$",
    `\\frac{${index + 1}}{${index + 2}} + \\sqrt{x^2+y^2}`,
    "$$",
    "",
    "```ts",
    `const round${index} = "${"abcdef".repeat(80)}";`,
    "```",
    "",
    "The final paragraph is long enough to exercise wrapping and incremental DOM updates. ".repeat(18),
  ].join("\n");
}

console.log("\n-- chat webview html --");

const html = buildChatWebViewHtml({
  theme,
  katexCss: "/* local katex css */ .katex{font:inherit}",
  katexJs:
    "window.katex={renderToString:function(formula,options){return '<span>'+formula+'</span>';}};",
});

assert(html.includes("local katex css"), "local KaTeX CSS is embedded");
assert(html.includes('<script id="katex-js">'), "local KaTeX JS is embedded");
assert(!/https?:\/\/[^"']*katex/i.test(html), "KaTeX does not reference CDN");
assert(!html.includes("renderMathInElement"), "HTML does not call renderMathInElement");
assert(!html.includes("document.body.innerHTML"), "HTML does not replace document.body");
assert(
  /\.reasoning-body\s*\{[\s\S]*max-height:\s*132px[\s\S]*overflow-y:\s*auto/.test(html),
  "reasoning body is constrained to a scrollable box",
);
assert(
  /\.reasoning\.streaming \.reasoning-body\s*\{[\s\S]*max-height:\s*118px/.test(html),
  "streaming reasoning box has a tighter max height",
);

try {
  new Function(bridgeScript(html));
  passed += 1;
} catch (error) {
  failed += 1;
  failures.push(
    `  x chat bridge script parses: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

const eventScript = buildChatWebViewEventScript({
  type: "append_delta",
  id: "a1",
  delta: "</script><img src=x onerror=alert(1)>",
});
assert(
  eventScript.includes("\\u003c/script\\u003e"),
  "injected event script escapes script-breaking content",
);
assert(
  !eventScript.includes("</script><img"),
  "injected event script never contains raw script-breaking content",
);

try {
  const harness = runBridge(html);
  harness.runTimers(0);
  assert(
    harness.posted.some((payload) => payload.type === "ready"),
    "bridge posts ready",
  );

  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "set_messages",
    messages: [
      message("u1", "user", "Question"),
      message(
        "a1",
        "assistant",
        "Opening\n$$\n\\frac{1}{2}",
        { isStreaming: true },
      ),
    ],
  });
  assert(harness.root.children.length === 2, "set_messages renders message list");
  assert(
    harness.root.innerHTML.includes("$$") &&
      !harness.root.innerHTML.includes("block:\\frac{1}{2}"),
    "unclosed display math stays raw during streaming",
  );

  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "append_delta",
    id: "a1",
    delta: "\n$$",
  });
  assert(
    harness.timers.filter((timer) => timer.delay === 75).length === 1,
    "append_delta batches DOM work behind one 75ms timer",
  );
  harness.runTimers(75);
  assert(
    harness.root.innerHTML.includes("block:\\frac{1}{2}"),
    "closed display math is locally rendered through KaTeX",
  );

  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "replace_message",
    message: message("a2", "assistant", "```ts\nconst x = 1;", {
      isStreaming: true,
    }),
  });
  harness.runTimers(75);
  assert(
    harness.root.innerHTML.includes("```ts"),
    "unclosed code fence stays raw",
  );
  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "append_delta",
    id: "a2",
    delta: "\n```",
  });
  harness.runTimers(75);
  assert(
    harness.root.innerHTML.includes("<pre><code data-lang=\"ts\">const x = 1;"),
    "closed code fence renders only that message node",
  );

  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "finish_message",
    id: "a2",
    content: "Done $y^2$",
    message: message("a2", "assistant", "Done $y^2$", {
      sources: [{ title: "Source", url: "https://example.com/source" }],
    }),
  });
  harness.runTimers(75);
  assert(
    harness.root.innerHTML.includes("inline:y^2") &&
      harness.root.innerHTML.includes("Source"),
    "finish_message applies final content and metadata",
  );

  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "replace_message",
    message: message("a3", "assistant", "", {
      isStreaming: true,
      reasoning: "先判断题目条件。\n",
    }),
  });
  harness.runTimers(75);
  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "append_reasoning_delta",
    id: "a3",
    delta: "再列出关键公式。\n",
  });
  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "append_reasoning_delta",
    id: "a3",
    delta: "最后检查边界情况。\n",
  });
  assert(
    harness.timers.filter((timer) => timer.delay === 75).length === 1,
    "reasoning deltas are batched behind one 75ms timer",
  );
  harness.runTimers(75);
  assert(
    harness.root.innerHTML.includes("思考中") &&
      harness.root.innerHTML.includes("reasoning-body") &&
      harness.root.innerHTML.includes("最后检查边界情况"),
    "streaming reasoning deltas render inside the constrained reasoning box",
  );
} catch (error) {
  failed += 1;
  failures.push(
    `  x chat bridge mocked DOM flow works: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

try {
  const harness = runBridge(html);
  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "set_messages",
    messages: [
      message("a-structured", "assistant", "", {
        capabilityResult: {
          content: "",
          output_mode: "image",
          render_type: "",
          artifacts: [
            {
              type: "image",
              url: "https://example.com/plot.png",
              filename: "plot.png",
              label: "函数图像",
            },
          ],
          code: { language: "python", content: "print('plot')" },
          analysis: {},
          review: {},
          summary: {},
        },
      }),
    ],
  });
  assert(
    !harness.root.innerHTML.includes("这条回复没有可显示内容") &&
      harness.root.innerHTML.includes("已生成结构化结果"),
    "structured capability result does not render as empty assistant content",
  );
  assert(
    harness.root.innerHTML.includes("函数图像") &&
      harness.root.innerHTML.includes("plot.png") &&
      harness.root.innerHTML.includes("print(&#39;plot&#39;)"),
    "structured capability result renders artifacts and code",
  );
} catch (error) {
  failed += 1;
  failures.push(
    `  x structured capability result renders in WebView: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

try {
  const harness = runBridge(html);
  const stressMessages: ChatWebViewMessage[] = [];
  for (let i = 0; i < 20; i += 1) {
    stressMessages.push(message(`u-${i}`, "user", `Round ${i} question`));
    stressMessages.push(message(`a-${i}`, "assistant", longAssistantContent(i)));
  }
  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "set_messages",
    messages: stressMessages,
  });
  assert(
    harness.root.children.length === 40,
    "20-round long-message stress renders one session DOM list",
  );
  assert(
    count(harness.root.innerHTML, "message-block") === 40,
    "20-round stress does not need per-message WebViews",
  );

  harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
    type: "replace_message",
    message: message("a-stream", "assistant", "", { isStreaming: true }),
  });
  for (let i = 0; i < 20; i += 1) {
    harness.windowMock.__ANOTHERME_CHAT_WEBVIEW_EVENT({
      type: "append_delta",
      id: "a-stream",
      delta: `Chunk ${i}: ${"long streaming text ".repeat(40)} $z_${i}$\n`,
    });
  }
  assert(
    harness.timers.filter((timer) => timer.delay === 75).length === 1,
    "20 streamed chunks are coalesced into one pending DOM flush",
  );
  harness.runTimers(75);
  assert(
    harness.root.innerHTML.includes("Chunk 19") &&
      harness.root.innerHTML.includes("inline:z_19"),
    "20 streamed chunks appear after the batched flush",
  );
} catch (error) {
  failed += 1;
  failures.push(
    `  x 20-round chat WebView stress path works: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

console.log(`\nPassed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(failure);
  process.exit(1);
}
