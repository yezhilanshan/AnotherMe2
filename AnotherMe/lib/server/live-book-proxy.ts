import { type NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.ANOTHERME2_GATEWAY_BASE_URL || 'http://127.0.0.1:8080';
const TOKEN = process.env.ANOTHERME2_GATEWAY_TOKEN?.trim();

export async function proxyLiveBookPath(req: NextRequest, path: string[]) {
  const target = `${GATEWAY.replace(/\/$/, '')}/live-book/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  const accept = req.headers.get('accept');
  if (contentType) headers.set('content-type', contentType);
  if (accept) headers.set('accept', accept);
  if (TOKEN) headers.set('authorization', `Bearer ${TOKEN}`);

  for (const name of ['x-llm-api-key', 'x-llm-model', 'x-llm-base-url']) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
    });
  } catch (error) {
    return NextResponse.json(
      {
        error_code: 'LIVE_BOOK_GATEWAY_UNREACHABLE',
        message: `Cannot reach live-book Gateway at ${GATEWAY}`,
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  const upstreamContentType = upstream.headers.get('content-type');
  if (upstreamContentType) responseHeaders.set('content-type', upstreamContentType);
  const cacheControl = upstream.headers.get('cache-control');
  if (cacheControl) responseHeaders.set('cache-control', cacheControl);

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
