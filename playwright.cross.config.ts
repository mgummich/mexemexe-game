import { defineConfig, devices } from '@playwright/test';

/** Cross-browser layout gate — see e2e-cross/layout.spec.ts. Separate from playwright.config.ts
 * so the chromium-only screenshot/verify suite stays a single fast pass. */
export default defineConfig({
  testDir: 'e2e-cross',
  timeout: 60_000,
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
