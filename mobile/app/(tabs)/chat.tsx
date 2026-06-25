import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
} from "react";
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTabBarStore } from "../../lib/tab-bar-store";
import { ChatBubble } from "../../components/ChatBubble";
import { ChatInput } from "../../components/ChatInput";
import { SessionList } from "../../components/SessionList";
import { CapabilityBar } from "../../components/CapabilitySelector";
import { useChatStore, type Message } from "../../lib/store";
import { api } from "../../lib/api";
import { USER_ID } from "../../lib/config";
import { colors } from "../../lib/theme";
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

// 格式化时间为微信风格
function formatTimeWeChat(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const isAM = hours < 12;
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const period = isAM ? "上午" : "下午";

  if (diffMins < 1) {
    return "刚刚";
  } else if (diffMins < 60) {
    return `${diffMins}分钟前`;
  } else if (diffHours < 24) {
    return `${period}${displayHours}:${minutes}`;
  } else if (diffDays === 1) {
    return `昨天 ${period}${displayHours}:${minutes}`;
  } else if (diffDays < 7) {
    const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${weekDays[date.getDay()]} ${period}${displayHours}:${minutes}`;
  } else {
    return `${date.getMonth() + 1}/${date.getDate()} ${period}${displayHours}:${minutes}`;
  }
}

// 时间分隔组件
function TimeSeparator({ timestamp }: { timestamp: number }) {
  return (
    <View style={styles.timeSeparator}>
      <Text style={styles.timeSeparatorText}>{formatTimeWeChat(timestamp)}</Text>
    </View>
  );
}

const RenderItem = React.memo(
  ({
    item,
    onFeedback,
    onRetry,
    onEdit,
  }: {
    item: Message;
    onFeedback?: (id: string, r: "like" | "dislike") => void;
    onRetry?: () => void;
    onEdit?: (id: string, newText: string) => void;
  }) => (
    <ChatBubble
      message={item}
      onFeedback={onFeedback}
      onRetry={onRetry}
      onEdit={onEdit}
    />
  ),
);

function EmptyState() {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="chatbubbles" size={48} color={colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>AI 导师</Text>
      <Text style={styles.emptySubtitle}>输入消息开始对话</Text>
    </View>
  );
}
const MemoEmptyState = React.memo(EmptyState);

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
  } =
    useLocalSearchParams<{
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
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const selectedCapability = useChatStore((s) => s.selectedCapability);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const clearError = useChatStore((s) => s.clearError);
  const submitFeedback = useChatStore((s) => s.submitFeedback);
  const retryMessage = useChatStore((s) => s.retryMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const createSession = useChatStore((s) => s.createSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const refreshLearningContext = useChatStore((s) => s.refreshLearningContext);
  const setSelectedCapability = useChatStore((s) => s.setSelectedCapability);
  const hideTabBar = useTabBarStore((s) => s.hide);
  const showTabBar = useTabBarStore((s) => s.show);

  const flatListRef = useRef<FlatList<Message>>(null);
  const processedFollowupRef = useRef<string | null>(null);
  const processedReviewRef = useRef<string | null>(null);
  const insets = useSafeAreaInsets();
  const [sessionListVisible, setSessionListVisible] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState<"mastered" | "needs_practice" | null>(null);

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

    const titleParam = Array.isArray(reviewTitle) ? reviewTitle[0] : reviewTitle;
    const name = titleParam || kpId;
    let cancelled = false;

    const startReview = async () => {
      await createSession(`今日复习：${name}`.slice(0, 24), "主动复习");
      if (cancelled) return;

      setSelectedCapability("chat");
      const storedItem = useChatStore
        .getState()
        .learningContext.reviewPlan.find((item) => item.knowledgePointId === kpId);
      const fallbackItem: ReviewPlanItem = {
        knowledgePointId: kpId,
        name,
        mastery: numberParam(firstParam(reviewMastery), storedItem?.mastery ?? 0),
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
  const activeReviewTitle = Array.isArray(reviewTitle) ? reviewTitle[0] : reviewTitle;

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

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      // 判断是否需要显示时间分隔符
      let showTimeSeparator = false;
      if (index === 0) {
        // 第一条消息显示时间
        showTimeSeparator = true;
      } else if (index > 0) {
        // 与上一条消息间隔超过5分钟显示时间
        const prevTimestamp = messages[index - 1].timestamp;
        const currTimestamp = item.timestamp;
        const diffMinutes = (currTimestamp - prevTimestamp) / (1000 * 60);
        if (diffMinutes > 5) {
          showTimeSeparator = true;
        }
      }

      return (
        <View>
          {showTimeSeparator && <TimeSeparator timestamp={item.timestamp} />}
          <RenderItem
            item={item}
            onFeedback={submitFeedback}
            onRetry={retryMessage}
            onEdit={editMessage}
          />
        </View>
      );
    },
    [messages, submitFeedback, retryMessage, editMessage],
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      {/* Header — 只保留左侧会话切换 */}
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

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={[
          styles.messageList,
          { paddingBottom: insets.bottom + 60 },
        ]}
        ListEmptyComponent={<MemoEmptyState />}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: false })
        }
        removeClippedSubviews
        maxToRenderPerBatch={8}
        windowSize={10}
      />

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
        onCreateSession={createSession}
        onSwitchSession={switchSession}
        onDeleteSession={deleteSession}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPage },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: colors.primary,
  },
  headerLeft: { flex: 1 },
  headerTitle: { fontSize: 18, fontWeight: "600", color: colors.textInverse },
  headerAgent: { fontSize: 12, color: "rgba(255,255,255,0.8)", marginTop: 2 },
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
    backgroundColor: colors.warningLight,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
  messageList: { paddingVertical: 12, flexGrow: 1 },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 6,
  },
  emptySubtitle: { fontSize: 14, color: colors.textMuted },
  timeSeparator: {
    alignItems: "center",
    marginVertical: 12,
  },
  timeSeparatorText: {
    fontSize: 12,
    color: colors.textMuted,
    backgroundColor: colors.bgInput,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    overflow: "hidden",
  },
});
