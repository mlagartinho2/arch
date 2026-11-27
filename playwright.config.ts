import { defineConfig, devices } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

/**
 * Browser tests against the built app in demo mode (the in-memory fake GitLab), so they need no
 * GitLab and no network. `npm run test:e2e` builds, serves dist/ with `vite preview` and runs them.
 *
 * Browser: Playwright's own Chromium (`npx playwright install chromium` once). To use an installed
 * Chrome instead, set ARCH_E2E_CHROME to its executable path.
 */
const PORT = Number(process.env.ARCH_E2E_PORT ?? 4174);
const chrome = process.env.ARCH_E2E_CHROME;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Europe/Zurich',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...(chrome ? { launchOptions: { executablePath: chrome } } : {}) } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
