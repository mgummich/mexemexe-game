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

/**
 * Phase 76: where the time actually goes. A V8 CPU profile over the crowded
 * table (the worst board the game can reach) plus the boot resource breakdown.
 * Prints; gates nothing.
 */
test('perf profile @measure', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.goto('/?seed=12460&showcase=mexe&crowd=44');
  await p.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 60_000 });

  const boot = await p.evaluate(() => {
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const byType: Record<string, { count: number; bytes: number; ms: number }> = {};
    for (const r of res) {
      const kind = /\.js($|\?)/.test(r.name) ? 'js' : /\.(png|webp)/.test(r.name) ? 'image' : /\.(wav|mp3)/.test(r.name) ? 'audio' : 'other';
      const slot = (byType[kind] ??= { count: 0, bytes: 0, ms: 0 });
      slot.count++;
      slot.bytes += r.transferSize;
      slot.ms = Math.max(slot.ms, Math.round(r.responseEnd));
    }
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const audio = res.filter((r) => /\.(wav|mp3)/.test(r.name)).map((r) => [r.name.replace(/^.*\/assets\//, ''), r.encodedBodySize, r.transferSize, Math.round(r.responseEnd)]);
    return { audio, byType, fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0), domInteractive: Math.round(nav.domInteractive) };
  });

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  await p.waitForTimeout(4000);
  const { profile } = (await cdp.send('Profiler.stop')) as { profile: { nodes: Array<{ id: number; hitCount?: number; callFrame: { functionName: string; url: string } }>; samples?: number[] } };
  const self = new Map<string, number>();
  let total = 0;
  for (const n of profile.nodes) {
    const hits = n.hitCount ?? 0;
    if (hits === 0) continue;
    total += hits;
    const file = n.callFrame.url.replace(/^.*\/assets\//, '').replace(/\?.*$/, '');
    const key = `${n.callFrame.functionName || '(anonymous)'} @ ${file || '(native)'}`;
    self.set(key, (self.get(key) ?? 0) + hits);
  }
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([k, v]) => `${((v / total) * 100).toFixed(1)}% ${k}`);
  console.log('PROFILE-BOOT ' + JSON.stringify(boot));
  console.log('PROFILE-TOP\n' + top.join('\n'));
  await ctx.close();
  expect(total).toBeGreaterThan(0);
});
