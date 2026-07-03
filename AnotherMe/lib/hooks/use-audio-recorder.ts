import { useState, useRef, useCallback, useEffect } from 'react';
import { ASR_PROVIDERS } from '@/lib/audio/constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('AudioRecorder');

// TypeScript declarations for Web Speech API
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Speech API not typed in lib.dom
    SpeechRecognition: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Speech API not typed in lib.dom
    webkitSpeechRecognition: any;
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

export interface UseAudioRecorderOptions {
  onTranscription?: (text: string) => void;
  onError?: (error: string) => void;
}

export function useAudioRecorder(options: UseAudioRecorderOptions = {}) {
  const { onTranscription, onError } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const nativeVoiceRequestIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Web Speech API not typed
  const speechRecognitionRef = useRef<any>(null);
  const transcriptionAbortRef = useRef<AbortController | null>(null);
  // Synchronous lock to prevent rapid re-entry (React state updates are async)
  const busyRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setRecordingTime(0);
    timerRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  }, [stopTimer]);

  const postNativeVoiceMessage = useCallback((type: 'start' | 'stop' | 'cancel', id: string) => {
    window.ReactNativeWebView?.postMessage(
      JSON.stringify({
        source: 'anotherme-classroom',
        type: `voice:${type}`,
        id,
      }),
    );
  }, []);

  const resetNativeVoiceState = useCallback(() => {
    nativeVoiceRequestIdRef.current = null;
    busyRef.current = false;
    setIsRecording(false);
    setIsProcessing(false);
    setRecordingTime(0);
    stopTimer();
  }, [stopTimer]);

  // Send audio to server for transcription
  const transcribeAudio = useCallback(
    async (audioBlob: Blob) => {
      setIsProcessing(true);

      try {
        transcriptionAbortRef.current?.abort();
        const controller = new AbortController();
        transcriptionAbortRef.current = controller;
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');

        // Get current ASR configuration from settings store
        // Note: This requires importing useSettingsStore in browser context
        if (typeof window !== 'undefined') {
          const { useSettingsStore } = await import('@/lib/store/settings');
          const { asrProviderId, asrLanguage, asrProvidersConfig } = useSettingsStore.getState();

          formData.append('providerId', asrProviderId);
          formData.append(
            'modelId',
            asrProvidersConfig?.[asrProviderId]?.modelId ||
              ASR_PROVIDERS[asrProviderId]?.defaultModelId ||
              '',
          );
          formData.append('language', asrLanguage);

          // Append API key and base URL if configured
          const providerConfig = asrProvidersConfig?.[asrProviderId];
          if (providerConfig?.apiKey?.trim()) {
            formData.append('apiKey', providerConfig.apiKey);
          }
          if (providerConfig?.baseUrl?.trim()) {
            formData.append('baseUrl', providerConfig.baseUrl);
          }
        }

        const response = await fetch('/api/transcription', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Transcription failed');
        }

        const result = await response.json();
        onTranscription?.(result.text);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        log.error('Transcription error:', error);
        onError?.(error instanceof Error ? error.message : '语音识别失败，请重试');
      } finally {
        transcriptionAbortRef.current = null;
        setIsProcessing(false);
        setRecordingTime(0);
      }
    },
    [onTranscription, onError],
  );

  // Start recording
  const startRecording = useCallback(async () => {
    // Synchronous lock — React state is async so isRecording may be stale
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (typeof window !== 'undefined' && window.ReactNativeWebView) {
        const requestId =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        nativeVoiceRequestIdRef.current = requestId;
        setIsRecording(true);
        setIsProcessing(false);
        startTimer();
        postNativeVoiceMessage('start', requestId);
        return;
      }

      // Get current ASR configuration
      if (typeof window !== 'undefined') {
        const { useSettingsStore } = await import('@/lib/store/settings');
        const { asrProviderId, asrLanguage } = useSettingsStore.getState();

        // Use browser native ASR if configured
        if (asrProviderId === 'browser-native') {
          // Check if Speech Recognition is supported
          if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
            busyRef.current = false;
            onError?.('您的浏览器不支持语音识别功能');
            return;
          }

          const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
          const recognition = new SpeechRecognition();

          recognition.lang = asrLanguage || 'zh-CN';
          recognition.continuous = false;
          recognition.interimResults = false;

          recognition.onstart = () => {
            setIsRecording(true);
            startTimer();
          };

          recognition.onresult = (event: {
            results: {
              [index: number]: { [index: number]: { transcript: string } };
            };
          }) => {
            const transcript = event.results[0][0].transcript;
            onTranscription?.(transcript);
          };

          recognition.onerror = (event: { error: string }) => {
            log.error('Speech recognition error:', event.error);
            let errorMessage = '语音识别失败';

            switch (event.error) {
              case 'aborted':
                // Non-fatal: caused by our own cancel/stop logic or rapid toggle
                busyRef.current = false;
                setIsRecording(false);
                setRecordingTime(0);
                stopTimer();
                return;
              case 'no-speech':
                errorMessage = '未检测到语音输入';
                break;
              case 'audio-capture':
                errorMessage = '无法访问麦克风';
                break;
              case 'not-allowed':
                errorMessage = '麦克风权限被拒绝';
                break;
              case 'network':
                errorMessage = '网络错误';
                break;
              default:
                errorMessage = `语音识别错误: ${event.error}`;
            }

            onError?.(errorMessage);
            busyRef.current = false;
            setIsRecording(false);
            setRecordingTime(0);
            stopTimer();
          };

          recognition.onend = () => {
            busyRef.current = false;
            setIsRecording(false);
            setRecordingTime(0);
            stopTimer();
          };

          recognition.start();
          speechRecognitionRef.current = recognition;
          return;
        }
      }

      // Use MediaRecorder for server-side ASR
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm',
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Stop all audio tracks
        stream.getTracks().forEach((track) => track.stop());

        // Merge audio chunks
        const audioBlob = new Blob(audioChunksRef.current, {
          type: 'audio/webm',
        });

        // Send to server for transcription
        await transcribeAudio(audioBlob);
        busyRef.current = false;
      };

      // Start recording
      mediaRecorder.start();
      setIsRecording(true);
      startTimer();
    } catch (error) {
      busyRef.current = false;
      log.error('Failed to start recording:', error);
      onError?.('无法访问麦克风，请检查权限设置');
    }
  }, [onTranscription, onError, postNativeVoiceMessage, startTimer, stopTimer, transcribeAudio]);

  // Stop recording
  const stopRecording = useCallback(() => {
    const nativeRequestId = nativeVoiceRequestIdRef.current;
    if (nativeRequestId) {
      setIsRecording(false);
      setIsProcessing(true);
      stopTimer();
      postNativeVoiceMessage('stop', nativeRequestId);
      return;
    }

    // Stop Speech Recognition if active
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
      busyRef.current = false;
      setIsRecording(false);
      stopTimer();
      return;
    }

    // Stop MediaRecorder if active
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      busyRef.current = false;
      setIsRecording(false);

      stopTimer();
    }
  }, [isRecording, postNativeVoiceMessage, stopTimer]);

  // Cancel recording
  const cancelRecording = useCallback(() => {
    const nativeRequestId = nativeVoiceRequestIdRef.current;
    if (nativeRequestId) {
      postNativeVoiceMessage('cancel', nativeRequestId);
      resetNativeVoiceState();
      return;
    }

    // Cancel Speech Recognition if active
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.onresult = null; // Prevent transcription callback
      speechRecognitionRef.current.onerror = null; // Suppress browser abort error events
      speechRecognitionRef.current.stop();
      speechRecognitionRef.current = null;
      busyRef.current = false;
      setIsRecording(false);
      setRecordingTime(0);
      stopTimer();
      return;
    }

    // Cancel MediaRecorder if active
    if (mediaRecorderRef.current && isRecording) {
      // Stop recording without transcription
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();

      // Stop all audio tracks
      if (mediaRecorderRef.current.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }

      busyRef.current = false;
      setIsRecording(false);
      setRecordingTime(0);

      stopTimer();

      audioChunksRef.current = [];
    }
  }, [isRecording, postNativeVoiceMessage, resetNativeVoiceState, stopTimer]);

  useEffect(() => {
    const handleNativeVoiceEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            id?: string;
            type?: 'result' | 'error' | 'end';
            text?: string;
            error?: string;
          }
        | undefined;
      if (!detail?.id || detail.id !== nativeVoiceRequestIdRef.current) return;

      if (detail.type === 'result') {
        resetNativeVoiceState();
        onTranscription?.(detail.text || '');
        return;
      }

      if (detail.type === 'error') {
        resetNativeVoiceState();
        onError?.(detail.error || '语音识别失败，请重试');
        return;
      }

      if (detail.type === 'end') {
        resetNativeVoiceState();
      }
    };

    window.addEventListener('anotherme:native-voice', handleNativeVoiceEvent);
    return () => {
      window.removeEventListener('anotherme:native-voice', handleNativeVoiceEvent);
    };
  }, [onError, onTranscription, resetNativeVoiceState]);

  useEffect(() => {
    return () => {
      const nativeRequestId = nativeVoiceRequestIdRef.current;
      if (nativeRequestId) {
        postNativeVoiceMessage('cancel', nativeRequestId);
      }
      transcriptionAbortRef.current?.abort();
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.onresult = null;
        speechRecognitionRef.current.onerror = null;
        speechRecognitionRef.current.onend = null;
        speechRecognitionRef.current.stop();
        speechRecognitionRef.current = null;
      }
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
      }
      stopTimer();
      audioChunksRef.current = [];
      busyRef.current = false;
    };
  }, [postNativeVoiceMessage, stopTimer]);

  return {
    isRecording,
    isProcessing,
    recordingTime,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
