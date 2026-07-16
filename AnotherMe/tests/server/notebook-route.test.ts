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

  it('supports user-scoped notebooks and server-side records', async () => {
    const { POST: createNotebook, GET: listNotebooks } = await import('@/app/api/notebooks/route');
    const { GET: getNotebook } = await import('@/app/api/notebooks/[notebookId]/route');
    const { POST: addRecord, GET: listRecords } = await import('@/app/api/notebooks/[notebookId]/records/route');

    const createResponse = await createNotebook(
      new NextRequest('http://localhost/api/notebooks?userId=user-a', {
        method: 'POST',
        body: JSON.stringify({ id: 'math', name: 'Math Notes' }),
      }),
    );
    const recordResponse = await addRecord(
      new NextRequest('http://localhost/api/notebooks/math/records?userId=user-a', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Functions',
          content: 'A function maps every input to exactly one output.',
          tags: ['algebra'],
          subject: 'Math',
        }),
      }),
      { params: Promise.resolve({ notebookId: 'math' }) },
    );
    const listResponse = await listNotebooks(
      new NextRequest('http://localhost/api/notebooks?userId=user-a'),
    );
    const detailResponse = await getNotebook(
      new NextRequest('http://localhost/api/notebooks/math?userId=user-a'),
      { params: Promise.resolve({ notebookId: 'math' }) },
    );
    const recordsResponse = await listRecords(
      new NextRequest('http://localhost/api/notebooks/math/records?userId=user-a'),
      { params: Promise.resolve({ notebookId: 'math' }) },
    );

    const createJson = await createResponse.json();
    const recordJson = await recordResponse.json();
    const listJson = await listResponse.json();
    const detailJson = await detailResponse.json();
    const recordsJson = await recordsResponse.json();

    expect(createResponse.status).toBe(201);
    expect(createJson.notebook.name).toBe('Math Notes');
    expect(recordResponse.status).toBe(201);
    expect(recordJson.record.notebookId).toBe('math');
    expect(listJson.notebooks.find((book: { id: string }) => book.id === 'math').recordCount).toBe(1);
    expect(detailJson.records).toHaveLength(1);
    expect(recordsJson.records[0].title).toBe('Functions');
  });
});
