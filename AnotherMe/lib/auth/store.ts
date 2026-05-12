import 'server-only';

import { Pool, type PoolConfig } from 'pg';
import { queryRows, withAuthDatabase } from '@/lib/auth/sqlite';

export interface UserRecord {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: number;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  expires_at: number;
}

export function getAuthStorageBackend(): 'postgres' | 'sqlite' {
  return process.env.AUTH_DATABASE_URL?.trim() ? 'postgres' : 'sqlite';
}

let postgresPool: Pool | null = null;
let postgresSchemaPromise: Promise<void> | null = null;

function getPostgresSslConfig(): PoolConfig['ssl'] {
  const value = process.env.AUTH_DATABASE_SSL?.trim().toLowerCase();
  if (!value || value === 'false' || value === '0' || value === 'disable') {
    return undefined;
  }
  if (value === 'verify-full') {
    return true;
  }
  return { rejectUnauthorized: false };
}

function getPostgresPool(): Pool {
  const connectionString = process.env.AUTH_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error('AUTH_DATABASE_URL is required for Postgres auth storage.');
  }

  if (!postgresPool) {
    postgresPool = new Pool({
      connectionString,
      ssl: getPostgresSslConfig(),
    });
  }

  return postgresPool;
}

async function ensurePostgresSchema(): Promise<Pool> {
  const pool = getPostgresPool();
  if (!postgresSchemaPromise) {
    postgresSchemaPromise = pool
      .query(`
        CREATE TABLE IF NOT EXISTS auth_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
          created_at BIGINT NOT NULL,
          expires_at BIGINT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
      `)
      .then(() => undefined);
  }

  await postgresSchemaPromise;
  return pool;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function parseUserRecord(row: UserRecord): UserRecord {
  return {
    ...row,
    created_at: toNumber(row.created_at),
  };
}

function parseSessionRecord(row: SessionRecord): SessionRecord {
  return {
    ...row,
    expires_at: toNumber(row.expires_at),
  };
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    const result = await pool.query<UserRecord>(
      `SELECT id, email, display_name, password_hash, created_at
       FROM auth_users
       WHERE email = $1
       LIMIT 1`,
      [email],
    );
    return result.rows[0] ? parseUserRecord(result.rows[0]) : null;
  }

  return withAuthDatabase((db) => {
    const rows = queryRows<UserRecord>(
      db,
      `SELECT id, email, display_name, password_hash, created_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email],
    );
    return rows[0] ?? null;
  });
}

export async function insertUser(row: UserRecord & { updated_at: number }): Promise<void> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    await pool.query(
      `INSERT INTO auth_users (id, email, display_name, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [row.id, row.email, row.display_name, row.password_hash, row.created_at, row.updated_at],
    );
    return;
  }

  await withAuthDatabase(
    (db) => {
      db.run(
        `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.email, row.display_name, row.password_hash, row.created_at, row.updated_at],
      );
    },
    { persist: true },
  );
}

export async function deleteSessionsByUser(userId: string): Promise<void> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    await pool.query('DELETE FROM auth_sessions WHERE user_id = $1', [userId]);
    return;
  }

  await withAuthDatabase(
    (db) => {
      db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    },
    { persist: true },
  );
}

export async function insertSession(row: SessionRecord & { created_at: number }): Promise<void> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    await pool.query(
      `INSERT INTO auth_sessions (id, user_id, created_at, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [row.id, row.user_id, row.created_at, row.expires_at],
    );
    return;
  }

  await withAuthDatabase(
    (db) => {
      db.run(
        `INSERT INTO sessions (id, user_id, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        [row.id, row.user_id, row.created_at, row.expires_at],
      );
    },
    { persist: true },
  );
}

export async function findUserByActiveSession(
  sessionId: string,
  now: number,
): Promise<UserRecord | null> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    const result = await pool.query<UserRecord>(
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at
       FROM auth_sessions s
       JOIN auth_users u ON s.user_id = u.id
       WHERE s.id = $1
         AND s.expires_at > $2
       LIMIT 1`,
      [sessionId, now],
    );
    return result.rows[0] ? parseUserRecord(result.rows[0]) : null;
  }

  return withAuthDatabase((db) => {
    const rows = queryRows<UserRecord>(
      db,
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?
         AND s.expires_at > ?
       LIMIT 1`,
      [sessionId, now],
    );
    return rows[0] ?? null;
  });
}

export async function findSessionById(sessionId: string): Promise<SessionRecord | null> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    const result = await pool.query<SessionRecord>(
      `SELECT id, user_id, expires_at
       FROM auth_sessions
       WHERE id = $1
       LIMIT 1`,
      [sessionId],
    );
    return result.rows[0] ? parseSessionRecord(result.rows[0]) : null;
  }

  return withAuthDatabase((db) => {
    const rows = queryRows<SessionRecord>(
      db,
      `SELECT id, user_id, expires_at
       FROM sessions
       WHERE id = ?
       LIMIT 1`,
      [sessionId],
    );
    return rows[0] ?? null;
  });
}

export async function deleteSession(sessionId: string): Promise<void> {
  if (getAuthStorageBackend() === 'postgres') {
    const pool = await ensurePostgresSchema();
    await pool.query('DELETE FROM auth_sessions WHERE id = $1', [sessionId]);
    return;
  }

  await withAuthDatabase(
    (db) => {
      db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    },
    { persist: true },
  );
}
