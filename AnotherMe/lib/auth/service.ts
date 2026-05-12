import 'server-only';

import { randomBytes, randomUUID } from 'crypto';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import {
  authenticateStatelessAdmin,
  createStatelessAdminSession,
  getUserFromStatelessSession,
  isStatelessSession,
} from '@/lib/auth/stateless';
import {
  deleteSession,
  deleteSessionsByUser,
  findSessionById,
  findUserByActiveSession,
  findUserByEmail,
  insertSession,
  insertUser,
  type UserRecord,
} from '@/lib/auth/store';
import { AuthError, type AuthSession, type AuthUser } from '@/lib/auth/types';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

function assertEmail(email: string) {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AuthError('INVALID_EMAIL', '邮箱格式不正确。', 400);
  }
}

function assertPassword(password: string) {
  const length = password.length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new AuthError(
      'INVALID_PASSWORD',
      `密码长度需要在 ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} 个字符之间。`,
      400,
    );
  }
}

function sanitizeDisplayName(displayName: string, email: string): string {
  const value = displayName.trim();
  if (value.length >= 2 && value.length <= 40) return value;
  return normalizeEmail(email).split('@')[0] || '同学';
}

function toAuthUser(row: UserRecord): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthUser> {
  const email = normalizeEmail(input.email);
  const password = input.password;
  const displayName = sanitizeDisplayName(input.displayName ?? '', email);

  assertEmail(email);
  assertPassword(password);

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AuthError('EMAIL_ALREADY_EXISTS', '该邮箱已被注册。', 409);
  }

  const now = Date.now();
  const userId = randomUUID();
  await insertUser({
    id: userId,
    email,
    display_name: displayName,
    password_hash: hashPassword(password),
    created_at: now,
    updated_at: now,
  });

  return {
    id: userId,
    email,
    displayName,
    createdAt: new Date(now).toISOString(),
  };
}

export async function authenticateUser(email: string, password: string): Promise<AuthUser> {
  const normalizedEmail = normalizeEmail(email);
  assertEmail(normalizedEmail);
  assertPassword(password);

  const row = await findUserByEmail(normalizedEmail);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AuthError('INVALID_CREDENTIALS', '邮箱或密码错误。', 401);
  }

  return toAuthUser(row);
}

/**
 * Authenticate user and create a new session.
 * This function revokes all existing sessions for the user to prevent session fixation attacks.
 * 
 * @param email - User email
 * @param password - User password
 * @returns Object containing user and new session
 */
export async function loginAndCreateSession(
  email: string,
  password: string,
): Promise<{ user: AuthUser; session: AuthSession }> {
  const statelessAdmin = authenticateStatelessAdmin(email, password);
  if (statelessAdmin) {
    return {
      user: statelessAdmin,
      session: createStatelessAdminSession(statelessAdmin),
    };
  }

  const user = await authenticateUser(email, password);

  // Revoke all existing sessions for this user to prevent session fixation
  await revokeAllUserSessions(user.id);

  // Create a new session
  const session = await createSession(user.id);

  return { user, session };
}

/**
 * Revoke all sessions for a user.
 * This should be called after successful authentication to prevent session fixation attacks.
 * 
 * @param userId - User ID
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  if (!userId) return;
  await deleteSessionsByUser(userId);
}

export async function createSession(userId: string): Promise<AuthSession> {
  const now = Date.now();
  const sessionId = randomBytes(24).toString('base64url');
  const expiresAt = now + SESSION_TTL_MS;

  await insertSession({
    id: sessionId,
    user_id: userId,
    created_at: now,
    expires_at: expiresAt,
  });

  return {
    id: sessionId,
    userId,
    expiresAt,
  };
}

export async function getUserBySession(sessionId: string): Promise<AuthUser | null> {
  if (!sessionId) return null;

  const statelessUser = getUserFromStatelessSession(sessionId);
  if (statelessUser) return statelessUser;

  const now = Date.now();

  const user = await findUserByActiveSession(sessionId, now);
  if (user) return toAuthUser(user);

  const expired = await findSessionById(sessionId);
  if (expired && expired.expires_at <= now) {
    await deleteSession(sessionId);
  }

  return null;
}

export async function revokeSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  if (isStatelessSession(sessionId)) return;

  await deleteSession(sessionId);
}
