import type { KnowledgeState } from "./types";

export interface ReviewPlanItem {
  knowledgePointId: string;
  name: string;
  subject?: string;
  mastery: number;
  attempts: number;
  lastPracticedAt?: string;
  nextReviewAt: string;
  dueToday: boolean;
  overdueDays: number;
  intervalDays: number;
  reason: string;
  material: string;
  checkQuestion: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function getReviewIntervalDays(mastery: number): number {
  if (mastery < 0.35) return 1;
  if (mastery < 0.65) return 3;
  if (mastery < 0.85) return 7;
  return 14;
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * MS_PER_DAY);
}

function parseLastPracticed(value?: string, fallback?: Date): Date {
  if (!value) return fallback || new Date(0);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : fallback || new Date(0);
}

function masteryLabel(mastery: number): string {
  if (mastery < 0.35) return "薄弱";
  if (mastery < 0.65) return "需要巩固";
  if (mastery < 0.85) return "接近掌握";
  return "已掌握但需要间隔复现";
}

export function buildReviewPrompt(item: ReviewPlanItem): string {
  return [
    `我今天需要复习「${item.name}」。`,
    `当前掌握度约 ${Math.round(item.mastery * 100)}%，复习原因：${item.reason}`,
    "",
    "请你作为 AI 导师，用 5 分钟复习节奏带我过一遍：",
    "1. 先用不超过 80 字解释核心概念；",
    "2. 给 1 道小检查题，不要直接给答案；",
    "3. 等我回答后再判断我是否掌握。",
  ].join("\n");
}

export function calculateReviewPlan(
  states: KnowledgeState[],
  now: Date = new Date(),
  limit = 3,
): ReviewPlanItem[] {
  const today = startOfDay(now);
  const endOfToday = addDays(today, 1);

  return states
    .filter((state) => state.knowledge_point_id && state.name)
    .map((state) => {
      const mastery = Math.max(0, Math.min(1, state.mastery || 0));
      const intervalDays = getReviewIntervalDays(mastery);
      const fallbackLastPracticed = mastery < 0.35 ? addDays(today, -1) : today;
      const lastPracticed = parseLastPracticed(
        state.last_practiced_at,
        fallbackLastPracticed,
      );
      const nextReview = addDays(startOfDay(lastPracticed), intervalDays);
      const dueToday = nextReview < endOfToday;
      const overdueDays = Math.max(
        0,
        Math.floor((today.getTime() - startOfDay(nextReview).getTime()) / MS_PER_DAY),
      );
      const label = masteryLabel(mastery);

      return {
        knowledgePointId: state.knowledge_point_id,
        name: state.name,
        subject: state.subject,
        mastery,
        attempts: state.attempts || 0,
        lastPracticedAt: state.last_practiced_at,
        nextReviewAt: nextReview.toISOString(),
        dueToday,
        overdueDays,
        intervalDays,
        reason: dueToday
          ? `${label}，距离上次练习已达到 ${intervalDays} 天复习间隔`
          : `${label}，下一次复习安排在 ${nextReview.toLocaleDateString("zh-CN")}`,
        material: `先复述「${state.name}」的核心定义或关键步骤，再看一道小题确认是否真的会用。`,
        checkQuestion: `不用查资料，写出「${state.name}」最容易错的一步，并举一个简单例子。`,
      };
    })
    .sort((a, b) => {
      if (a.dueToday !== b.dueToday) return a.dueToday ? -1 : 1;
      if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
      if (a.mastery !== b.mastery) return a.mastery - b.mastery;
      return a.nextReviewAt.localeCompare(b.nextReviewAt);
    })
    .slice(0, limit);
}
