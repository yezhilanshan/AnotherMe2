/**
 * POST /api/admin/cleanup — Trigger server-side storage cleanup.
 *
 * Requires authentication.
 * Optional query params:
 *   ?jobTtlDays=7&bookTtlDays=90&stageTtlDays=30
 */

import { NextRequest, NextResponse } from 'next/server';
import { runCleanup } from '@/lib/server/storage-cleanup';
import { requireAuthenticatedUserFromRequest } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    await requireAuthenticatedUserFromRequest(request);

    const url = new URL(request.url);
    const jobTtlDays = parseInt(url.searchParams.get('jobTtlDays') || '', 10) || undefined;
    const bookTtlDays = parseInt(url.searchParams.get('bookTtlDays') || '', 10) || undefined;
    const stageTtlDays = parseInt(url.searchParams.get('stageTtlDays') || '', 10) || undefined;

    const results = await runCleanup({ jobTtlDays, bookTtlDays, stageTtlDays });
    const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);

    return NextResponse.json({ ok: true, totalRemoved, results });
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNAUTHORIZED')) {
      return NextResponse.json(
        { error_code: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 },
      );
    }
    console.error('[api/admin/cleanup] Cleanup failed:', error);
    return NextResponse.json(
      { error_code: 'CLEANUP_FAILED', message: String(error) },
      { status: 500 },
    );
  }
}
