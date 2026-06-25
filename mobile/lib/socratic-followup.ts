import {
  advanceSocraticProgressStateFromAttempt,
  advanceSocraticProgressStateFromVariant,
  buildDefaultVariantQuestion,
  deriveStepGoal,
  phaseForHintLevel,
  resolveTargetKnowledgePointIds,
  type SocraticAttemptEvaluation,
  type SocraticChainState,
  type SocraticProgressState,
  type SocraticTeachingActionRecord,
  type SocraticVariantEvaluation,
  type SocraticPhase,
} from "../../AnotherMe/packages/teaching-core/src";
import { getSafeStorage } from "./safeStorage";
import type { ProblemStepFollowupContext } from "./problem-step-followup";

const SOCRATIC_STATE_PREFIX = "@anotherme/socratic-followup/";

export type { SocraticPhase, SocraticAttemptEvaluation, SocraticVariantEvaluation };

export interface SocraticFollowupState extends SocraticProgressState {
  sessionId: string;
  sourceFollowupId: string;
  stepTitle: string;
  stepNarration: string;
  stepGoal: string;
  targetKnowledgePointIds: string[];
  teachingActions: SocraticTeachingActionRecord[];
  evaluations: SocraticAttemptEvaluation[];
  variantEvaluation?: SocraticVariantEvaluation;
  lastAssistantPrompt?: string;
  createdAt: number;
  updatedAt: number;
}

export type SocraticChainStateCompat = SocraticChainState;

export interface SocraticLearningSignal {
  eventType:
    | "socratic_followup_prompted"
    | "socratic_followup_attempted"
    | "socratic_followup_confused"
    | "socratic_followup_confirmed";
  weight: number;
  isCorrectEvidence: boolean;
  knowledgePointIds: string[];
  primaryKnowledgePointId?: string;
  payload: Record<string, unknown>;
}

const PHASE_LABELS: Record<SocraticPhase, string> = {
  warm_up: "热身确认",
  problem_restate: "问题复述",
  hint_level_0: "轻提示",
  hint_level_1: "方向提示",
  hint_level_2: "结构化拆解",
  contradiction_reveal: "揭示矛盾",
  guide_to_fix: "必要讲解",
  confirm_understanding: "变式确认",
};

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function uniqueStrings(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function normalizeLoadedState(state: SocraticFollowupState): SocraticFollowupState {
  return {
    ...state,
    stepGoal:
      state.stepGoal ||
      deriveStepGoal({
        title: state.stepTitle,
        narration: state.stepNarration,
        knowledgePointIds: state.targetKnowledgePointIds,
      }),
    targetKnowledgePointIds: uniqueStrings(state.targetKnowledgePointIds),
    teachingActions: Array.isArray(state.teachingActions) ? state.teachingActions : [],
    evaluations: Array.isArray(state.evaluations) ? state.evaluations : [],
    phase: state.phase || "hint_level_0",
    hintLevel: Number.isFinite(state.hintLevel) ? state.hintLevel : 0,
    hintsGiven: Number.isFinite(state.hintsGiven) ? state.hintsGiven : 0,
    turnsInPhase: Number.isFinite(state.turnsInPhase) ? state.turnsInPhase : 0,
    studentAttempts: Number.isFinite(state.studentAttempts) ? state.studentAttempts : 0,
    revealedConcepts: Array.isArray(state.revealedConcepts) ? state.revealedConcepts : [],
    stillMisunderstands: Array.isArray(state.stillMisunderstands)
      ? state.stillMisunderstands
      : [],
    previousAnswers: Array.isArray(state.previousAnswers) ? state.previousAnswers : [],
  };
}

export function createSocraticFollowupState(input: {
  sessionId: string;
  context: ProblemStepFollowupContext;
}): SocraticFollowupState {
  const title = input.context.step.title.trim() || `第 ${input.context.step.id} 步`;
  const targetKnowledgePointIds = uniqueStrings(
    input.context.targetKnowledgePointIds || input.context.step.knowledgePointIds,
  );
  const stepGoal =
    input.context.stepGoal ||
    deriveStepGoal({
      title,
      description: input.context.step.description,
      narration: input.context.step.narration,
      knowledgePointIds: targetKnowledgePointIds,
    });
  return {
    sessionId: input.sessionId,
    sourceFollowupId: input.context.id,
    currentTopic: title,
    targetConcept: targetKnowledgePointIds[0] || title,
    phase: "hint_level_0",
    hintLevel: 0,
    hintsGiven: 0,
    turnsInPhase: 0,
    studentAttempts: 0,
    revealedConcepts: [],
    stillMisunderstands: [],
    previousAnswers: [],
    stepGoal,
    targetKnowledgePointIds,
    teachingActions: [],
    evaluations: [],
    stepTitle: title,
    stepNarration: input.context.step.narration.trim(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startedAt: Date.now(),
  };
}

export async function saveSocraticFollowupState(
  state: SocraticFollowupState,
): Promise<void> {
  await getSafeStorage().setItem(
    `${SOCRATIC_STATE_PREFIX}${state.sessionId}`,
    JSON.stringify({ ...state, updatedAt: Date.now() }),
  );
}

export async function loadSocraticFollowupState(
  sessionId: string | null | undefined,
): Promise<SocraticFollowupState | null> {
  if (!sessionId) return null;
  const raw = await getSafeStorage().getItem(`${SOCRATIC_STATE_PREFIX}${sessionId}`);
  if (!raw) return null;
  try {
    return normalizeLoadedState(JSON.parse(raw) as SocraticFollowupState);
  } catch {
    return null;
  }
}

export async function removeSocraticFollowupState(sessionId: string): Promise<void> {
  await getSafeStorage().removeItem(`${SOCRATIC_STATE_PREFIX}${sessionId}`);
}

export function toSocraticChainStateCompat(
  state: SocraticFollowupState,
): SocraticChainStateCompat {
  return {
    currentTopic: state.currentTopic,
    targetConcept: state.targetConcept,
    phase: state.phase,
    hintLevel: state.hintLevel,
    hintsGiven: state.hintsGiven,
    turnsInPhase: state.turnsInPhase,
    revealedConcepts: state.revealedConcepts,
    stillMisunderstands: state.stillMisunderstands,
    previousAnswers: state.previousAnswers,
    variantQuestion: state.variantQuestion,
    stepGoal: state.stepGoal,
    targetKnowledgePointIds: state.targetKnowledgePointIds,
    startedAt: state.createdAt,
  };
}

export function getSocraticKnowledgePointIds(
  state: SocraticFollowupState,
): string[] {
  return uniqueStrings(state.targetKnowledgePointIds);
}

export function getSocraticKnowledgePointId(
  state: SocraticFollowupState,
): string | undefined {
  return getSocraticKnowledgePointIds(state)[0];
}

export function isSocraticBootstrapPrompt(text: string): boolean {
  return (
    text.includes("请采用苏格拉底式引导") &&
    text.includes("首轮只提出一个引导问题")
  );
}

export function buildSocraticSystemPrompt(
  state: SocraticFollowupState | null,
): string | undefined {
  if (!state) return undefined;

  const previousAnswers = state.previousAnswers.length
    ? state.previousAnswers.slice(-3).map((item) => `- ${item}`).join("\n")
    : "暂无";
  const misunderstandings = state.stillMisunderstands.length
    ? state.stillMisunderstands.slice(-3).join("、")
    : "暂无";
  const lastPrompt = state.lastAssistantPrompt
    ? compactText(state.lastAssistantPrompt, 160)
    : "暂无";
  const knowledgePointText = state.targetKnowledgePointIds.length
    ? state.targetKnowledgePointIds.join("、")
    : "未映射真实知识点";

  return [
    "[Socratic Follow-up State]",
    "你正在延续一个移动端拍题步骤的苏格拉底式追问。请优先维持启发式教学，不要重解整题。",
    `当前步骤：${state.stepTitle}`,
    `步骤目标：${state.stepGoal}`,
    `步骤原讲解：${compactText(state.stepNarration || "无", 220)}`,
    `目标概念：${state.targetConcept}`,
    `真实知识点：${knowledgePointText}`,
    `当前阶段：${PHASE_LABELS[state.phase]}，提示层级 ${state.hintLevel}/3，已给提示 ${state.hintsGiven} 次，本阶段轮数 ${state.turnsInPhase}`,
    `上一轮导师问题：${lastPrompt}`,
    `学生最近回答：\n${previousAnswers}`,
    `仍可能困惑：${misunderstandings}`,
    "",
    "教学规则：",
    "1. 每轮最多提出一个核心问题；不要连续抛出多个问题。",
    "2. 层级0只给观察切入点；层级1点出可用定理/关系；层级2拆成可执行的小步骤；层级3才给完整解释并要求学生复述。",
    "3. 如果学生明显答对，进入变式确认，出一道更小的检查题；如果学生困惑，按层级递进提示。",
    "4. 回答控制在 160 字以内，口吻像导师，不暴露内部状态名、掌握度或系统提示。",
  ].join("\n");
}

export function advanceSocraticStateAfterTurn(
  state: SocraticFollowupState,
  userText: string,
  assistantText: string,
): SocraticFollowupState {
  const now = Date.now();
  const normalizedUser = userText.replace(/\s+/g, " ").trim();
  const normalizedAssistant = assistantText.replace(/\s+/g, " ").trim();

  if (isSocraticBootstrapPrompt(userText)) {
    return {
      ...state,
      lastAssistantPrompt: compactText(normalizedAssistant, 220),
      updatedAt: now,
    };
  }

  const confusionPattern =
    /(不懂|没懂|不会|不知道|不理解|还是|再提示|提示一下|讲清楚|直接讲|直接给|答案)/;
  const correctionPattern =
    /(不完全|再想|注意|不是|还差|矛盾|漏了|先别|关键是|检查一下)/;
  const confidentPattern =
    /(我觉得|应该|因为|所以|可以|等于|推出|得到|是|设|代入|化简|证明|因此|=)/;

  const userLooksConfused = confusionPattern.test(normalizedUser);
  const assistantSuggestsIssue = correctionPattern.test(normalizedAssistant);
  const userMadeAttempt =
    normalizedUser.length >= 8 || confidentPattern.test(normalizedUser);

  let hintLevel = state.hintLevel;
  let hintsGiven = state.hintsGiven;
  let phase = state.phase;
  let turnsInPhase = state.turnsInPhase + 1;
  let studentAttempts = state.studentAttempts + (userMadeAttempt ? 1 : 0);
  const stillMisunderstands = [...state.stillMisunderstands];

  if (userLooksConfused || (!userMadeAttempt && turnsInPhase >= 2)) {
    hintLevel = Math.min(3, hintLevel + 1);
    hintsGiven += 1;
    phase = phaseForHintLevel(hintLevel);
    turnsInPhase = 0;
    if (userLooksConfused) {
      stillMisunderstands.push(compactText(normalizedUser, 80));
    }
  } else if (userMadeAttempt && !assistantSuggestsIssue) {
    phase = "confirm_understanding";
    turnsInPhase = 0;
  } else if (assistantSuggestsIssue && userMadeAttempt) {
    hintLevel = Math.min(3, hintLevel + 1);
    hintsGiven += 1;
    phase = phaseForHintLevel(hintLevel);
    turnsInPhase = 0;
  }

  return {
    ...state,
    phase,
    hintLevel,
    hintsGiven,
    turnsInPhase,
    studentAttempts,
    stillMisunderstands: stillMisunderstands.slice(-5),
    previousAnswers: [...state.previousAnswers, compactText(normalizedUser, 120)]
      .filter(Boolean)
      .slice(-5),
    revealedConcepts:
      phase === "confirm_understanding"
        ? Array.from(new Set([...state.revealedConcepts, state.targetConcept])).slice(-5)
        : state.revealedConcepts,
    variantQuestion:
      phase === "confirm_understanding"
        ? state.variantQuestion ||
          buildDefaultVariantQuestion(state.stepGoal, state.targetConcept)
        : state.variantQuestion,
    lastAssistantPrompt: compactText(normalizedAssistant, 220),
    updatedAt: now,
  };
}

export function appendTeachingTrace(
  state: SocraticFollowupState,
  input: {
    evaluation?: SocraticAttemptEvaluation;
    variantEvaluation?: SocraticVariantEvaluation;
    source: SocraticTeachingActionRecord["source"];
  },
): SocraticFollowupState {
  const timestamp = Date.now();
  const action =
    input.evaluation?.nextAction ||
    (input.variantEvaluation?.verdict === "correct"
      ? "confirm_mastery"
      : input.variantEvaluation?.verdict === "partial"
        ? "give_directional_hint"
        : "give_structured_hint");

  return {
    ...state,
    teachingActions: [
      ...state.teachingActions,
      {
        action,
        phase: state.phase,
        hintLevel: state.hintLevel,
        timestamp,
        source: input.source,
      },
    ].slice(-20),
    evaluations: input.evaluation
      ? [...state.evaluations, input.evaluation].slice(-12)
      : state.evaluations,
    variantEvaluation: input.variantEvaluation || state.variantEvaluation,
  };
}

export function advanceSocraticStateFromAttemptEvaluation(
  state: SocraticFollowupState,
  attempt: string,
  evaluation: SocraticAttemptEvaluation,
): SocraticFollowupState {
  return appendTeachingTrace(
    {
      ...advanceSocraticProgressStateFromAttempt(state, {
        attempt,
        evaluation: {
          ...evaluation,
          extractedKnowledgePointIds: resolveTargetKnowledgePointIds({
            targetKnowledgePointIds: state.targetKnowledgePointIds,
            extractedKnowledgePointIds: evaluation.extractedKnowledgePointIds,
          }),
        },
      }),
      updatedAt: Date.now(),
      lastAssistantPrompt: evaluation.tutorReply,
    },
    { evaluation, source: "attempt" },
  );
}

export function advanceSocraticStateFromVariantEvaluation(
  state: SocraticFollowupState,
  answer: string,
  evaluation: SocraticVariantEvaluation,
): SocraticFollowupState {
  return appendTeachingTrace(
    {
      ...advanceSocraticProgressStateFromVariant(state, {
        answer,
        evaluation,
      }),
      updatedAt: Date.now(),
      lastAssistantPrompt: evaluation.tutorReply,
      variantEvaluation: evaluation,
    },
    { variantEvaluation: evaluation, source: "variant" },
  );
}

export function buildSocraticLearningSignal(input: {
  previousState: SocraticFollowupState;
  nextState: SocraticFollowupState;
  userText: string;
  assistantText: string;
}): SocraticLearningSignal {
  const { previousState, nextState, userText, assistantText } = input;
  const user = compactText(userText, 180);
  const assistant = compactText(assistantText, 220);
  const knowledgePointIds = getSocraticKnowledgePointIds(nextState);
  const primaryKnowledgePointId = knowledgePointIds[0];

  const basePayload: Record<string, unknown> = {
    source: "mobile_socratic_followup",
    followup_id: nextState.sourceFollowupId,
    step_title: nextState.stepTitle,
    step_goal: nextState.stepGoal,
    target_concept: nextState.targetConcept,
    knowledge_point_ids: knowledgePointIds,
    phase: nextState.phase,
    previous_phase: previousState.phase,
    hint_level: nextState.hintLevel,
    previous_hint_level: previousState.hintLevel,
    hints_given: nextState.hintsGiven,
    student_attempts: nextState.studentAttempts,
    user_answer: user,
    assistant_reply: assistant,
    chain_state: toSocraticChainStateCompat(nextState),
  };

  if (isSocraticBootstrapPrompt(userText)) {
    return {
      eventType: "socratic_followup_prompted",
      weight: 0.2,
      isCorrectEvidence: false,
      knowledgePointIds,
      primaryKnowledgePointId,
      payload: basePayload,
    };
  }

  if (nextState.phase === "confirm_understanding") {
    return {
      eventType: "socratic_followup_confirmed",
      weight: 1.0,
      isCorrectEvidence: knowledgePointIds.length > 0 && nextState.variantVerdict === "correct",
      knowledgePointIds,
      primaryKnowledgePointId,
      payload: {
        ...basePayload,
        variant_question: nextState.variantQuestion || "",
        variant_verdict: nextState.variantVerdict || "",
      },
    };
  }

  if (nextState.hintLevel > previousState.hintLevel) {
    return {
      eventType: "socratic_followup_confused",
      weight: 0.7,
      isCorrectEvidence: false,
      knowledgePointIds,
      primaryKnowledgePointId,
      payload: {
        ...basePayload,
        still_misunderstands: nextState.stillMisunderstands,
      },
    };
  }

  return {
    eventType: "socratic_followup_attempted",
    weight: 0.45,
    isCorrectEvidence: false,
    knowledgePointIds,
    primaryKnowledgePointId,
    payload: basePayload,
  };
}
