type DebugFields = Record<string, unknown>;

const PREFIX = "[AnotherMeDebug]";
const MAX_STRING = 180;
const MAX_LOG_LINE = 1200;

declare const __DEV__: boolean | undefined;

const DEBUG_ENABLED =
  (typeof __DEV__ !== "undefined" && __DEV__) ||
  process.env.EXPO_PUBLIC_ANOTHERME_DEBUG === "1";

// #region debug-point infra:server-reporting
const DEBUG_SERVER_URL = process.env.EXPO_PUBLIC_DEBUG_SERVER_URL;
const DEBUG_SESSION_ID = process.env.EXPO_PUBLIC_DEBUG_SESSION_ID;
const DEBUG_RUN_ID = process.env.EXPO_PUBLIC_DEBUG_RUN_ID || "pre-fix";

export function reportDebugEvent(
  hypothesisId: string,
  location: string,
  msg: string,
  data?: DebugFields,
) {
  if (!DEBUG_SERVER_URL || !DEBUG_SESSION_ID) return;
  try {
    fetch(DEBUG_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: DEBUG_SESSION_ID,
        runId: DEBUG_RUN_ID,
        hypothesisId,
        location,
        msg: `[DEBUG] ${msg}`,
        data: data ? cleanValue(data) : {},
        ts: Date.now(),
      }),
    }).catch(() => {});
  } catch {
    // Reporting must never affect runtime stability.
  }
}
// #endregion

function cleanValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…(${value.length})`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 8).map(cleanValue);
  }
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: DebugFields = {};
    for (const key of Object.keys(source).slice(0, 16)) {
      out[key] = cleanValue(source[key]);
    }
    return out;
  }
  return String(value);
}

function format(scope: string, event: string, fields?: DebugFields): string {
  const suffix = fields ? ` ${JSON.stringify(cleanValue(fields))}` : "";
  const line = `${PREFIX} ${scope}:${event}${suffix}`;
  return line.length > MAX_LOG_LINE
    ? `${line.slice(0, MAX_LOG_LINE)}…(${line.length})`
    : line;
}

export function debugLog(
  scope: string,
  event: string,
  fields?: DebugFields,
) {
  if (!DEBUG_ENABLED) return;
  try {
    console.log(format(scope, event, fields));
  } catch {
    // Logging must never affect runtime stability.
  }
}

export function debugWarn(
  scope: string,
  event: string,
  fields?: DebugFields,
) {
  if (!DEBUG_ENABLED) return;
  try {
    console.warn(format(scope, event, fields));
  } catch {
    // Logging must never affect runtime stability.
  }
}

export function debugError(
  scope: string,
  event: string,
  fields?: DebugFields,
) {
  if (!DEBUG_ENABLED) return;
  try {
    console.error(format(scope, event, fields));
  } catch {
    // Logging must never affect runtime stability.
  }
}

export function nowMs(): number {
  return Date.now();
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}
