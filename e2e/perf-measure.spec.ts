import { expect, test } from '@playwright/test';

/**
 * Phase 75 measurement run. Prints numbers, asserts almost nothing: budgets are
 * chosen from these, not the other way round. Delete or keep out of `npm run verify`.
 */
test('perf baseline @measure', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/?seed=42&showcase=menu');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });
  const bootMs = Date.now() - t0;
  const nav = await page.evaluate(() => {
    const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]);
    return {
      domContentLoadedMs: Math.round(e.domContentLoadedEventEnd),
      loadEventMs: Math.round(e.loadEventEnd),
      transferBytes: e.transferSize,
      paint,
    };
  });
  const heap = () => page.evaluate(() => Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1024));
  const heapMenuKb = await heap();

  // Interaction latency: menu tap (APRENDER? no — the setup entry) measured as scene switch.
  const t1 = Date.now();
  await page.goto('/?seed=42&showcase=game');
  await page.waitForFunction(() => window.__MEXE__.scene === 'game');
  const toGameMs = Date.now() - t1;
  const heapGameKb = await heap();

  // Drift: menu <-> game five times, then read the heap again.
  for (let i = 0; i < 5; i++) {
    await page.goto('/?seed=42&showcase=menu');
    await page.waitForFunction(() => window.__MEXE__.scene === 'menu');
    await page.goto('/?seed=42&showcase=game');
    await page.waitForFunction(() => window.__MEXE__.scene === 'game');
  }
  const heapAfterCyclesKb = await heap();
  const fps = await page.evaluate(() => window.__MEXE__.fps);

  console.log('PERF ' + JSON.stringify({ bootMs, toGameMs, heapMenuKb, heapGameKb, heapAfterCyclesKb, fps, nav }));
  expect(bootMs).toBeLessThan(30_000);
});

test('perf baseline throttled @measure', async ({ page, browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await p.goto('/?seed=42&showcase=menu');
  await p.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 60_000 });
  const bootMs = Date.now() - t0;
  const t1 = Date.now();
  await p.goto('/?seed=42&showcase=game');
  await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  const toGameMs = Date.now() - t1;
  await p.waitForTimeout(1500);
  const fps = await p.evaluate(() => window.__MEXE__.fps);
  console.log('PERF-THROTTLED ' + JSON.stringify({ cpu: '4x', viewport: '390x844', bootMs, toGameMs, fps }));
  await ctx.close();
  void page;
});
