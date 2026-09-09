import fs from 'node:fs';

/**
 * Runs once per `playwright test` invocation, before any worker starts — the one point where we
 * know a genuinely fresh run is beginning. screenshot.spec.ts's afterAll merges its shots into
 * this file (Playwright starts a fresh worker process, with its own empty in-memory `logs`
 * array, after any test failure — overwriting instead of merging would let the last worker's
 * afterAll erase every shot the earlier workers already logged). Clearing here means a stale
 * entry from a previous, separate `npm run screenshot` run can never survive to silently satisfy
 * scripts/check-verify.mjs's EXPECTED_SHOTS gate.
 */
export default function globalSetup(): void {
  fs.rmSync('docs/screenshots/verify-log.json', { force: true });
}
