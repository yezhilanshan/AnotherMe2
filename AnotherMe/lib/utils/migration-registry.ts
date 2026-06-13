/**
 * Unified Migration Registry
 *
 * Consolidates all data migration logic into a single registry that runs
 * on app startup. Each migration has:
 *   - id: unique identifier
 *   - version: semver-like version string
 *   - description: human-readable description
 *   - run(): the migration function
 *   - once: if true, only runs once per browser (tracked in localStorage)
 *
 * Migrations run in version order. Already-completed migrations are skipped.
 *
 * Usage:
 *   import { runAllMigrations } from '@/lib/utils/migration-registry';
 *   await runAllMigrations(); // Call on app startup
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('MigrationRegistry');

const MIGRATION_STATE_KEY = 'anotherme:migrations:state';

interface MigrationState {
  completed: Record<string, string>; // migration id -> completed version
}

interface Migration {
  id: string;
  version: string;
  description: string;
  once: boolean;
  run: () => Promise<void>;
}

const migrations: Migration[] = [];

/**
 * Register a migration.
 */
export function registerMigration(migration: Migration): void {
  migrations.push(migration);
}

/**
 * Get the state of completed migrations from localStorage.
 */
function getMigrationState(): MigrationState {
  if (typeof window === 'undefined') return { completed: {} };
  try {
    const raw = localStorage.getItem(MIGRATION_STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.completed === 'object') return parsed;
    }
  } catch { /* corrupted */ }
  return { completed: {} };
}

/**
 * Save migration state to localStorage.
 */
function saveMigrationState(state: MigrationState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MIGRATION_STATE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded, ignore */ }
}

/**
 * Run all pending migrations in version order.
 */
export async function runAllMigrations(): Promise<{
  ran: number;
  skipped: number;
  errors: Array<{ id: string; error: string }>;
}> {
  const state = getMigrationState();
  const sorted = [...migrations].sort((a, b) => a.version.localeCompare(b.version));

  let ran = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const migration of sorted) {
    // Skip if already completed at this version
    if (migration.once && state.completed[migration.id] === migration.version) {
      skipped++;
      continue;
    }

    try {
      log.info(`Running migration: ${migration.id} v${migration.version} — ${migration.description}`);
      await migration.run();
      state.completed[migration.id] = migration.version;
      saveMigrationState(state);
      ran++;
      log.info(`Migration completed: ${migration.id} v${migration.version}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.error(`Migration failed: ${migration.id} v${migration.version}: ${errorMsg}`);
      errors.push({ id: migration.id, error: errorMsg });
      // Continue with other migrations even if one fails
    }
  }

  if (ran > 0 || errors.length > 0) {
    log.info(`Migrations complete: ${ran} ran, ${skipped} skipped, ${errors.length} errors`);
  }

  return { ran, skipped, errors };
}

/**
 * Reset migration state (for debugging/testing).
 */
export function resetMigrationState(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(MIGRATION_STATE_KEY);
}

/**
 * Get list of registered migrations and their status.
 */
export function getMigrationStatus(): Array<Migration & { completed: boolean }> {
  const state = getMigrationState();
  return migrations.map((m) => ({
    ...m,
    completed: state.completed[m.id] === m.version,
  }));
}

// ── Built-in Migrations ────────────────────────────────────────────

import { migrateFromOldStorage } from '@/lib/store/settings/legacy-migration';

// 1. Legacy settings migration (old localStorage keys -> settings-storage)
registerMigration({
  id: 'legacy-settings',
  version: '1.0.0',
  description: 'Migrate old localStorage settings keys to new format',
  once: true,
  async run() {
    const migrated = migrateFromOldStorage();
    if (migrated) {
      log.info('Legacy settings migrated successfully');
    }
  },
});

// 2. Notebook localStorage -> IndexedDB migration
// (Handled automatically by notebook-db.ts on first access, registered for tracking)
registerMigration({
  id: 'notebook-to-indexeddb',
  version: '1.0.0',
  description: 'Migrate notebook data from localStorage to IndexedDB',
  once: true,
  async run() {
    // The actual migration happens lazily in notebook-db.ts when first accessed.
    // This registration is for tracking/visibility only.
    // We trigger it by importing and calling a lightweight check.
    try {
      const { countNotes } = await import('@/lib/notebook/notebook-db');
      const count = await countNotes();
      log.info(`Notebook IndexedDB has ${count} notes`);
    } catch {
      // notebook-db migration will happen on first actual use
    }
  },
});

// 3. Stage schema migration (v0 -> v1)
// (Applied lazily in stage-storage.ts loadStageData, registered for tracking)
registerMigration({
  id: 'stage-schema-v1',
  version: '1.0.0',
  description: 'Add schemaVersion field to stages and slides',
  once: true,
  async run() {
    // Schema migration is applied lazily in loadStageData via migrateStage().
    // This registration ensures it's tracked in the migration state.
    log.info('Stage schema migration is applied on load');
  },
});
