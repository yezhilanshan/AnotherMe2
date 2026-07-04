import { getSafeStorage } from "./safeStorage";
import { deriveStepGoal } from "../../AnotherMe/packages/teaching-core/src/index";

const FOLLOWUP_PREFIX = "@anotherme/problem-step-followup/";

export type ProblemStepFollowupIntent =
  | "socratic"
  | "explain"
  | "reframe"
  | "practice";

export interface ProblemStepFollowupContext {
  id: string;
  createdAt: number;
  intent: ProblemStepFollowupIntent;
  jobId: string | null;
  imageUri: string | null;
  description: string;
  solveMode: string;
  problemSnapshot?: {
    source: "problem_video_job" | "manual";
    summary: string;
    allSteps: Array<{
      id: number;
      title: string;
      narration: string;
      description?: string;
      knowledgePointIds?: string[];
      abilityTags?: string[];
    }>;
  };
  step: {
    id: number;
    title: string;
    narration: string;
    description?: string;
    knowledgePointIds?: string[];
    abilityTags?: string[];
  };
  stepGoal?: string;
  targetKnowledgePointIds?: string[];
}

export function createProblemStepFollowupContext(input: {
  intent?: ProblemStepFollowupIntent;
  jobId: string | null;
  imageUri: string | null;
  description: string;
  solveMode: string;
  problemSnapshot?: ProblemStepFollowupContext["problemSnapshot"];
  step: ProblemStepFollowupContext["step"];
}): ProblemStepFollowupContext {
  const targetKnowledgePointIds =
    input.step.knowledgePointIds?.filter(
      (item, index, array) =>
        typeof item === "string" && item.trim() && array.indexOf(item) === index,
    ) || [];
  return {
    id: `step-followup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    intent: input.intent || "explain",
    stepGoal: deriveStepGoal({
      title: input.step.title,
      description: input.step.description,
      narration: input.step.narration,
      knowledgePointIds: targetKnowledgePointIds,
    }),
    targetKnowledgePointIds,
    ...input,
  };
}

export async function saveProblemStepFollowupContext(
  context: ProblemStepFollowupContext,
): Promise<void> {
  await getSafeStorage().setItem(
    `${FOLLOWUP_PREFIX}${context.id}`,
    JSON.stringify(context),
  );
}

export async function loadProblemStepFollowupContext(
  id: string,
): Promise<ProblemStepFollowupContext | null> {
  const raw = await getSafeStorage().getItem(`${FOLLOWUP_PREFIX}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProblemStepFollowupContext;
  } catch {
    return null;
  }
}

export async function removeProblemStepFollowupContext(id: string): Promise<void> {
  await getSafeStorage().removeItem(`${FOLLOWUP_PREFIX}${id}`);
}

export function buildProblemStepFollowupTitle(
  context: ProblemStepFollowupContext,
): string {
  const title = context.step.title.trim() || `第 ${context.step.id} 步`;
  if (context.intent === "socratic") return `引导：${title}`.slice(0, 24);
  if (context.intent === "reframe") return `换讲法：${title}`.slice(0, 24);
  if (context.intent === "practice") return `类似题：${title}`.slice(0, 24);
  return `追问：${title}`.slice(0, 24);
}

export function getProblemStepFollowupCapability(
  context: ProblemStepFollowupContext,
): string {
  // Step follow-up is a tutoring turn, not a fresh full-solve job. Use the
  // fast chat path and keep the prompt narrowly scoped for low latency.
  return "chat";
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildStepChainContext(context: ProblemStepFollowupContext): string[] {
  const snapshot = context.problemSnapshot;
  if (!snapshot?.allSteps?.length) return [];

  const currentIndex = snapshot.allSteps.findIndex(
    (item) => item.id === context.step.id,
  );
  const start = Math.max(0, currentIndex - 1);
  const end =
    currentIndex >= 0
      ? Math.min(snapshot.allSteps.length, currentIndex + 2)
      : snapshot.allSteps.length;
  const localSteps = snapshot.allSteps.slice(start, end);

  const lines = localSteps.map((item) => {
    const marker = item.id === context.step.id ? "（当前追问）" : "";
    const title = item.title.trim() || `第 ${item.id} 步`;
    const narration = compactText(item.narration || "", 180);
    const knowledgePoints =
      item.knowledgePointIds?.length ? `；知识点：${item.knowledgePointIds.join("、")}` : "";
    return `- 步骤 ${item.id}${marker}：${title}${narration ? `。${narration}` : ""}${knowledgePoints}`;
  });

  return [
    "整题解题链快照（由拍题任务生成，优先用于理解原图信息）：",
    ...lines,
  ];
}

export function buildProblemStepFollowupPrompt(
  context: ProblemStepFollowupContext,
): string {
  const problemText = context.description.trim()
    ? context.description.trim()
    : "题目文字未手动补充，请优先依据拍题任务已生成的解题链快照判断。";
  const stepTitle = context.step.title.trim() || `第 ${context.step.id} 步`;
  const stepNarration = context.step.narration.trim() || "该步骤暂无文字讲解。";
  const snapshotSummary = context.problemSnapshot?.summary?.trim();
  const stepChainContext = buildStepChainContext(context);
  const knowledgePointText = context.targetKnowledgePointIds?.length
    ? context.targetKnowledgePointIds.join("、")
    : "未映射真实知识点";

  const sharedContext = [
    `题目补充信息：${problemText}`,
    ...(snapshotSummary ? [`拍题任务题面摘要：${snapshotSummary}`] : []),
    `当前步骤：${stepTitle}`,
    `当前步骤目标：${context.stepGoal || deriveStepGoal({
      title: context.step.title,
      description: context.step.description,
      narration: context.step.narration,
      knowledgePointIds: context.targetKnowledgePointIds,
    })}`,
    `当前步骤知识点：${knowledgePointText}`,
    `当前步骤讲解：${stepNarration}`,
    ...stepChainContext,
  ];

  if (context.intent === "socratic") {
    return [
      `我正在看一道题的「${stepTitle}」，这一步卡住了。`,
      "请采用苏格拉底式引导，只围绕当前步骤帮助我自己想出来，不要重新完整解整道题。",
      "首轮只提出一个引导问题，不要直接解释完整理由，也不要给最终答案。",
      "回答控制在 120 字以内。",
      "",
      ...sharedContext,
      "",
      "请按这个策略开始：",
      "1. 先指出这一步要解决的最小目标；",
      "2. 再提出一个我能尝试回答的问题；",
      "3. 如果必须给提示，只给最轻的一层观察线索。",
    ].join("\n");
  }

  if (context.intent === "reframe") {
    return [
      `我正在看一道题的「${stepTitle}」，这一步的原讲法没有听懂。`,
      "请你作为 AI 导师，只围绕这一步，换一种更直观的讲法解释，不要重新完整解整道题。",
      "回答要简短，控制在 180 字以内。",
      "",
      ...sharedContext,
      "",
      "请换一种讲法：",
      "1. 先用生活化类比或图像化语言解释；",
      "2. 再用严谨数学语言补上关键依据；",
      "3. 最后用一句话总结这一步的核心想法。",
    ].join("\n");
  }

  if (context.intent === "practice") {
    return [
      `我正在学习一道题的「${stepTitle}」，想通过一道类似题确认自己是否真的懂了。`,
      "请你作为 AI 导师，基于这一步涉及的知识点生成一道小型类似题，不要直接给最终答案。",
      "回答要简短，控制在 220 字以内。",
      "",
      ...sharedContext,
      "",
      "请按这个格式输出：",
      "1. 类似题题目；",
      "2. 第一个提示；",
      "3. 学生作答后你再继续讲解的引导说明。",
      "题目难度应比原题略低，重点考察当前步骤。",
    ].join("\n");
  }

  return [
    `我正在看一道题的「${stepTitle}」，但这里没有理解。`,
    "请你作为 AI 导师，只围绕这一步解释，不要重新完整解整道题。",
    "回答要简短，控制在 180 字以内。",
    "",
    ...sharedContext,
    "",
    "请用更直观的方式解释：",
    "1. 这一步为什么可以这样做；",
    "2. 前一步到这一步中间省略了什么；",
    "3. 如果我还是不懂，应该先补哪个知识点。",
  ].join("\n");
}
