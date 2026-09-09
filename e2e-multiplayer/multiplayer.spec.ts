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
    env: { ...process.env, PORT: String(WS_PORT), MEXE_TEST_SEED: String(TEST_SEED) },
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

/** One round: whichever client currently has an active turn draws; both are polled so the
 * caller doesn't need to track turn order. Returns true once both clients report the win scene. */
async function drawRound(pages: Page[]): Promise<boolean> {
  const revsBefore = await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.online?.rev() ?? null)));
  for (const p of pages) {
    await p.evaluate(() => {
      if (window.__MEXE__.mexe) window.__MEXE__.mexe.comprar();
    });
  }
  await Promise.all(
    pages.map((p, i) =>
      p.waitForFunction(
        (prevRev) => window.__MEXE__.scene === 'win' || (window.__MEXE__.online?.rev() ?? null) !== prevRev,
        revsBefore[i],
        { timeout: 5000 },
      ),
    ),
  );
  const scenes = await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.scene)));
  return scenes.every((s) => s === 'win');
}

test('two clients: create, join, ready, legal turn, illegal proposal, draw to a real stalemate win', async ({
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

  // --- both ready -> game starts ---
  await pageB.evaluate(() => window.__MEXE__.online!.setReady(true));

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

  // --- draw/end-turn to a real, server-decided stalemate: drive both clients' COMPRAR
  // via debugApi.mexe until the (fixed, seed-independent) 38-card draw pile empties and
  // two consecutive empty draws end the game (docs/MULTIPLAYER_ARCHITECTURE.md §7/rules.ts). ---
  // draw pile starts at 94 cards (108 - 2*7); each round drains at most 1 (only the
  // currently-active client's comprar is a no-op-free draw), so give this comfortable headroom.
  const pages = [pageA, pageB];
  let finished = false;
  for (let i = 0; i < 110 && !finished; i++) {
    finished = await drawRound(pages);
    const r = await pageA.evaluate(() => window.__MEXE__.online?.rev() ?? null);
    if (r !== null && r !== revisionsObserved[revisionsObserved.length - 1]) revisionsObserved.push(r);
  }
  expect(finished, 'match did not reach a win within the round budget').toBe(true);

  await pageA.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 10_000 });
  await pageB.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 10_000 });
  await shot({ a: pageA, b: pageB }, 'win', screenshots);

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
