import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  StyleSheet,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  buildChatWebViewEventScript,
  buildChatWebViewHtml,
  type ChatWebViewInboundEvent,
  type ChatWebViewMessage,
  type ChatWebViewTheme,
} from "../lib/chat-webview-html";
import { GATEWAY_URL } from "../lib/config";
import { useKatexAssets } from "../lib/katex-assets";
import { normalizeMarkdownForDisplay } from "../lib/latex-utils";
import { colors } from "../lib/theme";
import type { Message, MessageAttachment } from "../lib/types";

interface ChatWebViewProps {
  messages: Message[];
  activeSessionId?: string | null;
  hasOlderMessages: boolean;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
  bottomInset: number;
  onLoadOlderMessages?: () => void;
}

interface Snapshot {
  sessionId?: string | null;
  orderKey: string;
  statusKey: string;
  messages: Map<string, ChatWebViewMessage>;
}

function resolveAttachmentUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|file:|data:|content:|blob:)/i.test(url)) return url;
  return `${GATEWAY_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function attachmentName(attachment: MessageAttachment): string {
  return attachment.name || attachment.file_name || "文件";
}

function attachmentUri(attachment: MessageAttachment): string | undefined {
  return resolveAttachmentUrl(
    attachment.previewUri ||
      attachment.preview_uri ||
      attachment.uri ||
      attachment.url ||
      attachment.file_url,
  );
}

function mapAttachments(
  attachments: MessageAttachment[] | undefined,
): ChatWebViewMessage["attachments"] {
  if (!attachments?.length) return undefined;
  return attachments.map((attachment) => ({
    type: attachment.type,
    uri: attachmentUri(attachment),
    name: attachmentName(attachment),
    mimeType: attachment.mimeType || attachment.mime_type,
    size: attachment.size || attachment.file_size,
  }));
}

function mapCapabilityResult(
  result: Message["capabilityResult"],
): ChatWebViewMessage["capabilityResult"] {
  if (!result) return undefined;
  return {
    ...result,
    artifacts: result.artifacts?.map((artifact) => ({
      ...artifact,
      url: resolveAttachmentUrl(artifact.url) || artifact.url,
    })),
  };
}

function stripBareUrls(text: string): string {
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !/^https?:\/\/[^\s<>)\]]+$/.test(trimmed);
    })
    .join("\n")
    .trim();
}

function displayContent(message: Message): string {
  const remotePreviewOnly =
    message.historyPreviewOnly || message.storagePreviewOnly;
  const content = message.isStreaming
    ? message.contentPreview || message.content
    : remotePreviewOnly
      ? message.contentPreview || message.content
      : message.content;
  return normalizeMarkdownForDisplay(stripBareUrls(content || ""));
}

function toWebViewMessage(message: Message): ChatWebViewMessage {
  return {
    id: message.id,
    role: message.role,
    content: displayContent(message),
    contentPreview: undefined,
    isStreaming: message.isStreaming,
    timestamp: message.timestamp,
    reasoning: message.reasoning,
    agentName: message.agentName,
    modelIncomplete: message.modelIncomplete,
    serverCutoff: message.serverCutoff,
    contentTruncated: message.contentTruncated,
    contentLength: message.contentLength,
    clientPreviewOnly: message.clientPreviewOnly,
    historyPreviewOnly: message.historyPreviewOnly,
    storagePreviewOnly: message.storagePreviewOnly,
    queued: message.queued,
    attachments: mapAttachments(message.attachments),
    sources: message.sources,
    retrievalResults: message.retrievalResults,
    warnings: message.warnings,
    capabilityResult: mapCapabilityResult(message.capabilityResult),
  };
}

function messageText(message: ChatWebViewMessage): string {
  return (
    message.contentPreview ||
    message.content ||
    message.capabilityResult?.content ||
    ""
  );
}

function messageReasoning(message: ChatWebViewMessage): string {
  return message.reasoning || "";
}

function messageFingerprint(message: ChatWebViewMessage): string {
  return JSON.stringify({
    role: message.role,
    content: messageText(message),
    isStreaming: message.isStreaming,
    timestamp: message.timestamp,
    reasoning: message.reasoning,
    attachments: message.attachments,
    sources: message.sources,
    retrievalResults: message.retrievalResults,
    warnings: message.warnings,
    capabilityResult: message.capabilityResult,
    modelIncomplete: message.modelIncomplete,
    serverCutoff: message.serverCutoff,
    contentTruncated: message.contentTruncated,
    queued: message.queued,
  });
}

function messageMetadataFingerprint(message: ChatWebViewMessage): string {
  return JSON.stringify({
    role: message.role,
    timestamp: message.timestamp,
    attachments: message.attachments,
    sources: message.sources,
    retrievalResults: message.retrievalResults,
    warnings: message.warnings,
    capabilityResult: message.capabilityResult,
    modelIncomplete: message.modelIncomplete,
    serverCutoff: message.serverCutoff,
    contentTruncated: message.contentTruncated,
    queued: message.queued,
  });
}

function buildStatusKey(props: {
  hasOlderMessages: boolean;
  isLoadingMessages: boolean;
  isLoadingOlderMessages: boolean;
}): string {
  return [
    props.hasOlderMessages ? "older" : "no-older",
    props.isLoadingMessages ? "loading" : "idle",
    props.isLoadingOlderMessages ? "loading-older" : "older-idle",
  ].join("|");
}

function buildTheme(): ChatWebViewTheme {
  return {
    bgPage: colors.bgPage,
    bgCard: colors.bgCard,
    bgInput: colors.bgInput,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textMuted: colors.textMuted,
    textInverse: colors.textInverse,
    primary: colors.primary,
    primaryDark: colors.primaryDark,
    primaryLight: colors.primaryLight,
    border: colors.border,
    quoteBg: colors.quoteBg,
    warning: colors.warning,
    warningLight: colors.warningLight,
    error: colors.error,
    success: colors.success,
  };
}

export function ChatWebView({
  messages,
  activeSessionId,
  hasOlderMessages,
  isLoadingMessages,
  isLoadingOlderMessages,
  bottomInset,
  onLoadOlderMessages,
}: ChatWebViewProps) {
  const webViewRef = useRef<WebView>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);

  const theme = useMemo(buildTheme, []);
  const { katexCss, katexJs } = useKatexAssets();
  const html = useMemo(
    () =>
      buildChatWebViewHtml({
        theme,
        katexCss,
        katexJs,
      }),
    [katexCss, katexJs, theme],
  );

  const injectEvent = useCallback((event: ChatWebViewInboundEvent) => {
    if (!readyRef.current) return;
    webViewRef.current?.injectJavaScript(buildChatWebViewEventScript(event));
  }, []);

  const injectNow = useCallback((event: ChatWebViewInboundEvent) => {
    webViewRef.current?.injectJavaScript(buildChatWebViewEventScript(event));
  }, []);

  const syncMessages = useCallback(
    (forceSetMessages = false) => {
      if (!readyRef.current) return;
      const nextMessages = messages.map(toWebViewMessage);
      const nextMap = new Map(nextMessages.map((message) => [message.id, message]));
      const orderKey = nextMessages.map((message) => message.id).join("\u0000");
      const statusKey = buildStatusKey({
        hasOlderMessages,
        isLoadingMessages,
        isLoadingOlderMessages,
      });
      const prev = snapshotRef.current;
      const structuralChange =
        forceSetMessages ||
        !prev ||
        prev.sessionId !== activeSessionId ||
        prev.orderKey !== orderKey ||
        prev.statusKey !== statusKey;

      if (structuralChange) {
        injectNow({
          type: "set_messages",
          messages: nextMessages,
          hasOlderMessages,
          isLoadingMessages,
          isLoadingOlderMessages,
        });
        if (!isLoadingOlderMessages) {
          injectNow({ type: "scroll_to_bottom", animated: false });
        }
        snapshotRef.current = {
          sessionId: activeSessionId,
          orderKey,
          statusKey,
          messages: nextMap,
        };
        return;
      }

      for (const next of nextMessages) {
        const previous = prev.messages.get(next.id);
        if (!previous) {
          injectNow({ type: "replace_message", message: next });
          continue;
        }

        const nextText = messageText(next);
        const previousText = messageText(previous);
        const nextReasoning = messageReasoning(next);
        const previousReasoning = messageReasoning(previous);
        const nextFingerprint = messageFingerprint(next);
        const previousFingerprint = messageFingerprint(previous);
        const metadataUnchanged =
          messageMetadataFingerprint(next) === messageMetadataFingerprint(previous);
        const canAppendText =
          next.isStreaming &&
          nextText.length >= previousText.length &&
          nextText.startsWith(previousText);
        const canAppendReasoning =
          next.isStreaming &&
          nextReasoning.length >= previousReasoning.length &&
          nextReasoning.startsWith(previousReasoning);

        if (previous.isStreaming && !next.isStreaming) {
          injectNow({
            type: "finish_message",
            id: next.id,
            content: nextText,
            message: next,
          });
        } else if (metadataUnchanged && (canAppendText || canAppendReasoning)) {
          if (nextText.length > previousText.length) {
            injectNow({
              type: "append_delta",
              id: next.id,
              delta: nextText.slice(previousText.length),
            });
          }
          if (nextReasoning.length > previousReasoning.length) {
            injectNow({
              type: "append_reasoning_delta",
              id: next.id,
              delta: nextReasoning.slice(previousReasoning.length),
            });
          }
        } else if (nextFingerprint !== previousFingerprint) {
          injectNow({ type: "replace_message", message: next });
        }
      }

      snapshotRef.current = {
        sessionId: activeSessionId,
        orderKey,
        statusKey,
        messages: nextMap,
      };
    },
    [
      activeSessionId,
      hasOlderMessages,
      injectNow,
      isLoadingMessages,
      isLoadingOlderMessages,
      messages,
    ],
  );

  useEffect(() => {
    if (!ready) return;
    injectEvent({ type: "set_theme", theme });
    syncMessages(true);
  }, [injectEvent, ready, syncMessages, theme]);

  useEffect(() => {
    if (!ready) return;
    syncMessages(false);
  }, [ready, syncMessages]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const payload = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          href?: string;
          text?: string;
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
        if (payload.type === "copy" && typeof payload.text === "string") {
          Clipboard.setStringAsync(payload.text).catch(() => {});
          return;
        }
        if (payload.type === "load_older") {
          onLoadOlderMessages?.();
        }
      } catch {
        // Ignore unrelated WebView messages.
      }
    },
    [onLoadOlderMessages],
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
      onMessage={handleMessage}
      onLoadStart={() => {
        readyRef.current = false;
        setReady(false);
        snapshotRef.current = null;
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
