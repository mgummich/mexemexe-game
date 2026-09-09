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
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
