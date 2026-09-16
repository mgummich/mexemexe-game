import { type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Shared harness for the multiplayer specs: one real WS server per spec file, one browser
 * context (and therefore one storage, one sessionStorage and one socket) per simulated player.
 *
 * Every spec in this directory drives the *real* server — there is no in-process fake — because
 * the invariants these suites protect (seat ownership, host authority, reconnect) only exist
 * once several independent transports are talking to one authoritative room.
 */

export const OUT_DIR = 'docs/screenshots';

export interface TestServer {
  url: string;
  stdout: string[];
  stderr: string[];
  stop: () => void;
}

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server health check timed out: ${url}`);
}

/**
 * Run the local tsx binary directly (not via `npx`/`npm run`) — npm/npx write their own
 * "notice" lines to stderr, which would otherwise look like a server error to the gate.
 */
export async function startTestServer(port: number, seed?: number): Promise<TestServer> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const proc: ChildProcessWithoutNullStreams = spawn(
    path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
    ['server/index.ts'],
    {
      cwd: process.cwd(),
      // Playwright sets NO_COLOR while its parent may carry FORCE_COLOR; Node emits that conflict
      // on server stderr and our multiplayer gate correctly treats server stderr as a failure.
      env: {
        ...process.env,
        NO_COLOR: undefined,
        FORCE_COLOR: undefined,
        PORT: String(port),
        ...(seed === undefined ? {} : { MEXE_TEST_SEED: String(seed) }),
      },
    },
  );
  proc.stdout.on('data', (d) => stdout.push(String(d)));
  proc.stderr.on('data', (d) => stderr.push(String(d)));
  await waitForHealth(`http://127.0.0.1:${port}/health`);
  // 127.0.0.1, not `localhost`: the server binds IPv4 (0.0.0.0) and Firefox resolves `localhost`
  // to ::1 first, so a `ws://localhost` URL never opens there while Chromium's fallback hides it.
  return { url: `ws://127.0.0.1:${port}`, stdout, stderr, stop: () => proc.kill('SIGTERM') };
}

export const SCALE = 1280 / 480; // logical 480x270 canvas fills the 1280x720 viewport (Scale.FIT)
export const toScreen = (lx: number, ly: number): [number, number] => [lx * SCALE, ly * SCALE];

const consoleErrorsByPage = new WeakMap<Page, string[]>();
export function trackConsoleErrors(page: Page): string[] {
  let errs = consoleErrorsByPage.get(page);
  if (!errs) {
    errs = [];
    consoleErrorsByPage.set(page, errs);
    page.on('console', (msg) => {
      if (msg.type() === 'error') errs!.push(msg.text());
    });
    page.on('pageerror', (err) => errs!.push(`pageerror: ${err.message}`));
  }
  return errs;
}

export function consoleErrorsOf(page: Page): string[] {
  return consoleErrorsByPage.get(page) ?? [];
}

/** A desktop player: own context, own storage, own socket. */
export async function newClient(browser: Browser, wsUrl: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  await page.goto(`/?ws=${encodeURIComponent(wsUrl)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  // MenuScene ONLINE button, logical (240, 254) — see MenuScene's onlineBtn.
  const [ox, oy] = toScreen(240, 254);
  await page.mouse.click(ox, oy);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });
  return page;
}

/** Same flow as `newClient`, on a phone viewport and addressing the ONLINE button through the
 *  live world size instead of the 1280x720 scale factor. */
export async function newPhoneClient(
  browser: Browser,
  wsUrl: string,
  viewport = { width: 390, height: 844 },
  extraQuery = '',
): Promise<Page> {
  const ctx = await browser.newContext({ viewport, hasTouch: true, isMobile: false });
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  await page.goto(`/?ws=${encodeURIComponent(wsUrl)}&showcase=menu${extraQuery}`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const point = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    // MenuScene's ONLINE button is authored at (240, 254) on the 480x270 grid; menu-layout maps
    // that proportionally onto whichever world is live, so the same fractions hold in portrait.
    return { x: c.left + 0.5 * c.width, y: c.top + (254 / 270) * c.height };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });
  return page;
}

export async function shot(pages: Record<string, Page>, name: string, screenshots: string[]): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, page] of Object.entries(pages)) {
    await page.waitForTimeout(200); // let tweens settle
    const file = path.join(OUT_DIR, `${name}-${key}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  }
}
