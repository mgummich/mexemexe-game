import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { freePort, startTestServer, type TestServer } from './harness';

/**
 * Phase 5 multiplayer verification: launches the real WS server and drives two browser
 * contexts through the full online flow. Separate spec file + separate script from
 * `npm run verify` on purpose — a server crash here must never fail local verify.
 * See docs/MULTIPLAYER.md §11.
 */

const OUT_DIR = 'docs/screenshots';
// One evidence shard per worker process, merged back into verify-multiplayer-log.json by
// scripts/check-verify-multiplayer.mjs — the shape e2e/screenshot.spec.ts already uses. The old
// single shared file cannot survive parallel workers: two read-modify-write cycles interleave and
// one worker's evidence silently disappears.
const PARTS_DIR = path.join(OUT_DIR, 'verify-multiplayer-log-parts');
const PART_PATH = path.join(PARTS_DIR, `${randomUUID()}.json`);
// This file runs parallel (see the describe.configure below), so every worker spawns its own
// server. The port comes from the OS (`freePort`), not from a per-worker block: a fixed block is
// shared with everything else on the machine, and when something already owned it the server died
// on EADDRINUSE while the health probe was answered by that other process — the suite then ran
// against a stranger and reported the fallout as a lobby bug. `startTestServer` also fails loudly
// now if the child dies or the answer comes from a foreign server (see harness.ts).
let WS_URL = '';
// Fixed so the deal is deterministic: seat 0's hand contains a ready-made legal run
// (diamonds J-Q-K), and the draw pile always holds 108 - 2*7 = 94 cards (used below to
// run the match to a real, server-decided stalemate game_over).
const TEST_SEED = 2;
const LEGAL_MELD_CARDS = ['diamonds-11-d0', 'diamonds-12-d0', 'diamonds-13-d0'];

let server: TestServer;

// Every test here builds its own rooms from scratch against its worker's own server, so nothing
// in this file is ordered — running it parallel is what takes the CI job off the critical path
// (it was ~16m serial, the longest job on every PR). Workers come from
// playwright.multiplayer.config.ts; the lobby specs stay one-worker-per-file.
test.describe.configure({ mode: 'parallel' });

test.beforeAll(async () => {
  server = await startTestServer(await freePort(), TEST_SEED);
  WS_URL = server.url;
});

test.afterAll(async () => {
  server.stop();
  // Per worker, not per suite: each worker runs its own server, and a crash in any of them has
  // to reach the gate. The gate concatenates every shard's server output.
  appendLog({ server: { stdout: server.stdout, stderr: server.stderr } });
});

const SCALE = 1280 / 480; // logical 480x270 canvas fills the 1280x720 viewport (Scale.FIT)
const toScreen = (lx: number, ly: number): [number, number] => [lx * SCALE, ly * SCALE];

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

async function newClient(browser: Browser, wsUrl = WS_URL): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  await page.goto(`/?ws=${encodeURIComponent(wsUrl)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  // MenuScene ONLINE button, logical (240, 254) — see MenuScene's onlineBtn.
  const [ox, oy] = toScreen(240, 254);
  await page.mouse.click(ox, oy);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });
  return page;
}

async function shot(pages: Record<string, Page>, name: string, screenshots: string[]): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [key, page] of Object.entries(pages)) {
    await page.waitForTimeout(200); // let tweens settle
    const file = path.join(OUT_DIR, `mp-${name}-${key}.png`);
    await page.screenshot({ path: file });
    screenshots.push(file);
  }
}

test('two clients: create, join, ready, legal turn, illegal proposal, reconnect/resync', async ({
  browser,
}) => {
  const revisionsObserved: number[] = [];
  const screenshots: string[] = [];

  const pageA = await newClient(browser);
  const pageB = await newClient(browser);

  // --- create + join ---
  await pageA.evaluate(() => window.__MEXE__.online!.createRoom('A'));
  await pageA.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = await pageA.evaluate(() => window.__MEXE__.online!.code());
  expect(code).toMatch(/^[A-Z0-9]{5}$/);

  await shot({ a: pageA }, 'lobby-code', screenshots);

  await pageB.evaluate((c) => window.__MEXE__.online!.joinRoom(c!, 'B'), code);
  await pageB.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  // --- ready lobby, captured BEFORE the game starts (V2): A readies first, B does not yet, so
  // the lobby is still showing — both players listed, A's row reads PRONTO/READY, B's reads
  // AGUARDANDO/WAITING. Waiting on B's own player-list view (not a sleep) avoids racing the
  // server's auto-start once B also readies. ---
  await pageA.evaluate(() => window.__MEXE__.online!.setReady(true));
  await pageB.waitForFunction(
    () => window.__MEXE__.online!.players().some((p) => p.seat === 0 && p.ready),
    undefined,
    { timeout: 10_000 },
  );
  await shot({ a: pageA, b: pageB }, 'both-ready', screenshots);

  // --- both ready, then host explicitly starts ---
  await pageB.evaluate(() => window.__MEXE__.online!.setReady(true));
  await pageA.waitForFunction(
    () => window.__MEXE__.online!.players().length === 2 && window.__MEXE__.online!.players().every((p) => p.ready),
    undefined,
    { timeout: 10_000 },
  );
  await pageA.evaluate(() => window.__MEXE__.online!.startGame());

  await pageA.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });
  await pageB.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });

  // The shuffle seed must never reach a client: with it, either player could reproduce the deal
  // (both hands and the whole draw pile) through the shared shuffle/deal functions. Online clients
  // report seed 0 because they never deal — the server does.
  expect(await pageA.evaluate(() => window.__MEXE__.seed)).toBe(0);
  expect(await pageB.evaluate(() => window.__MEXE__.seed)).toBe(0);

  const revA0 = await pageA.evaluate(() => window.__MEXE__.online!.rev());
  const revB0 = await pageB.evaluate(() => window.__MEXE__.online!.rev());
  expect(revA0).toBe(revB0);
  revisionsObserved.push(revA0!);

  await shot({ active: pageA, waiting: pageB }, 'in-match', screenshots);

  // --- legal turn: seat 0 (client A) plays a real meld it was dealt (fixed by TEST_SEED) ---
  const played = await pageA.evaluate((cardIds) => {
    const mexe = window.__MEXE__.mexe!;
    mexe.playHandCard(cardIds[0]!, null);
    const meldId = mexe.getDraft()!.melds[0]!.id;
    mexe.playHandCard(cardIds[1]!, meldId);
    mexe.playHandCard(cardIds[2]!, meldId);
    return mexe.getDraft();
  }, LEGAL_MELD_CARDS);
  expect(played?.melds).toHaveLength(1);
  await pageA.waitForTimeout(300); // FEITO accidental-confirm guard (CONFIRM_GUARD_MS)
  const confirmed = await pageA.evaluate(() => window.__MEXE__.mexe!.feito());
  expect(confirmed).toBe(true);

  await pageA.waitForFunction((prev) => (window.__MEXE__.online?.rev() ?? null) !== prev, revA0, { timeout: 10_000 });
  await pageB.waitForFunction((prev) => (window.__MEXE__.online?.rev() ?? null) !== prev, revB0, { timeout: 10_000 });
  const revA1 = await pageA.evaluate(() => window.__MEXE__.online!.rev());
  const revB1 = await pageB.evaluate(() => window.__MEXE__.online!.rev());
  expect(revA1).toBe(revB1);
  expect(revA1).toBeGreaterThan(revA0!);
  revisionsObserved.push(revA1!);
  // both clients agree on the table after the legal move
  const tableA = await pageA.evaluate(() => window.__MEXE__.state!()!.table.map((m) => m.cards.map((c) => c.id).sort()));
  const tableB = await pageB.evaluate(() => window.__MEXE__.state!()!.table.map((m) => m.cards.map((c) => c.id).sort()));
  expect(tableA).toEqual(tableB);

  // --- V1: disconnect/reconnect mid-match. Force-close client B's socket as if the network
  // died (not a clean leaveRoom) and verify: A renders the opponent-disconnected notice, B
  // shows "reconnecting...", B reconnects and receives a genuine state_sync (not just a stale
  // local cache) that resyncs it to the SAME revision A is on, and the match can continue
  // afterwards (proven by the illegal-proposal + draw-round steps that follow). ---
  // D14: input must be visibly locked while the socket isn't open, not left editable until a
  // doomed FEITO/COMPRAR fails after the fact. It's B's own turn right now (A's confirmed turn
  // above flipped active to seat 1) and the socket is open, so B's hand is draggable — the
  // control this defect leaves live straight through a disconnect.
  const myHandCardId = await pageB.evaluate(() => {
    const seat = window.__MEXE__.online!.seat()!;
    return window.__MEXE__.state!()!.players[seat]!.hand[0]!.id;
  });
  expect(await pageB.evaluate((id) => window.__MEXE__.mexe!.cardInteractive(id), myHandCardId)).toBe(true);

  const traceLenBeforeDrop = await pageB.evaluate(() => window.__MEXE__.online!.trace().length);
  await pageB.evaluate(() => window.__MEXE__.online!.forceDrop());

  // D14: the moment the socket is no longer open, the same hand card must stop accepting input —
  // proves both the `interactive` gate and the on-status-change re-render that applies it live.
  await pageB.waitForFunction(() => window.__MEXE__.online!.status() !== 'open', undefined, { timeout: 5000 });
  expect(await pageB.evaluate((id) => window.__MEXE__.mexe!.cardInteractive(id), myHandCardId)).toBe(false);

  await pageA.waitForFunction(() => window.__MEXE__.online!.notice().length > 0, undefined, { timeout: 10_000 });
  const disconnectNotice = await pageA.evaluate(() => window.__MEXE__.online!.notice());
  expect(disconnectNotice.length).toBeGreaterThan(0);
  await shot({ a: pageA }, 'opponent-disconnected', screenshots);

  // Against the status *history*, not status(): 'reconnecting' lasts RECONNECT_DELAY_MS plus one
  // connect (~1s), and this step runs after the pageA notice wait and screenshot above. On a
  // loaded CI runner those took longer than the window, so a live sample could only ever find
  // 'open' — no timeout would have helped. This is order-independent.
  await pageB.waitForFunction(
    () => window.__MEXE__.online!.statusTrace().includes('reconnecting'),
    undefined,
    { timeout: 10_000 },
  );
  await shot({ b: pageB }, 'reconnecting', screenshots);

  // reconnected once status flips back to 'open' AND a real state_sync frame arrived after the
  // drop (proves the resync round-trip actually happened, not just a locally-retained value)
  await pageB.waitForFunction(() => window.__MEXE__.online!.status() === 'open', undefined, { timeout: 10_000 });
  await pageB.waitForFunction(
    (prevLen) => window.__MEXE__.online!.trace().slice(prevLen).some((m) => m.dir === 'in' && m.type === 'state_sync'),
    traceLenBeforeDrop,
    { timeout: 10_000 },
  );
  const revBReconnected = await pageB.evaluate(() => window.__MEXE__.online!.rev());
  const revAReconnected = await pageA.evaluate(() => window.__MEXE__.online!.rev());
  expect(revBReconnected).toBe(revA1);
  expect(revBReconnected).toBe(revAReconnected);
  await shot({ b: pageB }, 'reconnected', screenshots);

  // D14: once genuinely reconnected (a real resync landed, not just status flipping back), it's
  // still B's turn — the lock releases and the same card accepts input again.
  expect(await pageB.evaluate((id) => window.__MEXE__.mexe!.cardInteractive(id), myHandCardId)).toBe(true);

  // --- V1b: a full page reload resumes the match. sessionStorage keeps the reconnect token, so
  // re-entering Online must land straight back in the running game with the room context intact
  // (code + revision), instead of re-establishing the seat and then sitting in the lobby. ---
  await pageB.reload();
  await pageB.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [reloadOx, reloadOy] = toScreen(240, 254); // MenuScene ONLINE button
  await pageB.mouse.click(reloadOx, reloadOy);
  await pageB.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 15_000 });
  await pageB.waitForFunction((c) => window.__MEXE__.online?.code() === c, code, { timeout: 10_000 });
  expect(await pageB.evaluate(() => window.__MEXE__.online!.rev())).toBe(revA1);
  await shot({ b: pageB }, 'resumed', screenshots);

  const reconnect = {
    revisionBefore: revA1,
    revisionAfter: revBReconnected,
    noticeObserved: disconnectNotice,
    screenshots: {
      opponentDisconnected: path.join(OUT_DIR, 'mp-opponent-disconnected-a.png'),
      reconnecting: path.join(OUT_DIR, 'mp-reconnecting-b.png'),
      reconnected: path.join(OUT_DIR, 'mp-reconnected-b.png'),
    },
  };

  // --- illegal proposal: it's seat 1's (client B) turn now; submit a fabricated card id
  // straight to the server (bypasses the editor, which never constructs an illegal draft) ---
  await pageB.evaluate((rev) => {
    window.__MEXE__.online!.submitRaw(rev!, [{ id: 'cheat-meld', cardIds: ['__does-not-exist'] }]);
  }, revB1);
  await pageB.waitForFunction(() => window.__MEXE__.online!.lastRejections().length > 0, undefined, { timeout: 5000 });
  const rejectionReasons = await pageB.evaluate(() => window.__MEXE__.online!.lastRejections());
  expect(rejectionReasons).toContain('reason.unknownCard');
  await shot({ b: pageB }, 'rejection', screenshots);

  // no state mutation: rev unchanged on both clients after the rejection
  const revA2 = await pageA.evaluate(() => window.__MEXE__.online!.rev());
  const revB2 = await pageB.evaluate(() => window.__MEXE__.online!.rev());
  expect(revA2).toBe(revA1);
  expect(revB2).toBe(revB1);
  const illegalProposalAccepted = revB2 !== revB1;

  const errorsA = [
    ...(consoleErrorsByPage.get(pageA) ?? []),
    ...(await pageA.evaluate(() => window.__MEXE__.errors)),
  ];
  const errorsB = [
    ...(consoleErrorsByPage.get(pageB) ?? []),
    ...(await pageB.evaluate(() => window.__MEXE__.errors)),
  ];
  expect(errorsA).toEqual([]);
  expect(errorsB).toEqual([]);

  const traceA = await pageA.evaluate(() => window.__MEXE__.online?.trace() ?? []);
  const traceB = await pageB.evaluate(() => window.__MEXE__.online?.trace() ?? []);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Server output is not recorded here any more — afterAll writes it once per worker, so a crash
  // in a worker this test never ran on still reaches the gate.
  appendLog({
    generatedAt: new Date().toISOString(),
    roomCode: code,
    seed: TEST_SEED,
    revisionsObserved,
    clients: {
      a: { consoleErrors: consoleErrorsByPage.get(pageA) ?? [], pageErrors: errorsA },
      b: { consoleErrors: consoleErrorsByPage.get(pageB) ?? [], pageErrors: errorsB },
    },
    trace: { a: traceA, b: traceB },
    illegalProposal: { reasons: rejectionReasons, accepted: illegalProposalAccepted },
    reconnect,
    screenshots,
  });

  await pageA.context().close();
  await pageB.context().close();
});

test('room timer: the host sets it in the lobby, it locks at start, and the server times a turn out', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  const pageA = await newClient(browser);
  const pageB = await newClient(browser);

  await pageA.evaluate(() => window.__MEXE__.online!.createRoom('A'));
  await pageA.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = await pageA.evaluate(() => window.__MEXE__.online!.code());
  await pageB.evaluate((c) => window.__MEXE__.online!.joinRoom(c!, 'B'), code);
  await pageB.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  // Host picks the shortest turn the protocol allows (15s — the custom lower bound), so the
  // expiry is observable inside an e2e run without weakening the bounds themselves.
  const CUSTOM = {
    timerMode: 'custom' as const, turnMs: 15_000, mexeBonusMs: 5_000, warnMs: 10_000,
    reconnectGraceMs: 30_000, missedTurnLimit: 5,
  };
  await pageA.evaluate((s) => window.__MEXE__.online!.setRoomSettings(s), CUSTOM);
  // Both seats must see the same terms — the guest renders the host's choice, never its own.
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.__MEXE__.online!.roomSettings()?.turnMs === 15_000, undefined, { timeout: 10_000 });
  }
  await shot({ a: pageA, b: pageB }, 'room-settings', screenshots);

  // A non-host proposal is refused: the guest's send changes nothing for anyone.
  await pageB.evaluate(() => window.__MEXE__.online!.setRoomSettings({
    timerMode: 'off', turnMs: 0, mexeBonusMs: 0, warnMs: 0, reconnectGraceMs: 60_000, missedTurnLimit: 2,
  }));
  await pageB.waitForTimeout(400);
  expect(await pageA.evaluate(() => window.__MEXE__.online!.roomSettings()?.turnMs)).toBe(15_000);

  await pageA.evaluate(() => window.__MEXE__.online!.setReady(true));
  await pageB.evaluate(() => window.__MEXE__.online!.setReady(true));
  await pageA.waitForFunction(
    () => window.__MEXE__.online!.players().length === 2 && window.__MEXE__.online!.players().every((p) => p.ready),
    undefined,
    { timeout: 10_000 },
  );
  await pageA.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [pageA, pageB]) {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });
  }

  // The clock is live on both clients from the very first turn, and it is counting down.
  const firstRead = await pageA.evaluate(() => window.__MEXE__.online!.turnMsLeft());
  expect(firstRead).not.toBeNull();
  expect(firstRead!).toBeLessThanOrEqual(15_000);
  await pageA.waitForTimeout(1500);
  const secondRead = await pageA.evaluate(() => window.__MEXE__.online!.turnMsLeft());
  expect(secondRead!).toBeLessThan(firstRead!);
  await shot({ active: pageA, waiting: pageB }, 'turn-timer', screenshots);

  // The clock's last seconds: the state a player actually has to read under pressure.
  await pageA.waitForFunction(() => (window.__MEXE__.online!.turnMsLeft() ?? 99_000) <= 5_000, undefined, { timeout: 20_000 });
  await shot({ active: pageA }, 'turn-timer-critical', screenshots);

  const revBefore = await pageA.evaluate(() => window.__MEXE__.online!.rev());
  const tableBefore = await pageA.evaluate(() => window.__MEXE__.state!()!.table.map((m) => m.cards.map((c) => c.id)));
  const handBefore = await pageA.evaluate(() => window.__MEXE__.state!()!.players[0]!.hand.length);

  // Seat 0 does nothing at all. The server — not this client — ends the turn.
  await pageA.waitForFunction(
    (prev) => (window.__MEXE__.state!()?.activePlayerIndex ?? prev) !== prev,
    0,
    { timeout: 25_000 },
  );
  await shot({ a: pageA }, 'turn-timeout', screenshots);

  const after = await pageA.evaluate(() => ({
    active: window.__MEXE__.state!()!.activePlayerIndex,
    hand: window.__MEXE__.state!()!.players[0]!.hand.length,
    table: window.__MEXE__.state!()!.table.map((m) => m.cards.map((c) => c.id)),
    rev: window.__MEXE__.online!.rev(),
    notice: window.__MEXE__.online!.notice(),
    left: window.__MEXE__.online!.turnMsLeft(),
  }));
  expect(after.active).toBe(1);
  // Exactly the timeout move: one card drawn, the table untouched.
  expect(after.hand).toBe(handBefore + 1);
  expect(after.table).toEqual(tableBefore);
  expect(after.rev).toBeGreaterThan(revBefore!);
  expect(after.notice).not.toBe('');
  // The next seat's clock started fresh rather than inheriting the expired one.
  expect(after.left!).toBeGreaterThan(10_000);

  expect(consoleErrorsByPage.get(pageA) ?? []).toEqual([]);
  expect(consoleErrorsByPage.get(pageB) ?? []).toEqual([]);
  expect(screenshots.length).toBeGreaterThan(0);

  await pageA.context().close();
  await pageB.context().close();
});

test('three and four clients: host starts ready room and turns rotate through every stable seat', async ({ browser }) => {
  const playerCountRuns: Record<number, { seats: number[]; screenshot: string }> = {};
  for (const playerCount of [3, 4]) {
    const pages = await Promise.all(Array.from({ length: playerCount }, () => newClient(browser)));
    const host = pages[0]!;
    await host.evaluate(() => window.__MEXE__.online!.createRoom('Host'));
    await host.waitForFunction(() => window.__MEXE__.online?.code() !== null);
    const code = await host.evaluate(() => window.__MEXE__.online!.code());
    expect(code).toBeTruthy();
    const roomCode = code!;
    for (let seat = 1; seat < playerCount; seat++) {
      const page = pages[seat]!;
      await page.evaluate(({ room, name }) => window.__MEXE__.online!.joinRoom(room, name), { room: roomCode, name: `P${seat + 1}` });
      await page.waitForFunction((expected) => window.__MEXE__.online?.seat() === expected, seat);
    }
    await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.online!.setReady(true))));
    await host.waitForFunction((count) => window.__MEXE__.online!.players().length === count && window.__MEXE__.online!.players().every((p) => p.ready), playerCount);
    await host.evaluate(() => window.__MEXE__.online!.startGame());
    await Promise.all(pages.map((p) => p.waitForFunction(() => window.__MEXE__.scene === 'game')));
    for (let active = 0; active < playerCount; active++) {
      const before = await host.evaluate(() => window.__MEXE__.online!.rev());
      await pages[active]!.evaluate(() => window.__MEXE__.mexe!.comprar());
      await Promise.all(pages.map((p) => p.waitForFunction((rev) => window.__MEXE__.online!.rev() !== rev, before)));
      await Promise.all(pages.map((p) => p.waitForFunction((next) => window.__MEXE__.state!()!.activePlayerIndex === next, (active + 1) % playerCount)));
    }
    const file = path.join(OUT_DIR, `mp-${playerCount}p-rotation.png`);
    await host.screenshot({ path: file });
    playerCountRuns[playerCount] = {
      seats: await Promise.all(pages.map((page) => page.evaluate(() => window.__MEXE__.online?.seat() ?? -1))),
      screenshot: file,
    };
    for (const page of pages) await page.context().close();
  }
  // 3P/4P seats and screenshots, so one artifact records every alpha player-count run rather
  // than leaving the evidence implicit.
  appendLog({ playerCountRuns });
});

test('in-canvas join code, hand privacy, and an explicit resync round-trip', async ({ browser }) => {
  const screenshots: string[] = [];
  const host = await newClient(browser);
  const guest = await newClient(browser);

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Host'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;

  // --- P7: join by typing the code into the canvas, not a native window.prompt. Clicking the
  // JOIN button opens the code screen; the keystrokes below are the real user path. ---
  const [jx, jy] = toScreen(240, 156); // OnlineScene JOIN button
  await guest.mouse.click(jx, jy);
  await guest.waitForTimeout(200);
  const joinShot = path.join(OUT_DIR, 'mp-join-input.png');
  await guest.keyboard.type(code.slice(0, 3), { delay: 40 });
  await guest.waitForTimeout(200);
  await guest.screenshot({ path: joinShot });
  screenshots.push(joinShot);
  await guest.keyboard.type(code.slice(3), { delay: 40 });
  await guest.keyboard.press('Enter');
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  await Promise.all([host, guest].map((p) => p.evaluate(() => window.__MEXE__.online!.setReady(true))));
  await host.waitForFunction(() => window.__MEXE__.online!.players().length === 2 && window.__MEXE__.online!.players().every((p) => p.ready), undefined, { timeout: 10_000 });
  await host.evaluate(() => window.__MEXE__.online!.startGame());
  await Promise.all([host, guest].map((p) => p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 })));

  // --- hand privacy: the guest's own hand is real cards; every other seat is placeholders only,
  // so no opponent card identity ever reached this client. ---
  const privacy = await guest.evaluate(() => {
    const state = window.__MEXE__.state!()!;
    const seat = window.__MEXE__.online!.seat()!;
    return {
      ownRealCards: state.players[seat]!.hand.every((c) => !c.id.startsWith('__placeholder')),
      opponentAllPlaceholders: state.players
        .filter((_, i) => i !== seat)
        .every((p) => p.hand.every((c) => c.id.startsWith('__placeholder'))),
      drawPileAllPlaceholders: state.drawPile.every((c) => c.id.startsWith('__placeholder')),
    };
  });
  expect(privacy).toEqual({ ownRealCards: true, opponentAllPlaceholders: true, drawPileAllPlaceholders: true });

  // --- explicit resync: the client asks for authoritative state and gets a real state_sync back
  // at the same revision. Nothing about the local state changes, and no desync is reported. ---
  const revBefore = (await guest.evaluate(() => window.__MEXE__.online!.rev()))!;
  const traceLen = await guest.evaluate(() => window.__MEXE__.online!.trace().length);
  await guest.evaluate(() => window.__MEXE__.online!.requestResync());
  await guest.waitForFunction(
    (prev) => window.__MEXE__.online!.trace().slice(prev).some((m) => m.dir === 'in' && m.type === 'state_sync'),
    traceLen,
    { timeout: 10_000 },
  );
  const revAfter = (await guest.evaluate(() => window.__MEXE__.online!.rev()))!;
  expect(revAfter).toBe(revBefore);

  // Every applied snapshot is hash-checked against a locally recomputed digest; a healthy match
  // must therefore report zero mismatches on both sides.
  const desyncs = {
    host: await host.evaluate(() => window.__MEXE__.online!.desyncs()),
    guest: await guest.evaluate(() => window.__MEXE__.online!.desyncs()),
  };
  expect(desyncs).toEqual({ host: 0, guest: 0 });

  const errors = [
    ...(consoleErrorsByPage.get(host) ?? []),
    ...(consoleErrorsByPage.get(guest) ?? []),
    ...(await host.evaluate(() => window.__MEXE__.errors)),
    ...(await guest.evaluate(() => window.__MEXE__.errors)),
  ];
  expect(errors).toEqual([]);

  appendLog({
    keyboardJoin: { code, screenshot: joinShot },
    handPrivacy: privacy,
    resync: { revisionBefore: revBefore, revisionAfter: revAfter, desyncs },
    screenshots,
  });

  await host.context().close();
  await guest.context().close();
});

/** Appends a screenshot path (and optional extra fields) to this worker's evidence shard. Reads
 * and writes only PART_PATH, so parallel workers never overwrite each other; the shards are
 * merged into verify-multiplayer-log.json by scripts/check-verify-multiplayer.mjs. */
function appendLog(extra: Record<string, unknown>): void {
  fs.mkdirSync(PARTS_DIR, { recursive: true });
  const log = fs.existsSync(PART_PATH) ? (JSON.parse(fs.readFileSync(PART_PATH, 'utf8')) as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'screenshots') log.screenshots = [...((log.screenshots as string[]) ?? []), ...(v as string[])];
    else log[k] = v;
  }
  fs.writeFileSync(PART_PATH, JSON.stringify(log, null, 2));
}

test('server unavailable: shows a recoverable, non-frozen state and the player can retry', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  // Nothing listens here — the initial connection never opens at all, distinct from a
  // mid-session drop (see NetClient.connect's onclose 'unreachable' branch).
  const DEAD_WS_URL = 'ws://localhost:18799';
  await page.goto(`/?ws=${encodeURIComponent(DEAD_WS_URL)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [ox, oy] = toScreen(240, 254); // MenuScene ONLINE button
  await page.mouse.click(ox, oy);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'error', undefined, { timeout: 10_000 });
  // OnlineScene renders t('online.err.unreachable') for this exact status/message combination
  // (src/scenes/OnlineScene.ts wireClient) — Playwright can't read canvas text, so the screenshot
  // is the evidence; the behavioral proof below is that the screen is not stuck.
  await page.waitForTimeout(300);
  const shot = path.join(OUT_DIR, 'mp-unreachable.png');
  await page.screenshot({ path: shot });

  // Not frozen: VOLTAR still works, and pointing a fresh load at the real test server recovers.
  const [bx, by] = toScreen(240, 245);
  await page.mouse.click(bx, by);
  await page.waitForFunction(() => window.__MEXE__.scene === 'menu', undefined, { timeout: 10_000 });
  await page.goto(`/?ws=${encodeURIComponent(WS_URL)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  await page.mouse.click(ox, oy);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });

  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  // The browser itself logs the failed WebSocket handshake as a console error (ERR_CONNECTION_
  // REFUSED) — that's Chrome reporting the network condition this test deliberately creates, not
  // an app bug. Only app-level unhandled errors/rejections (checked above) are the real gate.
  const consoleErrors = trackConsoleErrors(page).filter((e) => !e.includes('WebSocket connection'));
  expect(consoleErrors).toEqual([]);
  appendLog({ screenshots: [shot] });
  await ctx.close();
});

test('impatient tester: double-clicking CREATE and JOIN sends exactly one request each', async ({ browser }) => {
  const pageA = await newClient(browser);
  const [cx, cy] = toScreen(240, 136); // OnlineScene idle CREATE button
  await pageA.mouse.click(cx, cy);
  await pageA.mouse.click(cx, cy); // second click lands inside the fireOnce cooldown, must be a no-op
  await pageA.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await pageA.evaluate(() => window.__MEXE__.online!.code()))!;
  const traceA = await pageA.evaluate(() => window.__MEXE__.online!.trace());
  // Full ordered trace in the message: a second create_room only escapes the guard on a
  // particular interleaving, and knowing where room_joined landed is the whole diagnosis.
  expect(traceA.filter((m) => m.dir === 'out' && m.type === 'create_room'), JSON.stringify(traceA)).toHaveLength(1);

  const pageB = await newClient(browser);
  const [jx, jy] = toScreen(240, 156); // OnlineScene idle JOIN button -> opens the code screen
  await pageB.mouse.click(jx, jy);
  await pageB.waitForTimeout(100);
  await pageB.keyboard.type(code, { delay: 30 });
  const [confirmX, confirmY] = toScreen(240, 180); // join-screen confirm JOIN button
  await pageB.mouse.click(confirmX, confirmY);
  await pageB.mouse.click(confirmX, confirmY); // second click, same cooldown window
  await pageB.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });
  const traceB = await pageB.evaluate(() => window.__MEXE__.online!.trace());
  expect(traceB.filter((m) => m.dir === 'out' && m.type === 'join_room'), JSON.stringify(traceB)).toHaveLength(1);

  const errors = [
    ...(await pageA.evaluate(() => window.__MEXE__.errors)),
    ...(await pageB.evaluate(() => window.__MEXE__.errors)),
    ...trackConsoleErrors(pageA),
    ...trackConsoleErrors(pageB),
  ];
  expect(errors).toEqual([]);
  await pageA.context().close();
  await pageB.context().close();
});

test('bad room code: shows a recoverable room_not_found error, not a stuck screen', async ({ browser }) => {
  const page = await newClient(browser);
  const [jx, jy] = toScreen(240, 156);
  await page.mouse.click(jx, jy);
  await page.waitForTimeout(100);
  await page.keyboard.type('ZZZZZ', { delay: 30 }); // well-formed 5-char code, no such room
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => window.__MEXE__.online!.trace().some((m) => m.dir === 'in' && m.type === 'error'),
    undefined,
    { timeout: 10_000 },
  );
  expect(await page.evaluate(() => window.__MEXE__.online!.seat())).toBeNull();
  await page.waitForTimeout(300);
  const shot = path.join(OUT_DIR, 'mp-room-not-found.png');
  await page.screenshot({ path: shot });

  // recoverable: the same client can still create a room right after the rejection
  const [bx, by] = toScreen(240, 245);
  await page.mouse.click(bx, by);
  await page.waitForFunction(() => window.__MEXE__.scene === 'menu', undefined, { timeout: 10_000 });
  const [ox, oy] = toScreen(240, 254);
  await page.mouse.click(ox, oy);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });
  await page.evaluate(() => window.__MEXE__.online!.createRoom('Retry'));
  await page.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });

  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  expect(trackConsoleErrors(page)).toEqual([]);
  appendLog({ screenshots: [shot] });
  await page.context().close();
});

test('room full: a 5th joiner sees a translated room_full error', async ({ browser }) => {
  // MAX_PLAYERS is hardcoded to 4 in server/rooms.ts (not configurable from the client), so this
  // fills the real 4-seat cap rather than an artificially-shrunk 2-seat room — same room_full
  // path, just at the real capacity.
  const pages = await Promise.all(Array.from({ length: 5 }, () => newClient(browser)));
  const host = pages[0]!;
  await host.evaluate(() => window.__MEXE__.online!.createRoom('Host'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;
  for (let seat = 1; seat < 4; seat++) {
    await pages[seat]!.evaluate(({ c, s }) => window.__MEXE__.online!.joinRoom(c, `P${s}`), { c: code, s: seat });
    await pages[seat]!.waitForFunction((expected) => window.__MEXE__.online?.seat() === expected, seat, { timeout: 10_000 });
  }
  const fifth = pages[4]!;
  await fifth.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'P5'), code);
  await fifth.waitForFunction(
    () => window.__MEXE__.online!.trace().some((m) => m.dir === 'in' && m.type === 'error'),
    undefined,
    { timeout: 10_000 },
  );
  expect(await fifth.evaluate(() => window.__MEXE__.online!.seat())).toBeNull();
  await fifth.waitForTimeout(300);
  const shot = path.join(OUT_DIR, 'mp-room-full.png');
  await fifth.screenshot({ path: shot });

  for (const p of pages) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots: [shot] });
  for (const p of pages) await p.context().close();
});

// ---------- Phase 13: the online flow on a phone ----------

/** Same flow as `newClient`, on a portrait phone viewport and addressing the ONLINE button
 *  through the live world size instead of the 1280x720 scale factor. */
async function newPhoneClient(
  browser: Browser,
  viewport = { width: 390, height: 844 },
  wsUrl = WS_URL,
  extraQuery = '',
): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  await page.goto(`/?ws=${encodeURIComponent(wsUrl)}&showcase=menu${extraQuery}`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const point = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    // MenuScene's ONLINE button is authored at (240, 254) on the 480x270 grid; menu-layout maps
    // that proportionally onto whichever world is live, so the same fractions hold in portrait.
    // 258 was the old value: it sits below the button's centre, and on a 360-wide phone — where
    // the fitted canvas is smallest — those four units fall off the bottom edge and miss.
    return { x: c.left + 0.5 * c.width, y: c.top + (254 / 270) * c.height };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });
  return page;
}

test('mobile: the lobby and the locked non-active seat stay readable in portrait', async ({ browser }) => {
  const host = await newPhoneClient(browser);
  const guest = await newPhoneClient(browser);

  expect(await host.evaluate(() => window.__MEXE__.viewport().portrait)).toBe(true);

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Host'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;
  await guest.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'Guest'), code);
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  const screenshots: string[] = [];
  await shot({ host, guest }, 'mobile-lobby', screenshots);

  await host.evaluate(() => window.__MEXE__.online!.setReady(true));
  await guest.evaluate(() => window.__MEXE__.online!.setReady(true));
  await host.waitForFunction(() => window.__MEXE__.online!.players().every((p) => p.ready), undefined, { timeout: 10_000 });
  await host.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });
  }

  // Whichever client is not the active seat must show a readable waiting board with no editor —
  // an inactive online player can never move a card, on a phone or anywhere else.
  const hostActive = await host.evaluate(() => {
    const s = window.__MEXE__.state?.();
    return s !== null && s !== undefined && s.activePlayerIndex === 0;
  });
  const waiting = hostActive ? guest : host;
  expect(await waiting.evaluate(() => window.__MEXE__.mexe)).toBeNull();
  await shot({ waiting }, 'mobile-waiting', screenshots);

  for (const p of [host, guest]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [host, guest]) await p.context().close();
});

test('mobile: an unreachable server is a readable, recoverable state in portrait', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  const DEAD_WS_URL = 'ws://localhost:18798'; // nothing listens here
  await page.goto(`/?ws=${encodeURIComponent(DEAD_WS_URL)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const point = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.left + 0.5 * c.width, y: c.top + (254 / 270) * c.height };
  });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'error', undefined, { timeout: 10_000 });
  await page.waitForTimeout(300);
  const shot = path.join(OUT_DIR, 'mp-mobile-unreachable.png');
  await page.screenshot({ path: shot });

  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  // Same carve-out as the desktop 'server unavailable' case: Chrome logs the failed handshake
  // this test deliberately provokes; only app-level errors are the gate.
  expect(trackConsoleErrors(page).filter((e) => !e.includes('WebSocket connection'))).toEqual([]);
  appendLog({ screenshots: [shot] });
  await ctx.close();
});

test('mobile: a touch player can type a room code and join (soft-keyboard input path)', async ({ browser }) => {
  const screenshots: string[] = [];
  const host = await newClient(browser);
  // A phone has no hardware keyboard, so OnlineScene's global keydown handler can never receive a
  // code — the join screen has to focus a real DOM input, which is what makes the OS open its
  // keyboard. This test drives that element, not the canvas handler.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const guest = await ctx.newPage();
  trackConsoleErrors(guest);
  await guest.goto(`/?ws=${encodeURIComponent(WS_URL)}&showcase=menu`);
  await guest.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Host'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;

  // logical coords -> this portrait viewport (Scale.FIT over the 270-tall world)
  const at = (ly: number) => guest.evaluate((y: number) => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.left + 0.5 * c.width, y: c.top + (y / 270) * c.height };
  }, ly);

  const online = await at(258); // MenuScene ONLINE
  await guest.touchscreen.tap(online.x, online.y);
  await guest.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await guest.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 10_000 });

  const joinBtn = await at(156); // OnlineScene JOIN
  await guest.touchscreen.tap(joinBtn.x, joinBtn.y);
  // Entering the join phase must focus the DOM input — that focus IS the soft keyboard.
  await guest.waitForFunction(() => document.activeElement?.tagName === 'INPUT', undefined, { timeout: 5_000 });

  // Keystrokes land on the focused input, exactly as a soft keyboard delivers them. Lowercase on
  // purpose: the input sanitizes/upper-cases before mirroring into the scene.
  await guest.keyboard.type(code.toLowerCase(), { delay: 40 });
  await guest.waitForTimeout(200);
  const shot = path.join(OUT_DIR, 'mp-mobile-join-input.png');
  await guest.screenshot({ path: shot });
  screenshots.push(shot);
  expect(await guest.evaluate(() => (document.activeElement as HTMLInputElement).value)).toBe(code);

  await guest.keyboard.press('Enter');
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  // Leaving the join phase must take the input back out of the DOM — a stray focused input would
  // keep the keyboard up over the lobby.
  await guest.waitForFunction(() => document.querySelectorAll('input').length === 0, undefined, { timeout: 5_000 });

  expect(await guest.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  expect(trackConsoleErrors(guest)).toEqual([]);
  appendLog({ mobileTouchJoin: { code, screenshot: shot }, screenshots });
  await host.context().close();
  await ctx.close();
});

test('custom timing: the host edits the room\'s own numbers and every seat plays under them', async ({ browser }) => {
  const host = await newClient(browser);
  const guest = await newClient(browser);
  const screenshots: string[] = [];

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;
  await guest.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'Joao'), code);
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });
  for (const p of [host, guest]) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await host.waitForFunction(() => window.__MEXE__.online!.players().every((p) => p.ready), undefined, { timeout: 10_000 });

  // The custom screen is one deliberate tap behind the presets, host-only, and opens on the
  // room's current terms rather than on an unrelated default.
  await host.evaluate(() => window.__MEXE__.online!.openCustomSettings());
  await shot({ custom: host }, 'custom-settings', screenshots);

  // A guest tapping the same hook gets nothing: settings are host-only wherever they are edited.
  await guest.evaluate(() => window.__MEXE__.online!.openCustomSettings());
  await shot({ guest }, 'custom-settings-guest-denied', screenshots);

  const applied = {
    timerMode: 'custom' as const, turnMs: 60_000, mexeBonusMs: 30_000, warnMs: 15_000,
    reconnectGraceMs: 90_000, missedTurnLimit: 3,
  };
  await host.evaluate((s) => window.__MEXE__.online!.setRoomSettings(s), applied);
  // Both seats end up on the host's numbers, and the change costs everyone their ready bit.
  for (const p of [host, guest]) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.roomSettings()?.turnMs === 60_000
        && window.__MEXE__.online!.players().every((pl) => !pl.ready),
      undefined,
      { timeout: 10_000 },
    );
    expect(await p.evaluate(() => window.__MEXE__.online!.roomSettings())).toMatchObject(applied);
  }

  for (const p of [host, guest]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [host, guest]) await p.context().close();
});

test('custom timing: readable on a portrait phone, and its bounds are the server\'s', async ({ browser }) => {
  const host = await newPhoneClient(browser);
  const screenshots: string[] = [];

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  await host.evaluate(() => window.__MEXE__.online!.openCustomSettings());
  await shot({ host }, 'mobile-custom-settings', screenshots);

  // The screen cannot propose a value the server would clamp: an out-of-range proposal sent
  // directly still comes back inside the same bounds the buttons stop at.
  await host.evaluate(() => window.__MEXE__.online!.setRoomSettings({
    timerMode: 'custom', turnMs: 5_000, mexeBonusMs: -1, warnMs: 999_000,
    reconnectGraceMs: 1, missedTurnLimit: 99,
  }));
  await host.waitForFunction(() => window.__MEXE__.online!.roomSettings()?.timerMode === 'custom', undefined, { timeout: 10_000 });
  expect(await host.evaluate(() => window.__MEXE__.online!.roomSettings())).toMatchObject({
    timerMode: 'custom', turnMs: 15_000, mexeBonusMs: 0, warnMs: 15_000,
    reconnectGraceMs: 10_000, missedTurnLimit: 10,
  });

  expect(await host.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  expect(trackConsoleErrors(host)).toEqual([]);
  appendLog({ screenshots });
  await host.context().close();
});

test('ON-09/ON-20: a host settings change clears every ready bit, on a landscape phone', async ({ browser }) => {
  // Landscape phone: the third required viewport for the lobby, and the tightest one for a seat
  // row (name + YOU/HOST badges + status word all on one line).
  const host = await newPhoneClient(browser, { width: 844, height: 390 });
  const guest = await newPhoneClient(browser, { width: 844, height: 390 });
  expect(await host.evaluate(() => window.__MEXE__.viewport().portrait)).toBe(false);

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;
  await guest.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'Joao'), code);
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  for (const p of [host, guest]) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await host.waitForFunction(() => window.__MEXE__.online!.players().every((p) => p.ready), undefined, { timeout: 10_000 });

  const screenshots: string[] = [];
  await shot({ host, guest }, 'landscape-lobby-ready', screenshots);

  // The host changes the terms every seat just agreed to: the server clears every ready bit and
  // both lobbies say so, instead of starting a match under settings nobody re-accepted.
  await host.evaluate(() =>
    window.__MEXE__.online!.setRoomSettings({
      timerMode: 'fast', turnMs: 45_000, mexeBonusMs: 20_000, warnMs: 10_000, reconnectGraceMs: 30_000, missedTurnLimit: 2,
    }),
  );
  for (const p of [host, guest]) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.roomSettings()?.timerMode === 'fast'
        && window.__MEXE__.online!.players().every((pl) => !pl.ready),
      undefined,
      { timeout: 10_000 },
    );
  }
  await shot({ host, guest }, 'landscape-lobby-settings-changed', screenshots);

  // The third required viewport for the in-match clock too: a landscape phone puts the HUD, the
  // hand and the countdown on the shortest vertical budget the game ever gets.
  for (const p of [host, guest]) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await host.waitForFunction(() => window.__MEXE__.online!.players().every((p) => p.ready), undefined, { timeout: 10_000 });
  await host.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [host, guest]) {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });
    await p.waitForFunction(() => (window.__MEXE__.online!.turnMsLeft() ?? 0) > 0, undefined, { timeout: 10_000 });
  }
  await shot({ host, guest }, 'landscape-turn-timer', screenshots);

  for (const p of [host, guest]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [host, guest]) await p.context().close();
});

test('OR-34/OR-35: the reconnect notice is readable on a portrait and a landscape phone', async ({ browser }) => {
  // A dropped connection is a phone event far more often than a desktop one, and it is the one
  // moment the player most needs to be told they have not lost their seat. Both phone viewports
  // get the same held-seat copy plus its countdown, on top of a board that stops accepting input.
  const portrait = await newPhoneClient(browser);
  const landscape = await newPhoneClient(browser, { width: 844, height: 390 });
  expect(await portrait.evaluate(() => window.__MEXE__.viewport().portrait)).toBe(true);
  expect(await landscape.evaluate(() => window.__MEXE__.viewport().portrait)).toBe(false);

  await portrait.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await portrait.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await portrait.evaluate(() => window.__MEXE__.online!.code()))!;
  await landscape.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'Joao'), code);
  await landscape.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  for (const p of [portrait, landscape]) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await portrait.waitForFunction(() => window.__MEXE__.online!.players().every((p) => p.ready), undefined, { timeout: 10_000 });
  await portrait.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [portrait, landscape]) {
    await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 10_000 });
  }

  const screenshots: string[] = [];
  for (const p of [portrait, landscape]) {
    await p.evaluate(() => window.__MEXE__.online!.forceDrop());
    // The notice must name the held seat, not a protocol state: assert on the localized copy
    // actually rendered, and that it carries the countdown the room's grace defines.
    await p.waitForFunction(
      () => /\d+s/.test(window.__MEXE__.online!.notice()),
      undefined,
      { timeout: 10_000 },
    );
    const notice = await p.evaluate(() => window.__MEXE__.online!.notice());
    expect(notice).toMatch(/guardado/); // PT-BR: "seu lugar na mesa está guardado"
    for (const jargon of ['socket', 'token', 'rev', 'SESSION', 'MISMATCH']) {
      expect(notice).not.toContain(jargon);
    }
  }
  await shot({ portrait, landscape }, 'reconnecting-phone', screenshots);

  // And it recovers by itself on both, with no tap required.
  for (const p of [portrait, landscape]) {
    await p.waitForFunction(() => window.__MEXE__.online!.status() === 'open', undefined, { timeout: 15_000 });
  }
  await shot({ portrait, landscape }, 'reconnected-phone', screenshots);

  for (const p of [portrait, landscape]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [portrait, landscape]) await p.context().close();
});

test('room-creation budget: the refusal reads as plain copy on desktop and on a portrait phone', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  // Its own server, with a budget of one room per minute: the shared server runs the default of
  // 20 and every other test in this file would have to work around a tighter one. Its port comes
  // from the OS for the same reason the suite's does — a fixed 8810+worker block once collided
  // with another worker's own server, and this test then spent its budget against a server with
  // the default budget and waited 10s for a refusal that was never coming.
  const budget = await startTestServer(await freePort(), TEST_SEED, { MEXE_MAX_ROOM_CREATES_PER_IP: '1' });
  try {
    const budgetUrl = budget.url;

    // One room spends the whole budget for this address; every client after it is refused.
    const first = await newClient(browser, budgetUrl);
    await first.evaluate(() => window.__MEXE__.online!.createRoom('First'));
    await first.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });

    const desktop = await newClient(browser, budgetUrl);
    const portrait = await newPhoneClient(browser, { width: 390, height: 844 }, budgetUrl);
    for (const page of [desktop, portrait]) {
      await page.evaluate(() => window.__MEXE__.online!.createRoom('Refused'));
      await page.waitForFunction(
        () => window.__MEXE__.online!.trace().some((m) => m.dir === 'in' && m.type === 'error'),
        undefined,
        { timeout: 10_000 },
      );
      // Refused, not seated — and the socket stays open, so the player can simply try again.
      expect(await page.evaluate(() => window.__MEXE__.online!.code())).toBeNull();
      expect(await page.evaluate(() => window.__MEXE__.online!.status())).toBe('open');
    }
    await shot({ desktop, portrait }, 'room-create-limit', screenshots);

    // Calm, non-technical copy: the player is told to wait, never shown the limiter.
    for (const page of [desktop, portrait]) {
      const text = await page.evaluate(() => window.__MEXE__.online!.errorText());
      expect(text).toMatch(/instantes/); // PT-BR: "Tente de novo em instantes."
      for (const jargon of ['rate', 'limit', 'IP', 'token', 'bucket', '429', 'room_create']) {
        expect(text).not.toContain(jargon);
      }
      expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
      expect(trackConsoleErrors(page)).toEqual([]);
    }

    appendLog({ screenshots });
    for (const page of [first, desktop, portrait]) await page.context().close();
  } finally {
    budget.stop();
    appendLog({ server: { stdout: budget.stdout, stderr: budget.stderr } });
  }
});

// ---------- Online Phase 5: the party session across matches ----------

/** Drive a started online match to a real, server-decided finish by having whichever seat is
 * active draw and pass. With TEST_SEED the draw pile is 94 cards, so the pile runs out and the
 * server ends the match on the fewest-cards rule — no client ever decides anything. */
async function playToFinish(pages: Page[]): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const done = await pages[0]!.evaluate(() => window.__MEXE__.scene === 'win');
    if (done) return;
    for (const p of pages) {
      const mine = await p.evaluate(() => {
        const s = window.__MEXE__.state?.();
        return !!s && s.winnerId === null && s.activePlayerIndex === window.__MEXE__.online?.seat();
      });
      if (!mine) continue;
      await p.evaluate(() => window.__MEXE__.online!.comprar());
      break;
    }
    await pages[0]!.waitForTimeout(25);
  }
  throw new Error('match did not finish within the draw-pile budget');
}

/** Lobby -> started match, for a room whose seats are already filled. */
async function readyAndStart(host: Page, pages: Page[]): Promise<void> {
  for (const p of pages) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await host.waitForFunction(
    (n) => {
      const players = window.__MEXE__.online!.players();
      return players.length === n && players.every((p) => p.ready);
    },
    pages.length,
    { timeout: 10_000 },
  );
  await host.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of pages) await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 15_000 });
}

test('OS-01..OS-16/OS-35: the room survives a match, scores it, and rematches on the same code', async ({ browser }) => {
  const screenshots: string[] = [];
  const host = await newClient(browser);
  const guest = await newClient(browser);

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;
  await guest.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'Joao'), code);
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  await readyAndStart(host, [host, guest]);
  const firstMatchId = await host.evaluate(() => window.__MEXE__.online!.matchId());
  expect(firstMatchId).toBeTruthy();

  await playToFinish([host, guest]);
  for (const p of [host, guest]) await p.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 15_000 });
  // The result screen reveals in stages (celebration, then the numbers, then the controls) — wait
  // the whole sequence out, or the evidence photographs an empty board.
  await host.waitForTimeout(1500);
  // OS-35: the finished-match screen shows the room's score and still offers the invite.
  await shot({ host, guest }, 'party-finished', screenshots);

  // OS-06/OS-16: exactly one win was awarded, and the match is in the room's public history.
  await host.waitForFunction(
    () => (window.__MEXE__.online?.party().matches.length ?? 0) === 1,
    undefined,
    { timeout: 10_000 },
  );

  // OS-01/OS-03: REMATCH walks back into the *same* room on the *same* code.
  const buttonY = await host.evaluate(() => window.__MEXE__.winButtonY);
  expect(buttonY).not.toBeNull();
  for (const p of [host, guest]) {
    const y = (await p.evaluate(() => window.__MEXE__.winButtonY))!;
    const [bx, by] = toScreen(240, y);
    await p.mouse.click(bx, by);
    await p.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  }
  expect(await host.evaluate(() => window.__MEXE__.online!.code())).toBe(code);

  // OS-06/OS-08: the between-match lobby shows the session score and an empty rematch vote.
  await host.waitForFunction(
    () => window.__MEXE__.online!.players().reduce((n, p) => n + p.wins, 0) === 1,
    undefined,
    { timeout: 10_000 },
  );
  const lobby = await host.evaluate(() => ({
    players: window.__MEXE__.online!.players(),
    party: window.__MEXE__.online!.party(),
  }));
  expect(lobby.players.every((p) => !p.ready)).toBe(true);
  expect(lobby.players.reduce((n, p) => n + p.wins, 0)).toBe(1);
  expect(lobby.party.matches).toHaveLength(1);
  // OS-19: nothing in the feed names a card.
  expect(JSON.stringify(lobby.party.activity)).not.toMatch(/(hearts|spades|clubs|diamonds)-\d/);
  await shot({ host }, 'party-between-matches', screenshots);

  // OS-16/OS-18: the history screen itself.
  await host.evaluate(() => window.__MEXE__.online!.openParty());
  await shot({ host }, 'party-history', screenshots);
  await host.evaluate(() => window.__MEXE__.online!.openParty());

  // OS-02/OS-09/OS-10: one vote is not enough; both votes start exactly one new match, with a
  // different matchId than the one that just ended.
  await host.evaluate(() => window.__MEXE__.online!.setReady(true));
  await host.evaluate(() => window.__MEXE__.online!.startGame());
  await host.waitForTimeout(400);
  expect(await host.evaluate(() => window.__MEXE__.scene)).toBe('online');

  await readyAndStart(host, [host, guest]);
  const secondMatchId = await host.evaluate(() => window.__MEXE__.online!.matchId());
  expect(secondMatchId).toBeTruthy();
  expect(secondMatchId).not.toBe(firstMatchId);

  for (const p of [host, guest]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [host, guest]) await p.context().close();
});

test('OS-36/OS-37: the between-match social UI reads on a phone, portrait and landscape', async ({ browser }) => {
  const screenshots: string[] = [];
  const portrait = await newPhoneClient(browser);
  const landscape = await newPhoneClient(browser, { width: 844, height: 390 });

  await portrait.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await portrait.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await portrait.evaluate(() => window.__MEXE__.online!.code()))!;
  await landscape.evaluate((c) => window.__MEXE__.online!.joinRoom(c, 'Joao'), code);
  await landscape.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  await readyAndStart(portrait, [portrait, landscape]);
  await playToFinish([portrait, landscape]);
  for (const p of [portrait, landscape]) await p.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 15_000 });
  await portrait.waitForTimeout(1500);
  await shot({ portrait, landscape }, 'party-phone-finished', screenshots);

  for (const p of [portrait, landscape]) {
    const y = (await p.evaluate(() => window.__MEXE__.winButtonY))!;
    const point = await p.evaluate((ly) => {
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      const world = window.__MEXE__.viewport();
      return { x: c.left + 0.5 * c.width, y: c.top + (ly / world.h) * c.height };
    }, y);
    await p.mouse.click(point.x, point.y);
    await p.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  }
  await portrait.waitForFunction(
    () => window.__MEXE__.online!.players().reduce((n, p) => n + p.wins, 0) === 1,
    undefined,
    { timeout: 10_000 },
  );
  await shot({ portrait, landscape }, 'party-phone-lobby', screenshots);

  for (const p of [portrait, landscape]) await p.evaluate(() => window.__MEXE__.online!.openParty());
  await shot({ portrait, landscape }, 'party-phone-history', screenshots);

  // No page-level horizontal overflow on either orientation.
  for (const p of [portrait, landscape]) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [portrait, landscape]) await p.context().close();
});

test('OS-28..OS-30: a 4-seat room names the active seat, the score and the feed for everyone', async ({ browser }) => {
  const screenshots: string[] = [];
  const pages = await Promise.all(Array.from({ length: 4 }, () => newClient(browser)));
  const host = pages[0]!;
  await host.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;
  const names = ['', 'Joao', 'Lia', 'Ana'];
  for (let seat = 1; seat < 4; seat++) {
    await pages[seat]!.evaluate(({ c, n }) => window.__MEXE__.online!.joinRoom(c, n), { c: code, n: names[seat]! });
    await pages[seat]!.waitForFunction((expected) => window.__MEXE__.online?.seat() === expected, seat, { timeout: 10_000 });
  }
  // A reaction from one seat reaches every seat in the room, and only this room.
  await pages[1]!.evaluate(() => window.__MEXE__.online!.react!('nice'));
  await host.waitForFunction(
    () => window.__MEXE__.online!.party().activity.some((e) => e.kind === 'reaction'),
    undefined,
    { timeout: 10_000 },
  );
  await shot({ host }, 'party-4p-lobby', screenshots);

  await readyAndStart(host, pages);
  // Every client agrees on which seat is active — the indicator is state, not a local guess.
  const actives = await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.state?.()?.activePlayerIndex ?? -1)));
  expect(new Set(actives).size).toBe(1);
  expect(actives[0]).toBe(0);
  await shot({ host }, 'party-4p-match', screenshots);

  for (const p of pages) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of pages) await p.context().close();
});

/**
 * Online Phase 7 — discovery. One test, because the whole point of the phase is that these are
 * one flow: a room the host chose to list, found in the browser, joined from a card, then
 * returned to from the online home without anyone typing a code twice.
 */
test('OD-03/OD-07/OD-13/OD-30: list a room, find it, join it from a card and from an invite link', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  const host = await newClient(browser);
  await host.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;

  // OD-01 as the player sees it: a room is born private, and says so in the lobby.
  expect(await host.evaluate(() => window.__MEXE__.online!.visibility())).toBe('private');
  await shot({ host }, 'discover-private-lobby', screenshots);

  await host.evaluate(() => window.__MEXE__.online!.setVisibility('listed'));
  await host.waitForFunction(() => window.__MEXE__.online!.visibility() === 'listed', undefined, { timeout: 10_000 });
  await shot({ host }, 'discover-listed-lobby', screenshots);

  // OD-03/OD-30: a second player finds it in the browser, with only the safe fields on the card.
  const browserPage = await newClient(browser);
  await browserPage.evaluate(() => window.__MEXE__.online!.openBrowse());
  await browserPage.waitForFunction(
    (c) => window.__MEXE__.online!.listings().some((r) => r.code === c),
    code,
    { timeout: 10_000 },
  );
  const card = (await browserPage.evaluate(
    (c) => window.__MEXE__.online!.listings().find((r) => r.code === c)!,
    code,
  ))!;
  expect(Object.keys(card).sort()).toEqual(['capacity', 'code', 'hostName', 'players', 'status', 'timerMode']);
  expect(card).toMatchObject({ hostName: 'Marina', players: 1, capacity: 4, status: 'waiting' });
  await shot({ browser: browserPage }, 'discover-browser', screenshots);

  await browserPage.evaluate((c) => window.__MEXE__.online!.joinRoom(c), code);
  await browserPage.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });
  expect(await browserPage.evaluate(() => window.__MEXE__.online!.code())).toBe(code);

  // OD-07: the invite link is still the fastest path in, and it lands in this exact room.
  const invited = await browser.newContext().then(async (ctx) => {
    const page = await ctx.newPage();
    trackConsoleErrors(page);
    await page.goto(`/?ws=${encodeURIComponent(WS_URL)}&showcase=menu&room=${code}`);
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
    const [ox, oy] = toScreen(240, 254);
    await page.mouse.click(ox, oy);
    return page;
  });
  await invited.waitForFunction(() => window.__MEXE__.online?.seat() === 2, undefined, { timeout: 15_000 });
  expect(await invited.evaluate(() => window.__MEXE__.online!.code())).toBe(code);

  // OD-11/OD-13: every one of them now carries the room in local display history, which is what
  // the online home's CONTINUE is built from. Codes only — never the seat credential.
  for (const p of [host, browserPage, invited]) {
    const recent = await p.evaluate(() => window.__MEXE__.online!.recentRooms());
    expect(recent[0]).toEqual({ code, host: 'Marina' });
  }

  // OD-02: a room that goes back to private disappears from discovery while its seats stay put.
  await host.evaluate(() => window.__MEXE__.online!.setVisibility('private'));
  await host.waitForFunction(() => window.__MEXE__.online!.visibility() === 'private', undefined, { timeout: 10_000 });
  const onlooker = await newClient(browser);
  await onlooker.evaluate(() => window.__MEXE__.online!.openBrowse());
  await onlooker.waitForTimeout(500);
  expect(await onlooker.evaluate(() => window.__MEXE__.online!.listings())).toEqual([]);
  await shot({ empty: onlooker }, 'discover-empty', screenshots);
  expect(await host.evaluate(() => window.__MEXE__.online!.players().length)).toBe(3);

  for (const p of [host, browserPage, invited, onlooker]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots, discovery: { code, card } });
  for (const p of [host, browserPage, invited, onlooker]) await p.context().close();
});

test('OD-28/OD-29: the online home and the room browser read on a phone, portrait and landscape', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  // Five listed rooms, so the browser is drawn at its cap on every viewport and the overflow
  // line has something to say. A phone shows one row fewer than a desktop; a fourth card there
  // would sit under ATUALIZAR, which is exactly the collision this capture has to rule out.
  const hosts: Page[] = [];
  for (const name of ['Marina', 'Bia', 'Joao', 'Lia', 'Ana']) {
    const h = await newClient(browser);
    await h.evaluate((n) => window.__MEXE__.online!.createRoom(n), name);
    await h.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
    await h.evaluate(() => window.__MEXE__.online!.setVisibility('listed'));
    await h.waitForFunction(() => window.__MEXE__.online!.visibility() === 'listed', undefined, { timeout: 10_000 });
    hosts.push(h);
  }
  const host = hosts[0]!;
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;

  const portrait = await newPhoneClient(browser);
  const landscape = await newPhoneClient(browser, { width: 844, height: 390 });
  // Large text on the narrowest phone: the worst case both for the home stack and for the
  // two-line visibility badge, and the one that would show a collision first.
  const narrow = await newPhoneClient(browser, { width: 360, height: 800 }, WS_URL, '&textscale=125');

  // The online home, before anything has been remembered: create/join/browse, nothing else.
  await shot({ portrait, landscape, narrow }, 'discover-home-phone', screenshots);

  for (const p of [portrait, landscape, narrow]) {
    await p.evaluate(() => window.__MEXE__.online!.openBrowse());
    await p.waitForFunction(() => window.__MEXE__.online!.listings().length >= 5, undefined, { timeout: 10_000 });
  }
  await shot({ portrait, landscape, narrow }, 'discover-browser-phone', screenshots);

  // The host-side visibility control, at large text on the narrowest phone: the badge, its hint
  // and the lobby it sits above all have to survive the worst case together.
  await narrow.evaluate(() => window.__MEXE__.online!.createRoom('Bia'));
  await narrow.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  await narrow.evaluate(() => window.__MEXE__.online!.setVisibility('listed'));
  await narrow.waitForFunction(() => window.__MEXE__.online!.visibility() === 'listed', undefined, { timeout: 10_000 });
  await shot({ 'largetext-lobby': narrow }, 'discover-visibility', screenshots);

  // Joining from a card is what makes the home screen's CONTINUE appear on the next visit.
  await portrait.evaluate((c) => window.__MEXE__.online!.joinRoom(c), code);
  await portrait.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });
  // A returning player whose session is gone but whose display history is not — which is exactly
  // when CONTINUE has a job. The seat credential lives in sessionStorage, the history in
  // localStorage, and clearing one must leave the other alone.
  await portrait.evaluate(() => sessionStorage.clear());
  await portrait.reload();
  await portrait.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const point = await portrait.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.left + 0.5 * c.width, y: c.top + (254 / 270) * c.height };
  });
  await portrait.mouse.click(point.x, point.y);
  await portrait.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await portrait.waitForFunction(() => window.__MEXE__.online!.recentRooms().length > 0, undefined, { timeout: 10_000 });
  await shot({ continue: portrait }, 'discover-continue-phone', screenshots);

  for (const p of [portrait, landscape, narrow]) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [...hosts, portrait, landscape, narrow]) await p.context().close();
});

/**
 * Read the focus ring only once it has stopped moving.
 *
 * Phaser dispatches DOM key events on its own update tick, not in the DOM handler, so a Tab this
 * suite sends is applied a frame or more later. A read-then-press loop can outrun that queue: the
 * walk sees the button it wanted, presses Enter, and a still-queued Tab moves the ring one further
 * first — so Enter lands on the neighbour. Two consecutive agreeing reads mean the queue is
 * drained and what the ring says is what the next Enter will press.
 */
async function ringSettled(page: Page): Promise<{ index: number; count: number; label: string }> {
  let previous = -2;
  for (let i = 0; i < 40; i++) {
    const focus = await page.evaluate(() => window.__MEXE__.online!.focus());
    if (focus.index === previous) return focus;
    previous = focus.index;
    await page.waitForTimeout(60);
  }
  throw new Error('focus ring never settled');
}

/** Tab until the ring is on the button whose label matches, addressing it by name rather than by
 * index: an index silently means a different button the next time a screen's stack changes. */
async function focusToLabel(page: Page, label: RegExp): Promise<void> {
  const seen: string[] = [];
  for (let n = 0; n < 16; n++) {
    const focus = await ringSettled(page);
    if (focus.index >= 0 && label.test(focus.label)) return;
    if (focus.index >= 0) seen.push(focus.label);
    expect(focus.count, 'screen has no focusable buttons').toBeGreaterThan(0);
    if (focus.count === 1) break; // one button and it is not the one asked for
    await page.keyboard.press('Tab');
  }
  throw new Error(`focus ring never reached ${label}; walked ${JSON.stringify(seen)}`);
}

/** Walk to a button and press it, with the ring settled on it at the moment Enter is sent. */
async function pressByLabel(page: Page, label: RegExp): Promise<void> {
  await focusToLabel(page, label);
  const focus = await ringSettled(page);
  expect(focus.label, 'the ring moved between the walk and the press').toMatch(label);
  await page.keyboard.press('Enter');
}

test('OD-A11Y: the online home, the browser and the lobby are reachable from the keyboard', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  const page = await newClient(browser);

  // No ring until the keyboard is used — a mouse player must never see one.
  expect(await page.evaluate(() => window.__MEXE__.online!.focus())).toEqual({ index: -1, count: 5, label: '' });

  // A fresh context has no recent rooms, so the entry stack is exactly PARTIDA RÁPIDA,
  // CRIAR SALA, ENTRAR, PROCURAR SALAS, VOLTAR in reading order — walked by name, so a screen
  // that gains or loses a button later fails loudly here instead of pressing its neighbour.
  await focusToLabel(page, /PROCURAR/);
  await shot({ home: page }, 'discover-keyboard-home', screenshots);
  await pressByLabel(page, /PROCURAR/);
  await page.waitForFunction(() => window.__MEXE__.online!.phase() === 'browse', undefined, { timeout: 10_000 });
  await page.waitForTimeout(400); // let the listing answer land, whatever it contains
  await shot({ browse: page }, 'discover-keyboard-browse', screenshots);

  // A new screen puts the ring on its top button — ATUALIZAR, while the list is still loading —
  // and it stays on *that button* when the answer lands and pushes room cards in above it. Keeping
  // the index instead would hand the ring's Enter to whichever card moved into slot 0, which is
  // what made this test flaky: the shared server's listing count decides when that happens.
  expect((await page.evaluate(() => window.__MEXE__.online!.focus())).label).toMatch(/ATUALIZAR/);
  await pressByLabel(page, /VOLTAR/);
  await page.waitForFunction(() => window.__MEXE__.online!.phase() === 'idle', undefined, { timeout: 10_000 });

  // Back on the entry stack: CRIAR SALA, reached without a pointer.
  await pressByLabel(page, /CRIAR/);
  // Two waits, not one: the first proves the keyboard press actually reached the client and put a
  // create_room on the wire, so a failure names which half broke instead of only timing out.
  await page.waitForFunction(
    () => window.__MEXE__.online!.trace().some((m) => m.dir === 'out' && m.type === 'create_room'),
    undefined,
    { timeout: 10_000 },
  );
  await page.waitForFunction(
    () => window.__MEXE__.online?.code() !== null || window.__MEXE__.online!.errorText() !== '',
    undefined,
    { timeout: 10_000 },
  );
  // A refusal here is a real server answer (the shared server's room-creation budget is the only
  // one that can bite), not a stuck screen — say which it was rather than timing out on `code()`.
  expect(await page.evaluate(() => window.__MEXE__.online!.errorText())).toBe('');
  expect(await page.evaluate(() => window.__MEXE__.online!.phase())).toBe('lobby');
  await shot({ lobby: page }, 'discover-keyboard-lobby', screenshots);

  expect(await page.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  expect(trackConsoleErrors(page)).toEqual([]);
  appendLog({ screenshots });
  await page.context().close();
});

test('OP-16/OP-36/OP-37/OP-38: a card whose room is gone is answered on the browser, not on an error screen', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  // Two listed rooms: one that will die between the answer and the tap, and one that must still
  // be there afterwards — a stale card has to cost the player that card and nothing else.
  const dying = await newClient(browser);
  await dying.evaluate(() => window.__MEXE__.online!.createRoom('Fantasma'));
  await dying.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  await dying.evaluate(() => window.__MEXE__.online!.setVisibility('listed'));
  await dying.waitForFunction(() => window.__MEXE__.online!.visibility() === 'listed', undefined, { timeout: 10_000 });
  const deadCode = (await dying.evaluate(() => window.__MEXE__.online!.code()))!;

  const alive = await newClient(browser);
  await alive.evaluate(() => window.__MEXE__.online!.createRoom('Marina'));
  await alive.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  await alive.evaluate(() => window.__MEXE__.online!.setVisibility('listed'));
  await alive.waitForFunction(() => window.__MEXE__.online!.visibility() === 'listed', undefined, { timeout: 10_000 });
  const liveCode = (await alive.evaluate(() => window.__MEXE__.online!.code()))!;

  // Desktop, portrait and landscape all take the same path, because "the room I tapped is gone"
  // is the one public-browser moment a stranger is most likely to hit on any of them.
  const desktop = await newClient(browser);
  const portrait = await newPhoneClient(browser);
  const landscape = await newPhoneClient(browser, { width: 844, height: 390 });
  const viewers = { desktop, portrait, landscape };

  for (const p of Object.values(viewers)) {
    await p.evaluate(() => window.__MEXE__.online!.openBrowse());
    await p.waitForFunction(
      (c) => window.__MEXE__.online!.listings().some((r) => r.code === c),
      deadCode,
      { timeout: 10_000 },
    );
  }

  // The host walks out, so the room is gone — while three browsers are still drawing its card.
  await dying.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await dying.context().close();

  for (const p of Object.values(viewers)) {
    await p.evaluate((c) => window.__MEXE__.online!.joinRoom(c), deadCode);
    await p.waitForFunction(() => window.__MEXE__.online!.browseNotice() !== null, undefined, { timeout: 10_000 });
    // Still on the browser, one card lighter, with the live room still offered.
    expect(await p.evaluate(() => window.__MEXE__.online!.phase())).toBe('browse');
    const listings = await p.evaluate(() => window.__MEXE__.online!.listings());
    expect(listings.some((r) => r.code === deadCode)).toBe(false);
    expect(listings.some((r) => r.code === liveCode)).toBe(true);
    // Player-facing sentence, never a protocol code.
    const notice = (await p.evaluate(() => window.__MEXE__.online!.browseNotice()))!;
    expect(notice).not.toMatch(/room_not_found|room_closed|ROOM_|_LIMITED/);
    expect(notice.length).toBeGreaterThan(8);
  }
  await shot(viewers, 'public-stale-card', screenshots);

  // …and the next tap, on a room that does exist, gets in. A refusal is not a dead end.
  await desktop.evaluate((c) => window.__MEXE__.online!.joinRoom(c), liveCode);
  await desktop.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });
  expect(await desktop.evaluate(() => window.__MEXE__.online!.code())).toBe(liveCode);

  for (const p of [portrait, landscape]) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
  for (const p of [alive, ...Object.values(viewers)]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of [alive, ...Object.values(viewers)]) await p.context().close();
});

test('OM-07..OM-17/OM-40: Quick Match forms a 2P, a 3P and a 4P table and every player gets one seat', async ({
  browser,
}) => {
  const screenshots: string[] = [];
  const queueRuns: Record<number, { seats: number[]; codes: string[]; timerMode: string }> = {};

  for (const size of [2, 3, 4]) {
    const pages = await Promise.all(Array.from({ length: size }, () => newClient(browser)));
    // One player first, so the searching screen exists as a state and not only as a frame
    // between two clicks. Everyone asks for the same explicit size, which is what makes the
    // assertion below ("exactly `size` seats") mean something.
    await pages[0]!.evaluate((n) => window.__MEXE__.online!.joinQueue(n as 2 | 3 | 4), size);
    await pages[0]!.waitForFunction(() => window.__MEXE__.online!.phase() === 'queue', undefined, { timeout: 10_000 });
    if (size === 2) await shot({ desktop: pages[0]! }, 'queue-searching', screenshots);

    for (const page of pages.slice(1)) {
      await page.evaluate((n) => window.__MEXE__.online!.joinQueue(n as 2 | 3 | 4), size);
    }
    // MATCH FOUND is a real state with a readable duration, not a flash: catch it on the last
    // client before it hands off to the table.
    if (size === 4) {
      await pages[0]!.waitForFunction(() => window.__MEXE__.online!.phase() === 'matched', undefined, { timeout: 10_000 });
      await shot({ desktop: pages[0]! }, 'queue-match-found', screenshots);
    }
    await Promise.all(pages.map((p) => p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 15_000 })));

    const seats = await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.online!.seat() ?? -1)));
    const codes = await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.online!.code() ?? '')));
    // One room, one seat each, in the order the queue selected them.
    expect([...seats].sort((a, b) => a - b)).toEqual([...Array(size).keys()]);
    expect(new Set(codes).size).toBe(1);
    const view = await pages[0]!.evaluate(() => window.__MEXE__.state!()!);
    expect(view.players).toHaveLength(size);
    const settings = await pages[0]!.evaluate(() => window.__MEXE__.online!.roomSettings());
    queueRuns[size] = { seats, codes, timerMode: settings?.timerMode ?? 'unknown' };
    // Canonical casual terms, chosen by the server rather than by anybody at the table.
    expect(settings?.timerMode).toBe('casual');

    // A turn actually rotates, so the matchmade room is an ordinary room from here on.
    const before = await pages[0]!.evaluate(() => window.__MEXE__.online!.rev());
    const active = seats.indexOf(0);
    await pages[active]!.evaluate(() => window.__MEXE__.mexe!.comprar());
    await Promise.all(pages.map((p) => p.waitForFunction((rev) => window.__MEXE__.online!.rev() !== rev, before, { timeout: 10_000 })));

    for (const p of pages) {
      expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
      expect(trackConsoleErrors(p)).toEqual([]);
    }
    for (const p of pages) await p.context().close();
  }
  appendLog({ queueRuns, screenshots });
});

test('OM-05/OM-38/OM-39: Quick Match, the searching screen and cancel read on a phone', async ({ browser }) => {
  const screenshots: string[] = [];
  const portrait = await newPhoneClient(browser);
  const landscape = await newPhoneClient(browser, { width: 844, height: 390 });
  // The narrowest phone at 125% text: the worst case for the home stack now that Quick Match and
  // its preference line sit above create/join/browse.
  const narrow = await newPhoneClient(browser, { width: 360, height: 800 }, WS_URL, '&textscale=125');
  const phones = { portrait, landscape, narrow };

  await shot(phones, 'queue-home-phone', screenshots);

  // The fullest the online home ever gets: Quick Match and its preference above CONTINUAR, the
  // create/join/browse stack and a recent-code strip. Seeded rather than played into, because
  // what is being checked is the layout at its tallest, not how the entries got there.
  // Portrait and landscape both: landscape is the tighter of the two, because VOLTAR sits
  // higher there and the recent-code strip is the last thing above it.
  for (const [key, viewport] of [['portrait', { width: 390, height: 844 }], ['landscape', { width: 844, height: 390 }]] as const) {
  const crowded = await browser.newContext({ viewport });
  const crowdedPage = await crowded.newPage();
  trackConsoleErrors(crowdedPage);
  await crowdedPage.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem('mexe.online.recent', JSON.stringify([
      { code: 'BCDFG', host: 'Marina', at: now },
      { code: 'HJKMN', host: 'Bia', at: now - 1000 },
      { code: 'PQRST', host: 'Lia', at: now - 2000 },
    ]));
  });
  await crowdedPage.goto(`/?ws=${encodeURIComponent(WS_URL)}&showcase=menu`);
  await crowdedPage.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const menuPoint = await crowdedPage.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.left + 0.5 * c.width, y: c.top + (254 / 270) * c.height };
  });
  await crowdedPage.mouse.click(menuPoint.x, menuPoint.y);
  await crowdedPage.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 10_000 });
  await crowdedPage.waitForFunction(() => window.__MEXE__.online!.recentRooms().length === 3, undefined, { timeout: 10_000 });
  await shot({ [key]: crowdedPage }, 'queue-home-full', screenshots);
  const fullOverflow = await crowdedPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(fullOverflow).toBeLessThanOrEqual(0);
  expect(trackConsoleErrors(crowdedPage)).toEqual([]);
  await crowded.close();
  }

  // Four-player preference with only three phones waiting: the search stays a search, which is
  // the state that has to be readable.
  for (const p of Object.values(phones)) {
    await p.evaluate(() => window.__MEXE__.online!.joinQueue(4));
    await p.waitForFunction(() => window.__MEXE__.online!.phase() === 'queue', undefined, { timeout: 10_000 });
  }
  // Long enough that the elapsed counter has actually ticked — a frozen 00:00 would read as a
  // hung screen however correct the state behind it is.
  await portrait.waitForTimeout(1500);
  await shot(phones, 'queue-searching-phone', screenshots);

  for (const p of Object.values(phones)) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }

  // Cancel returns them to the home screen, with a sentence saying so.
  for (const p of Object.values(phones)) {
    await p.evaluate(() => window.__MEXE__.online!.cancelQueue());
    await p.waitForFunction(() => window.__MEXE__.online!.phase() === 'idle', undefined, { timeout: 10_000 });
    expect(await p.evaluate(() => window.__MEXE__.online!.queue().status)).toBe('idle');
  }
  await shot(phones, 'queue-cancelled-phone', screenshots);

  for (const p of Object.values(phones)) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(trackConsoleErrors(p)).toEqual([]);
  }
  appendLog({ screenshots });
  for (const p of Object.values(phones)) await p.context().close();
});

test('the name can be set from the join screen, without losing the half-typed code', async ({ browser }) => {
  const host = await newClient(browser);
  const guest = await newClient(browser);

  await host.evaluate(() => window.__MEXE__.online!.createRoom('Host'));
  await host.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await host.evaluate(() => window.__MEXE__.online!.code()))!;

  const [jx, jy] = toScreen(240, 156); // OnlineScene JOIN button
  await guest.mouse.click(jx, jy);
  await guest.waitForFunction(() => window.__MEXE__.online!.phase() === 'join', undefined, { timeout: 10_000 });

  // Half the code typed, then the detour: the name line on the join screen opens the editor,
  // and committing comes back here rather than dumping the player on the home screen.
  await guest.keyboard.type(code.slice(0, 3), { delay: 40 });
  const [nx, ny] = toScreen(240, 206); // "playing as" line on the join screen
  await guest.mouse.click(nx, ny);
  await guest.waitForFunction(() => window.__MEXE__.online!.phase() === 'name', undefined, { timeout: 10_000 });
  await guest.keyboard.type('Convidada', { delay: 40 });
  await guest.keyboard.press('Enter');
  await guest.waitForFunction(() => window.__MEXE__.online!.phase() === 'join', undefined, { timeout: 10_000 });
  // That one Enter committed the name and nothing else. Phaser can deliver a keydown and its
  // keyup in the same frame as two `keydown` emits, and the second one used to land on the code
  // screen this one just returned to — submitting the half-typed code as a join.
  expect(await guest.evaluate(() => window.__MEXE__.online!.trace().map((m) => m.type))).not.toContain('join_room');

  // The code buffer survived the detour: only the remaining characters are typed here.
  await guest.keyboard.type(code.slice(3), { delay: 40 });
  await guest.keyboard.press('Enter');
  await guest.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });

  // The seat carries the name typed on the way in, as the host sees it.
  await host.waitForFunction(() => window.__MEXE__.online!.players().length === 2, undefined, { timeout: 10_000 });
  const guestName = await host.evaluate(() => window.__MEXE__.online!.players().find((p) => p.seat === 1)?.name);
  expect(guestName).toBe('Convidada');

  for (const p of [host, guest]) expect(trackConsoleErrors(p)).toEqual([]);
  for (const p of [host, guest]) await p.context().close();
});
