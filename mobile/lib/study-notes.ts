import { getSafeStorage } from "./safeStorage";
import type { KnowledgeState } from "./types";

export type StudyNoteViewMode = "full" | "weak" | "exam";
export type StudyNoteStatus = "generating" | "ready" | "failed";
export type StudyNoteMasteryBand =
  | "weak"
  | "familiar"
  | "mastered"
  | "unlinked";

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
  updatedAt?: string;
  status?: StudyNoteStatus;
  loadingLabel?: string;
  error?: string;
  progress?: number;
  imageUris?: string[];
  imageUri?: string;
  manualText?: string;
  dailySummary: string;
  examReview: string;
  cards: StudyNoteCard[];
  rawOutput: string;
  bookId?: string;
  bookTitle?: string;
  bookStatus?: string;
  bookError?: string;
}

const STORAGE_KEY = "@anotherme/study-notes";
const MAX_NOTES = 20;
const listeners = new Set<() => void>();

function emitStudyNotesChanged(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeStudyNotes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type RawCard = {
  title?: unknown;
  category?: unknown;
  summary?: unknown;
  description?: unknown;
  descriptions?: unknown;
  key_points?: unknown;
  keyPoints?: unknown;
  points?: unknown;
  formulas?: unknown;
  equations?: unknown;
  questions?: unknown;
  doubts?: unknown;
  confusion_points?: unknown;
  linked_knowledge_points?: unknown;
  linkedKnowledgePoints?: unknown;
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordToText(value: Record<string, unknown>): string {
  const direct = asText(
    value.text ??
      value.content ??
      value.summary ??
      value.point ??
      value.formula ??
      value.question ??
      value.name,
  );
  if (direct) return direct;

  const title = asText(value.title);
  const body = asText(value.description ?? value.detail ?? value.explanation);
  if (title && body) return `${title}：${body}`;
  if (title) return title;

  return Object.values(value)
    .map((item) => asText(item))
    .filter(Boolean)
    .join("；");
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = asRecord(item);
      return record ? recordToText(record) : asText(item);
    })
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return "";
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 用花括号配对找到最外层 JSON 对象 */
function findOuterJsonBlock(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 多策略提取文本中的 JSON 对象 */
function extractJsonBlock(text: string): string | null {
  // 策略 1：直接找花括号配对块
  const block = findOuterJsonBlock(text);
  if (block) return block;

  // 策略 2：去掉代码围栏后再找
  const stripped = stripCodeFence(text);
  if (stripped !== text) {
    const block2 = findOuterJsonBlock(stripped);
    if (block2) return block2;
  }

  return null;
}

/**
 * 正则回退解析：当 JSON 解析完全失败时，从 AI 的自由文本中
 * 按字段名提取 title / daily_summary / exam_review / cards
 */
function regexParseStudyNote(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // 提取标题 —— 匹配 "title" / "标题" 后面的内容
  const titleM =
    text.match(/(?:title|标题)[：:\s]*["']?([^"'\n]{1,80})["']?/i) ??
    text.match(/(?:^|[\n。])([^\n]{2,40}?)(?:笔记|整理|复习|总结)/);
  if (titleM) result.title = titleM[1].trim();

  // 提取 daily_summary
  const dailyM = text.match(
    /(?:daily_summary|dailySummary|今日摘要|摘要)[：:\s]*["']?([^"']{20,300})["']?/is,
  );
  if (dailyM) result.daily_summary = dailyM[1].trim();

  // 提取 exam_review
  const examM = text.match(
    /(?:exam_review|examReview|考前|复习要点)[：:\s]*["']?([^"']{20,300})["']?/is,
  );
  if (examM) result.exam_review = examM[1].trim();

  // 提取 key_points / 知识点 列表
  const kpMatch = text.match(
    /(?:key_points|keyPoints|知识点|要点)[：:\s]*\[([^\]]+)\]/is,
  );
  if (kpMatch) {
    const items = kpMatch[1]
      .split(/["'],\s*["']|[,，]、?/)
      .map((s) => s.replace(/^["']|["']$/g, "").trim())
      .filter(Boolean);
    if (items.length) result.key_points = items;
  }

  // 兜底：从文本中提取编号列表项
  if (!result.key_points) {
    const bullets = text
      .split(/\n/)
      .map((line) => line.replace(/^[-*#\d.、\s]+/, "").trim())
      .filter((line) => line.length > 3 && line.length < 120)
      .slice(0, 8);
    if (bullets.length >= 2) result.key_points = bullets;
  }

  return result;
}

/**
 * 鲁棒 JSON 解析器 —— 多级回退
 *
 * 层级：
 *   1. 整段直接 JSON.parse
 *   2. 去掉代码围栏后 JSON.parse
 *   3. 花括号配对提取后 JSON.parse
 *   4. 去掉围栏 + 花括号配对后 JSON.parse
 *   5. 正则按字段名从自由文本提取
 *   6. 返回 null（上层用 fallbackCards）
 */
function parseJsonObject(text: string): Record<string, unknown> | null {
  // L1：整段直接解析
  const direct = tryParseJson(text);
  if (direct) return direct;

  // L2：去围栏后解析
  const stripped = stripCodeFence(text);
  if (stripped !== text) {
    const parsed = tryParseJson(stripped);
    if (parsed) return parsed;
  }

  // L3：花括号配对提取
  const block = extractJsonBlock(text);
  if (block) {
    const parsed = tryParseJson(block);
    if (parsed) return parsed;
  }

  // L4：正则回退
  const regexResult = regexParseStudyNote(text);
  if (Object.keys(regexResult).length > 0) return regexResult;

  return null;
}

function unwrapStudyNotePayload(
  parsed: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!parsed) return null;
  const wrapped = asRecord(parsed.note_data ?? parsed.noteData ?? parsed.note);
  if (!wrapped) return parsed;

  return {
    ...parsed,
    ...wrapped,
    assistant_message: parsed.assistant_message ?? parsed.assistantMessage,
  };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

/** 将中文文本拆成 2-gram token（用于语义相似度近似） */
function chineseBigrams(text: string): string[] {
  const cleaned = text.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, "");
  if (cleaned.length <= 2) return [cleaned];
  const bigrams: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    bigrams.push(cleaned.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * 计算知识点的匹配评分（0-1），三级回退策略
 */
function matchScore(cardText: string, kpName: string, kpId: string): number {
  // L1: 精确包含
  if (kpName.length >= 2 && cardText.includes(kpName)) return 1.0;
  if (kpId.length >= 4 && cardText.includes(kpId)) return 0.95;

  // L2: 3-gram 片段匹配
  if (kpName.length >= 4) {
    for (let i = 0; i <= kpName.length - 3; i++) {
      const sub = kpName.slice(i, i + 3);
      if (cardText.includes(sub)) return 0.8;
    }
  }

  // L3: bigram 重叠率
  const cardBigrams = new Set(chineseBigrams(cardText));
  const kpBigrams = chineseBigrams(kpName);
  if (kpBigrams.length === 0) return 0;
  const overlap = kpBigrams.filter((b) => cardBigrams.has(b)).length;
  const ratio = overlap / kpBigrams.length;
  if (ratio >= 0.5) return 0.6;
  if (ratio >= 0.3) return 0.4;

  return 0;
}

function bindKnowledgePoints(
  card: Pick<
    StudyNoteCard,
    "title" | "summary" | "keyPoints" | "formulas" | "questions"
  > & {
    linkedKnowledgePoints: string[];
  },
  knowledgeStates: KnowledgeState[],
): Pick<StudyNoteCard, "linkedKnowledgePoints" | "mastery" | "masteryBand"> {
  const cardText = normalizeForMatch(
    [
      card.title,
      card.summary,
      ...card.keyPoints,
      ...card.formulas,
      ...card.questions,
      ...card.linkedKnowledgePoints,
    ].join(" "),
  );
  const explicit = card.linkedKnowledgePoints.map(normalizeForMatch);

  // 为每个知识点评分并筛选
  const scored = knowledgeStates
    .map((state) => {
      const name = normalizeForMatch(state.name || state.knowledge_point_id);
      const id = normalizeForMatch(state.knowledge_point_id);
      if (name.length < 2 && id.length < 2) return null;
      const isExplicit = explicit.some(
        (item) => item.includes(name) || item.includes(id),
      );
      const score = isExplicit ? 1.0 : matchScore(cardText, name, id);
      return { state, score };
    })
    .filter(
      (item): item is { state: KnowledgeState; score: number } =>
        item !== null && item.score >= 0.3,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const names = new Set(card.linkedKnowledgePoints.filter(Boolean));
  for (const { state } of scored)
    names.add(state.name || state.knowledge_point_id);

  if (scored.length === 0) {
    return {
      linkedKnowledgePoints: Array.from(names),
      mastery: null,
      masteryBand: "unlinked",
    };
  }

  // 加权平均 mastery（匹配度高的权重更大）
  const totalWeight = scored.reduce((sum, { score }) => sum + score, 0);
  const mastery =
    scored.reduce(
      (sum, { state, score }) =>
        sum + Math.max(0, Math.min(1, state.mastery || 0)) * score,
      0,
    ) / totalWeight;
  const masteryBand: StudyNoteMasteryBand =
    mastery < 0.5 ? "weak" : mastery < 0.8 ? "familiar" : "mastered";

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
  const keyPoints = asTextArray(
    raw.keyPoints ?? raw.key_points ?? raw.points ?? raw.descriptions,
  );
  const formulas = asTextArray(raw.formulas ?? raw.equations);
  const questions = asTextArray(
    raw.questions ?? raw.doubts ?? raw.confusion_points,
  );
  const linkedKnowledgePoints = asTextArray(
    raw.linkedKnowledgePoints ?? raw.linked_knowledge_points,
  );
  const title =
    firstText(raw.title, raw.category) || `知识点 ${index + 1}`;
  const summary =
    firstText(raw.summary, raw.description) ||
    keyPoints.slice(0, 3).join("；") ||
    "等待补充整理内容。";
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

function rawCardFromContentItem(item: unknown, index: number): RawCard | null {
  const record = asRecord(item);
  if (!record) {
    const text = asText(item);
    return text ? { title: `知识点 ${index + 1}`, summary: text } : null;
  }

  const title = firstText(record.title, record.category, record.name, record.heading);
  const descriptions = asTextArray(
    record.descriptions ??
      record.points ??
      record.key_points ??
      record.keyPoints ??
      record.items,
  );
  const description = firstText(
    record.description,
    record.summary,
    record.text,
    record.content,
    record.explanation,
  );
  const formulas = asTextArray(record.formulas ?? record.equations);
  const questions = asTextArray(
    record.questions ?? record.doubts ?? record.confusion_points,
  );

  if (!title && !description && descriptions.length === 0 && formulas.length === 0) {
    return null;
  }

  return {
    title: title || `知识点 ${index + 1}`,
    summary: description || descriptions.slice(0, 2).join("；"),
    keyPoints: descriptions,
    formulas,
    questions,
    linkedKnowledgePoints:
      record.linkedKnowledgePoints ?? record.linked_knowledge_points,
  };
}

function cardsFromPayload(payload: Record<string, unknown> | null): RawCard[] {
  if (!payload) return [];
  if (Array.isArray(payload.cards)) return payload.cards as RawCard[];
  if (Array.isArray(payload.content)) {
    const cards = payload.content
      .map(rawCardFromContentItem)
      .filter((card): card is RawCard => card !== null);
    if (cards.length) return cards;
  }

  const points = asTextArray(
    payload.points ?? payload.key_points ?? payload.keyPoints ?? payload.descriptions,
  );
  const formulas = asTextArray(payload.formulas ?? payload.equations);
  const questions = asTextArray(
    payload.questions ?? payload.doubts ?? payload.confusion_points,
  );
  const summary = firstText(
    payload.summary,
    payload.description,
    payload.daily_summary,
    payload.dailySummary,
    payload.assistant_message,
    payload.assistantMessage,
  );

  if (points.length || formulas.length || questions.length || summary) {
    return [
      {
        title: payload.title,
        summary,
        keyPoints: points,
        formulas,
        questions,
        linkedKnowledgePoints:
          payload.linkedKnowledgePoints ?? payload.linked_knowledge_points,
      },
    ];
  }

  return [];
}

function buildDailySummary(
  payload: Record<string, unknown> | null,
  cards: StudyNoteCard[],
): string {
  const explicit = firstText(
    payload?.daily_summary,
    payload?.dailySummary,
    payload?.summary,
    payload?.description,
    payload?.assistant_message,
    payload?.assistantMessage,
  );
  if (explicit) return explicit;

  return cards
    .slice(0, 3)
    .map((card) => `${card.title}：${card.summary}`)
    .join("\n");
}

function fallbackCards(
  rawOutput: string,
  knowledgeStates: KnowledgeState[],
): StudyNoteCard[] {
  const lines = rawOutput
    .split("\n")
    .map((line) => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const raw: RawCard = {
    title: "AI 整理结果",
    summary: rawOutput.slice(0, 500),
    keyPoints: lines.length ? lines : [rawOutput.slice(0, 120)],
    formulas: [],
    questions: [],
    linkedKnowledgePoints: [],
  };
  return [cardFromRaw(raw, 0, knowledgeStates)];
}

export function createStudyNoteSystemPrompt(
  knowledgeStates: KnowledgeState[],
): string {
  const knownPoints = knowledgeStates
    .slice(0, 30)
    .map(
      (state) =>
        `${state.name || state.knowledge_point_id}(${Math.round((state.mastery || 0) * 100)}%)`,
    )
    .join("、");

  return [
    "你是一个面向学生复习的纸质笔记整理器。请识别一张或多张图片、以及文字补充中的学习内容，整理成结构化复习卡。",
    "如果有多张图片，请按用户选择顺序视作同一份连续笔记，合并重复内容，补齐上下文关系。",
    "不要复刻原版排版，不要输出长篇讲义。优先提取标题、公式、知识点、疑问点和易错点。",
    knownPoints
      ? `当前学生知识追踪状态：${knownPoints}`
      : "当前没有可靠知识追踪状态，请不要编造掌握度。",
    "只返回一个可直接 JSON.parse 的 JSON 对象，不要 Markdown，不要解释，不要包裹 assistant_message 或 note_data。",
    "字段必须是：",
    '{ "title": string, "daily_summary": string, "exam_review": string, "cards": [ { "title": string, "summary": string, "key_points": string[], "formulas": string[], "questions": string[], "linked_knowledge_points": string[] } ] }',
    "禁止返回 metadata、content、category、description 等自定义结构；必须转换成 cards 数组。",
    "面向初中生展示，summary 和 key_points 要写成学生能直接读懂的短句，不要暴露 JSON、字段名或中间推理过程。",
    "cards 控制在 3 到 6 张；linked_knowledge_points 只能写你有把握的知识点名称。",
    "公式统一写入 formulas；行内公式用 $...$，独立公式用 $$...$$，不要把整个 JSON 作为字符串字段输出。",
  ].join("\n");
}

export function normalizeStudyNoteFromOutput(params: {
  rawOutput: string;
  id?: string;
  createdAt?: string;
  imageUris?: string[];
  imageUri?: string;
  manualText?: string;
  knowledgeStates: KnowledgeState[];
  bookId?: string;
  bookTitle?: string;
  bookStatus?: string;
  bookError?: string;
}): StudyNote {
  const parsed = parseJsonObject(params.rawOutput);
  const payload = unwrapStudyNotePayload(parsed);
  const rawCards = cardsFromPayload(payload);
  const cards = rawCards.length
    ? rawCards
        .slice(0, 8)
        .map((card, index) => cardFromRaw(card, index, params.knowledgeStates))
    : fallbackCards(params.rawOutput, params.knowledgeStates);

  const weakTitles = cards
    .filter(
      (card) => card.masteryBand === "weak" || card.masteryBand === "familiar",
    )
    .map((card) => card.title);

  return {
    id: params.id || makeId("note"),
    title: asText(payload?.title, "纸质笔记整理") || "纸质笔记整理",
    createdAt: params.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "ready",
    progress: 100,
    imageUris: params.imageUris?.length
      ? params.imageUris
      : params.imageUri
        ? [params.imageUri]
        : undefined,
    imageUri: params.imageUri ?? params.imageUris?.[0],
    manualText: params.manualText,
    dailySummary: buildDailySummary(payload, cards),
    examReview:
      firstText(payload?.exam_review, payload?.examReview, payload?.review) ||
      (weakTitles.length
        ? `考前优先看：${weakTitles.join("、")}。`
        : cards
            .slice(0, 4)
            .map((card) => `${card.title}：${card.summary}`)
            .join("\n")),
    cards,
    rawOutput: params.rawOutput,
    bookId: params.bookId,
    bookTitle: params.bookTitle,
    bookStatus: params.bookStatus,
    bookError: params.bookError,
  };
}

function shouldRepairStoredNote(note: StudyNote): boolean {
  if (!note.rawOutput) return false;
  if (!parseJsonObject(note.rawOutput)) return false;
  const cards = Array.isArray(note.cards) ? note.cards : [];
  return (
    cards.length === 0 ||
    (cards.length === 1 &&
      cards[0]?.title === "AI 整理结果" &&
      cards[0]?.summary?.includes("{"))
  );
}

function repairStoredNote(note: StudyNote): StudyNote {
  if (!shouldRepairStoredNote(note)) return note;
  const repaired = normalizeStudyNoteFromOutput({
    rawOutput: note.rawOutput,
    imageUris: note.imageUris ?? (note.imageUri ? [note.imageUri] : undefined),
    imageUri: note.imageUri,
    manualText: note.manualText,
    knowledgeStates: [],
    bookId: note.bookId,
    bookTitle: note.bookTitle,
    bookStatus: note.bookStatus,
    bookError: note.bookError,
  });
  return {
    ...repaired,
    id: note.id,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    status: note.status,
    loadingLabel: note.loadingLabel,
    error: note.error,
    progress: note.progress,
    imageUris: note.imageUris ?? (note.imageUri ? [note.imageUri] : undefined),
    imageUri: note.imageUri,
    manualText: note.manualText,
    bookId: note.bookId,
    bookTitle: note.bookTitle,
    bookStatus: note.bookStatus,
    bookError: note.bookError,
  };
}

export function repairStudyNoteForDisplay(note: StudyNote): StudyNote {
  return repairStoredNote(note);
}

export function getStudyNoteGroups(
  note: StudyNote,
): Record<StudyNoteMasteryBand, StudyNoteCard[]> {
  return {
    weak: note.cards.filter((card) => card.masteryBand === "weak"),
    familiar: note.cards.filter((card) => card.masteryBand === "familiar"),
    mastered: note.cards.filter((card) => card.masteryBand === "mastered"),
    unlinked: note.cards.filter((card) => card.masteryBand === "unlinked"),
  };
}

export async function loadStudyNotes(): Promise<StudyNote[]> {
  try {
    const raw = await getSafeStorage().getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as StudyNote[]).map((note) => ({
          ...repairStoredNote(note),
          status: note.status || "ready",
          updatedAt: note.updatedAt || note.createdAt,
        }))
      : [];
  } catch {
    return [];
  }
}

export async function saveStudyNotes(notes: StudyNote[]): Promise<void> {
  await getSafeStorage().setItem(
    STORAGE_KEY,
    JSON.stringify(notes.slice(0, MAX_NOTES)),
  );
  emitStudyNotesChanged();
}

export async function addStudyNote(note: StudyNote): Promise<StudyNote[]> {
  const current = await loadStudyNotes();
  const next = [note, ...current.filter((item) => item.id !== note.id)].slice(
    0,
    MAX_NOTES,
  );
  await saveStudyNotes(next);
  return next;
}

export async function updateStudyNote(
  noteId: string,
  patch: Partial<StudyNote>,
): Promise<StudyNote[]> {
  const current = await loadStudyNotes();
  const next = current.map((note) =>
    note.id === noteId
      ? {
          ...note,
          ...patch,
          id: note.id,
          createdAt: patch.createdAt || note.createdAt,
          updatedAt: patch.updatedAt || new Date().toISOString(),
        }
      : note,
  );
  await saveStudyNotes(next);
  return next;
}

export async function deleteStudyNote(noteId: string): Promise<StudyNote[]> {
  const current = await loadStudyNotes();
  const next = current.filter((item) => item.id !== noteId);
  await saveStudyNotes(next);
  return next;
}

// ── Draft persistence ──────────────────────────────────────────────

const DRAFT_KEY = "@anotherme/study-note-draft";

export interface StudyNoteDraft {
  imageUris?: string[];
  imageUri?: string;
  manualText?: string;
  savedAt: string;
}

export async function saveStudyNoteDraft(draft: StudyNoteDraft): Promise<void> {
  try {
    await getSafeStorage().setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 草稿保存失败不阻塞主流程
  }
}

export async function loadStudyNoteDraft(): Promise<StudyNoteDraft | null> {
  try {
    const raw = await getSafeStorage().getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // 超过 2 小时的草稿自动丢弃
    const age = Date.now() - new Date(parsed.savedAt || 0).getTime();
    if (age > 2 * 60 * 60 * 1000) return null;
    // 至少要有图片或文字才有效
    const imageUris = Array.isArray(parsed.imageUris)
      ? parsed.imageUris.filter((item: unknown) => typeof item === "string")
      : parsed.imageUri
        ? [parsed.imageUri]
        : [];
    if (imageUris.length === 0 && !parsed.manualText) return null;
    return { ...(parsed as StudyNoteDraft), imageUris };
  } catch {
    return null;
  }
}

export async function clearStudyNoteDraft(): Promise<void> {
  try {
    await getSafeStorage().removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

function clipForBookInput(value: string, limit: number): string {
  const text = (value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function listSection(title: string, items: string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (!clean.length) return "";
  return [`### ${title}`, ...clean.map((item) => `- ${item}`)].join("\n");
}

export function buildStudyNoteLiveBookTopic(
  note: StudyNote,
  options?: { imageCount?: number },
): string {
  const imageCount =
    options?.imageCount ??
    note.imageUris?.length ??
    (note.imageUri ? 1 : 0);
  const cardSections = note.cards
    .slice(0, 8)
    .map((card, index) => {
      const parts = [
        `## ${index + 1}. ${card.title}`,
        clipForBookInput(card.summary, 700),
        listSection("关键要点", card.keyPoints),
        listSection("公式", card.formulas),
        listSection("疑问与易错点", card.questions),
        listSection("关联知识点", card.linkedKnowledgePoints),
      ].filter(Boolean);
      return parts.join("\n");
    })
    .join("\n\n");

  return [
    "请基于以下移动端纸质笔记整理结果，生成一本中文互动活书。",
    "这是从学生上传的笔记图片中提取出的内容，请把它当作主要素材，不要扩展成泛泛教材。",
    imageCount > 0 ? `原始笔记图片数量：${imageCount} 张。` : "",
    note.manualText ? `学生补充说明：${clipForBookInput(note.manualText, 800)}` : "",
    "",
    `# 笔记主题：${note.title}`,
    "",
    "## 今日摘要",
    clipForBookInput(note.dailySummary, 1200),
    "",
    "## 考前复习重点",
    clipForBookInput(note.examReview, 1200),
    "",
    "## 已提取的知识卡片",
    cardSections || clipForBookInput(note.rawOutput, 2500),
    "",
    "活书生成要求：",
    "- 按笔记内在知识链组织章节，章节数量控制在 3 到 6 章。",
    "- 每章都要服务复习：概念解释、易错提醒、公式/例题、速记卡和自测题要自然穿插。",
    "- 如果笔记中有疑问点或薄弱点，把它们做成重点讲解和测验。",
    "- 保留学生笔记里的原始表述和公式，不要凭空增加与笔记无关的大段内容。",
  ]
    .filter(Boolean)
    .join("\n");
}
