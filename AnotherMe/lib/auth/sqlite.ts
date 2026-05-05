import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

const AUTH_DATA_DIR = path.join(process.cwd(), 'data');
const AUTH_DB_FILE = path.join(AUTH_DATA_DIR, 'auth.sqlite');
const AUTH_WASM_FILE = path.join(process.cwd(), 'public', 'sql-wasm.wasm');

let sqlRuntimePromise: Promise<SqlJsStatic> | null = null;
let authDbPromise: Promise<Database> | null = null;
let persistQueue = Promise.resolve();

function getSqlRuntime(): Promise<SqlJsStatic> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = initSqlJs({
      locateFile: () => AUTH_WASM_FILE,
    });
  }
  return sqlRuntimePromise;
}

function initializeSchema(db: Database) {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);
}

async function loadDatabase(): Promise<Database> {
  const SQL = await getSqlRuntime();

  try {
    await fs.mkdir(AUTH_DATA_DIR, { recursive: true });
  } catch {
    // ignore
  }

  let db: Database;
  try {
    const content = await fs.readFile(AUTH_DB_FILE);
    db = new SQL.Database(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    db = new SQL.Database();
  }

  initializeSchema(db);
  return db;
}

async function persistDatabase(db: Database): Promise<void> {
  await fs.mkdir(AUTH_DATA_DIR, { recursive: true });
  const data = db.export();
  await fs.writeFile(AUTH_DB_FILE, Buffer.from(data));
}

export async function getAuthDatabase(): Promise<Database> {
  if (!authDbPromise) {
    authDbPromise = loadDatabase();
  }
  return authDbPromise;
}

export async function withAuthDatabase<T>(
  callback: (db: Database) => T | Promise<T>,
  options?: { persist?: boolean },
): Promise<T> {
  const db = await getAuthDatabase();
  const result = await callback(db);

  if (options?.persist) {
    persistQueue = persistQueue.catch(() => undefined).then(() => persistDatabase(db));
    await persistQueue;
  }

  return result;
}

type SqlRowValue = string | number | Uint8Array | null;

export function queryRows<T>(
  db: Database,
  sql: string,
  params?: SqlRowValue[],
): T[] {
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
