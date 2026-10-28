import { test as base, expect, type Page } from '@playwright/test';

// What every e2e spec shares: the `test` that fails on console errors and failed requests, and opening the panel.
// Specs import `test` and `expect` from here, not from Playwright. One spec file per feature: add a feature's tests to
// its own file, never to smoke.spec.ts.

export { expect };

// Every test fails on a console error, an uncaught exception, or a request to the office that failed.
export const test = base.extend<{ page: Page }>({
  page: async ({ page, baseURL }, use) => {
    const problems: string[] = [];
    // Only the office itself is under test: stub anything external (the Google Fonts stylesheet) so the result
    // doesn't depend on the network.
    await page.route(
      (url) => !url.href.startsWith(baseURL!) && !url.protocol.startsWith('data'),
      (route) => route.fulfill({ status: 200, body: '' }),
    );
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.method()} ${r.url()} (${r.failure()?.errorText})`));
    page.on('response', (r) => {
      if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
    });
    await use(page);
    expect(problems, 'console errors or failed requests').toEqual([]);
  },
});

/** Loads the control panel and, on a fresh office, skips the setup wizard with its defaults. */
export async function openPanel(page: Page, hash = '') {
  await page.goto(`/?view=panel${hash}`);
  const skipSetup = page.getByRole('button', { name: /saltar la configuración/i });
  const heading = page.getByRole('heading', { level: 1 }).first();
  await expect(heading.or(skipSetup)).toBeVisible();
  if (await skipSetup.isVisible()) await skipSetup.click();
  await expect(page.getByRole('complementary', { name: 'Navegación' })).toBeVisible();
}
