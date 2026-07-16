import type { ProblemStepFollowupContext } from "./problem-step-followup";
import {
  advanceSocraticStateFromAttemptEvaluation,
  advanceSocraticStateFromVariantEvaluation as applyVariantEvaluationToState,
  type SocraticFollowupState,
} from "./socratic-followup";
import {
  deriveStepGoal,
  type SocraticAttemptEvaluation,
  type SocraticMisconceptionType,
  type SocraticTeachingAction,
  type SocraticAttemptVerdict,
  type SocraticVariantEvaluation,
  type SocraticPhase,
} from "@anotherme/teaching-core";
import { streamChatWithRetry } from "./streaming";
import { DEFAULT_MODEL, USER_ID } from "./config";
export type {
  SocraticTeachingAction,
  SocraticAttemptVerdict,
  SocraticMisconceptionType,
  SocraticAttemptEvaluation,
  SocraticVariantEvaluation,
  SocraticPhase,
};

export interface SocraticWorkbenchTurn {
  id: string;
  role: "tutor" | "student" | "system";
  text: string;
  timestamp: number;
  action?: SocraticTeachingAction;
  verdict?: SocraticAttemptVerdict;
  diagnosis?: string;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function makeTurnId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function coerceVariantVerdict(
  value: unknown,
): SocraticVariantEvaluation["verdict"] {
  const raw = String(value || "");
  if (raw === "correct" || raw === "partial" || raw === "incorrect") return raw;
  return "partial";
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] || text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function coerceAction(value: unknown): SocraticTeachingAction {
  const raw = String(value || "");
  const allowed: SocraticTeachingAction[] = [
    "ask_observation",
    "ask_restate",
    "ask_next_step",
    "give_light_hint",
    "give_directional_hint",
    "give_structured_hint",
    "reveal_contradiction",
    "explain_minimally",
    "ask_variant_check",
    "confirm_mastery",
  ];
  return allowed.includes(raw as SocraticTeachingAction)
    ? (raw as SocraticTeachingAction)
    : "give_light_hint";
}

function coerceVerdict(value: unknown): SocraticAttemptVerdict {
  const raw = String(value || "");
  const allowed: SocraticAttemptVerdict[] = [
    "no_attempt",
    "incorrect",
    "partial",
    "correct",
    "misconception",
  ];
  return allowed.includes(raw as SocraticAttemptVerdict)
    ? (raw as SocraticAttemptVerdict)
    : "partial";
}

function coerceMisconception(
  value: unknown,
): SocraticMisconceptionType | undefined {
  const raw = String(value || "");
  const allowed: SocraticMisconceptionType[] = [
    "concept_gap",
    "condition_misread",
    "formula_misuse",
    "calculation_error",
    "logic_jump",
    "representation_gap",
  ];
  return allowed.includes(raw as SocraticMisconceptionType)
    ? (raw as SocraticMisconceptionType)
    : undefined;
}

export function inferStepGoal(context: ProblemStepFollowupContext): string {
  return (
    context.stepGoal ||
    deriveStepGoal({
      title: context.step.title,
      description: context.step.description,
      narration: context.step.narration,
      knowledgePointIds:
        context.targetKnowledgePointIds || context.step.knowledgePointIds,
    })
  );
}

function buildContextLines(context: ProblemStepFollowupContext): string[] {
  const problemText = context.description.trim()
    ? context.description.trim()
    : "题目文字未手动补充，请根据拍题任务步骤链判断。";
  const lines = [
    `题目补充信息：${problemText}`,
    `当前步骤：${context.step.title || `第 ${context.step.id} 步`}`,
    `当前步骤原讲解：${context.step.narration || "无"}`,
  ];
  const allSteps = context.problemSnapshot?.allSteps || [];
  if (allSteps.length) {
    lines.push("相邻步骤：");
    const currentIndex = allSteps.findIndex(
      (item) => item.id === context.step.id,
    );
    const start = Math.max(0, currentIndex - 1);
    const end =
      currentIndex >= 0
        ? Math.min(allSteps.length, currentIndex + 2)
        : allSteps.length;
    for (const step of allSteps.slice(start, end)) {
      lines.push(
        `- ${step.id === context.step.id ? "当前" : "参考"}：${step.title}。${compactText(step.narration || "", 160)}`,
      );
    }
  }
  return lines;
}

async function callTutorText(input: {
  message: string;
  systemPrompt?: string;
  conversationId: string;
  signal?: AbortSignal;
}): Promise<string> {
  let text = "";
  let failed: Error | null = null;
  await streamChatWithRetry(
    {
      message: input.message,
      systemPrompt: input.systemPrompt,
      conversationId: input.conversationId,
      model: DEFAULT_MODEL,
      capability: "chat",
      userId: USER_ID,
      signal: input.signal,
      onEvent: (event) => {
        if (event.type === "text_delta") {
          text += event.data?.content || "";
        }
      },
      onComplete: () => {},
      onError: (error) => {
        failed = error;
      },
    },
    1,
  );
  if (failed) throw failed;
  return text.trim();
}

export async function createInitialSocraticTurn(input: {
  context: ProblemStepFollowupContext;
  state: SocraticFollowupState;
  signal?: AbortSignal;
}): Promise<SocraticWorkbenchTurn> {
  const goal = inferStepGoal(input.context);
  const text = await callTutorText({
    conversationId: `socratic-initial-${input.context.id}`,
    signal: input.signal,
    systemPrompt: [
      "你是移动端苏格拉底式 AI 导师。首轮只能做两件事：说明当前最小目标，并提出一个学生可以回答的问题。",
      "禁止直接解释完整推导，禁止同时提出多个问题，禁止重新解整题。",
      "回答控制在 100 字以内。",
    ].join("\n"),
    message: [
      `当前目标：${goal}`,
      ...buildContextLines(input.context),
      "",
      "请输出给学生看的首轮引导。",
    ].join("\n"),
  });

  return {
    id: makeTurnId("tutor"),
    role: "tutor",
    text:
      text ||
      `这一步的目标是${goal}。你先观察一下：原题里哪个条件最可能支撑这一步？`,
    timestamp: Date.now(),
    action: "ask_observation",
  };
}

function fallbackEvaluation(input: {
  attempt: string;
  state: SocraticFollowupState;
}): SocraticAttemptEvaluation {
  const attempt = input.attempt.trim();
  if (!attempt) {
    return {
      verdict: "no_attempt",
      confidence: 0.8,
      conciseDiagnosis: "学生还没有提交可判断的想法。",
      nextAction: "ask_observation",
      shouldIncreaseHintLevel: false,
      shouldAskVariant: false,
      extractedKnowledgePointIds: [],
      tutorReply:
        "先不用急着看答案。你能先说说，这一步最像是在用哪个已知条件吗？",
    };
  }

  if (/(不懂|不会|不知道|没思路|卡住)/.test(attempt)) {
    return {
      verdict: "no_attempt",
      confidence: 0.75,
      conciseDiagnosis: "学生表达了卡住，但还没有形成尝试。",
      nextAction:
        input.state.hintLevel >= 1 ? "give_structured_hint" : "give_light_hint",
      shouldIncreaseHintLevel: true,
      shouldAskVariant: false,
      extractedKnowledgePointIds: [],
      tutorReply:
        input.state.hintLevel >= 1
          ? "我们把它拆小一点：先只找这一步用到的一个已知条件，不管后面怎么推。你觉得是哪一个？"
          : "给你一个轻提示：先别算结果，只看这一步前后的对象发生了什么变化。",
    };
  }

  return {
    verdict: "partial",
    confidence: 0.55,
    conciseDiagnosis: "学生给出了尝试，但还需要进一步确认依据。",
    nextAction: "give_light_hint",
    shouldIncreaseHintLevel: false,
    shouldAskVariant: false,
    extractedKnowledgePointIds: [],
    tutorReply:
      "你已经有方向了。再补一句：这个判断依赖的是哪个定义、定理或已知条件？",
  };
}

export async function evaluateSocraticAttempt(input: {
  context: ProblemStepFollowupContext;
  state: SocraticFollowupState;
  attempt: string;
  lastTutorQuestion: string;
  signal?: AbortSignal;
}): Promise<SocraticAttemptEvaluation> {
  const raw = await callTutorText({
    conversationId: `socratic-eval-${input.context.id}-${Date.now()}`,
    signal: input.signal,
    systemPrompt: [
      "你是苏格拉底式教学诊断器。你要诊断学生的一次尝试，并决定下一教学动作。",
      "只能输出 JSON 对象，不要输出 markdown，不要解释 JSON。",
      "tutorReply 是给学生看的下一句话，每次最多一个核心问题，160 字以内。",
      "如果学生没有真正尝试，verdict 必须是 no_attempt，不得直接讲答案。",
      "只有学生能说明关键依据时，verdict 才能是 correct。",
    ].join("\n"),
    message: [
      ...buildContextLines(input.context),
      `当前目标：${inferStepGoal(input.context)}`,
      `当前阶段：${input.state.phase}`,
      `提示层级：${input.state.hintLevel}`,
      `上一轮导师问题：${input.lastTutorQuestion}`,
      `学生回答：${input.attempt}`,
      "",
      "输出 JSON schema：",
      "{",
      '  "verdict": "no_attempt|incorrect|partial|correct|misconception",',
      '  "confidence": 0.0,',
      '  "misconceptionType": "concept_gap|condition_misread|formula_misuse|calculation_error|logic_jump|representation_gap",',
      '  "conciseDiagnosis": "一句内部诊断",',
      '  "nextAction": "ask_observation|ask_restate|ask_next_step|give_light_hint|give_directional_hint|give_structured_hint|reveal_contradiction|explain_minimally|ask_variant_check|confirm_mastery",',
      '  "shouldIncreaseHintLevel": false,',
      '  "shouldAskVariant": false,',
      '  "extractedKnowledgePointIds": [],',
      '  "tutorReply": "给学生看的下一句话",',
      '  "variantQuestion": ""',
      "}",
    ].join("\n"),
  });

  const parsed = extractJsonObject(raw);
  if (!parsed)
    return fallbackEvaluation({ attempt: input.attempt, state: input.state });

  const verdict = coerceVerdict(parsed.verdict);
  const nextAction = coerceAction(parsed.nextAction);
  const tutorReply = String(parsed.tutorReply || "").trim();
  if (!tutorReply)
    return fallbackEvaluation({ attempt: input.attempt, state: input.state });

  return {
    verdict,
    confidence: normalizeConfidence(parsed.confidence),
    misconceptionType: coerceMisconception(parsed.misconceptionType),
    conciseDiagnosis: String(
      parsed.conciseDiagnosis || "已完成一次作答诊断。",
    ).slice(0, 120),
    nextAction,
    shouldIncreaseHintLevel: Boolean(parsed.shouldIncreaseHintLevel),
    shouldAskVariant: Boolean(parsed.shouldAskVariant),
    extractedKnowledgePointIds: asStringArray(
      parsed.extractedKnowledgePointIds,
    ),
    tutorReply: compactText(tutorReply, 220),
    variantQuestion: String(parsed.variantQuestion || "").trim() || undefined,
  };
}

function fallbackVariantEvaluation(answer: string): SocraticVariantEvaluation {
  const normalized = answer.trim();
  if (!normalized) {
    return {
      verdict: "incorrect",
      confidence: 0.8,
      conciseDiagnosis: "学生没有提交可用于验收的变式回答。",
      tutorReply:
        "先别跳到下一步。你先用一句话说说，这个变式里你会先抓哪条关系？",
      extractedKnowledgePointIds: [],
    };
  }

  if (/(不懂|不会|不知道|卡住|没思路)/.test(normalized)) {
    return {
      verdict: "incorrect",
      confidence: 0.75,
      conciseDiagnosis: "学生在变式题上没有形成迁移性回答。",
      tutorReply:
        "说明这一步还没真正稳住。先回到原题：你能重说一次这一步依赖的关键依据吗？",
      extractedKnowledgePointIds: [],
    };
  }

  return {
    verdict: "partial",
    confidence: 0.55,
    conciseDiagnosis: "学生做了变式作答，但迁移依据还不够清楚。",
    tutorReply:
      "方向还差一点。别只给结论，再补一句：你为什么先抓这个条件或关系？",
    extractedKnowledgePointIds: [],
  };
}

export async function evaluateVariantAnswer(input: {
  context: ProblemStepFollowupContext;
  state: SocraticFollowupState;
  answer: string;
  signal?: AbortSignal;
}): Promise<SocraticVariantEvaluation> {
  const variantQuestion =
    input.state.variantQuestion || "请回答一个与当前步骤同构的更小变式问题。";
  const raw = await callTutorText({
    conversationId: `socratic-variant-${input.context.id}-${Date.now()}`,
    signal: input.signal,
    systemPrompt: [
      "你是苏格拉底式教学的变式验收器。",
      "目标不是鼓励，而是判断学生是否能把刚才那一步迁移到一个小变式中。",
      "只能输出 JSON 对象，不要输出 markdown，不要解释 JSON。",
      "只有当学生明确说出正确依据或关键关系时，verdict 才能是 correct。",
      "如果学生只给结论、表达含糊、或需要提示，verdict 只能是 partial 或 incorrect。",
      "tutorReply 是给学生看的下一句话，140 字以内。",
    ].join("\n"),
    message: [
      ...buildContextLines(input.context),
      `当前目标：${inferStepGoal(input.context)}`,
      `原题当前步骤：${input.state.stepTitle}`,
      `变式问题：${variantQuestion}`,
      `学生对变式的回答：${input.answer}`,
      "",
      "输出 JSON schema：",
      "{",
      '  "verdict": "correct|partial|incorrect",',
      '  "confidence": 0.0,',
      '  "conciseDiagnosis": "一句内部诊断",',
      '  "tutorReply": "给学生看的下一句话",',
      '  "extractedKnowledgePointIds": []',
      "}",
    ].join("\n"),
  });

  const parsed = extractJsonObject(raw);
  if (!parsed) return fallbackVariantEvaluation(input.answer);

  const tutorReply = String(parsed.tutorReply || "").trim();
  if (!tutorReply) return fallbackVariantEvaluation(input.answer);

  return {
    verdict: coerceVariantVerdict(parsed.verdict),
    confidence: normalizeConfidence(parsed.confidence),
    conciseDiagnosis: String(
      parsed.conciseDiagnosis || "已完成一次变式验收。",
    ).slice(0, 120),
    tutorReply: compactText(tutorReply, 180),
    extractedKnowledgePointIds: asStringArray(
      parsed.extractedKnowledgePointIds,
    ),
  };
}

export function advanceSocraticStateFromEvaluation(input: {
  state: SocraticFollowupState;
  attempt: string;
  evaluation: SocraticAttemptEvaluation;
}): SocraticFollowupState {
  return advanceSocraticStateFromAttemptEvaluation(
    input.state,
    input.attempt,
    input.evaluation,
  );
}

export function advanceSocraticStateFromVariantEvaluation(input: {
  state: SocraticFollowupState;
  answer: string;
  evaluation: SocraticVariantEvaluation;
}): SocraticFollowupState {
  return applyVariantEvaluationToState(
    input.state,
    input.answer,
    input.evaluation,
  );
}

export function makeWorkbenchTurn(input: {
  role: SocraticWorkbenchTurn["role"];
  text: string;
  action?: SocraticTeachingAction;
  verdict?: SocraticAttemptVerdict;
  diagnosis?: string;
}): SocraticWorkbenchTurn {
  return {
    id: makeTurnId(input.role),
    role: input.role,
    text: input.text,
    timestamp: Date.now(),
    action: input.action,
    verdict: input.verdict,
    diagnosis: input.diagnosis,
  };
}
