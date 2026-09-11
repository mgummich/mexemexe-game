import { defineConfig, devices } from '@playwright/test';

/** Cross-browser layout gate — see e2e-cross/layout.spec.ts. Separate from playwright.config.ts
 * so the chromium-only screenshot/verify suite stays a single fast pass. */
export default defineConfig({
  testDir: 'e2e-cross',
  timeout: 60_000,
  // The mobile-gameplay specs drive real taps through WebKit's touch emulation, which drops
  // an occasional pointer event on a loaded CI runner: three consecutive runs each lost a tap
  // in a *different* spec (ios safari select/deselect, then ipad tap-to-table), while every
  // run passed locally and each failing spec passed on isolated rerun. One retry in CI covers
  // that event loss; a genuine regression fails both attempts. Locally retries stay at 0 so a
  // flake is visible while developing, not silently absorbed.
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'safari', use: { ...devices['Desktop Safari'] } },
    { name: 'android chrome', use: { ...devices['Pixel 7 landscape'] } },
    { name: 'ios safari', use: { ...devices['iPhone 14 landscape'] } },
    // Portrait is a real authored world (270x480), not a rotate-me placeholder, so it gets the
    // same fit/centre/aspect gate as landscape. Tablet covers the 768-1199 band.
    { name: 'android chrome portrait', use: { ...devices['Pixel 7'] } },
    { name: 'ios safari portrait', use: { ...devices['iPhone 14'] } },
    { name: 'ipad', use: { ...devices['iPad (gen 7)'] } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
