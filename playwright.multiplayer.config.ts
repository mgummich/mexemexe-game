import { defineConfig } from '@playwright/test';

// Separate config from playwright.config.ts on purpose: the multiplayer spec spawns its own
// WS server (see e2e-multiplayer/multiplayer.spec.ts) so a server crash there can never fail
// the local `npm run verify` run, which never touches this file.
export default defineConfig({
  testDir: 'e2e-multiplayer',
  // 108-card deck means the deterministic stalemate drain takes ~94 draw rounds now
  // (was ~38 pre-adaptation) — give the single spec more room than the default 60s.
  timeout: 180_000,
  workers: 1, // single spec, single shared WS server on a fixed test port
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
