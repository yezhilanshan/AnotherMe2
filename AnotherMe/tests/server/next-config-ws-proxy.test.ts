import { describe, expect, it } from 'vitest';

describe('next.config.ts — WebSocket proxy rewrite removed', () => {
  it('rewrites do not include ws-proxy rule', async () => {
    const configModule = await import('@/next.config');
    const config = configModule.default || configModule;

    // The config should be a NextConfig object
    expect(config).toBeDefined();
    expect(config.rewrites).toBeDefined();

    // Call rewrites() to get the actual rules
    const rewrites = await (config.rewrites as () => Promise<Array<{ source: string; destination: string }>>)();

    // Should NOT contain the ws-proxy rewrite
    const wsProxyRewrite = rewrites.find((r) => r.source.includes('ws-proxy'));
    expect(wsProxyRewrite).toBeUndefined();
  });

  it('rewrites still contain co-writer proxy', async () => {
    const configModule = await import('@/next.config');
    const config = configModule.default || configModule;

    const rewrites = await (config.rewrites as () => Promise<Array<{ source: string; destination: string }>>)();

    // co-writer proxy should still exist
    const coWriterRewrite = rewrites.find((r) => r.source.includes('co-writer'));
    expect(coWriterRewrite).toBeDefined();
    expect(coWriterRewrite!.source).toBe('/api/co-writer/:path*');
  });
});
