/**
 * useOfflineSync — Initializes the offline queue on mount and auto-flushes
 * queued actions when network connectivity is restored.
 */

import { useEffect, useRef } from 'react';
import { useNetworkStatus } from './useNetworkStatus';
import { offlineQueue } from '../lib/offline-queue';
import { useChatStore } from '../lib/store';

/**
 * Hook to initialize offline queue and auto-flush on network recovery.
 * Mount once in the root layout.
 */
export function useOfflineSync() {
  const network = useNetworkStatus();
  const wasOffline = useRef(false);
  const initRef = useRef(false);

  // Initialize queue from storage on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    offlineQueue.init().catch(() => {});
  }, []);

  // Sync network status to store
  useEffect(() => {
    const isOnline = network.isConnected && network.isInternetReachable;
    useChatStore.getState().setOnline(isOnline);
  }, [network.isConnected, network.isInternetReachable]);

  // Auto-flush when transitioning from offline to online
  useEffect(() => {
    const isOnline = network.isConnected && network.isInternetReachable;

    if (wasOffline.current && isOnline && offlineQueue.length > 0) {
      useChatStore.getState().flushOfflineQueue().then(({ succeeded, failed }) => {
        if (succeeded > 0 || failed > 0) {
          console.log(`[offline-sync] Flushed: ${succeeded} succeeded, ${failed} failed`);
        }
      }).catch(() => {});
    }

    wasOffline.current = !isOnline;
  }, [network.isConnected, network.isInternetReachable]);

  return {
    isOnline: network.isConnected && network.isInternetReachable,
    queueLength: offlineQueue.length,
  };
}
