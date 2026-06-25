import { getSafeStorage } from './safeStorage';
import type { KnowledgeState } from './types';

export type StudyNoteViewMode = 'full' | 'weak' | 'exam';
export type StudyNoteMasteryBand = 'weak' | 'familiar' | 'mastered' | 'unlinked';

export interface StudyNoteCard {
  id: string;
  title: string;
  summary: string;
  keyPoints: string[];
  formulas: string[];
  questions: string[];
  linkedKnowledgePoints: string[];
  mastery: number | null;
  masteryBand: StudyNoteMasteryBand;
}

export interface StudyNote {
  id: string;
  title: string;
  createdAt: string;
  imageUri?: string;
  manualText?: string;
  dailySummary: string;
  examReview: string;
  cards: StudyNoteCard[];
  rawOutput: string;
}

const STORAGE_KEY = '@anotherme/study-notes';
const MAX_NOTES = 20;

type RawCard = {
  title?: unknown;
  summary?: unknown;
  key_points?: unknown;
  keyPoints?: unknown;
  formulas?: unknown;
  questions?: unknown;
  linked_knowledge_points?: unknown;
  linkedKnowledgePoints?: unknown;
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return fallback;
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asText(item))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripCodeFence(text);
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

function bindKnowledgePoints(
  card: Pick<StudyNoteCard, 'title' | 'summary' | 'keyPoints' | 'formulas' | 'questions'> & {
    linkedKnowledgePoints: string[];
  },
  knowledgeStates: KnowledgeState[],
): Pick<StudyNoteCard, 'linkedKnowledgePoints' | 'mastery' | 'masteryBand'> {
  const cardText = normalizeForMatch(
    [
      card.title,
      card.summary,
      ...card.keyPoints,
      ...card.formulas,
      ...card.questions,
      ...card.linkedKnowledgePoints,
    ].join(' '),
  );
  const explicit = card.linkedKnowledgePoints.map(normalizeForMatch);
  const matchedStates = knowledgeStates.filter((state) => {
    const name = normalizeForMatch(state.name || state.knowledge_point_id);
    const id = normalizeForMatch(state.knowledge_point_id);
    if (name.length < 2 && id.length < 2) return false;
    return (
      explicit.some((item) => item.includes(name) || item.includes(id)) ||
      (name.length >= 2 && cardText.includes(name)) ||
      (id.length >= 4 && cardText.includes(id))
    );
  });

  const names = new Set(card.linkedKnowledgePoints.filter(Boolean));
  for (const state of matchedStates) names.add(state.name || state.knowledge_point_id);

  if (matchedStates.length === 0) {
    return {
      linkedKnowledgePoints: Array.from(names),
      mastery: null,
      masteryBand: 'unlinked',
    };
  }

  const mastery =
    matchedStates.reduce((sum, state) => sum + Math.max(0, Math.min(1, state.mastery || 0)), 0) /
    matchedStates.length;
  const masteryBand: StudyNoteMasteryBand =
    mastery < 0.5 ? 'weak' : mastery < 0.8 ? 'familiar' : 'mastered';

  return {
    linkedKnowledgePoints: Array.from(names),
    mastery,
    masteryBand,
  };
}

function cardFromRaw(
  raw: RawCard,
  index: number,
  knowledgeStates: KnowledgeState[],
): StudyNoteCard {
  const keyPoints = asTextArray(raw.keyPoints ?? raw.key_points);
  const formulas = asTextArray(raw.formulas);
  const questions = asTextArray(raw.questions);
  const linkedKnowledgePoints = asTextArray(
    raw.linkedKnowledgePoints ?? raw.linked_knowledge_points,
  );
  const title = asText(raw.title, `知识点 ${index + 1}`) || `知识点 ${index + 1}`;
  const summary =
    asText(raw.summary) || keyPoints.slice(0, 3).join('；') || '等待补充整理内容。';
  const binding = bindKnowledgePoints(
    { title, summary, keyPoints, formulas, questions, linkedKnowledgePoints },
    knowledgeStates,
  );

  return {
    id: makeId(`card_${index + 1}`),
    title,
    summary,
    keyPoints,
    formulas,
    questions,
    ...binding,
  };
}

function fallbackCards(rawOutput: string, knowledgeStates: KnowledgeState[]): StudyNoteCard[] {
  const lines = rawOutput
    .split('\n')
    .map((line) => line.replace(/^[-*#\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const raw: RawCard = {
    title: 'AI 整理结果',
    summary: rawOutput.slice(0, 500),
    keyPoints: lines.length ? lines : [rawOutput.slice(0, 120)],
    formulas: [],
    questions: [],
    linkedKnowledgePoints: [],
  };
  return [cardFromRaw(raw, 0, knowledgeStates)];
}

export function createStudyNoteSystemPrompt(knowledgeStates: KnowledgeState[]): string {
  const knownPoints = knowledgeStates
    .slice(0, 30)
    .map((state) => `${state.name || state.knowledge_point_id}(${Math.round((state.mastery || 0) * 100)}%)`)
    .join('、');

  return [
    '你是一个面向学生复习的纸质笔记整理器。请识别图片或文字中的学习内容，整理成结构化复习卡。',
    '不要复刻原版排版，不要输出长篇讲义。优先提取标题、公式、知识点、疑问点和易错点。',
    knownPoints ? `当前学生知识追踪状态：${knownPoints}` : '当前没有可靠知识追踪状态，请不要编造掌握度。',
    '返回严格 JSON，不要 Markdown，不要解释。字段：',
    '{ "title": string, "daily_summary": string, "exam_review": string, "cards": [ { "title": string, "summary": string, "key_points": string[], "formulas": string[], "questions": string[], "linked_knowledge_points": string[] } ] }',
    'cards 控制在 3 到 6 张；linked_knowledge_points 只能写你有把握的知识点名称。',
  ].join('\n');
}

export function normalizeStudyNoteFromOutput(params: {
  rawOutput: string;
  imageUri?: string;
  manualText?: string;
  knowledgeStates: KnowledgeState[];
}): StudyNote {
  const parsed = parseJsonObject(params.rawOutput);
  const rawCards = Array.isArray(parsed?.cards) ? (parsed.cards as RawCard[]) : [];
  const cards = rawCards.length
    ? rawCards.slice(0, 8).map((card, index) => cardFromRaw(card, index, params.knowledgeStates))
    : fallbackCards(params.rawOutput, params.knowledgeStates);

  const weakTitles = cards
    .filter((card) => card.masteryBand === 'weak' || card.masteryBand === 'familiar')
    .map((card) => card.title);

  return {
    id: makeId('note'),
    title: asText(parsed?.title, '纸质笔记整理') || '纸质笔记整理',
    createdAt: new Date().toISOString(),
    imageUri: params.imageUri,
    manualText: params.manualText,
    dailySummary:
      asText(parsed?.daily_summary) ||
      cards
        .slice(0, 3)
        .map((card) => card.summary)
        .join('\n'),
    examReview:
      asText(parsed?.exam_review) ||
      (weakTitles.length
        ? `考前优先看：${weakTitles.join('、')}。`
        : cards
            .slice(0, 4)
            .map((card) => `${card.title}：${card.summary}`)
            .join('\n')),
    cards,
    rawOutput: params.rawOutput,
  };
}

export function getStudyNoteGroups(note: StudyNote): Record<StudyNoteMasteryBand, StudyNoteCard[]> {
  return {
    weak: note.cards.filter((card) => card.masteryBand === 'weak'),
    familiar: note.cards.filter((card) => card.masteryBand === 'familiar'),
    mastered: note.cards.filter((card) => card.masteryBand === 'mastered'),
    unlinked: note.cards.filter((card) => card.masteryBand === 'unlinked'),
  };
}

export async function loadStudyNotes(): Promise<StudyNote[]> {
  try {
    const raw = await getSafeStorage().getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StudyNote[]) : [];
  } catch {
    return [];
  }
}

export async function saveStudyNotes(notes: StudyNote[]): Promise<void> {
  await getSafeStorage().setItem(STORAGE_KEY, JSON.stringify(notes.slice(0, MAX_NOTES)));
}

export async function addStudyNote(note: StudyNote): Promise<StudyNote[]> {
  const current = await loadStudyNotes();
  const next = [note, ...current.filter((item) => item.id !== note.id)].slice(0, MAX_NOTES);
  await saveStudyNotes(next);
  return next;
}
