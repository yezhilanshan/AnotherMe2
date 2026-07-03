import {
  buildLiveBookWebViewEventScript,
  buildLiveBookWebViewHtml,
  type LiveBookWebViewTheme,
} from "./live-book-webview-html";

const theme: LiveBookWebViewTheme = {
  bgPage: "#ffffff",
  bgCard: "#f8fafc",
  bgInput: "#eef2f7",
  bgElevated: "#ffffff",
  textPrimary: "#111827",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
  primary: "#2563eb",
  primaryDark: "#1d4ed8",
  primaryLight: "#dbeafe",
  border: "#d1d5db",
  divider: "#e5e7eb",
  quoteBg: "#eff6ff",
  warning: "#f59e0b",
  warningLight: "#fffbeb",
  error: "#dc2626",
  errorLight: "#fee2e2",
  success: "#16a34a",
  successLight: "#dcfce7",
  infoLight: "#eff6ff",
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(`  x ${label}`);
  }
}

function bridgeScript(html: string): string {
  const match = html.match(
    /<script id="live-book-webview-bridge">\s*([\s\S]*?)\s*<\/script>/,
  );
  if (!match?.[1]) throw new Error("live-book bridge script not found");
  return match[1];
}

console.log("\n-- live book webview html --");

const html = buildLiveBookWebViewHtml({
  theme,
  assetBaseUrl: "http://127.0.0.1:8000/api/live-book/assets/",
  katexCss: "/* local katex css */ .katex{font:inherit}",
  katexJs:
    "window.katex={renderToString:function(formula,options){return '<span class=\"katex-mock\">'+(options.displayMode?'block':'inline')+':'+formula+'</span>';}};",
});

assert(html.includes("live-book-root"), "HTML contains live-book root");
assert(html.includes("__ANOTHERME_LIVE_BOOK_WEBVIEW_EVENT"), "HTML exposes event bridge");
assert(html.includes("local katex css"), "local KaTeX CSS is embedded");
assert(html.includes('<script id="katex-js">'), "local KaTeX JS is embedded");
assert(
  html.includes("window.katex && window.katex.renderToString"),
  "live-book math renderer uses the same KaTeX renderToString path as chat",
);
assert(
  html.includes('"http://127.0.0.1:8000/api/live-book/assets"'),
  "asset base URL is normalized before embedding",
);
assert(
  html.includes("viewport-fit=cover"),
  "viewport opts into safe-area aware mobile layout",
);
assert(
  html.includes("max-width: 720px") && html.includes("@media (max-width: 380px)"),
  "reading root has responsive mobile width constraints",
);
assert(
  html.includes(".table-wrap") && html.includes("-webkit-overflow-scrolling: touch"),
  "wide tables and code regions keep touch-friendly horizontal scrolling",
);
assert(
  html.includes(".flash-card summary") && html.includes("min-height: 48px"),
  "flash cards expose mobile-sized tap targets",
);
assert(
  html.includes("touch-action: manipulation") && html.includes(".reveal"),
  "quiz choices and reveal controls are optimized for touch",
);
assert(
  html.includes("height: clamp(260px, 54vh, 420px)") && html.includes("max-height: 52vh"),
  "embedded media and frames are constrained to mobile viewport height",
);

try {
  new Function(bridgeScript(html));
  passed += 1;
} catch (error) {
  failed += 1;
  failures.push(
    `  x live-book bridge script parses: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

try {
  const root = { innerHTML: "" };
  const posted: any[] = [];
  const windowMock: any = {
    ReactNativeWebView: {
      postMessage: (value: string) => posted.push(JSON.parse(value)),
    },
    katex: {
      renderToString: (formula: string, options: { displayMode?: boolean }) =>
        `<span class="katex-mock">${options.displayMode ? "block" : "inline"}:${formula}</span>`,
    },
    addEventListener: () => {},
  };
  const documentMock: any = {
    readyState: "loading",
    getElementById: (id: string) => (id === "live-book-root" ? root : null),
    addEventListener: () => {},
  };
  new Function("window", "document", "setTimeout", bridgeScript(html))(
    windowMock,
    documentMock,
    () => 0,
  );
  windowMock.__ANOTHERME_LIVE_BOOK_WEBVIEW_EVENT({
    type: "set_page",
    bookTitle: "Math book",
    progress: {
      completedCount: 1,
      totalPages: 1,
      progressPercent: 100,
    },
    page: {
      id: "math-page",
      title: "公式页",
      status: "ready",
      blocks: [
        {
          id: "math-block",
          type: "text",
          title: "公式",
          status: "ready",
          content: "Inline $x^2$.\n\n$$\n\\frac{1}{2}\n$$",
          payload: {},
        },
      ],
    },
  });
  assert(
    root.innerHTML.includes("inline:x^2") && root.innerHTML.includes("block:\\frac{1}{2}"),
    "live-book inline and display math render through KaTeX",
  );
  assert(
    root.innerHTML.includes("katex-mock") && !root.innerHTML.includes("$$\\n"),
    "rendered live-book math does not stay as raw display delimiters",
  );
} catch (error) {
  failed += 1;
  failures.push(
    `  x live-book bridge renders math through KaTeX: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

const eventScript = buildLiveBookWebViewEventScript({
  type: "set_page",
  bookTitle: "Unsafe book",
  progress: {
    completedCount: 1,
    totalPages: 2,
    progressPercent: 50,
  },
  page: {
    id: "p1",
    title: "</script><img src=x onerror=alert(1)>",
    status: "ready",
    blocks: [
      {
        id: "b1",
        type: "text",
        title: "Text",
        status: "ready",
        content: "</script><script>alert(1)</script>",
        payload: {},
      },
    ],
  },
});

assert(
  eventScript.includes("\\u003c/script\\u003e"),
  "event script escapes script-closing tags",
);
assert(
  !eventScript.includes("</script><img") && !eventScript.includes("</script><script>"),
  "event script never contains raw script-breaking content",
);

console.log(`\nPassed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(failure);
  process.exit(1);
}
