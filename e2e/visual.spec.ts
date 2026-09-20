import { expect, test } from '@playwright/test';

/**
 * Visual baselines for the states that are supposed to be stable (Phase 33).
 *
 * Six frames, not sixty: the menu, a board mid-turn, the Mexe draft, the win screen, and the two
 * that catch layout regressions the other four cannot — portrait, and +25% text. Every one is a
 * deterministic showcase state, so the only thing that can move the pixels is a change to the
 * rendering itself.
 *
 * **Baselines are per platform, and the platform is the renderer.** Captures are byte-identical
 * across runs on one machine and different across machines (measured in Phase 84), so Playwright's
 * `{platform}` suffix is doing real work here: a darwin baseline says nothing about linux. CI's
 * fixed runner is the one that gates; a developer's first local run writes their own baseline and
 * compares against it from then on.
 *
 * Updating: `npx playwright test e2e/visual.spec.ts --update-snapshots`, then *look at the diff*
 * before committing it. A baseline updated without being looked at is a baseline that no longer
 * means anything (docs/TESTING.md §Visual baselines).
 */
const STATES: { name: string; url: string; viewport?: { width: number; height: number } }[] = [
  { name: 'menu', url: '/?seed=42&showcase=menu' },
  { name: 'game', url: '/?seed=42&showcase=game' },
  { name: 'mexe', url: '/?seed=77&showcase=mexe' },
  { name: 'win', url: '/?seed=42&showcase=win' },
  { name: 'game-portrait', url: '/?seed=42&showcase=game', viewport: { width: 390, height: 844 } },
  { name: 'game-large-text', url: '/?seed=42&showcase=game&textscale=125' },
];

for (const state of STATES) {
  test(`visual baseline: ${state.name}`, async ({ page }) => {
    if (state.viewport) await page.setViewportSize(state.viewport);
    await page.goto(state.url);
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => window.__MEXE__.dealing === false, undefined, { timeout: 20_000 });
    // Tweens settle; the same wait the screenshot suite uses before it captures.
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    await expect(page).toHaveScreenshot(`${state.name}.png`, {
      // A handful of pixels can differ from a sub-pixel tween landing a frame apart; a real
      // rendering change moves thousands. Anything in between is worth a human look, which is
      // what a failure asks for.
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
    });
  });
}
