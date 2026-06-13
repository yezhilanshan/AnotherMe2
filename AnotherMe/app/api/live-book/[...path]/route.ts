import { type NextRequest } from 'next/server';
import { proxyLiveBookPath } from '@/lib/server/live-book-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxyLiveBook(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return proxyLiveBookPath(req, path);
}

export const GET = proxyLiveBook;
export const POST = proxyLiveBook;
export const PUT = proxyLiveBook;
export const PATCH = proxyLiveBook;
export const DELETE = proxyLiveBook;
