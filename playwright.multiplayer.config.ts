import { defineConfig, devices } from '@playwright/test';

// Separate config from playwright.config.ts on purpose: the multiplayer spec spawns its own
// WS server (see e2e-multiplayer/multiplayer.spec.ts) so a server crash there can never fail
// the local `npm run verify` run, which never touches this file.
export default defineConfig({
  testDir: 'e2e-multiplayer',
  globalSetup: './e2e-multiplayer/global-setup.ts',
  // 108-card deck means the deterministic stalemate drain takes ~94 draw rounds now
  // (was ~38 pre-adaptation) — give the single spec more room than the default 60s.
  timeout: 180_000,
  // Both specs are `mode: 'parallel'` and every worker spawns its own server on its own port
  // (8799+ / 8810+ / 8820+ per parallelIndex — see the port-block map at the top of
  // multiplayer.spec.ts), which is what took this suite off the PR critical path.
  //
  // Two, not three. Three was measured at 4.6m locally but read 16.1m on a shared ubuntu-latest
  // runner — no gain at all over the serial run it replaced — and starved the three heaviest
  // tests into their own timeouts (LB-18/LB-20 and OD-28/OD-29 past 180s, the LB-19..LB-24
  // three-match endurance run past 300s), while lighter tests that normally take seconds took
  // over a minute. Every test here drives 2-4 browser contexts plus a server against 4 shared
  // cores, so the third worker only added contention. Raising the timeouts instead would have
  // hidden the contention rather than fixed it.
  workers: 2,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    // Tracing this suite costs real wall clock — measured on ubuntu-latest, `verify:multiplayer`
    // went 2m14 -> 5m02 with it on — so the PR run stays untraced and leans on what this suite
    // already captures on failure: server stderr, client console/page errors, 19 screenshots and
    // verify-multiplayer-log.json. The nightly run sets MEXE_TRACE=1 instead, where the tracer's
    // slowdown is a feature: it is what exposed the double-click create_room race (the guard was
    // cleared by room_joined landing between two clicks) that no fast machine ever reproduced.
    trace: process.env.MEXE_TRACE ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
  },
  // Chromium runs the whole suite. Firefox and WebKit run the lobby state-machine suite (and,
  // for WebKit, the iOS-viewport one): a Chrome PASS is not evidence for either engine's
  // WebSocket lifecycle, storage or orientation behaviour, and those are exactly where the
  // lobby's invariants live. Each spec file starts its own server on its own port.
  projects: [
    // iOS viewports are WebKit's gate; running them on Chrome too would prove nothing extra.
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /ios-lobby\.spec\.ts$/ },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /[/\\]lobby\.spec\.ts$/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /[/\\](lobby|ios-lobby)\.spec\.ts$/ },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
