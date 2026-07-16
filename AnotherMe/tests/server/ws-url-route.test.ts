import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('/api/messages/ws-url route', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  function makeRequest(conversationId: string, userId: string) {
    return new NextRequest(
      `http://localhost/api/messages/ws-url?conversationId=${conversationId}&userId=${userId}`,
    );
  }

  it('returns 400 when conversationId is missing', async () => {
    const { GET } = await import('@/app/api/messages/ws-url/route');
    const req = new NextRequest('http://localhost/api/messages/ws-url?userId=abc');
    const response = await GET(req);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.errorCode).toBe('INVALID_REQUEST');
  });

  it('returns 400 when userId is missing', async () => {
    const { GET } = await import('@/app/api/messages/ws-url/route');
    const req = new NextRequest(
      'http://localhost/api/messages/ws-url?conversationId=conv-1',
    );
    const response = await GET(req);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('returns ws URL with default gateway host when no env vars set', async () => {
    process.env.ANOTHERME2_GATEWAY_TOKEN = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL = '';

    const { GET } = await import('@/app/api/messages/ws-url/route');
    const response = await GET(makeRequest('conv-123', 'user-456'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.wsUrl).toContain('ws://127.0.0.1:8080/ws/messages/conv-123');
    expect(json.wsUrl).toContain('user_id=user-456');
    // No token when ANOTHERME2_GATEWAY_TOKEN is empty
    expect(json.wsUrl).not.toContain('token=');
  });

  it('includes token when ANOTHERME2_GATEWAY_TOKEN is set', async () => {
    process.env.ANOTHERME2_GATEWAY_TOKEN = 'secret-token-abc';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL = '';

    const { GET } = await import('@/app/api/messages/ws-url/route');
    const response = await GET(makeRequest('conv-123', 'user-456'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.wsUrl).toContain('token=secret-token-abc');
    expect(json.wsUrl).toContain('user_id=user-456');
  });

  it('uses NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST when set', async () => {
    process.env.ANOTHERME2_GATEWAY_TOKEN = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST = '192.168.1.100:9090';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL = '';

    const { GET } = await import('@/app/api/messages/ws-url/route');
    const response = await GET(makeRequest('conv-abc', 'user-xyz'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.wsUrl).toContain('ws://192.168.1.100:9090/ws/messages/conv-abc');
  });

  it('uses NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL when set (takes priority)', async () => {
    process.env.ANOTHERME2_GATEWAY_TOKEN = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL = 'wss://gateway.example.com';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST = 'ignored:1234';

    const { GET } = await import('@/app/api/messages/ws-url/route');
    const response = await GET(makeRequest('conv-1', 'user-1'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.wsUrl).toContain('wss://gateway.example.com/ws/messages/conv-1');
    expect(json.wsUrl).not.toContain('ignored:1234');
  });

  it('URL-encodes conversationId with special characters', async () => {
    process.env.ANOTHERME2_GATEWAY_TOKEN = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_HOST = '';
    process.env.NEXT_PUBLIC_ANOTHERME2_GATEWAY_WS_URL = '';

    const { GET } = await import('@/app/api/messages/ws-url/route');
    const response = await GET(makeRequest('conv with spaces/slash', 'user-1'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.wsUrl).toContain(
      '/ws/messages/' + encodeURIComponent('conv with spaces/slash'),
    );
  });
});
