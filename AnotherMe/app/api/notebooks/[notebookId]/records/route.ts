import { NextRequest, NextResponse } from 'next/server';
import {
  addServerNotebookRecord,
  listServerNotebookRecords,
  type AddNotebookRecordInput,
} from '@/lib/server/notebook-service';

interface Params {
  params: Promise<{ notebookId: string }>;
}

async function resolveUserId(request: NextRequest): Promise<string> {
  const authUser = await import('@/lib/auth/session')
    .then(({ getAuthenticatedUserFromRequest }) => getAuthenticatedUserFromRequest(request))
    .catch(() => null);
  return authUser?.id || request.nextUrl.searchParams.get('userId')?.trim() || 'anonymous';
}

function asRecordInput(body: Record<string, unknown>): AddNotebookRecordInput {
  return {
    id: typeof body.id === 'string' ? body.id : undefined,
    type: typeof body.type === 'string' ? body.type : undefined,
    title: typeof body.title === 'string' ? body.title : '未命名笔记',
    content: typeof body.content === 'string' ? body.content : '',
    summary: typeof body.summary === 'string' ? body.summary : undefined,
    userQuery: typeof body.userQuery === 'string' ? body.userQuery : undefined,
    output: typeof body.output === 'string' ? body.output : undefined,
    tags: Array.isArray(body.tags) ? body.tags.filter((item): item is string => typeof item === 'string') : undefined,
    subject: typeof body.subject === 'string' ? body.subject : undefined,
    source: typeof body.source === 'string' ? body.source : undefined,
    stageId: typeof body.stageId === 'string' ? body.stageId : undefined,
    sceneId: typeof body.sceneId === 'string' ? body.sceneId : undefined,
    isPinned: typeof body.isPinned === 'boolean' ? body.isPinned : undefined,
    isFavorite: typeof body.isFavorite === 'boolean' ? body.isFavorite : undefined,
    metadata:
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : undefined,
  };
}

export async function GET(request: NextRequest, context: Params) {
  try {
    const userId = await resolveUserId(request);
    const { notebookId } = await context.params;
    const limitParam = Number(request.nextUrl.searchParams.get('limit'));
    const records = await listServerNotebookRecords(userId, {
      notebookId,
      limit: Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50,
    });
    return NextResponse.json({ records });
  } catch (error) {
    console.error('[api/notebooks/:id/records] Failed to list records:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to list notebook records' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest, context: Params) {
  try {
    const userId = await resolveUserId(request);
    const { notebookId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const record = await addServerNotebookRecord(userId, notebookId, asRecordInput(body));
    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    console.error('[api/notebooks/:id/records] Failed to create record:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to create notebook record' },
      { status: 500 },
    );
  }
}
