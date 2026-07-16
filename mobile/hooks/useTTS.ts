// TTS（文字转语音）hook — 使用 expo-speech 调用系统原生 TTS 引擎
import { useCallback, useRef, useState } from "react";
import * as Speech from "expo-speech";

interface UseTTSOptions {
  /** 语言，默认 zh-CN */
  lang?: string;
  /** 语速 0.1-1.0，默认 0.85 */
  rate?: number;
  /** 音高 0.5-2.0，默认 1.0 */
  pitch?: number;
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

export function useTTS(options: UseTTSOptions = {}) {
  const {
    lang = "zh-CN",
    rate = 0.85,
    pitch = 1.0,
    onStart,
    onDone,
    onError,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const onStartRef = useRef(onStart);
  onStartRef.current = onStart;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const speak = useCallback(
    (text: string) => {
      if (!text?.trim()) return;

      // 先停止当前朗读
      Speech.stop();

      Speech.speak(text, {
        language: lang,
        rate,
        pitch,
        onStart: () => {
          setIsSpeaking(true);
          onStartRef.current?.();
        },
        onDone: () => {
          setIsSpeaking(false);
          onDoneRef.current?.();
        },
        onError: (error: Error) => {
          setIsSpeaking(false);
          onErrorRef.current?.(error.message);
        },
      });
    },
    [lang, rate, pitch],
  );

  const stop = useCallback(() => {
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  const pause = useCallback(() => {
    Speech.pause();
  }, []);

  const resume = useCallback(() => {
    Speech.resume();
  }, []);

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
  };
}
