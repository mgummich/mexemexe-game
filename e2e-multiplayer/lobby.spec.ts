import { expect, test, type Browser, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  OUT_DIR, consoleErrorsOf, freePort, newClient, newPhoneClient, shot, startTestServer, toScreen, type TestServer,
  attachClientContexts, tracedMs,
} from './harness';

declare global {
  interface Window {
    /** LB-15 only: set by the in-page recorder below when seat 0 is first rendered `offline`. */
    __seat0WentOffline?: boolean;
    __seat0Watch?: number;
  }
}

/**
 * LB-01..LB-47 — the lobby as a distributed state machine.
 *
 * Every test here runs real browser contexts (one storage, one socket each) against the real
 * server. Assertions are on `lobbySeats()` — the rows the lobby actually PAINTED — not only on
 * `players()`, because the bug class this suite exists for is exactly the two disagreeing: the
 * client can hold a correct roster and still drop an occupied seat off the screen.
 */

// One shard per worker, merged per engine by scripts/check-verify-multiplayer.mjs. A single
// shared file cannot survive parallel workers: two read-modify-write cycles interleave and one
// worker's evidence disappears. Same shape as multiplayer.spec.ts's shards.
const PARTS_DIR = path.join(OUT_DIR, 'verify-lobby-log-parts');
// The port comes from the OS, not from a per-engine block. A fixed port is shared with everything
// else on the machine, and this suite is where that bit hardest: with a dev server (or anything
// else, e.g. a proxy on the server's own DEFAULT_PORT 8787) already listening, our server died on
// EADDRINUSE while the health probe was answered by that other process, so the WebSocket never
// reached the room manager under test — and Firefox, which runs only this file, reported it as a
// lobby failure. `startTestServer` now also refuses to attach to a server it did not start.

// Each test builds its own room from scratch against its worker's own server — nothing here is
// ordered, and serial was the whole cost of this suite on CI.
test.describe.configure({ mode: 'parallel' });

let server: TestServer;
const evidence: Record<string, unknown> = {};
const screenshots: string[] = [];

test.beforeAll(async () => {
  server = await startTestServer(await freePort());
});

// A failed test reports where every client it opened actually was — seat, revision, match, last
// rejections and its final messages — instead of only the assertion that noticed.
test.afterEach(async ({}, testInfo) => { await attachClientContexts(testInfo); });

test.afterAll(async ({}, testInfo) => {
  server.stop();
  fs.mkdirSync(PARTS_DIR, { recursive: true });
  // Named per project, not once per module: one worker process can run this file for two
  // projects in turn, and a single module-level path would have the second afterAll overwrite
  // the first engine's evidence.
  fs.writeFileSync(
    path.join(PARTS_DIR, `${testInfo.project.name}-${randomUUID()}.json`),
    JSON.stringify(
      {
        engine: testInfo.project.name,
        ...evidence,
        screenshots,
        serverStderr: server.stderr.filter((l) => l.trim().length > 0),
      },
      null,
      2,
    ),
  );
});

// ---------- lobby vocabulary ----------

interface SeatRow {
  seat: number;
  name: string;
  you: boolean;
  host: boolean;
  status: 'empty' | 'waiting' | 'ready' | 'offline';
  wins: number;
}

const client = (browser: Browser): Promise<Page> => newClient(browser, server.url);

async function clients(browser: Browser, n: number): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < n; i++) pages.push(await client(browser));
  return pages;
}

/** The rows the lobby drew, in row order. */
const rows = (p: Page): Promise<SeatRow[]> =>
  p.evaluate(() => window.__MEXE__.online!.lobbySeats!() as SeatRow[]);

const occupiedRows = async (p: Page): Promise<SeatRow[]> =>
  (await rows(p)).filter((r) => r.status !== 'empty');

async function createRoom(page: Page, name: string): Promise<string> {
  await page.evaluate((n) => window.__MEXE__.online!.createRoom(n), name);
  await page.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  return (await page.evaluate(() => window.__MEXE__.online!.code()))!;
}

async function joinRoom(page: Page, code: string, name: string, seat: number): Promise<void> {
  await page.evaluate(([c, n]) => window.__MEXE__.online!.joinRoom(c as string, n as string), [code, name]);
  await page.waitForFunction((s) => window.__MEXE__.online?.seat() === s, seat, { timeout: 10_000 });
}

/** Wait until every client has PAINTED the given occupied seat indices. */
async function waitForSeats(pages: Page[], seats: number[]): Promise<void> {
  for (const p of pages) {
    await p.waitForFunction(
      (want) => {
        const drawn = (window.__MEXE__.online?.lobbySeats?.() ?? [])
          .filter((r) => r.status !== 'empty')
          .map((r) => r.seat);
        return JSON.stringify(drawn) === JSON.stringify(want);
      },
      seats,
      { timeout: 10_000 },
    );
  }
}

/** Every client must agree on membership, seat ownership, names, host and room code. */
async function assertParity(pages: Page[], code: string): Promise<void> {
  const views = await Promise.all(
    pages.map(async (p) => ({
      code: await p.evaluate(() => window.__MEXE__.online!.code()),
      seats: (await occupiedRows(p)).map((r) => ({ seat: r.seat, name: r.name, host: r.host, status: r.status, wins: r.wins })),
      host: (await rows(p)).find((r) => r.host && r.status !== 'empty')?.seat ?? null,
    })),
  );
  for (const v of views) {
    expect(v.code).toBe(code);
    // Seat ownership is unique by construction only if nothing rendered a seat twice.
    expect(new Set(v.seats.map((s) => s.seat)).size).toBe(v.seats.length);
    expect(JSON.stringify(v.seats)).toBe(JSON.stringify(views[0]!.seats));
    expect(v.host).toBe(views[0]!.host);
  }
}

/** Exactly one row says YOU, and it is this client's own seat. */
async function assertYouBadge(page: Page): Promise<void> {
  const drawn = await rows(page);
  const mine = await page.evaluate(() => window.__MEXE__.online!.seat());
  const you = drawn.filter((r) => r.you);
  expect(you).toHaveLength(1);
  expect(you[0]!.seat).toBe(mine);
}

async function readyAll(pages: Page[]): Promise<void> {
  for (const p of pages) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  for (const p of pages) {
    await p.waitForFunction(
      (n) => {
        const drawn = (window.__MEXE__.online?.lobbySeats?.() ?? []).filter((r) => r.status !== 'empty');
        return drawn.length === n && drawn.every((r) => r.status === 'ready');
      },
      pages.length,
      { timeout: 10_000 },
    );
  }
}

/** Ready everyone, host starts, every client reaches the match. */
async function startMatch(host: Page, pages: Page[]): Promise<string> {
  await readyAll(pages);
  await host.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of pages) await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 20_000 });
  return (await host.evaluate(() => window.__MEXE__.online!.matchId()))!;
}

/** Drain the draw pile to a server-decided finish; nobody fakes game_over. `stopAtDrawCount`
 * stops early with that many cards still in the pile, for a test that needs the endgame to
 * happen under different conditions than the rest of the match. */
async function playToFinish(pages: Page[], stopAtDrawCount = 0): Promise<void> {
  // Resolve player index -> page once. It is fixed for the length of a match, and asking every
  // page "is it your turn?" on every draw was this helper's whole cost: one CDP round-trip per
  // client per iteration, on top of the draw itself. That is why the cost scaled with seats
  // rather than with draws — the 4-seat match needs *fewer* draws than the 2-seat one (80 vs 94,
  // 108 cards less the deal) yet ran far longer, and LB-18/LB-20 timed out at 180s on CI while
  // the 2- and 3-seat variants landed at 1.7m and 2.9m. One state read plus one comprar per draw
  // now, whatever the seat count.
  const byIndex = new Map<number, Page>();
  for (const p of pages) {
    const idx = await p.evaluate(() => window.__MEXE__.online?.localSeat?.());
    if (idx !== undefined) byIndex.set(idx, p);
  }
  // Two budgets, because one draw is not one iteration. A seat the server is playing for (an
  // absent client) only moves when its turn clock expires, and an iteration that finds nothing to
  // draw costs ~20ms — so a pure iteration count is really a wall-clock budget whose length
  // depends on how fast the engine answers, and it ran out before a 15s server turn on WebKit
  // while passing on Chromium. Draws are capped; waiting is capped by how long nothing has
  // happened, which is what "stuck" actually means.
  const STALL_MS = 45_000;
  // The server closes a connection that sends more than 30 messages in a second (hitFlood in
  // server/connections.ts, the S5 flood guard) — and a 1008 close mid-drain looks exactly like
  // this helper hanging: the client keeps believing it is on turn, every comprar() is dropped,
  // and nothing moves until the 10s onlinePending timeout resyncs it, by which point the
  // waitForFunction below has already thrown. One draw is one inbound message, so the drain has
  // to pace itself. 50ms is 20 messages a second, two thirds of the budget, and the budget is
  // per connection — so it has to hold for `playToFinish([a])`, where a single client sends
  // every draw itself, not just for the alternating multi-seat case.
  //
  // This is what made the Firefox lobby replay red from 2026-09-16: the rewrite that replaced
  // the per-iteration sleep with the waitForFunction below left the loop running as fast as the
  // engine answered. Chromium happened to sit just under 30/s and Firefox just over it.
  const DRAW_PACE_MS = 50;
  let lastProgress = Date.now();
  for (let draws = 0; draws < 600 && Date.now() - lastProgress < STALL_MS; ) {
    const active = await pages[0]!.evaluate((stopAt) => {
      if (window.__MEXE__.scene === 'win') return 'done' as const;
      const s = window.__MEXE__.state?.();
      // An empty pile is not a finish: the match ends on the *next* draw, so 0 means "play on".
      if (stopAt > 0 && s && s.drawPile.length <= stopAt) return 'done' as const;
      return s && s.winnerId === null ? s.activePlayerIndex : null;
    }, stopAtDrawCount);
    if (active === 'done') return;
    const turn = active === null ? undefined : byIndex.get(active);
    // The candidate still checks its *own* state before drawing, exactly as before: pages[0]'s
    // view can be a broadcast ahead of the seat it names, and drawing for a seat whose client
    // does not yet believe it is on turn is a refusal, not a draw.
    const drew =
      turn &&
      (await turn.evaluate(() => {
        const s = window.__MEXE__.state?.();
        if (!s || s.winnerId !== null || s.activePlayerIndex !== window.__MEXE__.online?.localSeat?.()) return false;
        window.__MEXE__.online!.comprar();
        return true;
      }));
    if (!drew) {
      await pages[0]!.waitForTimeout(20);
      continue;
    }
    draws++;
    lastProgress = Date.now();
    await turn.waitForTimeout(DRAW_PACE_MS);
    // Wait in the browser for the turn to actually move, instead of polling for it one CDP
    // round-trip at a time. The old fixed 20ms sleep meant a draw normally cost two iterations:
    // one that drew, then one that found the same active index still rendered and did nothing.
    await pages[0]!.waitForFunction(
      (prev) => {
        if (window.__MEXE__.scene === 'win') return true;
        const s = window.__MEXE__.state?.();
        return !!s && (s.winnerId !== null || s.activePlayerIndex !== prev);
      },
      active,
      { timeout: 15_000 },
    );
  }
  throw new Error(
    `match did not finish within draw-pile budget (nothing moved for ${Math.round((Date.now() - lastProgress) / 1000)}s)`,
  );
}

/** WinScene REMATCH for every seat — back into the same room, on the same code. */
async function rematchAll(pages: Page[]): Promise<void> {
  for (const p of pages) await p.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 20_000 });
  for (const p of pages) {
    const y = (await p.evaluate(() => window.__MEXE__.winButtonY))!;
    const [bx, by] = toScreen(240, y);
    await p.mouse.click(bx, by);
    await p.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 15_000 });
  }
}

async function assertClean(pages: Page[]): Promise<void> {
  for (const p of pages) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(consoleErrorsOf(p).filter((e) => !e.includes('WebSocket connection'))).toEqual([]);
  }
  expect(server.stderr.filter((l) => l.trim().length > 0)).toEqual([]);
}

/** Re-enter the online flow from the menu, the way a player who backed out would. */
async function reenterOnline(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [ox, oy] = toScreen(240, 254);
  await page.mouse.click(ox, oy);
  await page.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 15_000 });
  await page.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 20_000 });
}

const closeAll = async (pages: Page[]): Promise<void> => {
  for (const p of pages) await p.context().close();
};

// ---------- LB-01..LB-06, LB-30: seats, gaps, and what is on screen ----------

test('LB-01/LB-02/LB-03/LB-30: 2, 3 and 4 clients agree on membership, seats, YOU, HOST and code', async ({ browser }) => {
  for (const n of [2, 3, 4]) {
    const pages = await clients(browser, n);
    const code = await createRoom(pages[0]!, 'Marina');
    const names = ['Marina', 'Joao', 'Ana', 'Bea'];
    for (let i = 1; i < n; i++) await joinRoom(pages[i]!, code, names[i]!, i);
    await waitForSeats(pages, Array.from({ length: n }, (_, i) => i));

    await assertParity(pages, code);
    for (const p of pages) await assertYouBadge(p);
    // Host authority is rendered from the server's hostSeat, never from array position.
    for (const p of pages) {
      const drawn = await rows(p);
      expect(drawn.filter((r) => r.host && r.status !== 'empty').map((r) => r.seat)).toEqual([0]);
      expect((await occupiedRows(p)).map((r) => r.name)).toEqual(names.slice(0, n));
    }
    evidence[`lb0${n - 1}`] = { seats: (await occupiedRows(pages[0]!)).map((r) => r.seat), code };
    await assertClean(pages);
    await closeAll(pages);
  }
});

test('LB-04/LB-05/LB-06: a seat above a gap keeps rendering after the seats below it empty out', async ({ browser }) => {
  const pages = await clients(browser, 4);
  const [a, b, c, d] = pages as [Page, Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await joinRoom(d, code, 'Dora', 3);
  await waitForSeats(pages, [0, 1, 2, 3]);
  await shot({ full: a }, 'lb-seats-full', screenshots);

  // LB-04: one gap at seat 1.
  await b.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a, c, d], [0, 2, 3]);
  for (const p of [a, c, d]) {
    const drawn = await rows(p);
    expect(drawn.find((r) => r.seat === 3)?.name).toBe('Dora');
    expect(drawn.find((r) => r.seat === 1)?.status).toBe('empty');
  }

  // LB-05/LB-06: two gaps — seat 3 must still be on screen.
  await c.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a, d], [0, 3]);
  for (const p of [a, d]) {
    const drawn = await rows(p);
    expect(drawn.map((r) => r.seat)).toEqual([0, 1, 2, 3]);
    expect(drawn.find((r) => r.seat === 0)?.name).toBe('Ana');
    expect(drawn.find((r) => r.seat === 3)?.name).toBe('Dora');
    expect(drawn.filter((r) => r.status === 'empty').map((r) => r.seat)).toEqual([1, 2]);
  }
  await assertParity([a, d], code);
  await shot({ gaps: a }, 'lb-seat-gaps', screenshots);
  evidence.seatGaps = (await rows(a)).map((r) => ({ seat: r.seat, name: r.name, status: r.status }));

  await assertClean([a, d]);
  await closeAll(pages);
});

test('LB-07/LB-08: a replacement takes the lowest free seat and inherits nothing', async ({ browser }) => {
  const pages = await clients(browser, 4);
  const [a, b, c, d] = pages as [Page, Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await waitForSeats([a, b, c], [0, 1, 2]);

  // Bruno readies, then leaves: the vote retires with the chair.
  await b.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().some((r) => r.seat === 1 && r.status === 'ready'),
    undefined,
    { timeout: 10_000 },
  );
  await b.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a, c], [0, 2]);

  // LB-07: the newcomer is handed seat 1, the canonical lowest free seat.
  await joinRoom(d, code, 'Dora', 1);
  await waitForSeats([a, c, d], [0, 1, 2]);
  const seat1 = (await rows(a)).find((r) => r.seat === 1)!;
  // LB-08: brand-new seat object — no inherited ready bit, no inherited wins.
  expect(seat1).toMatchObject({ name: 'Dora', status: 'waiting', wins: 0, host: false });
  await assertParity([a, c, d], code);
  await assertYouBadge(d);

  await assertClean([a, c, d]);
  await closeAll(pages);
});

// ---------- LB-09..LB-12: ready is the server's bit ----------

test('LB-09/LB-12 @race: the rendered ready state is the server\'s, and a ready/start race resolves once', async ({ browser }) => {
  const pages = await clients(browser, 3);
  const [a, b, c] = pages as [Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await waitForSeats(pages, [0, 1, 2]);

  // Simultaneous ready from three clients: every client converges on all-ready.
  await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.online!.setReady(true))));
  for (const p of pages) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.lobbySeats!().filter((r) => r.status !== 'empty').every((r) => r.status === 'ready'),
      undefined,
      { timeout: 10_000 },
    );
  }
  // Unready one seat: the row and every other client's copy of it follow the server, not a local flag.
  await b.evaluate(() => window.__MEXE__.online!.setReady(false));
  for (const p of pages) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 1)?.status === 'waiting',
      undefined,
      { timeout: 10_000 },
    );
  }
  // Rendered rows and the authoritative roster never disagree.
  for (const p of pages) {
    const drawn = await occupiedRows(p);
    const truth = await p.evaluate(() => window.__MEXE__.online!.players());
    expect(drawn.map((r) => ({ seat: r.seat, ready: r.status === 'ready' })))
      .toEqual(truth.map((t) => ({ seat: t.seat, ready: t.ready })));
  }

  // LB-12: a start racing a stale ready bit must not deal. Seat 1 is not ready. The refusal is
  // answered on the lobby — it must not cost the host the screen they are acting on.
  await a.evaluate(() => window.__MEXE__.online!.startGame());
  await a.waitForTimeout(500);
  expect(await a.evaluate(() => window.__MEXE__.scene)).toBe('online');
  expect(await a.evaluate(() => window.__MEXE__.online!.phase())).toBe('lobby');
  expect(await a.evaluate(() => window.__MEXE__.online!.lobbyNotice!())).toBeTruthy();
  expect((await occupiedRows(a)).length).toBe(3);

  // Everyone ready, two starts fired back to back: exactly one match.
  await readyAll(pages);
  await a.evaluate(() => {
    window.__MEXE__.online!.startGame();
    window.__MEXE__.online!.startGame();
  });
  for (const p of pages) await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 20_000 });
  const ids = await Promise.all(pages.map((p) => p.evaluate(() => window.__MEXE__.online!.matchId())));
  expect(new Set(ids).size).toBe(1);

  await assertClean(pages);
  await closeAll(pages);
});

test('LB-11 @race: a fairness setting change clears every ready bit, once, on every client', async ({ browser }) => {
  const pages = await clients(browser, 3);
  const [a, b, c] = pages as [Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await waitForSeats(pages, [0, 1, 2]);
  await readyAll(pages);

  const before = await a.evaluate(() => window.__MEXE__.online!.roomSettings());
  await a.evaluate(() => window.__MEXE__.online!.setRoomSettings({ timerMode: 'fast', turnMs: 20_000, mexeBonusMs: 10_000, warnMs: 5_000, missedTurnLimit: 3, reconnectGraceMs: 30_000 }));
  for (const p of pages) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.lobbySeats!().filter((r) => r.status !== 'empty').every((r) => r.status === 'waiting'),
      undefined,
      { timeout: 10_000 },
    );
    expect(await p.evaluate(() => window.__MEXE__.online!.roomSettings()?.timerMode)).toBe('fast');
  }
  expect(before?.timerMode).not.toBe('fast');

  // A stale ready bit cannot start the match: the host's own bit was cleared too, and the
  // refusal keeps the lobby on screen.
  await a.evaluate(() => window.__MEXE__.online!.startGame());
  await a.waitForTimeout(500);
  expect(await a.evaluate(() => window.__MEXE__.online!.phase())).toBe('lobby');

  // Idempotent re-send of the same settings is not a change and leaves the lobby alone.
  await readyAll(pages);
  await a.evaluate(() => window.__MEXE__.online!.setRoomSettings(window.__MEXE__.online!.roomSettings()!));
  await a.waitForTimeout(400);
  expect((await occupiedRows(a)).every((r) => r.status === 'ready')).toBe(true);

  await assertClean(pages);
  await closeAll(pages);
});

// ---------- LB-13..LB-15: host authority ----------

test('LB-13/LB-14/LB-15 @race: host transfer is deterministic, gap-safe, and a drop is not a departure', async ({ browser }) => {
  const pages = await clients(browser, 4);
  const [a, b, c, d] = pages as [Page, Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await joinRoom(d, code, 'Dora', 3);
  await waitForSeats(pages, [0, 1, 2, 3]);

  // LB-15: a dropped socket is a held seat, not a departure — host authority does not move.
  //
  // `offline` is a *transient* render, not a resting state: the dropped client reconnects on
  // RECONNECT_DELAYS_MS[0] (800ms + jitter), so the seat shows offline for about 820ms and then
  // goes back to waiting. Measured: waiting@0ms -> offline@245ms -> waiting@1066ms. Polling for
  // it from the test process — three clients checked one after another, inside that one window —
  // is a race that a traced or loaded runner loses, and then waits out its whole budget for a
  // state that can never come back. So each client records the transition itself, from a timer
  // installed before the drop; the recorded flag outlives the window and the loop below can take
  // its time.
  await Promise.all([b, c, d].map((p) => p.evaluate(() => {
    window.__seat0WentOffline = false;
    window.__seat0Watch = window.setInterval(() => {
      if (window.__MEXE__.online?.lobbySeats?.().find((r) => r.seat === 0)?.status === 'offline') {
        window.__seat0WentOffline = true;
      }
    }, 25);
  })));
  await a.evaluate(() => window.__MEXE__.online!.forceDrop());
  for (const p of [b, c, d]) {
    await p.waitForFunction(() => window.__seat0WentOffline === true, undefined, { timeout: tracedMs(15_000) });
    await p.evaluate(() => window.clearInterval(window.__seat0Watch));
    expect((await rows(p)).find((r) => r.host && r.status !== 'empty')?.seat).toBe(0);
  }
  await a.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 30_000 });
  await waitForSeats(pages, [0, 1, 2, 3]);
  await assertParity(pages, code);

  // LB-14: host leaves a lobby with a gap below the survivors — the next OCCUPIED seat takes over.
  await b.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a, c, d], [0, 2, 3]);
  await a.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  for (const p of [c, d]) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.lobbySeats!().find((r) => r.host && r.status !== 'empty')?.seat === 2,
      undefined,
      { timeout: 10_000 },
    );
  }
  await waitForSeats([c, d], [2, 3]);
  await assertParity([c, d], code);
  // LB-13: the new host has the controls, the old host's row is gone from every client.
  for (const p of [c, d]) {
    const drawn = await rows(p);
    expect(drawn.filter((r) => r.host && r.status !== 'empty')).toHaveLength(1);
    expect(drawn.find((r) => r.seat === 0)?.status).toBe('empty');
  }
  expect(await c.evaluate(() => window.__MEXE__.online!.seat())).toBe(2);
  // The new host can actually start: the authority moved, not only the badge.
  await readyAll([c, d]);
  await c.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [c, d]) await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 20_000 });
  evidence.hostTransfer = { from: 0, to: 2 };

  await assertClean([c, d]);
  await closeAll(pages);
});

// ---------- LB-16..LB-20: real matches and real rematches ----------

for (const n of [2, 3, 4]) {
  test(`LB-1${n + 4}/LB-20: a ${n}-player match finishes, scores once, and rematches on the same code`, async ({ browser }) => {
    const pages = await clients(browser, n);
    const names = ['Ana', 'Bruno', 'Caio', 'Dora'];
    const code = await createRoom(pages[0]!, names[0]!);
    for (let i = 1; i < n; i++) await joinRoom(pages[i]!, code, names[i]!, i);
    await waitForSeats(pages, Array.from({ length: n }, (_, i) => i));

    const firstId = await startMatch(pages[0]!, pages);
    await playToFinish(pages);
    await rematchAll(pages);

    // Same room, same code, one win awarded, one history entry — never two.
    for (const p of pages) {
      expect(await p.evaluate(() => window.__MEXE__.online!.code())).toBe(code);
      await p.waitForFunction(
        () => window.__MEXE__.online!.party().matches.length === 1
          && window.__MEXE__.online!.players().reduce((s, x) => s + x.wins, 0) === 1,
        undefined,
        { timeout: 15_000 },
      );
    }
    await waitForSeats(pages, Array.from({ length: n }, (_, i) => i));
    await assertParity(pages, code);
    // No stale rematch vote survived the deal that consumed it.
    expect((await occupiedRows(pages[0]!)).every((r) => r.status === 'waiting')).toBe(true);

    const secondId = await startMatch(pages[0]!, pages);
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(firstId);
    evidence[`rematch${n}p`] = { code, firstId, secondId };

    await assertClean(pages);
    await closeAll(pages);
  });
}

// ---------- LB-19, LB-21..LB-24: endurance and between-match churn ----------

test('LB-19/LB-21/LB-22/LB-23/LB-24 @endurance: three matches across departures, a replacement and a host transfer', async ({ browser }) => {
  // Three full matches, five contexts, a departure chain, a replacement and a host transfer —
  // the heaviest test in the repo, and the budget is headroom over measured work rather than
  // cover for a race. Serial local run after the playToFinish rewrite: 1.0m, against LB-18's
  // 28.2s. This suite runs about 4x slower on a shared runner (4.6m local vs 18.1m on CI), which
  // put the old 300s budget ~20% above the projection — close enough that a slow runner tipped
  // it over, which is exactly what happened.
  //
  // And then it happened again at 420s. Measured: 4.8m (288s) on the last green CI run, against
  // a 420s budget — 31% of headroom for the heaviest test in the repo, on a suite that has since
  // gained LB-47, another multi-context lobby test in this same parallel file. 600s is 2x the
  // measured work. The ratchet itself is the smell: the structural fix is to stop the two
  // heaviest lobby tests from overlapping at all, which is Phase 66/84 ground, not a number.
  test.setTimeout(600_000);
  const pages = await clients(browser, 5);
  const [a, b, c, d, e] = pages as [Page, Page, Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await joinRoom(d, code, 'Dora', 3);
  await waitForSeats([a, b, c, d], [0, 1, 2, 3]);

  const matchIds: string[] = [];
  matchIds.push(await startMatch(a, [a, b, c, d]));
  await playToFinish([a, b, c, d]);
  await rematchAll([a, b, c, d]);
  await waitForSeats([a, b, c, d], [0, 1, 2, 3]);

  // LB-21/LB-22: departures between matches, one at a time, 4 -> 3 -> 2.
  await b.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a, c, d], [0, 2, 3]);
  await c.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a, d], [0, 3]);
  // Seat 3 is still on screen with its name and its session score.
  const seat3 = (await rows(a)).find((r) => r.seat === 3)!;
  expect(seat3.name).toBe('Dora');

  // LB-23: a replacement between matches starts at zero wins with no old player's state.
  await joinRoom(e, code, 'Elis', 1);
  await waitForSeats([a, d, e], [0, 1, 3]);
  expect((await rows(a)).find((r) => r.seat === 1)).toMatchObject({ name: 'Elis', wins: 0, status: 'waiting' });

  // LB-24: the host leaves between matches — authority moves to the next occupied seat.
  await a.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  for (const p of [d, e]) {
    await p.waitForFunction(
      () => window.__MEXE__.online!.lobbySeats!().find((r) => r.host && r.status !== 'empty')?.seat === 1,
      undefined,
      { timeout: 10_000 },
    );
  }
  await waitForSeats([d, e], [1, 3]);
  await assertParity([d, e], code);

  // Match 2 with the survivors, under the new host.
  matchIds.push(await startMatch(e, [e, d]));
  await playToFinish([e, d]);
  await rematchAll([e, d]);
  await waitForSeats([e, d], [1, 3]);

  // LB-26: a between-match reconnect restores the exact seat and the authoritative party state.
  const winsBefore = (await occupiedRows(e)).map((r) => ({ seat: r.seat, wins: r.wins }));
  await d.evaluate(() => window.__MEXE__.online!.forceDrop());
  await e.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 3)?.status === 'offline',
    undefined,
    { timeout: 15_000 },
  );
  await d.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 30_000 });
  await waitForSeats([d, e], [1, 3]);
  expect(await d.evaluate(() => window.__MEXE__.online!.seat())).toBe(3);
  expect((await occupiedRows(e)).map((r) => ({ seat: r.seat, wins: r.wins }))).toEqual(winsBefore);
  expect(await d.evaluate(() => window.__MEXE__.online!.party().matches.length)).toBe(2);

  // Match 3 starts on the same room.
  matchIds.push(await startMatch(e, [e, d]));
  expect(new Set(matchIds).size).toBe(3);
  expect(await e.evaluate(() => window.__MEXE__.online!.code())).toBe(code);
  evidence.endurance = { code, matchIds };
  await shot({ endurance: e }, 'lb-endurance-match3', screenshots);

  await assertClean([d, e]);
  await closeAll(pages);
});

// ---------- LB-47: a match that ends while a seat is offline ----------

test('LB-47: a seat that was offline when the match ended lands in the rematch lobby, not on a dead board', async ({ browser }) => {
  // The endgame is the window this covers: the seat drops, the server draws and passes for it, the
  // other seat's draw empties the pile and ends the match. That client never sees `game_over`, so
  // without a lifecycle path back it sits on a finished board it believes is live — and, being
  // stuck in the match scene, it can never cast the ready bit the room's next match needs.
  test.setTimeout(240_000);
  const pages = await clients(browser, 2);
  const [a, b] = pages as [Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await waitForSeats(pages, [0, 1]);

  // The shortest turn the server allows, a missed-turn limit that will not close the room while
  // the seat is away, and a grace window well past the time it stays away for.
  await a.evaluate(() => window.__MEXE__.online!.setRoomSettings({
    timerMode: 'custom', turnMs: 15_000, mexeBonusMs: 0, warnMs: 5_000, missedTurnLimit: 10, reconnectGraceMs: 300_000,
  }));
  for (const p of pages) {
    await p.waitForFunction(() => window.__MEXE__.online!.roomSettings()?.turnMs === 15_000, undefined, { timeout: 10_000 });
  }

  await startMatch(a, pages);
  // Both clients draw down to the last two cards, then seat 1 loses the network for the finish.
  await playToFinish(pages, 2);
  await b.context().setOffline(true);
  await b.evaluate(() => window.__MEXE__.online!.forceDrop());
  await a.waitForFunction(() => window.__MEXE__.online!.notice().length > 0, undefined, { timeout: 20_000 });

  // Seat 0 finishes it alone: its own draws, plus the server's draw-and-pass for the absent seat.
  await playToFinish([a]);
  await a.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 30_000 });

  // Seat 1 comes back inside its grace window to a room that is already a lobby again.
  await b.context().setOffline(false);
  await b.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 60_000 });
  await b.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 30_000 });
  expect(await b.evaluate(() => window.__MEXE__.online!.code())).toBe(code);
  // ...and it can actually cast the vote the room's next match needs.
  await waitForSeats([b], [0, 1]);
  await b.evaluate(() => window.__MEXE__.online!.setReady(true));
  await b.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 1)?.status === 'ready',
    undefined,
    { timeout: 10_000 },
  );
  evidence.offlineFinish = { code, seats: (await occupiedRows(b)).map((r) => ({ seat: r.seat, status: r.status })) };

  await assertClean(pages);
  await closeAll(pages);
});

// ---------- LB-25..LB-29: reconnect, reload, stale sockets, room isolation ----------

test('LB-25/LB-10/LB-27: a reload in the lobby restores the exact seat and the server\'s ready bit', async ({ browser }) => {
  const pages = await clients(browser, 3);
  const [a, b, c] = pages as [Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await waitForSeats(pages, [0, 1, 2]);

  // Seat 2 is ready when it reloads; seat 1 is not.
  await c.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 2)?.status === 'ready',
    undefined,
    { timeout: 10_000 },
  );

  for (const [page, seat, ready] of [[c, 2, true], [b, 1, false]] as [Page, number, boolean][]) {
    await page.reload();
    await page.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
    const [ox, oy] = toScreen(240, 254);
    await page.mouse.click(ox, oy);
    await page.waitForFunction((s) => window.__MEXE__.online?.seat() === s, seat, { timeout: 20_000 });
    await page.waitForFunction(
      (want) => {
        const me = window.__MEXE__.online!.seat();
        const row = window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === me);
        return !!row && (row.status === 'ready') === want;
      },
      ready,
      { timeout: 15_000 },
    );
  }

  // No duplicate player, no duplicate seat, everyone agrees.
  await waitForSeats(pages, [0, 1, 2]);
  await assertParity(pages, code);
  for (const p of pages) await assertYouBadge(p);
  evidence.reload = { seats: (await occupiedRows(a)).map((r) => r.seat) };

  await assertClean(pages);
  await closeAll(pages);
});

test('LB-28 @race: a second tab holding the same token takes the seat and the old socket loses authority', async ({ browser }) => {
  const pages = await clients(browser, 2);
  const [a, b] = pages as [Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await waitForSeats(pages, [0, 1]);

  const token = await b.evaluate(() => sessionStorage.getItem('mexe.online.token'));
  expect(token).toBeTruthy();

  const tab2 = await b.context().newPage();
  await tab2.goto(`/?ws=${encodeURIComponent(server.url)}&showcase=menu`);
  await tab2.evaluate((t) => sessionStorage.setItem('mexe.online.token', t as string), token);
  await tab2.reload();
  await tab2.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 20_000 });
  const [ox, oy] = toScreen(240, 254);
  await tab2.mouse.click(ox, oy);
  await tab2.waitForFunction(() => window.__MEXE__.online?.seat() === 1, undefined, { timeout: 20_000 });

  // Exactly one seat 1, from the host's point of view: the seat was taken over, not duplicated.
  await waitForSeats([a, tab2], [0, 1]);
  const drawn = await rows(a);
  expect(drawn.filter((r) => r.seat === 1 && r.status !== 'empty')).toHaveLength(1);
  expect(drawn.find((r) => r.seat === 1)?.name).toBe('Bruno');

  // The evicted socket cannot mutate the room any more.
  await b.evaluate(() => window.__MEXE__.online?.setReady(true));
  await a.waitForTimeout(700);
  expect((await rows(a)).find((r) => r.seat === 1)?.status).not.toBe('ready');
  // …while the tab that owns the seat can. This is also what proves the evicted tab stopped
  // trying: its bounded reconnect loop holds the same token, and if it were still retrying it
  // would take the seat back and the ready bit would flap instead of settling.
  await tab2.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 1)?.status === 'ready',
    undefined,
    { timeout: 10_000 },
  );
  await a.waitForTimeout(2500);
  expect((await rows(a)).find((r) => r.seat === 1)?.status).toBe('ready');
  expect(await tab2.evaluate(() => window.__MEXE__.online!.seat())).toBe(1);

  expect(await a.evaluate(() => window.__MEXE__.errors)).toEqual([]);
  expect(server.stderr.filter((l) => l.trim().length > 0)).toEqual([]);
  await closeAll(pages);
});

test('LB-29: switching rooms leaves the old one behind entirely', async ({ browser }) => {
  const pages = await clients(browser, 3);
  const [a, b, c] = pages as [Page, Page, Page];
  const roomA = await createRoom(a, 'Ana');
  await joinRoom(b, roomA, 'Bruno', 1);
  await waitForSeats([a, b], [0, 1]);

  // Bruno walks out of room A, back to the menu, and into room B.
  await b.evaluate(() => window.__MEXE__.online!.leaveRoom!());
  await waitForSeats([a], [0]);
  const roomB = await createRoom(c, 'Caio');
  await reenterOnline(b);
  await joinRoom(b, roomB, 'Bruno', 1);
  await waitForSeats([b, c], [0, 1]);
  expect(await b.evaluate(() => window.__MEXE__.online!.code())).toBe(roomB);
  expect((await occupiedRows(b)).map((r) => r.name)).toEqual(['Caio', 'Bruno']);

  // Room A keeps churning and none of it reaches the client that left.
  await a.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForTimeout(700);
  expect(await b.evaluate(() => window.__MEXE__.online!.code())).toBe(roomB);
  expect((await occupiedRows(b)).map((r) => r.name)).toEqual(['Caio', 'Bruno']);
  expect(roomA).not.toBe(roomB);

  await assertClean([a, b, c]);
  await closeAll(pages);
});

// ---------- LB-46: the lobby's vertical flow, at both text scales and on both worlds ----------

interface LobbyBoxRow { id: string; top: number; h: number }

/** The blocks the lobby painted, top to bottom. */
const boxes = (p: Page): Promise<LobbyBoxRow[]> =>
  p.evaluate(() => (window.__MEXE__.online!.lobbyBoxes!() as LobbyBoxRow[]).slice().sort((a, b) => a.top - b.top));

/**
 * LB-46 — every lobby block fits the world and no block lands on the one below it.
 *
 * The lobby used to be pinned to fixed y-coordinates (seats at `vy(132 + seat * 13)`, the notice
 * at `vy(180)`, reactions at `vy(194)`), which only held at one text scale in one locale: a
 * wrapped room summary or a longer hint pushed a block straight into the next one, and the fix of
 * the day was to hide something. It is a flow now, so this asserts the property that replaces
 * those coordinates — and it runs on every engine this file runs on, because "does it overlap"
 * depends on the engine's own text metrics, which is exactly what a Chromium-only pass cannot
 * answer.
 */
const LOBBY_VIEWPORTS = [
  { name: 'portrait', viewport: { width: 390, height: 844 }, query: '' },
  { name: 'portrait-large-text', viewport: { width: 390, height: 844 }, query: '&textscale=125' },
  { name: 'narrow-large-text', viewport: { width: 360, height: 800 }, query: '&textscale=125' },
  // en-US strings are the longer of the two locales on this screen ("waiting for players" vs
  // "esperando"), so the English run is the representative long-locale case.
  { name: 'landscape-large-text-en', viewport: { width: 844, height: 390 }, query: '&textscale=125&lang=en' },
];

for (const c of LOBBY_VIEWPORTS) {
  test(`LB-46 ${c.name}: every lobby block fits the world and nothing overlaps`, async ({ browser }) => {
    const host = await newPhoneClient(browser, server.url, c.viewport, c.query);
    const guest = await newPhoneClient(browser, server.url, c.viewport, c.query);
    const code = await createRoom(host, 'Anfitriã');
    await joinRoom(guest, code, 'Convidado', 1);
    await waitForSeats([host, guest], [0, 1]);
    // The host's screen is the busiest one: it carries the terms line, its tap hint, AJUSTAR, and
    // the START button with its "who are we waiting for" reason under it.
    const world = await host.evaluate(() => window.__MEXE__.viewport());
    const painted = await boxes(host);

    expect(painted.length).toBeGreaterThan(5); // code, actions, summary, seats, reactions, ready…
    for (const b of painted) {
      expect(b.h, `${b.id} has no height`).toBeGreaterThan(0);
      expect(b.top, `${b.id} starts above the world`).toBeGreaterThanOrEqual(0);
      expect(b.top + b.h, `${b.id} runs past the bottom of the ${world.w}x${world.h} world`)
        .toBeLessThanOrEqual(world.h);
    }
    for (let i = 1; i < painted.length; i++) {
      const above = painted[i - 1]!;
      const below = painted[i]!;
      // 1 unit of slack for sub-unit rounding between a measured text height and a button box.
      expect(above.top + above.h, `${above.id} overlaps ${below.id}`).toBeLessThanOrEqual(below.top + 1);
    }
    // The hint the layout used to drop when it ran out of room is still on screen.
    expect(painted.map((b) => b.id)).toContain('summary');

    await shot({ [`lobby-flow-${c.name}`]: host }, `lobby-flow-${c.name}`, screenshots);
    await assertClean([host, guest]);
    await closeAll([host, guest]);
  });
}
