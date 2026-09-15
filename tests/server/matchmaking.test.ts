/**
 * Casual queue policy and the queue -> room handoff, at the manager level (OM-01..OM-17,
 * OM-26..OM-33, OM-37). The wire-level races live in queue.integration.test.ts, which drives the
 * real server process.
 */
import { describe, expect, it } from 'vitest';
import { MatchQueue } from '../../server/matchmaking';
import { RoomManager } from '../../server/rooms';
import { TIMER_PRESETS, type QueueTarget } from '../../src/net/protocol';

function testQueue(overrides: { timeoutMs?: number; maxEntries?: number } = {}) {
  let n = 0;
  return new MatchQueue({ genToken: () => `Q${++n}`, ...overrides });
}

function testRooms() {
  let codes = 0;
  return new RoomManager({ genCode: () => `CODE${++codes}`, genSeed: () => 7 });
}

/** Queue `targets` in order, one millisecond apart, so "oldest first" is unambiguous. */
function fill(queue: MatchQueue, targets: QueueTarget[], start = 1000) {
  return targets.map((target, i) => {
    const entry = queue.join(`P${i}`, target, start + i);
    if (!entry) throw new Error('unexpected queue_busy in test setup');
    return entry;
  });
}

describe('queue membership', () => {
  it('OM-01/OM-05/OM-06: an entry is joined once, cancelled once, and cancelling again is safe', () => {
    const queue = testQueue();
    const [entry] = fill(queue, ['any']);
    expect(queue.size()).toBe(1);
    expect(queue.get(entry!.token)).toEqual(entry);
    expect(queue.cancel(entry!.token)).toBe(true);
    expect(queue.cancel(entry!.token)).toBe(false);
    expect(queue.size()).toBe(0);
    expect(queue.get(entry!.token)).toBeNull();
  });

  it('OM-29: an entry past the queue lifetime expires and leaves nothing behind', () => {
    const queue = testQueue({ timeoutMs: 1000 });
    const [stale, fresh] = fill(queue, ['any', 'any']);
    const expired = queue.expire(stale!.joinedAt + 1000);
    expect(expired.map((e) => e.token)).toEqual([stale!.token]);
    expect(queue.size()).toBe(1);
    expect(queue.get(fresh!.token)).not.toBeNull();
  });

  it('OM-29: an expired entry is no longer matchable', () => {
    const queue = testQueue({ timeoutMs: 1000 });
    fill(queue, ['any', 'any']);
    queue.expire(3000);
    expect(queue.takeGroups()).toEqual([]);
  });

  it('queue capacity is bounded and refuses rather than growing', () => {
    const queue = testQueue({ maxEntries: 2 });
    fill(queue, ['any', 'any']);
    expect(queue.join('late', 'any', 2000)).toBeNull();
    expect(queue.size()).toBe(2);
  });
});

describe('group formation', () => {
  it('OM-07: two compatible entries form exactly one 2-player group', () => {
    const queue = testQueue();
    fill(queue, [2, 2]);
    const groups = queue.takeGroups();
    expect(groups.map((g) => g.length)).toEqual([2]);
    expect(queue.size()).toBe(0);
    expect(queue.takeGroups()).toEqual([]);
  });

  it('OM-08: three compatible entries form one 3-player group', () => {
    const queue = testQueue();
    fill(queue, [3, 3, 3]);
    expect(queue.takeGroups().map((g) => g.length)).toEqual([3]);
  });

  it('OM-09: four compatible entries form one 4-player group', () => {
    const queue = testQueue();
    fill(queue, [4, 4, 4, 4]);
    expect(queue.takeGroups().map((g) => g.length)).toEqual([4]);
  });

  it('a target is never matched below or above the size it asked for', () => {
    const queue = testQueue();
    fill(queue, [4, 4, 4]);
    expect(queue.takeGroups()).toEqual([]);
    expect(queue.size()).toBe(3);
  });

  it('OM-14: the oldest compatible entries are chosen first', () => {
    const queue = testQueue();
    const entries = fill(queue, [2, 2, 2, 2]);
    const groups = queue.takeGroups();
    expect(groups[0]!.map((e) => e.token)).toEqual([entries[0]!.token, entries[1]!.token]);
    expect(groups[1]!.map((e) => e.token)).toEqual([entries[2]!.token, entries[3]!.token]);
  });

  it('OM-15: Any + Any forms a 2-player group', () => {
    const queue = testQueue();
    fill(queue, ['any', 'any']);
    expect(queue.takeGroups().map((g) => g.length)).toEqual([2]);
  });

  it('OM-16: three Any entries form one 3-player group', () => {
    const queue = testQueue();
    fill(queue, ['any', 'any', 'any']);
    expect(queue.takeGroups().map((g) => g.length)).toEqual([3]);
  });

  it('OM-17: four Any entries form one 4-player group', () => {
    const queue = testQueue();
    fill(queue, ['any', 'any', 'any', 'any']);
    expect(queue.takeGroups().map((g) => g.length)).toEqual([4]);
  });

  it('Any never exceeds room capacity: five waiting seat four, one keeps waiting', () => {
    const queue = testQueue();
    fill(queue, ['any', 'any', 'any', 'any', 'any']);
    expect(queue.takeGroups().map((g) => g.length)).toEqual([4]);
    expect(queue.size()).toBe(1);
  });

  it('an explicit size pulls Any entries in to fill it, oldest first', () => {
    const queue = testQueue();
    const entries = fill(queue, [3, 'any', 'any', 'any']);
    const groups = queue.takeGroups();
    expect(groups.map((g) => g.length)).toEqual([3]);
    expect(groups[0]!.map((e) => e.token)).toEqual(entries.slice(0, 3).map((e) => e.token));
    expect(queue.size()).toBe(1);
  });

  it('a lone Any entry waits rather than forming a one-player match', () => {
    const queue = testQueue();
    fill(queue, ['any']);
    expect(queue.takeGroups()).toEqual([]);
    expect(queue.size()).toBe(1);
  });

  it('OM-11/OM-12/OM-13: a matched entry leaves the queue and is never selected twice', () => {
    const queue = testQueue();
    fill(queue, ['any', 'any', 'any', 'any', 4, 4, 4, 4]);
    const first = queue.takeGroups();
    const second = queue.takeGroups();
    const tokens = [...first, ...second].flat().map((e) => e.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(second).toEqual([]);
  });

  it('OM-20: an entry that has been matched can no longer expire', () => {
    const queue = testQueue({ timeoutMs: 1000 });
    const entries = fill(queue, [2, 2]);
    queue.takeGroups();
    // The sweep runs long after the match was committed and finds nothing to expire: the entries
    // left the queue when the group was formed, so the two outcomes cannot both happen.
    expect(queue.expire(entries[0]!.joinedAt + 10_000)).toEqual([]);
    expect(queue.size()).toBe(0);
  });

  it('OM-30: a restored group waits again in its original order', () => {
    const queue = testQueue();
    const entries = fill(queue, [2, 2]);
    const [group] = queue.takeGroups();
    expect(queue.size()).toBe(0);
    queue.restore(group!);
    expect(queue.size()).toBe(2);
    expect(queue.takeGroups()[0]!.map((e) => e.token)).toEqual(entries.map((e) => e.token));
  });

  it('OM-37: a load of mixed entries produces unique assignments and legal group sizes', () => {
    const queue = testQueue({ maxEntries: 500 });
    const targets: QueueTarget[] = [];
    for (let i = 0; i < 400; i++) targets.push(([2, 3, 4, 'any'] as const)[i % 4]!);
    fill(queue, targets);
    const started = Date.now();
    const groups = queue.takeGroups();
    expect(Date.now() - started).toBeLessThan(2000);
    const seen = new Set<string>();
    for (const group of groups) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      expect(group.length).toBeLessThanOrEqual(4);
      for (const entry of group) {
        expect(seen.has(entry.token)).toBe(false);
        seen.add(entry.token);
        // Nobody is seated at a table they did not ask for.
        if (entry.target !== 'any') expect(group.length).toBe(entry.target);
      }
    }
    expect(seen.size + queue.size()).toBe(400);
  });
});

describe('queue -> room handoff', () => {
  const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, token: `T${i}` }));

  it.each([2, 3, 4])('OM-10: a %i-player match seats every player exactly once', (n) => {
    const rooms = testRooms();
    const created = rooms.createMatchRoom(players(n));
    if (!created.ok) throw new Error('allocation failed');
    const summary = rooms.getPlayers(created.code)!;
    expect(summary.map((p) => p.seat)).toEqual([...Array(n).keys()]);
    expect(new Set(summary.map((p) => p.name)).size).toBe(n);
    const view = rooms.getView(created.code, 0)!;
    expect(view.players).toHaveLength(n);
    expect(view.activeSeat).toBe(0);
    expect(view.phase).toBe('playing');
  });

  it('OM-13: the match is dealt once, at allocation, with no ready step', () => {
    const rooms = testRooms();
    const created = rooms.createMatchRoom(players(2));
    if (!created.ok) throw new Error('allocation failed');
    expect(rooms.getRoomInfo(created.code)!.locked).toBe(true);
    expect(rooms.getView(created.code, 0)!.rev).toBe(1);
    // Starting again is refused by the same rule that refuses any second start.
    expect(rooms.startGame(created.code, 0).ok).toBe(false);
  });

  it('OM-22/OM-35: each seat is reconnectable by the token it queued with', () => {
    const rooms = testRooms();
    const created = rooms.createMatchRoom(players(3));
    if (!created.ok) throw new Error('allocation failed');
    for (let seat = 0; seat < 3; seat++) {
      const result = rooms.reconnect(`T${seat}`);
      expect(result.ok && result.seat).toBe(seat);
      expect(result.ok && result.code).toBe(created.code);
      expect(result.ok && result.view?.seat).toBe(seat);
    }
  });

  it('OM-31: a matchmade room uses the canonical casual settings', () => {
    const rooms = testRooms();
    const created = rooms.createMatchRoom(players(2));
    if (!created.ok) throw new Error('allocation failed');
    expect(rooms.getRoomInfo(created.code)!.settings).toEqual(TIMER_PRESETS.casual);
  });

  it('OM-32: no seat can change a matchmade room’s fairness settings', () => {
    const rooms = testRooms();
    const created = rooms.createMatchRoom(players(2));
    if (!created.ok) throw new Error('allocation failed');
    // Mid-match first, then between matches, where an ordinary room would allow it.
    expect(rooms.setRoomSettings(created.code, 0, TIMER_PRESETS.fast)).toEqual({ ok: false, error: 'game_started' });
    rooms.recycleForRematch(created.code);
    expect(rooms.setRoomSettings(created.code, 0, TIMER_PRESETS.fast)).toEqual({ ok: false, error: 'not_host' });
    expect(rooms.getRoomInfo(created.code)!.settings).toEqual(TIMER_PRESETS.casual);
  });

  it('OM-33: a matchmade room is private and cannot be listed', () => {
    const rooms = testRooms();
    const created = rooms.createMatchRoom(players(2));
    if (!created.ok) throw new Error('allocation failed');
    expect(rooms.getVisibility(created.code)).toBe('private');
    rooms.recycleForRematch(created.code);
    expect(rooms.setVisibility(created.code, 0, 'listed')).toEqual({ ok: false, error: 'not_host' });
    expect(rooms.listRooms()).toEqual([]);
  });

  it('OM-30: an allocation that cannot get a room leaves no half-built one behind', () => {
    let codes = 0;
    const rooms = new RoomManager({ genCode: () => `CODE${++codes}`, genSeed: () => 7, maxRooms: 0 });
    expect(rooms.createMatchRoom(players(2))).toEqual({ ok: false, error: 'room_limit' });
    expect(rooms.roomCount()).toBe(0);
  });

  it('a group outside 2-4 is refused outright', () => {
    const rooms = testRooms();
    expect(rooms.createMatchRoom(players(1)).ok).toBe(false);
    expect(rooms.createMatchRoom(players(5)).ok).toBe(false);
    expect(rooms.roomCount()).toBe(0);
  });
});
