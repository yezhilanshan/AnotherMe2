import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { getRuntimeDataDir } from '@/lib/server/runtime-data-dir';

const DATA_DIR = getRuntimeDataDir();
const DB_FILE = path.join(DATA_DIR, 'live-books.sqlite');

const WASM_CANDIDATES = [
  path.join(process.cwd(), 'public', 'sql-wasm.wasm'),
  path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
];

let resolvedWasmPath: string | null = null;

async function resolveWasmFile(): Promise<string> {
  if (resolvedWasmPath) return resolvedWasmPath;
  for (const candidate of WASM_CANDIDATES) {
    try {
      await fs.access(candidate);
      resolvedWasmPath = candidate;
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(`sql-wasm.wasm not found in any of: ${WASM_CANDIDATES.join(', ')}`);
}

let sqlRuntimePromise: Promise<SqlJsStatic> | null = null;
let dbPromise: Promise<Database> | null = null;
let persistQueue = Promise.resolve();

function getSqlRuntime(): Promise<SqlJsStatic> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = resolveWasmFile().then((wasmPath) =>
      initSqlJs({
        locateFile: () => wasmPath,
      }),
    );
  }
  return sqlRuntimePromise;
}

function initializeSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS live_books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      topic TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local-user',
      language TEXT NOT NULL,
      target_level TEXT NOT NULL,
      status TEXT NOT NULL,
      proposal_title TEXT NOT NULL,
      proposal_description TEXT NOT NULL,
      proposal_scope TEXT NOT NULL,
      proposal_target_level TEXT NOT NULL,
      proposal_estimated_chapters INTEGER NOT NULL,
      proposal_rationale TEXT NOT NULL,
      progress_current_page_id TEXT,
      progress_visited_page_ids TEXT NOT NULL DEFAULT '[]',
      progress_bookmarked_page_ids TEXT NOT NULL DEFAULT '[]',
      progress_quiz_attempts TEXT NOT NULL DEFAULT '[]',
      progress_weak_chapter_ids TEXT NOT NULL DEFAULT '[]',
      progress_score INTEGER NOT NULL DEFAULT 0,
      progress_updated_at INTEGER NOT NULL DEFAULT 0,
      quality_compile_total INTEGER NOT NULL DEFAULT 0,
      quality_compile_failed INTEGER NOT NULL DEFAULT 0,
      quality_block_errors INTEGER NOT NULL DEFAULT 0,
      quality_supplement_hits INTEGER NOT NULL DEFAULT 0,
      concept_graph_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_live_books_user_id ON live_books(user_id);

    CREATE TABLE IF NOT EXISTS live_book_chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      learning_objectives_json TEXT NOT NULL DEFAULT '[]',
      content_type TEXT NOT NULL DEFAULT 'mixed',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      prerequisites_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON live_book_chapters(book_id);

    CREATE TABLE IF NOT EXISTS live_book_spines (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      goal TEXT NOT NULL,
      difficulty TEXT NOT NULL DEFAULT 'medium',
      learning_objectives_json TEXT NOT NULL DEFAULT '[]',
      content_type TEXT NOT NULL DEFAULT 'mixed',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      prerequisites_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_spines_book_id ON live_book_spines(book_id);
    CREATE INDEX IF NOT EXISTS idx_spines_chapter_id ON live_book_spines(chapter_id);

    CREATE TABLE IF NOT EXISTS live_book_pages (
      id TEXT PRIMARY KEY,
      page_id TEXT,
      book_id TEXT NOT NULL,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES live_book_chapters(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pages_book_id ON live_book_pages(book_id);
    CREATE INDEX IF NOT EXISTS idx_pages_chapter_id ON live_book_pages(chapter_id);

    CREATE TABLE IF NOT EXISTS live_book_blocks (
      id TEXT PRIMARY KEY,
      block_id TEXT,
      book_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      params_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      block_error TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE,
      FOREIGN KEY (page_id) REFERENCES live_book_pages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_blocks_page_id ON live_book_blocks(page_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_book_id ON live_book_blocks(book_id);

    CREATE TABLE IF NOT EXISTS live_book_progress (
      book_id TEXT PRIMARY KEY,
      current_page_id TEXT,
      visited_pages TEXT NOT NULL DEFAULT '[]',
      bookmarks TEXT NOT NULL DEFAULT '[]',
      weak_points TEXT NOT NULL DEFAULT '[]',
      weak_chapter_ids TEXT NOT NULL DEFAULT '[]',
      score INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS live_book_jobs (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_book_id ON live_book_jobs(book_id);

    CREATE TABLE IF NOT EXISTS live_book_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      type TEXT NOT NULL,
      stage TEXT NOT NULL,
      message TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (job_id) REFERENCES live_book_jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_job_events_job_id ON live_book_job_events(job_id);

    CREATE TABLE IF NOT EXISTS live_book_quiz_attempts (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      page_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      user_answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quiz_attempts_book_id ON live_book_quiz_attempts(book_id);

    CREATE TABLE IF NOT EXISTS live_book_explorations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_id TEXT,
      topic TEXT NOT NULL,
      report_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_live_book_explorations_book_id ON live_book_explorations(book_id);
    CREATE INDEX IF NOT EXISTS idx_live_book_explorations_chapter_id ON live_book_explorations(chapter_id);
  `);

  migrateSchema(db);
}

const VALID_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertValidIdentifier(name: string, context: string): void {
  if (!VALID_IDENTIFIER_RE.test(name)) {
    throw new Error(`Invalid SQL identifier for ${context}: "${name}"`);
  }
}

function tableColumns(db: Database, tableName: string): Set<string> {
  assertValidIdentifier(tableName, 'tableName');
  const result = db.exec(`PRAGMA table_info(${tableName})`);
  if (result.length === 0) return new Set();
  const nameIndex = result[0].columns.indexOf('name');
  return new Set(result[0].values.map((row) => String(row[nameIndex])));
}

function addColumnIfMissing(db: Database, tableName: string, columnName: string, definition: string): void {
  assertValidIdentifier(tableName, 'tableName');
  assertValidIdentifier(columnName, 'columnName');
  const columns = tableColumns(db, tableName);
  if (columns.has(columnName)) return;
  db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function migrateSchema(db: Database): void {
  addColumnIfMissing(db, 'live_books', 'user_id', "TEXT NOT NULL DEFAULT 'local-user'");
  addColumnIfMissing(db, 'live_books', 'concept_graph_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, 'live_book_pages', 'page_id', 'TEXT');
  addColumnIfMissing(db, 'live_book_blocks', 'block_id', 'TEXT');
  addColumnIfMissing(db, 'live_book_blocks', 'payload_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, 'live_book_blocks', 'source_refs_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_blocks', 'params_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, 'live_book_blocks', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  addColumnIfMissing(db, 'live_book_blocks', 'block_error', 'TEXT');
  addColumnIfMissing(db, 'live_book_chapters', 'learning_objectives_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_chapters', 'content_type', "TEXT NOT NULL DEFAULT 'mixed'");
  addColumnIfMissing(db, 'live_book_chapters', 'source_refs_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_chapters', 'prerequisites_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_chapters', 'summary', "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, 'live_book_spines', 'learning_objectives_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_spines', 'content_type', "TEXT NOT NULL DEFAULT 'mixed'");
  addColumnIfMissing(db, 'live_book_spines', 'source_refs_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_spines', 'prerequisites_json', "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, 'live_book_spines', 'summary', "TEXT NOT NULL DEFAULT ''");

  db.run(`UPDATE live_book_pages SET page_id = id WHERE page_id IS NULL OR page_id = ''`);
  db.run(`UPDATE live_book_blocks SET block_id = id WHERE block_id IS NULL OR block_id = ''`);
  db.run(`
    INSERT OR IGNORE INTO live_book_spines (
      id, book_id, chapter_id, sort_order, title, goal, difficulty,
      learning_objectives_json, content_type, source_refs_json, prerequisites_json, summary,
      created_at, updated_at
    )
    SELECT
      id,
      book_id,
      id,
      sort_order,
      title,
      goal,
      'medium',
      COALESCE(learning_objectives_json, '[]'),
      COALESCE(content_type, 'mixed'),
      COALESCE(source_refs_json, '[]'),
      COALESCE(prerequisites_json, '[]'),
      COALESCE(summary, ''),
      created_at,
      updated_at
    FROM live_book_chapters
  `);
  db.run(`
    INSERT OR IGNORE INTO live_book_progress (
      book_id, current_page_id, visited_pages, bookmarks, weak_points, weak_chapter_ids, score, updated_at
    )
    SELECT
      id,
      progress_current_page_id,
      progress_visited_page_ids,
      progress_bookmarked_page_ids,
      progress_weak_chapter_ids,
      progress_weak_chapter_ids,
      progress_score,
      progress_updated_at
    FROM live_books
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS live_book_explorations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_id TEXT,
      topic TEXT NOT NULL,
      report_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (book_id) REFERENCES live_books(id) ON DELETE CASCADE
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_live_book_explorations_book_id ON live_book_explorations(book_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_live_book_explorations_chapter_id ON live_book_explorations(chapter_id)`);

  db.run(`
    UPDATE live_book_blocks
    SET
      params_json = CASE
        WHEN COALESCE(params_json, '') = '' THEN COALESCE(payload_json, '{}')
        ELSE params_json
      END,
      metadata_json = CASE
        WHEN COALESCE(metadata_json, '') = '' THEN '{}'
        ELSE metadata_json
      END
  `);
}

async function loadDatabase(): Promise<Database> {
  const SQL = await getSqlRuntime();

  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('[live-book-db] Failed to create data directory:', DATA_DIR, error);
    // Continue anyway — in-memory DB will be used as fallback
  }

  let db: Database;
  let usingPersistedDb = false;
  try {
    const content = await fs.readFile(DB_FILE);
    db = new SQL.Database(content);
    usingPersistedDb = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('[live-book-db] Failed to read DB file:', DB_FILE, error);
      throw error;
    }
    console.warn('[live-book-db] No existing DB file, creating fresh database at:', DB_FILE);
    db = new SQL.Database();
  }

  initializeSchema(db);

  if (!usingPersistedDb) {
    // Persist the fresh DB so subsequent reads don't hit ENOENT again
    try {
      await persistDatabase(db);
    } catch (error) {
      console.error('[live-book-db] Failed to persist fresh database:', DB_FILE, error);
    }
  }

  return db;
}

async function persistDatabase(db: Database): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const data = db.export();
    await fs.writeFile(DB_FILE, Buffer.from(data));
  } catch (error) {
    console.error('[live-book-db] Failed to persist database to:', DB_FILE, error);
  }
}

export async function getLiveBookDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = loadDatabase();
  }
  return dbPromise;
}

export async function withLiveBookDatabase<T>(
  callback: (db: Database) => T | Promise<T>,
  options?: { persist?: boolean },
): Promise<T> {
  let db: Database;
  try {
    db = await getLiveBookDatabase();
  } catch (error) {
    console.error('[live-book-db] Failed to initialize database:', error);
    throw new Error(
      `Database initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `WASM resolved to: ${resolvedWasmPath ?? 'not resolved'}, ` +
        `DATA_DIR: ${DATA_DIR}, DB_FILE: ${DB_FILE}`,
    );
  }
  const result = await callback(db);

  if (options?.persist !== false) {
    persistQueue = persistQueue.catch(() => undefined).then(() => persistDatabase(db));
    await persistQueue;
  }

  return result;
}

type SqlRowValue = string | number | Uint8Array | null;

export function queryRows<T>(db: Database, sql: string, params?: SqlRowValue[]): T[] {
  const results = db.exec(sql, params ?? []);
  if (results.length === 0) return [];

  const { columns, values } = results[0];
  return values.map((valueSet) => {
    const row: Record<string, SqlRowValue> = {};
    for (let i = 0; i < columns.length; i += 1) {
      row[columns[i]] = valueSet[i] ?? null;
    }
    return row as unknown as T;
  });
}

export function runSql(db: Database, sql: string, params?: SqlRowValue[]): void {
  db.run(sql, params ?? []);
}

export function queryOne<T>(db: Database, sql: string, params?: SqlRowValue[]): T | null {
  const rows = queryRows<T>(db, sql, params);
  return rows[0] ?? null;
}
