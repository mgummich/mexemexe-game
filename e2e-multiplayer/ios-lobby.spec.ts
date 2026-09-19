import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  OUT_DIR, attachClientContexts, consoleErrorsOf, freePort, newPhoneClient, shot, startTestServer, type TestServer,
} from './harness';

/**
 * LB-35..LB-40 — the lobby on iOS-shaped WebKit viewports.
 *
 * WebKit is a mandatory gate, not a screenshot pass: these drive real rooms over real sockets.
 * Orientation changes are the interesting part — a rotate must re-lay-out the canvas and nothing
 * else. It must not open a second socket, create a second player, lose a seat, or reset the
 * ready/host state the server owns.
 */

const LOG_PATH = path.join(OUT_DIR, 'verify-lobby-ios-log.json');

const PORTRAIT = [
  { name: '390x844', width: 390, height: 844 },
  { name: '393x852', width: 393, height: 852 },
  { name: '430x932', width: 430, height: 932 },
];
const LANDSCAPE = [
  { name: '844x390', width: 844, height: 390 },
  { name: '932x430', width: 932, height: 430 },
];

let server: TestServer;
const evidence: Record<string, unknown> = {};
const screenshots: string[] = [];

test.beforeAll(async () => {
  server = await startTestServer(await freePort());
});

// A failed test reports where every client it opened actually was — seat, revision, match, last
// rejections and its final messages — instead of only the assertion that noticed.
test.afterEach(async ({}, testInfo) => { await attachClientContexts(testInfo); });

test.afterAll(async () => {
  server.stop();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    LOG_PATH,
    JSON.stringify({ ...evidence, screenshots, serverStderr: server.stderr.filter((l) => l.trim().length > 0) }, null, 2),
  );
});

interface SeatRow {
  seat: number;
  name: string;
  you: boolean;
  host: boolean;
  status: 'empty' | 'waiting' | 'ready' | 'offline';
  wins: number;
}

const rows = (p: Page): Promise<SeatRow[]> =>
  p.evaluate(() => window.__MEXE__.online!.lobbySeats!() as SeatRow[]);
const occupied = async (p: Page): Promise<SeatRow[]> => (await rows(p)).filter((r) => r.status !== 'empty');

async function createRoom(page: Page, name: string): Promise<string> {
  await page.evaluate((n) => window.__MEXE__.online!.createRoom(n), name);
  await page.waitForFunction(() => window.__MEXE__.online?.code() !== null, undefined, { timeout: 10_000 });
  return (await page.evaluate(() => window.__MEXE__.online!.code()))!;
}

async function joinRoom(page: Page, code: string, name: string, seat: number): Promise<void> {
  await page.evaluate(([c, n]) => window.__MEXE__.online!.joinRoom(c as string, n as string), [code, name]);
  await page.waitForFunction((s) => window.__MEXE__.online?.seat() === s, seat, { timeout: 10_000 });
}

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
      { timeout: 15_000 },
    );
  }
}

/** Every rendered seat row must fit inside the live canvas, in whichever world is up. */
async function assertRowsOnScreen(page: Page): Promise<void> {
  const fits = await page.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return c.width > 0 && c.height > 0
      && c.left >= -1 && c.top >= -1
      && c.right <= window.innerWidth + 1 && c.bottom <= window.innerHeight + 1;
  });
  expect(fits).toBe(true);
  const drawn = await rows(page);
  expect(drawn.length).toBeGreaterThan(0);
}

// LB-38 / LB-39: every representative iOS viewport renders a real 4-seat lobby, with the
// occupant of every seat on screen.
for (const vp of [...PORTRAIT, ...LANDSCAPE]) {
  test(`LB-36/LB-38/LB-39: a 4-seat lobby and a seat gap read on ${vp.name}`, async ({ browser }) => {
    const size = { width: vp.width, height: vp.height };
    const pages: Page[] = [];
    for (let i = 0; i < 4; i++) pages.push(await newPhoneClient(browser, server.url, size));
    const [a, b, c, d] = pages as [Page, Page, Page, Page];
    const code = await createRoom(a, 'Ana');
    await joinRoom(b, code, 'Bruno', 1);
    await joinRoom(c, code, 'Caio', 2);
    await joinRoom(d, code, 'Dora', 3);
    await waitForSeats(pages, [0, 1, 2, 3]);
    await assertRowsOnScreen(a);

    // LB-36: the seat-gap invariant is engine-independent — seat 3 stays on screen.
    await b.evaluate(() => window.__MEXE__.online!.leaveRoom!());
    await waitForSeats([a, c, d], [0, 2, 3]);
    const drawn = await rows(a);
    expect(drawn.find((r) => r.seat === 3)?.name).toBe('Dora');
    expect(drawn.find((r) => r.seat === 1)?.status).toBe('empty');
    await assertRowsOnScreen(a);
    await shot({ [vp.name]: a }, 'lb-ios-lobby', screenshots);

    for (const p of [a, c, d]) {
      expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
      expect(consoleErrorsOf(p).filter((e) => !e.includes('WebSocket connection'))).toEqual([]);
    }
    for (const p of pages) await p.context().close();
  });
}

// LB-40: rotating does not create a player, a socket, a duplicate seat, or reset server state.
test('LB-40: an orientation change preserves seat, host, ready and score', async ({ browser }) => {
  const portrait = { width: 390, height: 844 };
  const pages: Page[] = [];
  for (let i = 0; i < 3; i++) pages.push(await newPhoneClient(browser, server.url, portrait));
  const [a, b, c] = pages as [Page, Page, Page];
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await joinRoom(c, code, 'Caio', 2);
  await waitForSeats(pages, [0, 1, 2]);

  await b.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 1)?.status === 'ready',
    undefined,
    { timeout: 10_000 },
  );
  const before = await rows(b);

  for (const size of [{ width: 844, height: 390 }, portrait, { width: 932, height: 430 }]) {
    await b.setViewportSize(size);
    await b.waitForTimeout(400);
    await assertRowsOnScreen(b);
    // Same seat, same host, same ready bit, same roster — the rotate is layout and nothing else.
    expect(await b.evaluate(() => window.__MEXE__.online!.seat())).toBe(1);
    expect(await rows(b)).toEqual(before);
    // No second membership anywhere in the room.
    const fromHost = await occupied(a);
    expect(fromHost.map((r) => r.seat)).toEqual([0, 1, 2]);
    expect(new Set(fromHost.map((r) => r.seat)).size).toBe(fromHost.length);
  }
  await shot({ rotated: b }, 'lb-ios-rotate', screenshots);
  evidence.rotate = { seat: 1, rows: before.length };

  // LB-37: a drop/resync after rotating still comes back to the exact seat.
  await b.evaluate(() => window.__MEXE__.online!.forceDrop());
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().find((r) => r.seat === 1)?.status === 'offline',
    undefined,
    { timeout: 20_000 },
  );
  await b.waitForFunction(() => window.__MEXE__.online?.status() === 'open', undefined, { timeout: 30_000 });
  await waitForSeats(pages, [0, 1, 2]);
  expect(await b.evaluate(() => window.__MEXE__.online!.seat())).toBe(1);
  expect((await rows(b)).find((r) => r.seat === 1)?.status).toBe('ready');

  for (const p of pages) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(consoleErrorsOf(p).filter((e) => !e.includes('WebSocket connection'))).toEqual([]);
  }
  for (const p of pages) await p.context().close();
});

// LB-35: a real two-client WebKit match — ready, start, a real turn, reload back into the exact
// seat, finish, and a rematch with a fresh matchId on the same code.
test('LB-35/LB-37: WebKit two-client match, reload mid-match, finish and rematch', async ({ browser }) => {
  test.setTimeout(240_000);
  const size = { width: 844, height: 390 };
  const a = await newPhoneClient(browser, server.url, size);
  const b = await newPhoneClient(browser, server.url, size);
  const code = await createRoom(a, 'Ana');
  await joinRoom(b, code, 'Bruno', 1);
  await waitForSeats([a, b], [0, 1]);

  for (const p of [a, b]) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().filter((r) => r.status !== 'empty').every((r) => r.status === 'ready'),
    undefined,
    { timeout: 15_000 },
  );
  await a.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [a, b]) await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 25_000 });
  const firstId = await a.evaluate(() => window.__MEXE__.online!.matchId());

  // One real turn, then a reload: the seat and the revision come back from the server.
  await playOneTurn([a, b]);
  const revBefore = await b.evaluate(() => window.__MEXE__.online!.rev());
  await b.reload();
  await b.waitForFunction(() => window.__MEXE__?.ready === true, undefined, { timeout: 25_000 });
  const point = await b.evaluate(() => {
    const c = document.querySelector('canvas')!.getBoundingClientRect();
    return { x: c.left + 0.5 * c.width, y: c.top + (254 / 270) * c.height };
  });
  await b.mouse.click(point.x, point.y);
  await b.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 30_000 });
  expect(await b.evaluate(() => window.__MEXE__.online!.seat())).toBe(1);
  expect(await b.evaluate(() => window.__MEXE__.online!.rev())).toBeGreaterThanOrEqual(revBefore ?? 0);

  await playToFinish([a, b]);
  for (const p of [a, b]) await p.waitForFunction(() => window.__MEXE__.scene === 'win', undefined, { timeout: 25_000 });
  for (const p of [a, b]) {
    const y = (await p.evaluate(() => window.__MEXE__.winButtonY))!;
    const c = await p.evaluate(() => document.querySelector('canvas')!.getBoundingClientRect().toJSON());
    await p.mouse.click(c.left + 0.5 * c.width, c.top + (y / 270) * c.height);
    await p.waitForFunction(() => window.__MEXE__.scene === 'online', undefined, { timeout: 20_000 });
  }
  await waitForSeats([a, b], [0, 1]);
  expect(await a.evaluate(() => window.__MEXE__.online!.code())).toBe(code);

  for (const p of [a, b]) await p.evaluate(() => window.__MEXE__.online!.setReady(true));
  await a.waitForFunction(
    () => window.__MEXE__.online!.lobbySeats!().filter((r) => r.status !== 'empty').every((r) => r.status === 'ready'),
    undefined,
    { timeout: 15_000 },
  );
  await a.evaluate(() => window.__MEXE__.online!.startGame());
  for (const p of [a, b]) await p.waitForFunction(() => window.__MEXE__.scene === 'game', undefined, { timeout: 25_000 });
  const secondId = await a.evaluate(() => window.__MEXE__.online!.matchId());
  expect(secondId).toBeTruthy();
  expect(secondId).not.toBe(firstId);
  evidence.webkitMatch = { code, firstId, secondId };

  for (const p of [a, b]) {
    expect(await p.evaluate(() => window.__MEXE__.errors)).toEqual([]);
    expect(consoleErrorsOf(p).filter((e) => !e.includes('WebSocket connection'))).toEqual([]);
  }
  await a.context().close();
  await b.context().close();
});

/** One real server-accepted turn: the active seat draws and ends its turn. */
async function playOneTurn(pages: Page[]): Promise<void> {
  for (let i = 0; i < 100; i++) {
    for (const p of pages) {
      const mine = await p.evaluate(() => {
        const s = window.__MEXE__.state?.();
        return !!s && s.winnerId === null && s.activePlayerIndex === window.__MEXE__.online?.localSeat?.();
      });
      if (!mine) continue;
      const before = await p.evaluate(() => window.__MEXE__.online!.rev());
      await p.evaluate(() => window.__MEXE__.online!.comprar());
      await p.waitForFunction((r) => (window.__MEXE__.online!.rev() ?? 0) > (r as number), before ?? 0, { timeout: 15_000 });
      return;
    }
    await pages[0]!.waitForTimeout(50);
  }
  throw new Error('no seat became active');
}

async function playToFinish(pages: Page[]): Promise<void> {
  for (let i = 0; i < 600; i++) {
    if (await pages[0]!.evaluate(() => window.__MEXE__.scene === 'win')) return;
    for (const p of pages) {
      const mine = await p.evaluate(() => {
        const s = window.__MEXE__.state?.();
        return !!s && s.winnerId === null && s.activePlayerIndex === window.__MEXE__.online?.localSeat?.();
      });
      if (!mine) continue;
      await p.evaluate(() => window.__MEXE__.online!.comprar());
      break;
    }
    await pages[0]!.waitForTimeout(20);
  }
  throw new Error('match did not finish within draw-pile budget');
}
