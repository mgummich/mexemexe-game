/**
 * Integration tests for `server/index.ts` — the message wiring, the caps and the socket/seat
 * ownership paths that `rooms.test.ts` and `connections.test.ts` cannot reach because
 * `server/index.ts` starts a real server at import time.
 *
 * Raw `ws` clients against the real process, not Playwright: a hostile or malformed frame is
 * exactly what a browser client can never send, and spawning the server is ~1s versus a browser
 * context per client. Phase 18.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../../src/net/protocol';
import { allSeatsReady, Client, health, quiescedHealth, startServer, stopServer, type Server } from './harness';

describe('server/index.ts protocol and ownership (Phase 18)', () => {
  const PORT = 8795;
  let server: Server;

  beforeAll(async () => {
    server = await startServer(PORT, { MEXE_TEST_SEED: '2' });
  }, 30_000);

  afterAll(() => {
    stopServer(server);
  });

  it('OH-01/OH-02: malformed, unknown, wrong-version and wrong-type frames are rejected without crashing the server', async () => {
    const c = await Client.open(PORT);
    const frames = [
      '{not json',
      '[]',
      '"a string"',
      JSON.stringify({ v: 1, type: 'ping', reqId: 'r1' }), // wrong protocol version
      JSON.stringify({ v: PROTOCOL_VERSION, reqId: 'r1' }), // missing type
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' }), // missing reqId
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'nope', reqId: 'r1' }), // unknown type
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'ready', reqId: 'r1', ready: 'yes' }), // wrong field type
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'submit_turn', reqId: 'r1', rev: -1, melds: [] }), // bad rev
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'submit_turn', reqId: 'r1', rev: 1, melds: [{ id: 'm', cardIds: [42] }] }),
    ];
    for (const f of frames) c.sendRaw(f);
    await c.next('error');
    const errors = c.received.filter((m) => m.type === 'error');
    expect(errors.length).toBe(frames.length);
    for (const e of errors) expect(e.type === 'error' && e.code).toBe('bad_message');
    // Still serving: the socket is alive and the process answers /health.
    expect(c.closeCode).toBeNull();
    expect((await health(PORT)).ok).toBe(true);
    c.close();
  });

  it('OH-03: an oversized frame closes that socket and leaves the server serving', async () => {
    const c = await Client.open(PORT);
    // MAX_PAYLOAD_BYTES is 16 KiB — `ws` closes the connection itself with 1009 (too large).
    c.sendRaw(JSON.stringify({ v: PROTOCOL_VERSION, type: 'create_room', reqId: 'r1', name: 'x'.repeat(20_000) }));
    expect(await c.closed()).toBe(1009);
    expect((await health(PORT)).ok).toBe(true);
  });

  it('OH-32: an unsolicited in-match message from a socket with no room is rejected, not applied', async () => {
    const c = await Client.open(PORT);
    for (const type of ['ready', 'start_game', 'submit_turn', 'draw_end_turn', 'resync', 'leave_room']) {
      c.clear();
      c.send(type === 'ready' ? { type, ready: true } : type === 'submit_turn' ? { type, rev: 0, melds: [] } : type === 'draw_end_turn' ? { type, rev: 0 } : { type });
      if (type === 'leave_room') continue; // leave_room with no room is a silent no-op by design
      const err = await c.next('error');
      expect(err.type === 'error' && err.code).toBe('no_room');
    }
    c.close();
  });

  it('OH-11: reconnecting to another room releases the seat the socket was holding (no stuck room)', async () => {
    // Room 1: created then abandoned, so its token is live but its seat is disconnected.
    const host1 = await Client.open(PORT);
    host1.send({ type: 'create_room', name: 'Ana' });
    const joined1 = await host1.next('room_joined');
    const token1 = joined1.type === 'room_joined' ? joined1.token : '';
    host1.close();

    // Room 2: a real two-seat match in progress.
    const hopper = await Client.open(PORT);
    hopper.send({ type: 'create_room', name: 'Bia' });
    const joined2 = await hopper.next('room_joined');
    const code2 = joined2.type === 'room_joined' ? joined2.code : '';
    const victim = await Client.open(PORT);
    victim.send({ type: 'join_room', code: code2, name: 'Cau' });
    await victim.next('room_joined');
    hopper.send({ type: 'ready', ready: true });
    victim.send({ type: 'ready', ready: true });
    await allSeatsReady(victim);
    hopper.send({ type: 'start_game' });
    await victim.next('game_started');

    // The hop: the socket holding room 2's seat 0 reconnects into room 1 instead.
    victim.clear();
    hopper.send({ type: 'reconnect', token: token1 });
    await hopper.next('room_joined');

    // Regression (Phase 18 finding 1): room 2's seat 0 must now read as disconnected. Before the
    // fix it stayed `connected` with no socket attached, which made the room invisible to the
    // stalled-turn advance, the sweep and the idle backstop — stuck forever.
    const disc = await victim.next('player_disconnected');
    expect(disc.type === 'player_disconnected' && disc.seat).toBe(0);
    const state = await victim.next('room_state');
    const seat0 = state.type === 'room_state' ? state.players.find((p) => p.seat === 0) : undefined;
    expect(seat0?.connected).toBe(false);

    hopper.close();
    victim.close();
  }, 20_000);

  it('OH-24: a room the hopper left behind does not receive its broadcasts any more', async () => {
    const host = await Client.open(PORT);
    host.send({ type: 'create_room', name: 'Dani' });
    const joined = await host.next('room_joined');
    const code = joined.type === 'room_joined' ? joined.code : '';
    const token = joined.type === 'room_joined' ? joined.token : '';

    // A second socket joins, then reconnects onto the host's own seat — evicting the host socket.
    const other = await Client.open(PORT);
    other.send({ type: 'join_room', code, name: 'Edu' });
    await other.next('room_joined');
    host.clear();
    other.send({ type: 'reconnect', token });
    await other.next('room_joined');
    // S4: exactly one socket may act for a seat, so the previous holder is closed outright —
    // but it is told `invalid_token` first. That code is the client's signal to drop its own
    // token and stop retrying (src/net/client.ts); without it the evicted tab would spend its
    // whole reconnect budget trying to take the seat back from the socket that now holds it.
    const evicted = await host.next('error');
    expect(evicted.type === 'error' && evicted.code).toBe('invalid_token');
    expect(await host.closed()).not.toBeNull();
    // And nothing in the room reaches it afterwards.
    host.clear();
    other.send({ type: 'ready', ready: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(host.received).toEqual([]);
    other.close();
  }, 20_000);

  it('OH-06/OH-07: guessing room codes closes the connection after the failed-lookup ceiling', async () => {
    const c = await Client.open(PORT);
    for (let i = 0; i < 12; i++) c.send({ type: 'join_room', code: `ZZZZ${i}`, name: 'probe' });
    expect(await c.closed()).toBe(1008);
    expect((await health(PORT)).ok).toBe(true);
  });

  it('OH-08: flooding the socket closes it with a policy code rather than exhausting the process', async () => {
    const c = await Client.open(PORT);
    for (let i = 0; i < 60; i++) c.send({ type: 'ping' });
    expect(await c.closed()).toBe(1008);
    const err = c.received.find((m) => m.type === 'error' && m.code === 'rate_limited');
    expect(err).toBeDefined();
    expect((await health(PORT)).ok).toBe(true);
  });

  it('OH-26: an opponent hand never appears in any frame a non-owner receives', async () => {
    const host = await Client.open(PORT);
    host.send({ type: 'create_room', name: 'Fe' });
    const joined = await host.next('room_joined');
    const code = joined.type === 'room_joined' ? joined.code : '';
    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code, name: 'Gui' });
    await guest.next('room_joined');
    host.send({ type: 'ready', ready: true });
    guest.send({ type: 'ready', ready: true });
    await allSeatsReady(guest);
    host.send({ type: 'start_game' });
    const hostStart = await host.next('game_started');
    const guestStart = await guest.next('game_started');

    const hostHand = hostStart.type === 'game_started' ? (hostStart.view.players[0]?.hand ?? []) : [];
    expect(hostHand.length).toBe(7);
    const guestView = guestStart.type === 'game_started' ? guestStart.view : null;
    // The guest's own seat has cards; every other seat is a count only.
    expect(guestView?.players.filter((p) => p.hand !== undefined).map((p) => p.seat)).toEqual([1]);
    // And no host card id appears anywhere in the guest's raw frame.
    const guestRaw = JSON.stringify(guestStart);
    for (const card of hostHand) expect(guestRaw).not.toContain(card.id);
    // The shuffle seed never crosses the wire either — it would reproduce every hand.
    expect(guestRaw).not.toContain('"seed"');

    host.close();
    guest.close();
  }, 20_000);

  it('OH-34: room and connection counts return to their baseline once every socket closes', async () => {
    // Sockets closed by earlier tests may still be draining, so settle first — otherwise the
    // baseline is a moving number and the comparison below is meaningless.
    const before = await quiescedHealth(PORT);
    const c = await Client.open(PORT);
    c.send({ type: 'create_room', name: 'Hel' });
    await c.next('room_joined');
    c.send({ type: 'leave_room' });
    await new Promise((r) => setTimeout(r, 200));
    c.close();
    const after = await quiescedHealth(PORT);
    expect(after.rooms).toBe(before.rooms);
    expect(after.connections).toBe(before.connections);
  }, 20_000);

  it('OH-25/OH-26: logs no room code, player name or card id on a normal session', async () => {
    // Earlier tests in this file deliberately trip socket errors, so only the lines this session
    // adds are under test here.
    const stderrBefore = server.stderr.length;
    const c = await Client.open(PORT);
    c.send({ type: 'create_room', name: 'SecretName' });
    const joined = await c.next('room_joined');
    const code = joined.type === 'room_joined' ? joined.code : '';
    c.close();
    await new Promise((r) => setTimeout(r, 200));
    const logged = server.stderr.slice(stderrBefore).join('');
    expect(logged).not.toContain('SecretName');
    expect(logged).not.toContain(code);
    // A clean session must not write to stderr at all (the verify:multiplayer gate asserts this too).
    expect(logged.trim()).toBe('');
  });
});

describe('server/index.ts connection caps (Phase 18)', () => {
  const PORT = 8796;
  let server: Server;

  beforeAll(async () => {
    server = await startServer(PORT, { MEXE_MAX_CONNECTIONS: '2' });
  }, 30_000);

  afterAll(() => {
    stopServer(server);
  });

  it('rejects a connection over the global cap with 1013 and keeps serving the accepted ones', async () => {
    const a = await Client.open(PORT);
    const b = await Client.open(PORT);
    const c = await Client.open(PORT);
    expect(await c.closed()).toBe(1013);
    // The two accepted connections still work normally.
    a.send({ type: 'ping' });
    await a.next('pong');
    expect((await health(PORT)).ok).toBe(true);
    a.close();
    b.close();
  }, 20_000);
});

// Fake secrets: if any of these ever turns up in a log line, a metric or /health, the redaction
// they are standing in for has stopped working.
const CANARY_NAME = 'SECRET_PLAYER_NAME_123';
const CANARY_TOKEN_MARKER = 'SECRET_RECONNECT_TOKEN_789';
const METRICS_TOKEN = 'metrics-token-for-tests-0123456789';

function metrics(port: number, token: string | null = METRICS_TOKEN): Promise<Response> {
  return fetch(`http://localhost:${port}/metrics`, token === null ? {} : { headers: { authorization: `Bearer ${token}` } });
}

describe('server observability is privacy-safe (/metrics, /health, logs)', () => {
  const PORT = 8797;
  let server: Server;

  beforeAll(async () => {
    // Production mode with debug logging on — the noisiest configuration that can ship, so the
    // canary assertions below cover every line a real deployment could emit.
    server = await startServer(PORT, { MEXE_ENV: 'production', LOG_LEVEL: 'debug', MEXE_METRICS_TOKEN: METRICS_TOKEN, MEXE_ALLOWED_ORIGINS: '*' });
  }, 30_000);

  afterAll(() => {
    stopServer(server);
  });

  it('/metrics exposes the aggregate counters and gauges in Prometheus text format', async () => {
    const res = await metrics(PORT);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    for (const name of [
      'mexemexe_connections_current',
      'mexemexe_rooms_current',
      'mexemexe_connections_total',
      'mexemexe_connections_rejected_total',
      'mexemexe_rooms_created_total',
      'mexemexe_games_started_total',
      'mexemexe_games_finished_total',
      'mexemexe_reconnects_total',
      'mexemexe_disconnects_total',
      'mexemexe_message_handler_errors_total',
      'mexemexe_socket_errors_total',
      'mexemexe_uptime_seconds',
      'mexemexe_heap_used_bytes',
      'mexemexe_connections_capacity_ratio',
      'mexemexe_rooms_capacity_ratio',
    ]) {
      expect(body).toContain(`# TYPE ${name} `);
    }
  });

  it('/metrics counts real activity without ever labelling it by player or room', async () => {
    const host = await Client.open(PORT);
    host.send({ type: 'create_room', name: CANARY_NAME });
    const joined = await host.next('room_joined');
    const code = joined.type === 'room_joined' ? joined.code : '';
    const token = joined.type === 'room_joined' ? joined.token : '';

    const guest = await Client.open(PORT);
    guest.send({ type: 'join_room', code, name: CANARY_NAME });
    await guest.next('room_joined');

    const body = await (await metrics(PORT)).text();
    expect(body).toContain('mexemexe_rooms_created_total 1');
    expect(body).toContain('mexemexe_connections_current 2');
    expect(body).toContain('mexemexe_rooms_current 1');

    // Nothing player- or room-derived may appear, as a value or as a label.
    expect(body).not.toContain(CANARY_NAME);
    expect(body).not.toContain(code);
    expect(body).not.toContain(token);
    // The only label in the whole exposition is the fixed-set rejection reason.
    const labels = [...body.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
    for (const label of labels) expect(label).toMatch(/^reason="(global_cap|ip_cap|origin)"$/);

    host.close();
    guest.close();
  }, 20_000);

  it('/health stays a fixed set of aggregate fields', async () => {
    const body = (await (await fetch(`http://localhost:${PORT}/health`)).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['connections', 'ok', 'protocol', 'queued', 'rooms', 'uptimeSec']);
    for (const value of Object.values(body)) expect(typeof value === 'number' || typeof value === 'boolean').toBe(true);
  });

  it('refuses /metrics without the right bearer token, and says nothing by refusing', async () => {
    // 404 rather than 401: an unauthenticated caller learns nothing about whether it exists.
    expect((await metrics(PORT, null)).status).toBe(404);
    expect((await metrics(PORT, 'wrong-token-of-the-same-len')).status).toBe(404);
    expect((await metrics(PORT, `${METRICS_TOKEN}x`)).status).toBe(404);
    expect((await metrics(PORT)).status).toBe(200);
  });

  it('404s every other path rather than exposing anything else', async () => {
    for (const path of ['/', '/debug', '/config', '/rooms']) {
      expect((await fetch(`http://localhost:${PORT}${path}`)).status).toBe(404);
    }
  });

  it('OH-25: no canary — name, room code or reconnect token — reaches stdout or stderr', async () => {
    const c = await Client.open(PORT);
    c.send({ type: 'create_room', name: CANARY_NAME });
    const joined = await c.next('room_joined');
    const code = joined.type === 'room_joined' ? joined.code : '';
    const token = joined.type === 'room_joined' ? joined.token : '';
    // Drive the paths that log: a failed join, a flood close, a reconnect, a malformed frame.
    c.sendRaw('{not json');
    c.send({ type: 'join_room', code: 'ZZZZ', name: CANARY_NAME });
    const other = await Client.open(PORT);
    other.send({ type: 'reconnect', token: CANARY_TOKEN_MARKER });
    c.close();
    other.close();
    await new Promise((r) => setTimeout(r, 300));

    const logged = [...server.stdout, ...server.stderr].join('');
    expect(logged).not.toContain(CANARY_NAME);
    expect(logged).not.toContain(CANARY_TOKEN_MARKER);
    expect(logged).not.toContain(code);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('127.0.0.1');
    expect(logged).not.toContain('::1');
  }, 20_000);

  it('an exception in the message handler is logged as a type, never as its text', async () => {
    // Nothing here should throw today; the assertion is about the shape of the line if it ever
    // does — an errorType field and no free-form message.
    const lines = [...server.stdout, ...server.stderr]
      .join('')
      .split('\n')
      .filter((l) => l.trim().startsWith('{'))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toHaveProperty('stack');
      if ('message' in line) expect(line.message).toBe('[redacted]');
    }
  });
});

describe('/metrics is closed by default in production', () => {
  const PORT = 8798;
  let server: Server;

  beforeAll(async () => {
    // Production, no MEXE_METRICS_TOKEN — the shape a careless deployment actually has.
    server = await startServer(PORT, { MEXE_ENV: 'production', MEXE_ALLOWED_ORIGINS: '*' });
  }, 30_000);

  afterAll(() => {
    stopServer(server);
  });

  it('does not expose /metrics at all when no token is configured', async () => {
    expect((await fetch(`http://localhost:${PORT}/metrics`)).status).toBe(404);
    expect((await fetch(`http://localhost:${PORT}/metrics`, { headers: { authorization: 'Bearer anything' } })).status).toBe(404);
    // /health stays open — load balancers and the Docker healthcheck depend on it.
    expect((await fetch(`http://localhost:${PORT}/health`)).status).toBe(200);
  });
});
