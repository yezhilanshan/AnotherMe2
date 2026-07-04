import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTabBarStore } from "../../lib/tab-bar-store";
import { ChatWebView } from "../../components/ChatWebView";
import { ChatInput } from "../../components/ChatInput";
import { RenderDebugBoundary } from "../../components/RenderDebugBoundary";
import { SessionList } from "../../components/SessionList";
import { CapabilityBar } from "../../components/CapabilitySelector";
import { useChatStore } from "../../lib/store";
import { api } from "../../lib/api";
import { USER_ID } from "../../lib/config";
import { colors } from "../../lib/theme";
import { BackgroundImage } from "../../components/ui/BackgroundImage";
import type { MessageAttachment, ReviewPlanItem } from "../../lib/types";
import { buildReviewPrompt } from "../../lib/review-scheduler";
import {
  buildProblemStepFollowupPrompt,
  buildProblemStepFollowupTitle,
  getProblemStepFollowupCapability,
  loadProblemStepFollowupContext,
  removeProblemStepFollowupContext,
} from "../../lib/problem-step-followup";
import {
  createSocraticFollowupState,
  saveSocraticFollowupState,
} from "../../lib/socratic-followup";

const PEACH_OVERLAY = "rgba(255, 245, 240, 0.72)";

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function numberParam(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function ChatScreen() {
  const {
    followupId,
    reviewKnowledgePointId,
    reviewTitle,
    reviewMastery,
    reviewReason,
    reviewMaterial,
    reviewCheckQuestion,
    reviewIntervalDays,
    reviewNextReviewAt,
  } = useLocalSearchParams<{
    followupId?: string | string[];
    reviewKnowledgePointId?: string | string[];
    reviewTitle?: string | string[];
    reviewMastery?: string | string[];
    reviewReason?: string | string[];
    reviewMaterial?: string | string[];
    reviewCheckQuestion?: string | string[];
    reviewIntervalDays?: string | string[];
    reviewNextReviewAt?: string | string[];
  }>();
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const error = useChatStore((s) => s.error);
  const currentAgent = useChatStore((s) => s.currentAgent);
  const isLoadingMessages = useChatStore((s) => s.isLoadingMessages);
  const isLoadingOlderMessages = useChatStore((s) => s.isLoadingOlderMessages);
  const hasOlderMessages = useChatStore((s) => s.hasOlderMessages);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedCapability = useChatStore((s) => s.selectedCapability);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const clearError = useChatStore((s) => s.clearError);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const refreshLearningContext = useChatStore((s) => s.refreshLearningContext);
  const setSelectedCapability = useChatStore((s) => s.setSelectedCapability);
  const hideTabBar = useTabBarStore((s) => s.hide);
  const showTabBar = useTabBarStore((s) => s.show);

  const processedFollowupRef = useRef<string | null>(null);
  const processedReviewRef = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  const [sessionListVisible, setSessionListVisible] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState<
    "mastered" | "needs_practice" | null
  >(null);

  useEffect(() => {
    loadSessions();
    refreshLearningContext();
  }, []);

  useEffect(() => {
    const id = Array.isArray(followupId) ? followupId[0] : followupId;
    if (!id || processedFollowupRef.current === id) return;
    processedFollowupRef.current = id;

    let cancelled = false;
    const startFollowup = async () => {
      const context = await loadProblemStepFollowupContext(id);
      if (!context || cancelled) return;

      const title = buildProblemStepFollowupTitle(context);
      const sessionId = await createSession(title, "拍题追问");
      if (cancelled) return;

      if (context.intent === "socratic") {
        await saveSocraticFollowupState(
          createSocraticFollowupState({ sessionId, context }),
        );
        if (cancelled) return;
      }

      const capability = getProblemStepFollowupCapability(context);
      setSelectedCapability(capability);
      const prompt = buildProblemStepFollowupPrompt(context);
      if (cancelled) return;

      await sendMessage(prompt, capability);
      removeProblemStepFollowupContext(id).catch(() => {});
    };

    startFollowup().catch((err) => {
      console.warn("[chat] problem step followup failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [followupId, createSession, sendMessage, setSelectedCapability]);

  useEffect(() => {
    const kpId = Array.isArray(reviewKnowledgePointId)
      ? reviewKnowledgePointId[0]
      : reviewKnowledgePointId;
    if (!kpId || processedReviewRef.current === kpId) return;
    processedReviewRef.current = kpId;

    const titleParam = Array.isArray(reviewTitle)
      ? reviewTitle[0]
      : reviewTitle;
    const name = titleParam || kpId;
    let cancelled = false;

    const startReview = async () => {
      await createSession(`今日复习：${name}`.slice(0, 24), "主动复习");
      if (cancelled) return;

      setSelectedCapability("chat");
      const storedItem = useChatStore
        .getState()
        .learningContext.reviewPlan.find(
          (item) => item.knowledgePointId === kpId,
        );
      const fallbackItem: ReviewPlanItem = {
        knowledgePointId: kpId,
        name,
        mastery: numberParam(
          firstParam(reviewMastery),
          storedItem?.mastery ?? 0,
        ),
        attempts: storedItem?.attempts ?? 0,
        lastPracticedAt: storedItem?.lastPracticedAt,
        nextReviewAt:
          firstParam(reviewNextReviewAt) ||
          storedItem?.nextReviewAt ||
          new Date().toISOString(),
        dueToday: storedItem?.dueToday ?? true,
        overdueDays: storedItem?.overdueDays ?? 0,
        intervalDays: numberParam(
          firstParam(reviewIntervalDays),
          storedItem?.intervalDays ?? 1,
        ),
        reason:
          firstParam(reviewReason) ||
          storedItem?.reason ||
          "系统根据遗忘曲线安排今日复习",
        material:
          firstParam(reviewMaterial) ||
          storedItem?.material ||
          `复习「${name}」的核心概念和易错点。`,
        checkQuestion:
          firstParam(reviewCheckQuestion) ||
          storedItem?.checkQuestion ||
          `写出「${name}」最容易错的一步，并举一个简单例子。`,
      };
      const prompt = buildReviewPrompt(storedItem || fallbackItem);
      await sendMessage(prompt, "chat");
    };

    startReview().catch((err) => {
      console.warn("[chat] review prompt failed:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [
    reviewKnowledgePointId,
    reviewTitle,
    reviewMastery,
    reviewReason,
    reviewMaterial,
    reviewCheckQuestion,
    reviewIntervalDays,
    reviewNextReviewAt,
    createSession,
    sendMessage,
    setSelectedCapability,
  ]);

  // 输入框聚焦时更新状态并隐藏底部标签栏
  const handleFocusChange = useCallback((focused: boolean) => {
    setInputFocused(focused);
  }, []);

  const handleNewSession = useCallback(async () => {
    await createSession("新对话");
  }, [createSession]);

  // 监听键盘弹起/收起，通过 store 控制底部标签栏显隐
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      hideTabBar();
    });
    const hideSub = Keyboard.addListener("keyboardDidHide", () => {
      showTabBar();
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [hideTabBar, showTabBar]);

  const handleSend = useCallback(
    async (text: string, attachments?: MessageAttachment[]) => {
      if (!useChatStore.getState().activeSessionId) {
        await createSession("新对话");
      }
      await sendMessage(text, undefined, attachments);
      // 发送后恢复 tab bar
      handleFocusChange(false);
    },
    [sendMessage, createSession, handleFocusChange],
  );

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeReviewKnowledgePointId = Array.isArray(reviewKnowledgePointId)
    ? reviewKnowledgePointId[0]
    : reviewKnowledgePointId;
  const activeReviewTitle = Array.isArray(reviewTitle)
    ? reviewTitle[0]
    : reviewTitle;

  const submitReviewResult = useCallback(
    async (isCorrect: boolean) => {
      if (!activeReviewKnowledgePointId || reviewSubmitting) return;
      setReviewSubmitting(true);
      try {
        await api.knowledge.processQuizAnswer(USER_ID, {
          question_id: `review-${activeReviewKnowledgePointId}-${Date.now()}`,
          is_correct: isCorrect,
          knowledge_point_ids: [activeReviewKnowledgePointId],
          payload: {
            source: "mobile_review",
            review_title: activeReviewTitle || activeReviewKnowledgePointId,
            answer_self_assessment: isCorrect ? "mastered" : "needs_practice",
          },
        });
        api.learningEvents
          .createForUser(USER_ID, {
            event_type: "review_completed",
            session_id: activeSessionId || undefined,
            knowledge_points: [activeReviewKnowledgePointId],
            payload: {
              source: "mobile_review",
              is_correct: isCorrect,
              review_title: activeReviewTitle || activeReviewKnowledgePointId,
            },
          })
          .catch(() => {});
        setReviewSubmitted(isCorrect ? "mastered" : "needs_practice");
        await refreshLearningContext();
      } catch (err) {
        console.warn("[chat] review result submit failed:", err);
      } finally {
        setReviewSubmitting(false);
      }
    },
    [
      activeReviewKnowledgePointId,
      activeReviewTitle,
      activeSessionId,
      reviewSubmitting,
      refreshLearningContext,
    ],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <BackgroundImage
        source={require("../../assets/backgrounds/chat_bg.png")}
        overlayColor={PEACH_OVERLAY}
      />
      {/* Header — 左侧会话切换，右侧新建会话 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.headerLeft}
          onPress={() => setSessionListVisible(true)}
        >
          <Text style={styles.headerTitle} numberOfLines={1}>
            {activeSession?.title || "AI 导师"}
          </Text>
          {currentAgent ? (
            <Text style={styles.headerAgent}>当前: {currentAgent}</Text>
          ) : sessions.length > 0 ? (
            <Text style={styles.headerAgent}>
              点击切换 · {sessions.length} 个会话
            </Text>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerNewButton}
          onPress={handleNewSession}
          activeOpacity={0.7}
        >
          <Ionicons
            name="add-circle-outline"
            size={28}
            color={colors.textPrimary}
          />
        </TouchableOpacity>
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={clearError}>
            <Text style={styles.errorDismiss}>✕</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {activeReviewKnowledgePointId ? (
        <View style={styles.reviewBanner}>
          <View style={styles.reviewBannerTextWrap}>
            <Text style={styles.reviewBannerTitle} numberOfLines={1}>
              今日复习：{activeReviewTitle || activeReviewKnowledgePointId}
            </Text>
            <Text style={styles.reviewBannerSub} numberOfLines={1}>
              {reviewSubmitted === "mastered"
                ? "已记录为掌握，复习间隔会自动后移"
                : reviewSubmitted === "needs_practice"
                  ? "已记录为还不熟，系统会更快安排复习"
                  : "复习后请选择结果，更新知识掌握度"}
            </Text>
          </View>
          <View style={styles.reviewBannerActions}>
            <TouchableOpacity
              style={[styles.reviewResultButton, styles.reviewWeakButton]}
              disabled={reviewSubmitting}
              onPress={() => submitReviewResult(false)}
            >
              <Text style={[styles.reviewResultText, styles.reviewWeakText]}>
                还不熟
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reviewResultButton, styles.reviewMasteredButton]}
              disabled={reviewSubmitting}
              onPress={() => submitReviewResult(true)}
            >
              <Text style={styles.reviewMasteredText}>已掌握</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <RenderDebugBoundary
        name="ChatWebView"
        meta={{
          messageCount: messages.length,
          sessionId: activeSessionId,
        }}
      >
        <ChatWebView
          messages={messages}
          activeSessionId={activeSessionId}
          hasOlderMessages={hasOlderMessages}
          isLoadingMessages={isLoadingMessages}
          isLoadingOlderMessages={isLoadingOlderMessages}
          bottomInset={insets.bottom + 60}
          backgroundColor="transparent"
          onLoadOlderMessages={loadOlderMessages}
        />
      </RenderDebugBoundary>

      <CapabilityBar
        selectedCapability={selectedCapability}
        onSelect={setSelectedCapability}
        visible={!isStreaming && !inputFocused}
      />
      <ChatInput
        onSend={handleSend}
        onStop={stopStreaming}
        isStreaming={isStreaming}
        disabled={false}
        onFocusChange={handleFocusChange}
      />

      <SessionList
        visible={sessionListVisible}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onClose={() => setSessionListVisible(false)}
        onSwitchSession={switchSession}
        onDeleteSession={deleteSession}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "rgba(0,0,0,0)" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerLeft: { flex: 1, paddingRight: 12 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  headerAgent: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  headerNewButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  errorContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.errorLight,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: { color: colors.error, fontSize: 14, flex: 1 },
  errorDismiss: {
    color: colors.error,
    fontSize: 18,
    fontWeight: "bold",
    paddingLeft: 12,
  },
  reviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255, 232, 224, 0.9)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.5)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  reviewBannerTextWrap: { flex: 1, minWidth: 0 },
  reviewBannerTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  reviewBannerSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  reviewBannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  reviewResultButton: {
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
  },
  reviewWeakButton: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.bgCard,
  },
  reviewMasteredButton: {
    backgroundColor: colors.success,
  },
  reviewResultText: {
    fontSize: 12,
    fontWeight: "700",
  },
  reviewWeakText: {
    color: colors.warning,
  },
  reviewMasteredText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textInverse,
  },
});
