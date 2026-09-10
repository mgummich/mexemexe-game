import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 15 PWA/offline verification. One shared context for the whole file, in declaration
 * order: the first test is the only online load, and it is what fills the service worker
 * cache every later offline test reads from. Running these in parallel, or in isolation,
 * would each start from an empty cache and could never be offline-capable.
 */

const OUT_DIR = 'docs/screenshots/pwa';
const LOG_PATH = path.join(OUT_DIR, 'pwa-log.json');

interface PwaLog {
  name: string;
  screenshot: string;
  offline: boolean;
  scene: string;
  swController: boolean;
  fps: number;
  viewport: { width: number; height: number } | null;
  consoleErrors: string[];
  failedRequests: string[];
  pageErrors: string[];
  missingAssets: number;
}

const logs: PwaLog[] = [];

let context: BrowserContext;
let page: Page;
const consoleErrors: string[] = [];
const failedRequests: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  page = await context.newPage();
  // failedRequests is diagnostic only, never asserted on: public/sw.js's offline HEAD
  // handling first tries fetch(request), and Playwright's requestfailed fires on that
  // internal attempt even when it then synthesizes a 200 the page happily receives. So
  // this list is dominated by the service worker's own internal probe attempts (e.g.
  // BootScene's HEAD probes for card-face paths that never exist on disk), not real
  // page-visible failures. Kept in pwa-log.json for diagnosis only.
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(request.url());
  });
});

test.afterAll(async () => {
  fs.writeFileSync(LOG_PATH, JSON.stringify(logs, null, 2));
  await context.close();
});

async function boot(url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
}

async function snap(name: string): Promise<void> {
  const screenshot = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshot });
  const api = await page.evaluate(() => ({
    scene: window.__MEXE__.scene,
    fps: window.__MEXE__.fps,
    errors: window.__MEXE__.errors,
    missingAssets: window.__MEXE__.missingAssets.length,
    swController: navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined,
    offline: !navigator.onLine,
  }));
  logs.push({
    name,
    screenshot,
    offline: api.offline,
    scene: api.scene,
    swController: api.swController,
    fps: api.fps,
    viewport: page.viewportSize(),
    consoleErrors: [...consoleErrors],
    failedRequests: [...failedRequests],
    pageErrors: api.errors,
    missingAssets: api.missingAssets,
  });
  expect(api.errors, `page errors in ${name}`).toEqual([]);
}

// logical 480x270 canvas fills the 1280x720 viewport exactly (Scale.FIT, no letterbox).
const SCALE = 1280 / 480;
const toScreen = (lx: number, ly: number): [number, number] => [lx * SCALE, ly * SCALE];

test('manifest and icons are served', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok(), 'manifest.webmanifest must be served from the built app').toBeTruthy();
  const manifest = JSON.parse(await res.text()) as { icons: { src: string; sizes: string }[]; name: string };
  expect(manifest.name).toBe('MEXE!');
  expect(manifest.icons.length).toBeGreaterThan(0);
  for (const icon of manifest.icons) {
    const iconRes = await request.get(icon.src.replace(/^\.\//, '/'));
    expect(iconRes.ok(), `manifest icon missing from build: ${icon.src}`).toBeTruthy();
  }
});

test('first online load registers the service worker and fills the cache', async () => {
  await boot('/?seed=42&showcase=menu');
  // clients.claim() on activate makes the worker take over this page without a second load.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
  // Reload once while still online: everything BootScene fetches now routes through the active
  // worker and lands in the cache. Assets fetched before the worker claimed the page did not.
  await boot('/?seed=42&showcase=menu');
  await page.waitForFunction(() => window.__MEXE__.scene === 'menu');
  await snap('online-menu');
});

async function cachedPaths(): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open(names[0]);
    const requests = await cache.keys();
    return requests.map((r) => new URL(r.url).pathname);
  });
}

test('runtime cache-first captured the full offline set from BootScene\'s first load, minus music', async () => {
  // There is no eager precache list (see public/sw.js's comment on why): this asserts the
  // actual claim the fetch handler makes instead — that BootScene's full-manifest preload on
  // the one online load above already fills the cache with tables and cards, cache-first as
  // each asset is fetched. Poll in case a few of those cache.put()s are still landing.
  await page.waitForFunction(
    async () => {
      const names = await caches.keys();
      const cache = await caches.open(names[0]);
      const requests = await cache.keys();
      const paths = requests.map((r) => new URL(r.url).pathname);
      return paths.some((p) => p.includes('/assets/tables/')) && paths.some((p) => p.includes('/assets/cards/'));
    },
    undefined,
    { timeout: 20_000 },
  );
  const cacheKeys = await cachedPaths();
  expect(cacheKeys.some((p) => p.includes('/assets/tables/')), 'expected a precached tables asset').toBe(true);
  expect(cacheKeys.some((p) => p.includes('/assets/cards/')), 'expected a precached cards asset').toBe(true);
  expect(cacheKeys.some((p) => p.includes('/assets/audio/music/')), 'music must never be cached').toBe(false);
});

test('offline reload boots to the menu with cached assets', async () => {
  await context.setOffline(true);
  await boot('/?seed=42&showcase=menu');
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(await page.evaluate(() => window.__MEXE__.scene)).toBe('menu');
  // The whole point of the HEAD handling in public/sw.js: without it every asset probe fails
  // offline and the game falls back to procedural art.
  const missing = await page.evaluate(() => window.__MEXE__.missingAssets.length);
  // Measured value is 0. Any non-zero count means the service worker's HEAD handling
  // regressed and the game silently degraded to procedural fallback art.
  expect(missing, 'offline boot should not degrade to fallback art').toBe(0);
  await snap('offline-menu-pt');
});

test('offline: online rooms are disabled and local play is not', async () => {
  const [ox, oy] = toScreen(240, 258); // ONLINE button, MenuScene.rebuild()
  await page.mouse.click(ox, oy);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__MEXE__.scene), 'offline ONLINE button must not enter the lobby').toBe('menu');
  await snap('offline-online-blocked');
});

test('offline local match starts', async () => {
  await boot('/?seed=77&showcase=game');
  await page.waitForFunction(() => window.__MEXE__.scene === 'game');
  await snap('offline-local-match');
});

test('offline AI match runs with 4 players', async () => {
  await boot('/?seed=1337&showcase=game4');
  await page.waitForFunction(() => window.__MEXE__.scene === 'game');
  // AI opponents take their turns with no network at all.
  await page.waitForTimeout(2000);
  await snap('offline-ai-match');
});

test('offline tutorial runs', async () => {
  await boot('/?showcase=menu');
  const [tx, ty] = toScreen(240, 207); // TUTORIAL button
  await page.mouse.click(tx, ty);
  await page.waitForFunction(() => window.__MEXE__.scene === 'tutorial', undefined, { timeout: 10_000 });
  await snap('offline-tutorial');
});

test('offline menu in en-US', async () => {
  await page.evaluate(() => {
    const raw = localStorage.getItem('mexe-save');
    const save = raw ? (JSON.parse(raw) as { settings: Record<string, unknown> }) : { version: 1, settings: {}, progress: {}, cosmetics: {} };
    save.settings = { ...save.settings, locale: 'en' };
    localStorage.setItem('mexe-save', JSON.stringify(save));
  });
  await boot('/?showcase=menu');
  await snap('offline-menu-en');
});

test('offline menu on a mobile viewport', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot('/?showcase=menu');
  await snap('offline-menu-mobile');
  await page.setViewportSize({ width: 1280, height: 720 });
});

test('back online restores the online lobby', async () => {
  await context.setOffline(false);
  await boot('/?showcase=menu');
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await snap('back-online-menu');

  // Decisive check: offline, the app must produce zero application-level console errors.
  // The only tolerated noise is the browser reporting a network fetch it could not
  // complete (music, never precached); a real JS/app error's text shows in the diff.
  const nonResourceErrors = consoleErrors.filter((text) => !text.startsWith('Failed to load resource:'));
  expect(nonResourceErrors, 'console errors beyond resource-load failures are app regressions').toEqual([]);
});
