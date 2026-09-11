/**
 * Standing guard against telemetry creeping into the client. The game has no analytics, no
 * tracking pixels, no session replay and no automatic upload of anything — this test fails the
 * build if a future change adds one, rather than leaving it to review.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|js|html)$/.test(e.name) ? [full] : [];
  });
}

const files = [...sourceFiles(path.join(ROOT, 'src')), ...sourceFiles(path.join(ROOT, 'public')), path.join(ROOT, 'index.html')];

describe('client carries no telemetry', () => {
  it('references no analytics, tracking or session-replay vendor', () => {
    const vendors = [
      'google-analytics',
      'googletagmanager',
      'gtag(',
      'connect.facebook.net',
      'fbq(',
      'hotjar',
      'fullstory',
      'mixpanel',
      'segment.com',
      'sentry',
      'posthog',
      'amplitude',
      'datadog',
      'plausible',
      'matomo',
    ];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8').toLowerCase();
      for (const vendor of vendors) expect(`${path.relative(ROOT, file)}: ${text.includes(vendor)}`).toBe(`${path.relative(ROOT, file)}: false`);
    }
  });

  it('uses no fire-and-forget upload API anywhere', () => {
    // sendBeacon exists for exactly one purpose, and `new Image().src = ...` is the classic
    // tracking pixel. Neither has a legitimate use in this game.
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(`${path.relative(ROOT, file)}: ${/sendBeacon|navigator\.beacon/.test(text)}`).toBe(`${path.relative(ROOT, file)}: false`);
    }
  });

  it('never sends the play log anywhere — it has no network call at all', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/core/playlog.ts'), 'utf8');
    expect(text).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/);
  });

  it('stores no persistent diagnostic or tracking identifier', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src/core/playlog.ts'), 'utf8');
    // Session-scoped and memory-only: no storage API, and timestamps are relative, not wall clock.
    expect(text).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB|crypto\.randomUUID/);
  });
});
