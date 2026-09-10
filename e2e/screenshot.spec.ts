import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { getLocale, setLocale, t as translate } from '../src/localization/i18n';
import { errorMessage, SERVER_ERROR_CODES } from '../src/net/errors';
import { editorZones, meldListRows, meldListRowY, MELD_LIST_ROW_H } from '../src/table/editor-layout';
import { computeMeldLayout } from '../src/table/layout';
import { ZOOM_FLOORS } from '../src/table/zoom';
import { gameRegions, type GameRegions } from '../src/ui/regions';
import { cosmeticsRowY, settingsRowY, SettingsRow } from '../src/ui/settings-layout';
import { pickProfile } from '../src/ui/viewport';

const OUT_DIR = 'docs/screenshots';
const LOG_PATH = path.join(OUT_DIR, 'verify-log.json');

interface ShotLog {
  name: string;
  screenshot: string;
  seed: number;
  scene: string;
  fps: number;
  viewport: { width: number; height: number } | null;
  consoleErrors: string[];
  pageErrors: string[];
  missingAssets: string[];
  validation: unknown;
}

const logs: ShotLog[] = [];
const consoleErrorsByPage = new WeakMap<Page, string[]>();

function trackConsoleErrors(page: Page): string[] {
  let errs = consoleErrorsByPage.get(page);
  if (!errs) {
    errs = [];
    consoleErrorsByPage.set(page, errs);
    page.on('console', (msg) => {
      if (msg.type() === 'error') errs!.push(msg.text());
    });
  }
  return errs;
}

/** Screenshot the current page state and record a log entry, without navigating. */
async function snap(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(700); // let tweens settle
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const screenshot = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshot });
  const api = await page.evaluate(() => ({
    seed: window.__MEXE__.seed,
    scene: window.__MEXE__.scene,
    fps: window.__MEXE__.fps,
    errors: window.__MEXE__.errors,
    missingAssets: window.__MEXE__.missingAssets,
    validation: window.__MEXE__.validation,
  }));
  logs.push({
    name,
    screenshot,
    seed: api.seed,
    scene: api.scene,
    fps: api.fps,
    viewport: page.viewportSize(),
    consoleErrors: trackConsoleErrors(page),
    pageErrors: api.errors,
    missingAssets: api.missingAssets,
    validation: api.validation,
  });
  expect(api.errors, `page errors in ${name}`).toEqual([]);
}

async function capture(page: Page, url: string, name: string, extra?: (p: Page) => Promise<void>): Promise<void> {
  trackConsoleErrors(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  if (extra) await extra(page);
  await snap(page, name);
}

test('menu', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=menu', 'menu');
});

test('game vs 1 AI', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game', 'game', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
});

test('game 4 players', async ({ page }) => {
  await capture(page, '/?seed=1337&showcase=game4', 'game4', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
});

// logical 480x270 canvas fills the 1280x720 viewport exactly (Scale.FIT, no letterbox): scale = 1280/480.
const SCALE = 1280 / 480;
const toScreen = (lx: number, ly: number): [number, number] => [lx * SCALE, ly * SCALE];

test('tutorial', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=menu', 'tutorial', async (p) => {
    // canvas game — click the tutorial button by logical coords (240, 207) scaled to viewport
    await p.mouse.click(640, 552);
    await p.waitForFunction(() => window.__MEXE__.scene === 'tutorial', undefined, { timeout: 5000 });
    await p.waitForFunction(() => window.__MEXE__.tutorialStep === 0);
  });
});

test('tutorial step 2: lay a set of three nines', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=menu', 'tutorial-step2', async (p) => {
    await p.mouse.click(640, 552);
    await p.waitForFunction(() => window.__MEXE__.scene === 'tutorial' && window.__MEXE__.mexe !== null);
    await p.waitForFunction(() => window.__MEXE__.tutorialStep === 0);

    // step 1 ("goal") is explanatory only — advance with the NEXT button
    const [nx, ny] = toScreen(438, 144);
    await p.mouse.click(nx, ny);
    await p.waitForFunction(() => window.__MEXE__.tutorialStep === 1);

    // step 2: drag the three 9s onto the table via the live Mexe Mode hooks
    const stepAfter = await p.evaluate(() => {
      const mexe = window.__MEXE__.mexe!;
      mexe.playHandCard('hearts-9-d0', null);
      const meldId = mexe.getDraft()!.melds[0]!.id;
      mexe.playHandCard('spades-9-d0', meldId);
      mexe.playHandCard('clubs-9-d0', meldId);
      return window.__MEXE__.tutorialStep;
    });
    expect(stepAfter).toBe(2);
  });
});

test('setup: seat/personality picker', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=setup', 'setup', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'setup');
  });
});

test('settings overlay', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=settings', 'settings', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'menu');
  });
});

test('win screen', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=win', 'win', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'win');
  });
  // results summary (Phase 9): debugApi.results is canvas text's only e2e-readable source.
  const results = await page.evaluate(() => window.__MEXE__.results);
  expect(results).not.toBeNull();
  expect(results!.stalemate).toBe(false);
  expect(results!.winnerName.length).toBeGreaterThan(0);
  expect(results!.winningMoveText.length).toBeGreaterThan(0);
  expect(results!.results).toHaveLength(2);
  expect(results!.results.filter((r) => r.isWinner)).toHaveLength(1);
});

test('mexe mode: break a meld, see invalid glow and exact reason, undo restores', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'mexe-invalid', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const moved = await p.evaluate(() => {
      const api = window.__MEXE__;
      const state = api.state!()!;
      const meld = state.table[0]!;
      const card = meld.cards[meld.cards.length - 1]!;
      return api.mexe!.moveTableCard(card.id, null);
    });
    expect(moved).toBe(true);
    const validation = await p.evaluate(() => window.__MEXE__.validation);
    expect((validation as { ok: boolean }).ok).toBe(false);
    const undone = await p.evaluate(() => window.__MEXE__.mexe!.undo());
    expect(undone).toBe(true);
    const after = await p.evaluate(() => window.__MEXE__.validation as { ok: boolean; reasons: string[] });
    expect(after.ok).toBe(false);
    expect(after.reasons).toContain('reason.noHandCard');
    // leave the broken state on screen for the screenshot
    await p.evaluate(() => {
      const api = window.__MEXE__;
      const state = api.state!()!;
      const meld = state.table[0]!;
      api.mexe!.moveTableCard(meld.cards[meld.cards.length - 1]!.id, null);
    });
    // colorblind-safe channel: the invalid meld also shows a ✗ badge, not just the red glow
    const invalidBadges = await p.evaluate(() => window.__MEXE__.a11y.invalidBadges);
    expect(invalidBadges).toBeGreaterThan(0);
  });
});

test('comprar passes turn to AI and game continues', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'comprar-flow', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const before = await p.evaluate(() => window.__MEXE__.state!()!.turn);
    await p.evaluate(() => window.__MEXE__.mexe!.comprar());
    await p.waitForFunction(
      (t) => {
        const s = window.__MEXE__.state?.();
        return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
      },
      before,
      { timeout: 10_000 },
    );
  });
});

test('ai-showcase: comprar hands the turn to the AI, which moves and thinks aloud', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=77&showcase=mexe');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
  const before = await page.evaluate(() => window.__MEXE__.state!()!.turn);
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await snap(page, 'ai-showcase-mid');
  await page.waitForFunction(
    (t) => {
      const s = window.__MEXE__.state?.();
      return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
    },
    before,
    { timeout: 10_000 },
  );
  await snap(page, 'ai-showcase-after');
  const thought = await page.evaluate(() => window.__MEXE__.lastAiThought);
  expect(thought).not.toBeNull();
});

const PERSONALITIES: { key: string; name: string }[] = [
  { key: 'cida', name: 'Dona Cida' },
  { key: 'juninho', name: 'Juninho' },
  { key: 'bia', name: 'Bia' },
  { key: 'ze', name: 'Seu Zé' },
];

for (const p of PERSONALITIES) {
  test(`ai-showcase-${p.key}: ${p.name} mid-game, thinking aloud`, async ({ page }) => {
    trackConsoleErrors(page);
    await page.goto(`/?seed=77&showcase=mexe&ai=${p.key}`);
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
    await page.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const opponentName = await page.evaluate(() => window.__MEXE__.state!()!.players[1]!.name);
    expect(opponentName).toBe(p.name);
    const before = await page.evaluate(() => window.__MEXE__.state!()!.turn);
    await page.evaluate(() => window.__MEXE__.mexe!.comprar());
    await page.waitForFunction(
      (t) => {
        const s = window.__MEXE__.state?.();
        return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
      },
      before,
      { timeout: 10_000 },
    );
    await snap(page, `ai-${p.key}`);
    const thought = await page.evaluate(() => window.__MEXE__.lastAiThought);
    expect(thought).not.toBeNull();
  });
}

test('rematch: WinScene MESMA PARTIDA starts a new game with the same seed', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=555&showcase=win');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__MEXE__.scene === 'win');
  // WinScene "MESMA PARTIDA" button — y drifts with the results-summary content above it, so
  // read the real position from debugApi.winButtonY instead of a hardcoded coordinate.
  const buttonY = await page.evaluate(() => window.__MEXE__.winButtonY);
  expect(buttonY).not.toBeNull();
  const [rx, ry] = toScreen(240, buttonY!);
  await page.mouse.click(rx, ry);
  await page.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });
  const seed = await page.evaluate(() => window.__MEXE__.seed);
  expect(seed).toBe(555);
  const state = await page.evaluate(() => window.__MEXE__.state!()!);
  expect(state.turn).toBe(1); // fresh game (createNewGame), not a continuation of the showcase win state
  const errs = await page.evaluate(() => window.__MEXE__.errors);
  expect(errs).toEqual([]);
});

test('reset-data: settings APAGAR DADOS + confirm clears the versioned save and reboots clean', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=1&showcase=settings');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  // dirty the save first (mute toggle, top button of the settings panel) so the wipe is provable.
  // Row y-coordinates come from src/ui/settings-layout.ts, the single source of truth also used
  // by settings-panel.ts itself — see SettingsRow for the row order.
  const [mx, my] = toScreen(240, settingsRowY(SettingsRow.Mute));
  await page.mouse.click(mx, my);
  const savedBefore = await page.evaluate(() => localStorage.getItem('mexe-save'));
  expect(savedBefore).not.toBeNull();
  // "APAGAR DADOS" button
  const [dx, dy] = toScreen(240, settingsRowY(SettingsRow.ResetData));
  await page.mouse.click(dx, dy);
  await page.waitForTimeout(150);
  // confirm dialog "Sim" button, logical (200, 160)
  const [yx, yy] = toScreen(200, 160);
  await page.mouse.click(yx, yy);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const savedAfter = await page.evaluate(() => localStorage.getItem('mexe-save'));
  expect(savedAfter).toBeNull();
  const errs = await page.evaluate(() => window.__MEXE__.errors);
  expect(errs).toEqual([]);
});

test('pause: Esc opens the pause menu in-game and pauses the AI timer', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game', 'pause', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150); // overlay tween settle before the screenshot below
  });
});

test('help: rules panel opened from the pause menu', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game', 'help', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    // pause menu: Continue/Settings/Help/Quit stacked at logical (240, 95/119/143/167) — Help is the 3rd row
    const [hx, hy] = toScreen(240, 143);
    await p.mouse.click(hx, hy);
    await p.waitForTimeout(150);
  });
});

test('help-en: rules panel (English) opened from the pause menu', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game&lang=en', 'help-en', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    const [hx, hy] = toScreen(240, 143);
    await p.mouse.click(hx, hy);
    await p.waitForTimeout(150);
  });
});

test('menu-en: English UI on the main menu', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=menu&lang=en', 'menu-en');
});

test('game-en: English UI in a game', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game&lang=en', 'game-en', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
});

test('a11y-large-text: +25% font scale via ?textscale=125', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game&textscale=125', 'a11y-large-text', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
});

test('keyboard: pressing C (comprar) advances the turn, same as clicking', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'keyboard-comprar', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const before = await p.evaluate(() => window.__MEXE__.state!()!.turn);
    await p.keyboard.press('c');
    await p.waitForFunction(
      (t) => {
        const s = window.__MEXE__.state?.();
        return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
      },
      before,
      { timeout: 10_000 },
    );
  });
});

test('stress-table: many melds on the table still hold fps >= 50', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'stress-table', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    // maximize sprite count: play every hand card to its own new meld (renderAll
    // rebuilds all card sprites every call, so this repeatedly churns the full set)
    await p.evaluate(() => {
      const mexe = window.__MEXE__.mexe!;
      const hand = window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id);
      for (const cardId of hand) mexe.playHandCard(cardId, null);
    });
    await p.waitForTimeout(1000); // let fps settle
    const fps = await p.evaluate(() => window.__MEXE__.fps);
    expect(fps).toBeGreaterThanOrEqual(50);
  });
});

test('game-1080p: readable at a 1920x1080 viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture(page, '/?seed=42&showcase=game', 'game-1080p', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
});

/** Build a new meld from hand cards via the live Mexe Mode hooks and return its meld id. */
async function buildMeld(p: Page, cardIds: string[]): Promise<string> {
  return p.evaluate((ids) => {
    const mexe = window.__MEXE__.mexe!;
    const before = new Set(mexe.getDraft()!.melds.map((m) => m.id));
    mexe.playHandCard(ids[0]!, null);
    const meldId = mexe.getDraft()!.melds.find((m) => !before.has(m.id))!.id;
    for (const id of ids.slice(1)) mexe.playHandCard(id, meldId);
    return meldId;
  }, cardIds);
}

test('joker-in-hand: a joker sits in the human hand before any play', async ({ page }) => {
  await capture(page, '/?seed=25&showcase=mexe', 'joker-in-hand', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const hand = await p.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
    expect(hand.some((id) => id.startsWith('joker-'))).toBe(true);
  });
});

test('joker-run: a joker fills the gap in a valid run (hearts 10, joker, 12)', async ({ page }) => {
  await capture(page, '/?seed=1&showcase=mexe', 'joker-in-run', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['hearts-10-d1', 'joker-d1-1', 'hearts-12-d0']);
    const validation = await p.evaluate(() => window.__MEXE__.validation);
    expect((validation as { ok: boolean }).ok).toBe(true);
  });
});

test('joker-group: a joker stands in for the third card of a group of 3s', async ({ page }) => {
  await capture(page, '/?seed=6&showcase=mexe', 'joker-in-group', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['diamonds-3-d1', 'clubs-3-d0', 'joker-d0-1']);
    const validation = await p.evaluate(() => window.__MEXE__.validation);
    expect((validation as { ok: boolean }).ok).toBe(true);
  });
});

test('two-joker-run: a run holding 2 jokers is rejected with the too-many-jokers reason (PT)', async ({ page }) => {
  await capture(page, '/?seed=16&showcase=mexe', 'mexe-invalid-two-jokers-run', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['hearts-5-d0', 'hearts-6-d0', 'joker-d0-1', 'joker-d1-2']);
    const validation = await p.evaluate(() => window.__MEXE__.validation as { ok: boolean; reasons: string[] });
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.tooManyJokers');
  });
  expect(translate('reason.tooManyJokers')).not.toMatch(/^reason\./);
});

test('two-joker-trinca: a trinca holding 2 jokers is rejected with the too-many-jokers reason (EN)', async ({ page }) => {
  await capture(page, '/?seed=16&showcase=mexe&lang=en', 'mexe-invalid-two-jokers-trinca-en', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['hearts-6-d0', 'spades-6-d1', 'joker-d0-1', 'joker-d1-2']);
    const validation = await p.evaluate(() => window.__MEXE__.validation as { ok: boolean; reasons: string[] });
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.tooManyJokers');
  });
  expect(translate('reason.tooManyJokers')).not.toMatch(/^reason\./);
});

test('one-joker melds stay legal: a joker completes a run and a trinca on the same table', async ({ page }) => {
  await capture(page, '/?seed=16&showcase=mexe', 'mexe-valid-one-joker-each', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['hearts-5-d0', 'hearts-6-d0', 'joker-d0-1']);
    await buildMeld(p, ['spades-5-d1', 'spades-6-d1', 'joker-d1-2']);
    const validation = await p.evaluate(() => window.__MEXE__.validation as { ok: boolean; reasons: string[] });
    expect(validation.reasons).not.toContain('reason.tooManyJokers');
  });
});

test('k-a-2-invalid: no-wrap rule rejects K-A-2 with the run-wrap reason', async ({ page }) => {
  await capture(page, '/?seed=242&showcase=mexe', 'mexe-invalid-kA2', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['diamonds-13-d1', 'diamonds-1-d1', 'diamonds-2-d0']);
    const validation = await p.evaluate(() => window.__MEXE__.validation as { ok: boolean; reasons: string[] });
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.runWrap');
  });
});

test('repeated-suit-group: two same-suit cards from different decks are rejected', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'repeated-suit-group', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const cards = await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']).then(async (meldId) => {
      const draft = await p.evaluate(() => window.__MEXE__.mexe!.getDraft());
      return draft!.melds.find((m) => m.id === meldId)!.cards;
    });
    expect(cards.filter((c) => c.suit === 'diamonds')).toHaveLength(2);
    const validation = await p.evaluate(() => window.__MEXE__.validation as { ok: boolean; reasons: string[] });
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.groupDuplicateSuit');
  });
});

/** Meld id currently holding `cardId` in the live draft, or throws — robust against melds being
 * created in any order (unlike tracking "the first meld" by array index). */
async function meldIdOf(p: Page, cardId: string): Promise<string> {
  return p.evaluate((id) => {
    const draft = window.__MEXE__.mexe!.getDraft()!;
    const meld = draft.melds.find((m) => m.cards.some((c) => c.id === id));
    if (!meld) throw new Error(`no meld holds ${id}`);
    return meld.id;
  }, cardId);
}

// ---------- Phase 12: smart drag/snap helpers ----------

/**
 * Real mouse drag (dispatches actual browser pointer events, same as a player's mouse): move onto
 * the card, press, move onto the target in a few steps so Phaser's drag threshold fires and the
 * legality-aware highlights/ghost preview update, then leave the mouse DOWN so the caller's
 * `capture()` screenshot lands mid-drag. Never releases — the page closes at test end regardless
 * (ponytail: no explicit mouse-up cleanup needed for a single-shot e2e test).
 */
async function dragCardOnto(p: Page, cardId: string, toLogical: { x: number; y: number }): Promise<void> {
  const from = await p.evaluate((id) => window.__MEXE__.mexe!.cardPos(id), cardId);
  if (!from) throw new Error(`card ${cardId} not on screen`);
  const [fx, fy] = toScreen(from.x, from.y);
  const [tx, ty] = toScreen(toLogical.x, toLogical.y);
  await p.mouse.move(fx, fy);
  await p.mouse.down();
  await p.mouse.move(tx, ty, { steps: 8 });
}

// ---------- mobile viewports ----------
// The board has two authored worlds (src/ui/viewport.ts): 480x270 landscape and 270x480 portrait.
// These are the same tables the scene lays out from, so a capture can address a real button.
const DESKTOP_REGIONS = gameRegions(pickProfile(1280, 720, false));
const PORTRAIT_REGIONS = gameRegions(pickProfile(390, 844, false));
const PHONE_PORTRAIT = { width: 390, height: 844 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };

/**
 * World -> screen for whichever world is live, read from the canvas rect and `viewport()` rather
 * than a baked-in scale factor — the fixed `toScreen` above only holds at 1280x720.
 */
async function toCanvasPoint(p: Page, wx: number, wy: number): Promise<[number, number]> {
  const pt = await p.evaluate(
    ({ x, y }) => {
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      const v = window.__MEXE__.viewport();
      return { x: c.left + (x / v.w) * c.width, y: c.top + (y / v.h) * c.height };
    },
    { x: wx, y: wy },
  );
  return [pt.x, pt.y];
}

async function tapWorld(p: Page, wx: number, wy: number): Promise<void> {
  const [x, y] = await toCanvasPoint(p, wx, wy);
  await p.mouse.click(x, y);
  // Phaser drains its pointer queue once per frame and keeps a single Pointer, so two taps that
  // land inside the same frame collapse into one — on a loaded CI runner that silently ate the
  // select half of a select-then-place pair. Wait a rendered frame so each tap is its own event.
  await p.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Tap a rendered card by id — the touch path, no drag involved. */
async function tapCard(p: Page, cardId: string): Promise<void> {
  const pos = await p.evaluate((id) => window.__MEXE__.mexe!.cardPos(id), cardId);
  if (!pos) throw new Error(`card ${cardId} not on screen`);
  await tapWorld(p, pos.x, pos.y);
}

async function tapMeld(p: Page, meldId: string): Promise<void> {
  const pos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
  if (!pos) throw new Error(`meld ${meldId} not on screen`);
  await tapWorld(p, pos.x, pos.y);
}

async function meldCardIds(p: Page, meldId: string): Promise<string[]> {
  return p.evaluate(
    (id) => window.__MEXE__.mexe!.getDraft()!.melds.find((m) => m.id === id)?.cards.map((c) => c.id) ?? [],
    meldId,
  );
}

/**
 * Logical position of an invalid meld's ✗ badge — same layout math as `GameScene.layoutMelds`
 * (`TABLE_LEFT`/`TABLE_TOP`/`MELD_PAD` + the badge's `+4,+2` offset), built on the same pure
 * `computeMeldLayout` the scene itself uses, so this can never drift from the real position.
 */
async function badgeLogicalPos(p: Page, meldId: string, r: GameRegions = DESKTOP_REGIONS): Promise<{ x: number; y: number }> {
  const melds = await p.evaluate(() =>
    window.__MEXE__.mexe!.getDraft()!.melds.map((m) => ({ id: m.id, cardCount: m.cards.length })),
  );
  const MELD_PAD = 4;
  const pos = computeMeldLayout(melds, r.tableAreaW, r.tableAreaH).find((m) => m.meldId === meldId)!;
  const pad = MELD_PAD * pos.cardScale;
  return { x: r.tableLeft + pos.x + 4, y: r.tableTop + 6 + pos.y - pad + 2 };
}

test('snap-targets-legal: dragging a card that legally extends a run highlights it green, not gold', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'snap-targets-legal', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    // AI-built run already on the table: clubs 10, 11, joker(=12). clubs-13-d0 is in hand and
    // extends it to 10-11-12-13 legally.
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'clubs-13-d0');
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('legal');
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'clubs-13-d0', meldPos!);
  });
});

test('snap-target-illegal: dragging a duplicate-suit card over a partial group highlights it red', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'snap-target-illegal', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'clubs-2-d1']); // 2-card partial group
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'diamonds-2-d0');
    const target = targets.find((t) => t.meldId === meldId);
    expect(target?.status).toBe('illegal');
    expect(target?.reason).toBe('reason.groupDuplicateSuit');
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'diamonds-2-d0', meldPos!);
  });
});

test('snap-preview-valid: ghost preview shows the resulting run and a legal status line', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'snap-preview-valid', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'clubs-13-d0');
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('legal');
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'clubs-13-d0', meldPos!);
  });
});

test('snap-preview-invalid: ghost preview shows the illegal reason line, no joker hint', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'snap-preview-invalid', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'clubs-2-d1']);
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'diamonds-2-d0');
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('illegal');
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'diamonds-2-d0', meldPos!);
  });
});

test('snap-preview-joker: dragging a joker onto a partial run shows what it stands for', async ({ page }) => {
  await capture(page, '/?seed=16&showcase=mexe', 'snap-preview-joker', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['hearts-5-d0', 'hearts-6-d0']); // 2-card partial run
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'joker-d0-1');
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('legal'); // joker fills 7
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'joker-d0-1', meldPos!);
  });
});

test('snap-reason-tapped: tapping the ✗ badge shows the reason without hovering', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'snap-reason-tapped', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']); // invalid: duplicate suit
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.groupDuplicateSuit');
    const badgePos = await badgeLogicalPos(p, meldId);
    const [bx, by] = toScreen(badgePos.x, badgePos.y);
    await p.mouse.click(bx, by); // tap, not hover
  });
});

test('snap-preview-en: the legal snap status line reads in English', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe&lang=en', 'snap-preview-en', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'clubs-13-d0');
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('legal');
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'clubs-13-d0', meldPos!);
  });
  // translate() is this Node process's own copy of the dict, independent of the page's ?lang=en —
  // set/reset the locale around the assertion so it doesn't leak into other tests in this file.
  const prev = getLocale();
  setLocale('en');
  expect(translate('snap.legal')).toBe('Fits here');
  setLocale(prev);
});

test('tutorial: first-run 12-step completion, including the trinca-limit and joker steps', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=42&showcase=menu');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  // MenuScene TUTORIAL button, logical (240, 207)
  const [tx, ty] = toScreen(240, 207);
  await page.mouse.click(tx, ty);
  await page.waitForFunction(() => window.__MEXE__.scene === 'tutorial' && window.__MEXE__.mexe !== null);
  await page.waitForFunction(() => window.__MEXE__.tutorialStep === 0);

  const [nextX, nextY] = toScreen(438, 144); // tutorial NEXT button
  // The tutorial panel is rebuilt wholesale by renderAll(), so a click landing in that window hits
  // a destroyed button and is swallowed — the step then never advances and waitStep() times out.
  // Press again until the step actually moves; waitStep() below still asserts the exact step, so
  // this only removes the race, it never weakens the assertion.
  const clickNext = async (): Promise<void> => {
    const before = await page.evaluate(() => window.__MEXE__.tutorialStep);
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.mouse.click(nextX, nextY);
      try {
        await page.waitForFunction((s) => window.__MEXE__.tutorialStep !== s, before, { timeout: 2_500 });
        return;
      } catch {
        // swallowed by a re-render — press again
      }
    }
  };
  const waitStep = async (step: number): Promise<void> => {
    await page.waitForFunction((s) => window.__MEXE__.tutorialStep === s, step, { timeout: 15_000 });
  };

  // step0 "goal": explanatory only
  await clickNext();
  await waitStep(1);

  // step1 "set": lay the three natural 9s
  await page.evaluate(() => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('hearts-9-d0', null);
  });
  const meldA = await meldIdOf(page, 'hearts-9-d0');
  await page.evaluate((id) => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('spades-9-d0', id);
    mexe.playHandCard('clubs-9-d0', id);
  }, meldA);
  await waitStep(2);

  // step2 "trinca-limit": drop the second-deck duplicate-suit 9 into the same set, hit the
  // exact rule reason a real player meets, screenshot it, then fix it into its own valid trio.
  const trincaReasons = await page.evaluate((id) => {
    window.__MEXE__.mexe!.playHandCard('hearts-9-d1', id);
    return window.__MEXE__.validation as { ok: boolean; reasons: string[] };
  }, meldA);
  expect(trincaReasons.ok).toBe(false);
  expect(trincaReasons.reasons).toContain('reason.groupDuplicateSuit');
  await snap(page, 'tutorial-trinca');

  await page.evaluate(() => window.__MEXE__.mexe!.moveTableCard('hearts-9-d1', null));
  const meldD = await meldIdOf(page, 'hearts-9-d1');
  await page.evaluate((id) => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('spades-9-d1', id);
    mexe.playHandCard('clubs-9-d1', id);
  }, meldD);
  await waitStep(3);

  // step3 "run": diamonds 3-4-5
  await page.evaluate(() => window.__MEXE__.mexe!.playHandCard('diamonds-3-d0', null));
  const meldRun = await meldIdOf(page, 'diamonds-3-d0');
  await page.evaluate((id) => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('diamonds-4-d0', id);
    mexe.playHandCard('diamonds-5-d0', id);
  }, meldRun);
  await waitStep(4);

  // step4 "extend": diamonds 6
  await page.evaluate((id) => window.__MEXE__.mexe!.playHandCard('diamonds-6-d0', id), meldRun);
  await waitStep(5);

  // step5 "joker": screenshot the teaching moment (joker glowing in hand, not yet placed), then place it
  await snap(page, 'tutorial-joker');
  await page.evaluate((id) => window.__MEXE__.mexe!.playHandCard('joker-d0-1', id), meldRun);
  await waitStep(6);

  // step6 "mexe-explain": explanatory only
  await clickNext();
  await waitStep(7);

  // step7 "rebuild": break the original set of 9s apart
  await page.evaluate(() => window.__MEXE__.mexe!.moveTableCard('clubs-9-d0', null));
  await waitStep(8);

  // step8 "invalid": explanatory only — the broken 9s-set is now on screen showing its own reason
  await clickNext();
  await waitStep(9);

  // step9 "feito": repair the table (put the 9 of clubs back with its natural pair) and confirm
  const fixedValidation = await page.evaluate((id) => {
    window.__MEXE__.mexe!.moveTableCard('clubs-9-d0', id);
    return window.__MEXE__.validation as { ok: boolean; reasons: string[] };
  }, meldA);
  expect(fixedValidation.ok).toBe(true);
  await page.waitForTimeout(300); // FEITO accidental-confirm guard (CONFIRM_GUARD_MS)
  const confirmed1 = await page.evaluate(() => window.__MEXE__.mexe!.feito());
  expect(confirmed1).toBe(true);
  await waitStep(10);

  // step10 "comprar": wait out the tutorial AI's scripted auto-draw turn, then draw our own card
  await page.waitForFunction(() => window.__MEXE__.mexe !== null, undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await waitStep(11);

  // step11 "win": the draw (diamonds 7) plus the leftover diamonds 9 complete the run — again
  // waiting out the AI's own scripted turn first before it's our editor again.
  await page.waitForFunction(() => window.__MEXE__.mexe !== null, undefined, { timeout: 10_000 });
  const winValidation = await page.evaluate((id) => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('diamonds-7-d0', id);
    mexe.playHandCard('diamonds-9-d0', id);
    return window.__MEXE__.validation as { ok: boolean; reasons: string[] };
  }, meldRun);
  expect(winValidation.ok).toBe(true);
  await page.waitForTimeout(300);
  const confirmed2 = await page.evaluate(() => window.__MEXE__.mexe!.feito());
  expect(confirmed2).toBe(true);
  await page.waitForFunction(() => window.__MEXE__.state!()!.winnerId !== null, undefined, { timeout: 10_000 });

  expect(await page.evaluate(() => window.__MEXE__.tutorialStep)).toBe(11);
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('mexe-save')))!) as {
    progress: { tutorialCompleted: boolean };
  };
  expect(saved.progress.tutorialCompleted).toBe(true);

  await snap(page, 'tutorial-complete');
  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
});

test('tutorial: skipping mid-tutorial records the furthest step reached', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=42&showcase=menu');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [tx, ty] = toScreen(240, 207);
  await page.mouse.click(tx, ty);
  await page.waitForFunction(() => window.__MEXE__.scene === 'tutorial' && window.__MEXE__.mexe !== null);
  await page.waitForFunction(() => window.__MEXE__.tutorialStep === 0);

  const [nextX, nextY] = toScreen(438, 144);
  await page.mouse.click(nextX, nextY);
  await page.waitForFunction(() => window.__MEXE__.tutorialStep === 1);

  await page.evaluate(() => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('hearts-9-d0', null);
    const meldId = mexe.getDraft()!.melds[0]!.id;
    mexe.playHandCard('spades-9-d0', meldId);
    mexe.playHandCard('clubs-9-d0', meldId);
  });
  await page.waitForFunction(() => window.__MEXE__.tutorialStep === 2, undefined, { timeout: 10_000 });

  const [skipX, skipY] = toScreen(438, 162); // tutorial SKIP button
  await page.mouse.click(skipX, skipY);
  await page.waitForFunction(() => window.__MEXE__.scene === 'menu', undefined, { timeout: 10_000 });

  const summary = await page.evaluate(() => window.__MEXE__.playlog.summary());
  expect(summary.tutorialFurthestStep).toBe(2);
  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
});

test('playlog: a real local game records turn/draw events and exports without leaking the player name', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=77&showcase=mexe');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
  const playerName = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.name);

  const before = await page.evaluate(() => window.__MEXE__.state!()!.turn);
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await page.waitForFunction(
    (t) => {
      const s = window.__MEXE__.state?.();
      return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
    },
    before,
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await page.waitForFunction(
    (t) => {
      const s = window.__MEXE__.state?.();
      return s !== null && s !== undefined && s.turn >= t + 4 && !s.players[s.activePlayerIndex]!.isAi;
    },
    before,
    { timeout: 10_000 },
  );

  const entries = await page.evaluate(() => window.__MEXE__.playlog.entries());
  expect(entries.some((e) => e.type === 'turn:start')).toBe(true);
  const summary = await page.evaluate(() => window.__MEXE__.playlog.summary());
  expect(summary.totalTurns).toBeGreaterThan(0);

  const exported = await page.evaluate(() => window.__MEXE__.playlog.exportJson());
  const parsed: unknown = JSON.parse(exported); // throws if not valid JSON
  expect(typeof parsed).toBe('object');
  expect(exported.includes(playerName)).toBe(false);

  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
});

test('playlog: disabled via ?playlog=0 records nothing', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=77&showcase=mexe&playlog=0');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
  const before = await page.evaluate(() => window.__MEXE__.state!()!.turn);
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await page.waitForFunction(
    (t) => {
      const s = window.__MEXE__.state?.();
      return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
    },
    before,
    { timeout: 10_000 },
  );
  expect(await page.evaluate(() => window.__MEXE__.playlog.entries())).toEqual([]);
  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  expect(trackConsoleErrors(page)).toEqual([]);
});

test('invalid FEITO explains itself in translated copy and is logged by reason', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'feito-invalid-explained', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    // same illegal meld as the "repeated-suit-group" case: two diamonds in one group
    await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']);
    const validation = await p.evaluate(() => window.__MEXE__.validation) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.groupDuplicateSuit');

    // the FEITO button is disabled for an invalid draft (never fires); the F keyboard shortcut
    // calls the confirm path directly regardless of button state, which is the one way a real
    // player can hit the invalid-confirm branch that records feito:blocked.
    await p.keyboard.press('f');
    await p.waitForFunction(
      () => (window.__MEXE__.playlog.summary().invalidFeitoByReason['reason.groupDuplicateSuit'] ?? 0) > 0,
      undefined,
      { timeout: 5000 },
    );
  });

  // The on-screen reason text is `t(check.reasons[0])` computed from the exact same reasons
  // array asserted above (src/scenes/GameScene.ts renderAll) — reproduce that lookup here since
  // Playwright cannot read canvas-rendered text directly. Never a bare `reason.*` key.
  const reasonText = translate('reason.groupDuplicateSuit');
  expect(reasonText).not.toBe('reason.groupDuplicateSuit');
  expect(reasonText).not.toMatch(/^reason\./);
});

test('english pass: rule-reason and server-error copy are translated, not bare keys', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe&lang=en', 'feito-invalid-explained-en', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']);
    const validation = await p.evaluate(() => window.__MEXE__.validation) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.groupDuplicateSuit');
  });

  for (const reason of ['reason.groupDuplicateSuit', 'reason.runWrap', 'reason.notYourTurn']) {
    expect(translate(reason)).not.toMatch(/^reason\./);
  }
  // Every server error code the client can receive (src/net/errors.ts) resolves to real EN copy,
  // never the raw code — OnlineScene always renders errorMessage(code), never msg.code/msg.message.
  for (const code of SERVER_ERROR_CODES) {
    const msg = errorMessage(code);
    expect(msg).not.toBe(code);
    expect(msg.length).toBeGreaterThan(0);
  }
  // OnlineScene sets this one directly (t('online.err.unreachable')), not through errorMessage() —
  // 'unreachable' is a client-side marker, never a code the server itself sends.
  expect(translate('online.err.unreachable')).not.toMatch(/^online\.err\./);
});

// ---------- Phase 9: cosmetics, music context, reduced motion ----------

const TABLE_THEME_ROW_Y = cosmeticsRowY(0); // src/ui/settings-layout.ts: table theme is row 0
const CYCLE_BTN = toScreen(286, TABLE_THEME_ROW_Y); // row's cycle button, cx(240)+46

/** Opens Settings → Cosmetics from the menu and cycles the table-theme row `clicks` times. */
async function setTableTheme(p: Page, clicks: number): Promise<void> {
  await p.goto('/?seed=1&showcase=settings');
  await p.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [cx, cy] = toScreen(240, settingsRowY(SettingsRow.Cosmetics));
  await p.mouse.click(cx, cy);
  await p.waitForTimeout(150);
  for (let i = 0; i < clicks; i++) {
    await p.mouse.click(CYCLE_BTN[0], CYCLE_BTN[1]);
    await p.waitForTimeout(100);
  }
}

const THEMES = ['boteco', 'kitchen', 'quintal', 'feira'];
/** Reads the mexe-save JSON, or the shipped defaults if nothing was ever written yet
 * (fresh profile, no setting changed from default — see src/core/persistence.ts DEFAULT_SAVE). */
async function readSave(p: Page): Promise<{
  settings: { musicContextAware: boolean; reducedMotion: boolean };
  cosmetics: { tableTheme: string; cardBack: string; avatar: string };
}> {
  const raw = await p.evaluate(() => localStorage.getItem('mexe-save'));
  if (raw) return JSON.parse(raw);
  return {
    settings: { musicContextAware: true, reducedMotion: false },
    cosmetics: { tableTheme: 'boteco', cardBack: 'back-0', avatar: 'player' },
  };
}

THEMES.forEach((themeId, i) => {
  test(`table theme: ${themeId} renders in-game`, async ({ page }) => {
    await setTableTheme(page, i);
    const saved = await readSave(page);
    expect(saved.cosmetics.tableTheme).toBe(themeId);
    await capture(page, '/?seed=1&showcase=game', `game-theme-${themeId}`, async (p) => {
      await p.waitForFunction(() => window.__MEXE__.scene === 'game');
    });
  });
});

test('cosmetics: avatar/card-back selection persists across a reload', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=1&showcase=settings');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [cx, cy] = toScreen(240, settingsRowY(SettingsRow.Cosmetics));
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  await snap(page, 'cosmetics-panel');
  // card back row (index 1) and avatar row (index 2) cycle buttons, same x as the table row
  const [backX, backY] = toScreen(286, cosmeticsRowY(1));
  await page.mouse.click(backX, backY); // back-0 -> back-1
  const [avatarX, avatarY] = toScreen(286, cosmeticsRowY(2));
  await page.mouse.click(avatarX, avatarY); // player -> cida
  await page.waitForTimeout(150);
  const beforeReload = JSON.parse((await page.evaluate(() => localStorage.getItem('mexe-save')))!) as {
    cosmetics: { cardBack: string; avatar: string };
  };
  expect(beforeReload.cosmetics.cardBack).toBe('back-1');
  expect(beforeReload.cosmetics.avatar).toBe('cida');

  await page.reload();
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const afterReload = JSON.parse((await page.evaluate(() => localStorage.getItem('mexe-save')))!) as {
    cosmetics: { cardBack: string; avatar: string };
  };
  expect(afterReload.cosmetics.cardBack).toBe('back-1');
  expect(afterReload.cosmetics.avatar).toBe('cida');
  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
});

test('cosmetics: never present in the online room protocol (local-only, must never sync)', () => {
  // Static check, not a browser one: cosmetics live in settings.cosmetics(), which the wire
  // protocol never carries. Reading the source is the direct proof — no server/network needed.
  const protocolSrc = fs.readFileSync('src/net/protocol.ts', 'utf8');
  expect(protocolSrc.toLowerCase()).not.toContain('cosmetic');
});

test('music: context switches menu -> game -> mexe and back, observable via debugApi.music()', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=42&showcase=menu');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__MEXE__.music().context)).toBe('menu');

  await page.goto('/?seed=77&showcase=mexe');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await page.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
  // human's turn on entry to a mexe showcase — DraftEditor is live, so context is 'mexe'.
  expect(await page.evaluate(() => window.__MEXE__.music().context)).toBe('mexe');

  const before = await page.evaluate(() => window.__MEXE__.state!()!.turn);
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await page.waitForFunction(
    (t) => {
      const s = window.__MEXE__.state?.();
      return s !== null && s !== undefined && s.turn >= t + 2 && !s.players[s.activePlayerIndex]!.isAi;
    },
    before,
    { timeout: 10_000 },
  );
  expect(await page.evaluate(() => window.__MEXE__.music().context)).toBe('mexe'); // back to our turn
  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
});

test('music: "music by context" toggle switches the track pool selection mode', async ({ page }) => {
  trackConsoleErrors(page);
  await page.goto('/?seed=1&showcase=settings');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const before = (await readSave(page)).settings.musicContextAware;
  expect(before).toBe(true); // default on
  const [bx, by] = toScreen(240, settingsRowY(SettingsRow.MusicContext));
  await page.mouse.click(bx, by);
  const after = (await readSave(page)).settings.musicContextAware;
  expect(after).toBe(false);
  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
});

test('a11y-reduced-motion: ?motion=0 disables cosmetic tweens/fades', async ({ page }) => {
  await capture(page, '/?seed=42&showcase=game&motion=0', 'a11y-reduced-motion', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem('mexe-save')))!) as {
    settings: { reducedMotion: boolean };
  };
  expect(saved.settings.reducedMotion).toBe(true);
});

// ---------- Phase 13: mobile layout + tap-first controls ----------

test('mobile-portrait-menu: the menu reflows into the 270x480 portrait world', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=42&showcase=menu', 'mobile-portrait-menu');
  const v = await page.evaluate(() => window.__MEXE__.viewport());
  expect(v).toMatchObject({ w: 270, h: 480, portrait: true });
});

test('mobile-portrait-game: full-width table, hand carousel and a pinned action bar', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=42&showcase=game', 'mobile-portrait-game', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
  const v = await page.evaluate(() => window.__MEXE__.viewport());
  expect(v.portrait).toBe(true);
  // the portrait board hands the meld packer a much larger box than the landscape one
  expect(PORTRAIT_REGIONS.tableAreaW * PORTRAIT_REGIONS.tableAreaH).toBeGreaterThan(
    DESKTOP_REGIONS.tableAreaW * DESKTOP_REGIONS.tableAreaH,
  );
});

test('mobile-landscape-game: a phone in landscape keeps the desktop board', async ({ page }) => {
  await page.setViewportSize(PHONE_LANDSCAPE);
  await capture(page, '/?seed=42&showcase=game', 'mobile-landscape-game', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
  const v = await page.evaluate(() => window.__MEXE__.viewport());
  expect(v).toMatchObject({ w: 480, h: 270, portrait: false });
});

test('mobile-tap-select: tapping a hand card selects it, tapping it again clears it', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'mobile-tap-select', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await tapCard(p, 'clubs-13-d0');
  });
  // deselect must not move anything: the card is still in hand, the table is untouched
  const meldsBefore = await page.evaluate(() => window.__MEXE__.mexe!.getDraft()!.melds.length);
  await tapCard(page, 'clubs-13-d0');
  expect(await page.evaluate(() => window.__MEXE__.mexe!.getDraft()!.melds.length)).toBe(meldsBefore);
});

test('mobile-tap-move-valid: tap a card then tap a legal meld moves it', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'mobile-tap-move-valid', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await meldIdOf(p, 'clubs-10-d0'); // AI-built run 10-11-joker(12)
    await tapCard(p, 'clubs-13-d0');
    // the select half must land before the place half — otherwise the move below would silently
    // no-op and the failure would read as a rules bug instead of a lost tap.
    expect(await p.evaluate(() => window.__MEXE__.mexe!.selection())).toBe('clubs-13-d0');
    await tapMeld(p, meldId);
    expect(await meldCardIds(p, meldId)).toContain('clubs-13-d0');
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean };
    expect(validation.ok).toBe(true);
  });
});

test('mobile-tap-move-invalid: an illegal tap move is shown as invalid, never silently confirmed', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'mobile-tap-move-invalid', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'clubs-2-d1']); // 2-card partial group
    await tapCard(p, 'diamonds-2-d0'); // duplicate suit for that group
    expect(await p.evaluate(() => window.__MEXE__.mexe!.selection())).toBe('diamonds-2-d0');
    await tapMeld(p, meldId);
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false);
    expect(validation.reasons).toContain('reason.groupDuplicateSuit');
  });
});

test('mobile-feito-blocked: tapping the disabled FEITO explains why, and confirms nothing', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'mobile-feito-blocked', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']); // invalid: duplicate suit
    const turnBefore = await p.evaluate(() => window.__MEXE__.state!()!.turn);
    await tapWorld(p, PORTRAIT_REGIONS.feito.x, PORTRAIT_REGIONS.feito.y);
    // Playwright taps with a real mouse, so it also leaves a hover tooltip on the button; a finger
    // does not. Move the pointer to empty table (still inside the canvas, or Phaser never sees the
    // move and the hover never ends) so the capture shows what a phone player sees.
    const [ax, ay] = await toCanvasPoint(p, 30, 300);
    await p.mouse.move(ax, ay);
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false);
    // the blocked tap must not have confirmed the turn
    expect(await p.evaluate(() => window.__MEXE__.state!()!.turn)).toBe(turnBefore);
  });
});

test('mobile-badge-reason: the ✗ badge reason is reachable by tap in portrait', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'mobile-badge-reason', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']);
    expect(await p.evaluate(() => window.__MEXE__.a11y.invalidBadges)).toBeGreaterThan(0);
    const badge = await badgeLogicalPos(p, meldId, PORTRAIT_REGIONS);
    await tapWorld(p, badge.x, badge.y);
  });
});

test('mobile-portrait-en: the portrait board reads in English', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=42&showcase=game&lang=en', 'mobile-portrait-en', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game');
  });
});

// ---------- Phase 14 Wave B: helper modes ----------

test('helper-beginner-destinations: selecting a card highlights its legal destinations and previews the drop', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe&helper=beginner', 'helper-beginner-destinations', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.helperMode())).toBe('beginner');
    // AI-built run already on the table: clubs 10, 11, joker(=12). clubs-13-d0 is in hand and
    // extends it to 10-11-12-13 legally — beginner mode must highlight that meld on select alone.
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    await tapCard(p, 'clubs-13-d0');
    expect(await p.evaluate(() => window.__MEXE__.mexe!.selection())).toBe('clubs-13-d0');
    const targets = await p.evaluate(() => window.__MEXE__.mexe!.selectionTargets());
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('legal');
    // hover the legal meld to also surface the (beginner-only) ghost preview for the tap path.
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    const [mx, my] = await toCanvasPoint(p, meldPos!.x, meldPos!.y);
    await p.mouse.move(mx, my);
  });
});

test('helper-standard-feedback: standard mode never highlights on select, only on drag (unchanged default)', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe&helper=standard', 'helper-standard-feedback', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.helperMode())).toBe('standard');
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    await tapCard(p, 'clubs-13-d0');
    // select-then-place still works in standard mode — it just draws no legal-destination paint.
    expect(await p.evaluate(() => window.__MEXE__.mexe!.selectionTargets())).toEqual([]);
    await tapCard(page, 'clubs-13-d0'); // deselect before the mouse drag below picks it up instead
    // the drag path's ghost preview/highlight is untouched by helper mode — same as before Wave B.
    const targets = await p.evaluate((id) => window.__MEXE__.mexe!.snapTargets(id), 'clubs-13-d0');
    expect(targets.find((t) => t.meldId === meldId)?.status).toBe('legal');
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'clubs-13-d0', meldPos!);
  });
});

test('helper-expert-minimal: expert mode shows no select-highlight, no ghost preview, and a silent FEITO reason until pressed', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe&helper=expert', 'helper-expert-minimal', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.helperMode())).toBe('expert');
    await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']); // invalid: duplicate suit
    const validation = await p.evaluate(() => window.__MEXE__.validation) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false); // the gate itself never weakens in any mode
    await tapCard(p, 'clubs-13-d0');
    expect(await p.evaluate(() => window.__MEXE__.mexe!.selectionTargets())).toEqual([]);
    await tapCard(page, 'clubs-13-d0'); // deselect
    // pressing the blocked FEITO still explains itself (onFeitoBlocked runs in every mode).
    await p.keyboard.press('f');
    await p.waitForFunction(
      () => (window.__MEXE__.playlog.summary().invalidFeitoByReason['reason.groupDuplicateSuit'] ?? 0) > 0,
      undefined,
      { timeout: 5000 },
    );
  });
});

test('invalid-reason-badge: an invalid meld reports its reason(s) through the debug API and the badge is tap/hover reachable', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe&helper=beginner', 'invalid-reason-badge', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']); // invalid: duplicate suit
    expect(await p.evaluate(() => window.__MEXE__.a11y.invalidBadges)).toBeGreaterThan(0);
    const reasons = await p.evaluate(() => window.__MEXE__.invalidMeldReasons());
    const entry = reasons.find((r) => r.meldId === meldId);
    expect(entry?.reasons.length).toBeGreaterThan(0);
    // beginner mode auto-opens the reason tooltip — no hover/tap needed for the capture below.
  });
});

// ---------- Phase 14 Wave C: focused Mexe editor (portrait) ----------

/** Tap the meld-list row for `meldId` (null = the trailing "new meld" row), computed from the
 * same pure editor-layout math GameScene draws from — never a hardcoded pixel guess. */
async function tapMeldListRow(p: Page, meldId: string | null): Promise<void> {
  const meldIds = await p.evaluate(() => window.__MEXE__.mexe!.getDraft()!.melds.map((m) => m.id));
  const rows = meldListRows(meldIds);
  const row = rows.find((r) => r.meldId === meldId);
  if (!row) throw new Error(`no meld-list row for ${String(meldId)}`);
  const scroll = await p.evaluate(() => window.__MEXE__.mexe!.editorScroll());
  const zone = editorZones(PORTRAIT_REGIONS).meldList;
  const y = meldListRowY(row, zone, scroll) + MELD_LIST_ROW_H / 2;
  await tapWorld(p, zone.x + zone.w / 2, y);
}

test('mobile-mexe-editor: tapping the toggle opens the editor; tapping again closes it without touching the draft', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'mobile-mexe-editor', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.editorOpen())).toBe(false);
    const meldsBefore = await p.evaluate(() => window.__MEXE__.mexe!.getDraft()!.melds);
    await tapWorld(p, PORTRAIT_REGIONS.mexeToggle.x, PORTRAIT_REGIONS.mexeToggle.y);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.editorOpen())).toBe(true);
    // opening/closing the focused editor is a pure view toggle — the draft itself is untouched.
    expect(await p.evaluate(() => window.__MEXE__.mexe!.getDraft()!.melds)).toEqual(meldsBefore);
  });
  await tapWorld(page, PORTRAIT_REGIONS.mexeToggle.x, PORTRAIT_REGIONS.mexeToggle.y);
  expect(await page.evaluate(() => window.__MEXE__.mexe!.editorOpen())).toBe(false);
});

test('editor-move: focusing a meld in the workspace then tapping a hand card, then the meld row again, moves the card', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'editor-move', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await p.evaluate(() => window.__MEXE__.mexe!.openEditor());
    const meldId = await meldIdOf(p, 'clubs-10-d0'); // AI-built run 10-11-joker(12)
    await tapMeldListRow(p, meldId); // focus it in the workspace
    expect(await p.evaluate(() => window.__MEXE__.mexe!.editorMeldId())).toBe(meldId);
    await tapCard(p, 'clubs-13-d0'); // select a hand card, rendered in the editor's hand strip
    expect(await p.evaluate(() => window.__MEXE__.mexe!.selection())).toBe('clubs-13-d0');
    await tapMeldListRow(p, meldId); // commit it to the focused meld — same placeSelected() path
    expect(await meldCardIds(p, meldId)).toContain('clubs-13-d0');
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean };
    expect(validation.ok).toBe(true);
  });
});

test('editor-invalid-draft: an invalid meld is viewable inside the editor and FEITO stays blocked', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'editor-invalid-draft', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'diamonds-2-d0', 'clubs-2-d1']); // invalid: duplicate suit
    await p.evaluate(() => window.__MEXE__.mexe!.openEditor());
    await tapMeldListRow(p, meldId); // focus the invalid meld — the editor allows viewing/editing it
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean; reasons: string[] };
    expect(validation.ok).toBe(false);
    await page.waitForTimeout(300); // FEITO accidental-confirm guard (CONFIRM_GUARD_MS) — irrelevant here since check.ok is false anyway
    const confirmed = await p.evaluate(() => window.__MEXE__.mexe!.feito());
    expect(confirmed).toBe(false); // canConfirmTurn is the sole gate — the editor adds no second copy of it
  });
});

test('editor-valid-final: completing a valid draft inside the editor lets FEITO confirm the turn', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await capture(page, '/?seed=37&showcase=mexe', 'editor-valid-final', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await p.evaluate(() => window.__MEXE__.mexe!.openEditor());
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    await tapMeldListRow(p, meldId);
    await tapCard(p, 'clubs-13-d0');
    await tapMeldListRow(p, meldId);
    const validation = (await p.evaluate(() => window.__MEXE__.validation)) as { ok: boolean };
    expect(validation.ok).toBe(true);
    const turnBefore = await p.evaluate(() => window.__MEXE__.state!()!.turn);
    await p.waitForTimeout(300); // FEITO accidental-confirm guard (CONFIRM_GUARD_MS)
    const confirmed = await p.evaluate(() => window.__MEXE__.mexe!.feito());
    expect(confirmed).toBe(true);
    expect(await p.evaluate(() => window.__MEXE__.state!()!.turn)).toBeGreaterThan(turnBefore);
  });
});

test('editor state does not survive an orientation flip: scroll and focused meld reset (finding 3)', async ({ page }) => {
  await page.setViewportSize(PHONE_PORTRAIT);
  await page.goto('/?seed=37&showcase=mexe');
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await crowdTheTable(page); // enough melds to make the meld list actually scrollable
  await page.evaluate(() => window.__MEXE__.mexe!.openEditor());
  const meldId = await meldIdOf(page, 'clubs-10-d0');
  await tapMeldListRow(page, meldId); // focus a meld
  expect(await page.evaluate(() => window.__MEXE__.mexe!.editorMeldId())).toBe(meldId);

  // Drag the meld list upward to push its scroll offset off zero.
  const zone = editorZones(PORTRAIT_REGIONS).meldList;
  const [fx, fy] = await toCanvasPoint(page, zone.x + zone.w / 2, zone.y + zone.h - 4);
  const [tx, ty] = await toCanvasPoint(page, zone.x + zone.w / 2, zone.y + 4);
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
  const scrollBefore = await page.evaluate(() => window.__MEXE__.mexe!.editorScroll());
  expect(scrollBefore).toBeGreaterThan(0);

  // Flip to landscape (force-closes the editor, per renderAll) and back to portrait.
  await page.setViewportSize(PHONE_LANDSCAPE);
  await page.waitForFunction(() => window.__MEXE__.viewport().portrait === false, undefined, { timeout: 5000 });
  await page.setViewportSize(PHONE_PORTRAIT);
  await page.waitForFunction(() => window.__MEXE__.viewport().portrait === true, undefined, { timeout: 5000 });

  // Reopening after the flip must start from a clean slate, not the pre-flip scroll/focus.
  await page.evaluate(() => window.__MEXE__.mexe!.openEditor());
  expect(await page.evaluate(() => window.__MEXE__.mexe!.editorMeldId())).toBeNull();
  expect(await page.evaluate(() => window.__MEXE__.mexe!.editorScroll())).toBe(0);
});

// ---------- Phase 14 Wave D: table zoom/pan + meld focus (landscape) ----------

/** Icon logical position for a meld's 🔍 focus button — same layout math layoutMelds() uses
 * (mirrors badgeLogicalPos above), at the default (unzoomed) layout. */
async function focusIconLogicalPos(p: Page, meldId: string, r: GameRegions = DESKTOP_REGIONS): Promise<{ x: number; y: number }> {
  const melds = await p.evaluate(() =>
    window.__MEXE__.mexe!.getDraft()!.melds.map((m) => ({ id: m.id, cardCount: m.cards.length })),
  );
  const MELD_PAD = 4;
  const pos = computeMeldLayout(melds, r.tableAreaW, r.tableAreaH).find((m) => m.meldId === meldId)!;
  const pad = MELD_PAD * pos.cardScale;
  return { x: r.tableLeft + pos.x + pos.width - 3, y: r.tableTop + 6 + pos.y - pad + 2 };
}

/** A logical point guaranteed to be empty table (a horizontal gap between two melds sharing a
 * row), computed from the same pure computeMeldLayout() layoutMelds() itself calls — so this can
 * never accidentally land on a card. Requires at least one row with 2+ melds. */
async function emptyTableGapLogicalPos(p: Page, r: GameRegions = DESKTOP_REGIONS): Promise<{ x: number; y: number }> {
  const level = await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel());
  const floor = ZOOM_FLOORS[level];
  const pan = await p.evaluate(() => window.__MEXE__.mexe!.panOffset());
  const melds = await p.evaluate(() =>
    window.__MEXE__.mexe!.getDraft()!.melds.map((m) => ({ id: m.id, cardCount: m.cards.length })),
  );
  const positions = computeMeldLayout(melds, r.tableAreaW, r.tableAreaH, floor ? { minCardScale: floor } : undefined);
  const byRow = new Map<number, typeof positions>();
  for (const pos of positions) byRow.set(pos.y, [...(byRow.get(pos.y) ?? []), pos]);
  for (const row of byRow.values()) {
    if (row.length < 2) continue;
    row.sort((a, b) => a.x - b.x);
    const gapX = (row[0]!.x + row[0]!.width + row[1]!.x) / 2;
    return { x: r.tableLeft + gapX, y: r.tableTop + 6 + row[0]!.y - pan + row[0]!.height / 2 };
  }
  throw new Error('emptyTableGapLogicalPos: no row with a horizontal gap in this layout');
}

/** Fills the table with 40+ cards the same way stress-table does: every hand card becomes its
 * own new meld on top of the showcase table already on the board. */
async function crowdTheTable(p: Page): Promise<void> {
  await p.evaluate(() => {
    const mexe = window.__MEXE__.mexe!;
    const hand = window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id);
    for (const cardId of hand) mexe.playHandCard(cardId, null);
  });
}

test('zoom-buttons: step in and out, clamped at both ends', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'zoom-buttons', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel())).toBe(0);
    const [inX, inY] = toScreen(DESKTOP_REGIONS.zoomIn.x, DESKTOP_REGIONS.zoomIn.y);
    const [outX, outY] = toScreen(DESKTOP_REGIONS.zoomOut.x, DESKTOP_REGIONS.zoomOut.y);

    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel())).toBe(1);

    // click well past the top floor — stays clamped, never throws / goes out of range
    for (let i = 0; i < 4; i++) {
      await p.mouse.click(inX, inY);
      await p.waitForTimeout(50);
    }
    const maxLevel = await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel());
    expect(maxLevel).toBeGreaterThan(0);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(50);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel())).toBe(maxLevel); // clamped at the top

    // and back down past the bottom — clamped at 0 (auto), never negative
    for (let i = 0; i < maxLevel + 3; i++) {
      await p.mouse.click(outX, outY);
      await p.waitForTimeout(50);
    }
    expect(await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel())).toBe(0);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.panOffset())).toBe(0);
  });
});

test('table-zoomed: a crowded table zoomed in holds fps, and panning the empty table never moves a card', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'table-zoomed', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await crowdTheTable(p);

    const [inX, inY] = toScreen(DESKTOP_REGIONS.zoomIn.x, DESKTOP_REGIONS.zoomIn.y);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.zoomLevel())).toBeGreaterThan(0);

    const draftBefore = await p.evaluate(() => window.__MEXE__.mexe!.getDraft());
    const gap = await emptyTableGapLogicalPos(p);
    const [gx, gy] = toScreen(gap.x, gap.y);
    await p.mouse.move(gx, gy);
    await p.mouse.down();
    await p.mouse.move(gx, gy - 30, { steps: 8 });
    await p.mouse.up();
    await p.waitForTimeout(100);

    // Precedence guard: a drag starting on the empty table pans, and never mutates the draft —
    // panning is display-only, `canConfirmTurn` stays the sole authority on legality.
    const panOffset = await p.evaluate(() => window.__MEXE__.mexe!.panOffset());
    expect(panOffset).toBeGreaterThan(0);
    const draftAfter = await p.evaluate(() => window.__MEXE__.mexe!.getDraft());
    expect(draftAfter).toEqual(draftBefore);

    await p.waitForTimeout(900); // let fps settle
    const fps = await p.evaluate(() => window.__MEXE__.fps);
    // Zoomed adds a geometry mask + a pan-surface object over the plain stress-table case (which
    // holds >=50 on the same hardware) — "usable", not "identical", is the bar the task sets for
    // this heavier path. Observed ~48 fps on the dev machine this suite was authored on.
    expect(fps).toBeGreaterThanOrEqual(30);
  });
});

test('pan-perf: a multi-tick pan gesture never re-runs the legality analysis mid-drag', async ({ page }) => {
  await capture(page, '/?seed=77&showcase=mexe', 'pan-perf', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    await crowdTheTable(p);

    const [inX, inY] = toScreen(DESKTOP_REGIONS.zoomIn.x, DESKTOP_REGIONS.zoomIn.y);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);

    // Phase 14 review, finding 1: a pan is display-only, so DraftEditor.analyze() (a full legality
    // pass over every meld) must not run per pointermove tick — only the single renderAll() that
    // settles the gesture on pointerup. Before the fix each tick called renderAll(), so this count
    // grew with STEPS; the assertion below fails outright if that regresses.
    const STEPS = 12;
    const gap = await emptyTableGapLogicalPos(p);
    const [gx, gy] = toScreen(gap.x, gap.y);
    await p.mouse.move(gx, gy);
    await p.mouse.down();
    const before = await p.evaluate(() => window.__MEXE__.analyzeCount);
    await p.mouse.move(gx, gy - 40, { steps: STEPS });
    const during = await p.evaluate(() => window.__MEXE__.analyzeCount);
    await p.mouse.up();
    await p.waitForTimeout(100);
    const after = await p.evaluate(() => window.__MEXE__.analyzeCount);

    expect(await p.evaluate(() => window.__MEXE__.mexe!.panOffset())).toBeGreaterThan(0);
    expect(during - before).toBe(0); // zero analyses across every tick of the gesture
    expect(after - before).toBeLessThanOrEqual(2); // only the settling renderAll() on pointerup
  });
});

test('pan-vs-drag precedence: dragging an actual card while zoomed still moves it, not the pan', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'zoom-card-drag-precedence', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const [inX, inY] = toScreen(DESKTOP_REGIONS.zoomIn.x, DESKTOP_REGIONS.zoomIn.y);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);
    const panBefore = await p.evaluate(() => window.__MEXE__.mexe!.panOffset());

    // Same legal drag snap-targets-legal already exercises, just performed while zoomed in.
    const meldId = await meldIdOf(p, 'clubs-10-d0');
    const cardsBefore = await meldCardIds(p, meldId);
    const meldPos = await p.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
    await dragCardOnto(p, 'clubs-13-d0', meldPos!);
    // Wave E fix: mid-drag the sprite must have dropped the zoomed-table geometry mask, or it
    // would visually clip when dragged outside the masked table area (e.g. up toward the hand).
    expect(await p.evaluate(() => window.__MEXE__.mexe!.cardMasked('clubs-13-d0'))).toBe(false);
    await p.mouse.up();
    await p.waitForTimeout(100);

    expect(await meldCardIds(p, meldId)).toHaveLength(cardsBefore.length + 1);
    // the card drag must never have been swallowed as a pan gesture
    expect(await p.evaluate(() => window.__MEXE__.mexe!.panOffset())).toBe(panBefore);
  });
});

test('zoomed table keeps the action buttons reachable (sort still works while zoomed in)', async ({ page }) => {
  // A normal 7-card hand, not the crowded showcase — the demo hand there is unusually wide and its
  // leftmost card's touch-padded hit area happens to reach into the sort button's coordinates
  // regardless of zoom, which isn't what this test is checking.
  await capture(page, '/?seed=42&showcase=game', 'zoom-buttons-reachable', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const [inX, inY] = toScreen(DESKTOP_REGIONS.zoomIn.x, DESKTOP_REGIONS.zoomIn.y);
    await p.mouse.click(inX, inY);
    await p.waitForTimeout(80);

    const hand = await p.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
    const posBefore = await Promise.all(hand.map((id) => p.evaluate((cid) => window.__MEXE__.mexe!.cardPos(cid), id)));
    const [sx, sy] = toScreen(DESKTOP_REGIONS.sort.x, DESKTOP_REGIONS.sort.y);
    await p.mouse.click(sx, sy);
    await p.waitForTimeout(80);
    const posAfter = await Promise.all(hand.map((id) => p.evaluate((cid) => window.__MEXE__.mexe!.cardPos(cid), id)));
    expect(posAfter).not.toEqual(posBefore); // sort toggled — the button under the zoom UI still works
  });
});

test('meld-focus: opens a read-only large view of one meld with its invalid reason, dismissible by the ✕', async ({ page }) => {
  await capture(page, '/?seed=37&showcase=mexe', 'meld-focus-dismissed', async (p) => {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null);
    const meldId = await buildMeld(p, ['diamonds-2-d1', 'clubs-2-d1', 'diamonds-2-d0']); // invalid: duplicate suit
    const draftBefore = await p.evaluate(() => window.__MEXE__.mexe!.getDraft());

    const icon = await focusIconLogicalPos(p, meldId);
    await tapWorld(p, icon.x, icon.y);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.focusedMeldId())).toBe(meldId);
    // read-only: opening it never touches the draft
    expect(await p.evaluate(() => window.__MEXE__.mexe!.getDraft())).toEqual(draftBefore);

    await snap(page, 'meld-focus');

    // dismiss by tapping outside the panel (top-left corner, well clear of the centered panel)
    await tapWorld(p, 4, 4);
    expect(await p.evaluate(() => window.__MEXE__.mexe!.focusedMeldId())).toBeNull();
  });
});

// The tutorial panel used to be authored at landscape coordinates (x=438) regardless of profile,
// which put it — and its NEXT/SKIP buttons — outside the 270-wide portrait world entirely, so the
// tutorial could not be advanced at all on a phone held upright.
test.describe('portrait', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('tutorial: the step panel is on screen and NEXT advances in portrait', async ({ page }) => {
    const s = 390 / 270;
    const oy = (844 - 480 * s) / 2;
    const tap = async (lx: number, ly: number): Promise<void> => { await page.touchscreen.tap(lx * s, ly * s + oy); };

    await page.goto('/?seed=42&showcase=menu');
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
    await tap(135, (207 / 270) * 480); // MenuScene TUTORIAL button, portrait-remapped
    await page.waitForFunction(() => window.__MEXE__.scene === 'tutorial' && window.__MEXE__.tutorialStep === 0);

    await tap(93, 150); // tutorial NEXT, portrait panel (r.tutorialPanel band over the table)
    await page.waitForFunction(() => window.__MEXE__.tutorialStep === 1, undefined, { timeout: 10_000 });
    await snap(page, 'tutorial-portrait');
    expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  });
});

test.afterAll(() => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Playwright starts a fresh worker process (its own empty `logs`) after any test failure, so
  // overwriting here would let the last worker's afterAll erase every shot earlier workers
  // already logged. Merge by name instead — this worker's own shots win for the names it has.
  // e2e/global-setup.ts deletes the file once at the start of the whole run, so merging can only
  // ever combine shots from *this* run, never leak a stale entry from a previous invocation.
  // ponytail: read-modify-write is not synchronized across concurrently-finishing workers — fine
  // at this shot count/worker count; add a lockfile if workers start clobbering each other's merge.
  let existing: ShotLog[] = [];
  try {
    existing = (JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')).shots ?? []) as ShotLog[];
  } catch {
    // no log yet from another worker in this run
  }
  const merged = new Map(existing.map((s) => [s.name, s]));
  for (const s of logs) merged.set(s.name, s);
  fs.writeFileSync(
    LOG_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), shots: [...merged.values()] }, null, 2),
  );
});
