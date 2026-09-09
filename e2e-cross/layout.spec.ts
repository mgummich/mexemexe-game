import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Cross-browser layout gate: the game is one fixed 480x270 world scaled with Phaser's FIT mode,
 * so "aligned" means the canvas fits fully inside the viewport, stays centred, and keeps the
 * 16:9 aspect — on every engine (Chrome, Firefox, Safari/WebKit) and on phone viewports.
 * Runs the same three screens per project; screenshots land per project for eyeballing.
 */
const OUT_DIR = 'docs/screenshots/cross-browser';
const SCREENS = [
  { name: 'menu', url: '/?seed=42&showcase=menu' },
  { name: 'game', url: '/?seed=42&showcase=game' },
  { name: 'settings', url: '/?seed=42&showcase=settings' },
];

for (const screen of SCREENS) {
  test(`${screen.name} fits the viewport`, async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));

    await page.goto(screen.url);
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });
    await page.waitForTimeout(700); // tweens settle

    const box = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
    });

    // no overflow in either axis (1px slack for sub-pixel rounding across engines)
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.w).toBeLessThanOrEqual(box.vw + 1);
    expect(box.y + box.h).toBeLessThanOrEqual(box.vh + 1);
    // centred: equal margins left/right and top/bottom
    expect(Math.abs(box.x - (box.vw - box.w - box.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - (box.vh - box.h - box.y))).toBeLessThanOrEqual(2);
    // 16:9 preserved (FIT must never stretch)
    expect(box.w / box.h).toBeCloseTo(480 / 270, 1);
    // fills at least one axis — otherwise the world was scaled down for no reason
    expect(Math.max(box.w / box.vw, box.h / box.vh)).toBeGreaterThan(0.98);

    const dir = path.join(OUT_DIR, testInfo.project.name.replace(/\s+/g, '-').toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${screen.name}.png`) });

    expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
}

test('settings sliders respond to a click at the point clicked', async ({ page }) => {
  await page.goto('/?seed=42&showcase=settings');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });

  // Click the SFX track near its left end and read back what was persisted. The track spans
  // world x 210..310 at y 46 (settings-panel.ts: cx-30, first row + ROW_PITCH).
  const scale = await page.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect().width / 480);
  const origin = await page.evaluate(() => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  await page.mouse.click(origin.x + 220 * scale, origin.y + 46 * scale);

  const vol = await page.evaluate(() => JSON.parse(localStorage.getItem('mexe-save') ?? '{}')?.settings?.sfxVolume);
  expect(vol).toBeGreaterThanOrEqual(0);
  expect(vol).toBeLessThan(30); // clicking 10% along must not slam the slider to 100
});
