import type {
  NotebookBookRecord,
  NotebookNoteRecord,
  NotebookSettingsRecord,
} from '@/lib/utils/database';
import {
  loadNotebookSnapshot,
  saveNotebookSnapshot,
  type PersistedNotebookSnapshot,
} from '@/lib/server/notebook-storage';

export interface ServerNotebook {
  notebook: NotebookBookRecord;
  records: NotebookNoteRecord[];
  settings: NotebookSettingsRecord | null;
}

export interface CreateNotebookInput {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
}

export interface AddNotebookRecordInput {
  id?: string;
  notebookId?: string;
  type?: string;
  title: string;
  content: string;
  summary?: string;
  userQuery?: string;
  output?: string;
  tags?: string[];
  subject?: string;
  source?: string;
  stageId?: string;
  sceneId?: string;
  isPinned?: boolean;
  isFavorite?: boolean;
  metadata?: Record<string, unknown>;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function now(): number {
  return Date.now();
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function ensureDefaultNotebook(snapshot: PersistedNotebookSnapshot): PersistedNotebookSnapshot {
  if (snapshot.books.length > 0) return snapshot;

  const recordCount = snapshot.notes.filter((note) => (note.notebookId || 'default') === 'default').length;
  return {
    ...snapshot,
    books: [
      {
        id: 'default',
        name: 'Default',
        description: '',
        color: '#3B82F6',
        icon: 'book',
        createdAt: snapshot.updatedAt || now(),
        updatedAt: snapshot.updatedAt || now(),
        recordCount,
      },
    ],
  };
}

function recalculateBookCounts(snapshot: PersistedNotebookSnapshot): PersistedNotebookSnapshot {
  const notesByBook = new Map<string, number>();
  for (const note of snapshot.notes) {
    const notebookId = note.notebookId || 'default';
    notesByBook.set(notebookId, (notesByBook.get(notebookId) || 0) + 1);
  }

  return {
    ...snapshot,
    books: snapshot.books.map((book) => ({
      ...book,
      recordCount: notesByBook.get(book.id) || 0,
    })),
  };
}

function normalizeRecord(input: AddNotebookRecordInput, notebookId: string): NotebookNoteRecord {
  const timestamp = now();
  return {
    id: input.id || createId('note'),
    notebookId,
    type: input.type || 'manual',
    title: input.title.trim() || '未命名笔记',
    content: input.content,
    summary: input.summary,
    userQuery: input.userQuery,
    output: input.output,
    tags: normalizeTags(input.tags),
    subject: input.subject?.trim() || '综合',
    source: input.source || 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    stageId: input.stageId,
    sceneId: input.sceneId,
    isPinned: input.isPinned,
    isFavorite: input.isFavorite,
    metadata: input.metadata,
  };
}

async function loadUserSnapshot(userId: string): Promise<PersistedNotebookSnapshot> {
  return ensureDefaultNotebook(await loadNotebookSnapshot(userId));
}

async function saveUserSnapshot(
  userId: string,
  snapshot: PersistedNotebookSnapshot,
): Promise<PersistedNotebookSnapshot> {
  return saveNotebookSnapshot(recalculateBookCounts({ ...snapshot, updatedAt: now() }), userId);
}

export async function listServerNotebooks(userId: string): Promise<NotebookBookRecord[]> {
  const snapshot = await loadUserSnapshot(userId);
  return recalculateBookCounts(snapshot).books;
}

export async function createServerNotebook(
  userId: string,
  input: CreateNotebookInput,
): Promise<NotebookBookRecord> {
  const snapshot = await loadUserSnapshot(userId);
  const id = input.id?.trim() || createId('notebook');
  const existing = snapshot.books.find((book) => book.id === id);
  if (existing) return existing;

  const timestamp = now();
  const notebook: NotebookBookRecord = {
    id,
    name: input.name.trim() || '未命名笔记本',
    description: input.description || '',
    color: input.color || '#3B82F6',
    icon: input.icon || 'book',
    createdAt: timestamp,
    updatedAt: timestamp,
    recordCount: 0,
  };

  await saveUserSnapshot(userId, {
    ...snapshot,
    books: [...snapshot.books, notebook],
  });
  return notebook;
}

export async function loadServerNotebook(
  userId: string,
  notebookId: string,
): Promise<ServerNotebook | null> {
  const snapshot = await loadUserSnapshot(userId);
  const notebook = snapshot.books.find((book) => book.id === notebookId);
  if (!notebook) return null;

  return {
    notebook,
    records: snapshot.notes.filter((note) => (note.notebookId || 'default') === notebookId),
    settings: snapshot.settings,
  };
}

export async function deleteServerNotebook(userId: string, notebookId: string): Promise<boolean> {
  if (notebookId === 'default') return false;

  const snapshot = await loadUserSnapshot(userId);
  const nextBooks = snapshot.books.filter((book) => book.id !== notebookId);
  if (nextBooks.length === snapshot.books.length) return false;

  await saveUserSnapshot(userId, {
    ...snapshot,
    books: nextBooks,
    notes: snapshot.notes.map((note) =>
      (note.notebookId || 'default') === notebookId ? { ...note, notebookId: 'default' } : note,
    ),
    settings:
      snapshot.settings?.activeNotebookId === notebookId
        ? { ...snapshot.settings, activeNotebookId: 'default' }
        : snapshot.settings,
  });

  return true;
}

export async function addServerNotebookRecord(
  userId: string,
  notebookId: string,
  input: AddNotebookRecordInput,
): Promise<NotebookNoteRecord> {
  let snapshot = await loadUserSnapshot(userId);
  if (!snapshot.books.some((book) => book.id === notebookId)) {
    await createServerNotebook(userId, { id: notebookId, name: notebookId === 'default' ? 'Default' : notebookId });
    snapshot = await loadUserSnapshot(userId);
  }

  const record = normalizeRecord({ ...input, notebookId }, notebookId);
  const existingIndex = snapshot.notes.findIndex((note) => note.id === record.id);
  const notes =
    existingIndex >= 0
      ? snapshot.notes.map((note, index) =>
          index === existingIndex ? { ...note, ...record, createdAt: note.createdAt } : note,
        )
      : [...snapshot.notes, record];

  await saveUserSnapshot(userId, {
    ...snapshot,
    notes,
    books: snapshot.books.map((book) =>
      book.id === notebookId ? { ...book, updatedAt: record.updatedAt } : book,
    ),
  });

  return record;
}

export async function listServerNotebookRecords(
  userId: string,
  options: { notebookId?: string; recordIds?: string[]; limit?: number } = {},
): Promise<NotebookNoteRecord[]> {
  const snapshot = await loadUserSnapshot(userId);
  const ids = options.recordIds ? new Set(options.recordIds) : null;
  const records = snapshot.notes
    .filter((note) => !options.notebookId || (note.notebookId || 'default') === options.notebookId)
    .filter((note) => !ids || ids.has(note.id))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return records.slice(0, options.limit || 50);
}
