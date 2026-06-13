/**
 * Client component that runs all pending data migrations on app startup.
 * Mount once in the root layout.
 */

'use client';

import { useEffect } from 'react';
import { runAllMigrations } from '@/lib/utils/migration-registry';

export function MigrationsInit() {
  useEffect(() => {
    runAllMigrations().catch(() => {
      // Migration errors are logged internally; don't crash the app
    });
  }, []);

  return null;
}
