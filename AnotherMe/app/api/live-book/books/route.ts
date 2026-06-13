import { type NextRequest } from 'next/server';
import { proxyLiveBookPath } from '@/lib/server/live-book-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function proxyBooks(req: NextRequest) {
  return proxyLiveBookPath(req, ['books']);
}

export const GET = proxyBooks;
export const POST = proxyBooks;
