import { expect, test } from '@playwright/test';

/**
 * Rotation gate: the layout suite only ever loads a page at one fixed viewport, so a canvas
 * that is correct at boot but never re-fits on a portrait<->landscape flip passes it. This
 * rotates a live page in both directions and asserts the canvas still matches the world it
 * reports — Phaser's FIT display size keeps the aspect ratio it was constructed with unless
 * main.ts re-states it (src/main.ts resize handler).
 */
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

async function measure(page: import('@playwright/test').Page) {
  // The resize handler in main.ts is debounced by 150ms, plus a frame to restyle the canvas.
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    const v = window.__MEXE__.viewport();
    return {
      aspect: r.width / r.height,
      worldAspect: v.w / v.h,
      fill: Math.max(r.width / window.innerWidth, r.height / window.innerHeight),
      overflows: r.width > window.innerWidth + 1 || r.height > window.innerHeight + 1,
    };
  });
}

for (const [from, to, name] of [
  [PORTRAIT, LANDSCAPE, 'portrait -> landscape'],
  [LANDSCAPE, PORTRAIT, 'landscape -> portrait'],
] as const) {
  test(`canvas re-fits on rotate: ${name}`, async ({ page }) => {
    await page.setViewportSize(from);
    await page.goto('/?seed=42&showcase=game');
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });

    const before = await measure(page);
    expect(before.aspect).toBeCloseTo(before.worldAspect, 1);

    await page.setViewportSize(to);
    const after = await measure(page);

    expect(after.worldAspect).not.toBeCloseTo(before.worldAspect, 1); // the world really flipped
    expect(after.aspect).toBeCloseTo(after.worldAspect, 1);
    expect(after.overflows).toBe(false);
    expect(after.fill).toBeGreaterThan(0.98);

    expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  });
}
