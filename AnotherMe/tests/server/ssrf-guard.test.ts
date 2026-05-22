import { afterEach, describe, expect, it } from 'vitest';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';

describe('SSRF guard', () => {
  const previousAllowLocal = process.env.ALLOW_LOCAL_NETWORKS;

  afterEach(() => {
    if (previousAllowLocal === undefined) {
      delete process.env.ALLOW_LOCAL_NETWORKS;
    } else {
      process.env.ALLOW_LOCAL_NETWORKS = previousAllowLocal;
    }
  });

  it('blocks bracketed IPv6 loopback and IPv4-mapped loopback addresses', () => {
    delete process.env.ALLOW_LOCAL_NETWORKS;

    expect(validateUrlForSSRF('http://[::1]/')).toBe('Local/private network URLs are not allowed');
    expect(validateUrlForSSRF('http://[::ffff:127.0.0.1]/')).toBe(
      'Local/private network URLs are not allowed',
    );
    expect(validateUrlForSSRF('http://[::ffff:7f00:1]/')).toBe(
      'Local/private network URLs are not allowed',
    );
  });

  it('blocks IPv6 unique local addresses without blocking public hostnames starting with fd', () => {
    delete process.env.ALLOW_LOCAL_NETWORKS;

    expect(validateUrlForSSRF('http://[fd00::1]/')).toBe(
      'Local/private network URLs are not allowed',
    );
    expect(validateUrlForSSRF('https://fd00.example.com/api')).toBeNull();
  });
});
