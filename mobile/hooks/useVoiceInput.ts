// 语音输入 hook — 使用 WebView + Web Speech API（无需原生模块，Expo Go 可用）
import { useCallback, useRef, useState } from "react";

interface UseVoiceInputOptions {
  lang?: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

// WebView 中注入的 HTML，提供语音识别接口
export const SPEECH_HTML = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body>
<script>
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;

  function send(type, data) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data }));
  }

  function start(lang) {
    if (!SpeechRecognition) {
      send('error', '当前设备不支持语音识别');
      return;
    }
    try {
      recognition = new SpeechRecognition();
      recognition.lang = lang || 'zh-CN';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = function(event) {
        var result = event.results[event.resultIndex];
        send('result', { transcript: result[0].transcript, isFinal: result.isFinal });
      };

      recognition.onerror = function(event) {
        send('error', event.error);
      };

      recognition.onend = function() {
        send('end', null);
      };

      recognition.onstart = function() {
        send('start', null);
      };

      recognition.start();
    } catch(e) {
      send('error', e.message || '启动失败');
    }
  }

  function stop() {
    if (recognition) { try { recognition.stop(); } catch(e) {} }
  }

  function abort() {
    if (recognition) { try { recognition.abort(); } catch(e) {} }
  }

  document.addEventListener('message', function(event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.cmd === 'start') start(msg.lang);
      else if (msg.cmd === 'stop') stop();
      else if (msg.cmd === 'abort') abort();
    } catch(e) {}
  });
</script>
</body></html>
`;

export function useVoiceInput({
  lang = "zh-CN",
  onTranscript,
  onError,
}: UseVoiceInputOptions) {
  const [isListening, setIsListening] = useState(false);
  const webViewRef = useRef<any>(null);

  const sendCommand = useCallback(
    (cmd: string) => {
      const msg = JSON.stringify({ cmd, lang });
      webViewRef.current?.postMessage?.(msg);
      webViewRef.current?.injectJavaScript?.(
        `(function(){var e=new Event('message');Object.defineProperty(e,'data',{value:'${msg.replace(/'/g, "\\'")}'});document.dispatchEvent(e);})();true;`,
      );
    },
    [lang],
  );

  const handleMessage = useCallback(
    (event: any) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        switch (msg.type) {
          case "result":
            onTranscript(msg.data.transcript, msg.data.isFinal);
            break;
          case "error":
            setIsListening(false);
            onError?.(msg.data || "语音识别失败");
            break;
          case "start":
            setIsListening(true);
            break;
          case "end":
            setIsListening(false);
            break;
        }
      } catch {
        // ignore
      }
    },
    [onTranscript, onError],
  );

  const startListening = useCallback(() => {
    setIsListening(true);
    sendCommand("start");
  }, [sendCommand]);

  const stopListening = useCallback(() => {
    sendCommand("stop");
  }, [sendCommand]);

  return {
    isListening,
    webViewRef,
    handleMessage,
    startListening,
    stopListening,
  };
}
