import { apiSuccess } from '@/lib/server/api-response';
import {
  getServerWebSearchProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
} from '@/lib/server/provider-config';

const version = process.env.npm_package_version || '0.1.0';

// Lazy cleanup: runs at most once every 24 hours, triggered by health check
let lastCleanupTime = 0;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function maybeRunCleanup() {
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return;
  lastCleanupTime = now;
  try {
    const { runCleanup } = await import('@/lib/server/storage-cleanup');
    const results = await runCleanup();
    const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);
    if (totalRemoved > 0) {
      console.log(`[health-cleanup] Removed ${totalRemoved} expired files`);
    }
  } catch {
    // Cleanup failure should not affect health check
  }
}

export async function GET() {
  // Fire-and-forget cleanup (non-blocking)
  void maybeRunCleanup();

  return apiSuccess({
    status: 'ok',
    version,
    capabilities: {
      webSearch: Object.keys(getServerWebSearchProviders()).length > 0,
      imageGeneration: Object.keys(getServerImageProviders()).length > 0,
      videoGeneration: Object.keys(getServerVideoProviders()).length > 0,
      tts: Object.keys(getServerTTSProviders()).length > 0,
    },
  });
}
