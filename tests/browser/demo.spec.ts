import { test, expect } from '@playwright/test';

const screens = [
  {
    path: '/demo',
    nav: 'Overview',
    title: 'Small steps. Deeper understanding.',
    image: '01-overview',
  },
  {
    path: '/demo/lesson',
    nav: 'Lesson',
    title: 'A small test. A clear promise.',
    image: '02-lesson',
  },
  {
    path: '/demo/practice',
    nav: 'Practice',
    title: 'Find the test that matters.',
    image: '03-practice',
  },
  {
    path: '/demo/progress',
    nav: 'Progress',
    title: 'See the learning, not just the clicks.',
    image: '04-progress',
  },
];
const boundaryAnswer = 'Test 49, 50 and 51 to check the boundary';

for (const screen of screens) {
  test(`sample direct entry: ${screen.nav}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const response = await page.goto(screen.path);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByText('Sample prototype · No live AI', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: screen.title, level: 1, exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Sample study' })
        .getByRole('link', { name: screen.nav, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('navigation', { name: 'Sample study' }),
    ).toHaveCSS('display', 'grid');
    await expect(page).toHaveTitle(/Fieldnotes.*Sample/);
    if (screen.nav === 'Progress')
      await expect(
        page.getByText('Illustrative progress · Sample data', { exact: true }),
      ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`${screen.image}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({
      path: info.outputPath(`${screen.image}-mobile.png`),
      fullPage: true,
    });
  });
}

test('unknown and nested demo views are not found rather than silently showing a sample', async ({
  page,
}) => {
  for (const path of [
    '/demo/unknown',
    '/demo/lesson/extra',
    '/demo/constructor',
  ]) {
    expect((await page.goto(path))?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: 'Sample page not found', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Sample prototype · No live AI', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to sample overview', exact: true }),
    ).toHaveAttribute('href', '/demo');
  }
});

test('empty and correct practice is honest assisted practice with locked answers', async ({
  page,
}, info) => {
  await page.goto('/demo/practice');
  const check = page.getByRole('button', { name: 'Check answer', exact: true });
  await expect(check).toBeDisabled();
  await expect(
    page.getByText('Choose one answer before checking.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toBeEmpty();
  await page.getByRole('radio', { name: boundaryAnswer, exact: true }).check();
  await expect(check).toBeEnabled();
  await check.click();
  await expect(page.getByRole('status')).toContainText(
    'That checks the boundary.',
  );
  await expect(page.getByRole('status')).toContainText(
    '50 is the first qualifying value',
  );
  await expect(page.getByRole('status')).toContainText(
    'Prewritten feedback · Assisted practice · No score awarded',
  );
  for (const radio of await page.getByRole('radio').all())
    await expect(radio).toBeDisabled();
  await expect(check).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: info.outputPath('practice-feedback-desktop.png'),
    fullPage: true,
  });
});

for (const answer of [
  'Test only 80 because it is a typical qualifying total',
  'Copy the implementation into the test',
]) {
  test(`incorrect practice supports retry: ${answer}`, async ({ page }) => {
    await page.goto('/demo/practice');
    await page.getByRole('radio', { name: answer, exact: true }).check();
    await page
      .getByRole('button', { name: 'Check answer', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Not quite. Here is what to look for.',
    );
    await expect(page.getByRole('status')).toContainText(
      'Prewritten feedback · Assisted practice · No score awarded',
    );
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('status')).toBeEmpty();
    await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
    await expect(page.getByRole('radio').first()).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Check answer', exact: true }),
    ).toBeDisabled();
  });
}

test('retry and refresh reset practice without changing illustrative progress', async ({
  page,
}) => {
  await page.goto('/demo/progress');
  const before = await page
    .getByRole('region', { name: 'Sample learning evidence' })
    .innerText();
  await page
    .getByRole('navigation', { name: 'Sample study' })
    .getByRole('link', { name: 'Practice', exact: true })
    .click();
  await page.getByRole('radio', { name: boundaryAnswer, exact: true }).check();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('status')).not.toBeEmpty();
  await page.reload();
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('status')).toBeEmpty();
  await expect(
    page.getByRole('button', { name: 'Check answer', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('navigation', { name: 'Sample study' })
    .getByRole('link', { name: 'Progress', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Sample learning evidence' }),
  ).toHaveText(before, { useInnerText: true });
});

test('the complete sample loop has meaningful local navigation', async ({
  page,
}) => {
  await page.goto('/demo');
  await page
    .getByRole('link', { name: 'Continue sample lesson', exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\/lesson$/);
  await page
    .getByRole('link', { name: 'Try the practice', exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\/practice$/);
  await page
    .getByRole('link', { name: 'Explore sample progress', exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo\/progress$/);
  await page
    .getByRole('link', { name: 'Back to overview', exact: true })
    .click();
  await expect(page).toHaveURL(/\/demo$/);
});

test('all screens fit 320px, 360px, tablet and desktop; practice works by keyboard with reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const screen of screens) {
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
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/demo/practice');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to sample content', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('radio', { name: boundaryAnswer, exact: true }),
  ).toBeChecked();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Check answer', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText(
    'That checks the boundary.',
  );
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Try again', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio').first()).toBeFocused();
});

test('sample navigation and practice make no API, external or failed requests and preserve security headers', async ({
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
  const response = await page.goto('/demo');
  expect(response?.headers()['content-security-policy']).toContain(
    "connect-src 'self'",
  );
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  for (const screen of screens) {
    await page
      .getByRole('navigation', { name: 'Sample study' })
      .getByRole('link', { name: screen.nav, exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: screen.title, exact: true }),
    ).toBeVisible();
    if (screen.nav === 'Practice') {
      await page
        .getByRole('radio', { name: boundaryAnswer, exact: true })
        .check();
      await page
        .getByRole('button', { name: 'Check answer', exact: true })
        .click();
      await expect(page.getByRole('status')).toContainText(
        'That checks the boundary.',
      );
      await page
        .getByRole('button', { name: 'Try again', exact: true })
        .click();
    }
  }
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
