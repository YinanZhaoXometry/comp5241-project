import { test, expect } from '@playwright/test';

// Static product pages from the 2026-10-23 visual spine revision. Screens
// without business logic are styled static pages: they must render, stay
// silent (no API/external/failed requests, no console errors), hold every
// tested width without horizontal overflow, and honor the shell keyboard
// contract (skip link first, main focusable).

const learnerPages = [
  { path: '/library', nav: 'Library', h1: 'Saved studies' },
  { path: '/course', nav: null, h1: 'The hillside you can’t see' },
  { path: '/practice', nav: null, h1: 'Practice & recall' },
  { path: '/progress', nav: 'Progress', h1: 'See the learning, not just the clicks.' },
  { path: '/recovery', nav: null, h1: 'Check your understanding' },
  { path: '/roadmap', nav: 'Roadmap', h1: 'Roadmap' },
  { path: '/review', nav: 'Review inbox', h1: 'Review inbox' },
  { path: '/why', nav: null, h1: 'Why this study works this way' },
  { path: '/starting-check', nav: null, h1: 'A quick starting check' },
  { path: '/plan-ai', nav: null, h1: 'New study — Goal & plan' },
  { path: '/data', nav: 'Privacy & data', h1: 'Your data' },
];
const instructorPages = [
  { path: '/instructor/courses', nav: 'Courses', h1: 'Courses' },
  { path: '/instructor/approvals', nav: 'Approvals', h1: 'Approvals' },
  { path: '/instructor/students', nav: 'Students', h1: 'Students' },
  { path: '/instructor/participation', nav: 'Participation', h1: 'Participation' },
];
const pages = [...learnerPages, ...instructorPages];

for (const screen of pages) {
  test(`static page renders: ${screen.path}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = await page.goto(screen.path);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: screen.h1, level: 1, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Skip to content', exact: true }),
    ).toBeVisible();
    if (screen.nav) {
      const navName = screen.path.startsWith('/instructor/')
        ? 'Instructor studio'
        : 'Primary';
      const link = page
        .getByRole('navigation', { name: navName })
        .getByRole('link', { name: screen.nav, exact: true });
      await expect(link).toHaveAttribute('aria-current', 'page');
    }
  });
}

test('every page fits 320px, 360px, tablet and desktop without overflow', async ({
  page,
}) => {
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of pages) {
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${screen.path} at ${width}px`,
      ).toBe(true);
    }
  }
});

test('shell keyboard contract: skip link first, main focusable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/library');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});

test('pages make no API, external or failed requests and preserve security headers', async ({
  page,
}) => {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) =>
    errors.push(`Failed ${new URL(request.url()).pathname}`),
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== 'http://127.0.0.1:3000' ||
      url.pathname.startsWith('/api/') ||
      route.request().method() !== 'GET'
    ) {
      unexpected.push(
        `${route.request().method()} ${url.origin}${url.pathname}`,
      );
      await route.abort();
    } else await route.continue();
  });
  const response = await page.goto('/library');
  expect(response?.headers()['content-security-policy']).toContain(
    "connect-src 'self'",
  );
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  for (const screen of pages) {
    await page.goto(screen.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('unknown product paths are not found', async ({ page }) => {
  for (const path of ['/nowhere', '/instructor/nowhere', '/library/extra']) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
});
