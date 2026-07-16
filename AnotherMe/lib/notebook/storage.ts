export type NotebookSource = 'manual' | 'knowledge-card' | 'photo-video' | 'chat' | 'solve' | 'research';
export type NoteSortOption = 'updatedAt' | 'createdAt' | 'title';

// 笔记类型（参考 AnotherMe）
export type NotebookNoteType =
  | 'manual'      // 手动创建
  | 'chat'        // 聊天保存
  | 'solve'       // 解题记录
  | 'research'    // 研究记录
  | 'classroom'   // 课堂笔记
  | 'quiz';       // 测验记录

// 笔记本（参考 AnotherMe 的多笔记本管理）
export interface Notebook {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  createdAt: number;
  updatedAt: number;
  recordCount: number;
}

export interface NotebookNote {
  id: string;
  notebookId: string;           // 所属笔记本ID
  type: NotebookNoteType;       // 笔记类型
  title: string;
  content: string;
  summary?: string;             // AI 自动生成摘要
  userQuery?: string;           // 用户原始问题（用于聊天/解题记录）
  output?: string;              // AI 输出内容
  tags: string[];
  subject: string;
  source: NotebookSource;
  createdAt: number;
  updatedAt: number;
  stageId?: string;
  sceneId?: string;
  isPinned?: boolean;
  isFavorite?: boolean;
  metadata?: Record<string, unknown>;  // 扩展元数据
}

export interface DeletedNote extends NotebookNote {
  deletedAt: number;
}

export interface UpsertNotebookInput {
  id?: string;
  notebookId?: string;
  type?: NotebookNoteType;
  title: string;
  content: string;
  summary?: string;
  userQuery?: string;
  output?: string;
  tags?: string[];
  subject?: string;
  source?: NotebookSource;
  stageId?: string;
  sceneId?: string;
  isPinned?: boolean;
  isFavorite?: boolean;
  metadata?: Record<string, unknown>;
}

// 笔记本管理
export interface NotebookManagerState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
}

// localStorage keys deprecated — data now stored in IndexedDB via notebook-db.ts
// Kept for reference during migration period
const _DEPRECATED_KEYS = [
  'anotherme:notebook:items:v2',
  'anotherme:notebook:trash:v1',
  'anotherme:notebook:settings:v1',
  'anotherme:notebook:manager:v1',
  'workspace:notebook:items',
  'anotherme:notebook:items:v1',
];

export interface NotebookSettings {
  sortBy: NoteSortOption;
  sortOrder: 'asc' | 'desc';
  viewMode: 'list' | 'grouped';
}

function safeJsonParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

const NOTE_TYPES = new Set<NotebookNoteType>(['manual', 'chat', 'solve', 'research', 'classroom', 'quiz']);
const NOTE_SOURCES = new Set<NotebookSource>(['manual', 'knowledge-card', 'photo-video', 'chat', 'solve', 'research']);

function normalizeNoteType(value: unknown): NotebookNoteType {
  return typeof value === 'string' && NOTE_TYPES.has(value as NotebookNoteType) ? (value as NotebookNoteType) : 'manual';
}

function normalizeNoteSource(value: unknown): NotebookSource {
  return typeof value === 'string' && NOTE_SOURCES.has(value as NotebookSource) ? (value as NotebookSource) : 'manual';
}

function normalizeNotebookBook(book: NotebookBookRecord): Notebook {
  return {
    id: book.id,
    name: book.name,
    description: book.description ?? '',
    color: book.color ?? '#3B82F6',
    icon: book.icon ?? 'book',
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    recordCount: book.recordCount,
  };
}

function normalizeNotebookRecord(note: NotebookNoteRecord): NotebookNote {
  return {
    id: note.id,
    notebookId: note.notebookId || 'default',
    type: normalizeNoteType(note.type),
    title: note.title,
    content: note.content,
    summary: note.summary,
    userQuery: note.userQuery,
    output: note.output,
    tags: normalizeTags(note.tags),
    subject: note.subject?.trim() || '综合',
    source: normalizeNoteSource(note.source),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    stageId: note.stageId,
    sceneId: note.sceneId,
    isPinned: note.isPinned,
    isFavorite: note.isFavorite,
    metadata: note.metadata,
  };
}

function normalizeTrashRecord(note: NotebookTrashRecord): DeletedNote {
  return {
    ...normalizeNotebookRecord(note),
    deletedAt: note.deletedAt,
  };
}

function isNotebookNote(value: unknown): value is NotebookNote {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<NotebookNote>;
  return (
    typeof note.id === 'string' &&
    typeof note.title === 'string' &&
    typeof note.content === 'string' &&
    typeof note.subject === 'string' &&
    typeof note.source === 'string' &&
    typeof note.createdAt === 'number' &&
    typeof note.updatedAt === 'number' &&
    Array.isArray(note.tags)
  );
}

function normalizeNoteList(value: unknown): NotebookNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isNotebookNote)
    .map((note) => ({
      ...note,
      tags: normalizeTags(note.tags),
      type: normalizeNoteType(note.type),
      subject: note.subject.trim() || '综合',
      source: normalizeNoteSource(note.source),
      notebookId: note.notebookId || 'default',
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

import {
  getAllNotes,
  putNotes,
  putNote,
  getNote,
  deleteNote as dbDeleteNote,
  deleteNotes as dbDeleteNotes,
  putTrashNote,
  deleteTrashNote,
  clearTrash as dbClearTrash,
  getAllTrash,
  getSettings,
  putSettings,
  getAllBooks,
  putBook,
  deleteBook,
  searchNotes,
} from './notebook-db';
import {
  debouncedSyncNotebookToServer,
  pullNotebookFromServerIfLocalEmpty,
} from './notebook-sync';
import type { NotebookNoteRecord, NotebookTrashRecord, NotebookBookRecord, NotebookSettingsRecord } from '@/lib/utils/database';

async function writeNotebookNotes(notes: NotebookNote[]) {
  const records: NotebookNoteRecord[] = notes.map(n => ({
    ...n,
    notebookId: n.notebookId || 'default',
  }));
  await putNotes(records);
}

export async function readNotebookNotes(): Promise<NotebookNote[]> {
  await pullNotebookFromServerIfLocalEmpty();
  const records = await getAllNotes();
  return normalizeNoteList(records);
}

// 笔记本管理函数 (backed by IndexedDB)

const DEFAULT_NOTEBOOK: Notebook = {
  id: 'default',
  name: '默认笔记本',
  description: '自动创建的默认笔记本',
  color: '#3B82F6',
  icon: 'book',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  recordCount: 0,
};

export async function listNotebooks(): Promise<Notebook[]> {
  await pullNotebookFromServerIfLocalEmpty();
  const books = await getAllBooks();
  if (books.length === 0) {
    // Initialize default notebook
    await putBook({
      id: DEFAULT_NOTEBOOK.id,
      name: DEFAULT_NOTEBOOK.name,
      description: DEFAULT_NOTEBOOK.description,
      color: DEFAULT_NOTEBOOK.color,
      icon: DEFAULT_NOTEBOOK.icon,
      createdAt: DEFAULT_NOTEBOOK.createdAt,
      updatedAt: DEFAULT_NOTEBOOK.updatedAt,
      recordCount: 0,
    });
    debouncedSyncNotebookToServer();
    return [DEFAULT_NOTEBOOK];
  }
  return books.map(normalizeNotebookBook);
}

export async function getActiveNotebookId(): Promise<string | null> {
  const settings = await getSettings();
  return settings?.activeNotebookId ?? 'default';
}

export async function setActiveNotebookId(notebookId: string): Promise<void> {
  const existing = await getSettings();
  await putSettings({
    id: 'default',
    sortBy: existing?.sortBy || 'updatedAt',
    sortOrder: existing?.sortOrder || 'desc',
    viewMode: existing?.viewMode || 'grid',
    activeNotebookId: notebookId,
  });
  debouncedSyncNotebookToServer();
}

export async function createNotebook(
  name: string,
  description: string = '',
  color: string = '#3B82F6',
  icon: string = 'book'
): Promise<Notebook> {
  const notebook: Notebook = {
    id: `nb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || '未命名笔记本',
    description,
    color,
    icon,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    recordCount: 0,
  };
  await putBook({
    id: notebook.id,
    name: notebook.name,
    description: notebook.description,
    color: notebook.color,
    icon: notebook.icon,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    recordCount: 0,
  });
  debouncedSyncNotebookToServer();
  return notebook;
}

export async function updateNotebook(
  notebookId: string,
  updates: Partial<Omit<Notebook, 'id' | 'createdAt'>>
): Promise<Notebook | null> {
  const existing = await getAllBooks();
  const book = existing.find(nb => nb.id === notebookId);
  if (!book) return null;

  const updated = { ...book, ...updates, updatedAt: Date.now() };
  await putBook(updated);
  debouncedSyncNotebookToServer();
  return normalizeNotebookBook(updated);
}

export async function deleteNotebook(notebookId: string): Promise<boolean> {
  if (notebookId === 'default') return false; // 不能删除默认笔记本

  const existing = await getAllBooks();
  if (!existing.find(nb => nb.id === notebookId)) return false;

  // 将该笔记本的笔记移动到默认笔记本
  const notes = await getAllNotes();
  const toMove = notes.filter(n => n.notebookId === notebookId);
  if (toMove.length > 0) {
    await putNotes(toMove.map(n => ({ ...n, notebookId: 'default' })));
  }

  await deleteBook(notebookId);

  // Update active notebook if needed
  const settings = await getSettings();
  if (settings?.activeNotebookId === notebookId) {
    await putSettings({ ...settings, activeNotebookId: 'default' });
  }
  debouncedSyncNotebookToServer();
  return true;
}

async function updateNotebookRecordCount(notebookId: string): Promise<void> {
  const books = await getAllBooks();
  const book = books.find(nb => nb.id === notebookId);
  if (book) {
    const notes = await getAllNotes();
    book.recordCount = notes.filter(n => n.notebookId === notebookId).length;
    book.updatedAt = Date.now();
    await putBook(book);
  }
}

function createNoteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function upsertNotebookNote(input: UpsertNotebookInput): Promise<NotebookNote> {
  const notes = await getAllNotes();
  const now = Date.now();
  const noteId = input.id || createNoteId();
  const current = notes.find((note) => note.id === noteId);

  // 确定所属笔记本
  const notebookId = input.notebookId || current?.notebookId || (await getActiveNotebookId()) || 'default';

  const next: NotebookNote = {
    id: noteId,
    notebookId,
    type: input.type || normalizeNoteType(current?.type),
    title: input.title.trim() || '未命名笔记',
    content: input.content,
    summary: input.summary || current?.summary,
    userQuery: input.userQuery || current?.userQuery,
    output: input.output || current?.output,
    tags: input.tags !== undefined ? normalizeTags(input.tags) : normalizeTags(current?.tags),
    subject: input.subject?.trim() || current?.subject?.trim() || '综合',
    source: input.source || normalizeNoteSource(current?.source),
    createdAt: current?.createdAt || now,
    updatedAt: now,
    stageId: input.stageId || current?.stageId,
    sceneId: input.sceneId || current?.sceneId,
    isPinned: current?.isPinned,
    isFavorite: current?.isFavorite,
    metadata: input.metadata || current?.metadata,
  };

  await putNote({ ...next, notebookId: next.notebookId || 'default' });
  await updateNotebookRecordCount(notebookId);
  debouncedSyncNotebookToServer();
  return next;
}

export async function deleteNotebookNote(noteId: string): Promise<DeletedNote | null> {
  const note = await getNote(noteId);
  if (!note) return null;

  const deletedNote: DeletedNote = { ...normalizeNotebookRecord(note), deletedAt: Date.now() };

  await dbDeleteNote(noteId);
  await putTrashNote(deletedNote);

  // Keep max 50 trash items
  const trash = await getAllTrash();
  if (trash.length > 50) {
    const toRemove = trash.slice(50);
    for (const t of toRemove) {
      await deleteTrashNote(t.id);
    }
  }

  await updateNotebookRecordCount(note.notebookId);
  debouncedSyncNotebookToServer();
  return deletedNote;
}

export async function readTrashNotes(): Promise<DeletedNote[]> {
  return (await getAllTrash()).map(normalizeTrashRecord);
}

export async function restoreFromTrash(noteId: string): Promise<NotebookNote | null> {
  const trash = await getAllTrash();
  const noteToRestore = trash.find((note) => note.id === noteId);
  if (!noteToRestore) return null;

  const updatedNote = { ...normalizeNotebookRecord(noteToRestore), updatedAt: Date.now() };

  await putNote({ ...updatedNote, notebookId: updatedNote.notebookId || 'default' });
  await deleteTrashNote(noteId);
  debouncedSyncNotebookToServer();
  return updatedNote;
}

export async function permanentlyDeleteFromTrash(noteId: string): Promise<boolean> {
  const trash = await getAllTrash();
  if (!trash.find((note) => note.id === noteId)) return false;
  await deleteTrashNote(noteId);
  debouncedSyncNotebookToServer();
  return true;
}

export async function clearTrash(): Promise<void> {
  await dbClearTrash();
  debouncedSyncNotebookToServer();
}

export async function toggleNotePin(noteId: string): Promise<NotebookNote | null> {
  const notes = await getAllNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) return null;

  return upsertNotebookNote({
    ...normalizeNotebookRecord(note),
    isPinned: !note.isPinned,
  });
}

export async function toggleNoteFavorite(noteId: string): Promise<NotebookNote | null> {
  const notes = await getAllNotes();
  const note = notes.find((n) => n.id === noteId);
  if (!note) return null;

  return upsertNotebookNote({
    ...normalizeNotebookRecord(note),
    isFavorite: !note.isFavorite,
  });
}

export async function readNotebookSettings(): Promise<NotebookSettings> {
  const existing = await getSettings();
  return {
    sortBy: (existing?.sortBy as NoteSortOption) || 'updatedAt',
    sortOrder: (existing?.sortOrder as 'asc' | 'desc') || 'desc',
    viewMode: (existing?.viewMode as 'list' | 'grouped') || 'list',
  };
}

export async function saveNotebookSettings(settings: NotebookSettings): Promise<void> {
  const existing = await getSettings();
  await putSettings({
    id: 'default',
    sortBy: settings.sortBy,
    sortOrder: settings.sortOrder,
    viewMode: settings.viewMode,
    activeNotebookId: existing?.activeNotebookId ?? null,
  });
  debouncedSyncNotebookToServer();
}

export function sortNotes(notes: NotebookNote[], sortBy: NoteSortOption, sortOrder: 'asc' | 'desc'): NotebookNote[] {
  const sorted = [...notes].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title, 'zh-CN');
      case 'createdAt':
        return a.createdAt - b.createdAt;
      case 'updatedAt':
      default:
        return a.updatedAt - b.updatedAt;
    }
  });

  return sortOrder === 'desc' ? sorted.reverse() : sorted;
}

export function groupNotesBySubject(notes: NotebookNote[]): Map<string, NotebookNote[]> {
  const groups = new Map<string, NotebookNote[]>();

  const pinned = notes.filter((n) => n.isPinned);
  const unpinned = notes.filter((n) => !n.isPinned);

  if (pinned.length > 0) {
    groups.set('📌 置顶', pinned);
  }

  unpinned.forEach((note) => {
    const subject = note.subject || '综合';
    if (!groups.has(subject)) {
      groups.set(subject, []);
    }
    groups.get(subject)!.push(note);
  });

  return groups;
}

export function groupNotesByType(notes: NotebookNote[]): Map<string, NotebookNote[]> {
  const groups = new Map<string, NotebookNote[]>();

  const typeLabels: Record<NotebookNoteType, string> = {
    manual: '📝 手动创建',
    chat: '💬 聊天记录',
    solve: '🔢 解题记录',
    research: '🔍 研究记录',
    classroom: '📚 课堂笔记',
    quiz: '❓ 测验记录',
  };

  notes.forEach((note) => {
    const type = note.type || 'manual';
    const label = typeLabels[type] || '📝 其他';
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(note);
  });

  return groups;
}

export function buildKnowledgeCardNoteId(stageId: string, sceneId: string): string {
  return `knowledge-card:${stageId}:${sceneId}`;
}

export async function upsertKnowledgeCardNote(params: {
  stageId: string;
  sceneId: string;
  title: string;
  bullets: string[];
}): Promise<NotebookNote> {
  const markdown = params.bullets.map((bullet) => `- ${bullet}`).join('\n');
  return upsertNotebookNote({
    id: buildKnowledgeCardNoteId(params.stageId, params.sceneId),
    type: 'classroom',
    title: params.title,
    content: markdown,
    source: 'knowledge-card',
    subject: '课堂',
    tags: ['课堂', '知识卡片'],
    stageId: params.stageId,
    sceneId: params.sceneId,
  });
}

export async function removeKnowledgeCardNote(stageId: string, sceneId: string): Promise<void> {
  await deleteNotebookNote(buildKnowledgeCardNoteId(stageId, sceneId));
}

export function buildPhotoVideoNoteId(videoUrl: string): string {
  return `photo-video:${encodeURIComponent(videoUrl || 'local')}`;
}

// 保存聊天到笔记（参考 AnotherMe）
export interface ChatMessageForNote {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SaveChatToNoteInput {
  title: string;
  messages: ChatMessageForNote[];
  notebookId?: string;
  metadata?: Record<string, unknown>;
}

export async function saveChatToNote(input: SaveChatToNoteInput): Promise<NotebookNote> {
  const transcript = input.messages
    .map((msg) => {
      const role = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : '系统';
      return `## ${role}\n${msg.content}`;
    })
    .join('\n\n');

  const userQuery = input.messages
    .filter((msg) => msg.role === 'user')
    .map((msg) => msg.content)
    .join('\n\n');

  return upsertNotebookNote({
    notebookId: input.notebookId,
    type: 'chat',
    title: input.title,
    content: transcript,
    userQuery,
    output: input.messages.find((msg) => msg.role === 'assistant')?.content,
    source: 'chat',
    subject: '聊天',
    tags: ['聊天', 'AI对话'],
    metadata: {
      messageCount: input.messages.length,
      ...input.metadata,
    },
  });
}

// Note Templates
export interface NoteTemplate {
  id: string;
  name: string;
  icon: string;
  title: string;
  subject: string;
  tags: string[];
  content: string;
  type: NotebookNoteType;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    name: '空白笔记',
    icon: '📄',
    title: '未命名文稿',
    subject: '综合',
    tags: ['草稿'],
    content: '',
    type: 'manual',
  },
  {
    id: 'study',
    name: '学习笔记',
    icon: '📚',
    title: '学习笔记',
    subject: '课堂',
    tags: ['学习', '笔记'],
    type: 'classroom',
    content: `# 学习目标

- 

# 重点内容

## 知识点1



## 知识点2



# 总结与反思


`,
  },
  {
    id: 'chat',
    name: '聊天记录',
    icon: '💬',
    title: 'AI对话记录',
    subject: '聊天',
    tags: ['聊天', 'AI'],
    type: 'chat',
    content: '',
  },
  {
    id: 'solve',
    name: '解题记录',
    icon: '🔢',
    title: '解题记录',
    subject: '数学',
    tags: ['解题', '数学'],
    type: 'solve',
    content: `# 题目



# 解题思路



# 解答过程



# 总结


`,
  },
  {
    id: 'research',
    name: '研究记录',
    icon: '🔍',
    title: '研究记录',
    subject: '研究',
    tags: ['研究', '探索'],
    type: 'research',
    content: `# 研究主题



# 关键发现



# 参考资料



# 结论


`,
  },
  {
    id: 'meeting',
    name: '会议纪要',
    icon: '📋',
    title: '会议纪要',
    subject: '工作',
    tags: ['会议', '纪要'],
    type: 'manual',
    content: `# 会议信息

- 时间：${new Date().toLocaleDateString('zh-CN')}
- 地点：
- 参会人员：

# 会议议题

1. 

# 讨论内容



# 决议事项

- [ ] 

# 下一步行动

- [ ] 
`,
  },
  {
    id: 'diary',
    name: '日记',
    icon: '📝',
    title: new Date().toLocaleDateString('zh-CN') + ' 日记',
    subject: '生活',
    tags: ['日记'],
    type: 'manual',
    content: `# ${new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

## 今日心情



## 今日收获



## 明日计划


`,
  },
  {
    id: 'reading',
    name: '读书笔记',
    icon: '📖',
    title: '读书笔记',
    subject: '阅读',
    tags: ['读书', '笔记'],
    type: 'manual',
    content: `# 书籍信息

- 书名：
- 作者：
- 阅读日期：${new Date().toLocaleDateString('zh-CN')}

# 核心观点



# 精彩摘录

> 

# 个人感悟


`,
  },
  {
    id: 'code',
    name: '代码笔记',
    icon: '💻',
    title: '代码笔记',
    subject: '编程',
    tags: ['代码', '技术'],
    type: 'manual',
    content: `# 问题描述



# 解决方案

\`\`\`

\`\`\`

# 关键代码

\`\`\`

\`\`\`

# 注意事项

- 
`,
  },
  {
    id: 'todo',
    name: '待办清单',
    icon: '✅',
    title: '待办事项',
    subject: '任务',
    tags: ['待办'],
    type: 'manual',
    content: `# 今日待办

- [ ] 

# 本周计划

- [ ] 

# 重要事项

- [ ] 
`,
  },
];

export async function createNoteFromTemplate(templateId: string, notebookId?: string): Promise<NotebookNote> {
  const template = NOTE_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return upsertNotebookNote({
      title: '未命名文稿',
      content: '',
      subject: '综合',
      tags: ['草稿'],
      source: 'manual',
      notebookId,
    });
  }

  return upsertNotebookNote({
    notebookId,
    type: template.type,
    title: template.title,
    content: template.content,
    subject: template.subject,
    tags: template.tags,
    source: 'manual',
  });
}

// Batch operations
export async function batchDeleteNotes(noteIds: string[]): Promise<number> {
  const notes = await getAllNotes();
  const notesToDelete = notes.filter((n) => noteIds.includes(n.id));

  if (notesToDelete.length === 0) return 0;

  const deletedNotes: DeletedNote[] = notesToDelete.map((n) => ({
    ...normalizeNotebookRecord(n),
    deletedAt: Date.now(),
  }));

  await dbDeleteNotes(noteIds);
  for (const deletedNote of deletedNotes) {
    await putTrashNote({ ...deletedNote, notebookId: deletedNote.notebookId || 'default' });
  }

  // Keep max 50 trash items
  const trash = await getAllTrash();
  if (trash.length > 50) {
    const toRemove = trash.slice(50);
    for (const t of toRemove) {
      await deleteTrashNote(t.id);
    }
  }

  // 更新笔记本记录数
  const affectedNotebookIds = new Set(notesToDelete.map(n => n.notebookId));
  for (const id of affectedNotebookIds) {
    await updateNotebookRecordCount(id);
  }

  debouncedSyncNotebookToServer();
  return deletedNotes.length;
}

export async function batchPinNotes(noteIds: string[]): Promise<number> {
  const notes = await getAllNotes();
  let count = 0;
  const toUpdate: NotebookNoteRecord[] = [];

  for (const note of notes) {
    if (noteIds.includes(note.id) && !note.isPinned) {
      toUpdate.push({ ...note, isPinned: true, updatedAt: Date.now(), notebookId: note.notebookId || 'default' });
      count++;
    }
  }

  if (toUpdate.length > 0) await putNotes(toUpdate);
  if (toUpdate.length > 0) debouncedSyncNotebookToServer();
  return count;
}

export async function batchUnpinNotes(noteIds: string[]): Promise<number> {
  const notes = await getAllNotes();
  let count = 0;
  const toUpdate: NotebookNoteRecord[] = [];

  for (const note of notes) {
    if (noteIds.includes(note.id) && note.isPinned) {
      toUpdate.push({ ...note, isPinned: false, updatedAt: Date.now(), notebookId: note.notebookId || 'default' });
      count++;
    }
  }

  if (toUpdate.length > 0) await putNotes(toUpdate);
  if (toUpdate.length > 0) debouncedSyncNotebookToServer();
  return count;
}

// Export/Import
export interface NotebookExport {
  version: string;
  exportDate: string;
  notebooks: Notebook[];
  notes: NotebookNote[];
  settings: NotebookSettings;
}

export async function exportAllNotes(): Promise<NotebookExport> {
  return {
    version: '2.0',
    exportDate: new Date().toISOString(),
    notebooks: await listNotebooks(),
    notes: await readNotebookNotes(),
    settings: await readNotebookSettings(),
  };
}

export async function importNotes(exportData: NotebookExport): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (!exportData.notes || !Array.isArray(exportData.notes)) {
    errors.push('Invalid export data format');
    return { imported: 0, skipped: 0, errors };
  }

  const existingNotes = await getAllNotes();
  const existingIds = new Set(existingNotes.map((n) => n.id));

  // 导入笔记本
  if (exportData.notebooks && Array.isArray(exportData.notebooks)) {
    const existingBooks = await getAllBooks();
    const existingBookIds = new Set(existingBooks.map(b => b.id));
    for (const notebook of exportData.notebooks) {
      if (!existingBookIds.has(notebook.id)) {
        await putBook({
          id: notebook.id,
          name: notebook.name,
          description: notebook.description,
          color: notebook.color,
          icon: notebook.icon,
          createdAt: notebook.createdAt,
          updatedAt: notebook.updatedAt,
          recordCount: notebook.recordCount,
        });
      }
    }
  }

  for (const note of exportData.notes) {
    if (!isNotebookNote(note)) {
      errors.push(`Invalid note: ${(note as Partial<NotebookNote>).title || 'unknown'}`);
      skipped++;
      continue;
    }

    // If note with same ID exists, create new ID
    if (existingIds.has(note.id)) {
      note.id = createNoteId();
    }

    await upsertNotebookNote(note);
    imported++;
  }

  debouncedSyncNotebookToServer();
  return { imported, skipped, errors };
}

// Search with highlighting
export interface SearchResult {
  note: NotebookNote;
  matches: Array<{
    field: 'title' | 'content' | 'tags' | 'summary';
    snippet: string;
    indices: Array<[number, number]>;
  }>;
}

export function searchNotesWithHighlight(
  notes: NotebookNote[],
  query: string,
): SearchResult[] {
  if (!query.trim()) return [];

  const lowerQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  notes.forEach((note) => {
    const matches: SearchResult['matches'] = [];

    // Check title
    const titleLower = note.title.toLowerCase();
    if (titleLower.includes(lowerQuery)) {
      const indices = findAllIndices(titleLower, lowerQuery);
      matches.push({
        field: 'title',
        snippet: note.title,
        indices,
      });
    }

    // Check summary
    if (note.summary) {
      const summaryLower = note.summary.toLowerCase();
      if (summaryLower.includes(lowerQuery)) {
        const indices = findAllIndices(summaryLower, lowerQuery);
        matches.push({
          field: 'summary',
          snippet: note.summary,
          indices,
        });
      }
    }

    // Check content
    const contentLower = note.content.toLowerCase();
    if (contentLower.includes(lowerQuery)) {
      const indices = findAllIndices(contentLower, lowerQuery);
      // Get snippet around first match
      const firstMatch = indices[0];
      if (firstMatch) {
        const start = Math.max(0, firstMatch[0] - 50);
        const end = Math.min(note.content.length, firstMatch[1] + 50);
        let snippet = note.content.slice(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < note.content.length) snippet = snippet + '...';

        matches.push({
          field: 'content',
          snippet,
          indices: findAllIndices(snippet.toLowerCase(), lowerQuery),
        });
      }
    }

    // Check tags
    const matchingTags = note.tags.filter((t) => t.toLowerCase().includes(lowerQuery));
    if (matchingTags.length > 0) {
      matches.push({
        field: 'tags',
        snippet: matchingTags.join(', '),
        indices: findAllIndices(matchingTags.join(', ').toLowerCase(), lowerQuery),
      });
    }

    if (matches.length > 0) {
      results.push({ note, matches });
    }
  });

  return results;
}

function findAllIndices(text: string, query: string): Array<[number, number]> {
  const indices: Array<[number, number]> = [];
  let pos = 0;

  while ((pos = text.indexOf(query, pos)) !== -1) {
    indices.push([pos, pos + query.length]);
    pos += query.length;
  }

  return indices;
}

// 获取笔记类型标签
export function getNoteTypeLabel(type: NotebookNoteType): string {
  const labels: Record<NotebookNoteType, string> = {
    manual: '手动',
    chat: '聊天',
    solve: '解题',
    research: '研究',
    classroom: '课堂',
    quiz: '测验',
  };
  return labels[type] || '其他';
}

export function getNoteTypeColor(type: NotebookNoteType): string {
  const colors: Record<NotebookNoteType, string> = {
    manual: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    chat: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    solve: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    research: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
    classroom: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    quiz: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return colors[type] || colors.manual;
}
