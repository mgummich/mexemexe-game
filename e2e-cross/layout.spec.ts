import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUDIO_ROWS, AudioRow, MAIN_ROWS, panelHForRows, rowOffset, SettingsRow,
} from '../src/ui/settings-layout';

/**
 * Cross-browser layout gate: the game is one fixed-height world scaled with Phaser's FIT mode,
 * so "aligned" means the canvas fits fully inside the viewport, stays centred, and keeps the
 * live world's aspect — on every engine (Chrome, Firefox, Safari/WebKit) and on phone viewports.
 * The landscape world widens with the window (src/ui/viewport.ts), so the expected aspect is
 * read from the running game rather than hardcoded.
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
      const v = window.__MEXE__.viewport();
      return {
        x: r.x, y: r.y, w: r.width, h: r.height,
        vw: window.innerWidth, vh: window.innerHeight,
        worldAspect: v.w / v.h,
      };
    });

    // no overflow in either axis (1px slack for sub-pixel rounding across engines)
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.w).toBeLessThanOrEqual(box.vw + 1);
    expect(box.y + box.h).toBeLessThanOrEqual(box.vh + 1);
    // centred: equal margins left/right and top/bottom
    expect(Math.abs(box.x - (box.vw - box.w - box.x))).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y - (box.vh - box.h - box.y))).toBeLessThanOrEqual(2);
    // world aspect preserved (FIT must never stretch)
    expect(box.w / box.h).toBeCloseTo(box.worldAspect, 1);
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

  // The SFX slider lives one level down, in the AUDIO sub-panel: open that first, then click the
  // track near its left end and read back what was persisted. The track spans 100 world units
  // starting at cx - 30 (settings-panel.ts). Every centre follows the live world, which widens
  // with the window in landscape and is a different world entirely in portrait, so nothing here
  // can be hardcoded to the landscape numbers. The row offsets come straight from
  // settings-layout.ts — hand-copied constants are exactly how this spec last drifted out of
  // sync with the panel.
  const geom = {
    audioRowOffset: rowOffset(SettingsRow.Audio),
    mainPanelH: panelHForRows(MAIN_ROWS),
    sfxRowOffset: rowOffset(AudioRow.Sfx),
    audioPanelH: panelHForRows(AUDIO_ROWS),
  };
  const { scale, origin, trackLeft, audioRowY, sfxY } = await page.evaluate((g) => {
    const r = document.querySelector('canvas')!.getBoundingClientRect();
    const v = window.__MEXE__.viewport();
    return {
      scale: r.width / v.w,
      origin: { x: r.x, y: r.y },
      trackLeft: v.w / 2 - 30,
      audioRowY: v.h / 2 - g.mainPanelH / 2 + g.audioRowOffset,
      sfxY: v.h / 2 - g.audioPanelH / 2 + g.sfxRowOffset,
    };
  }, geom);
  const cx = origin.x + (await page.evaluate(() => window.__MEXE__.viewport().w / 2)) * scale;
  // A touch-emulating context (every phone/tablet project here) never delivers `mouse` events to
  // the page, so a click silently did nothing and the assertion read an empty save. Tap those,
  // click the desktop ones — the panel handles both, as the real-device pass confirmed.
  const press = async (x: number, y: number): Promise<void> => {
    if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  await press(cx, origin.y + audioRowY * scale);
  await page.waitForTimeout(200); // the panel is destroyed and rebuilt on section change
  await press(origin.x + (trackLeft + 10) * scale, origin.y + sfxY * scale);

  const vol = await page.evaluate(() => JSON.parse(localStorage.getItem('mexe-save') ?? '{}')?.settings?.sfxVolume);
  expect(vol).toBeGreaterThanOrEqual(0);
  expect(vol).toBeLessThan(30); // clicking 10% along must not slam the slider to 100
});
