import { NextRequest, NextResponse } from 'next/server';
import { createServerNotebook, listServerNotebooks } from '@/lib/server/notebook-service';

async function resolveUserId(request: NextRequest): Promise<string> {
  const authUser = await import('@/lib/auth/session')
    .then(({ getAuthenticatedUserFromRequest }) => getAuthenticatedUserFromRequest(request))
    .catch(() => null);
  return authUser?.id || request.nextUrl.searchParams.get('userId')?.trim() || 'anonymous';
}

export async function GET(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    return NextResponse.json({ notebooks: await listServerNotebooks(userId) });
  } catch (error) {
    console.error('[api/notebooks] Failed to list notebooks:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to list notebooks' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await resolveUserId(request);
    const body = await request.json();
    const notebook = await createServerNotebook(userId, {
      id: typeof body.id === 'string' ? body.id : undefined,
      name: typeof body.name === 'string' ? body.name : '未命名笔记本',
      description: typeof body.description === 'string' ? body.description : undefined,
      color: typeof body.color === 'string' ? body.color : undefined,
      icon: typeof body.icon === 'string' ? body.icon : undefined,
    });
    return NextResponse.json({ notebook }, { status: 201 });
  } catch (error) {
    console.error('[api/notebooks] Failed to create notebook:', error);
    return NextResponse.json(
      { error_code: 'STORAGE_ERROR', message: 'Failed to create notebook' },
      { status: 500 },
    );
  }
}
