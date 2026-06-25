import { NextRequest, NextResponse } from 'next/server';
import {
  getUserMemory,
  refreshMemoryFromTurn,
  updateUserMemory,
} from '@/lib/server/memory-service';

async function resolveUserId(request: NextRequest): Promise<string> {
  const authUser = await import('@/lib/auth/session')
    .then(({ getAuthenticatedUserFromRequest }) => getAuthenticatedUserFromRequest(request))
    .catch(() => null);
  return authUser?.id || request.nextUrl.searchParams.get('userId')?.trim() || 'anonymous';
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    return NextResponse.json(await getUserMemory(userId));
  } catch (error) {
    console.error('[api/memory] Failed to read memory:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to read memory' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    const body = (await request.json()) as Record<string, unknown>;
    const memory = await updateUserMemory(userId, {
      profile: typeof body.profile === 'string' ? body.profile : undefined,
      summary: typeof body.summary === 'string' ? body.summary : undefined,
    });
    return NextResponse.json(memory);
  } catch (error) {
    console.error('[api/memory] Failed to update memory:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to update memory' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    const body = (await request.json()) as Record<string, unknown>;
    const memory = await refreshMemoryFromTurn({
      userId,
      userMessage: typeof body.userMessage === 'string' ? body.userMessage : null,
      assistantMessage: typeof body.assistantMessage === 'string' ? body.assistantMessage : null,
      topic: typeof body.topic === 'string' ? body.topic : null,
      source: typeof body.source === 'string' ? body.source : 'chat',
    });
    return NextResponse.json(memory);
  } catch (error) {
    console.error('[api/memory] Failed to refresh memory:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to refresh memory' },
      { status: 500 },
    );
  }
}
