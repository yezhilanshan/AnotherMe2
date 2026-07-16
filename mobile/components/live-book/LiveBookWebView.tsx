import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, StyleSheet } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { WEB_URL } from "../../lib/config";
import { useKatexAssets } from "../../lib/katex-assets";
import { colors } from "../../lib/theme";
import type { Block, BookPage } from "../../lib/types";
import {
  buildLiveBookWebViewEventScript,
  buildLiveBookWebViewHtml,
  type LiveBookWebViewInboundEvent,
  type LiveBookWebViewProgress,
  type LiveBookWebViewTheme,
} from "../../lib/live-book-webview-html";
import type { QuizAttemptArgs } from "./blocks/QuizBlock";

interface LiveBookWebViewProps {
  bookTitle: string;
  page: BookPage;
  progress: LiveBookWebViewProgress;
  bottomInset: number;
  onQuizAttempt?: (block: Block, args: QuizAttemptArgs) => void;
}

function buildTheme(): LiveBookWebViewTheme {
  return {
    bgPage: colors.bgPage,
    bgCard: colors.bgCard,
    bgInput: colors.bgInput,
    bgElevated: colors.bgElevated,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textMuted: colors.textMuted,
    primary: colors.primary,
    primaryDark: colors.primaryDark,
    primaryLight: colors.primaryLight,
    border: colors.border,
    divider: colors.divider,
    quoteBg: colors.quoteBg,
    warning: colors.warning,
    warningLight: colors.warningLight,
    error: colors.error,
    errorLight: colors.errorLight,
    success: colors.success,
    successLight: colors.successLight,
    infoLight: colors.infoLight,
  };
}

function findBlock(page: BookPage, blockId: string): Block | undefined {
  return page.blocks.find((block) => block.id === blockId);
}

export function LiveBookWebView({
  bookTitle,
  page,
  progress,
  bottomInset,
  onQuizAttempt,
}: LiveBookWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);

  const theme = useMemo(buildTheme, []);
  const { katexCss, katexJs } = useKatexAssets();
  const html = useMemo(
    () =>
      buildLiveBookWebViewHtml({
        theme,
        assetBaseUrl: `${WEB_URL}/api/live-book/assets`,
        katexCss,
        katexJs,
      }),
    [katexCss, katexJs, theme],
  );

  const injectNow = useCallback((event: LiveBookWebViewInboundEvent) => {
    webViewRef.current?.injectJavaScript(buildLiveBookWebViewEventScript(event));
  }, []);

  const syncPage = useCallback(() => {
    if (!readyRef.current) return;
    injectNow({
      type: "set_page",
      bookTitle,
      page,
      progress,
    });
  }, [bookTitle, injectNow, page, progress]);

  useEffect(() => {
    if (!ready) return;
    syncPage();
  }, [ready, syncPage]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          href?: string;
          blockId?: string;
          questionId?: string;
          userAnswer?: string;
          isCorrect?: boolean;
        };
        if (payload.type === "ready") {
          if (!readyRef.current) {
            readyRef.current = true;
            setReady(true);
          }
          return;
        }
        if (payload.type === "link" && payload.href) {
          Linking.openURL(payload.href).catch(() => {});
          return;
        }
        if (payload.type === "quiz_attempt" && payload.blockId) {
          const block = findBlock(page, payload.blockId);
          if (!block) return;
          onQuizAttempt?.(block, {
            questionId: payload.questionId,
            userAnswer: payload.userAnswer,
            isCorrect: !!payload.isCorrect,
          });
        }
      } catch {
        // Ignore unrelated WebView messages.
      }
    },
    [onQuizAttempt, page],
  );

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      style={styles.webView}
      containerStyle={styles.webViewContainer}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled={false}
      scrollEnabled
      nestedScrollEnabled
      showsVerticalScrollIndicator
      showsHorizontalScrollIndicator={false}
      setSupportMultipleWindows={false}
      allowFileAccess
      allowsInlineMediaPlayback
      mixedContentMode="compatibility"
      onMessage={handleMessage}
      onLoadStart={() => {
        readyRef.current = false;
        setReady(false);
      }}
      contentInset={{ bottom: bottomInset }}
    />
  );
}

const styles = StyleSheet.create({
  webViewContainer: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
});
