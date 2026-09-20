import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The static host's headers are a control with no other test behind it: `npm run verify` serves
 * `dist/` through Vite's preview server, and the nginx image is built at release time, so a
 * deleted `add_header` would ship silently. Phase 80 added them (docs/THREAT_MODEL.md TM-15);
 * this is what notices if they leave.
 *
 * The CSP itself was exercised against the built app in a browser with these exact headers — the
 * app boots, deals and plays a turn with no refusal and no missing asset. That evidence lives in
 * docs/ROADMAP_STATUS.json; a browser run cannot be cheap enough to keep here.
 */
describe('nginx.conf keeps the headers the threat model relies on', () => {
  const conf = fs.readFileSync('nginx.conf', 'utf8');
  const header = (name: string): string | null => {
    const m = conf.match(new RegExp(`add_header\\s+${name}\\s+"([^"]*)"\\s+always;`, 'i'));
    return m?.[1] ?? null;
  };

  it('serves a content security policy with no script escape hatch', () => {
    const csp = header('Content-Security-Policy');
    expect(csp, 'Content-Security-Policy add_header').not.toBeNull();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // 'unsafe-inline' is allowed for style only (the inline boot stylesheet and the overlay
    // plates); a script-src that gains it, or any 'unsafe-eval', is a regression.
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp?.match(/script-src[^;]*/)?.[0]).not.toContain("'unsafe-inline'");
  });

  it('sets nosniff, no referrer and denies framing', () => {
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('X-Frame-Options')).toBe('DENY');
  });

  it('still logs no access lines — the privacy decision this file exists for', () => {
    expect(conf).toMatch(/access_log\s+off;/);
    expect(conf).toMatch(/error_log\s+\S+\s+crit;/);
  });
});
