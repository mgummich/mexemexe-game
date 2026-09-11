import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { digestOfState, digestOfView, parseClientMessage, PROTOCOL_VERSION, stateHash } from '../../src/net/protocol';
import { createDeck, dealInitialHands, shuffleDeck } from '../../src/rules/rules';
import { createRng } from '../../src/core/rng';
import type { Card } from '../../src/rules/types';

function testManager(
  seed = 1,
  overrides: Partial<{ disconnectGraceMs: number; idleTimeoutMs: number; maxRooms: number; now: () => number }> = {},
) {
  let codeCounter = 0;
  let tokenCounter = 0;
  const t = 1000;
  return new RoomManager({
    now: () => t,
    genCode: () => `CODE${++codeCounter}`,
    genToken: () => `TOKEN${++tokenCounter}`,
    genSeed: () => seed,
    ...overrides,
  });
}

/** createRoom fails only past MAX_ROOMS; every test below stays well under it, so unwrap the
 * success case and fail loudly if that ever stops being true. */
function mustCreate(mgr: RoomManager, name: string) {
  const result = mgr.createRoom(name);
  if (!result.ok) throw new Error('unexpected room_limit in test setup');
  return result;
}

/** Deal a full room and return both hands + the started room's code/rev, using
 * the same pure deal logic the server uses, so tests can pick real cards. */
function dealFor(seed: number): { hands: Card[][] } {
  const deck = shuffleDeck(createDeck(), createRng(seed));
  return { hands: dealInitialHands(deck, 2).hands };
}

/** Find a seed whose seat-0 hand contains a same-rank triple, for legal-turn tests. */
function findSeedWithSet(): { seed: number; triple: Card[] } {
  for (let seed = 1; seed < 200; seed++) {
    const { hands } = dealFor(seed);
    const hand = hands[0]!.filter((c) => !c.isJoker);
    const byRank = new Map<number, Card[]>();
    for (const c of hand) {
      const arr = byRank.get(c.rank!) ?? [];
      arr.push(c);
      byRank.set(c.rank!, arr);
    }
    for (const arr of byRank.values()) {
      const onePerSuit = new Map<string, Card>();
      for (const card of arr) if (!onePerSuit.has(card.suit!)) onePerSuit.set(card.suit!, card);
      const triple = [...onePerSuit.values()].slice(0, 3);
      if (triple.length === 3) return { seed, triple };
    }
  }
  throw new Error('no seed found with a set in seat 0 hand (test setup bug)');
}

/** Find a seed whose seat-0 hand contains a joker plus a same-rank natural pair, so
 * joker+pair is always a legal group regardless of suits (two decks make same-rank pairs common). */
function findSeedWithJokerAndPair(): { seed: number; joker: Card; pair: [Card, Card]; rest: Card[] } {
  for (let seed = 1; seed < 500; seed++) {
    const { hands } = dealFor(seed);
    const hand = hands[0]!;
    const jokers = hand.filter((c) => c.isJoker);
    if (jokers.length === 0) continue;
    const naturals = hand.filter((c) => !c.isJoker);
    const byRank = new Map<number, Card[]>();
    for (const c of naturals) {
      const arr = byRank.get(c.rank!) ?? [];
      arr.push(c);
      byRank.set(c.rank!, arr);
    }
    for (const arr of byRank.values()) {
      const onePerSuit = new Map<string, Card>();
      for (const card of arr) if (!onePerSuit.has(card.suit!)) onePerSuit.set(card.suit!, card);
      const pair = [...onePerSuit.values()].slice(0, 2) as [Card, Card];
      if (pair.length === 2) {
        const rest = hand.filter((c) => c.id !== jokers[0]!.id && c.id !== pair[0].id && c.id !== pair[1].id);
        return { seed, joker: jokers[0]!, pair, rest };
      }
    }
  }
  throw new Error('no seed found with a joker + same-rank pair in seat 0 hand (test setup bug)');
}

/** Find a real dealt hand containing a same-rank pair from one suit plus a third suit. */
function findSeedWithRepeatedSuitGroup(): { seed: number; cards: [Card, Card, Card] } {
  for (let seed = 1; seed < 2_000; seed++) {
    const hand = dealFor(seed).hands[0]!.filter((card) => !card.isJoker);
    const byRank = new Map<number, Card[]>();
    for (const card of hand) byRank.set(card.rank!, [...(byRank.get(card.rank!) ?? []), card]);
    for (const rankCards of byRank.values()) {
      for (let first = 0; first < rankCards.length - 1; first++) {
        for (let second = first + 1; second < rankCards.length; second++) {
          if (rankCards[first]!.suit !== rankCards[second]!.suit) continue;
          const third = rankCards.find((card) => card.suit !== rankCards[first]!.suit);
          if (third) return { seed, cards: [rankCards[first]!, rankCards[second]!, third] };
        }
      }
    }
  }
  throw new Error('no seed found with a repeated-suit group candidate (test setup bug)');
}

function startRoom(seed: number) {
  const mgr = testManager(seed);
  const { code, token: token0 } = mustCreate(mgr, 'Alice');
  mgr.joinRoom(code, 'Bob');
  mgr.setReady(code, 0, true);
  mgr.setReady(code, 1, true);
  const result = mgr.startGame(code, 0);
  return { mgr, code, token0, started: result.ok && result.started };
}

describe('room lifecycle', () => {
  it('creates a room with seat 0', () => {
    const mgr = testManager();
    const { code, seat, token } = mustCreate(mgr, 'Alice');
    expect(seat).toBe(0);
    expect(token).toBeTruthy();
    expect(mgr.getPlayers(code)).toEqual([{ seat: 0, name: 'Alice', ready: false, connected: true }]);
  });

  it('joins as seat 1', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    const result = mgr.joinRoom(code, 'Bob');
    expect(result).toMatchObject({ ok: true, seat: 1 });
    expect(mgr.getPlayers(code)).toHaveLength(2);
  });

  it('assigns stable clockwise seats through four players and rejects a fifth', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    expect(mgr.joinRoom(code, 'Bob')).toMatchObject({ ok: true, seat: 1 });
    expect(mgr.joinRoom(code, 'Carol')).toMatchObject({ ok: true, seat: 2 });
    expect(mgr.joinRoom(code, 'Dina')).toMatchObject({ ok: true, seat: 3 });
    expect(mgr.joinRoom(code, 'Eve')).toEqual({ ok: false, error: 'room_full' });
  });

  it('rejects joining a room that does not exist', () => {
    const mgr = testManager();
    expect(mgr.joinRoom('NOPE', 'Bob')).toEqual({ ok: false, error: 'room_not_found' });
  });

  it('starts only when host explicitly starts a room with two ready seats', () => {
    const { mgr, code, started } = startRoom(42);
    expect(started).toBe(true);
    const room = mgr.getRoom(code);
    expect(room?.rev).toBe(1);
    expect(room?.state?.phase).toBe('playing');
    expect(room?.state?.players).toHaveLength(2);
    expect(room?.state?.players[0]!.hand).toHaveLength(7);
  });

  it('deals 7+7 from the full 108-card deck, leaving 94 in the draw pile', () => {
    const { mgr, code } = startRoom(42);
    const state = mgr.getRoom(code)!.state!;
    expect(state.players[0]!.hand).toHaveLength(7);
    expect(state.players[1]!.hand).toHaveLength(7);
    expect(state.drawPile).toHaveLength(108 - 14);
    const all = [...state.players.flatMap((p) => p.hand), ...state.drawPile];
    expect(all).toHaveLength(108);
    expect(new Set(all.map((c) => c.id)).size).toBe(108);
  });

  it('does not start until both seats are ready', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.setReady(code, 0, true);
    const result = mgr.startGame(code, 0);
    expect(result.ok && result.started).toBe(false);
    expect(mgr.getRoom(code)?.state).toBeNull();
  });

  it('does not start while a ready lobby player is disconnected', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.setReady(code, 0, true);
    mgr.setReady(code, 1, true);
    mgr.disconnect(code, 1);

    expect(mgr.startGame(code, 0)).toMatchObject({ ok: false, error: 'not_ready' });
    expect(mgr.getRoom(code)?.state).toBeNull();
  });

  it('deals deterministically for three and four ready players and preserves clockwise turns', () => {
    for (const playerCount of [3, 4]) {
      const mgr = testManager(42);
      const { code } = mustCreate(mgr, 'Alice');
      for (const name of ['Bob', 'Carol', 'Dina'].slice(0, playerCount - 1)) mgr.joinRoom(code, name);
      for (let seat = 0; seat < playerCount; seat++) mgr.setReady(code, seat, true);
      expect(mgr.startGame(code, 0)).toMatchObject({ ok: true, started: true });
      const state = mgr.getRoom(code)!.state!;
      expect(state.players).toHaveLength(playerCount);
      expect(state.players.map((p) => p.hand.length)).toEqual(Array(playerCount).fill(7));
      for (let seat = 0; seat < playerCount; seat++) {
        const rev = mgr.getRoom(code)!.rev;
        expect(mgr.drawEndTurn(code, seat, rev).ok).toBe(true);
        expect(mgr.getRoom(code)!.state!.activePlayerIndex).toBe((seat + 1) % playerCount);
      }
    }
  });

  it('rejects non-host start and a start with an unready member', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.setReady(code, 0, true);
    expect(mgr.startGame(code, 1)).toMatchObject({ ok: false, error: 'not_host' });
    expect(mgr.startGame(code, 0)).toMatchObject({ ok: false, error: 'not_ready' });
  });

  it('does not compact stable seats after a lobby leave; host must refill the gap before start', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.joinRoom(code, 'Carol');
    mgr.leaveRoom(code, 1);
    mgr.setReady(code, 0, true);
    mgr.setReady(code, 2, true);
    expect(mgr.startGame(code, 0)).toMatchObject({ ok: false, error: 'seat_gap' });
    expect(mgr.joinRoom(code, 'Dina')).toMatchObject({ ok: true, seat: 1 });
    mgr.setReady(code, 1, true);
    expect(mgr.startGame(code, 0)).toMatchObject({ ok: true, started: true });
    expect(mgr.getRoom(code)!.state!.players.map((p) => p.id)).toEqual(['p0', 'p1', 'p2']);
  });

  it('cleans up an empty room', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    mgr.leaveRoom(code, 0);
    expect(mgr.getRoom(code)).toBeNull();
  });
});

describe('submit_turn validation', () => {
  it('accepts a full legal turn and increments rev', () => {
    const { seed, triple } = findSeedWithSet();
    const { mgr, code } = startRoom(seed);
    const result = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    expect(result).toEqual({ ok: true, gameOver: false });
    const room = mgr.getRoom(code)!;
    expect(room.rev).toBe(2);
    expect(room.state!.table).toHaveLength(1);
    expect(room.state!.activePlayerIndex).toBe(1);
    // Rehydration fidelity: the committed card carries the server's real suit/rank.
    for (const c of triple) {
      const onTable = room.state!.table[0]!.cards.find((tc) => tc.id === c.id)!;
      expect(onTable).toEqual(c);
    }
  });

  it('rejects an invalid meld (too small)', () => {
    const { mgr, code } = startRoom(7);
    const hand = mgr.getRoom(code)!.state!.players[0]!.hand;
    const result = mgr.submitTurn(code, 0, 1, [
      { id: 'm1', cardIds: [hand[0]!.id, hand[1]!.id] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('reason.meldTooSmall');
    expect(mgr.getRoom(code)!.rev).toBe(1); // no mutation
  });

  it('rejects a duplicate card within the proposal', () => {
    const { mgr, code } = startRoom(7);
    const hand = mgr.getRoom(code)!.state!.players[0]!.hand;
    const result = mgr.submitTurn(code, 0, 1, [
      { id: 'm1', cardIds: [hand[0]!.id, hand[0]!.id, hand[1]!.id] },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('reason.duplicateCard');
  });

  it('rejects a repeated-suit group proposal even when cards come from different decks', () => {
    const { seed, cards } = findSeedWithRepeatedSuitGroup();
    const { mgr, code } = startRoom(seed);
    const result = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: cards.map((card) => card.id) }]);
    expect(result).toEqual({ ok: false, reasons: ['reason.groupDuplicateSuit'] });
    expect(mgr.getRoom(code)!.rev).toBe(1);
  });

  it('rejects a proposal that returns a committed table card to hand', () => {
    const { seed, triple } = findSeedWithSet();
    const { mgr, code } = startRoom(seed);
    mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    // Seat 1's turn: submit without including seat 0's committed meld.
    const seat1Hand = mgr.getRoom(code)!.state!.players[1]!.hand;
    const result = mgr.submitTurn(code, 1, 2, [{ id: 'm2', cardIds: [seat1Hand[0]!.id, seat1Hand[1]!.id, seat1Hand[2]!.id] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('reason.cardMissing');
  });

  it('rejects a turn with zero hand cards played', () => {
    const { seed, triple } = findSeedWithSet();
    const { mgr, code } = startRoom(seed);
    mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    // Seat 1 resubmits exactly the existing table, adding nothing from hand.
    const result = mgr.submitTurn(code, 1, 2, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('reason.noHandCard');
  });

  it('rejects an unknown/forged card id (server rehydrates by id, never trusts client cards)', () => {
    const { mgr, code } = startRoom(7);
    const hand = mgr.getRoom(code)!.state!.players[0]!.hand;
    const result = mgr.submitTurn(code, 0, 1, [
      { id: 'm1', cardIds: [hand[0]!.id, hand[1]!.id, 'spades-99'] },
    ]);
    expect(result).toEqual({ ok: false, reasons: ['reason.unknownCard'] });
  });

  it('rejects a proposal from the wrong player', () => {
    const { mgr, code } = startRoom(7);
    const seat1Hand = mgr.getRoom(code)!.state!.players[1]!.hand;
    const result = mgr.submitTurn(code, 1, 1, [{ id: 'm1', cardIds: [seat1Hand[0]!.id] }]);
    expect(result).toEqual({ ok: false, reasons: ['reason.notYourTurn'] });
  });

  it('rejects a stale revision', () => {
    const { mgr, code } = startRoom(7);
    const hand = mgr.getRoom(code)!.state!.players[0]!.hand;
    const result = mgr.submitTurn(code, 0, 999, [{ id: 'm1', cardIds: [hand[0]!.id] }]);
    expect(result).toEqual({ ok: false, reasons: ['reason.staleRevision'] });
  });

  it('rejects an INVALID joker meld proposal with a meld reason', () => {
    const { seed, joker, rest } = findSeedWithJokerAndPair();
    const { mgr, code } = startRoom(seed);
    // joker + two naturals that share neither rank nor suit: no legal run or group.
    const [a, b] = rest;
    const result = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: [joker.id, a!.id, b!.id] }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r !== 'reason.notYourTurn' && r !== 'reason.staleRevision')).toBe(true);
    }
    expect(mgr.getRoom(code)!.rev).toBe(1); // no mutation
  });

  it('rejects a proposal whose meld holds 2 jokers', () => {
    // seat 0 needs both jokers plus at least one natural to anchor the meld.
    let found: { seed: number; jokers: Card[]; natural: Card } | null = null;
    for (let seed = 1; seed < 5000 && !found; seed++) {
      const hand = dealFor(seed).hands[0]!;
      const jokers = hand.filter((c) => c.isJoker);
      const natural = hand.find((c) => !c.isJoker);
      if (jokers.length >= 2 && natural) found = { seed, jokers: jokers.slice(0, 2), natural };
    }
    expect(found).not.toBeNull();
    const { mgr, code } = startRoom(found!.seed);
    const cardIds = [found!.natural.id, found!.jokers[0]!.id, found!.jokers[1]!.id];
    const result = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons).toContain('reason.tooManyJokers');
    expect(mgr.getRoom(code)!.rev).toBe(1); // no mutation
  });

  it('accepts a VALID joker meld proposal; the authoritative table holds the joker\'s own card id, not the assigned value', () => {
    const { seed, joker, pair } = findSeedWithJokerAndPair();
    const { mgr, code } = startRoom(seed);
    const result = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: [joker.id, pair[0].id, pair[1].id] }]);
    expect(result).toEqual({ ok: true, gameOver: false });
    const table = mgr.getRoom(code)!.state!.table;
    const meld = table.find((m) => m.id === 'm1')!;
    const onTable = meld.cards.find((c) => c.id === joker.id)!;
    expect(onTable).toEqual(joker); // identity preserved: still a joker, still this joker's id
    expect(onTable.isJoker).toBe(true);
  });

  it('rejects a double submit (resubmitting the same already-applied rev)', () => {
    const { seed, triple } = findSeedWithSet();
    const { mgr, code } = startRoom(seed);
    const first = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    expect(first.ok).toBe(true);
    // Same seat, same rev, resubmitted: turn already advanced past both, so
    // whichever check fires first (seat or rev), it must be rejected and the
    // state must not mutate again.
    const second = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    expect(second.ok).toBe(false);
    expect(mgr.getRoom(code)!.rev).toBe(2);
  });
});

describe('draw / end turn', () => {
  it('draws a card, advances the turn, and increments rev', () => {
    const { mgr, code } = startRoom(7);
    const before = mgr.getRoom(code)!.state!;
    const result = mgr.drawEndTurn(code, 0, 1);
    expect(result).toEqual({ ok: true, gameOver: false });
    const after = mgr.getRoom(code)!;
    expect(after.rev).toBe(2);
    expect(after.state!.players[0]!.hand.length).toBe(before.players[0]!.hand.length + 1);
    expect(after.state!.activePlayerIndex).toBe(1);
  });

  it('resolves an empty-pile stalemate (fewest cards wins)', () => {
    const { mgr, code } = startRoom(7);
    // Drain the draw pile via alternating draws, then run past the
    // consecutive-empty-draw threshold to trigger the stalemate.
    let room = mgr.getRoom(code)!;
    let rev = room.rev;
    while (room.state!.drawPile.length > 0) {
      const active = room.state!.activePlayerIndex;
      const result = mgr.drawEndTurn(code, active, rev);
      expect(result.ok).toBe(true);
      rev++;
      room = mgr.getRoom(code)!;
    }
    let gameOver = false;
    for (let i = 0; i < 5 && !gameOver; i++) {
      const active = room.state!.activePlayerIndex;
      const result = mgr.drawEndTurn(code, active, rev);
      expect(result.ok).toBe(true);
      if (result.ok) gameOver = result.gameOver;
      rev++;
      room = mgr.getRoom(code)!;
    }
    expect(gameOver).toBe(true);
    expect(room.state!.phase).toBe('finished');
    expect(room.state!.winnerId).not.toBeNull();
  });

  it('conservation holds across a submit + draw sequence', () => {
    const { seed, triple } = findSeedWithSet();
    const { mgr, code } = startRoom(seed);
    const submitResult = mgr.submitTurn(code, 0, 1, [{ id: 'm1', cardIds: triple.map((c) => c.id) }]);
    expect(submitResult.ok).toBe(true);
    const afterSubmit = mgr.getRoom(code)!.state!;
    const drawResult = mgr.drawEndTurn(code, 1, 2);
    expect(drawResult.ok).toBe(true);
    const afterDraw = mgr.getRoom(code)!.state!;
    for (const state of [afterSubmit, afterDraw]) {
      const all = [...state.players.flatMap((p) => p.hand), ...state.table.flatMap((m) => m.cards), ...state.drawPile];
      expect(all).toHaveLength(108);
      expect(new Set(all.map((c) => c.id)).size).toBe(108);
    }
  });

  it('rejects draw_end_turn from the wrong player or a stale rev', () => {
    const { mgr, code } = startRoom(7);
    expect(mgr.drawEndTurn(code, 1, 1)).toEqual({ ok: false, reasons: ['reason.notYourTurn'] });
    expect(mgr.drawEndTurn(code, 0, 5)).toEqual({ ok: false, reasons: ['reason.staleRevision'] });
  });
});

describe('disconnect / reconnect', () => {
  it('marks a seat disconnected and lets it reconnect with the right token', () => {
    const mgr = testManager();
    const { code, token } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.disconnect(code, 0);
    expect(mgr.getPlayers(code)).toContainEqual({ seat: 0, name: 'Alice', ready: false, connected: false });

    const result = mgr.reconnect(token);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.seat).toBe(0);
    expect(mgr.getPlayers(code)).toContainEqual({ seat: 0, name: 'Alice', ready: false, connected: true });
  });

  it('rejects reconnect with a bad token', () => {
    const mgr = testManager();
    mustCreate(mgr, 'Alice');
    expect(mgr.reconnect('not-a-real-token')).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('a disconnect mid-turn discards only the client-side draft: the reconnected view is the last committed state', () => {
    // The Mexe draft never leaves the client until FEITO, so there is nothing server-side to lose.
    // This pins that: the view before and after a disconnect/reconnect of the *active* seat is
    // byte-identical, and the seat's hand is untouched.
    const { mgr, code, token0 } = startRoom(7);
    const before = mgr.getView(code, 0);
    mgr.disconnect(code, 0);
    const result = mgr.reconnect(token0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view).toEqual(before);
    expect(result.view?.players[0]?.hand?.length).toBe(7);
    // ...and the seat is still the active one, so the player resumes the same turn.
    expect(result.view?.activeSeat).toBe(0);
  });
});

describe('lifecycle and liveness (docs/archive/PHASE5_SERVER_REVIEW.md S1-S5)', () => {
  it('S2: leaving mid-game ends the room for the survivor instead of leaving a dead board', () => {
    const { mgr, code } = startRoom(7);
    const result = mgr.leaveRoom(code, 1);
    expect(result).toEqual({ roomClosed: true });
    expect(mgr.getRoom(code)).toBeNull();
  });

  it('leaving a lobby (no game started) with a seat still occupied does not close the room', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    const result = mgr.leaveRoom(code, 1);
    expect(result).toEqual({ roomClosed: false });
    expect(mgr.getRoom(code)).not.toBeNull();
  });

  it('S1: sweep reports codes for rooms with every seat disconnected past the grace window (the caller must notify+detach those sockets)', () => {
    let now = 1000;
    const mgr = testManager(7, { now: () => now, disconnectGraceMs: 1000 });
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.disconnect(code, 0);
    mgr.disconnect(code, 1);
    now += 2000; // past the 1000ms grace
    const removed = mgr.sweep();
    expect(removed).toContain(code);
    expect(mgr.getRoom(code)).toBeNull();
  });

  it('S3: a live lobby with both seats connected is never reaped by the idle timeout', () => {
    let now = 1000;
    const mgr = testManager(7, { now: () => now, idleTimeoutMs: 1000 });
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    now += 10 * 60_000; // way past idleTimeoutMs, but both seats stay connected
    const removed = mgr.sweep();
    expect(removed).not.toContain(code);
    expect(mgr.getRoom(code)).not.toBeNull();
  });

  it('S3: idle timeout still applies as a backstop once nobody is connected', () => {
    let now = 1000;
    const mgr = testManager(7, { now: () => now, idleTimeoutMs: 1000, disconnectGraceMs: 60_000 });
    const { code } = mustCreate(mgr, 'Alice');
    mgr.joinRoom(code, 'Bob');
    mgr.disconnect(code, 0);
    mgr.disconnect(code, 1);
    now += 2000; // past idleTimeoutMs, but not past the (much longer) disconnect grace
    const removed = mgr.sweep();
    expect(removed).toContain(code);
  });

  it('S5: createRoom rejects with room_limit once at capacity', () => {
    const mgr = testManager(1, { maxRooms: 2 });
    expect(mustCreate(mgr, 'A').code).toBeTruthy();
    expect(mustCreate(mgr, 'B').code).toBeTruthy();
    const third = mgr.createRoom('C');
    expect(third).toEqual({ ok: false, error: 'room_limit' });
    expect(mgr.roomCount()).toBe(2);
  });

  it('S6: submitting an opponent-hand card id is rejected as unknownCard (not relying on the downstream foreignCard check)', () => {
    const { mgr, code } = startRoom(7);
    const opponentHand = mgr.getRoom(code)!.state!.players[1]!.hand;
    const ownHand = mgr.getRoom(code)!.state!.players[0]!.hand;
    const result = mgr.submitTurn(code, 0, 1, [
      { id: 'm1', cardIds: [ownHand[0]!.id, opponentHand[0]!.id] },
    ]);
    expect(result).toEqual({ ok: false, reasons: ['reason.unknownCard'] });
  });
});

describe('redaction', () => {
  it('never includes seat 1 hand ids or draw-pile ids in seat 0 view', () => {
    const { mgr, code } = startRoom(7);
    const room = mgr.getRoom(code)!;
    const hiddenIds = [
      ...room.state!.players[1]!.hand.map((c) => c.id),
      ...room.state!.drawPile.map((c) => c.id),
    ];
    const view = mgr.getView(code, 0)!;
    const serialized = JSON.stringify(view);
    for (const id of hiddenIds) {
      expect(serialized.includes(`"${id}"`)).toBe(false);
    }
    expect(view.players.find((p) => p.seat === 1)!.hand).toBeUndefined();
    expect(view.drawCount).toBe(room.state!.drawPile.length);
  });
});

describe('parseClientMessage boundary validation', () => {
  const good = (extra: Record<string, unknown>) => JSON.stringify({ v: PROTOCOL_VERSION, reqId: 'r1', ...extra });

  it('never throws and rejects malformed input', () => {
    const cases = [
      'not json at all',
      '{}',
      '[]',
      'null',
      JSON.stringify({ v: 1, type: 'ping', reqId: 'r1' }), // wrong (stale) protocol version
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'nonsense_type', reqId: 'r1' }), // unknown type
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'ready', reqId: 'r1', ready: 'yes' }), // wrong field type
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'submit_turn', reqId: 'r1', rev: 'one', melds: [] }), // bad rev type
      good({ type: 'submit_turn', rev: 1 }), // missing melds
      good({ type: 'submit_turn', rev: 1, melds: Array.from({ length: 61 }, () => ({ id: 'm', cardIds: [] })) }), // oversized
      good({
        type: 'submit_turn',
        rev: 1,
        melds: [{ id: 'm', cardIds: Array.from({ length: 61 }, (_, i) => `c${i}`) }],
      }), // oversized cardIds
      good({ type: 'join_room', code: 123, name: 'Bob' }), // wrong type for code
    ];
    for (const raw of cases) {
      expect(() => parseClientMessage(raw)).not.toThrow();
      const result = parseClientMessage(raw);
      expect('error' in result).toBe(true);
    }
  });

  it('drops any extra client-supplied fields on a meld (ids only ever cross the wire)', () => {
    const raw = JSON.stringify({
      v: PROTOCOL_VERSION,
      type: 'submit_turn',
      reqId: 'r1',
      rev: 1,
      melds: [{ id: 'm1', cardIds: ['hearts-3-d0'], suit: 'spades', rank: 9 }],
    });
    const result = parseClientMessage(raw);
    expect('error' in result).toBe(false);
    if (!('error' in result) && result.type === 'submit_turn') {
      expect(result.melds).toEqual([{ id: 'm1', cardIds: ['hearts-3-d0'] }]);
    }
  });

  it('accepts a well-formed ping', () => {
    const result = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping', reqId: 'r1' }));
    expect(result).toEqual({ v: PROTOCOL_VERSION, type: 'ping', reqId: 'r1' });
  });

  it('rejects a message with no type field at all', () => {
    const result = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, reqId: 'r1' }));
    expect(result).toEqual({ error: 'missing type' });
  });

  it('rejects a message with no reqId field at all', () => {
    const result = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' }));
    expect(result).toEqual({ error: 'missing reqId' });
  });

  it('rejects create_room with a non-string name', () => {
    const result = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'create_room', reqId: 'r1', name: 42 }));
    expect(result).toEqual({ error: 'bad name' });
  });
});

describe('protocol v3 additions', () => {
  it('accepts a well-formed resync', () => {
    const result = parseClientMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'resync', reqId: 'r9' }));
    expect(result).toEqual({ v: PROTOCOL_VERSION, type: 'resync', reqId: 'r9' });
  });

  it('every seat view of one revision carries the same hash, and it matches the server state', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Host');
    mgr.joinRoom(code, 'Guest');
    mgr.setReady(code, 0, true);
    mgr.setReady(code, 1, true);
    mgr.startGame(code, 0);
    const room = mgr.getRoom(code)!;
    const v0 = mgr.getView(code, 0)!;
    const v1 = mgr.getView(code, 1)!;
    // Hidden cards are excluded from the digest by construction, so seats agree despite
    // seeing different hands.
    expect(v0.hash).toBe(v1.hash);
    expect(v0.hash).toBe(stateHash(digestOfState(room.state!, room.rev)));
    expect(v0.hash).toBe(stateHash(digestOfView(v0)));
  });

  it('a diverged reconstruction hashes differently', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Host');
    mgr.joinRoom(code, 'Guest');
    mgr.setReady(code, 0, true);
    mgr.setReady(code, 1, true);
    mgr.startGame(code, 0);
    const view = mgr.getView(code, 0)!;
    const drifted = { ...digestOfView(view), drawCount: view.drawCount - 1 };
    expect(stateHash(drifted)).not.toBe(view.hash);
  });
});

describe('stalled-turn recovery', () => {
  function started3P(clock: { t: number }, graceMs: number) {
    const mgr = new RoomManager({
      now: () => clock.t,
      genCode: () => 'STALL',
      genToken: () => `T${Math.random()}`,
      genSeed: () => 7,
      disconnectGraceMs: graceMs,
    });
    const created = mgr.createRoom('Host');
    if (!created.ok) throw new Error('setup');
    mgr.joinRoom('STALL', 'B');
    mgr.joinRoom('STALL', 'C');
    for (const seat of [0, 1, 2]) mgr.setReady('STALL', seat, true);
    mgr.startGame('STALL', 0);
    return mgr;
  }

  it('does not touch a match whose active seat is still connected', () => {
    const clock = { t: 1000 };
    const mgr = started3P(clock, 100);
    clock.t += 10_000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
  });

  it('waits out the grace period before acting', () => {
    const clock = { t: 1000 };
    const mgr = started3P(clock, 5000);
    mgr.disconnect('STALL', 0);
    clock.t += 1000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
    expect(mgr.getRoom('STALL')!.state!.activePlayerIndex).toBe(0);
  });

  it('draws and ends the turn for a seat gone past the grace period', () => {
    const clock = { t: 1000 };
    const mgr = started3P(clock, 5000);
    const revBefore = mgr.getRoom('STALL')!.rev;
    const drawBefore = mgr.getRoom('STALL')!.state!.drawPile.length;
    mgr.disconnect('STALL', 0);
    clock.t += 6000;
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'STALL', gameOver: false, timedOut: 0 }]);
    const room = mgr.getRoom('STALL')!;
    expect(room.state!.activePlayerIndex).toBe(1);
    expect(room.rev).toBe(revBefore + 1);
    expect(room.state!.drawPile.length).toBe(drawBefore - 1);
  });

  it('leaves an entirely empty room to the sweep instead of advancing it', () => {
    const clock = { t: 1000 };
    const mgr = started3P(clock, 5000);
    for (const seat of [0, 1, 2]) mgr.disconnect('STALL', seat);
    clock.t += 6000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
  });
});

describe('load: repeated room churn', () => {
  it('ten sequential create/join/leave cycles leave no room behind', () => {
    let counter = 0;
    const clock = { t: 1000 };
    const mgr = new RoomManager({
      now: () => clock.t,
      genCode: () => `R${++counter}`,
      genToken: () => `TK${counter}-${Math.random()}`,
      genSeed: () => 3,
      disconnectGraceMs: 1000,
    });
    for (let i = 0; i < 10; i++) {
      const created = mgr.createRoom('Host');
      if (!created.ok) throw new Error('unexpected room_limit');
      mgr.joinRoom(created.code, 'Guest');
      mgr.leaveRoom(created.code, 1);
      mgr.leaveRoom(created.code, 0);
      clock.t += 100;
    }
    expect(mgr.roomCount()).toBe(0);
    expect(mgr.sweep()).toEqual([]);
  });

  it('abandoned rooms are reaped by the sweep rather than accumulating', () => {
    let counter = 0;
    const clock = { t: 1000 };
    const mgr = new RoomManager({
      now: () => clock.t,
      genCode: () => `A${++counter}`,
      genToken: () => `TK${counter}`,
      genSeed: () => 3,
      disconnectGraceMs: 1000,
    });
    for (let i = 0; i < 10; i++) {
      const created = mgr.createRoom('Host');
      if (!created.ok) throw new Error('unexpected room_limit');
      mgr.disconnect(created.code, 0);
    }
    expect(mgr.roomCount()).toBe(10);
    clock.t += 5000;
    expect(mgr.sweep()).toHaveLength(10);
    expect(mgr.roomCount()).toBe(0);
  });
});

describe('per-room isolation and crash policy', () => {
  function startedRoom(mgr: RoomManager, code: string) {
    mustCreate(mgr, 'Host');
    mgr.joinRoom(code, 'B');
    mgr.joinRoom(code, 'C');
    for (const seat of [0, 1, 2]) mgr.setReady(code, seat, true);
    mgr.startGame(code, 0);
  }

  it('a corrupt room is dropped without stopping other stalled rooms from advancing', () => {
    const clock = { t: 1000 };
    const mgr = testManager(1, { disconnectGraceMs: 100, now: () => clock.t });
    startedRoom(mgr, 'CODE1');
    startedRoom(mgr, 'CODE2');
    // Break card conservation in CODE1 so its stalled-turn advance throws.
    mgr.getRoom('CODE1')!.state!.drawPile.pop();
    mgr.disconnect('CODE1', 0);
    mgr.disconnect('CODE2', 0);
    clock.t += 1000;
    expect(mgr.advanceStalledTurns()).toEqual([
      { code: 'CODE1', gameOver: false, crashed: true },
      { code: 'CODE2', gameOver: false, timedOut: 0 },
    ]);
    expect(mgr.getRoom('CODE1')).toBeNull();
    expect(mgr.getRoom('CODE2')!.state!.activePlayerIndex).toBe(1);
  });

  it('deleteRoom drops a room outright', () => {
    const mgr = testManager();
    const { code } = mustCreate(mgr, 'Host');
    mgr.deleteRoom(code);
    expect(mgr.getRoom(code)).toBeNull();
    expect(mgr.roomCount()).toBe(0);
  });
});

describe('submit_turn card-count cap', () => {
  // A proposal carries the whole draft table plus the hand cards being played, so it is bounded by
  // the 108-card deck, not by a hand. Capping it lower rejected a legal late-game rearrangement as
  // a generic `bad_message` rather than a proposal result (Phase 18 finding 2).
  const submitWith = (n: number) =>
    parseClientMessage(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'submit_turn',
        reqId: 'r1',
        rev: 1,
        melds: Array.from({ length: Math.ceil(n / 3) }, (_, m) => ({
          id: `m${m}`,
          cardIds: Array.from({ length: Math.min(3, n - m * 3) }, (_, i) => `clubs-${i + 2}-d0-${m}`),
        })),
      }),
    );

  it('accepts a proposal carrying every card in the deck', () => {
    const parsed = submitWith(108);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.type === 'submit_turn' && parsed.melds.flatMap((m) => m.cardIds).length).toBe(108);
  });

  it('still rejects a proposal carrying more cards than any deck could hold', () => {
    expect('error' in submitWith(123)).toBe(true);
  });
});

describe('join_room code cap', () => {
  it('rejects an oversized room code before it reaches the manager', () => {
    const long = parseClientMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'join_room', reqId: 'r1', code: 'X'.repeat(17), name: 'A' }),
    );
    expect('error' in long).toBe(true);
    const empty = parseClientMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'join_room', reqId: 'r1', code: '', name: 'A' }),
    );
    expect('error' in empty).toBe(true);
    const ok = parseClientMessage(
      JSON.stringify({ v: PROTOCOL_VERSION, type: 'join_room', reqId: 'r1', code: 'BCDFG', name: 'A' }),
    );
    expect('error' in ok).toBe(false);
  });
});
