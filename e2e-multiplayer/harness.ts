import { type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
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

/**
 * A port nothing else is listening on, handed over by the OS (`listen(0)`), then released.
 *
 * The probe binds **127.0.0.1**, which is the half that matters: the machine-specific version of
 * this bug was a loopback-only squatter (a proxy on `127.0.0.1:8787`) sitting under a test server
 * that had bound `0.0.0.0:8787` quite happily — the Node-side health check passed and the
 * browser's `ws://127.0.0.1` reached the proxy instead, so the only symptom was a client that
 * never reached status `open`. A port that is free on loopback cannot be taken that way.
 *
 * Fixed port blocks are what made a Firefox failure here unreadable: something else on the
 * machine (a local proxy on 8787, or a server left behind by a killed run) already owned the
 * port, our server died on EADDRINUSE, and the health probe then answered **from that other
 * process** — so the suite ran happily against a stranger and reported a WebSocket failure as a
 * lobby bug. There is a theoretical race between releasing this port and the server claiming it;
 * it is far narrower than a shared fixed block, and `startTestServer` now fails loudly rather
 * than silently attaching to whatever answers.
 */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      if (addr === null || typeof addr === 'string') {
        probe.close(() => reject(new Error('could not allocate a port')));
        return;
      }
      probe.close(() => resolve(addr.port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server health check timed out: ${url} (last: ${last})`);
}

/**
 * Run the local tsx binary directly (not via `npx`/`npm run`) — npm/npx write their own
 * "notice" lines to stderr, which would otherwise look like a server error to the gate.
 */
export async function startTestServer(
  port: number,
  seed?: number,
  extraEnv: Record<string, string> = {},
): Promise<TestServer> {
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
        ...extraEnv,
      },
    },
  );
  proc.stdout.on('data', (d) => stdout.push(String(d)));
  proc.stderr.on('data', (d) => stderr.push(String(d)));
  // A server that cannot bind must fail the test *as a bind failure*. Before this, the child died
  // on EADDRINUSE and the health probe was answered by whatever else held the port, so the suite
  // ran against a foreign process and the first symptom was an unexplained WebSocket timeout in
  // whichever engine happened to run next (Firefox, in the known 8787 case).
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  proc.on('exit', (code, signal) => { exited = { code, signal }; });
  const detail = (): string => `port ${port}\n--- server stdout ---\n${stdout.join('')}\n--- server stderr ---\n${stderr.join('')}`;
  try {
    await Promise.race([
      waitForHealth(`http://127.0.0.1:${port}/health`),
      new Promise((_, reject) => {
        proc.once('exit', (code, signal) => reject(
          new Error(`test server exited before it was healthy (code=${String(code)} signal=${String(signal)}) on ${detail()}`),
        ));
      }),
    ]);
  } catch (err) {
    proc.kill('SIGKILL');
    throw new Error(`${String(err)}\n${detail()}`);
  }
  if (exited !== null) throw new Error(`test server exited during startup on ${detail()}`);
  // The health probe proves *a* server answers; this proves it is ours. `server_listening` is
  // logged by server/index.ts on this process's own stdout when its listen callback fires — it
  // can land a tick after the first health response, so give it a moment before calling it a
  // foreign server.
  for (let i = 0; i < 20 && !stdout.join('').includes('server_listening'); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!stdout.join('').includes('server_listening')) {
    throw new Error(`health check answered but this process never logged server_listening — another server owns ${detail()}`);
  }
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
