// 语音输入 hook：使用 expo-audio 录音，再交给 Web/BFF 的 ASR 服务转写。
// 不依赖 Android 系统 SpeechRecognizer，避免设备未配置识别服务时持续报 busy。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder as useExpoAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { File, UploadType } from "expo-file-system";
import { Alert } from "react-native";
import {
  BEARER_TOKEN,
  GATEWAY_URL,
  TUNNEL_HEADERS,
} from "../lib/config";

export const VOICE_RECOGNITION_BUSY_MESSAGE =
  "语音识别服务暂时不可用，请稍后再试";

const ASR_PROVIDER_ID =
  process.env.EXPO_PUBLIC_ASR_PROVIDER_ID?.trim() || "qwen-asr";
const MIN_RECORDING_DURATION_MS = 250;
const TRANSCRIPTION_TIMEOUT_MS = 60_000;

// Qwen3-ASR 支持 AAC/WAV；使用单声道、16 kHz 能减小上传体积并贴合语音场景。
const ASR_RECORDING_OPTIONS: RecordingOptions = {
  extension: ".aac",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 64_000,
  android: {
    extension: ".aac",
    outputFormat: "aac_adts",
    audioEncoder: "aac",
    audioSource: "voice_recognition",
  },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 64_000,
  },
};

interface UseVoiceInputOptions {
  lang?: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

type ActiveVoiceSession = {
  owner: symbol;
  abort: () => Promise<void>;
};

let activeVoiceSession: ActiveVoiceSession | null = null;

function getAudioUploadMetadata(uri: string): { name: string; mimeType: string } {
  const normalized = uri.toLowerCase().split(/[?#]/, 1)[0];
  if (normalized.endsWith(".wav")) {
    return { name: "recording.wav", mimeType: "audio/wav" };
  }
  if (normalized.endsWith(".webm")) {
    return { name: "recording.webm", mimeType: "audio/webm" };
  }
  return { name: "recording.aac", mimeType: "audio/aac" };
}

function normalizeLanguage(lang: string): string {
  const normalized = lang.trim().toLowerCase();
  if (normalized.startsWith("zh")) return "zh";
  return normalized.split(/[-_]/, 1)[0] || "auto";
}

function parseTranscriptionResponse(body: string): string {
  let payload: {
    text?: unknown;
    error?: unknown;
    details?: unknown;
  };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    throw new Error("语音识别服务返回了无法解析的数据");
  }

  if (typeof payload.text === "string") return payload.text.trim();
  const reason =
    typeof payload.details === "string"
      ? payload.details
      : typeof payload.error === "string"
        ? payload.error
        : "语音识别失败，请重试";
  throw new Error(reason);
}

function toVoiceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLowerCase();

  if (
    normalized.includes("network request failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timeout") ||
    normalized.includes("aborted")
  ) {
    return "无法连接语音识别服务，请检查网络和 Gateway 设置";
  }
  if (normalized.includes("missing api key") || normalized.includes("api key required")) {
    return "语音识别服务尚未配置，请检查 ASR 提供商设置";
  }
  if (normalized.includes("microphone") || normalized.includes("record")) {
    return "无法使用麦克风，请检查系统权限或其他录音应用";
  }
  return message || "语音识别失败，请重试";
}

export function useVoiceInput({
  lang = "zh-CN",
  onTranscript,
  onError,
}: UseVoiceInputOptions) {
  const recorder = useExpoAudioRecorder(ASR_RECORDING_OPTIONS);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const ownerRef = useRef(Symbol("voice-input"));
  const mountedRef = useRef(true);
  const recordingRef = useRef(false);
  const processingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const operationIdRef = useRef(0);
  const startPromiseRef = useRef<Promise<boolean> | null>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  const abortListeningRef = useRef<() => Promise<void>>(async () => {});
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);
  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  const setListeningState = useCallback((listening: boolean, processing: boolean) => {
    recordingRef.current = listening;
    processingRef.current = processing;
    if (!mountedRef.current) return;
    setIsListening(listening);
    setIsProcessing(processing);
  }, []);

  const releaseOwnership = useCallback(() => {
    if (activeVoiceSession?.owner === ownerRef.current) {
      activeVoiceSession = null;
    }
  }, []);

  const transcribeRecording = useCallback(
    async (uri: string, operationId: number): Promise<string> => {
      const controller = new AbortController();
      transcriptionAbortRef.current?.abort();
      transcriptionAbortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
      const { name, mimeType } = getAudioUploadMetadata(uri);
      const headers = {
        ...(BEARER_TOKEN ? { Authorization: `Bearer ${BEARER_TOKEN}` } : {}),
        ...TUNNEL_HEADERS,
      };

      try {
        const result = await new File(uri).upload(`${GATEWAY_URL}/v1/transcription`, {
          httpMethod: "POST",
          uploadType: UploadType.MULTIPART,
          fieldName: "file",
          mimeType,
          headers,
          parameters: {
            provider_id: ASR_PROVIDER_ID,
            language: normalizeLanguage(lang),
            filename: name,
          },
          signal: controller.signal,
          sessionType: "foreground",
        });

        if (operationId !== operationIdRef.current) return "";
        if (result.status < 200 || result.status >= 300) {
          return parseTranscriptionResponse(result.body || "");
        }
        return parseTranscriptionResponse(result.body || "");
      } finally {
        clearTimeout(timeoutId);
        if (transcriptionAbortRef.current === controller) {
          transcriptionAbortRef.current = null;
        }
        try {
          const audioFile = new File(uri);
          if (audioFile.exists) audioFile.delete();
        } catch {
          // 缓存文件删除失败不影响本次识别结果。
        }
      }
    },
    [lang],
  );

  const startListening = useCallback(async (): Promise<boolean> => {
    if (recordingRef.current) return true;
    if (startPromiseRef.current) return startPromiseRef.current;
    if (processingRef.current) return false;

    const operationId = ++operationIdRef.current;
    const promise = (async () => {
      setListeningState(false, true);
      try {
        if (activeVoiceSession && activeVoiceSession.owner !== ownerRef.current) {
          await activeVoiceSession.abort();
        }
        activeVoiceSession = {
          owner: ownerRef.current,
          abort: () => abortListeningRef.current(),
        };

        const permission = await requestRecordingPermissionsAsync();
        if (operationId !== operationIdRef.current) return false;
        if (!permission.granted) {
          releaseOwnership();
          setListeningState(false, false);
          onErrorRef.current?.("麦克风权限被拒绝，请在设置中开启");
          Alert.alert("权限不足", "请在系统设置中允许麦克风权限");
          return false;
        }

        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
          interruptionMode: "doNotMix",
        });
        await recorder.prepareToRecordAsync();
        if (operationId !== operationIdRef.current) {
          await recorder.stop().catch(() => undefined);
          return false;
        }

        recorder.record({ forDuration: 60 });
        recordingStartedAtRef.current = Date.now();
        setListeningState(true, false);
        return true;
      } catch (error) {
        if (operationId === operationIdRef.current) {
          releaseOwnership();
          setListeningState(false, false);
          onErrorRef.current?.(toVoiceErrorMessage(error));
        }
        return false;
      }
    })();

    startPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (startPromiseRef.current === promise) startPromiseRef.current = null;
    }
  }, [recorder, releaseOwnership, setListeningState]);

  const stopListening = useCallback(async (): Promise<string> => {
    const pendingStart = startPromiseRef.current;
    if (pendingStart && !(await pendingStart)) return "";
    if (!recordingRef.current) return "";

    const operationId = operationIdRef.current;
    setListeningState(false, true);
    try {
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        interruptionMode: "mixWithOthers",
      }).catch(() => undefined);
      releaseOwnership();

      const uri = recorder.uri;
      const duration = Date.now() - recordingStartedAtRef.current;
      if (!uri || duration < MIN_RECORDING_DURATION_MS) {
        return "";
      }

      const transcript = await transcribeRecording(uri, operationId);
      if (operationId === operationIdRef.current && transcript) {
        onTranscriptRef.current(transcript, true);
      }
      return transcript;
    } catch (error) {
      if (operationId === operationIdRef.current) {
        onErrorRef.current?.(toVoiceErrorMessage(error));
      }
      return "";
    } finally {
      if (operationId === operationIdRef.current) {
        setListeningState(false, false);
      }
      releaseOwnership();
    }
  }, [recorder, releaseOwnership, setListeningState, transcribeRecording]);

  const abortListening = useCallback(async () => {
    ++operationIdRef.current;
    transcriptionAbortRef.current?.abort();
    transcriptionAbortRef.current = null;
    try {
      if (recordingRef.current || recorder.isRecording) {
        await recorder.stop();
      }
    } catch {
      // 录音器可能已自动停止或尚未完成 prepare。
    }
    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "mixWithOthers",
    }).catch(() => undefined);
    releaseOwnership();
    setListeningState(false, false);
  }, [recorder, releaseOwnership, setListeningState]);
  abortListeningRef.current = abortListening;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void abortListeningRef.current();
    };
  }, []);

  return {
    isListening,
    isProcessing,
    startListening,
    stopListening,
    abortListening,
  };
}
