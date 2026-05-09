import { expect, test } from '../fixtures/base';
import { createSettingsStorage } from '../fixtures/test-data/settings';

const SETTINGS_STORAGE = createSettingsStorage({
  sidebarCollapsed: false,
  chatAreaCollapsed: true,
});

type Credentials = {
  email: string;
  password: string;
};

const DESKTOP_VIEWPORTS = [
  { name: 'desktop-wide', width: 1440, height: 900 },
  { name: 'desktop-compact', width: 1024, height: 768 },
];

async function seedAuthAndSettings(page: import('@playwright/test').Page): Promise<Credentials> {
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

  const email = `responsive-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const password = 'responsive-test-password';
  const response = await page.request.post('/api/auth/register', {
    data: {
      email,
      password,
      displayName: 'Responsive User',
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
  credentials: Credentials,
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

async function assertWheelScrollsPage(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(500, 500);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(150);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
}

test.describe('Responsive desktop scroll regression', () => {
  test('keeps dashboard pages aligned and wheel-scrollable across desktop breakpoints', async ({
    page,
  }) => {
    const credentials = await seedAuthAndSettings(page);

    for (const viewport of DESKTOP_VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await gotoProtected(page, '/settings', credentials);
      await expect(page.getByRole('heading', { name: '设置' })).toBeVisible({
        timeout: 15_000,
      });
      await assertNoHorizontalOverflow(page);
      await assertWheelScrollsPage(page);

      await gotoProtected(page, '/photo-to-video', credentials);
      await expect(page.getByRole('heading', { name: '拍照答疑' })).toBeVisible({
        timeout: 15_000,
      });
      await assertNoHorizontalOverflow(page);

      await gotoProtected(page, '/ai-tutor', credentials);
      await expect(page.getByRole('button', { name: '新对话' }).first()).toBeVisible({
        timeout: 15_000,
      });
      await assertNoHorizontalOverflow(page);
    }
  });
});
