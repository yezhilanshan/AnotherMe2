/**
 * API routes for notebook IndexedDB backup snapshots.
 *
 * GET /api/notebook - load the latest server snapshot
 * PUT /api/notebook - replace the server snapshot
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadNotebookSnapshot,
  normalizeNotebookSnapshot,
  saveNotebookSnapshot,
} from '@/lib/server/notebook-storage';

async function resolveUserId(request: NextRequest): Promise<string | null> {
  const authUser = await import('@/lib/auth/session')
    .then(({ getAuthenticatedUserFromRequest }) => getAuthenticatedUserFromRequest(request))
    .catch(() => null);
  return authUser?.id || request.nextUrl.searchParams.get('userId')?.trim() || null;
}

export async function GET(request?: NextRequest) {
  try {
    const userId = request ? await resolveUserId(request) : null;
    return NextResponse.json(await loadNotebookSnapshot(userId));
  } catch (error) {
    console.error('[api/notebook] Failed to load notebook snapshot:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to load notebook snapshot' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    const snapshot = normalizeNotebookSnapshot(await request.json());
    const saved = await saveNotebookSnapshot({
      ...snapshot,
      updatedAt: Date.now(),
    }, userId);
    return NextResponse.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error('[api/notebook] Failed to save notebook snapshot:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to save notebook snapshot' },
      { status: 500 },
    );
  }
}
