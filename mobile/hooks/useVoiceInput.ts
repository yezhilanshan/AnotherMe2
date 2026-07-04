// 语音输入 hook — 使用 expo-speech-recognition（原生语音识别，Android/iOS 均可用）
import { useCallback, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { Alert } from "react-native";

export const VOICE_RECOGNITION_BUSY_MESSAGE =
  "系统识别服务繁忙，暂时不可使用，请稍后再试";

interface UseVoiceInputOptions {
  lang?: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

type PendingStart = {
  resolve: (started: boolean) => void;
  reject: (error: unknown) => void;
  retries: number;
  timeout: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
  settled: boolean;
};

type RecognitionState = "inactive" | "starting" | "recognizing" | "stopping";

const BUSY_RETRY_DELAYS_MS = [240, 520, 900];
const START_EVENT_TIMEOUT_MS = 1800;
const NATIVE_IDLE_TIMEOUT_MS = 1200;

let activeVoiceOwner: symbol | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.toLowerCase().includes("busy");
  }
  return String(error).toLowerCase().includes("busy");
}

function isSystemRecognitionUnavailable(error: string, message?: string) {
  const normalized = `${error} ${message ?? ""}`.toLowerCase();
  return (
    normalized.includes("busy") ||
    normalized.includes("service-not-allowed") ||
    normalized.includes("recognizer is unavailable") ||
    normalized.includes("recognitionservice busy") ||
    normalized.includes("system recognition service")
  );
}

function canUseSystemRecognition(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    // Older/native edge cases should still attempt start and surface its error.
    return true;
  }
}

function buildRecognitionOptions(lang: string) {
  return {
    lang,
    interimResults: true,
    // Android 原生 SpeechRecognizer 不支持连续识别，设 true 容易报 busy
    continuous: false,
    androidIntentOptions: {
      // 对短句/短词更稳，库文档也建议 Android 单句场景用 web_search。
      EXTRA_LANGUAGE_MODEL: "web_search",
    },
  } as const;
}

async function getRecognitionState(): Promise<RecognitionState | null> {
  try {
    return await ExpoSpeechRecognitionModule.getStateAsync();
  } catch {
    return null;
  }
}

async function waitForNativeIdle(timeoutMs = NATIVE_IDLE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await getRecognitionState();
    if (!state || state === "inactive") return;
    await sleep(80);
  }
}

export function useVoiceInput({
  lang = "zh-CN",
  onTranscript,
  onError,
}: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const ownerRef = useRef<symbol>(Symbol("voice-input"));
  // 用于存储最新的 partial 结果，停止时取最终值
  const lastPartialRef = useRef("");
  // 避免回调闭包陈旧
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  // 防止重复启动
  const listeningRef = useRef(false);
  const startingRef = useRef(false);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const suppressAbortErrorRef = useRef(false);
  const retryingAfterBusyRef = useRef(false);
  const pendingStartRef = useRef<PendingStart | null>(null);
  const startNativeAttemptRef = useRef<() => void>(() => {});
  const scheduleBusyRetryRef = useRef<() => Promise<void>>(async () => {});

  const isActiveOwner = useCallback(
    () => activeVoiceOwner === ownerRef.current,
    [],
  );

  const clearPendingStartTimeout = useCallback(() => {
    const pending = pendingStartRef.current;
    if (pending?.timeout) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    }
  }, []);

  const settlePendingStart = useCallback(
    (started: boolean) => {
      const pending = pendingStartRef.current;
      if (!pending || pending.settled) return;

      clearPendingStartTimeout();
      pending.settled = true;
      pendingStartRef.current = null;
      pending.resolve(started);
    },
    [clearPendingStartTimeout],
  );

  const rejectPendingStart = useCallback(
    (error: unknown) => {
      const pending = pendingStartRef.current;
      if (!pending || pending.settled) return;

      clearPendingStartTimeout();
      pending.settled = true;
      pendingStartRef.current = null;
      pending.reject(error);
    },
    [clearPendingStartTimeout],
  );

  const resetLocalState = useCallback(() => {
    listeningRef.current = false;
    startingRef.current = false;
    retryingAfterBusyRef.current = false;
    setIsListening(false);
    setIsProcessing(false);
  }, []);

  const startNativeAttempt = useCallback(() => {
    const pending = pendingStartRef.current;
    if (!pending || pending.cancelled || pending.settled) return;

    clearPendingStartTimeout();
    pending.timeout = setTimeout(() => {
      if (!pendingStartRef.current || pending.cancelled || pending.settled) {
        return;
      }
      // 部分 Android 服务不会可靠派发 start；超时后按已启动处理，避免松手时卡住。
      listeningRef.current = true;
      startingRef.current = false;
      retryingAfterBusyRef.current = false;
      setIsListening(true);
      setIsProcessing(false);
      settlePendingStart(true);
    }, START_EVENT_TIMEOUT_MS);

    try {
      ExpoSpeechRecognitionModule.start(buildRecognitionOptions(lang));
    } catch (error) {
      if (isBusyError(error)) {
        void scheduleBusyRetryRef.current();
        return;
      }
      rejectPendingStart(error);
    }
  }, [clearPendingStartTimeout, lang, rejectPendingStart, settlePendingStart]);
  startNativeAttemptRef.current = startNativeAttempt;

  const scheduleBusyRetry = useCallback(async () => {
    const pending = pendingStartRef.current;
    if (!pending || pending.cancelled || pending.settled) return;

    clearPendingStartTimeout();

    if (pending.retries >= BUSY_RETRY_DELAYS_MS.length) {
      activeVoiceOwner = null;
      resetLocalState();
      settlePendingStart(false);
      onErrorRef.current?.(VOICE_RECOGNITION_BUSY_MESSAGE);
      return;
    }

    const delayMs = BUSY_RETRY_DELAYS_MS[pending.retries];
    pending.retries += 1;
    retryingAfterBusyRef.current = true;
    suppressAbortErrorRef.current = true;
    listeningRef.current = false;
    startingRef.current = true;
    setIsListening(false);
    setIsProcessing(true);

    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // 忽略清理失败，后续等待 idle 会兜底。
    }

    await sleep(delayMs);
    await waitForNativeIdle();

    if (
      !pendingStartRef.current ||
      pending.cancelled ||
      pending.settled ||
      !isActiveOwner()
    ) {
      retryingAfterBusyRef.current = false;
      return;
    }

    startNativeAttemptRef.current();
  }, [
    clearPendingStartTimeout,
    isActiveOwner,
    resetLocalState,
    settlePendingStart,
  ]);
  scheduleBusyRetryRef.current = scheduleBusyRetry;

  // 监听识别结果（partial + final）
  useSpeechRecognitionEvent("result", (event) => {
    if (!isActiveOwner()) return;

    const segments = event.results;
    if (segments.length > 0) {
      // 合并所有 segments 的 transcript（某些平台返回多个 segment）
      const transcript = segments.map((seg) => seg.transcript).join("");
      lastPartialRef.current = transcript;
      onTranscriptRef.current(transcript, event.isFinal);
    }
  });

  // 监听识别开始
  useSpeechRecognitionEvent("start", () => {
    if (!isActiveOwner()) return;

    listeningRef.current = true;
    startingRef.current = false;
    retryingAfterBusyRef.current = false;
    setIsListening(true);
    setIsProcessing(false);
    settlePendingStart(true);
  });

  // 监听识别结束
  useSpeechRecognitionEvent("end", () => {
    if (!isActiveOwner()) return;

    if (retryingAfterBusyRef.current) {
      listeningRef.current = false;
      setIsListening(false);
      setIsProcessing(true);
      return;
    }

    listeningRef.current = false;
    startingRef.current = false;
    retryingAfterBusyRef.current = false;
    setIsListening(false);
    setIsProcessing(false);
    activeVoiceOwner = null;
    settlePendingStart(false);
  });

  // 监听错误
  useSpeechRecognitionEvent("error", (event) => {
    if (!isActiveOwner()) return;

    if (event.error === "busy" && pendingStartRef.current) {
      void scheduleBusyRetry();
      return;
    }

    listeningRef.current = false;
    startingRef.current = false;
    setIsListening(false);
    setIsProcessing(false);
    console.warn("[useVoiceInput] recognition error:", JSON.stringify(event));
    if (event.error === "aborted" && suppressAbortErrorRef.current) {
      suppressAbortErrorRef.current = false;
      return;
    }
    const errorMsg = mapErrorMessage(event.error, event.message);
    activeVoiceOwner = null;
    settlePendingStart(false);
    onErrorRef.current?.(errorMsg);
  });

  const startListening = useCallback(async (): Promise<boolean> => {
    // 防止重复启动
    if (listeningRef.current) return true;
    if (startingRef.current && startPromiseRef.current) {
      return startPromiseRef.current;
    }

    const startPromise = (async () => {
      startingRef.current = true;
      activeVoiceOwner = ownerRef.current;
      // 请求权限
      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        startingRef.current = false;
        activeVoiceOwner = null;
        setIsProcessing(false);
        onErrorRef.current?.("麦克风权限被拒绝，请在设置中开启");
        Alert.alert("权限不足", "请在系统设置中允许麦克风和语音识别权限");
        return false;
      }

      if (!canUseSystemRecognition()) {
        activeVoiceOwner = null;
        resetLocalState();
        onErrorRef.current?.(VOICE_RECOGNITION_BUSY_MESSAGE);
        return false;
      }

      lastPartialRef.current = "";
      setIsProcessing(true);
      retryingAfterBusyRef.current = false;

      try {
        const nativeState = await getRecognitionState();
        if (nativeState && nativeState !== "inactive") {
          suppressAbortErrorRef.current = true;
          ExpoSpeechRecognitionModule.abort();
          await waitForNativeIdle();
        }
      } catch (e) {
        if (!isBusyError(e)) {
          throw e;
        }
      }

      activeVoiceOwner = ownerRef.current;
      const started = await new Promise<boolean>((resolve, reject) => {
        pendingStartRef.current = {
          resolve,
          reject,
          retries: 0,
          timeout: null,
          cancelled: false,
          settled: false,
        };
        startNativeAttempt();
      });

      if (!started) {
        activeVoiceOwner = null;
        resetLocalState();
      }
      return started;
    })();

    startPromiseRef.current = startPromise;
    try {
      return await startPromise;
    } catch (e) {
      listeningRef.current = false;
      startingRef.current = false;
      setIsListening(false);
      setIsProcessing(false);
      activeVoiceOwner = null;
      rejectPendingStart(e);
      console.warn("[useVoiceInput] start failed:", e);
      const fallbackMessage =
        e instanceof Error && isSystemRecognitionUnavailable("unknown", e.message)
          ? VOICE_RECOGNITION_BUSY_MESSAGE
          : e instanceof Error
            ? e.message
            : "启动语音识别失败";
      onErrorRef.current?.(fallbackMessage);
      return false;
    } finally {
      startPromiseRef.current = null;
      startingRef.current = false;
    }
  }, [lang]);

  const stopListening = useCallback(async (): Promise<string> => {
    if (startPromiseRef.current) {
      const started = await startPromiseRef.current;
      if (!started) return lastPartialRef.current;
    }

    try {
      await ExpoSpeechRecognitionModule.stop();
    } catch {
      // 如果已经停止或未在录音，忽略错误
    }
    // 等待一小段时间让最终的 result 事件触发
    await new Promise((resolve) => setTimeout(resolve, 350));
    return lastPartialRef.current;
  }, []);

  const abortListening = useCallback(async () => {
    if (pendingStartRef.current) {
      pendingStartRef.current.cancelled = true;
    }
    settlePendingStart(false);
    suppressAbortErrorRef.current = true;
    try {
      await ExpoSpeechRecognitionModule.abort();
    } catch {
      // 忽略
    }
    listeningRef.current = false;
    startingRef.current = false;
    retryingAfterBusyRef.current = false;
    setIsListening(false);
    setIsProcessing(false);
    lastPartialRef.current = "";
    if (isActiveOwner()) {
      activeVoiceOwner = null;
    }
  }, [isActiveOwner, settlePendingStart]);

  return {
    isListening,
    isProcessing,
    startListening,
    stopListening,
    abortListening,
  };
}

/** 将原生错误码映射为中文提示 */
function mapErrorMessage(error: string, message?: string): string {
  if (isSystemRecognitionUnavailable(error, message)) {
    return VOICE_RECOGNITION_BUSY_MESSAGE;
  }

  switch (error) {
    case "not-allowed":
      return "麦克风权限被拒绝，请在设置中开启";
    case "audio-capture":
      return "无法访问麦克风";
    case "no-speech":
      return "未检测到语音输入";
    case "network":
      return "网络错误，语音识别需要网络连接";
    case "service-not-allowed":
      return "语音识别服务不可用";
    case "busy":
      return "语音识别服务繁忙，请稍后再试";
    case "language-not-supported":
      return "当前设备不支持该语言的语音识别";
    case "aborted":
      return "语音识别已取消";
    default:
      return "语音识别失败";
  }
}
