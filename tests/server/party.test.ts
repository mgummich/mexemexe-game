import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { testManager } from './manager';
import { MAX_ACTIVITY, MAX_MATCH_HISTORY, parseClientMessage, PROTOCOL_VERSION, REACTION_COOLDOWN_MS } from '../../src/net/protocol';
import { createDeck, dealInitialHands, shuffleDeck } from '../../src/rules/rules';
import { createRng } from '../../src/rules/rng';
import type { Card } from '../../src/rules/types';
import { withHand } from '../helpers/cards';

/** Clock the manager reads, so the reaction cooldown can be advanced deterministically. */
function startedRoom(clock: { t: number }, seed: number): { mgr: RoomManager; code: string } {
  const mgr = testManager({ clock, seed });
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

/** Rig seat 0 to be holding exactly `triple` and nothing else, then play it — the shortest legal
 * path to a finished match. The rest of the hand goes to the draw pile so the manager's
 * card-conservation invariant still holds. */
function winWithTriple(mgr: RoomManager, code: string, triple: Card[]): void {
  const room = mgr.getRoom(code)!;
  const keep = new Set(triple.map((c) => c.id));
  const hand = room.state!.players[0]!.hand;
  mgr.setStateForTest(code, {
    ...withHand(room.state!, 0, hand.filter((c) => keep.has(c.id))),
    drawPile: [...room.state!.drawPile, ...hand.filter((c) => !keep.has(c.id))],
  });
  const result = mgr.submitTurn(code, 0, room.rev, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
  expect(result).toEqual({ ok: true, gameOver: true });
}

/** Everyone ready, host starts. The same two calls are the rematch vote in a recycled lobby. */
function voteAndStart(mgr: RoomManager, code: string, seats: number[]): void {
  for (const seat of seats) mgr.setReady(code, seat, true);
  expect(mgr.startGame(code, 0).ok).toBe(true);
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
    const mgr = testManager({ clock });
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
    const mgr = testManager({ clock });
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
    mgr.setStateForTest(code, {
      ...withHand(room.state!, 0, hand.filter((c) => keep.has(c.id))),
      drawPile: [...room.state!.drawPile, ...hand.filter((c) => !keep.has(c.id))],
    });

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
    const mgr = testManager({ clock: { t: 0 } });
    expect(mgr.recycleForRematch('GONE1')).toBe(false);
  });
});

/**
 * Online Phase 5 — the party session: one room, many matches, a score that survives them and a
 * public record of what happened. Everything here is server-side: a client renders these values,
 * it never produces one.
 */
describe('party session (OS-01..OS-19)', () => {
  it('OS-01/03/04/05 a finished match hands the room back with its code, seats and tokens intact', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    const tokensBefore = mgr.getRoom(code) && [0, 1].map((seat) => mgr.getPlayers(code)![seat]!.name);

    winWithTriple(mgr, code, triple);
    mgr.recycleForRematch(code);

    // Same room object, same code, same people in the same chairs.
    expect(mgr.getRoomInfo(code)).not.toBeNull();
    expect(mgr.getPlayers(code)!.map((p) => [p.seat, p.name])).toEqual([[0, 'Alice'], [1, 'Bob']]);
    expect([0, 1].map((seat) => mgr.getPlayers(code)![seat]!.name)).toEqual(tokensBefore);
    // ...and nothing of the match itself survives.
    expect(mgr.getRoom(code)!.state).toBeNull();
    expect(mgr.getView(code, 0)).toBeNull();
    expect(mgr.getWinningMove(code)).toBeNull();
  });

  it('OS-02 a rematch mints a fresh matchId', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    const first = mgr.getView(code, 0)!.matchId;
    expect(first).not.toBe('');

    winWithTriple(mgr, code, triple);
    mgr.recycleForRematch(code);
    voteAndStart(mgr, code, [0, 1]);

    const second = mgr.getView(code, 0)!.matchId;
    expect(second).not.toBe('');
    expect(second).not.toBe(first);
  });

  it('OS-06/07 the winner gains exactly one session win, and a duplicate finish adds none', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    expect(mgr.getPlayers(code)!.map((p) => p.wins)).toEqual([0, 0]);

    winWithTriple(mgr, code, triple);
    expect(mgr.getPlayers(code)!.map((p) => p.wins)).toEqual([1, 0]);

    // Every way a finish can be observed twice: a second recycle, and a recycle after the result
    // was already recorded by the turn that produced it.
    mgr.recycleForRematch(code);
    mgr.recycleForRematch(code);
    expect(mgr.getPlayers(code)!.map((p) => p.wins)).toEqual([1, 0]);
    expect(mgr.getParty(code).matches).toHaveLength(1);
  });

  it('OS-08/09/10/11 rematch is a vote: everyone agrees, it starts once, and no vote survives it', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    winWithTriple(mgr, code, triple);
    mgr.recycleForRematch(code);

    // OS-08: the vote is visible to the whole room, per seat.
    expect(mgr.getPlayers(code)!.map((p) => p.ready)).toEqual([false, false]);
    mgr.setReady(code, 0, true);
    expect(mgr.getPlayers(code)!.map((p) => p.ready)).toEqual([true, false]);

    // OS-09: one player wanting it is not enough, however many times they ask.
    expect(mgr.startGame(code, 0)).toEqual({ ok: false, error: 'not_ready' });
    expect(mgr.startGame(code, 0)).toEqual({ ok: false, error: 'not_ready' });
    expect(mgr.getRoom(code)!.state).toBeNull();

    // OS-10: with every vote in, exactly one match starts — a second start is refused.
    mgr.setReady(code, 1, true);
    expect(mgr.startGame(code, 0).ok).toBe(true);
    const matchId = mgr.getView(code, 0)!.matchId;
    expect(mgr.startGame(code, 0)).toEqual({ ok: false, error: 'game_started' });
    expect(mgr.getView(code, 0)!.matchId).toBe(matchId);

    // OS-11: starting consumed the votes, so nothing is left to carry into the next match.
    expect(mgr.getPlayers(code)!.map((p) => p.ready)).toEqual([false, false]);
  });

  it('OS-12/13 a player may leave between matches, and the host moves on deterministically', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    winWithTriple(mgr, code, triple);
    mgr.recycleForRematch(code);
    mgr.joinRoom(code, 'Cara');
    mgr.setReady(code, 2, true);

    // The host (seat 0) walks out between matches.
    expect(mgr.leaveRoom(code, 0)).toEqual({ roomClosed: false });
    expect(mgr.getRoomInfo(code)).not.toBeNull();
    expect(mgr.getHostSeat(code)).toBe(1);
    // Nobody else's score, vote or seat moved.
    expect(mgr.getPlayers(code)!.map((p) => [p.seat, p.name, p.wins, p.ready])).toEqual([
      [1, 'Bob', 0, false],
      [2, 'Cara', 0, true],
    ]);
    // The departed host's win left with their chair; nobody else's score changed.
    expect(mgr.getParty(code).matches).toHaveLength(1);
  });

  it('OS-14/15 a newcomer may take the free seat before the next match, and starts at zero', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    winWithTriple(mgr, code, triple);
    mgr.recycleForRematch(code);
    mgr.setReady(code, 0, true);

    const joined = mgr.joinRoom(code, 'Dani');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    expect(joined.seat).toBe(2);
    const dani = mgr.getPlayers(code)!.find((p) => p.seat === 2)!;
    // No inherited score, no inherited vote, no inherited identity.
    expect(dani).toEqual({ seat: 2, name: 'Dani', ready: false, connected: true, wins: 0 });
    // Joining mid-match is still refused — this is the between-matches lobby, not the table.
    voteAndStart(mgr, code, [0, 1, 2]);
    expect(mgr.joinRoom(code, 'Edu')).toEqual({ ok: false, error: 'game_started' });
  });

  it('OS-16/17 match history records the public result and stays bounded', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);

    for (let i = 0; i < MAX_MATCH_HISTORY + 3; i++) {
      if (i > 0) voteAndStart(mgr, code, [0, 1]);
      clock.t += 42_000;
      winWithTriple(mgr, code, triple);
      mgr.recycleForRematch(code);
    }

    const { matches } = mgr.getParty(code);
    expect(matches).toHaveLength(MAX_MATCH_HISTORY);
    // Oldest dropped, newest kept, sequence numbers never reused.
    expect(matches.map((m) => m.seq)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const last = matches.at(-1)!;
    expect(last.winnerSeat).toBe(0);
    expect(last.winnerName).toBe('Alice');
    expect(last.stalemate).toBe(false);
    expect(last.durationSec).toBe(42);
    expect(mgr.getPlayers(code)!.map((p) => p.wins)).toEqual([MAX_MATCH_HISTORY + 3, 0]);
  });

  it('OS-18/19 the activity feed is public-safe, bounded, and carries no card identity', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    clock.t += REACTION_COOLDOWN_MS;
    expect(mgr.claimReaction(code, 1, 'nice')).toBe(true);
    const cardIds = mgr.getRoom(code)!.state!.players.flatMap((p) => p.hand.map((c) => c.id));
    winWithTriple(mgr, code, triple);

    const { activity } = mgr.getParty(code);
    expect(activity.map((e) => e.kind)).toEqual([
      'joined', 'joined', 'ready', 'ready', 'match_started', 'reaction', 'won',
    ]);
    expect(activity.find((e) => e.kind === 'reaction')).toMatchObject({ seat: 1, name: 'Bob', reaction: 'nice' });
    expect(activity.find((e) => e.kind === 'won')).toMatchObject({ seat: 0, name: 'Alice' });
    // Monotonic, so a client can order and de-duplicate without a clock.
    expect(activity.map((e) => e.seq)).toEqual([...activity.map((e) => e.seq)].sort((a, b) => a - b));

    // OS-19: the shape is closed, and nothing in it resolves to a card.
    const serialized = JSON.stringify(activity);
    for (const id of cardIds) expect(serialized).not.toContain(id);
    for (const e of activity) {
      expect(Object.keys(e).every((k) => ['seq', 'kind', 'seat', 'name', 'reaction'].includes(k))).toBe(true);
    }
  });

  it('OS-18 the feed drops its oldest entries rather than growing with the session', () => {
    const clock = { t: 0 };
    const mgr = testManager({ clock });
    const created = mgr.createRoom('Alice');
    if (!created.ok) throw new Error('unexpected room_limit');
    for (let i = 0; i < MAX_ACTIVITY * 2; i++) {
      clock.t += REACTION_COOLDOWN_MS;
      mgr.claimReaction(created.code, 0, 'nice');
    }
    const { activity } = mgr.getParty(created.code);
    expect(activity).toHaveLength(MAX_ACTIVITY);
    expect(activity[0]!.seq).toBeGreaterThan(1); // the 'joined' entry aged out
  });

  it('OS-25/26 one card left is announced by count, once, with no card identity', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    const room = mgr.getRoom(code)!;

    // Seat 0 holds the winning triple plus exactly one spare: playing the triple leaves it on one
    // card, which is the transition the warning exists for — and the match is NOT over.
    const keep = new Set(triple.map((c) => c.id));
    const hand = room.state!.players[0]!.hand;
    const spare = hand.find((c) => !keep.has(c.id))!;
    mgr.setStateForTest(code, {
      ...withHand(room.state!, 0, [...triple, spare]),
      drawPile: [...room.state!.drawPile, ...hand.filter((c) => !keep.has(c.id) && c.id !== spare.id)],
    });

    expect(mgr.submitTurn(code, 0, room.rev, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]))
      .toEqual({ ok: true, gameOver: false });

    const announced = mgr.getParty(code).activity.filter((e) => e.kind === 'last_card');
    expect(announced).toHaveLength(1);
    expect(announced[0]).toMatchObject({ seat: 0, name: 'Alice' });
    // The count is public in every view already; the identity of the remaining card is not, and
    // the event's shape cannot express it.
    expect(Object.keys(announced[0]!).sort()).toEqual(['kind', 'name', 'seat', 'seq']);
    expect(JSON.stringify(announced)).not.toContain(spare.id);
    // Sitting on one card does not re-announce every turn.
    const rev = mgr.getRoom(code)!.rev;
    expect(mgr.drawEndTurn(code, 1, rev).ok).toBe(true);
    expect(mgr.getParty(code).activity.filter((e) => e.kind === 'last_card')).toHaveLength(1);
  });

  it('OS-23/24 a reaction changes no gameplay state and never crosses a room boundary', () => {
    const { seed } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    const other = mgr.createRoom('Zoe');
    if (!other.ok) throw new Error('unexpected room_limit');

    clock.t += REACTION_COOLDOWN_MS;
    const before = mgr.getView(code, 0)!;
    expect(mgr.claimReaction(code, 0, 'wow')).toBe(true);
    const after = mgr.getView(code, 0)!;
    // OS-23: revision, turn, hands and hash are untouched — a reaction is not a move.
    expect(after.rev).toBe(before.rev);
    expect(after.hash).toBe(before.hash);
    expect(after.activeSeat).toBe(before.activeSeat);
    expect(after.players.map((p) => p.handCount)).toEqual(before.players.map((p) => p.handCount));

    // OS-24: the event landed in one room's feed and no other's.
    expect(mgr.getParty(code).activity.some((e) => e.kind === 'reaction')).toBe(true);
    expect(mgr.getParty(other.code).activity.some((e) => e.kind === 'reaction')).toBe(false);
    // And a seat index that is real in room A is not a licence to act in room B.
    expect(mgr.claimReaction(other.code, 1, 'wow')).toBe(false);
  });

  it('OS-31/32 a reconnect restores the session score, the history and the rematch votes', () => {
    const { seed, triple } = seedWithTriple();
    const clock = { t: 0 };
    const { mgr, code } = startedRoom(clock, seed);
    const token = mgr.getRoom(code) && mgr.reconnect('TOKEN1');
    expect(token).toMatchObject({ ok: true, seat: 0 });

    winWithTriple(mgr, code, triple);
    mgr.recycleForRematch(code);
    mgr.setReady(code, 1, true);
    mgr.disconnect(code, 0);

    const back = mgr.reconnect('TOKEN1');
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.code).toBe(code);
    expect(back.view).toBeNull(); // a recycled lobby has no match to resume into
    expect(back.players.map((p) => [p.name, p.wins, p.ready])).toEqual([['Alice', 1, false], ['Bob', 0, true]]);
    expect(mgr.getRoomInfo(code)!.party.matches).toHaveLength(1);
  });
});
