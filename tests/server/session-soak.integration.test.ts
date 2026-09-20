/**
 * Multiplayer session soak (Phase 66): the same room lifecycle, over and over, against the real
 * server process.
 *
 * `lobby-soak.test.ts` walks the RoomManager directly and proves the room invariants hold in any
 * ordering. This one is the layer above it — sockets, seats, connection bookkeeping and the
 * process itself — because the drift a long session produces (a socket map that never empties, a
 * room that outlives its players, a counter that double-counts a rematch) lives in
 * `server/index.ts`, which the manager-level soak never touches.
 *
 * Each cycle is a full life: create, join, play a match to its end, rematch in the same room,
 * lose and reclaim a seat mid-match, then leave. Between cycles the server must be back where it
 * started: no rooms, no connections. What is asserted is drift, not throughput — this is not a
 * load test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GameView } from '../../src/net/protocol';
import { allSeatsReady, Client, quiescedHealth, startServer, stopServer, type Server } from './harness';

const PORT = 8794;
const METRICS_TOKEN = 'soak-token-0123456789';

/** Repeats, not duration: a cycle is two full matches, and a per-cycle leak in the socket/seat
 * bookkeeping shows as a baseline that stops returning to zero. Two is enough to see a second
 * cycle start from the first one's leftovers; the nightly run (MEXE_SOAK=1) goes longer, where
 * the wall clock is not on anyone's PR path. */
const CYCLES = process.env.MEXE_SOAK ? 8 : 2;

/** The server closes a socket that sends more than 30 messages a second (hitFlood, S5). Turns
 * alternate, so each socket sends every other draw — this paces the pair well under that, and a
 * soak that tripped the flood guard would be measuring the guard, not the lifecycle. */
const DRAW_PACE_MS = 25;

type Counters = Record<string, number>;

async function readMetrics(): Promise<{ counters: Counters; heapBytes: number }> {
  const res = await fetch(`http://localhost:${PORT}/metrics`, {
    headers: { authorization: `Bearer ${METRICS_TOKEN}` },
  });
  expect(res.status).toBe(200);
  const counters: Counters = {};
  for (const line of (await res.text()).split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const [name, value] = line.split(' ');
    if (name && value !== undefined) counters[name] = Number(value);
  }
  return { counters, heapBytes: counters.mexemexe_heap_used_bytes ?? 0 };
}

/** The newest view this socket was sent, from whichever message carried one. */
function latestView(c: Client): GameView | null {
  for (let i = c.received.length - 1; i >= 0; i--) {
    const m = c.received[i]!;
    if (m.type === 'state_sync' || m.type === 'game_started' || m.type === 'game_over') return m.view;
  }
  return null;
}

function sawGameOver(clients: Client[]): boolean {
  return clients.some((c) => c.received.some((m) => m.type === 'game_over'));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Drive a started match to its end by drawing on every turn. A draw always shrinks the pile, so
 * the match terminates by stalemate in a bounded number of turns whatever the deal was.
 */
async function drainMatch(clients: Client[], what: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let draws = 0;
  while (!sawGameOver(clients)) {
    if (Date.now() > deadline) {
      const revs = clients.map((c) => latestView(c)?.rev ?? -1).join('/');
      throw new Error(`${what}: no game_over after ${draws} draws (revs ${revs})`);
    }
    const actor = clients.find((c) => {
      const v = latestView(c);
      return v !== null && v.phase === 'playing' && v.activeSeat === v.seat;
    });
    if (!actor) {
      await sleep(2);
      continue;
    }
    const before = latestView(actor)!;
    actor.send({ type: 'draw_end_turn', rev: before.rev });
    draws++;
    await sleep(DRAW_PACE_MS);
    // One draw per turn: wait for the authoritative answer before looking for the next actor,
    // otherwise the same rev is submitted twice and the server rightly refuses it.
    while (!sawGameOver(clients) && (latestView(actor)?.rev ?? -1) <= before.rev) {
      if (Date.now() > deadline) {
        const tail = actor.received.slice(-6).map((m) => JSON.stringify(m).slice(0, 120)).join(' | ');
        throw new Error(`${what}: draw at rev ${before.rev} was never answered (last: ${tail})`);
      }
      await sleep(2);
    }
  }
}

/** ready -> start -> play out, on a room that already has both seats. */
async function playOneMatch(host: Client, guest: Client, what: string): Promise<void> {
  host.send({ type: 'ready', ready: true });
  guest.send({ type: 'ready', ready: true });
  await allSeatsReady(host);
  host.send({ type: 'start_game' });
  await host.next('game_started');
  await guest.next('game_started');
  await drainMatch([host, guest], what);
}

describe('multiplayer session soak: repeated room lifecycles leave nothing behind', () => {
  let server: Server;

  beforeAll(async () => {
    // Seeded deals: a soak that fails should replay, and nothing here is about deck variety.
    server = await startServer(PORT, { MEXE_METRICS_TOKEN: METRICS_TOKEN, MEXE_TEST_SEED: '66' });
  }, 30_000);

  afterAll(() => {
    stopServer(server);
  });

  it(`holds its baseline across ${CYCLES} create/play/rematch/reconnect/leave cycles`, async () => {
    const baseline = await quiescedHealth(PORT);
    expect(baseline, 'the soak needs an idle server to start from').toMatchObject({ rooms: 0, connections: 0 });
    let heapAfterFirstCycle = 0;

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const host = await Client.open(PORT);
      host.send({ type: 'create_room', name: 'Host' });
      const joined = await host.next('room_joined');
      const code = joined.code;
      // No turn clock: the soak is about lifecycle drift, and a running match would otherwise
      // race the server's own timeout path while the draws go through.
      host.send({ type: 'set_room_settings', settings: { timerMode: 'off' } });
      // Confirmed, not assumed: a refused settings change would leave the casual clock running
      // and quietly turn this into a test of the turn-timeout path.
      await host.until(
        (m) => m.some((x) => x.type === 'room_state' && x.settings.timerMode === 'off'),
        `cycle ${cycle} clock off`,
      );

      const guest = await Client.open(PORT);
      guest.send({ type: 'join_room', code, name: 'Guest' });
      const guestJoined = await guest.next('room_joined');
      const guestToken = guestJoined.token;
      const guestSeat = guestJoined.seat;

      await playOneMatch(host, guest, `cycle ${cycle} match 1`);

      // Rematch: the finished room is handed back as a lobby, on the same sockets and code. The
      // unlocked room_state has to be the one that follows *this* game_over — the lobby before
      // the match was unlocked too, and clearing first would race the broadcast.
      await host.until(
        (m) => {
          const over = m.findIndex((x) => x.type === 'game_over');
          return over >= 0 && m.slice(over).some((x) => x.type === 'room_state' && !x.locked);
        },
        `cycle ${cycle} rematch lobby`,
      );
      host.clear();
      guest.clear();
      host.send({ type: 'ready', ready: true });
      guest.send({ type: 'ready', ready: true });
      await allSeatsReady(host);
      host.send({ type: 'start_game' });
      await host.next('game_started');
      await guest.next('game_started');

      // Reconnect cycle, mid-match: the guest's socket dies and a fresh one reclaims the seat
      // with the same token. The match must go on rather than stranding the room.
      guest.close();
      await host.until((m) => m.some((x) => x.type === 'player_disconnected'), `cycle ${cycle} drop seen`);
      const resumed = await Client.open(PORT);
      resumed.send({ type: 'reconnect', token: guestToken });
      const back = await resumed.next('room_joined');
      expect(back.seat, 'the reclaimed seat moved').toBe(guestSeat);
      await resumed.next('state_sync');

      await drainMatch([host, resumed], `cycle ${cycle} match 2`);

      // Both seats leave for real. A socket that merely closes leaves its seat inside the
      // reconnect grace by design, so the room would outlive the cycle for a legitimate reason —
      // and this check is about what is left behind once nobody is holding a seat at all.
      host.send({ type: 'leave_room' });
      resumed.send({ type: 'leave_room' });
      host.close();
      resumed.close();

      const after = await quiescedHealth(PORT);
      expect(after, `cycle ${cycle} left something behind`).toMatchObject({ rooms: 0, connections: 0 });
      if (cycle === 1) heapAfterFirstCycle = (await readMetrics()).heapBytes;
    }

    const { counters, heapBytes } = await readMetrics();
    // Exact, not approximate: every cycle is one room, two matches started and finished, and one
    // reconnect. A double-counted rematch or a room created twice per cycle shows up here.
    expect(counters.mexemexe_rooms_created_total).toBe(CYCLES);
    expect(counters.mexemexe_games_started_total).toBe(CYCLES * 2);
    expect(counters.mexemexe_games_finished_total).toBe(CYCLES * 2);
    expect(counters.mexemexe_reconnects_total).toBe(CYCLES);
    expect(counters.mexemexe_rooms_current).toBe(0);
    expect(counters.mexemexe_connections_current).toBe(0);
    expect(counters.mexemexe_message_handler_errors_total).toBe(0);

    // ponytail: heap tripwire, not a leak detector — no GC is forced, so this only catches growth
    // large enough to survive the noise. The per-cycle baseline checks above are the real signal.
    const growthMb = (heapBytes - heapAfterFirstCycle) / (1024 * 1024);
    expect(growthMb, `heap grew ${growthMb.toFixed(1)} MB over ${CYCLES - 1} further cycles`).toBeLessThan(10);
  }, 180_000);
});
