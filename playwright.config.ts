import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // All 86 tests live in one file, so without this Playwright treats it as one serial worker.
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Measured on ubuntu-latest for this 83-test suite: serial+trace 7m49, serial no-trace 5m16,
  // parallel no-trace 4m40. Tracing costs ~48% wall clock on every green run, and it was the
  // difference between the fps gates passing and failing (42 vs 50, 16 vs 20 — the tracer's own
  // overhead was eating the frame budget those tests measure). 'on-first-retry' costs nothing
  // when the suite is green and still captures a full trace the moment something actually
  // failed once — which needs a retry to exist at all, hence retries below. Note: a test that
  // fails once and passes on retry still shows up as flaky in the report, so this doesn't hide
  // the signal that made part 1's race diagnosable.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    // MEXE_NO_TRACE disables tracing for the serial @perf pass: the tracer's own overhead
    // shows up in the fps the game reports, which is exactly what those tests measure.
    trace: process.env.MEXE_NO_TRACE ? 'off' : 'on-first-retry',
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
