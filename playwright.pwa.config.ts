import { defineConfig } from '@playwright/test';

/**
 * PWA/offline verification against the *built* client, because the service worker only
 * registers in a production build (see src/core/pwa.ts) — the dev server deliberately has
 * none. Separate from playwright.config.ts on purpose: that config's globalSetup clears
 * docs/screenshots/verify-log.json, which these tests must not touch.
 *
 * Serial, single worker: every test in the offline file shares one browser context so the
 * first (online) load is what populates the service worker cache the later offline tests
 * read from.
 */
export default defineConfig({
  testDir: 'e2e-pwa',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // build runs as its own step in `npm run verify:pwa` — this only serves dist/.
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
