/**
 * Offline Queue — buffers actions when offline, replays when back online.
 * Persists to AsyncStorage so queued actions survive app restarts.
 *
 * Usage:
 *   import { offlineQueue } from '../lib/offline-queue';
 *
 *   // Initialize on app startup (restores persisted queue)
 *   await offlineQueue.init();
 *
 *   // Queue an action when offline
 *   offlineQueue.enqueue({
 *     type: 'send_message',
 *     payload: { sessionId: '...', text: 'hello' },
 *   });
 *
 *   // Flush when network recovers (called automatically by useAutoFlush)
 *   await offlineQueue.flush(executeFn);
 */

import { getSafeStorage } from './safeStorage';

export interface QueuedAction {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
  retries: number;
}

type ExecuteFn = (action: QueuedAction) => Promise<void>;

const MAX_RETRIES = 3;
const STORAGE_KEY = '@anotherme/offline-queue';

const storage = getSafeStorage();
let queue: QueuedAction[] = [];
let initialized = false;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function persistQueue(): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Best-effort persistence; in-memory queue still works
  }
}

export const offlineQueue = {
  /**
   * Initialize the queue by restoring persisted actions from storage.
   * Call once on app startup.
   */
  async init(): Promise<void> {
    if (initialized) return;
    initialized = true;
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          queue = parsed.filter(
            (item: unknown): item is QueuedAction =>
              typeof item === 'object' &&
              item !== null &&
              'id' in item &&
              'type' in item &&
              'payload' in item &&
              'createdAt' in item &&
              'retries' in item,
          );
        }
      }
    } catch {
      // Corrupted data; start fresh
      queue = [];
    }
  },

  /**
   * Add an action to the queue. Persists to storage immediately.
   */
  enqueue(action: { type: string; payload: unknown }): QueuedAction {
    const queued: QueuedAction = {
      id: generateId(),
      type: action.type,
      payload: action.payload,
      createdAt: Date.now(),
      retries: 0,
    };
    queue.push(queued);
    void persistQueue();
    return queued;
  },

  /**
   * Flush all queued actions by executing them in order.
   * Failed actions are retried up to MAX_RETRIES times, then dropped.
   */
  async flush(execute: ExecuteFn): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;

    const toProcess = [...queue];
    queue = [];

    for (const action of toProcess) {
      try {
        await execute(action);
        succeeded++;
      } catch {
        action.retries++;
        if (action.retries < MAX_RETRIES) {
          queue.push(action); // Re-queue for retry
        } else {
          failed++; // Drop after max retries
        }
      }
    }

    await persistQueue();
    return { succeeded, failed };
  },

  /**
   * Get current queue length.
   */
  get length(): number {
    return queue.length;
  },

  /**
   * Get all queued actions (for debugging).
   */
  getAll(): QueuedAction[] {
    return [...queue];
  },

  /**
   * Check if queue has pending actions.
   */
  get isEmpty(): boolean {
    return queue.length === 0;
  },

  /**
   * Clear the queue and persisted storage.
   */
  async clear(): Promise<void> {
    queue = [];
    await persistQueue();
  },
};
