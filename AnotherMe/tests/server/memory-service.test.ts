import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('memory service and route', () => {
  let workDir: string;

  beforeEach(async () => {
    vi.resetModules();
    workDir = await mkdtemp(path.join(tmpdir(), 'anotherme-memory-test-'));
    vi.stubEnv('RUNTIME_WORK_DIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(workDir, { recursive: true, force: true });
  });

  it('builds persistent memory context from refreshed chat turns', async () => {
    const { refreshMemoryFromTurn, buildMemoryContext } = await import('@/lib/server/memory-service');

    await refreshMemoryFromTurn({
      userId: 'student-1',
      userMessage: '我总是不会构造辅助线',
      assistantMessage: '先找相等角和可构造的相似三角形。',
      topic: '几何辅助线',
      source: 'chat',
    });

    const context = await buildMemoryContext('student-1');

    expect(context).toContain('Persistent Student Profile');
    expect(context).toContain('Learning Journey Summary');
    expect(context).toContain('几何辅助线');
  });

  it('supports GET PUT POST through /api/memory', async () => {
    const { GET, PUT, POST } = await import('@/app/api/memory/route');

    const putResponse = await PUT(
      new NextRequest('http://localhost/api/memory?userId=student-2', {
        method: 'PUT',
        body: JSON.stringify({
          profile: '# Student Profile\n- Learning preferences: likes examples',
          summary: '',
        }),
      }),
    );
    const postResponse = await POST(
      new NextRequest('http://localhost/api/memory?userId=student-2', {
        method: 'POST',
        body: JSON.stringify({
          userMessage: '二次函数顶点式怎么用？',
          assistantMessage: '先把表达式配方，再读取顶点坐标。',
          topic: '二次函数',
        }),
      }),
    );
    const getResponse = await GET(new NextRequest('http://localhost/api/memory?userId=student-2'));

    const putJson = await putResponse.json();
    const postJson = await postResponse.json();
    const getJson = await getResponse.json();

    expect(putJson.profile).toContain('likes examples');
    expect(postJson.summary).toContain('二次函数');
    expect(getJson.profile).toContain('Recent activity');
  });
});
