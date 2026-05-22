'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Cleanup MediaRecorder and SpeechRecognition on unmount.
 * Shared between ASR settings and audio settings components.
 */
export function useSpeechRecognitionCleanup(
  mediaRecorderRef: RefObject<MediaRecorder | null>,
  speechRecognitionRef: RefObject<any>, // eslint-disable-line @typescript-eslint/no-explicit-any -- Vendor-prefixed API
  onCleanup?: () => void,
): void {
  useEffect(() => {
    const recorder = mediaRecorderRef.current;
    const recognition = speechRecognitionRef.current;
    return () => {
      onCleanup?.();
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
      }
      if (recognition) {
        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        recognition.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Cleanup refs are captured at mount time
  }, []);
}
