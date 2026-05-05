import path from 'path';

function normalizeDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function getRuntimeDataDir(segment?: string): string {
  const root =
    normalizeDir(process.env.RUNTIME_DATA_DIR) ||
    normalizeDir(process.env.ANOTHERME_DATA_DIR) ||
    (process.env.VERCEL ? path.join('/tmp', 'anotherme-data') : path.join(process.cwd(), 'data'));

  return segment ? path.join(root, segment) : root;
}

export function getRuntimeWorkDir(segment?: string): string {
  const root =
    normalizeDir(process.env.RUNTIME_WORK_DIR) ||
    (process.env.VERCEL ? path.join('/tmp', 'anotherme-work') : path.join(process.cwd(), '.workbuddy'));

  return segment ? path.join(root, segment) : root;
}
