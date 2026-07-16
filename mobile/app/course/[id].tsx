/**
 * Mobile Classroom — WebView-based with native navigation shell.
 *
 * Renders the full-featured web classroom (all 5 scene types, AI playback,
 * roundtable, chat, whiteboard) in a WebView, wrapped in a native shell
 * that provides mobile-friendly scene navigation and AI chat access.
 *
 * The native shell communicates with the web classroom via injected JS
 * to toggle sidebar, chat, and navigate scenes without touching the
 * un-adapted desktop UI.
 *
 * Route: /course/[id]
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as ScreenOrientation from "expo-screen-orientation";
import { WEB_URL } from "../../lib/config";
import {
  useVoiceInput,
  VOICE_RECOGNITION_BUSY_MESSAGE,
} from "../../hooks/useVoiceInput";

// ── Screen ──

export default function CourseDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const webViewRef = useRef<WebView>(null);
  const activeVoiceRequestIdRef = useRef<string | null>(null);
  const voiceResultSentRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [webError, setWebError] = useState(false);
  const webViewVersion = useMemo(() => Date.now().toString(), [id]);
  const webViewSafeAreaStyle = useMemo(
    () => ({
      paddingTop: insets.top,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
      paddingLeft: insets.left,
    }),
    [insets.bottom, insets.left, insets.right, insets.top],
  );
  const loadingBarSafeAreaStyle = useMemo(
    () => ({
      top: insets.top,
      left: insets.left,
      right: insets.right,
    }),
    [insets.left, insets.right, insets.top],
  );
  const errorOverlaySafeAreaStyle = useMemo(
    () => ({
      paddingTop: insets.top + 32,
      paddingRight: insets.right + 32,
      paddingBottom: insets.bottom + 32,
      paddingLeft: insets.left + 32,
    }),
    [insets.bottom, insets.left, insets.right, insets.top],
  );

  const webUrl = `${WEB_URL}/classroom/${id}?mobile=1&v=${webViewVersion}`;

  const emitNativeVoiceEvent = useCallback(
    (payload: {
      id: string;
      type: "result" | "error" | "end";
      text?: string;
      error?: string;
    }) => {
      const detail = JSON.stringify(payload);
      webViewRef.current?.injectJavaScript(
        `window.dispatchEvent(new CustomEvent('anotherme:native-voice',{detail:${detail}}));true;`,
      );
    },
    [],
  );

  const sendNativeVoiceResult = useCallback(
    (text: string) => {
      const requestId = activeVoiceRequestIdRef.current;
      if (!requestId || voiceResultSentRef.current) return;

      voiceResultSentRef.current = true;
      activeVoiceRequestIdRef.current = null;
      emitNativeVoiceEvent({
        id: requestId,
        type: "result",
        text,
      });
    },
    [emitNativeVoiceEvent],
  );

  const sendNativeVoiceError = useCallback(
    (error: string) => {
      const requestId = activeVoiceRequestIdRef.current;
      if (!requestId || voiceResultSentRef.current) return;

      voiceResultSentRef.current = true;
      activeVoiceRequestIdRef.current = null;
      emitNativeVoiceEvent({
        id: requestId,
        type: "error",
        error,
      });
    },
    [emitNativeVoiceEvent],
  );

  const { startListening, stopListening, abortListening } = useVoiceInput({
    lang: "zh-CN",
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        sendNativeVoiceResult(text);
      }
    },
    onError: sendNativeVoiceError,
  });

  // Lock to landscape for immersive classroom experience
  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      abortListening();
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
    };
  }, [abortListening]);

  // ── WebView event handlers ──

  const handleLoadEnd = useCallback(() => setLoading(false), []);
  const handleLoadStart = useCallback(() => {
    setLoading(true);
    setWebError(false);
  }, []);
  const handleError = useCallback(() => {
    setLoading(false);
    setWebError(true);
  }, []);

  const handleVoiceBridgeMessage = useCallback(
    async (message: {
      source?: string;
      type?: string;
      id?: string;
    }) => {
      if (message.source !== "anotherme-classroom" || !message.id) return false;

      if (message.type === "voice:start") {
        if (
          activeVoiceRequestIdRef.current &&
          activeVoiceRequestIdRef.current !== message.id
        ) {
          await abortListening();
        }

        activeVoiceRequestIdRef.current = message.id;
        voiceResultSentRef.current = false;
        const started = await startListening();
        if (!started) {
          sendNativeVoiceError(VOICE_RECOGNITION_BUSY_MESSAGE);
        }
        return true;
      }

      if (
        message.type === "voice:stop" &&
        activeVoiceRequestIdRef.current === message.id
      ) {
        const text = await stopListening();
        sendNativeVoiceResult(text);
        return true;
      }

      if (
        message.type === "voice:cancel" &&
        activeVoiceRequestIdRef.current === message.id
      ) {
        await abortListening();
        activeVoiceRequestIdRef.current = null;
        voiceResultSentRef.current = true;
        emitNativeVoiceEvent({ id: message.id, type: "end" });
        return true;
      }

      return false;
    },
    [
      abortListening,
      emitNativeVoiceEvent,
      sendNativeVoiceError,
      sendNativeVoiceResult,
      startListening,
      stopListening,
    ],
  );

  // Listen for messages from the web classroom, including native voice bridge requests.
  const handleMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const message = JSON.parse(event.nativeEvent.data);
        void handleVoiceBridgeMessage(message);
      } catch {
        // Non-JSON messages ignored
      }
    },
    [handleVoiceBridgeMessage],
  );

  const handleGoBack = useCallback(() => router.back(), [router]);
  const handleRefresh = useCallback(() => {
    setWebError(false);
    webViewRef.current?.reload();
  }, []);

  return (
    <View style={styles.container}>
      {/* WebView stays inside the edge-to-edge safe area so Android system bars do not cover classroom controls. */}
      <View style={[styles.webviewSafeArea, webViewSafeAreaStyle]}>
        <WebView
          ref={webViewRef}
          source={{ uri: webUrl }}
          style={styles.webview}
          onLoadStart={handleLoadStart}
          onLoadEnd={handleLoadEnd}
          onError={handleError}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          cacheEnabled={false}
          startInLoadingState
          allowsBackForwardNavigationGestures
          scalesPageToFit={false}
          overScrollMode="never"
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mediaCapturePermissionGrantType="grant"
          allowsAirPlayForMediaPlayback
        />
      </View>

      {/* Loading indicator — thin bar at top */}
      {loading && (
        <View style={[styles.loadingBar, loadingBarSafeAreaStyle]}>
          <ActivityIndicator size="small" color="#8B5CF6" />
        </View>
      )}

      {/* Back button — floating at top-left */}
      <TouchableOpacity
        onPress={handleGoBack}
        style={[
          styles.backButtonFloating,
          {
            top: Math.max(insets.top, 12) + 8,
            left: Math.max(insets.left, 12),
          },
        ]}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={22} color="#FFF" />
      </TouchableOpacity>

      {/* Error overlay */}
      {webError && (
        <View style={[styles.errorOverlay, errorOverlaySafeAreaStyle]}>
          <View style={styles.errorCard}>
            <Ionicons name="cloud-offline-outline" size={48} color="#CCC" />
            <Text style={styles.errorMessage}>加载失败，请检查网络连接</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={handleRefresh}
              >
                <Ionicons name="refresh" size={18} color="#FFF" />
                <Text style={styles.retryText}>重试</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.backButton}
                onPress={handleGoBack}
              >
                <Ionicons name="arrow-back" size={18} color="#666" />
                <Text style={styles.backText}>返回</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  webviewSafeArea: {
    flex: 1,
    backgroundColor: "#f6f4f0",
  },
  webview: {
    flex: 1,
    backgroundColor: "#f6f4f0",
  },
  loadingBar: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 50,
    height: 2,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
  },

  // Floating back button
  backButtonFloating: {
    position: "absolute",
    zIndex: 60,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },

  // Error
  errorOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(245,245,245,0.97)",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    zIndex: 100,
  },
  errorCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 300,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  errorMessage: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    marginTop: 12,
    marginBottom: 20,
  },
  errorActions: {
    flexDirection: "row",
    gap: 12,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "#007AFF",
  },
  retryText: { color: "#FFF", fontSize: 14, fontWeight: "600" },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DDD",
  },
  backText: { color: "#666", fontSize: 14 },
});
