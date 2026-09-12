import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { parseClientMessage, PROTOCOL_VERSION, REACTION_COOLDOWN_MS } from '../../src/net/protocol';
import { createDeck, dealInitialHands, shuffleDeck } from '../../src/rules/rules';
import { createRng } from '../../src/core/rng';
import type { Card } from '../../src/rules/types';

/** Clock the manager reads, so the reaction cooldown can be advanced deterministically. */
function managerAt(clock: { t: number }, seed = 1): RoomManager {
  let codes = 0;
  let tokens = 0;
  return new RoomManager({
    now: () => clock.t,
    genCode: () => `CODE${++codes}`,
    genToken: () => `TOKEN${++tokens}`,
    genSeed: () => seed,
  });
}

function startedRoom(clock: { t: number }, seed: number): { mgr: RoomManager; code: string } {
  const mgr = managerAt(clock, seed);
  const created = mgr.createRoom('Alice');
  if (!created.ok) throw new Error('unexpected room_limit');
  mgr.joinRoom(created.code, 'Bob');
  mgr.setReady(created.code, 0, true);
  mgr.setReady(created.code, 1, true);
  mgr.startGame(created.code, 0);
  return { mgr, code: created.code };
}

/** A seed whose seat-0 hand holds a same-rank triple, so a legal winning meld exists. */
function seedWithTriple(): { seed: number; triple: Card[] } {
  for (let seed = 1; seed < 400; seed++) {
    const hand = dealInitialHands(shuffleDeck(createDeck(), createRng(seed)), 2).hands[0]!;
    for (const rank of new Set(hand.map((c) => c.rank))) {
      const sameRank = hand.filter((c) => c.rank === rank);
      const distinctSuits = sameRank.filter((c, i) => sameRank.findIndex((o) => o.suit === c.suit) === i);
      if (distinctSuits.length >= 3) return { seed, triple: distinctSuits.slice(0, 3) };
    }
  }
  throw new Error('no seed with a triple');
}

describe('preset reactions (ONLINE-21)', () => {
  it('parses only ids from the preset list', () => {
    const wire = (reaction: unknown) =>
      parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'reaction', reqId: 'r1', reaction }));
    expect(wire('nice')).toEqual({ v: PROTOCOL_VERSION, type: 'reaction', reqId: 'r1', reaction: 'nice' });
    for (const bad of ['NICE', 'you stink', '', 42, null, undefined, 'x'.repeat(200)]) {
      expect(wire(bad)).toEqual({ error: 'bad reaction' });
    }
  });

  it('enforces the cooldown on the server, per seat', () => {
    const clock = { t: 10_000 };
    const mgr = managerAt(clock);
    const created = mgr.createRoom('Alice');
    if (!created.ok) throw new Error('unexpected room_limit');
    mgr.joinRoom(created.code, 'Bob');

    expect(mgr.claimReaction(created.code, 0)).toBe(true);
    expect(mgr.claimReaction(created.code, 0)).toBe(false);
    // A different seat is not held back by its neighbour's cooldown.
    expect(mgr.claimReaction(created.code, 1)).toBe(true);

    clock.t += REACTION_COOLDOWN_MS - 1;
    expect(mgr.claimReaction(created.code, 0)).toBe(false);
    clock.t += 1;
    expect(mgr.claimReaction(created.code, 0)).toBe(true);
  });

  it('refuses a reaction for an empty seat or an unknown room', () => {
    const clock = { t: 0 };
    const mgr = managerAt(clock);
    const created = mgr.createRoom('Alice');
    if (!created.ok) throw new Error('unexpected room_limit');
    expect(mgr.claimReaction(created.code, 3)).toBe(false);
    expect(mgr.claimReaction('NOPE1', 0)).toBe(false);
  });
});

describe('winning-move summary (ONLINE-25)', () => {
  it('records only the seat and the number of cards that seat put down', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    const room = mgr.getRoom(code)!;
    expect(mgr.getWinningMove(code)).toBeNull();

    // Leave seat 0 holding exactly the winning meld; the rest of the hand goes to the draw pile
    // so the manager's card-conservation invariant still holds.
    const keep = new Set(triple.map((c) => c.id));
    const hand = room.state!.players[0]!.hand;
    room.state!.drawPile.push(...hand.filter((c) => !keep.has(c.id)));
    room.state!.players[0]!.hand = hand.filter((c) => keep.has(c.id));

    const result = mgr.submitTurn(code, 0, room.rev, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    expect(result).toEqual({ ok: true, gameOver: true });
    expect(mgr.getWinningMove(code)).toEqual({ seat: 0, cardsPlayed: 3 });
  });
});

describe('rematch in the same room (ONLINE-23/24)', () => {
  it('hands a finished room back as an unlocked lobby with every seat not ready', () => {
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, 3);
    expect(mgr.getRoomInfo(code)!.locked).toBe(true);

    expect(mgr.recycleForRematch(code)).toBe(true);
    const info = mgr.getRoomInfo(code)!;
    expect(info.locked).toBe(false);
    expect(info.players.map((p) => p.ready)).toEqual([false, false]);
    expect(info.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    // No match state left behind: nobody can act on the finished game any more.
    expect(mgr.getRoom(code)!.state).toBeNull();
    expect(mgr.getView(code, 0)).toBeNull();
    expect(mgr.getWinningMove(code)).toBeNull();

    // And the room can genuinely be played again on the same code.
    expect(mgr.setReady(code, 0, true).ok).toBe(true);
    expect(mgr.setReady(code, 1, true).ok).toBe(true);
    expect(mgr.startGame(code, 0)).toEqual({ ok: true, started: true, players: expect.anything() });
  });

  it('is a no-op for a room that no longer exists', () => {
    const mgr = managerAt({ t: 0 });
    expect(mgr.recycleForRematch('GONE1')).toBe(false);
  });
});
