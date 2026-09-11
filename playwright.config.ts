import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // All 86 tests live in one file, so without this Playwright treats it as one serial worker.
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    // MEXE_NO_TRACE disables tracing for the serial @perf pass: the tracer's own overhead
    // shows up in the fps the game reports, which is exactly what those tests measure.
    trace: process.env.CI && !process.env.MEXE_NO_TRACE ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // build runs once, explicitly, as its own step in `npm run verify` — this
    // just serves the already-built dist/.
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
