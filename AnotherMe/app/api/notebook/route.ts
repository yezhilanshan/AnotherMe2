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

export async function GET() {
  try {
    return NextResponse.json(await loadNotebookSnapshot());
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
    const snapshot = normalizeNotebookSnapshot(await request.json());
    const saved = await saveNotebookSnapshot({
      ...snapshot,
      updatedAt: Date.now(),
    });
    return NextResponse.json({ ok: true, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error('[api/notebook] Failed to save notebook snapshot:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to save notebook snapshot' },
      { status: 500 },
    );
  }
}
