import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { gameRegions, type GameRegions } from '../src/ui/regions';

/**
 * Phase 19 mobile GAMEPLAY probe: e2e-cross/layout.spec.ts and rotate.spec.ts only ever check that
 * the canvas fits the viewport — neither one taps, drags, or plays a card. This is the missing
 * WebKit/iOS coverage for actual play: select, drag, FEITO, undo/reset, draw, and orientation
 * flips mid-match. Runs on the touch WebKit projects only (ios safari / ios safari portrait /
 * ipad) — desktop and Chromium already have equivalent coverage in e2e/screenshot.spec.ts and are
 * skipped here to keep this suite iOS-focused.
 *
 * A probe against this project (see PR discussion) confirmed page.mouse.{move,down,up} DOES
 * dispatch real pointer events under Playwright's WebKit touch emulation (hasTouch/isMobile) —
 * unlike Chromium, which drops page.mouse.click on a touch-emulated page (see layout.spec.ts's
 * settings-slider test). So this suite drives every gesture with page.mouse, matching the
 * dragCardOnto/tapWorld idioms in e2e/screenshot.spec.ts, and skips on non-WebKit projects.
 */
const TOUCH_PROJECTS = new Set(['ios safari', 'ios safari portrait', 'ipad']);

const OUT_DIR = 'docs/screenshots';

test.beforeEach(({ }, testInfo) => {
  test.skip(!TOUCH_PROJECTS.has(testInfo.project.name), 'mobile gameplay probe targets WebKit/iOS touch projects only');
});

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUT_DIR, `phase19-mobile-${name}.png`) });
}

async function boot(page: Page, url = '/?seed=42&showcase=game'): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__MEXE__.scene === 'game' && window.__MEXE__.mexe !== null, undefined, {
    timeout: 30_000,
  });
}

/** World -> screen for whichever world is live, mirrors e2e/screenshot.spec.ts's toCanvasPoint. */
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
  // Phaser drains its pointer queue once per frame — give each tap its own rendered frame so two
  // taps issued back to back (select, then place) don't collapse into one.
  await p.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function tapCard(p: Page, cardId: string): Promise<void> {
  const pos = await p.evaluate((id) => window.__MEXE__.mexe!.cardPos(id), cardId);
  if (!pos) throw new Error(`card ${cardId} not on screen`);
  await tapWorld(p, pos.x, pos.y);
}

/** Real drag: press on the card, move onto the target in a few steps (fires Phaser's drag
 * threshold and the legality-aware highlights), then release. Mirrors dragCardOnto in
 * e2e/screenshot.spec.ts but releases the mouse too — this suite asserts post-drop state. */
async function dragCardOnto(p: Page, cardId: string, toLogical: { x: number; y: number }): Promise<void> {
  const from = await p.evaluate((id) => window.__MEXE__.mexe!.cardPos(id), cardId);
  if (!from) throw new Error(`card ${cardId} not on screen`);
  const [fx, fy] = await toCanvasPoint(p, from.x, from.y);
  const [tx, ty] = await toCanvasPoint(p, toLogical.x, toLogical.y);
  await p.mouse.move(fx, fy);
  await p.mouse.down();
  await p.mouse.move(tx, ty, { steps: 8 });
  await p.mouse.up();
  await p.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function regionsFor(p: Page): Promise<GameRegions> {
  const v = await p.evaluate(() => window.__MEXE__.viewport());
  return gameRegions(v);
}

async function errors(p: Page): Promise<string[]> {
  return p.evaluate(() => window.__MEXE__.errors);
}

async function totalCardIds(p: Page): Promise<string[]> {
  return p.evaluate(() => {
    const s = window.__MEXE__.state!()!;
    const ids: string[] = [];
    for (const pl of s.players) for (const c of pl.hand) ids.push(c.id);
    for (const m of s.table) for (const c of m.cards) ids.push(c.id);
    for (const c of s.drawPile) ids.push(c.id);
    return ids.sort();
  });
}

// ---------------------------------------------------------------------------------------------

test('local match starts and reaches a playable human turn (landscape)', async ({ page }) => {
  await boot(page);
  const hand = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
  expect(hand.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__MEXE__.mexe!.getDraft())).not.toBeNull();
  await shot(page, 'landscape-boot');
  expect(await errors(page)).toEqual([]);
});

test.describe('portrait', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('local match starts and reaches a playable human turn (portrait)', async ({ page }) => {
    await boot(page);
    const hand = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
    expect(hand.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__MEXE__.viewport().portrait)).toBe(true);
    await shot(page, 'portrait-boot');
    expect(await errors(page)).toEqual([]);
  });
});

test('tap a hand card to select it, tap again to deselect', async ({ page }) => {
  await boot(page);
  const hand = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
  const cardId = hand[0]!;

  expect(await page.evaluate(() => window.__MEXE__.mexe!.selection())).toBeNull();
  await tapCard(page, cardId);
  expect(await page.evaluate(() => window.__MEXE__.mexe!.selection())).toBe(cardId);

  await tapCard(page, cardId);
  expect(await page.evaluate(() => window.__MEXE__.mexe!.selection())).toBeNull();

  await shot(page, 'select-deselect');
  expect(await errors(page)).toEqual([]);
});

test('tap a card onto the table builds/extends a draft meld (valid destination)', async ({ page }) => {
  await boot(page, '/?seed=42&showcase=mexe');
  const totalCardsBefore = (await page.evaluate(() => window.__MEXE__.mexe!.getDraft()!.melds)).reduce(
    (n, m) => n + m.cards.length,
    0,
  );
  const hand = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
  const cardId = hand[0]!;

  await tapCard(page, cardId); // select
  // Top-left corner of the table area itself (r.tableLeft/tableTop, per src/ui/regions.ts) —
  // whatever is there (empty gap or an existing meld), a tap while holding a card is a legal
  // drop: it either starts a new meld or joins the existing one, never a rejected no-op.
  const r = await regionsFor(page);
  await tapWorld(page, r.tableLeft + 10, r.tableTop + 10);

  const draft = await page.evaluate(() => window.__MEXE__.mexe!.getDraft()!);
  expect(draft.handCardsPlayed).toContain(cardId);
  const totalCardsAfter = draft.melds.reduce((n, m) => n + m.cards.length, 0);
  expect(totalCardsAfter).toBe(totalCardsBefore + 1);
  await shot(page, 'tap-valid-destination');
  expect(await errors(page)).toEqual([]);
});

test('tap outside any interactive zone is a no-op (invalid destination): draft unchanged, reason available', async ({
  page,
}) => {
  await boot(page, '/?seed=37&showcase=mexe');
  const before = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  const hand = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
  const cardId = hand[0]!;

  await tapCard(page, cardId); // select
  // A corner of the world, clear of every card/meld/button — background, not interactive.
  await tapWorld(page, 2, 2);

  const after = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  expect(after).toEqual(before); // no meld/hand mutation from a tap that hit nothing

  // reject a bogus move outright too — the contract e2e hooks give for an invalid destination.
  const moved = await page.evaluate(
    (id) => window.__MEXE__.mexe!.moveTableCard(id, 'not-a-real-meld-id'),
    cardId,
  );
  expect(moved).toBe(false);
  expect(await page.evaluate(() => window.__MEXE__.mexe!.getDraft())).toEqual(before);

  await shot(page, 'tap-invalid-destination');
  expect(await errors(page)).toEqual([]);
});

test('drag a card onto a valid meld extends it', async ({ page }) => {
  // AI-built table: clubs 10, 11, joker(=12) on the table; clubs-13-d0 legally extends it.
  await boot(page, '/?seed=37&showcase=mexe');
  const meldId = await page.evaluate(() => {
    const draft = window.__MEXE__.mexe!.getDraft()!;
    return draft.melds.find((m) => m.cards.some((c) => c.id === 'clubs-10-d0'))!.id;
  });
  const before = await page.evaluate(
    (id) => window.__MEXE__.mexe!.getDraft()!.melds.find((m) => m.id === id)!.cards.length,
    meldId,
  );
  const meldPos = await page.evaluate((id) => window.__MEXE__.mexe!.meldPos(id), meldId);
  await dragCardOnto(page, 'clubs-13-d0', meldPos!);

  const after = await page.evaluate(
    (id) => window.__MEXE__.mexe!.getDraft()!.melds.find((m) => m.id === id)?.cards.length ?? 0,
    meldId,
  );
  expect(after).toBe(before + 1);
  const draft = await page.evaluate(() => window.__MEXE__.mexe!.getDraft()!);
  expect(draft.handCardsPlayed).toContain('clubs-13-d0');
  await shot(page, 'drag-valid-meld');
  expect(await errors(page)).toEqual([]);
});

test('drag a card that leaves the table (invalid drop) restores the draft unchanged', async ({ page }) => {
  await boot(page, '/?seed=37&showcase=mexe');
  const before = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  const from = await page.evaluate(() => window.__MEXE__.mexe!.cardPos('clubs-13-d0'));
  const [fx, fy] = await toCanvasPoint(page, from!.x, from!.y);
  // Drop far outside the canvas entirely — no drop zone accepts it, so the drag must cancel.
  await page.mouse.move(fx, fy);
  await page.mouse.down();
  await page.mouse.move(fx + 2000, fy + 2000, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  const after = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  expect(after).toEqual(before);
  await shot(page, 'drag-invalid-drop');
  expect(await errors(page)).toEqual([]);
});

test('FEITO while blocked stays blocked and the reason is reported, not silent', async ({ page }) => {
  // seed 37 duplicate-suit group: known-invalid meld (see e2e/screenshot.spec.ts's
  // repeated-suit-group test), so canConfirm() is false and FEITO must refuse.
  await boot(page, '/?seed=37&showcase=mexe');
  await page.evaluate(() => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard('diamonds-2-d1', null);
    const meldId = mexe.getDraft()!.melds.find((m) => m.cards.some((c) => c.id === 'diamonds-2-d1'))!.id;
    mexe.playHandCard('diamonds-2-d0', meldId);
    mexe.playHandCard('clubs-2-d1', meldId);
  });
  const reasonsBefore = await page.evaluate(() => window.__MEXE__.invalidMeldReasons());
  expect(reasonsBefore.some((r) => r.reasons.length > 0)).toBe(true);
  const draftBefore = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());

  // real tap on the FEITO button surfaces the on-screen blocked reason (mexe.feito() alone would
  // just return false without touching the UI's reasonText — this exercises the real tap path).
  const r = await regionsFor(page);
  await tapWorld(page, r.feito.x, r.feito.y);

  expect(await page.evaluate(() => window.__MEXE__.mexe!.getDraft())).toEqual(draftBefore); // still blocked
  const feitoOk = await page.evaluate(() => window.__MEXE__.mexe!.feito());
  expect(feitoOk).toBe(false);
  const reasonsAfter = await page.evaluate(() => window.__MEXE__.invalidMeldReasons());
  expect(reasonsAfter.some((r) => r.reasons.length > 0)).toBe(true); // reason still surfaced, not silently dropped

  await shot(page, 'feito-blocked');
  expect(await errors(page)).toEqual([]);
});

test('undo restores the previous draft, reset restores the original', async ({ page }) => {
  await boot(page, '/?seed=42&showcase=game');
  const original = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  const hand = await page.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.map((c) => c.id));
  const cardId = hand[0]!;

  await page.evaluate((id) => window.__MEXE__.mexe!.playHandCard(id, null), cardId);
  const afterPlay = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  expect(afterPlay!.handCardsPlayed).toContain(cardId);

  expect(await page.evaluate(() => window.__MEXE__.mexe!.undo())).toBe(true);
  const afterUndo = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  expect(afterUndo).toEqual(original);

  // play two cards, then hit the real RESET button (no debug hook exists for reset — it's UI-only)
  const cardId2 = hand[1]!;
  await page.evaluate((id) => window.__MEXE__.mexe!.playHandCard(id, null), cardId);
  await page.evaluate((id) => window.__MEXE__.mexe!.playHandCard(id, null), cardId2);
  const r = await regionsFor(page);
  await tapWorld(page, r.reset.x, r.reset.y);
  const afterReset = await page.evaluate(() => window.__MEXE__.mexe!.getDraft());
  expect(afterReset).toEqual(original);

  await shot(page, 'undo-reset');
  expect(await errors(page)).toEqual([]);
});

test.describe('portrait editor', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Mexe Mode focused editor opens and closes (portrait)', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.__MEXE__.mexe!.editorOpen())).toBe(false);
    await page.evaluate(() => window.__MEXE__.mexe!.openEditor());
    expect(await page.evaluate(() => window.__MEXE__.mexe!.editorOpen())).toBe(true);
    await shot(page, 'portrait-editor-open');
    await page.evaluate(() => window.__MEXE__.mexe!.closeEditor());
    expect(await page.evaluate(() => window.__MEXE__.mexe!.editorOpen())).toBe(false);
    expect(await errors(page)).toEqual([]);
  });
});

test('COMPRAR (draw) advances the turn', async ({ page }) => {
  await boot(page);
  const before = await page.evaluate(() => ({
    activePlayerIndex: window.__MEXE__.state!()!.activePlayerIndex,
    turn: window.__MEXE__.state!()!.turn,
  }));
  await page.evaluate(() => window.__MEXE__.mexe!.comprar());
  await page.waitForFunction(
    (t) => window.__MEXE__.state !== null && window.__MEXE__.state()!.turn > t,
    before.turn,
    { timeout: 10_000 },
  );
  const after = await page.evaluate(() => ({
    activePlayerIndex: window.__MEXE__.state!()!.activePlayerIndex,
    turn: window.__MEXE__.state!()!.turn,
  }));
  expect(after.turn).toBeGreaterThan(before.turn);
  await shot(page, 'comprar');
  expect(await errors(page)).toEqual([]);
});

test('orientation change mid-match does not corrupt state (card conservation)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // portrait
  await boot(page);
  const before = await totalCardIds(page);

  await page.setViewportSize({ width: 844, height: 390 }); // landscape
  await page.waitForTimeout(500); // main.ts resize handler is debounced 150ms + a frame
  await page.waitForFunction(() => window.__MEXE__.viewport().portrait === false, undefined, { timeout: 5000 });
  const afterLandscape = await totalCardIds(page);
  expect(afterLandscape).toEqual(before);

  await page.setViewportSize({ width: 390, height: 844 }); // back to portrait
  await page.waitForTimeout(500);
  await page.waitForFunction(() => window.__MEXE__.viewport().portrait === true, undefined, { timeout: 5000 });
  const afterPortrait = await totalCardIds(page);
  expect(afterPortrait).toEqual(before);

  // draft survives the flip too — nothing rebuilt from stale card refs
  expect(await page.evaluate(() => window.__MEXE__.mexe!.getDraft())).not.toBeNull();

  await shot(page, 'rotate-mid-match');
  expect(await errors(page)).toEqual([]);
});
