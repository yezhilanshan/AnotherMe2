import { NextResponse } from 'next/server';
import { isAnotherMe2GatewayError } from './anotherme2-gateway/core';
import { AuthError } from '@/lib/auth/types';

export const API_ERROR_CODES = {
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_URL: 'INVALID_URL',
  REDIRECT_NOT_ALLOWED: 'REDIRECT_NOT_ALLOWED',
  CONTENT_SENSITIVE: 'CONTENT_SENSITIVE',
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  RESULT_NOT_READY: 'RESULT_NOT_READY',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_FORBIDDEN: 'FILE_FORBIDDEN',
  GENERATION_FAILED: 'GENERATION_FAILED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  PARSE_FAILED: 'PARSE_FAILED',
  MODEL_VERIFICATION_FAILED: 'MODEL_VERIFICATION_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiErrorBody {
  success: false;
  errorCode: ApiErrorCode;
  error: string;
  details?: string;
}

export function apiError(
  code: ApiErrorCode,
  status: number,
  error: string,
  details?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      success: false as const,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export function apiSuccess<T extends Record<string, unknown>>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, ...data }, { status });
}

/**
 * Handle common errors in API routes.
 * Returns an appropriate NextResponse for known error types, or null if the error is unknown.
 *
 * @example
 * try {
 *   // ... route logic
 * } catch (error) {
 *   const errorResponse = handleRouteError(error);
 *   if (errorResponse) return errorResponse;
 *   throw error; // Re-throw unknown errors
 * }
 */
export function handleRouteError(error: unknown): NextResponse<ApiErrorBody> | null {
  if (error instanceof AuthError) {
    return apiError('AUTH_FAILED', error.status || 401, error.message);
  }

  if (isAnotherMe2GatewayError(error)) {
    return apiError('UPSTREAM_ERROR', error.status || 502, error.message);
  }

  return null;
}
