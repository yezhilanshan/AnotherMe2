import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { USER_ID } from "../lib/config";
import {
  buildProblemStepFollowupTitle,
  loadProblemStepFollowupContext,
} from "../lib/problem-step-followup";
import {
  buildSocraticLearningSignal,
  createSocraticFollowupState,
  getSocraticKnowledgePointIds,
  loadSocraticFollowupState,
  saveSocraticFollowupState,
  type SocraticFollowupState,
} from "../lib/socratic-followup";
import {
  advanceSocraticStateFromEvaluation,
  advanceSocraticStateFromVariantEvaluation,
  createInitialSocraticTurn,
  evaluateSocraticAttempt,
  evaluateVariantAnswer,
  inferStepGoal,
  makeWorkbenchTurn,
  type SocraticAttemptEvaluation,
  type SocraticVariantEvaluation,
  type SocraticWorkbenchTurn,
} from "../lib/socratic-workbench";
import { useChatStore } from "../lib/store";
import { colors } from "../lib/theme";

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function actionLabel(action?: string): string {
  const labels: Record<string, string> = {
    ask_observation: "观察问题",
    ask_restate: "复述目标",
    ask_next_step: "下一步",
    give_light_hint: "轻提示",
    give_directional_hint: "方向提示",
    give_structured_hint: "拆一步",
    reveal_contradiction: "反诘",
    explain_minimally: "最小解释",
    ask_variant_check: "变式确认",
    confirm_mastery: "确认掌握",
  };
  return action ? labels[action] || action : "";
}

function verdictLabel(verdict?: string): string {
  const labels: Record<string, string> = {
    no_attempt: "还没有形成尝试",
    incorrect: "暂不正确",
    partial: "部分正确",
    correct: "方向正确",
    misconception: "存在误区",
  };
  return verdict ? labels[verdict] || verdict : "";
}

function variantVerdictLabel(verdict?: "correct" | "partial" | "incorrect"): string {
  const labels = {
    correct: "变式通过",
    partial: "变式部分通过",
    incorrect: "变式未通过",
  } as const;
  return verdict ? labels[verdict] || verdict : "";
}

export default function SocraticWorkbenchScreen() {
  const { followupId } = useLocalSearchParams<{ followupId?: string | string[] }>();
  const id = firstParam(followupId);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const refreshLearningContext = useChatStore((s) => s.refreshLearningContext);

  const [title, setTitle] = useState("引导追问");
  const [stepGoal, setStepGoal] = useState("");
  const [state, setState] = useState<SocraticFollowupState | null>(null);
  const [turns, setTurns] = useState<SocraticWorkbenchTurn[]>([]);
  const [attempt, setAttempt] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef<Awaited<ReturnType<typeof loadProblemStepFollowupContext>>>(null);
  const abortRef = useRef<AbortController | null>(null);

  const currentQuestion = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].role === "tutor") return turns[i].text;
    }
    return "";
  }, [turns]);

  const pendingVariantQuestion = useMemo(() => {
    if (!state?.variantQuestion) return "";
    if (state.variantCompletedAt) return "";
    return state.variantQuestion;
  }, [state]);

  const recordEvent = useCallback(
    (body: {
      event_type: string;
      weight?: number;
      knowledge_points?: string[];
      payload?: Record<string, unknown>;
    }) => {
      if (!id) return;
      api.learningEvents
        .createForUser(USER_ID, {
          event_type: body.event_type,
          block_id: id,
          knowledge_points: body.knowledge_points,
          payload: body.payload,
          weight: body.weight,
        })
        .catch(() => {});
    },
    [id],
  );

  useEffect(() => {
    if (!id) {
      setError("缺少追问上下文");
      setLoading(false);
      return;
    }

    let cancelled = false;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const context = await loadProblemStepFollowupContext(id);
        if (!context || cancelled) {
          if (!context) setError("追问上下文已失效，请从拍题步骤重新进入");
          return;
        }
        contextRef.current = context;
        setTitle(buildProblemStepFollowupTitle(context));
        setStepGoal(inferStepGoal(context));

        const sessionId = `workbench-${context.id}`;
        let nextState = await loadSocraticFollowupState(sessionId);
        if (!nextState) {
          nextState = createSocraticFollowupState({ sessionId, context });
          await saveSocraticFollowupState(nextState);
        }
        if (cancelled) return;
        setState(nextState);

        recordEvent({
          event_type: "socratic_step_started",
          weight: 0.3,
          knowledge_points: getSocraticKnowledgePointIds(nextState),
          payload: {
            source: "mobile_socratic_workbench",
            followup_id: context.id,
            step_id: context.step.id,
            step_title: context.step.title,
            step_goal: inferStepGoal(context),
          },
        });

        const initial = await createInitialSocraticTurn({
          context,
          state: nextState,
          signal: controller.signal,
        });
        if (cancelled) return;
        setTurns([initial]);
        const initializedState = {
          ...nextState,
          lastAssistantPrompt: initial.text,
          updatedAt: Date.now(),
        };
        await saveSocraticFollowupState(initializedState);
        if (!cancelled) setState(initializedState);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "初始化引导失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, recordEvent]);

  const persistVariantOutcome = useCallback(
    (input: {
      context: NonNullable<Awaited<ReturnType<typeof loadProblemStepFollowupContext>>>;
      nextState: SocraticFollowupState;
      evaluation: SocraticVariantEvaluation;
    }) => {
      const knowledgePointIds = getSocraticKnowledgePointIds(input.nextState);
      const isCorrect = input.evaluation.verdict === "correct";

      if (knowledgePointIds.length) {
        api.knowledge
          .processQuizAnswer(USER_ID, {
            question_id: `socratic-workbench-${input.context.id}`,
            is_correct: isCorrect,
            knowledge_point_ids: knowledgePointIds,
            payload: {
              source: "mobile_socratic_workbench",
              followup_id: input.context.id,
              step_title: input.context.step.title,
              variant_question: input.nextState.variantQuestion || "",
              variant_answer: input.nextState.variantAnswer || "",
              variant_verdict: input.evaluation.verdict,
            },
          })
          .then(() => refreshLearningContext())
          .catch(() => {});
      }

      recordEvent({
        event_type: "socratic_variant_completed",
        weight: isCorrect ? 1 : 0.5,
        knowledge_points: knowledgePointIds,
        payload: {
          source: "mobile_socratic_workbench",
          followup_id: input.context.id,
          step_title: input.context.step.title,
          variant_question: input.nextState.variantQuestion || "",
          variant_answer: input.nextState.variantAnswer || "",
          variant_verdict: input.evaluation.verdict,
          diagnosis: input.evaluation.conciseDiagnosis,
          is_mastered: isCorrect,
        },
      });

      if (isCorrect) {
        recordEvent({
          event_type: "socratic_step_mastered",
          weight: 1,
          knowledge_points: knowledgePointIds,
          payload: {
            source: "mobile_socratic_workbench",
            followup_id: input.context.id,
            step_title: input.context.step.title,
            variant_question: input.nextState.variantQuestion || "",
          },
        });
      }
    },
    [recordEvent, refreshLearningContext],
  );

  const applyEvaluation = useCallback(
    async (studentText: string) => {
      const context = contextRef.current;
      if (!context || !state || !studentText.trim() || submitting || pendingVariantQuestion) return;
      setSubmitting(true);
      setError(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const studentTurn = makeWorkbenchTurn({
        role: "student",
        text: studentText.trim(),
      });
      setTurns((prev) => [...prev, studentTurn]);
      setAttempt("");

      recordEvent({
        event_type: "socratic_attempt_submitted",
        weight: 0.4,
        knowledge_points: getSocraticKnowledgePointIds(state),
        payload: {
          source: "mobile_socratic_workbench",
          followup_id: context.id,
          step_title: context.step.title,
          step_goal: inferStepGoal(context),
          student_attempt: studentText.trim(),
          phase: state.phase,
          hint_level: state.hintLevel,
        },
      });

      try {
        const evaluation: SocraticAttemptEvaluation = await evaluateSocraticAttempt({
          context,
          state,
          attempt: studentText.trim(),
          lastTutorQuestion: currentQuestion,
          signal: controller.signal,
        });
        const nextState = advanceSocraticStateFromEvaluation({
          state,
          attempt: studentText.trim(),
          evaluation,
        });
        await saveSocraticFollowupState(nextState);
        setState(nextState);

        const signal = buildSocraticLearningSignal({
          previousState: state,
          nextState,
          userText: studentText.trim(),
          assistantText: evaluation.tutorReply,
        });
        recordEvent({
          event_type: "socratic_attempt_evaluated",
          weight: signal.weight,
          knowledge_points: signal.knowledgePointIds,
          payload: {
            ...signal.payload,
            verdict: evaluation.verdict,
            confidence: evaluation.confidence,
            misconception_type: evaluation.misconceptionType || "",
            action: evaluation.nextAction,
            diagnosis: evaluation.conciseDiagnosis,
            extracted_knowledge_point_ids: evaluation.extractedKnowledgePointIds,
          },
        });

        if (
          evaluation.nextAction.includes("hint") ||
          evaluation.nextAction === "reveal_contradiction"
        ) {
          recordEvent({
            event_type:
              evaluation.nextAction === "reveal_contradiction"
                ? "socratic_misconception_detected"
                : "socratic_hint_given",
            weight: 0.5,
            knowledge_points: signal.knowledgePointIds,
            payload: {
              source: "mobile_socratic_workbench",
              followup_id: context.id,
              action: evaluation.nextAction,
              verdict: evaluation.verdict,
              hint_level: nextState.hintLevel,
              diagnosis: evaluation.conciseDiagnosis,
            },
          });
        }

        if (
          evaluation.shouldAskVariant ||
          evaluation.nextAction === "ask_variant_check" ||
          evaluation.nextAction === "confirm_mastery"
        ) {
          recordEvent({
            event_type: "socratic_variant_assigned",
            weight: 0.6,
            knowledge_points: signal.knowledgePointIds,
            payload: {
              source: "mobile_socratic_workbench",
              followup_id: context.id,
              variant_question: evaluation.variantQuestion || nextState.variantQuestion || "",
            },
          });
        }

        setTurns((prev) => [
          ...prev,
          makeWorkbenchTurn({
            role: "system",
            text: verdictLabel(evaluation.verdict),
            verdict: evaluation.verdict,
            diagnosis: evaluation.conciseDiagnosis,
          }),
          makeWorkbenchTurn({
            role: "tutor",
            text: evaluation.tutorReply,
            action: evaluation.nextAction,
          }),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "诊断失败，请稍后重试");
      } finally {
        setSubmitting(false);
      }
    },
    [currentQuestion, pendingVariantQuestion, recordEvent, state, submitting],
  );

  const applyVariantCheck = useCallback(
    async (studentText: string) => {
      const context = contextRef.current;
      if (!context || !state || !studentText.trim() || submitting || !pendingVariantQuestion) return;
      setSubmitting(true);
      setError(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const answer = studentText.trim();
      setTurns((prev) => [
        ...prev,
        makeWorkbenchTurn({
          role: "student",
          text: answer,
        }),
      ]);
      setAttempt("");

      try {
        const evaluation = await evaluateVariantAnswer({
          context,
          state,
          answer,
          signal: controller.signal,
        });
        const nextState = advanceSocraticStateFromVariantEvaluation({
          state,
          answer,
          evaluation,
        });
        await saveSocraticFollowupState(nextState);
        setState(nextState);
        persistVariantOutcome({ context, nextState, evaluation });

        setTurns((prev) => [
          ...prev,
          makeWorkbenchTurn({
            role: "system",
            text: variantVerdictLabel(evaluation.verdict),
            diagnosis: evaluation.conciseDiagnosis,
          }),
          makeWorkbenchTurn({
            role: "tutor",
            text: evaluation.tutorReply,
            action:
              evaluation.verdict === "correct"
                ? "confirm_mastery"
                : evaluation.verdict === "partial"
                  ? "give_directional_hint"
                  : "give_structured_hint",
          }),
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "变式检查失败，请稍后重试");
      } finally {
        setSubmitting(false);
      }
    },
    [pendingVariantQuestion, persistVariantOutcome, state, submitting],
  );

  const handleShortcut = useCallback(
    (kind: "hint" | "stuck" | "explain") => {
      if (pendingVariantQuestion) return;
      if (kind === "hint") {
        applyEvaluation("我想先要一点提示，但请不要直接给答案。");
      } else if (kind === "stuck") {
        applyEvaluation("我卡住了，还不知道该从哪个条件开始。");
      } else {
        applyEvaluation("我需要你做最小必要解释，然后让我复述。");
      }
    },
    [applyEvaluation, pendingVariantQuestion],
  );

  const renderTurn = ({ item }: { item: SocraticWorkbenchTurn }) => {
    const isStudent = item.role === "student";
    const isSystem = item.role === "system";
    return (
      <View
        style={[
          styles.turn,
          isStudent && styles.studentTurn,
          isSystem && styles.systemTurn,
        ]}
      >
        <View style={styles.turnHeader}>
          <Text style={styles.turnRole}>
            {isStudent ? "我的想法" : isSystem ? "诊断" : "AI 导师"}
          </Text>
          {item.action ? (
            <Text style={styles.turnBadge}>{actionLabel(item.action)}</Text>
          ) : null}
          {item.verdict ? (
            <Text style={[styles.turnBadge, styles.verdictBadge]}>
              {verdictLabel(item.verdict)}
            </Text>
          ) : null}
        </View>
        <Text style={styles.turnText}>{item.text}</Text>
        {item.diagnosis ? (
          <Text style={styles.diagnosisText}>{item.diagnosis}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textInverse} />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            先尝试，再提示
          </Text>
        </View>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => {
            if (!id) return;
            router.push({ pathname: "/chat", params: { followupId: id } });
          }}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={21} color={colors.textInverse} />
        </TouchableOpacity>
      </View>

      <View style={styles.goalCard}>
        <Text style={styles.goalLabel}>当前最小目标</Text>
        <Text style={styles.goalText}>{stepGoal || "弄清楚当前步骤为什么成立"}</Text>
        {state ? (
          <View style={styles.stateRow}>
            <Text style={styles.statePill}>层级 {state.hintLevel}/3</Text>
            <Text style={styles.statePill}>尝试 {state.studentAttempts}</Text>
            <Text style={styles.statePill}>阶段 {state.phase}</Text>
          </View>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Ionicons name="close" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      ) : null}

      {pendingVariantQuestion ? (
        <View style={styles.variantCard}>
          <Text style={styles.variantLabel}>变式检查</Text>
          <Text style={styles.variantText}>{pendingVariantQuestion}</Text>
          <Text style={styles.variantHint}>先回答这个小变式，再决定这一步是否算掌握。</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>正在准备引导问题...</Text>
        </View>
      ) : (
        <FlatList
          data={turns}
          keyExtractor={(item) => item.id}
          renderItem={renderTurn}
          contentContainerStyle={[
            styles.turnList,
            { paddingBottom: insets.bottom + 160 },
          ]}
        />
      )}

      <View style={[styles.inputPanel, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {pendingVariantQuestion ? null : (
          <View style={styles.shortcutRow}>
            <TouchableOpacity
              style={styles.shortcutButton}
              disabled={submitting || loading}
              onPress={() => handleShortcut("hint")}
            >
              <Text style={styles.shortcutText}>给一点提示</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shortcutButton}
              disabled={submitting || loading}
              onPress={() => handleShortcut("stuck")}
            >
              <Text style={styles.shortcutText}>我卡住了</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.shortcutButton}
              disabled={submitting || loading}
              onPress={() => handleShortcut("explain")}
            >
              <Text style={styles.shortcutText}>最小解释</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={attempt}
            onChangeText={setAttempt}
            placeholder={pendingVariantQuestion ? "写下你对这个变式的回答..." : "写下你的想法或下一步..."}
            placeholderTextColor={colors.textMuted}
            multiline
            editable={!submitting && !loading}
          />
          <TouchableOpacity
            style={[
              styles.submitButton,
              (!attempt.trim() || submitting || loading) && styles.submitDisabled,
            ]}
            disabled={!attempt.trim() || submitting || loading}
            onPress={() =>
              pendingVariantQuestion ? applyVariantCheck(attempt) : applyEvaluation(attempt)
            }
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Ionicons name="checkmark" size={22} color={colors.textInverse} />
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPage,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    color: colors.textInverse,
    fontSize: 17,
    fontWeight: "700",
  },
  headerSub: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    marginTop: 2,
  },
  goalCard: {
    backgroundColor: colors.bgCard,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  goalLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4,
  },
  goalText: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
  },
  stateRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 9,
  },
  statePill: {
    backgroundColor: colors.infoLight,
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 5,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.errorLight,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: colors.error,
    fontSize: 13,
    lineHeight: 18,
  },
  variantCard: {
    backgroundColor: colors.mintLight,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 10,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.success,
    gap: 4,
  },
  variantLabel: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
  },
  variantText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "600",
  },
  variantHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  turnList: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  turn: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: colors.bgCard,
    borderRadius: 10,
    padding: 11,
    marginVertical: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  studentTurn: {
    alignSelf: "flex-end",
    backgroundColor: colors.infoLight,
    borderColor: colors.primaryLight,
  },
  systemTurn: {
    maxWidth: "100%",
    alignSelf: "stretch",
    backgroundColor: colors.warningLight,
    borderColor: colors.apricot,
  },
  turnHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 5,
    flexWrap: "wrap",
  },
  turnRole: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  turnBadge: {
    backgroundColor: colors.primaryLight,
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  verdictBadge: {
    backgroundColor: colors.mintLight,
    color: colors.success,
  },
  turnText: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
  },
  diagnosisText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  inputPanel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgElevated,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: 10,
    paddingTop: 9,
  },
  shortcutRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 8,
  },
  shortcutButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bgInput,
    borderRadius: 7,
    paddingVertical: 8,
  },
  shortcutText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 96,
    backgroundColor: colors.bgInput,
    borderRadius: 9,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    paddingHorizontal: 11,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  submitButton: {
    width: 44,
    height: 44,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  submitDisabled: {
    backgroundColor: colors.primaryLight,
  },
});
