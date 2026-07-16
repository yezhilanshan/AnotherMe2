/**
 * API Routes for stage/course data synchronization.
 *
 * GET  /api/stages — List all stage summaries
 * POST /api/stages — Save (upsert) stage data
 */

import { NextRequest, NextResponse } from 'next/server';
import { listStageSummaries, saveStage, type PersistedStageData } from '@/lib/server/stage-storage';

export async function GET() {
  try {
    const summaries = await listStageSummaries(200);
    return NextResponse.json({ stages: summaries });
  } catch (error) {
    console.error('[api/stages] Failed to list stages:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to list stages' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json(
        { error_code: 'INVALID_REQUEST', message: 'Missing required field: id' },
        { status: 400 },
      );
    }

    const stageData: PersistedStageData = {
      id: body.id,
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

    return NextResponse.json({ ok: true, id: stageData.id, updatedAt: stageData.updatedAt });
  } catch (error) {
    console.error('[api/stages] Failed to save stage:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to save stage' },
      { status: 500 },
    );
  }
}
