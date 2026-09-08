import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  applyConfirmedTurn,
  canConfirmTurn,
  checkWinner,
  createDeck,
  dealInitialHands,
  deserializeGameState,
  drawAndEndTurn,
  getInvalidMeldReasons,
  isValidMeld,
  isValidRun,
  isValidSet,
  serializeGameState,
  shuffleDeck,
  validateTable,
} from '../src/rules/rules';
import type { Card, DraftState, GameState, Rank, Suit } from '../src/rules/types';
import { RulesError } from '../src/rules/types';
import { createNewGame } from '../src/game-state/store';

function c(suit: Suit, rank: number): Card {
  return { id: `${suit}-${rank}`, suit, rank: rank as Rank };
}

describe('createDeck', () => {
  it('makes 52 unique cards', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((x) => x.id)).size).toBe(52);
  });
});

describe('shuffleDeck', () => {
  it('is deterministic for same seed', () => {
    const a = shuffleDeck(createDeck(), createRng(42));
    const b = shuffleDeck(createDeck(), createRng(42));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });
  it('differs across seeds and keeps all cards', () => {
    const a = shuffleDeck(createDeck(), createRng(1));
    const b = shuffleDeck(createDeck(), createRng(2));
    expect(a.map((x) => x.id)).not.toEqual(b.map((x) => x.id));
    expect(new Set(a.map((x) => x.id)).size).toBe(52);
  });
  it('does not mutate input', () => {
    const deck = createDeck();
    const ids = deck.map((x) => x.id);
    shuffleDeck(deck, createRng(7));
    expect(deck.map((x) => x.id)).toEqual(ids);
  });
});

describe('dealInitialHands', () => {
  it('deals 7 to each player', () => {
    const { hands, drawPile } = dealInitialHands(createDeck(), 3);
    expect(hands).toHaveLength(3);
    hands.forEach((h) => expect(h).toHaveLength(7));
    expect(drawPile).toHaveLength(52 - 21);
  });
  it('rejects bad player counts', () => {
    expect(() => dealInitialHands(createDeck(), 1)).toThrow(RulesError);
    expect(() => dealInitialHands(createDeck(), 5)).toThrow(RulesError);
  });
});

describe('isValidRun', () => {
  it('accepts 3+ sequential same suit', () => {
    expect(isValidRun([c('hearts', 3), c('hearts', 4), c('hearts', 5)])).toBe(true);
    expect(isValidRun([c('spades', 10), c('spades', 11), c('spades', 12), c('spades', 13)])).toBe(true);
  });
  it('accepts unsorted input', () => {
    expect(isValidRun([c('hearts', 5), c('hearts', 3), c('hearts', 4)])).toBe(true);
  });
  it('ace low: A-2-3 valid', () => {
    expect(isValidRun([c('clubs', 1), c('clubs', 2), c('clubs', 3)])).toBe(true);
  });
  it('no wrap: Q-K-A and K-A-2 invalid', () => {
    expect(isValidRun([c('clubs', 12), c('clubs', 13), c('clubs', 1)])).toBe(false);
    expect(isValidRun([c('clubs', 13), c('clubs', 1), c('clubs', 2)])).toBe(false);
  });
  it('rejects short, mixed suit, gaps', () => {
    expect(isValidRun([c('hearts', 3), c('hearts', 4)])).toBe(false);
    expect(isValidRun([c('hearts', 3), c('spades', 4), c('hearts', 5)])).toBe(false);
    expect(isValidRun([c('hearts', 3), c('hearts', 5), c('hearts', 6)])).toBe(false);
  });
});

describe('isValidSet', () => {
  it('accepts 3 or 4 same rank', () => {
    expect(isValidSet([c('hearts', 9), c('spades', 9), c('clubs', 9)])).toBe(true);
    expect(isValidSet([c('hearts', 9), c('spades', 9), c('clubs', 9), c('diamonds', 9)])).toBe(true);
  });
  it('rejects short and mixed rank', () => {
    expect(isValidSet([c('hearts', 9), c('spades', 9)])).toBe(false);
    expect(isValidSet([c('hearts', 9), c('spades', 9), c('clubs', 8)])).toBe(false);
  });
});

describe('isValidMeld / validateTable / reasons', () => {
  it('meld = run or set', () => {
    expect(isValidMeld([c('hearts', 1), c('hearts', 2), c('hearts', 3)])).toBe(true);
    expect(isValidMeld([c('hearts', 9), c('spades', 9), c('clubs', 9)])).toBe(true);
    expect(isValidMeld([c('hearts', 1), c('spades', 2), c('clubs', 3)])).toBe(false);
  });
  it('validateTable + reasons', () => {
    const good = { id: 'm1', cards: [c('hearts', 1), c('hearts', 2), c('hearts', 3)] };
    const small = { id: 'm2', cards: [c('spades', 5), c('spades', 6)] };
    const junk = { id: 'm3', cards: [c('spades', 5), c('hearts', 9), c('clubs', 13)] };
    expect(validateTable([good])).toBe(true);
    expect(validateTable([good, small])).toBe(false);
    const reasons = getInvalidMeldReasons([good, small, junk]);
    expect(reasons).toEqual([
      { meldId: 'm2', reason: 'reason.meldTooSmall' },
      { meldId: 'm3', reason: 'reason.notAMeld' },
    ]);
  });
});

function fixtureState(): GameState {
  // Hand-built state: p0 hand has a ready set of 9s + extras; table has one run.
  return {
    seed: 1,
    players: [
      {
        id: 'p0', name: 'A', isAi: false,
        hand: [c('hearts', 9), c('spades', 9), c('clubs', 9), c('diamonds', 2), c('diamonds', 7)],
      },
      { id: 'p1', name: 'B', isAi: true, aiType: 'simple', hand: [c('clubs', 4), c('clubs', 5)] },
    ],
    activePlayerIndex: 0,
    table: [{ id: 't1', cards: [c('hearts', 3), c('hearts', 4), c('hearts', 5)] }],
    drawPile: [c('spades', 13), c('spades', 12)],
    turn: 1,
    winnerId: null,
    phase: 'playing',
    consecutiveDraws: 0,
  };
}

describe('canConfirmTurn', () => {
  const state = fixtureState();
  const tableRun = state.table[0]!;

  it('accepts valid draft with hand card added', () => {
    const draft: DraftState = {
      melds: [tableRun, { id: 'd1', cards: [c('hearts', 9), c('spades', 9), c('clubs', 9)] }],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    expect(canConfirmTurn(state, draft)).toEqual({ ok: true });
  });

  it('rejects confirm without adding hand card', () => {
    const draft: DraftState = { melds: [tableRun], handCardsPlayed: [] };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.noHandCard');
  });

  it('rejects table card removed (illegal return to hand)', () => {
    const draft: DraftState = {
      melds: [
        { id: 't1', cards: [c('hearts', 3), c('hearts', 4)] }, // hearts-5 vanished
        { id: 'd1', cards: [c('hearts', 9), c('spades', 9), c('clubs', 9)] },
      ],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.cardMissing');
  });

  it('rejects duplicate card ids', () => {
    const draft: DraftState = {
      melds: [
        tableRun,
        { id: 'd1', cards: [c('hearts', 9), c('hearts', 9), c('spades', 9), c('clubs', 9)] },
      ],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.duplicateCard');
  });

  it('rejects foreign cards (not in table or hand)', () => {
    const draft: DraftState = {
      melds: [
        tableRun,
        { id: 'd1', cards: [c('diamonds', 11), c('diamonds', 12), c('diamonds', 13)] },
      ],
      handCardsPlayed: [],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.foreignCard');
  });

  it('temporary invalid draft rejected as final, valid draft accepted', () => {
    const invalidDraft: DraftState = {
      melds: [
        { id: 't1', cards: [c('hearts', 3), c('hearts', 4), c('hearts', 5), c('diamonds', 2)] },
      ],
      handCardsPlayed: ['diamonds-2'],
    };
    const r = canConfirmTurn(state, invalidDraft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.notAMeld');

    const validDraft: DraftState = {
      melds: [
        { id: 't1', cards: [c('hearts', 2), c('hearts', 3), c('hearts', 4), c('hearts', 5)] },
      ],
      handCardsPlayed: ['hearts-2'],
    };
    const stateWithH2: GameState = {
      ...state,
      players: [
        { ...state.players[0]!, hand: [...state.players[0]!.hand, c('hearts', 2)] },
        state.players[1]!,
      ],
    };
    expect(canConfirmTurn(stateWithH2, validDraft)).toEqual({ ok: true });
  });
});

describe('applyConfirmedTurn', () => {
  it('moves cards from hand, replaces table, advances turn', () => {
    const state = fixtureState();
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [c('hearts', 9), c('spades', 9), c('clubs', 9)] }],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const next = applyConfirmedTurn(state, draft);
    expect(next.players[0]!.hand.map((x) => x.id)).toEqual(['diamonds-2', 'diamonds-7']);
    expect(next.table).toHaveLength(2);
    expect(next.activePlayerIndex).toBe(1);
    expect(next.turn).toBe(2);
    expect(next.winnerId).toBeNull();
  });

  it('throws on illegal draft', () => {
    const state = fixtureState();
    expect(() => applyConfirmedTurn(state, { melds: [], handCardsPlayed: [] })).toThrow(RulesError);
  });

  it('detects win when hand empties', () => {
    const state = fixtureState();
    state.players[0]!.hand = [c('hearts', 9), c('spades', 9), c('clubs', 9)];
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [c('hearts', 9), c('spades', 9), c('clubs', 9)] }],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const next = applyConfirmedTurn(state, draft);
    expect(next.winnerId).toBe('p0');
    expect(next.phase).toBe('finished');
  });
});

describe('drawAndEndTurn', () => {
  it('draws 1 and passes turn', () => {
    const state = fixtureState();
    const next = drawAndEndTurn(state);
    expect(next.players[0]!.hand).toHaveLength(6);
    expect(next.players[0]!.hand.at(-1)!.id).toBe('spades-13');
    expect(next.drawPile).toHaveLength(1);
    expect(next.activePlayerIndex).toBe(1);
  });
  it('empty pile: turn still passes, no crash', () => {
    const state = { ...fixtureState(), drawPile: [] };
    const next = drawAndEndTurn(state);
    expect(next.players[0]!.hand).toHaveLength(5);
    expect(next.activePlayerIndex).toBe(1);
  });
});

describe('checkWinner', () => {
  it('null while all hands non-empty; id when empty', () => {
    const state = fixtureState();
    expect(checkWinner(state)).toBeNull();
    state.players[1]!.hand = [];
    expect(checkWinner(state)).toBe('p1');
  });
});

describe('serialize/deserialize', () => {
  it('round-trips a real game', () => {
    const state = createNewGame(123, [
      { name: 'A', isAi: false },
      { name: 'B', isAi: true, aiType: 'simple' },
    ]);
    const back = deserializeGameState(serializeGameState(state));
    expect(back).toEqual(state);
  });
  it('rejects garbage, missing cards, duplicate ids', () => {
    expect(() => deserializeGameState('not json')).toThrow(RulesError);
    expect(() => deserializeGameState('{"players":[]}')).toThrow(RulesError);
    const state = createNewGame(123, [
      { name: 'A', isAi: false },
      { name: 'B', isAi: true },
    ]);
    const missing = { ...state, drawPile: state.drawPile.slice(1) };
    expect(() => deserializeGameState(JSON.stringify(missing))).toThrow(RulesError);
    const duped = { ...state, drawPile: [state.drawPile[0]!, ...state.drawPile] };
    expect(() => deserializeGameState(JSON.stringify(duped))).toThrow(RulesError);
  });
});

describe('createNewGame determinism', () => {
  it('same seed same deal', () => {
    const cfg = [
      { name: 'A', isAi: false },
      { name: 'B', isAi: true },
    ];
    const a = createNewGame(999, cfg);
    const b = createNewGame(999, cfg);
    expect(serializeGameState(a)).toBe(serializeGameState(b));
  });
});

describe('stalemate', () => {
  it('empty pile + full round of draws ends game, fewest cards wins', () => {
    let state = fixtureState();
    state = { ...state, drawPile: [] };
    state = drawAndEndTurn(state); // p0 passes
    expect(state.phase).toBe('playing');
    state = drawAndEndTurn(state); // p1 passes -> stalemate
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBe('p1'); // p1 has 2 cards vs p0's 5
  });

  function threePlayerState(): GameState {
    return {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [c('hearts', 2), c('hearts', 6)] },
        { id: 'p1', name: 'B', isAi: false, hand: [c('clubs', 4)] },
        { id: 'p2', name: 'C', isAi: false, hand: [c('diamonds', 8), c('diamonds', 9), c('spades', 1)] },
      ],
      activePlayerIndex: 0,
      table: [],
      drawPile: [],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      consecutiveDraws: 0,
    };
  }

  function fourPlayerState(): GameState {
    const s = threePlayerState();
    return {
      ...s,
      players: [...s.players, { id: 'p3', name: 'D', isAi: false, hand: [c('spades', 5), c('spades', 6)] }],
    };
  }

  it('3-player turn order cycles 0->1->2->0 via drawAndEndTurn', () => {
    let state = threePlayerState();
    expect(state.activePlayerIndex).toBe(0);
    state = drawAndEndTurn(state);
    expect(state.activePlayerIndex).toBe(1);
    state = drawAndEndTurn(state);
    expect(state.activePlayerIndex).toBe(2);
    state = drawAndEndTurn(state);
    expect(state.activePlayerIndex).toBe(0);
  });

  it('4-player turn order cycles 0->1->2->3->0 via drawAndEndTurn', () => {
    let state = fourPlayerState();
    for (const expected of [1, 2, 3, 0]) {
      state = drawAndEndTurn(state);
      expect(state.activePlayerIndex).toBe(expected);
    }
  });

  it('applyConfirmedTurn also cycles turn order for 3 players', () => {
    let state = threePlayerState();
    state = { ...state, table: [{ id: 't1', cards: [c('hearts', 3), c('hearts', 4), c('hearts', 5)] }] };
    // Extend the table run with p0's hearts-2.
    const validDraft: DraftState = {
      melds: [{ id: 't1', cards: [c('hearts', 2), c('hearts', 3), c('hearts', 4), c('hearts', 5)] }],
      handCardsPlayed: ['hearts-2'],
    };
    const next = applyConfirmedTurn(state, validDraft);
    expect(next.activePlayerIndex).toBe(1);
  });

  it('3-player deck exhaustion: fewest cards wins, tie goes to earliest seat', () => {
    let state = threePlayerState(); // p0:2, p1:1, p2:3 cards, empty pile
    state = drawAndEndTurn(state); // p0 passes
    state = drawAndEndTurn(state); // p1 passes
    state = drawAndEndTurn(state); // p2 passes -> stalemate, full round
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBe('p1'); // fewest cards (1)
  });

  it('4-player deck exhaustion tie: earliest seat wins', () => {
    // p0 and p1 tie for fewest cards (1 each); p0 must win as earliest seat.
    let state: GameState = {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [c('hearts', 2)] },
        { id: 'p1', name: 'B', isAi: false, hand: [c('clubs', 4)] },
        { id: 'p2', name: 'C', isAi: false, hand: [c('diamonds', 8), c('diamonds', 9), c('spades', 1)] },
        { id: 'p3', name: 'D', isAi: false, hand: [c('spades', 5), c('spades', 6)] },
      ],
      activePlayerIndex: 0,
      table: [],
      drawPile: [],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      consecutiveDraws: 0,
    };
    for (let i = 0; i < 4; i++) state = drawAndEndTurn(state);
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBe('p0');
  });
});

describe('win only via confirm, never via drawAndEndTurn', () => {
  it('drawAndEndTurn never sets winnerId while pile is non-empty, even with a zero-hand player present', () => {
    const state = fixtureState();
    // Contrive an already-empty-hand player: drawAndEndTurn must not "discover" this
    // as a win — checkWinner only ever runs inside applyConfirmedTurn.
    const weird: GameState = { ...state, players: [{ ...state.players[0]!, hand: [] }, state.players[1]!] };
    const next = drawAndEndTurn(weird);
    expect(next.winnerId).toBeNull();
    expect(next.phase).toBe('playing');
  });

  it('a player reaching 0 cards sets winnerId only through applyConfirmedTurn', () => {
    const state = fixtureState();
    state.players[0]!.hand = [c('hearts', 9), c('spades', 9), c('clubs', 9)];
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [c('hearts', 9), c('spades', 9), c('clubs', 9)] }],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const next = applyConfirmedTurn(state, draft);
    expect(next.winnerId).toBe('p0');
  });
});

describe('empty melds and empty tables', () => {
  it('an explicitly empty meld in the draft is rejected by canConfirmTurn without crashing', () => {
    const state = fixtureState();
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'empty1', cards: [] }],
      handCardsPlayed: [],
    };
    expect(() => canConfirmTurn(state, draft)).not.toThrow();
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.noHandCard');
    // The empty meld itself must be flagged too/not crash reason detection.
    expect(() => getInvalidMeldReasons(draft.melds)).not.toThrow();
    const reasons = getInvalidMeldReasons(draft.melds);
    expect(reasons.find((r2) => r2.meldId === 'empty1')).toEqual({
      meldId: 'empty1',
      reason: 'reason.meldTooSmall',
    });
  });

  it('zero-card confirm on an empty committed table (no melds anywhere) reports noHandCard, no crash', () => {
    const state = fixtureState();
    const emptyTableState: GameState = { ...state, table: [] };
    const draft: DraftState = { melds: [], handCardsPlayed: [] };
    expect(() => canConfirmTurn(emptyTableState, draft)).not.toThrow();
    const r = canConfirmTurn(emptyTableState, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toEqual(['reason.noHandCard']);
  });

  it('singleton and pair melds are explicitly rejected as meldTooSmall', () => {
    const singleton = { id: 'm1', cards: [c('hearts', 5)] };
    const pair = { id: 'm2', cards: [c('spades', 7), c('spades', 8)] };
    expect(isValidMeld(singleton.cards)).toBe(false);
    expect(isValidMeld(pair.cards)).toBe(false);
    const reasons = getInvalidMeldReasons([singleton, pair]);
    expect(reasons).toEqual([
      { meldId: 'm1', reason: 'reason.meldTooSmall' },
      { meldId: 'm2', reason: 'reason.meldTooSmall' },
    ]);
  });
});

describe('canConfirmTurn: illegal movement variants', () => {
  it('table card missing while a different hand card is added elsewhere still reports cardMissing', () => {
    const state = fixtureState();
    const draft: DraftState = {
      // hearts-5 dropped from the table run (2 cards left); a wholly different hand
      // card set is added as a new meld instead of restoring it.
      melds: [
        { id: 't1', cards: [c('hearts', 3), c('hearts', 4)] },
        { id: 'd1', cards: [c('hearts', 9), c('spades', 9), c('clubs', 9)] },
      ],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.cardMissing');
  });

  it('a duplicated card split across two separate melds still reports duplicateCard', () => {
    const state = fixtureState();
    const draft: DraftState = {
      melds: [
        state.table[0]!,
        { id: 'd1', cards: [c('hearts', 9), c('spades', 9)] },
        { id: 'd2', cards: [c('hearts', 9), c('clubs', 9)] }, // hearts-9 duplicated across melds
      ],
      handCardsPlayed: ['hearts-9', 'spades-9', 'clubs-9'],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.duplicateCard');
  });
});

describe('serialize/deserialize: mid-game round trip', () => {
  it('deep-equals a mid-game state with a non-empty table, uneven hands, and preserves consecutiveDraws', () => {
    // Built from a real 52-card deck so card conservation (required by deserialize) holds.
    const deck = createDeck();
    const table: GameState['table'] = [
      { id: 't1', cards: [c('hearts', 1), c('hearts', 2), c('hearts', 3)] },
      { id: 't2', cards: [c('diamonds', 5), c('diamonds', 6), c('diamonds', 7)] },
    ];
    const p0Hand = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => c('clubs', r)); // 10 cards
    const p1Hand = [1, 2, 3, 4].map((r) => c('spades', r)); // 4 cards — deliberately uneven
    const used = new Set([
      ...table.flatMap((m) => m.cards.map((x) => x.id)),
      ...p0Hand.map((x) => x.id),
      ...p1Hand.map((x) => x.id),
    ]);
    const drawPile = deck.filter((card) => !used.has(card.id));
    const midGame: GameState = {
      seed: 555,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: p0Hand },
        { id: 'p1', name: 'B', isAi: true, aiType: 'simple', hand: p1Hand },
      ],
      activePlayerIndex: 1,
      table,
      drawPile,
      turn: 17,
      winnerId: null,
      phase: 'playing',
      consecutiveDraws: 3,
    };
    const back = deserializeGameState(serializeGameState(midGame));
    expect(back).toEqual(midGame);
    expect(back.consecutiveDraws).toBe(3);
  });
});
