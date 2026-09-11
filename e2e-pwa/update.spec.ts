import { expect, test } from '@playwright/test';
import fs from 'node:fs';

/**
 * Phase 23: the two service-worker lifecycle claims src/core/pwa.ts makes that the offline
 * suite never exercised — the first install must not reload the page out from under a cold
 * boot, and a newly available build must surface the update banner without reloading anything
 * until the player taps it.
 *
 * Each test uses its own fresh context: Playwright gives a new context an empty cache and no
 * registration, which is the only way to observe a *first* install. Kept in a separate file
 * from offline.spec.ts so it can't disturb that file's shared, deliberately-ordered context.
 */

const SW_PATH = 'dist/sw.js';

test('first install does not reload the page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });

  await page.goto('/?seed=42&showcase=menu');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  // sw.js's activate calls clients.claim(), so this page gets a controller with no second load.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });
  // A controllerchange-triggered reload would land immediately after the claim above.
  await page.waitForTimeout(1500);

  expect(navigations, 'clients.claim() on first install must not reload the page').toBe(1);
  expect(await page.evaluate(() => window.__MEXE__.scene)).toBe('menu');
  await context.close();
});

test('a waiting update shows the banner and only reloads when tapped', async ({ browser }) => {
  const original = fs.readFileSync(SW_PATH, 'utf-8');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });

  const cacheNames = (): Promise<string[]> => page.evaluate(() => caches.keys());

  try {
    await page.goto('/?seed=42&showcase=menu');
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 20_000 });

    const before = await cacheNames();
    expect(before.length, 'first load should have opened exactly one versioned cache').toBe(1);

    // Stand in for a deploy: change the served worker so the browser sees a byte difference
    // and installs it. dist/sw.js is what `npm run preview` serves; restored in finally.
    fs.writeFileSync(SW_PATH, original.replace(before[0], 'mexe-v-phase23-update-test'));
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });

    const banner = page.locator('[data-mexe-banner="update"]');
    await expect(banner, 'a waiting worker must surface the update banner').toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText('Nova versão disponível');
    await expect(banner).toContainText('Atualizar agora');

    // The hard rule: an available update never takes the page (or a match) on its own.
    expect(navigations, 'an available update must not reload the page by itself').toBe(1);
    // The waiting worker's own install opens (and app-shell-precaches) its cache right away —
    // that's fine, it isn't controlling anything yet. What matters is that the old cache, the
    // one still serving this page, is untouched.
    expect(await cacheNames(), 'the old cache must still serve until the player updates').toContain(before[0]);
    expect(await page.evaluate(() => window.__MEXE__.scene)).toBe('menu');

    // Tapping is what hands over: skipWaiting -> controllerchange -> one reload.
    await banner.click();
    // Poll the navigation count rather than waiting on __MEXE__.ready, which is still true on
    // the pre-reload page and would resolve before the handover happened.
    await expect.poll(() => navigations, { timeout: 30_000 }).toBe(2);
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(
      async () => (await caches.keys()).includes('mexe-v-phase23-update-test'),
      undefined,
      { timeout: 20_000 },
    );
    // activate deletes every cache that isn't the current one — no stale build left behind.
    expect(await cacheNames()).toEqual(['mexe-v-phase23-update-test']);
    expect(await page.evaluate(() => window.__MEXE__.scene)).toBe('menu');
  } finally {
    fs.writeFileSync(SW_PATH, original);
    await context.close();
  }
});
