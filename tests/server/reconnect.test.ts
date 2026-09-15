/**
 * Online Phase 3 — seat reclaim and the authoritative reconnect snapshot (OR-*).
 *
 * The socket layer is transport; the session token owns the seat. These pin that at the room
 * manager, where the ownership decision is actually made. Socket eviction (OR-03/OR-04) and the
 * room-hop path (OR-18) are exercised against the real process in index.integration.test.ts,
 * since they are properties of the connection registry rather than of the manager.
 */
import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { TIMER_PRESETS } from '../../src/net/protocol';

function testManager(overrides: Partial<{ now: () => number }> = {}) {
  let codeCounter = 0;
  let tokenCounter = 0;
  return new RoomManager({
    now: () => 1000,
    genCode: () => `CODE${++codeCounter}`,
    genToken: () => `TOKEN${++tokenCounter}`,
    genSeed: () => 7,
    ...overrides,
  });
}

/** A started room with `count` seats, returning every seat's token. */
function startedRoom(mgr: RoomManager, count: number): { code: string; tokens: string[] } {
  const host = mgr.createRoom('Ana');
  if (!host.ok) throw new Error('unexpected room_limit in test setup');
  const tokens = [host.token];
  for (let i = 1; i < count; i++) {
    const joined = mgr.joinRoom(host.code, `P${i}`);
    if (!joined.ok) throw new Error(`join ${i} failed: ${joined.error}`);
    tokens.push(joined.token);
  }
  for (let i = 0; i < count; i++) mgr.setReady(host.code, i, true);
  const started = mgr.startGame(host.code, 0);
  if (!started.ok) throw new Error(`start failed: ${started.error}`);
  return { code: host.code, tokens };
}

describe('OR-01 a valid session reclaims its exact seat', () => {
  for (const count of [2, 3, 4]) {
    // OR-31/32/33: the same reclaim contract at every supported table size, and no other seat's
    // presence may be disturbed by one seat's round trip.
    it(`${count}-player room: every seat reclaims the seat it left, and only that seat`, () => {
      const mgr = testManager();
      const { code, tokens } = startedRoom(mgr, count);
      for (let seat = 0; seat < count; seat++) {
        mgr.disconnect(code, seat);
        const result = mgr.reconnect(tokens[seat]!);
        expect(result).toMatchObject({ ok: true, code, seat });
        const players = mgr.getPlayers(code)!;
        expect(players.map((p) => p.connected)).toEqual(Array(count).fill(true));
        expect(players.map((p) => p.seat)).toEqual([...Array(count).keys()]);
      }
    });
  }
});

describe('OR-02 identity is the token, never the name', () => {
  it('a second player with the same display name cannot reclaim the first one seat', () => {
    const mgr = testManager();
    const host = mgr.createRoom('Ana');
    if (!host.ok) throw new Error('setup');
    const twin = mgr.joinRoom(host.code, 'Ana');
    if (!twin.ok) throw new Error('setup');
    expect(mgr.getPlayers(host.code)!.map((p) => p.name)).toEqual(['Ana', 'Ana']);

    mgr.disconnect(host.code, 0);
    // The twin's own token returns the twin's own seat — not seat 0, however identical the name.
    expect(mgr.reconnect(twin.token)).toMatchObject({ ok: true, seat: 1 });
    expect(mgr.getPlayers(host.code)![0]!.connected).toBe(false);
    // And a name is not a credential in any form: nothing but the real token opens seat 0.
    expect(mgr.reconnect('Ana')).toEqual({ ok: false, error: 'invalid_token' });
    expect(mgr.reconnect(host.token)).toMatchObject({ ok: true, seat: 0 });
  });
});

describe('OR-06/OR-07 the reconnect snapshot restores own state without leaking any other', () => {
  it('returns this seat own hand identities, opponents as counts only', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 3);
    mgr.disconnect(code, 1);
    const result = mgr.reconnect(tokens[1]!);
    if (!result.ok || !result.view) throw new Error('expected a mid-match reconnect view');
    const view = result.view;

    expect(view.seat).toBe(1);
    expect(view.players[1]!.hand).toHaveLength(7);
    expect(view.players[1]!.handCount).toBe(7);
    // Every other seat is a count and nothing else — the reconnect path builds the same redacted
    // view the normal broadcast does, so a drop is not a way to ask for more than you may see.
    for (const other of [0, 2]) {
      expect(view.players[other]!.hand).toBeUndefined();
      expect(view.players[other]!.handCount).toBe(7);
    }
    const serialized = JSON.stringify(view);
    const opponentCards = mgr.getRoom(code)!.state!.players[0]!.hand;
    for (const card of opponentCards) expect(serialized).not.toContain(card.id);
    // No session token of any seat ever rides a view.
    for (const token of tokens) expect(serialized).not.toContain(token);
  });

  it('OR-08/OR-09 restores the committed table, the draw count and the current turn', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 2);
    const before = mgr.getView(code, 0)!;
    mgr.disconnect(code, 0);
    const result = mgr.reconnect(tokens[0]!);
    if (!result.ok || !result.view) throw new Error('expected a view');
    // Byte-identical apart from the clock: a reconnect is a re-send of authoritative state, never
    // a recomputation that could drift from what the other seats are looking at.
    const withoutClock = (v: typeof before): Omit<typeof before, 'turnMsLeft'> => {
      const copy = { ...v } as Partial<typeof before>;
      delete copy.turnMsLeft;
      return copy as Omit<typeof before, 'turnMsLeft'>;
    };
    expect(withoutClock(result.view)).toEqual(withoutClock(before));
    expect(result.view.activeSeat).toBe(0);
    expect(result.view.rev).toBe(1);
    expect(result.view.hash).toBe(before.hash);
  });
});

describe('OR-25/OR-26 a reconnect never moves the game', () => {
  it('an inactive seat reconnecting leaves the turn, the revision and the table untouched', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 3);
    const before = mgr.getRoom(code)!;
    const rev = before.rev;
    mgr.disconnect(code, 2);
    const result = mgr.reconnect(tokens[2]!);
    if (!result.ok || !result.view) throw new Error('expected a view');
    expect(result.view.activeSeat).toBe(0);
    expect(result.view.rev).toBe(rev);
    expect(mgr.getRoom(code)!.rev).toBe(rev);
  });

  it('a seat that reconnects after the turn moved on receives the new turn, not the old one', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 2);
    mgr.disconnect(code, 1);
    // Seat 0 plays while seat 1 is away: the authoritative turn and revision both advance.
    expect(mgr.drawEndTurn(code, 0, 1)).toMatchObject({ ok: true });
    const result = mgr.reconnect(tokens[1]!);
    if (!result.ok || !result.view) throw new Error('expected a view');
    expect(result.view.activeSeat).toBe(1);
    expect(result.view.rev).toBe(2);
    expect(result.view.turn).toBe(2);
    expect(result.view.players[1]!.hand).toHaveLength(7);
  });
});

describe('OR-27/OR-28 reconnect respects the room lifecycle it lands in', () => {
  it('a reconnect into a lobby restores the lobby, with no match view at all', () => {
    const mgr = testManager();
    const host = mgr.createRoom('Ana');
    if (!host.ok) throw new Error('setup');
    mgr.joinRoom(host.code, 'Bia');
    mgr.disconnect(host.code, 0);
    const result = mgr.reconnect(host.token);
    expect(result).toMatchObject({ ok: true, seat: 0, view: null });
    if (!result.ok) throw new Error('unreachable');
    expect(result.players).toHaveLength(2);
  });

  it('a reconnect after the match was recycled for a rematch restores the rematch lobby', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 2);
    expect(mgr.recycleForRematch(code)).toBe(true);
    mgr.disconnect(code, 1);
    const result = mgr.reconnect(tokens[1]!);
    // No stale playing state survives the recycle: the returning seat is handed the lobby the
    // rest of the room is already looking at, with its ready bit cleared like everyone else's.
    expect(result).toMatchObject({ ok: true, seat: 1, view: null });
    expect(mgr.getRoomInfo(code)).toMatchObject({ locked: false });
    expect(mgr.getRoomInfo(code)!.players.every((p) => !p.ready)).toBe(true);
  });

  it('a reconnect into a room that no longer exists fails rather than resurrecting it', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 2);
    mgr.deleteRoom(code);
    expect(mgr.reconnect(tokens[0]!)).toEqual({ ok: false, error: 'invalid_token' });
  });
});

describe('OR-16 reconnect is idempotent', () => {
  it('reconnecting twice with the same token yields the same seat and changes nothing', () => {
    const mgr = testManager();
    const { code, tokens } = startedRoom(mgr, 3);
    mgr.disconnect(code, 1);
    const first = mgr.reconnect(tokens[1]!);
    const second = mgr.reconnect(tokens[1]!);
    expect(second).toEqual(first);
    // OR-17: no duplicate seat, no duplicate player, no revision movement.
    expect(mgr.getPlayers(code)).toHaveLength(3);
    expect(mgr.getRoom(code)!.rev).toBe(1);
    expect(mgr.getRoom(code)!.state!.players).toHaveLength(3);
  });
});

describe('OR-29 grace expiry is deterministic', () => {
  it('past the grace the absent seat is played for, and its token still reclaims the seat it never lost', () => {
    let now = 1000;
    const mgr = new RoomManager({
      now: () => now,
      genCode: () => 'CODE1',
      genToken: () => 'TOKEN1',
      genSeed: () => 7,
    });
    const host = mgr.createRoom('Ana');
    if (!host.ok) throw new Error('setup');
    const bia = mgr.joinRoom(host.code, 'Bia');
    if (!bia.ok) throw new Error('setup');
    mgr.setReady(host.code, 0, true);
    mgr.setReady(host.code, 1, true);
    mgr.setRoomSettings(host.code, 0, TIMER_PRESETS.fast);
    mgr.setReady(host.code, 0, true);
    mgr.setReady(host.code, 1, true);
    if (!mgr.startGame(host.code, 0).ok) throw new Error('setup');
    const graceMs = mgr.getRoomInfo(host.code)!.settings.reconnectGraceMs;

    mgr.disconnect(host.code, 0);
    // Inside the grace nothing happens at all: the seat is simply held.
    now += graceMs - 1;
    expect(mgr.advanceStalledTurns()).toEqual([]);
    // Past it the documented Phase 2 policy applies — draw and pass, missed turn counted — and it
    // is the missed-turn limit, not the reconnect path, that ever ends a match.
    now += 2;
    expect(mgr.advanceStalledTurns()).toEqual([{ code: host.code, gameOver: false, timedOut: 0 }]);
    expect(mgr.getView(host.code, 1)!.missedTurns[0]).toBe(1);

    // The seat was never given away: a late reclaim still lands on seat 0 with the current state.
    const late = mgr.reconnect(host.token);
    expect(late).toMatchObject({ ok: true, seat: 0 });
    if (!late.ok || !late.view) throw new Error('expected a view');
    expect(late.view.rev).toBe(2);
    expect(late.view.activeSeat).toBe(1);
  });
});
