import { NextRequest, NextResponse } from 'next/server';
import { deleteServerNotebook, loadServerNotebook } from '@/lib/server/notebook-service';

interface Params {
  params: Promise<{ notebookId: string }>;
}

async function resolveUserId(request: NextRequest): Promise<string> {
  const authUser = await import('@/lib/auth/session')
    .then(({ getAuthenticatedUserFromRequest }) => getAuthenticatedUserFromRequest(request))
    .catch(() => null);
  return authUser?.id || request.nextUrl.searchParams.get('userId')?.trim() || 'anonymous';
}

export async function GET(request: NextRequest, context: Params) {
  try {
    const userId = await resolveUserId(request);
    const { notebookId } = await context.params;
    const notebook = await loadServerNotebook(userId, notebookId);

    if (!notebook) {
      return NextResponse.json(
        { error_code: 'NOT_FOUND', message: 'Notebook not found' },
        { status: 404 },
      );
    }

    return NextResponse.json(notebook);
  } catch (error) {
    console.error('[api/notebooks/:id] Failed to load notebook:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to load notebook' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  try {
    const userId = await resolveUserId(request);
    const { notebookId } = await context.params;
    const deleted = await deleteServerNotebook(userId, notebookId);
    return NextResponse.json({ ok: deleted });
  } catch (error) {
    console.error('[api/notebooks/:id] Failed to delete notebook:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to delete notebook' },
      { status: 500 },
    );
  }
}
