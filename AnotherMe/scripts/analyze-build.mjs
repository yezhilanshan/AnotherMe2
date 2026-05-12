import { spawnSync } from 'node:child_process';

const result = spawnSync('pnpm next experimental-analyze --output', {
  env: { ...process.env, ANALYZE: 'true' },
  stdio: 'inherit',
  shell: true,
});

process.exit(result.status ?? 1);
