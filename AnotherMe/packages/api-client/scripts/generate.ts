/**
 * Generate TypeScript types from Gateway OpenAPI spec.
 *
 * Strategy (in priority order):
 *   1. If `GATEWAY_URL` is reachable, fetch `${GATEWAY_URL}/openapi.json`.
 *   2. Otherwise, fall back to the local `./openapi.json` snapshot.
 *      This keeps CI green even when the gateway isn't running.
 *
 * Usage:
 *   pnpm generate                                  # uses local snapshot
 *   GATEWAY_URL=http://192.168.1.20:8082 pnpm generate   # fetch from remote
 *   pnpm generate:offline                          # force local snapshot
 *   pnpm generate:gateway                          # force remote
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HERE = __dirname;
const PACKAGE_ROOT = resolve(HERE, '..');
const SPEC_PATH = resolve(PACKAGE_ROOT, 'openapi.json');
const OUTPUT_PATH = resolve(PACKAGE_ROOT, 'src/types/generated.ts');

const FORCE_OFFLINE = process.argv.includes('--offline') || process.env.GENERATE_OFFLINE === '1';
const FORCE_REMOTE = process.argv.includes('--remote') || process.env.GENERATE_REMOTE === '1';

type OpenApiDoc = Record<string, unknown> & { paths?: Record<string, unknown> };

async function loadFromGateway(url: string): Promise<OpenApiDoc | null> {
  const endpoint = `${url.replace(/\/$/, '')}/openapi.json`;
  console.log(`[generate] Fetching OpenAPI spec from ${endpoint} ...`);
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      console.warn(`[generate] Gateway responded ${response.status}; falling back to local snapshot.`);
      return null;
    }
    const spec = (await response.json()) as OpenApiDoc;
    if (!spec.paths || Object.keys(spec.paths).length === 0) {
      console.warn('[generate] Remote spec has no paths; falling back to local snapshot.');
      return null;
    }
    return spec;
  } catch (err) {
    console.warn(
      `[generate] Could not reach gateway (${err instanceof Error ? err.message : String(err)}); falling back to local snapshot.`,
    );
    return null;
  }
}

function loadFromDisk(): OpenApiDoc {
  if (!existsSync(SPEC_PATH)) {
    throw new Error(
      `[generate] Local snapshot not found at ${SPEC_PATH}.\n` +
        `Run \`pnpm generate:gateway\` against a running gateway, or commit openapi.json.`,
    );
  }
  console.log(`[generate] Loading local snapshot from ${SPEC_PATH}`);
  return JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDoc;
}

async function main() {
  let spec: OpenApiDoc | null = null;
  let source: 'gateway' | 'local' = 'local';

  if (!FORCE_OFFLINE) {
    const gatewayUrl = process.env.GATEWAY_URL || 'http://localhost:8080';
    spec = await loadFromGateway(gatewayUrl);
    if (spec) source = 'gateway';
  }

  if (!spec) {
    spec = loadFromDisk();
    source = 'local';
  }

  const pathCount = Object.keys(spec.paths ?? {}).length;
  console.log(`[generate] Using ${source} spec with ${pathCount} paths.`);

  if (pathCount === 0) {
    throw new Error('[generate] Spec has no paths; refusing to write empty generated.ts');
  }

  const { default: openapiTS, astToString } = await import('openapi-typescript');
  const ast = await openapiTS(spec as unknown as Parameters<typeof openapiTS>[0]);
  const output = astToString(ast);

  const header = [
    '/**',
    ' * Auto-generated from Gateway OpenAPI spec.',
    ` * Source: ${source === 'gateway' ? `${process.env.GATEWAY_URL || 'http://localhost:8080'}/openapi.json` : './openapi.json'}`,
    ` * Generated at: ${new Date().toISOString()}`,
    ' *',
    ' * DO NOT EDIT — run `pnpm generate` to refresh.',
    ' */',
    '',
  ].join('\n');

  writeFileSync(OUTPUT_PATH, header + output);
  console.log(`[generate] Wrote types to ${OUTPUT_PATH}`);
  console.log('[generate] Done!');
}

main().catch((err) => {
  console.error('[generate] FAILED:', err);
  process.exit(1);
});
