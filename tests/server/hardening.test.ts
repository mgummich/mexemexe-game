/**
 * Online Phase 4 — hardening acceptance (OH-*). Everything here drives the real server process
 * over raw `ws`, because the behaviour under test is what a *non*-browser client does: abusive
 * rates, hostile frames, many rooms at once, and the cleanup that has to follow.
 *
 * The protocol/privacy/cap half of the phase already has coverage in
 * `index.integration.test.ts` (malformed and oversized frames, code guessing, the flood close,
 * the connection cap, hand privacy, secret-free logs, baseline resource counts); this file adds
 * the bounds and the isolation guarantees that suite does not reach.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { Client, health, quiescedHealth, startServer, stopServer, type Server } from './harness';

/** Create a room and return its code plus the session token, from a fresh socket. */
async function createRoom(port: number, name: string): Promise<{ client: Client; code: string; token: string }> {
  const client = await Client.open(port);
  client.send({ type: 'create_room', name });
  const joined = await client.next('room_joined');
  return { client, code: joined.code, token: joined.token };
}

/** Two seats in one room, both ready, match started. Returns both clients and the room code. */
async function startedMatch(port: number, tag: string): Promise<{ host: Client; guest: Client; code: string }> {
  const { client: host, code } = await createRoom(port, `H${tag}`);
  const guest = await Client.open(port);
  guest.send({ type: 'join_room', code, name: `G${tag}` });
  await guest.next('room_joined');
  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  await host.until(
    (msgs) => msgs.some((m) => m.type === 'room_state' && m.players.length === 2 && m.players.every((p) => p.ready)),
    'both seats ready',
  );
  host.send({ type: 'start_game' });
  await host.next('game_started');
  await guest.next('game_started');
  return { host, guest, code };
}

describe('OH room-creation spam is bounded per source', () => {
  // Its own process: the budget is per source address, and every client in this file shares one,
  // so a suite that exhausts it would change the meaning of every test that ran after it.
  const PORT = 8802;
  let server: Server;

  beforeAll(async () => {
    server = await startServer(PORT, { MEXE_TEST_SEED: '4' });
  }, 30_000);

  afterAll(() => stopServer(server));

  it('OH-05: a create-and-drop loop is refused with friendly copy while the server keeps serving', async () => {
    // Dropping the socket instead of leaving is the abusive shape: the room survives the
    // disconnect grace, so nothing is reclaimed between iterations.
    let refusedAt = -1;
    for (let i = 0; i < 25 && refusedAt === -1; i++) {
      const c = await Client.open(PORT);
      c.send({ type: 'create_room', name: `spam${i}` });
      await c.until((msgs) => msgs.some((m) => m.type === 'room_joined' || m.type === 'error'), 'a create answer');
      const err = c.received.find((m) => m.type === 'error');
      if (err?.type === 'error') {
        expect(err.code).toBe('room_create_limit');
        // Never the raw limiter vocabulary — the client maps the code to localized copy.
        expect(err.message).not.toMatch(/token bucket|429|payload/i);
        refusedAt = i;
      }
      c.close();
    }
    expect(refusedAt).toBeGreaterThan(0);
    // The ceiling is an abuse control, not a per-player cap: a real group never gets near it.
    expect(refusedAt).toBeGreaterThanOrEqual(20);
    expect((await health(PORT)).ok).toBe(true);
  }, 30_000);
});

describe('OH Origin policy', () => {
  const PORT = 8803;
  let server: Server;

  function open(origin: string | undefined): Promise<WebSocket> {
    const ws = new WebSocket(`ws://localhost:${PORT}`, origin === undefined ? {} : { origin });
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  beforeAll(async () => {
    server = await startServer(PORT, {
      MEXE_TEST_SEED: '5',
      MEXE_ALLOWED_ORIGINS: 'https://mexe.example, http://localhost:5173',
    });
  }, 30_000);

  afterAll(() => stopServer(server));

  it('OH-30: a configured production or development origin is accepted', async () => {
    const prod = await open('https://mexe.example');
    prod.close();
    const dev = await open('http://localhost:5173');
    dev.close();
    // A non-browser client sends no Origin at all and must still be able to connect.
    const none = await open(undefined);
    none.close();
  });

  it('OH-29: an unexpected browser origin is refused at the upgrade, before any socket exists', async () => {
    await expect(open('https://evil.example')).rejects.toThrow(/401/);
    expect((await health(PORT)).ok).toBe(true);
  });
});

describe('OH isolation, bounds and lifecycle', () => {
  const PORT = 8804;
  let server: Server;

  beforeAll(async () => {
    // Room creation is per-source-budgeted and every client here shares one address, so this
    // process gets headroom for the concurrent-room load test below.
    server = await startServer(PORT, { MEXE_TEST_SEED: '6', MEXE_MAX_CONNECTIONS_PER_IP: '400', MEXE_MAX_ROOM_CREATES_PER_IP: '200' });
  }, 30_000);

  afterAll(() => stopServer(server));

  it('OH-31: full-state resync is bounded without closing the connection', async () => {
    const { client } = await createRoom(PORT, 'Rita');
    client.clear();
    for (let i = 0; i < 12; i++) client.send({ type: 'resync' });
    await new Promise((r) => setTimeout(r, 400));
    const snapshots = client.received.filter((m) => m.type === 'room_state').length;
    expect(snapshots).toBeGreaterThan(0);
    expect(snapshots).toBeLessThanOrEqual(5);
    // Throttling a snapshot loop must not disconnect the player or break the next real action.
    client.clear();
    client.send({ type: 'ready', ready: true });
    await client.next('room_state');
    client.send({ type: 'leave_room' });
    client.close();
  }, 20_000);

  it('OH-09: a burst of rapid legal actions is answered in full, not throttled', async () => {
    const { client } = await createRoom(PORT, 'Tap');
    client.clear();
    // A player tapping Ready on and off is ordinary UI traffic and must never trip an abuse
    // control — the flood guard exists for loops, not for impatience.
    for (let i = 0; i < 10; i++) client.send({ type: 'ready', ready: i % 2 === 0 });
    await client.until((msgs) => msgs.filter((m) => m.type === 'room_state').length >= 10, 'ten lobby updates');
    expect(client.received.some((m) => m.type === 'error')).toBe(false);
    client.send({ type: 'leave_room' });
    client.close();
  }, 20_000);

  it('OH-32: an invalid gameplay intent is rejected without mutating the room', async () => {
    const { host, guest } = await startedMatch(PORT, 'ok');
    const active = host;
    const first = await active.next('game_started');
    const rev = first.view.rev;

    // Wrong revision: a replay or a stale client. Rejected, and the room is untouched.
    active.clear();
    active.send({ type: 'draw_end_turn', rev: rev + 99 });
    const rejected = await active.next('proposal_rejected');
    expect(rejected.reasons.length).toBeGreaterThan(0);
    expect(active.received.some((m) => m.type === 'state_sync')).toBe(false);

    // The legal move at the real revision still works right after.
    active.clear();
    active.send({ type: 'draw_end_turn', rev });
    const synced = await active.next('state_sync');
    expect(synced.view.rev).toBe(rev + 1);

    host.close();
    guest.close();
  }, 30_000);

  it('OH-10/OH-11: a reconnect burst keeps the seat and leaves exactly one live transport', async () => {
    const { client: first, token } = await createRoom(PORT, 'Mob');
    const seat = (await first.next('room_joined')).seat;
    let current = first;
    // Wi-Fi to cellular and back, a tunnel, a screen lock: several reclaims in a few seconds is
    // normal mobile behaviour and must not be treated as abuse.
    for (let i = 0; i < 4; i++) {
      const next = await Client.open(PORT);
      next.send({ type: 'reconnect', token });
      const joined = await next.next('room_joined');
      expect(joined.seat).toBe(seat);
      // The transport it replaced is closed by the server, not left able to act for the seat.
      expect(await current.closed()).not.toBeNull();
      current = next;
    }
    current.send({ type: 'leave_room' });
    current.close();
  }, 30_000);

  it('OH-21/OH-22/OH-23/OH-33: a malformed client in one room cannot touch or reach another', async () => {
    const a = await startedMatch(PORT, 'A');
    const b = await startedMatch(PORT, 'B');
    expect(a.code).not.toBe(b.code);

    const bRev = (await b.host.next('game_started')).view.rev;
    b.host.clear();
    b.guest.clear();
    // Room A's client goes hostile: garbage frames, unknown types, wrong-typed fields, and a
    // claim on room B's code.
    a.guest.sendRaw('{not json');
    a.guest.send({ type: 'no_such_type' });
    a.guest.send({ type: 'draw_end_turn', rev: 'not-a-number' });
    a.guest.send({ type: 'join_room', code: b.code, name: 'intruder' });
    a.guest.send({ type: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 300));

    // Nothing room A did reached room B — not a state frame, not an error, not a room update.
    expect(b.host.received).toEqual([]);
    expect(b.guest.received).toEqual([]);

    // And room B still plays normally while room A is being abused.
    b.host.send({ type: 'draw_end_turn', rev: bRev });
    const synced = await b.host.next('state_sync');
    expect(synced.view.rev).toBe(bRev + 1);

    a.host.close();
    a.guest.close();
    b.host.close();
    b.guest.close();
  }, 40_000);

  it('OH-20/OH-24: a room that closed cannot be rejoined and sends nothing to its old sockets', async () => {
    const { host, guest, code } = await startedMatch(PORT, 'Z');
    guest.send({ type: 'leave_room' });
    // A match that lost a player ends for the survivor rather than stalling.
    const closed = await host.next('error');
    expect(closed.code).toBe('room_closed');

    host.clear();
    // The code is gone: nothing can resurrect the room by joining it again.
    const late = await Client.open(PORT);
    late.send({ type: 'join_room', code, name: 'late' });
    const err = await late.next('error');
    expect(err.code).toBe('room_not_found');
    // The survivor's detached socket receives nothing further about the dead room.
    await new Promise((r) => setTimeout(r, 200));
    expect(host.received).toEqual([]);

    host.close();
    guest.close();
    late.close();
  }, 30_000);

  it('OH-34/OH-35: a realistic concurrent-room load completes and returns to baseline', async () => {
    const ROOMS = 16;
    const before = await quiescedHealth(PORT);
    const started = Date.now();
    const matches = [];
    for (let i = 0; i < ROOMS; i++) matches.push(await startedMatch(PORT, `L${i}`));
    const elapsed = Date.now() - started;

    // Every room dealt its own match, and no room's revision came from another's traffic.
    const codes = new Set(matches.map((m) => m.code));
    expect(codes.size).toBe(ROOMS);
    expect((await health(PORT)).rooms).toBe(before.rooms + ROOMS);
    // 16 concurrent rooms is the shape this single-process deployment is built for; the bound is
    // generous because it runs beside the rest of the suite, not on an idle machine.
    expect(elapsed).toBeLessThan(30_000);

    // One turn in each room, all in flight together.
    for (const m of matches) {
      const rev = (await m.host.next('game_started')).view.rev;
      m.host.clear();
      m.host.send({ type: 'draw_end_turn', rev });
    }
    for (const m of matches) expect((await m.host.next('state_sync')).view.rev).toBeGreaterThan(0);

    for (const m of matches) {
      m.host.send({ type: 'leave_room' });
      m.host.close();
      m.guest.close();
    }
    const after = await quiescedHealth(PORT);
    expect(after.rooms).toBe(before.rooms);
    expect(after.connections).toBe(before.connections);
  }, 90_000);
});
