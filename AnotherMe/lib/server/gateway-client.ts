/**
 * Gateway client (Web side)
 * =========================
 *
 * Thin, **server-side-only** wrapper around `@anotherme/api-client` so that
 * every Next.js API route in `app/api/**` talks to the Python gateway
 * through the same code path the mobile app uses.
 *
 * P1 motivation: previously each `app/api/.../route.ts` re-implemented
 * its own `fetch(GATEWAY_BASE_URL + path, { ... })`.  After P1, all of
 * them go through this single client, which means:
 *
 *  - Bearer token, timeout, error envelope are handled once
 *  - The P0-generated OpenAPI types in `@anotherme/api-client/types/generated.ts`
 *    become the **source of truth** for HTTP contracts in the Web app
 *  - Adding a new Gateway capability = update the OpenAPI spec, regenerate
 *    types, and call `gatewayClient.<domain>.<method>(...)`
 *
 * Usage:
 *
 *   const gateways = getGatewayClient();
 *   const job = await gateways.jobs.create({ job_type: 'course_generate', payload });
 *   const events = await gateways.streamChat({ messages, capability: 'ai_tutor_chat' });
 *
 * Configuration (env):
 *   ANOTHERME2_GATEWAY_BASE_URL  e.g. http://localhost:8080
 *   ANOTHERME2_GATEWAY_TOKEN     static token (Phase 0)
 *   GATEWAY_TIMEOUT_MS           optional, default 30000
 *
 * IMPORTANT: This module reads `process.env` lazily so that changing
 * environment variables between unit tests is supported.
 */

import { createApiClient, type ApiClient } from '@anotherme/api-client';

let _client: ApiClient | null = null;

function resolveBaseUrl(): string {
  const url = process.env.ANOTHERME2_GATEWAY_BASE_URL?.trim();
  if (!url) {
    throw new Error(
      '[gatewayClient] ANOTHERME2_GATEWAY_BASE_URL is not configured. ' +
        'Set it in your environment (e.g. http://localhost:8080).',
    );
  }
  return url.replace(/\/+$/, '');
}

function resolveToken(): string {
  return process.env.ANOTHERME2_GATEWAY_TOKEN?.trim() || '';
}

function resolveTimeout(): number {
  const raw = process.env.GATEWAY_TIMEOUT_MS?.trim();
  if (!raw) return 30_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/**
 * Lazily-initialised singleton of the shared api-client.
 * Calling this on the server is safe; on the client it will throw because
 * the Web `app/api/**` routes are server-only.
 */
export function getGatewayClient(): ApiClient {
  if (_client) return _client;
  _client = createApiClient({
    baseUrl: resolveBaseUrl(),
    getToken: () => resolveToken(),
    timeout: resolveTimeout(),
  });
  return _client;
}

/**
 * Drop the cached client.  Useful for tests that re-read env between
 * runs.  Production code should never need this.
 */
export function resetGatewayClient(): void {
  _client = null;
}

export { ApiError } from '@anotherme/api-client';
