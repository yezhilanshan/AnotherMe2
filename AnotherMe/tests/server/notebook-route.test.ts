import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('notebook backup route', () => {
  let dataDir: string;

  beforeEach(async () => {
    vi.resetModules();
    dataDir = await mkdtemp(path.join(tmpdir(), 'anotherme-notebook-test-'));
    vi.stubEnv('RUNTIME_DATA_DIR', dataDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns an empty snapshot before any client backup exists', async () => {
    const { GET } = await import('@/app/api/notebook/route');

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      version: 1,
      updatedAt: 0,
      notes: [],
      trash: [],
      books: [],
      settings: null,
    });
  });

  it('stores and returns the latest notebook snapshot', async () => {
    const { GET, PUT } = await import('@/app/api/notebook/route');
    const request = new NextRequest('http://localhost/api/notebook', {
      method: 'PUT',
      body: JSON.stringify({
        version: 1,
        notes: [
          {
            id: 'note-1',
            notebookId: 'default',
            type: 'manual',
            title: 'Algebra',
            content: 'Quadratic notes',
            tags: ['math'],
            subject: 'Math',
            source: 'manual',
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        trash: [],
        books: [
          {
            id: 'default',
            name: 'Default',
            recordCount: 1,
            createdAt: 100,
            updatedAt: 200,
          },
        ],
        settings: {
          id: 'default',
          sortBy: 'updatedAt',
          sortOrder: 'desc',
          viewMode: 'grid',
          activeNotebookId: 'default',
        },
      }),
    });

    const putResponse = await PUT(request);
    const putJson = await putResponse.json();
    const getResponse = await GET();
    const snapshot = await getResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putJson.ok).toBe(true);
    expect(snapshot.notes).toHaveLength(1);
    expect(snapshot.notes[0].title).toBe('Algebra');
    expect(snapshot.books[0].recordCount).toBe(1);
    expect(snapshot.settings.activeNotebookId).toBe('default');
    expect(snapshot.updatedAt).toBeGreaterThan(0);
  });
});
