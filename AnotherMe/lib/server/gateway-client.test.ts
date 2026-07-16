/**
 * P1 验收 — `lib/server/gateway-client.ts` 单测
 *
 * 验证：
 *  - `getGatewayClient()` 在缺失 `ANOTHERME2_GATEWAY_BASE_URL` 时抛错
 *  - `getGatewayClient()` 走单例（同一进程内多次调用复用同一实例）
 *  - `resetGatewayClient()` 后重新读取 env
 *
 * 不依赖 vitest，自包含运行：
 *
 *   cd AnotherMe
 *   pnpm tsx lib/server/gateway-client.test.ts
 *
 * 或在 tsx 不可用时用 node + esbuild-register 等价方式。
 */

import {
  getGatewayClient,
  resetGatewayClient,
} from './gateway-client';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${(e as Error).message}`);
    failed++;
  }
}

function assertThrows(fn: () => void, expected: RegExp) {
  let thrown: Error | null = null;
  try {
    fn();
  } catch (e) {
    thrown = e as Error;
  }
  if (!thrown) {
    throw new Error('expected function to throw');
  }
  if (!expected.test(thrown.message)) {
    throw new Error(`expected message to match ${expected} got: ${thrown.message}`);
  }
}

function assertEq<T>(actual: T, expected: T, label = '') {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

console.log('gateway-client (P1)');

test('throws when ANOTHERME2_GATEWAY_BASE_URL is missing', () => {
  const oldUrl = process.env.ANOTHERME2_GATEWAY_BASE_URL;
  delete process.env.ANOTHERME2_GATEWAY_BASE_URL;
  resetGatewayClient();
  try {
    assertThrows(() => getGatewayClient(), /ANOTHERME2_GATEWAY_BASE_URL/);
  } finally {
    if (oldUrl !== undefined) process.env.ANOTHERME2_GATEWAY_BASE_URL = oldUrl;
    resetGatewayClient();
  }
});

test('returns a singleton instance', () => {
  process.env.ANOTHERME2_GATEWAY_BASE_URL = 'http://localhost:8080';
  process.env.ANOTHERME2_GATEWAY_TOKEN = 'test-token';
  resetGatewayClient();
  const a = getGatewayClient();
  const b = getGatewayClient();
  assertEq(a === b, true, 'singleton identity');
});

test('resetGatewayClient drops the cache', () => {
  process.env.ANOTHERME2_GATEWAY_BASE_URL = 'http://localhost:8080';
  resetGatewayClient();
  const a = getGatewayClient();
  resetGatewayClient();
  const b = getGatewayClient();
  assertEq(a === b, false, 'post-reset identity');
});

console.log(`\n通过 ${passed} / 失败 ${failed}`);
process.exit(failed > 0 ? 1 : 0);
