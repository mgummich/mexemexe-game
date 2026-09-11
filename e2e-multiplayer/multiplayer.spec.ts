import { expect, test, type Browser, type Page } from '@playwright/test';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 5 multiplayer verification: launches the real WS server and drives two browser
 * contexts through the full online flow. Separate spec file + separate script from
 * `npm run verify` on purpose — a server crash here must never fail local verify.
 * See docs/MULTIPLAYER_ARCHITECTURE.md §11 and docs/PHASE5_CLIENT_PLAN.md.
 */

const OUT_DIR = 'docs/screenshots';
const LOG_PATH = path.join(OUT_DIR, 'verify-multiplayer-log.json');
const WS_PORT = 8799;
const WS_URL = `ws://localhost:${WS_PORT}`;
// Fixed so the deal is deterministic: seat 0's hand contains a ready-made legal run
// (diamonds J-Q-K), and the draw pile always holds 108 - 2*7 = 94 cards (used below to
// run the match to a real, server-decided stalemate game_over).
const TEST_SEED = 2;
const LEGAL_MELD_CARDS = ['diamonds-11-d0', 'diamonds-12-d0', 'diamonds-13-d0'];

let serverProc: ChildProcessWithoutNullStreams;
const serverStdout: string[] = [];
const serverStderr: string[] = [];

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server health check timed out: ${url}`);
}

test.beforeAll(async () => {
  // Run the local tsx binary directly (not via `npx`/`npm run`) — npm/npx write their own
  // "notice" lines to stderr, which would otherwise look like a server error to the gate.
  serverProc = spawn(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['server/index.ts'], {
    cwd: process.cwd(),
    // Playwright sets NO_COLOR while its parent may carry FORCE_COLOR; Node emits that conflict
    // on server stderr and our multiplayer gate correctly treats server stderr as a failure.
    env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: undefined, PORT: String(WS_PORT), MEXE_TEST_SEED: String(TEST_SEED) },
  });
  serverProc.stdout.on('data', (d) => serverStdout.push(String(d)));
  serverProc.stderr.on('data', (d) => serverStderr.push(String(d)));
  await waitForHealth(`http://localhost:${WS_PORT}/health`);
});

test.afterAll(async () => {
  serverProc.kill('SIGTERM');
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

async function newClient(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  await page.goto(`/?ws=${encodeURIComponent(WS_URL)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  // MenuScene ONLINE button, logical (240, 258)
  const [ox, oy] = toScreen(240, 258);
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
  const traceLenBeforeDrop = await pageB.evaluate(() => window.__MEXE__.online!.trace().length);
  await pageB.evaluate(() => window.__MEXE__.online!.forceDrop());

  await pageA.waitForFunction(() => window.__MEXE__.online!.notice().length > 0, undefined, { timeout: 10_000 });
  const disconnectNotice = await pageA.evaluate(() => window.__MEXE__.online!.notice());
  expect(disconnectNotice.length).toBeGreaterThan(0);
  await shot({ a: pageA }, 'opponent-disconnected', screenshots);

  await pageB.waitForFunction(() => window.__MEXE__.online!.status() === 'reconnecting', undefined, { timeout: 5000 });
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

  // --- V1b: a full page reload resumes the match. sessionStorage keeps the reconnect token, so
  // re-entering Online must land straight back in the running game with the room context intact
  // (code + revision), instead of re-establishing the seat and then sitting in the lobby. ---
  await pageB.reload();
  await pageB.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [reloadOx, reloadOy] = toScreen(240, 258); // MenuScene ONLINE button
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
  fs.writeFileSync(
    LOG_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        roomCode: code,
        seed: TEST_SEED,
        revisionsObserved,
        clients: {
          a: { consoleErrors: consoleErrorsByPage.get(pageA) ?? [], pageErrors: errorsA },
          b: { consoleErrors: consoleErrorsByPage.get(pageB) ?? [], pageErrors: errorsB },
        },
        server: { stdout: serverStdout, stderr: serverStderr },
        trace: { a: traceA, b: traceB },
        illegalProposal: { reasons: rejectionReasons, accepted: illegalProposalAccepted },
        reconnect,
        screenshots,
      },
      null,
      2,
    ),
  );

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
  // The 2P test writes the shared evidence log first; append 3P/4P seats and screenshots so
  // one artifact records every alpha player-count run rather than leaving evidence implicit.
  const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) as Record<string, unknown>;
  log.playerCountRuns = playerCountRuns;
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
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
  const [jx, jy] = toScreen(240, 145); // OnlineScene JOIN button
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

  const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) as Record<string, unknown>;
  log.keyboardJoin = { code, screenshot: joinShot };
  log.handPrivacy = privacy;
  log.resync = { revisionBefore: revBefore, revisionAfter: revAfter, desyncs };
  log.screenshots = [...((log.screenshots as string[]) ?? []), ...screenshots];
  log.server = { stdout: serverStdout, stderr: serverStderr };
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));

  await host.context().close();
  await guest.context().close();
});

/** Appends a screenshot path (and optional extra fields) to the shared evidence log written by
 * the first test above, the same way the keyboard-join test already does. */
function appendLog(extra: Record<string, unknown>): void {
  const log = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')) as Record<string, unknown>;
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'screenshots') log.screenshots = [...((log.screenshots as string[]) ?? []), ...(v as string[])];
    else log[k] = v;
  }
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
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
  const [ox, oy] = toScreen(240, 258); // MenuScene ONLINE button
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
  const [cx, cy] = toScreen(240, 110); // OnlineScene idle CREATE button
  await pageA.mouse.click(cx, cy);
  await pageA.mouse.click(cx, cy); // second click lands inside the fireOnce cooldown, must be a no-op
  await pageA.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  const code = (await pageA.evaluate(() => window.__MEXE__.online!.code()))!;
  const traceA = await pageA.evaluate(() => window.__MEXE__.online!.trace());
  expect(traceA.filter((m) => m.dir === 'out' && m.type === 'create_room')).toHaveLength(1);

  const pageB = await newClient(browser);
  const [jx, jy] = toScreen(240, 145); // OnlineScene idle JOIN button -> opens the code screen
  await pageB.mouse.click(jx, jy);
  await pageB.waitForTimeout(100);
  await pageB.keyboard.type(code, { delay: 30 });
  const [confirmX, confirmY] = toScreen(240, 180); // join-screen confirm JOIN button
  await pageB.mouse.click(confirmX, confirmY);
  await pageB.mouse.click(confirmX, confirmY); // second click, same cooldown window
  await pageB.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 10_000 });
  const traceB = await pageB.evaluate(() => window.__MEXE__.online!.trace());
  expect(traceB.filter((m) => m.dir === 'out' && m.type === 'join_room')).toHaveLength(1);

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
  const [jx, jy] = toScreen(240, 145);
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
  const [ox, oy] = toScreen(240, 258);
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
async function newPhoneClient(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  trackConsoleErrors(page);
  await page.goto(`/?ws=${encodeURIComponent(WS_URL)}&showcase=menu`);
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const point = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    // MenuScene's ONLINE button is authored at (240, 258) on the 480x270 grid; menu-layout maps
    // that proportionally onto whichever world is live, so the same fractions hold in portrait.
    return { x: c.left + 0.5 * c.width, y: c.top + (258 / 270) * c.height };
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
    return { x: c.left + 0.5 * c.width, y: c.top + (258 / 270) * c.height };
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

  const joinBtn = await at(145); // OnlineScene JOIN
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
