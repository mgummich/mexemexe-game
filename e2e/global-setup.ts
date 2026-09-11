import fs from 'node:fs';

/**
 * Runs once per `playwright test` invocation, before any worker starts. screenshot.spec.ts's
 * afterAll writes one shard per worker under docs/screenshots/verify-log-parts/ (no shared-file
 * merge, so concurrent workers never race); scripts/check-verify.mjs merges every shard into
 * verify-log.json. Clearing the parts dir here means a stale shard from a previous, separate run
 * can never survive to silently satisfy scripts/check-verify.mjs's EXPECTED_SHOTS gate.
 *
 * `npm run screenshot` (and the CI e2e job) invoke this file twice — a parallel pass over
 * everything except @perf-tagged tests, then a serial `--workers=1` pass over just the @perf
 * tests, which measure fps and would be skewed by parallel load. The second invocation sets
 * MEXE_KEEP_VERIFY_LOG so this clear is skipped, and its shard(s) simply add to the first pass's
 * instead of wiping them.
 */
export default function globalSetup(): void {
  if (process.env.MEXE_KEEP_VERIFY_LOG) return;
  fs.rmSync('docs/screenshots/verify-log.json', { force: true });
  fs.rmSync('docs/screenshots/verify-log-parts', { force: true, recursive: true });
}
