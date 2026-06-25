export type SocraticPhase =
  | "warm_up"
  | "problem_restate"
  | "hint_level_0"
  | "hint_level_1"
  | "hint_level_2"
  | "contradiction_reveal"
  | "guide_to_fix"
  | "confirm_understanding";

export const SOCRATIC_PHASE_ORDER: SocraticPhase[] = [
  "warm_up",
  "problem_restate",
  "hint_level_0",
  "hint_level_1",
  "hint_level_2",
  "contradiction_reveal",
  "guide_to_fix",
  "confirm_understanding",
];

export type SocraticTeachingAction =
  | "ask_observation"
  | "ask_restate"
  | "ask_next_step"
  | "give_light_hint"
  | "give_directional_hint"
  | "give_structured_hint"
  | "reveal_contradiction"
  | "explain_minimally"
  | "ask_variant_check"
  | "confirm_mastery";

export type SocraticAttemptVerdict =
  | "no_attempt"
  | "incorrect"
  | "partial"
  | "correct"
  | "misconception";

export type SocraticMisconceptionType =
  | "concept_gap"
  | "condition_misread"
  | "formula_misuse"
  | "calculation_error"
  | "logic_jump"
  | "representation_gap";

export interface SocraticAttemptEvaluation {
  verdict: SocraticAttemptVerdict;
  confidence: number;
  misconceptionType?: SocraticMisconceptionType;
  conciseDiagnosis: string;
  nextAction: SocraticTeachingAction;
  shouldIncreaseHintLevel: boolean;
  shouldAskVariant: boolean;
  extractedKnowledgePointIds: string[];
  tutorReply: string;
  variantQuestion?: string;
}

export interface SocraticVariantEvaluation {
  verdict: "correct" | "partial" | "incorrect";
  confidence: number;
  conciseDiagnosis: string;
  tutorReply: string;
  extractedKnowledgePointIds: string[];
}

export interface SocraticTeachingActionRecord {
  action: SocraticTeachingAction;
  phase: SocraticPhase;
  hintLevel: number;
  timestamp: number;
  source: "attempt" | "variant" | "followup";
}

export interface SocraticChainState {
  currentTopic: string;
  targetConcept: string;
  phase: SocraticPhase;
  hintLevel: number;
  hintsGiven: number;
  turnsInPhase: number;
  revealedConcepts: string[];
  stillMisunderstands: string[];
  previousAnswers: string[];
  variantQuestion?: string;
  stepGoal?: string;
  targetKnowledgePointIds?: string[];
  startedAt: number;
}

export interface SocraticProgressState extends SocraticChainState {
  studentAttempts: number;
  variantAnswer?: string;
  variantVerdict?: "correct" | "partial" | "incorrect";
  variantCompletedAt?: number;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function unique(values: string[] | undefined): string[] {
  if (!values?.length) return [];
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

export function phaseForHintLevel(hintLevel: number): SocraticPhase {
  if (hintLevel <= 0) return "hint_level_0";
  if (hintLevel === 1) return "hint_level_1";
  if (hintLevel === 2) return "hint_level_2";
  return "guide_to_fix";
}

export function phaseForTeachingAction(
  action: SocraticTeachingAction,
  hintLevel: number,
): SocraticPhase {
  if (action === "reveal_contradiction") return "contradiction_reveal";
  if (action === "ask_variant_check" || action === "confirm_mastery") {
    return "confirm_understanding";
  }
  if (action === "ask_restate") return "problem_restate";
  return phaseForHintLevel(hintLevel);
}

export function deriveStepGoal(input: {
  title?: string;
  description?: string;
  narration?: string;
  knowledgePointIds?: string[];
}): string {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const narration = String(input.narration || "").trim();
  const kp = unique(input.knowledgePointIds);
  if (description) return compactText(description, 80);
  if (kp.length) return `弄清楚这一步为什么要用「${kp[0]}」`;
  if (title) return `弄清楚「${title}」这一步为什么成立`;
  if (narration) return `弄清楚这一步里省略的关键依据`;
  return "弄清楚当前步骤为什么成立";
}

export function resolveTargetKnowledgePointIds(input: {
  targetKnowledgePointIds?: string[];
  extractedKnowledgePointIds?: string[];
}): string[] {
  const target = unique(input.targetKnowledgePointIds);
  if (!target.length) return [];
  const extracted = new Set(unique(input.extractedKnowledgePointIds));
  if (!extracted.size) return target;
  return target.filter((item) => extracted.has(item));
}

export function buildDefaultVariantQuestion(
  stepGoal?: string,
  targetConcept?: string,
): string {
  if (stepGoal?.trim()) {
    return `换一个更小的变式：如果条件稍微变化，你还能围绕「${stepGoal.trim()}」先判断该看哪条关系吗？`;
  }
  if (targetConcept?.trim()) {
    return `换一个更小的变式：如果条件稍微变化，你还能判断为什么还要用「${targetConcept.trim()}」吗？`;
  }
  return "换一个类似小题：如果这一步的条件稍微变化，你还能判断先看哪个关系吗？";
}

export function advanceSocraticProgressStateFromAttempt<T extends SocraticProgressState>(
  state: T,
  input: {
    attempt: string;
    evaluation: SocraticAttemptEvaluation;
  },
): T {
  const shouldRaise =
    input.evaluation.shouldIncreaseHintLevel ||
    input.evaluation.verdict === "no_attempt" ||
    input.evaluation.verdict === "incorrect" ||
    input.evaluation.verdict === "misconception";
  const hintLevel = shouldRaise ? Math.min(3, state.hintLevel + 1) : state.hintLevel;
  const phase = phaseForTeachingAction(input.evaluation.nextAction, hintLevel);
  const revealedConcepts =
    input.evaluation.verdict === "correct"
      ? Array.from(new Set([...state.revealedConcepts, state.targetConcept])).slice(-5)
      : state.revealedConcepts;
  const stillMisunderstands =
    input.evaluation.verdict === "misconception" ||
    input.evaluation.verdict === "incorrect" ||
    input.evaluation.verdict === "no_attempt"
      ? [...state.stillMisunderstands, compactText(input.evaluation.conciseDiagnosis, 80)].slice(-5)
      : state.stillMisunderstands;
  const shouldResetVariant =
    input.evaluation.shouldAskVariant ||
    input.evaluation.nextAction === "ask_variant_check" ||
    input.evaluation.nextAction === "confirm_mastery";

  return {
    ...state,
    phase,
    hintLevel,
    hintsGiven: shouldRaise ? state.hintsGiven + 1 : state.hintsGiven,
    turnsInPhase: phase === state.phase ? state.turnsInPhase + 1 : 0,
    studentAttempts: state.studentAttempts + 1,
    revealedConcepts,
    stillMisunderstands,
    previousAnswers: [...state.previousAnswers, compactText(input.attempt, 120)]
      .filter(Boolean)
      .slice(-5),
    variantQuestion:
      input.evaluation.variantQuestion ||
      (input.evaluation.shouldAskVariant
        ? buildDefaultVariantQuestion(state.stepGoal, state.targetConcept)
        : state.variantQuestion),
    variantAnswer: shouldResetVariant ? undefined : state.variantAnswer,
    variantVerdict: shouldResetVariant ? undefined : state.variantVerdict,
    variantCompletedAt: shouldResetVariant ? undefined : state.variantCompletedAt,
  };
}

export function advanceSocraticProgressStateFromVariant<T extends SocraticProgressState>(
  state: T,
  input: {
    answer: string;
    evaluation: SocraticVariantEvaluation;
  },
): T {
  const isCorrect = input.evaluation.verdict === "correct";
  const shouldRaiseHint = input.evaluation.verdict === "incorrect";
  const hintLevel = shouldRaiseHint ? Math.min(3, state.hintLevel + 1) : state.hintLevel;
  const phase = isCorrect ? "confirm_understanding" : phaseForHintLevel(hintLevel);

  return {
    ...state,
    phase,
    hintLevel,
    hintsGiven: shouldRaiseHint ? state.hintsGiven + 1 : state.hintsGiven,
    turnsInPhase: phase === state.phase ? state.turnsInPhase + 1 : 0,
    studentAttempts: state.studentAttempts + 1,
    revealedConcepts: isCorrect
      ? Array.from(new Set([...state.revealedConcepts, state.targetConcept])).slice(-5)
      : state.revealedConcepts,
    stillMisunderstands: isCorrect
      ? state.stillMisunderstands
      : [...state.stillMisunderstands, compactText(input.evaluation.conciseDiagnosis, 80)].slice(-5),
    previousAnswers: [...state.previousAnswers, compactText(input.answer, 120)]
      .filter(Boolean)
      .slice(-5),
    variantAnswer: compactText(input.answer, 120),
    variantVerdict: input.evaluation.verdict,
    variantCompletedAt: Date.now(),
  };
}
