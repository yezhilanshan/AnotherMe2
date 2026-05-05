import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import type { AuthSession, AuthUser } from '@/lib/auth/types';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TOKEN_PREFIX = 'stateless';

function base64UrlEncode(input: string) {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function getSigningSecret() {
  return process.env.AUTH_SECRET || process.env.AUTH_ADMIN_PASSWORD || '';
}

function getAdminEmail() {
  return process.env.AUTH_ADMIN_EMAIL?.trim().toLowerCase() || '';
}

function getAdminPassword() {
  return process.env.AUTH_ADMIN_PASSWORD || '';
}

function getAdminDisplayName(email: string) {
  return process.env.AUTH_ADMIN_DISPLAY_NAME?.trim() || email.split('@')[0] || 'Admin';
}

export function isStatelessAdminAuthEnabled() {
  return Boolean(getAdminEmail() && getAdminPassword() && getSigningSecret());
}

export function getStatelessAdminUser(): AuthUser | null {
  const email = getAdminEmail();
  if (!isStatelessAdminAuthEnabled() || !email) return null;

  return {
    id: `admin:${email}`,
    email,
    displayName: getAdminDisplayName(email),
    createdAt: new Date(0).toISOString(),
  };
}

function sign(payload: string) {
  return createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authenticateStatelessAdmin(email: string, password: string): AuthUser | null {
  const adminEmail = getAdminEmail();
  const adminPassword = getAdminPassword();

  if (!isStatelessAdminAuthEnabled()) return null;
  if (email.trim().toLowerCase() !== adminEmail) return null;
  if (!safeEqual(password, adminPassword)) return null;

  return getStatelessAdminUser();
}

export function createStatelessAdminSession(user: AuthUser): AuthSession {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      expiresAt,
    }),
  );

  return {
    id: `${TOKEN_PREFIX}.${payload}.${sign(payload)}`,
    userId: user.id,
    expiresAt,
  };
}

export function getUserFromStatelessSession(sessionId: string): AuthUser | null {
  if (!sessionId.startsWith(`${TOKEN_PREFIX}.`)) return null;

  const [, payload, signature] = sessionId.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as {
      sub?: string;
      email?: string;
      displayName?: string;
      expiresAt?: number;
    };

    if (!parsed.sub || !parsed.email || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      return null;
    }

    return {
      id: parsed.sub,
      email: parsed.email,
      displayName: parsed.displayName || getAdminDisplayName(parsed.email),
      createdAt: new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function isStatelessSession(sessionId: string) {
  return sessionId.startsWith(`${TOKEN_PREFIX}.`);
}
