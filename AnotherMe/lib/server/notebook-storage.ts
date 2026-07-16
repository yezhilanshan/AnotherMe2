/**
 * Server-side notebook snapshot storage.
 *
 * This is a JSON backup target for the client IndexedDB notebook. It is not a
 * conflict-resolution service; the client uploads complete snapshots and can
 * restore from this file when local IndexedDB is empty.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  NotebookBookRecord,
  NotebookNoteRecord,
  NotebookSettingsRecord,
  NotebookTrashRecord,
} from '@/lib/utils/database';
import { getRuntimeDataDir } from './runtime-data-dir';

const NOTEBOOK_DIR = getRuntimeDataDir('notebooks');
const NOTEBOOK_FILE = path.join(NOTEBOOK_DIR, 'default.json');

export interface PersistedNotebookSnapshot {
  version: 1;
  updatedAt: number;
  notes: NotebookNoteRecord[];
  trash: NotebookTrashRecord[];
  books: NotebookBookRecord[];
  settings: NotebookSettingsRecord | null;
}

export function createEmptyNotebookSnapshot(): PersistedNotebookSnapshot {
  return {
    version: 1,
    updatedAt: 0,
    notes: [],
    trash: [],
    books: [],
    settings: null,
  };
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'default') return 'default';
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default';
}

function snapshotFilePath(userId?: string | null): string {
  const safeUserId = safeSegment(userId || 'default');
  if (safeUserId === 'default') {
    return NOTEBOOK_FILE;
  }
  return path.join(NOTEBOOK_DIR, safeUserId, 'snapshot.json');
}

async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tempFilePath, filePath);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function normalizeNotebookSnapshot(value: unknown): PersistedNotebookSnapshot {
  if (!value || typeof value !== 'object') {
    return createEmptyNotebookSnapshot();
  }

  const raw = value as Partial<PersistedNotebookSnapshot>;
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    notes: asArray<NotebookNoteRecord>(raw.notes),
    trash: asArray<NotebookTrashRecord>(raw.trash),
    books: asArray<NotebookBookRecord>(raw.books),
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : null,
  };
}

export async function loadNotebookSnapshot(userId?: string | null): Promise<PersistedNotebookSnapshot> {
  try {
    const filePath = snapshotFilePath(userId);
    const content = await fs.readFile(filePath, 'utf-8');
    return normalizeNotebookSnapshot(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (userId && safeSegment(userId) !== 'default') {
    try {
      const content = await fs.readFile(NOTEBOOK_FILE, 'utf-8');
      return normalizeNotebookSnapshot(JSON.parse(content));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return createEmptyNotebookSnapshot();
}

export async function loadDefaultNotebookSnapshot(): Promise<PersistedNotebookSnapshot> {
  try {
    const content = await fs.readFile(NOTEBOOK_FILE, 'utf-8');
    return normalizeNotebookSnapshot(JSON.parse(content));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return createEmptyNotebookSnapshot();
    }
    throw error;
  }
}

export async function saveNotebookSnapshot(
  snapshot: PersistedNotebookSnapshot,
  userId?: string | null,
): Promise<PersistedNotebookSnapshot> {
  const next = normalizeNotebookSnapshot({
    ...snapshot,
    updatedAt: snapshot.updatedAt || Date.now(),
  });
  await writeJsonFileAtomic(snapshotFilePath(userId), next);
  return next;
}
