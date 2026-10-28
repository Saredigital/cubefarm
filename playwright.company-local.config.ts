import { defineConfig, devices } from '@playwright/test';
import { installedBrowsers, pickBrowser } from './scripts/e2eSteps.mjs';

const port = Number(process.env.E2E_PORT || 4453);
if (!Number.isInteger(port) || port <= 0 || port === 4317 || port === 5317) throw new Error('Elige un puerto de prueba aislado.');
const { browser } = pickBrowser(process.env, installedBrowsers());
process.env.E2E_COMPANY_LOCAL = '1';

// This suite starts its own empty loopback configuration server, without demo or legacy APIs.
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'company-local.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    ...(browser === 'chrome' ? { channel: 'chrome' } : {}),
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    // The temporary terminal password must not be retained in a browser trace.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
