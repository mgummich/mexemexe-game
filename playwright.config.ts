import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  // All 86 tests live in one file, so without this Playwright treats it as one serial worker.
  fullyParallel: true,
  timeout: 60_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  // Measured on ubuntu-latest for this 83-test suite: serial+trace 7m49, serial no-trace 5m16
  // (+48% wall clock). Tracing is also behaviour-changing, not just slow: the tracer's own
  // overhead ate into the frame budget the fps gates measure (table-zoomed read 42 vs a floor
  // of 50 while traced). So tracing is off here by default; set MEXE_TRACE=1 to get
  // 'retain-on-failure' locally when you need a trace to debug something. Nightly runs with
  // MEXE_TRACE=1 for the same suite instead.
  //
  // retries: 1 in CI, matching playwright.cross.config.ts — safe now that tracing is
  // MEXE_TRACE-gated and no longer rides on the retry mechanism. A retry absorbs a lost click on
  // a loaded shared runner (e.g. a rebuild-mid-click race in a Phaser panel), but Playwright still
  // reports a test that needed it as flaky, so the signal isn't hidden — and the nightly
  // screenshot-suite-no-retry job runs this same suite with --retries=0, so a first-attempt
  // failure there is still a hard failure.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    trace: process.env.MEXE_TRACE ? 'retain-on-failure' : 'off',
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
