import { expect, test } from '../fixtures/base';
import { createSettingsStorage } from '../fixtures/test-data/settings';
import { defaultTheme } from '../fixtures/test-data/scene-content';

const SETTINGS_STORAGE = createSettingsStorage({
  sidebarCollapsed: false,
  chatAreaCollapsed: true,
});
const TEST_STAGE_ID = 'mobile-smoke-stage';

const MOBILE_VIEWPORTS = [
  { name: 'iphone-se-large', width: 375, height: 812 },
  { name: 'iphone-regular', width: 390, height: 844 },
  { name: 'android-large', width: 430, height: 932 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
];

async function seedAuthAndSettings(page: import('@playwright/test').Page) {
  await page.addInitScript((settings) => {
    localStorage.setItem('settings-storage', settings);
  }, SETTINGS_STORAGE);

  await page.route('**/api/health', (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, status: 'ok', version: 'e2e' }),
    });
  });

  const email = `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'mobile-test-password';
  const response = await page.request.post('/api/auth/register', {
    data: {
      email,
      password,
      displayName: 'Mobile User',
    },
  });
  expect(response.ok()).toBeTruthy();
  const sessionValue = /anotherme_session=([^;]+)/.exec(
    response.headers()['set-cookie'] || '',
  )?.[1];
  expect(sessionValue).toBeTruthy();
  await addSessionCookie(page, sessionValue!);

  return { email, password };
}

async function addSessionCookie(page: import('@playwright/test').Page, sessionValue: string) {
  await page.context().addCookies([
    {
      name: 'anotherme_session',
      value: sessionValue,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
    },
  ]);
}

async function gotoProtected(
  page: import('@playwright/test').Page,
  path: string,
  credentials: { email: string; password: string },
) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const loginHeading = page.getByRole('heading', { name: '欢迎回来' });
  if (!(await loginHeading.isVisible({ timeout: 1_000 }).catch(() => false))) {
    return;
  }

  const response = await page.request.post('/api/auth/login', { data: credentials });
  expect(response.ok()).toBeTruthy();
  const sessionValue = /anotherme_session=([^;]+)/.exec(
    response.headers()['set-cookie'] || '',
  )?.[1];
  expect(sessionValue).toBeTruthy();
  await addSessionCookie(page, sessionValue!);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
}

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    return scrollWidth - width;
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

async function mockLiveBook(page: import('@playwright/test').Page) {
  const now = Date.now();
  const book = {
    id: 'book-1',
    title: '移动端活书',
    topic: '函数与图像',
    language: 'zh-CN',
    targetLevel: '初中',
    status: 'ready',
    proposal: {
      title: '移动端活书',
      description: '用于移动端 smoke test',
      scope: '基础概念',
      targetLevel: '初中',
      estimatedChapters: 1,
      rationale: 'e2e',
    },
    chapters: [
      {
        id: 'chapter-1',
        title: '一次函数',
        goal: '理解一次函数图像和表达式',
        order: 1,
        learningObjectives: ['识别斜率', '判断截距'],
        prerequisites: ['坐标系'],
        summary: '一次函数移动端阅读',
      },
    ],
    pages: [
      {
        id: 'page-1',
        chapterId: 'chapter-1',
        title: '函数图像入门',
        order: 1,
        status: 'ready',
        blocks: [
          {
            id: 'block-1',
            type: 'text',
            title: '核心概念',
            content: '一次函数的图像是一条直线。',
            status: 'ready',
          },
        ],
      },
    ],
    progress: {
      currentPageId: 'page-1',
      visitedPageIds: [],
      bookmarkedPageIds: [],
      quizAttempts: [],
      weakChapterIds: [],
      score: 0,
      updatedAt: now,
    },
    quality: {
      compileTotal: 1,
      compileFailed: 0,
      blockErrors: 0,
      supplementHits: 0,
    },
    createdAt: now,
    updatedAt: now,
  };

  await page.route('**/api/live-book/books/book-1/insights', (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        insights: {
          weakProfile: { weakChapters: [], weakPoints: [] },
          reviewPath: [],
          quality: {
            compileFailureRate: 0,
            blockErrorRate: 0,
            supplementHitRate: 0,
            compileTotal: 1,
            compileFailed: 0,
            blockErrors: 0,
            supplementHits: 0,
          },
          progress: {
            score: 0,
            quizTotal: 0,
            quizCorrect: 0,
            visitedPages: 0,
            totalPages: 1,
          },
        },
      }),
    });
  });

  await page.route('**/api/live-book/books/book-1/health', (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        health: {
          stalePageIds: [],
          driftPageIds: [],
          driftReasonByPageId: {},
          errorPageIds: [],
          partialPageIds: [],
          pendingPageIds: [],
          blockErrorCount: 0,
          staleCount: 0,
          driftCount: 0,
          ok: true,
        },
      }),
    });
  });

  await page.route('**/api/live-book/books/book-1', (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, book }),
    });
  });

  await page.route('**/api/live-book/books', (route) => {
    route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        books: [
          {
            id: book.id,
            title: book.title,
            topic: book.topic,
            status: book.status,
            chapterCount: 1,
            pageCount: 1,
            updatedAt: now,
          },
        ],
      }),
    });
  });
}

async function seedClassroom(page: import('@playwright/test').Page, stageId: string) {
  const now = Date.now();
  const response = await page.request.post('/api/classroom', {
    data: {
      stage: {
        id: stageId,
        name: '移动端课堂',
        description: '',
        language: 'zh-CN',
        style: 'professional',
        createdAt: now,
        updatedAt: now,
      },
      scenes: [
        {
          id: 'scene-1',
          stageId,
          type: 'slide',
          title: '函数图像',
          order: 0,
          content: {
            type: 'slide',
            canvas: {
              id: 'slide-1',
              viewportSize: 1000,
              viewportRatio: 0.5625,
              theme: defaultTheme,
              elements: [
                {
                  type: 'text',
                  id: 'title-1',
                  content: '函数图像',
                  left: 80,
                  top: 80,
                  width: 840,
                  height: 100,
                },
              ],
            },
          },
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('Mobile smoke layout', () => {
  test.setTimeout(180_000);

  test('core mobile flows fit the viewport and expose primary controls', async ({ page }) => {
    const credentials = await seedAuthAndSettings(page);

    for (const viewport of MOBILE_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const stageId = `${TEST_STAGE_ID}-${viewport.name}`;

      await gotoProtected(page, '/photo-to-video', credentials);
      await expect(page.getByRole('heading', { name: '拍照答疑' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole('button', { name: /生成讲解视频/ })).toBeVisible();
      await assertNoHorizontalOverflow(page);

      await gotoProtected(page, '/settings', credentials);
      await expect(page.getByRole('heading', { name: '设置' })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /AI 偏好/ }).click();
      await assertNoHorizontalOverflow(page);

      await gotoProtected(page, '/ai-tutor', credentials);
      if (viewport.width < 768) {
        await expect(page.getByRole('button', { name: '打开会话列表' })).toBeVisible({
          timeout: 15_000,
        });
        await page.getByRole('button', { name: '打开会话列表' }).click();
        await expect(page.getByRole('button', { name: '关闭会话列表', exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: '新对话' }).first()).toBeVisible({
          timeout: 15_000,
        });
      }
      await assertNoHorizontalOverflow(page);

      await mockLiveBook(page);
      await gotoProtected(page, '/live-book?bookId=book-1', credentials);
      await expect(page.getByText('一次函数的图像是一条直线。')).toBeVisible();
      if (viewport.width < 768) {
        await page.getByRole('button', { name: '目录' }).click();
        await expect(page.getByRole('button', { name: '关闭目录', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '关闭目录', exact: true }).click();
        await page.getByRole('button', { name: '问答' }).click();
        await expect(page.getByRole('button', { name: '关闭页内问答', exact: true })).toBeVisible();
      }
      await assertNoHorizontalOverflow(page);

      await seedClassroom(page, stageId);
      await gotoProtected(page, `/classroom/${stageId}`, credentials);
      if (viewport.width < 768) {
        await expect(page.getByRole('button', { name: 'Toggle sidebar' })).toBeVisible();
        await page.getByRole('button', { name: 'Toggle sidebar' }).click();
        await expect(page.getByTestId('scene-title').last()).toBeVisible();
        const closeSceneDrawer = page
          .getByRole('button', { name: '关闭场景列表', exact: true })
          .last();
        await expect(closeSceneDrawer).toBeVisible();
        await closeSceneDrawer.click();
        await page.getByRole('button', { name: 'Toggle chat' }).click();
        await expect(
          page.getByRole('button', { name: '关闭聊天', exact: true }).last(),
        ).toBeVisible();
      } else {
        await expect(page.getByTestId('scene-title').first()).toBeVisible();
      }
      await assertNoHorizontalOverflow(page);
    }
  });
});
