/**
 * API Routes for single stage operations.
 *
 * GET    /api/stages/[stageId] — Get stage data
 * PUT    /api/stages/[stageId] — Update stage data (upsert)
 * DELETE /api/stages/[stageId] — Delete stage data
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  loadStage,
  saveStage,
  deleteStage,
  type PersistedStageData,
} from '@/lib/server/stage-storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ stageId: string }> },
) {
  const { stageId } = await params;
  try {
    const stage = await loadStage(stageId);
    if (!stage) {
      return NextResponse.json(
        { error_code: 'NOT_FOUND', message: `Stage ${stageId} not found` },
        { status: 404 },
      );
    }
    return NextResponse.json(stage);
  } catch (error) {
    console.error(`[api/stages/${stageId}] Failed to load stage:`, error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to load stage' },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ stageId: string }> },
) {
  const { stageId } = await params;
  try {
    const body = await request.json();

    // Ensure URL param matches body
    if (body.id && body.id !== stageId) {
      return NextResponse.json(
        { error_code: 'INVALID_REQUEST', message: 'Stage ID in URL does not match body' },
        { status: 400 },
      );
    }

    const stageData: PersistedStageData = {
      id: stageId,
      name: body.name || 'Untitled',
      description: body.description,
      createdAt: body.createdAt || Date.now(),
      updatedAt: body.updatedAt || Date.now(),
      language: body.language,
      style: body.style,
      currentSceneId: body.currentSceneId,
      agentIds: body.agentIds,
      scenes: Array.isArray(body.scenes) ? body.scenes : [],
      chats: Array.isArray(body.chats) ? body.chats : undefined,
      playbackState: body.playbackState || undefined,
    };

    await saveStage(stageData);

    return NextResponse.json({ ok: true, id: stageId, updatedAt: stageData.updatedAt });
  } catch (error) {
    console.error(`[api/stages/${stageId}] Failed to save stage:`, error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to save stage' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ stageId: string }> },
) {
  const { stageId } = await params;
  try {
    const deleted = await deleteStage(stageId);
    if (!deleted) {
      return NextResponse.json(
        { error_code: 'NOT_FOUND', message: `Stage ${stageId} not found` },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, id: stageId });
  } catch (error) {
    console.error(`[api/stages/${stageId}] Failed to delete stage:`, error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to delete stage' },
      { status: 500 },
    );
  }
}
