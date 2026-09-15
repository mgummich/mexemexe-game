/**
 * Online Phase 9 — the casual queue over the wire (OM-02..OM-06, OM-18..OM-28, OM-34..OM-36).
 *
 * Raw sockets against the real server process, because everything asked here is about *who may
 * speak for a queue entry*: a second tab, an evicted socket, a cancel that raced a match. None of
 * that is observable from the queue module alone, and none of it is reachable from a browser
 * client, which is exactly why it has to be tested from outside.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, health, startServer, stopServer, type Server } from './harness';
import { PROTOCOL_VERSION, type QueueStateMsg } from '../../src/net/protocol';

/** Every field a queue_state may carry. A new one has to be argued for here before it ships —
 * the queue is the one payload sent to a player who is not yet in a room with anyone. */
const QUEUE_STATE_KEYS = ['v', 'type', 'status', 'target', 'token', 'players', 'reqId'];

async function queued(c: Client, target: number | 'any' = 'any', name = 'Ana'): Promise<QueueStateMsg> {
  c.send({ type: 'join_queue', target, name });
  return c.next('queue_state');
}

describe('OM queue over the wire', () => {
  const PORT = 8830;
  let server: Server;

  beforeAll(async () => {
    server = await startServer(PORT, { MEXE_TEST_SEED: '7' });
  }, 30_000);
  afterAll(() => stopServer(server));

  it('OM-01 a session joins the queue once and is told it is searching', async () => {
    const c = await Client.open(PORT);
    const state = await queued(c);
    expect(state.status).toBe('queued');
    expect(state.target).toBe('any');
    expect(typeof state.token).toBe('string');
    expect(Object.keys(state).every((k) => QUEUE_STATE_KEYS.includes(k))).toBe(true);
    // Every test here shares one server: an entry left waiting would be matched into the next
    // test's group, which is exactly what the queue is supposed to do and exactly what would
    // make these cases lie.
    c.send({ type: 'cancel_queue' });
    await c.next('queue_state');
    c.close();
  });

  it('OM-02/OM-03 a duplicate join is answered with the same entry, never a second one', async () => {
    const c = await Client.open(PORT);
    const first = await queued(c, 4);
    c.clear();
    c.send({ type: 'join_queue', target: 2, name: 'Ana' });
    const second = await c.next('queue_state');
    expect(second.token).toBe(first.token);
    // Idempotent means idempotent: the preference of the live entry is what stands.
    expect(second.target).toBe(4);
    c.send({ type: 'cancel_queue' });
    await c.next('queue_state');
    c.close();
  });

  it('OM-04 a seated player cannot enter the queue', async () => {
    const c = await Client.open(PORT);
    c.send({ type: 'create_room', name: 'Ana' });
    await c.next('room_joined');
    c.send({ type: 'join_queue', target: 'any', name: 'Ana' });
    const err = await c.next('error');
    expect(err.code).toBe('already_in_match');
    c.send({ type: 'leave_room' });
    c.close();
  });

  it('OM-05/OM-06 cancel removes the entry and a second cancel is safe', async () => {
    const c = await Client.open(PORT);
    await queued(c, 4);
    c.clear();
    c.send({ type: 'cancel_queue' });
    expect((await c.next('queue_state')).status).toBe('idle');
    c.clear();
    c.send({ type: 'cancel_queue' });
    expect((await c.next('queue_state')).status).toBe('idle');
    c.close();
  });

  it('OM-07/OM-10/OM-12/OM-13 two queued players get one room, one seat each, dealt once', async () => {
    const a = await Client.open(PORT);
    const b = await Client.open(PORT);
    await queued(a, 2, 'Ana');
    await queued(b, 2, 'Bruno');
    const joinedA = await a.next('room_joined');
    const joinedB = await b.next('room_joined');
    expect(joinedA.code).toBe(joinedB.code);
    expect([joinedA.seat, joinedB.seat].sort()).toEqual([0, 1]);
    expect(joinedA.token).not.toBe(joinedB.token);
    // MATCH FOUND arrives before the room, and says only how big the table is.
    const matched = a.received.find((m): m is QueueStateMsg => m.type === 'queue_state' && m.status === 'matched')!;
    expect(matched.players).toBe(2);
    expect(matched.token).toBeUndefined();
    const started = await a.next('game_started');
    expect(started.view.players).toHaveLength(2);
    expect(started.view.settings.timerMode).toBe('casual');
    expect((await b.next('game_started')).view.matchId).toBe(started.view.matchId);
    a.send({ type: 'leave_room' });
    a.close();
    b.close();
  });

  it('OM-18 a cancel that lost to a committed match is told it is matched', async () => {
    const a = await Client.open(PORT);
    const b = await Client.open(PORT);
    await queued(a, 2, 'Ana');
    await queued(b, 2, 'Bruno');
    await a.next('game_started');
    a.clear();
    a.send({ type: 'cancel_queue' });
    const state = await a.next('queue_state');
    expect(state.status).toBe('matched');
    // The room is untouched by the losing cancel.
    a.clear();
    a.send({ type: 'resync' });
    expect((await a.next('state_sync')).view.players).toHaveLength(2);
    a.send({ type: 'leave_room' });
    a.close();
    b.close();
  });

  it('OM-21 a reconnect while queued restores the same entry rather than a second one', async () => {
    const c = await Client.open(PORT);
    const first = await queued(c, 4);
    c.close();
    const resumed = await Client.open(PORT);
    resumed.send({ type: 'reconnect', token: first.token });
    const state = await resumed.next('queue_state');
    expect(state.status).toBe('queued');
    expect(state.token).toBe(first.token);
    expect(state.target).toBe(4);
    resumed.send({ type: 'cancel_queue' });
    await resumed.next('queue_state');
    resumed.close();
  });

  it('OM-19/OM-34 a player who dropped while queued is still seated, absent, when the match forms', async () => {
    const a = await Client.open(PORT);
    const b = await Client.open(PORT);
    const gone = await queued(a, 2, 'Ana');
    a.close();
    await queued(b, 2, 'Bruno');
    const started = await b.next('game_started');
    expect(started.view.players).toHaveLength(2);
    // Their seat exists and is theirs: the same token reconnects straight into it, which is the
    // ordinary Phase 3 path and the only abandonment policy a matchmade match has (OM-35).
    const back = await Client.open(PORT);
    back.send({ type: 'reconnect', token: gone.token });
    const joined = await back.next('room_joined');
    expect(joined.seat).toBe(0);
    expect((await back.next('state_sync')).view.seat).toBe(0);
    back.send({ type: 'leave_room' });
    back.close();
    b.close();
  });

  it('OM-22 a reconnect after the match was committed restores the room, never the queue', async () => {
    const a = await Client.open(PORT);
    const b = await Client.open(PORT);
    const entry = await queued(a, 2, 'Ana');
    await queued(b, 2, 'Bruno');
    await a.next('game_started');
    a.close();
    const back = await Client.open(PORT);
    back.send({ type: 'reconnect', token: entry.token });
    await back.next('room_joined');
    expect(back.received.some((m) => m.type === 'queue_state')).toBe(false);
    expect((await back.next('state_sync')).view.players).toHaveLength(2);
    back.send({ type: 'leave_room' });
    back.close();
    b.close();
  });

  it('OM-23/OM-25 a superseded socket cannot cancel the entry a newer one now holds', async () => {
    const first = await Client.open(PORT);
    const entry = await queued(first, 4);
    // Second tab, same session token: it takes the entry over.
    const second = await Client.open(PORT);
    second.send({ type: 'reconnect', token: entry.token });
    expect((await second.next('queue_state')).token).toBe(entry.token);
    first.clear();
    first.send({ type: 'cancel_queue' });
    expect((await first.next('queue_state')).status).toBe('idle');
    // The entry survived the stale socket's cancel, and the live tab still owns it.
    second.clear();
    second.send({ type: 'join_queue', target: 4, name: 'Ana' });
    const still = await second.next('queue_state');
    expect(still.status).toBe('queued');
    expect(still.token).toBe(entry.token);
    second.send({ type: 'cancel_queue' });
    await second.next('queue_state');
    first.close();
    second.close();
  });

  it('a backgrounded app that resumes while queued is told it is still searching', async () => {
    const c = await Client.open(PORT);
    const entry = await queued(c, 4);
    c.clear();
    // The resume path the PWA uses on an open socket. It must not answer "not in a room".
    c.send({ type: 'resync' });
    const state = await c.next('queue_state');
    expect(state.status).toBe('queued');
    expect(state.token).toBe(entry.token);
    expect(c.received.some((m) => m.type === 'error')).toBe(false);
    c.send({ type: 'cancel_queue' });
    await c.next('queue_state');
    c.close();
  });

  it('OM-26 a malformed or unsupported preference never becomes an entry', async () => {
    const c = await Client.open(PORT);
    for (const target of [5, 1, 0, '2', null, { n: 2 }]) {
      c.clear();
      c.send({ type: 'join_queue', target, name: 'Ana' });
      expect((await c.next('error')).code).toBe('bad_message');
    }
    c.clear();
    c.send({ type: 'join_queue', target: 'any' });
    expect((await c.next('error')).code).toBe('bad_message');
    expect(c.received.some((m) => m.type === 'queue_state')).toBe(false);
    c.close();
  });

  it('OM-27/OM-28 queue join and cancel spam is bounded', async () => {
    const c = await Client.open(PORT);
    // Under the per-connection flood guard (30/s) but over the queue budget (10/10s).
    for (let i = 0; i < 14; i++) {
      c.send({ type: i % 2 === 0 ? 'join_queue' : 'cancel_queue', target: 'any', name: 'Ana' });
      await new Promise((r) => setTimeout(r, 40));
    }
    const refused = c.received.filter((m) => m.type === 'error' && m.code === 'rate_limited');
    expect(refused.length).toBeGreaterThan(0);
    c.send({ type: 'cancel_queue' });
    c.close();
  });

  it('OM-36 the queue protocol is refused at the wire boundary like every other message', async () => {
    const c = await Client.open(PORT);
    c.sendRaw(JSON.stringify({ v: PROTOCOL_VERSION - 1, type: 'join_queue', reqId: 'r1', target: 'any', name: 'Ana' }));
    expect((await c.next('error')).code).toBe('bad_message');
    c.close();
  });

  it('a queue entry never becomes a room anyone else can find', async () => {
    const a = await Client.open(PORT);
    const b = await Client.open(PORT);
    await queued(a, 2, 'Ana');
    await queued(b, 2, 'Bruno');
    await a.next('game_started');
    const watcher = await Client.open(PORT);
    watcher.send({ type: 'list_rooms' });
    expect((await watcher.next('room_list')).rooms).toEqual([]);
    watcher.close();
    a.send({ type: 'leave_room' });
    a.close();
    b.close();
  });

  it('the health endpoint reports the queue as a count and nothing else', async () => {
    const c = await Client.open(PORT);
    await queued(c, 3);
    const snapshot = (await health(PORT)) as unknown as Record<string, unknown>;
    expect(snapshot.queued).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(snapshot)).not.toContain('Ana');
    c.send({ type: 'cancel_queue' });
    await c.next('queue_state');
    c.close();
  });
});
