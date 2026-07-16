/**
 * Notebook IndexedDB Adapter
 *
 * Provides the same CRUD operations as the localStorage-based storage
 * but backed by IndexedDB (Dexie). Includes transparent migration
 * from localStorage on first access.
 */

import { db } from '@/lib/utils/database';
import type {
  NotebookNoteRecord,
  NotebookTrashRecord,
  NotebookBookRecord,
  NotebookSettingsRecord,
} from '@/lib/utils/database';

// ── Migration from localStorage ────────────────────────────────────

const LS_NOTES_KEY = 'anotherme:notebook:items:v2';
const LS_TRASH_KEY = 'anotherme:notebook:trash:v1';
const LS_SETTINGS_KEY = 'anotherme:notebook:settings:v1';
const LS_MANAGER_KEY = 'anotherme:notebook:manager:v1';
const LS_LEGACY_V1_KEY = 'anotherme:notebook:items:v1';
const LS_LEGACY_WORKSPACE_KEY = 'workspace:notebook:items';

let migrated = false;

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function migrateFromLocalStorage(): Promise<void> {
  if (migrated) return;
  migrated = true;

  // Check if IndexedDB already has data
  const existingCount = await db.notebookNotes.count();
  if (existingCount > 0) return; // Already migrated

  // Try to read from localStorage
  if (typeof window === 'undefined') return;

  const rawNotes = localStorage.getItem(LS_NOTES_KEY);
  const notes = safeJsonParse<NotebookNoteRecord[]>(rawNotes);
  if (Array.isArray(notes) && notes.length > 0) {
    await db.notebookNotes.bulkPut(notes);
  }

  const rawTrash = localStorage.getItem(LS_TRASH_KEY);
  const trash = safeJsonParse<NotebookTrashRecord[]>(rawTrash);
  if (Array.isArray(trash) && trash.length > 0) {
    await db.notebookTrash.bulkPut(trash);
  }

  const rawSettings = localStorage.getItem(LS_SETTINGS_KEY);
  const settings = safeJsonParse<Record<string, unknown>>(rawSettings);
  if (settings) {
    await db.notebookSettings.put({
      id: 'default',
      sortBy: (settings.sortBy as string) || 'updatedAt',
      sortOrder: (settings.sortOrder as string) || 'desc',
      viewMode: (settings.viewMode as string) || 'grid',
      activeNotebookId: null,
    });
  }

  const rawManager = localStorage.getItem(LS_MANAGER_KEY);
  const manager = safeJsonParse<{ notebooks?: NotebookBookRecord[]; activeNotebookId?: string | null }>(rawManager);
  if (manager?.notebooks && Array.isArray(manager.notebooks)) {
    await db.notebookBooks.bulkPut(manager.notebooks);
    if (manager.activeNotebookId) {
      const settingsRecord = await db.notebookSettings.get('default');
      if (settingsRecord) {
        settingsRecord.activeNotebookId = manager.activeNotebookId;
        await db.notebookSettings.put(settingsRecord);
      }
    }
  }

  // Also try legacy keys
  if (!notes || notes.length === 0) {
    const legacyV1 = safeJsonParse<NotebookNoteRecord[]>(localStorage.getItem(LS_LEGACY_V1_KEY));
    if (Array.isArray(legacyV1) && legacyV1.length > 0) {
      await db.notebookNotes.bulkPut(legacyV1);
    } else {
      const legacyWorkspace = safeJsonParse<NotebookNoteRecord[]>(localStorage.getItem(LS_LEGACY_WORKSPACE_KEY));
      if (Array.isArray(legacyWorkspace) && legacyWorkspace.length > 0) {
        await db.notebookNotes.bulkPut(legacyWorkspace);
      }
    }
  }

  console.log('[notebook-db] Migrated data from localStorage to IndexedDB');
}

// ── Notes CRUD ─────────────────────────────────────────────────────

export async function getAllNotes(): Promise<NotebookNoteRecord[]> {
  await migrateFromLocalStorage();
  return db.notebookNotes.orderBy('updatedAt').reverse().toArray();
}

export async function getNotesByNotebook(notebookId: string): Promise<NotebookNoteRecord[]> {
  await migrateFromLocalStorage();
  return db.notebookNotes
    .where('notebookId')
    .equals(notebookId)
    .reverse()
    .sortBy('updatedAt');
}

export async function getNote(id: string): Promise<NotebookNoteRecord | undefined> {
  await migrateFromLocalStorage();
  return db.notebookNotes.get(id);
}

export async function putNote(note: NotebookNoteRecord): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookNotes.put(note);
}

export async function putNotes(notes: NotebookNoteRecord[]): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookNotes.bulkPut(notes);
}

export async function deleteNote(id: string): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookNotes.delete(id);
}

export async function deleteNotes(ids: string[]): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookNotes.bulkDelete(ids);
}

// ── Trash CRUD ─────────────────────────────────────────────────────

export async function getAllTrash(): Promise<NotebookTrashRecord[]> {
  await migrateFromLocalStorage();
  return db.notebookTrash.orderBy('deletedAt').reverse().toArray();
}

export async function putTrashNote(note: NotebookTrashRecord): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookTrash.put(note);
}

export async function deleteTrashNote(id: string): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookTrash.delete(id);
}

export async function clearTrash(): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookTrash.clear();
}

// ── Books CRUD ─────────────────────────────────────────────────────

export async function getAllBooks(): Promise<NotebookBookRecord[]> {
  await migrateFromLocalStorage();
  return db.notebookBooks.orderBy('updatedAt').reverse().toArray();
}

export async function getBook(id: string): Promise<NotebookBookRecord | undefined> {
  await migrateFromLocalStorage();
  return db.notebookBooks.get(id);
}

export async function putBook(book: NotebookBookRecord): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookBooks.put(book);
}

export async function deleteBook(id: string): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookBooks.delete(id);
}

// ── Settings ───────────────────────────────────────────────────────

export async function getSettings(): Promise<NotebookSettingsRecord | undefined> {
  await migrateFromLocalStorage();
  return db.notebookSettings.get('default');
}

export async function putSettings(settings: NotebookSettingsRecord): Promise<void> {
  await migrateFromLocalStorage();
  await db.notebookSettings.put(settings);
}

// ── Utilities ──────────────────────────────────────────────────────

export async function countNotes(): Promise<number> {
  await migrateFromLocalStorage();
  return db.notebookNotes.count();
}

export async function searchNotes(query: string): Promise<NotebookNoteRecord[]> {
  await migrateFromLocalStorage();
  const lowerQuery = query.toLowerCase();
  const all = await db.notebookNotes.toArray();
  return all.filter(
    (n) =>
      n.title.toLowerCase().includes(lowerQuery) ||
      n.content.toLowerCase().includes(lowerQuery) ||
      (n.tags && n.tags.some((t) => t.toLowerCase().includes(lowerQuery))),
  );
}
