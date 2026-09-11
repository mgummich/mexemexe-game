import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import {
  analyzeMeld,
  applyConfirmedTurn,
  canConfirmTurn,
  checkWinner,
  createDeck,
  dealInitialHands,
  deserializeGameState,
  drawAndEndTurn,
  getInvalidMeldReasons,
  isValidGroup,
  isValidMeld,
  isValidRun,
  serializeGameState,
  shuffleDeck,
  timerExpireTurn,
  validateTable,
} from '../src/rules/rules';
import type { DraftState, GameState, RulesConfig } from '../src/rules/types';
import { DEFAULT_RULES, RulesError } from '../src/rules/types';
import { createNewGame } from '../src/game-state/store';
import { n, j } from './helpers/cards';

describe('createDeck', () => {
  it('default config: 108 cards, 4 jokers, 104 naturals, all ids unique', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(deck.filter((c) => c.isJoker)).toHaveLength(4);
    expect(deck.filter((c) => !c.isJoker)).toHaveLength(104);
    expect(new Set(deck.map((c) => c.id)).size).toBe(108);
  });

  it('exactly two cards per (suit, rank), differing only by deckId', () => {
    const deck = createDeck();
    const heartsSevens = deck.filter((c) => !c.isJoker && c.suit === 'hearts' && c.rank === 7);
    expect(heartsSevens).toHaveLength(2);
    expect(new Set(heartsSevens.map((c) => c.deckId)).size).toBe(2);
    expect(heartsSevens.every((c) => c.suit === 'hearts' && c.rank === 7)).toBe(true);
  });

  it('single-deck no-joker config yields 52 cards, 0 jokers', () => {
    const deck = createDeck({ ...DEFAULT_RULES, deckCount: 1, jokersPerDeck: 0 });
    expect(deck).toHaveLength(52);
    expect(deck.filter((c) => c.isJoker)).toHaveLength(0);
  });
});

describe('shuffleDeck', () => {
  it('is deterministic for the same seed', () => {
    const a = shuffleDeck(createDeck(), createRng(42));
    const b = shuffleDeck(createDeck(), createRng(42));
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
  });
  it('differs across seeds but preserves the multiset of ids', () => {
    const deck = createDeck();
    const a = shuffleDeck(deck, createRng(1));
    const b = shuffleDeck(deck, createRng(2));
    expect(a.map((x) => x.id)).not.toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.id).sort()).toEqual(deck.map((x) => x.id).sort());
    expect(b.map((x) => x.id).sort()).toEqual(deck.map((x) => x.id).sort());
  });
  it('does not mutate input', () => {
    const deck = createDeck();
    const ids = deck.map((x) => x.id);
    shuffleDeck(deck, createRng(7));
    expect(deck.map((x) => x.id)).toEqual(ids);
  });
});

describe('dealInitialHands', () => {
  it('deals 7 to each of 4 players, 80 left in the draw pile', () => {
    const { hands, drawPile } = dealInitialHands(createDeck(), 4);
    expect(hands).toHaveLength(4);
    hands.forEach((h) => expect(h).toHaveLength(7));
    expect(drawPile).toHaveLength(108 - 28);
  });
  it('rejects bad player counts', () => {
    expect(() => dealInitialHands(createDeck(), 1)).toThrow(RulesError);
    expect(() => dealInitialHands(createDeck(), 5)).toThrow(RulesError);
  });

  it('card conservation after deal: hands + drawPile == 108 unique ids, no card lost or duplicated', () => {
    const deck = createDeck();
    const { hands, drawPile } = dealInitialHands(deck, 4);
    const all = [...hands.flat(), ...drawPile];
    expect(all).toHaveLength(108);
    expect(new Set(all.map((c) => c.id)).size).toBe(108);
    expect(all.map((c) => c.id).sort()).toEqual(deck.map((c) => c.id).sort());
  });
});

describe('runs', () => {
  it('A-2-3 valid (ace low)', () => {
    expect(isValidRun([n('clubs', 1), n('clubs', 2), n('clubs', 3)])).toBe(true);
  });
  it('Q-K-A valid (ace high)', () => {
    expect(isValidRun([n('clubs', 12), n('clubs', 13), n('clubs', 1)])).toBe(true);
  });
  it('K-A-2 invalid: no wrap', () => {
    const result = analyzeMeld([n('clubs', 13), n('clubs', 1), n('clubs', 2)]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.runWrap');
  });
  it('mixed suits invalid', () => {
    expect(isValidRun([n('hearts', 3), n('spades', 4), n('hearts', 5)])).toBe(false);
  });
  it('mixed suits reports runSuitMismatch', () => {
    const result = analyzeMeld([n('hearts', 3), n('spades', 4), n('hearts', 5)]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.runSuitMismatch');
  });
  it('jokerless broken sequence reports runGap, not jokerUnassignable', () => {
    const result = analyzeMeld([n('hearts', 5), n('hearts', 7), n('hearts', 9)]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.runGap');
  });
  it('2 cards -> meldTooSmall', () => {
    const result = analyzeMeld([n('hearts', 3), n('hearts', 4)]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.meldTooSmall');
  });

  it('joker dropped after two consecutive naturals: 5H 6H joker -> assigned 7H (positional)', () => {
    const joker = j(0, 1);
    const result = analyzeMeld([n('hearts', 5), n('hearts', 6), joker]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.assignments).toEqual([{ cardId: joker.id, suit: 'hearts', rank: 7 }]);
    }
  });

  it('joker at the start: joker 6H 7H -> assigned 5H', () => {
    const joker = j(0, 1);
    const result = analyzeMeld([joker, n('hearts', 6), n('hearts', 7)]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.assignments).toEqual([{ cardId: joker.id, suit: 'hearts', rank: 5 }]);
    }
  });

  it('joker in the gap: 5H joker 7H -> assigned 6H', () => {
    const joker = j(0, 1);
    const result = analyzeMeld([n('hearts', 5), joker, n('hearts', 7)]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.assignments).toEqual([{ cardId: joker.id, suit: 'hearts', rank: 6 }]);
    }
  });

  it('AH joker 3H -> assigned 2H', () => {
    const joker = j(0, 1);
    const result = analyzeMeld([n('hearts', 1), joker, n('hearts', 3)]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.assignments).toEqual([{ cardId: joker.id, suit: 'hearts', rank: 2 }]);
    }
  });

  it('joker + QS + KS -> valid, joker takes a legal adjacent spade', () => {
    const joker = j(0, 1);
    const result = analyzeMeld([joker, n('spades', 12), n('spades', 13)]);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.assignments).toEqual([{ cardId: joker.id, suit: 'spades', rank: 11 }]); // Jack fills below Q-K
    }
  });

  it('2D joker joker AD is invalid: a meld may use at most 1 joker', () => {
    const result = analyzeMeld([n('diamonds', 2), j(0, 1), j(0, 2), n('diamonds', 1)]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.tooManyJokers');
  });

  it('an all-joker meld is invalid', () => {
    expect(isValidMeld([j(0, 1), j(0, 2), j(1, 1)])).toBe(false);
  });

  it('a run containing two same-value naturals is invalid', () => {
    expect(isValidRun([n('hearts', 5, 0), n('hearts', 5, 1), n('hearts', 6)])).toBe(false);
  });
});

describe('groups', () => {
  it('uses final fixed group defaults', () => {
    expect(DEFAULT_RULES).toMatchObject({
      groupUniqueSuits: true,
      groupMinSize: 3,
      groupMaxSize: 4,
      allowAllJokerGroups: false,
    });
  });

  it.each([
    [n('hearts', 7), n('spades', 7), n('diamonds', 7)],
    [n('hearts', 7), n('spades', 7), n('diamonds', 7), n('clubs', 7)],
    [n('clubs', 13), n('diamonds', 13), j(0, 1)],
    [n('hearts', 9), n('diamonds', 9), n('clubs', 9)],
  ])('accepts legal 3- or 4-card group', (...cards) => {
    expect(isValidGroup(cards)).toBe(true);
  });

  it('assigns group jokers to unused suits of its natural rank', () => {
    const joker = j(0, 1);
    const result = analyzeMeld([n('spades', 9), n('hearts', 9), joker]);
    expect(result.valid).toBe(true);
    if (result.valid && result.kind === 'group') {
      expect(result.assignments).toEqual([{ cardId: joker.id, suit: 'diamonds', rank: 9 }]);
      expect(result.rank).toBe(9);
      expect(result.naturalSuits).toEqual(['spades', 'hearts']);
      expect(result.jokerCount).toBe(1);
      expect(result.assignedJokers).toEqual(result.assignments);
      expect(result.isValid).toBe(true);
      expect(result.reasons).toEqual([]);
    }
  });

  it('rejects one natural plus two jokers: a group may use at most 1 joker', () => {
    const result = analyzeMeld([n('clubs', 6), j(0, 1), j(1, 1)]);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.tooManyJokers');
  });

  it('five same-rank cards -> groupTooLarge (default maxGroupSize 4)', () => {
    const five = [n('spades', 9, 0), n('hearts', 9, 0), n('diamonds', 9, 0), n('clubs', 9, 0), n('spades', 9, 1)];
    const result = analyzeMeld(five);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.groupTooLarge');
  });
  it('hard group maximum ignores legacy maxGroupSize override', () => {
    const five = [n('spades', 9, 0), n('hearts', 9, 0), n('diamonds', 9, 0), n('clubs', 9, 0), n('spades', 9, 1)];
    const config: RulesConfig = { ...DEFAULT_RULES, maxGroupSize: 6 };
    expect(isValidGroup(five, config)).toBe(false);
  });

  it('hard group bounds ignore groupMinSize and groupMaxSize overrides', () => {
    const config: RulesConfig = { ...DEFAULT_RULES, groupMinSize: 2, groupMaxSize: 5 };
    expect(isValidGroup([n('hearts', 4), n('diamonds', 4)], config)).toBe(false);
    expect(isValidGroup([n('spades', 4), n('hearts', 4), n('diamonds', 4), n('clubs', 4), j(0, 1)], config)).toBe(false);
  });

  it.each([
    ["repeated suit across decks", [n('hearts', 7, 0), n('hearts', 7, 1), n('clubs', 7)], 'reason.groupDuplicateSuit'],
    ['different ranks', [n('hearts', 7), n('hearts', 8), n('clubs', 7)], 'reason.runSuitMismatch'],
    ['two cards', [n('hearts', 4), n('diamonds', 4)], 'reason.meldTooSmall'],
    ['five cards', [n('spades', 10), n('hearts', 10), n('diamonds', 10), n('clubs', 10), j(0, 1)], 'reason.groupTooLarge'],
    ['all jokers', [j(0, 1), j(0, 2), j(1, 1)], 'reason.groupAllJokers'],
    ['too many jokers for missing suits', [n('clubs', 2), n('diamonds', 2), j(0, 1), j(0, 2), j(1, 1)], 'reason.groupTooLarge'],
    ['duplicate unique id', [n('diamonds', 6), n('diamonds', 6), j(0, 1)], 'reason.duplicateCard'],
    ['joker assignment collision', [n('diamonds', 6, 0), n('diamonds', 6, 1), j(0, 1)], 'reason.groupDuplicateSuit'],
  ] as const)('rejects %s', (_label, cards, reason) => {
    const result = analyzeMeld(cards);
    expect(result).toEqual({ valid: false, reason });
  });

  it('hard unique-suit rule ignores legacy groupUniqueSuits override', () => {
    const config: RulesConfig = { ...DEFAULT_RULES, groupUniqueSuits: false };
    expect(isValidGroup([n('spades', 9, 0), n('spades', 9, 1), n('hearts', 9)], config)).toBe(false);
  });
  it('hard natural-card requirement ignores legacy allowAllJokerGroups override', () => {
    const config: RulesConfig = { ...DEFAULT_RULES, allowAllJokerGroups: true };
    expect(isValidGroup([j(0, 1), j(0, 2), j(1, 1)], config)).toBe(false);
  });
  it('mixed ranks invalid', () => {
    expect(isValidGroup([n('hearts', 9), n('spades', 9), n('clubs', 8)])).toBe(false);
  });
});

function fixtureState(): GameState {
  return {
    seed: 1,
    players: [
      {
        id: 'p0', name: 'A', isAi: false,
        hand: [n('hearts', 9), n('spades', 9), n('clubs', 9), n('diamonds', 2), n('diamonds', 7)],
      },
      { id: 'p1', name: 'B', isAi: true, aiType: 'simple', hand: [n('clubs', 4), n('clubs', 5)] },
    ],
    activePlayerIndex: 0,
    table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
    drawPile: [n('spades', 13), n('spades', 12)],
    turn: 1,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
  };
}

describe('canConfirmTurn', () => {
  const state = fixtureState();
  const tableRun = state.table[0]!;

  it('accepts valid draft with hand card added', () => {
    const draft: DraftState = {
      melds: [tableRun, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] }],
      handCardsPlayed: [],
    };
    expect(canConfirmTurn(state, draft)).toEqual({ ok: true });
  });

  it('zero hand cards added -> noHandCard', () => {
    const draft: DraftState = { melds: [tableRun], handCardsPlayed: [] };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.noHandCard');
  });

  it('table-start card missing from the draft -> cardMissing', () => {
    const draft: DraftState = {
      melds: [
        { id: 't1', cards: [n('hearts', 3), n('hearts', 4)] }, // hearts-5 vanished
        { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] },
      ],
      handCardsPlayed: [],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.cardMissing');
  });

  it('the same id twice -> duplicateCard', () => {
    const draft: DraftState = {
      melds: [
        tableRun,
        { id: 'd1', cards: [n('hearts', 9), n('hearts', 9), n('spades', 9), n('clubs', 9)] },
      ],
      handCardsPlayed: [],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.duplicateCard');
  });

  it('rejects a group with the same natural suit from different decks', () => {
    const twoDeckState: GameState = {
      ...state,
      players: [
        { ...state.players[0]!, hand: [...state.players[0]!.hand, n('hearts', 9, 1)] },
        state.players[1]!,
      ],
    };
    const draft: DraftState = {
      melds: [
        tableRun,
        { id: 'd1', cards: [n('hearts', 9, 0), n('hearts', 9, 1), n('spades', 9)] },
      ],
      handCardsPlayed: [],
    };
    const r = canConfirmTurn(twoDeckState, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.groupDuplicateSuit');
  });

  it('foreign card -> foreignCard', () => {
    const draft: DraftState = {
      melds: [
        tableRun,
        { id: 'd1', cards: [n('diamonds', 11), n('diamonds', 12), n('diamonds', 13)] },
      ],
      handCardsPlayed: [],
    };
    const r = canConfirmTurn(state, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.foreignCard');
  });

  it('a valid joker meld confirms; applyConfirmedTurn removes exactly those cards from hand, joker keeps its own id on the table', () => {
    const joker = j(0, 1);
    const s: GameState = {
      ...state,
      players: [
        { ...state.players[0]!, hand: [...state.players[0]!.hand, joker] },
        state.players[1]!,
      ],
    };
    const draft: DraftState = {
      melds: [tableRun, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), joker] }],
      handCardsPlayed: [],
    };
    const check = canConfirmTurn(s, draft);
    expect(check).toEqual({ ok: true });
    const before = s.players[0]!.hand.map((c) => c.id);
    const next = applyConfirmedTurn(s, draft);
    const playedIds = new Set(['hearts-9-d0', 'spades-9-d0', joker.id]);
    expect(next.players[0]!.hand.map((c) => c.id)).toEqual(before.filter((id) => !playedIds.has(id)));
    const onTable = next.table.find((m) => m.id === 'd1')!;
    expect(onTable.cards.some((c) => c.id === joker.id && c.isJoker)).toBe(true);
  });
});

describe('applyConfirmedTurn', () => {
  it('moves cards from hand, replaces table, advances turn', () => {
    const state = fixtureState();
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] }],
      handCardsPlayed: [],
    };
    const next = applyConfirmedTurn(state, draft);
    expect(next.players[0]!.hand.map((x) => x.id)).toEqual(['diamonds-2-d0', 'diamonds-7-d0']);
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
    state.players[0]!.hand = [n('hearts', 9), n('spades', 9), n('clubs', 9)];
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] }],
      handCardsPlayed: [],
    };
    const next = applyConfirmedTurn(state, draft);
    expect(next.winnerId).toBe('p0');
    expect(next.phase).toBe('finished');
  });

  it('card conservation: total cards across hands + table + drawPile is unchanged by a confirm', () => {
    const state = fixtureState();
    const countCards = (s: GameState): number =>
      s.players.reduce((n, p) => n + p.hand.length, 0) + s.table.reduce((n, m) => n + m.cards.length, 0) + s.drawPile.length;
    const before = countCards(state);
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] }],
      handCardsPlayed: [],
    };
    const next = applyConfirmedTurn(state, draft);
    expect(countCards(next)).toBe(before);
  });

  it('never grows a hand: no draw happens at turn start', () => {
    const state = fixtureState();
    const before = state.players[0]!.hand.length;
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] }],
      handCardsPlayed: [],
    };
    const next = applyConfirmedTurn(state, draft);
    // 3 cards moved out of hand, none drawn in.
    expect(next.players[0]!.hand.length).toBe(before - 3);
  });
});

describe('committed meld ordering (sortMeldCards, via applyConfirmedTurn)', () => {
  it('a joker in a valid run commits sorted into its analyzed slot, not pushed to the end', () => {
    const state = fixtureState();
    const joker = j(0, 1);
    const s: GameState = {
      ...state,
      players: [
        {
          ...state.players[0]!,
          hand: [...state.players[0]!.hand, n('hearts', 12), n('hearts', 10), joker],
        },
        state.players[1]!,
      ],
    };
    // Drafted out of order: Q, 10, joker. Analyzed run is 10-J(joker)-Q.
    const draft: DraftState = {
      melds: [
        s.table[0]!,
        { id: 'd1', cards: [n('hearts', 12), n('hearts', 10), joker] },
      ],
      handCardsPlayed: [],
    };
    expect(canConfirmTurn(s, draft)).toEqual({ ok: true });
    const next = applyConfirmedTurn(s, draft);
    const onTable = next.table.find((m) => m.id === 'd1')!;
    expect(onTable.cards.map((c) => c.id)).toEqual(['hearts-10-d0', joker.id, 'hearts-12-d0']);
  });

  it('re-committing the same joker run a second turn does not drift the joker slot', () => {
    const state = fixtureState();
    const joker = j(0, 1);
    const s: GameState = {
      ...state,
      players: [
        {
          ...state.players[0]!,
          hand: [...state.players[0]!.hand, n('hearts', 12), n('hearts', 10), joker],
        },
        { ...state.players[1]!, hand: [...state.players[1]!.hand, n('clubs', 6)] },
      ],
    };
    const draft1: DraftState = {
      melds: [s.table[0]!, { id: 'd1', cards: [n('hearts', 12), n('hearts', 10), joker] }],
      handCardsPlayed: [],
    };
    const afterTurn1 = applyConfirmedTurn(s, draft1);
    const runOnTable = afterTurn1.table.find((m) => m.id === 'd1')!;
    // Re-submit the same run cards, scrambled again, plus an unrelated meld from p1's hand
    // (required to satisfy the "at least one hand card" gate for p1's turn).
    const draft2: DraftState = {
      melds: [
        afterTurn1.table.find((m) => m.id === 't1')!,
        { id: 'd1', cards: [joker, runOnTable.cards[2]!, runOnTable.cards[0]!] },
        { id: 'd2', cards: [n('clubs', 4), n('clubs', 5), n('clubs', 6)] },
      ],
      handCardsPlayed: [],
    };
    expect(canConfirmTurn(afterTurn1, draft2)).toEqual({ ok: true });
    const afterTurn2 = applyConfirmedTurn(afterTurn1, draft2);
    const runAgain = afterTurn2.table.find((m) => m.id === 'd1')!;
    expect(runAgain.cards.map((c) => c.id)).toEqual(['hearts-10-d0', joker.id, 'hearts-12-d0']);
  });

  it('a joker in a valid group still sorts naturals-first-by-suit, joker last (unchanged)', () => {
    const state = fixtureState();
    const joker = j(0, 1);
    const s: GameState = {
      ...state,
      players: [
        { ...state.players[0]!, hand: [...state.players[0]!.hand, n('spades', 9), joker] },
        state.players[1]!,
      ],
    };
    const draft: DraftState = {
      melds: [s.table[0]!, { id: 'd1', cards: [n('spades', 9), joker, n('hearts', 9)] }],
      handCardsPlayed: [],
    };
    expect(canConfirmTurn(s, draft)).toEqual({ ok: true });
    const next = applyConfirmedTurn(s, draft);
    const onTable = next.table.find((m) => m.id === 'd1')!;
    expect(onTable.cards.map((c) => c.id)).toEqual(['hearts-9-d0', 'spades-9-d0', joker.id]);
  });
});

describe('drawAndEndTurn', () => {
  it('non-empty pile: draws 1 and advances the turn', () => {
    const state = fixtureState();
    const next = drawAndEndTurn(state);
    expect(next.players[0]!.hand).toHaveLength(6);
    expect(next.players[0]!.hand.at(-1)!.id).toBe('spades-13-d0');
    expect(next.drawPile).toHaveLength(1);
    expect(next.activePlayerIndex).toBe(1);
  });

  it('empty pile: finishes the game immediately, fewest-cards winner, no card drawn', () => {
    const state = { ...fixtureState(), drawPile: [] };
    const next = drawAndEndTurn(state);
    expect(next.phase).toBe('finished');
    expect(next.players[0]!.hand).toHaveLength(5); // untouched, no draw
    expect(next.winnerId).toBe('p1'); // p1 has 2 cards vs p0's 5
  });

  it('empty pile ties go to the earliest seat', () => {
    const state: GameState = {
      ...fixtureState(),
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2)] },
        { id: 'p1', name: 'B', isAi: false, hand: [n('clubs', 4)] },
      ],
      drawPile: [],
    };
    const next = drawAndEndTurn(state);
    expect(next.phase).toBe('finished');
    expect(next.winnerId).toBe('p0');
  });
});

describe('timerExpireTurn', () => {
  it('behaves exactly like the draw-and-pass path (reverts to turn-start state, draws, ends turn)', () => {
    const state = fixtureState();
    const viaTimer = timerExpireTurn(state);
    const viaDraw = drawAndEndTurn(state);
    expect(viaTimer).toEqual(viaDraw);
    expect(viaTimer.players[0]!.hand).toHaveLength(6);
    expect(viaTimer.activePlayerIndex).toBe(1);
  });

  it('on an empty pile, also ends the game (fewest-cards winner)', () => {
    const state = { ...fixtureState(), drawPile: [] };
    const next = timerExpireTurn(state);
    expect(next.phase).toBe('finished');
    expect(next.winnerId).toBe('p1');
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

describe('win only via confirm, never via drawAndEndTurn', () => {
  it('a zero-hand player sitting idle is not "discovered" as a winner by drawAndEndTurn', () => {
    const state = fixtureState();
    const weird: GameState = { ...state, players: [{ ...state.players[0]!, hand: [] }, state.players[1]!] };
    const next = drawAndEndTurn(weird);
    expect(next.winnerId).toBeNull();
    expect(next.phase).toBe('playing');
  });
});

describe('turn order cycling', () => {
  function threePlayerState(): GameState {
    return {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2), n('hearts', 6)] },
        { id: 'p1', name: 'B', isAi: false, hand: [n('clubs', 4)] },
        { id: 'p2', name: 'C', isAi: false, hand: [n('diamonds', 8), n('diamonds', 9), n('spades', 1)] },
      ],
      activePlayerIndex: 0,
      table: [],
      drawPile: [n('hearts', 10), n('hearts', 11), n('hearts', 12)],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      config: DEFAULT_RULES,
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

  it('applyConfirmedTurn also cycles turn order for 3 players', () => {
    let state = threePlayerState();
    state = { ...state, table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }] };
    const validDraft: DraftState = {
      melds: [{ id: 't1', cards: [n('hearts', 2), n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
      handCardsPlayed: [],
    };
    const next = applyConfirmedTurn(state, validDraft);
    expect(next.activePlayerIndex).toBe(1);
  });

  it('applyConfirmedTurn cycles turn order 0->1->2->3->0 for 4 players', () => {
    const fourPlayerState: GameState = {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 9), n('spades', 9), n('clubs', 9)] },
        { id: 'p1', name: 'B', isAi: false, hand: [n('hearts', 10), n('spades', 10), n('clubs', 10)] },
        { id: 'p2', name: 'C', isAi: false, hand: [n('hearts', 11), n('spades', 11), n('clubs', 11)] },
        { id: 'p3', name: 'D', isAi: false, hand: [n('hearts', 12), n('spades', 12), n('clubs', 12)] },
      ],
      activePlayerIndex: 0,
      table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
      drawPile: [],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      config: DEFAULT_RULES,
    };
    let state = fourPlayerState;
    for (let expected = 1; expected <= 3; expected++) {
      const hand = state.players[state.activePlayerIndex]!.hand;
      const draft: DraftState = {
        melds: [...state.table, { id: `d${expected}`, cards: hand }],
        handCardsPlayed: [],
      };
      expect(canConfirmTurn(state, draft)).toEqual({ ok: true });
      state = applyConfirmedTurn(state, draft);
      expect(state.activePlayerIndex).toBe(expected % 4);
    }
  });

  it('4-player deck exhaustion tie: earliest seat wins', () => {
    const state: GameState = {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2)] },
        { id: 'p1', name: 'B', isAi: false, hand: [n('clubs', 4)] },
        { id: 'p2', name: 'C', isAi: false, hand: [n('diamonds', 8), n('diamonds', 9), n('spades', 1)] },
        { id: 'p3', name: 'D', isAi: false, hand: [n('spades', 5), n('spades', 6)] },
      ],
      activePlayerIndex: 0,
      table: [],
      drawPile: [],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      config: DEFAULT_RULES,
    };
    const next = drawAndEndTurn(state);
    expect(next.phase).toBe('finished');
    expect(next.winnerId).toBe('p0');
  });
});

describe('isValidMeld / validateTable / reasons', () => {
  it('meld = run or group', () => {
    expect(isValidMeld([n('hearts', 1), n('hearts', 2), n('hearts', 3)])).toBe(true);
    expect(isValidMeld([n('hearts', 9), n('spades', 9), n('clubs', 9)])).toBe(true);
    expect(isValidMeld([n('hearts', 1), n('spades', 2), n('clubs', 3)])).toBe(false);
  });
  it('validateTable + reasons', () => {
    const good = { id: 'm1', cards: [n('hearts', 1), n('hearts', 2), n('hearts', 3)] };
    const small = { id: 'm2', cards: [n('spades', 5), n('spades', 6)] };
    const junk = { id: 'm3', cards: [n('spades', 5), n('hearts', 9), n('clubs', 13)] };
    expect(validateTable([good])).toBe(true);
    expect(validateTable([good, small])).toBe(false);
    const reasons = getInvalidMeldReasons([good, small, junk]);
    expect(reasons).toEqual([
      { meldId: 'm2', reason: 'reason.meldTooSmall' },
      { meldId: 'm3', reason: 'reason.runSuitMismatch' },
      { meldId: 'm3', reason: 'reason.duplicateCard' },
    ]);
  });
  it('rejects duplicate unique ids anywhere on the table', () => {
    const shared = n('hearts', 1);
    const first = { id: 'm1', cards: [shared, n('hearts', 2), n('hearts', 3)] };
    const second = { id: 'm2', cards: [shared, n('spades', 1), n('clubs', 1)] };
    expect(validateTable([first, second])).toBe(false);
    expect(getInvalidMeldReasons([first, second])).toContainEqual({ meldId: 'm2', reason: 'reason.duplicateCard' });
  });
});

describe('serialize/deserialize', () => {
  it('round-trips a real game (default 108-card config)', () => {
    const state = createNewGame(123, [
      { name: 'A', isAi: false },
      { name: 'B', isAi: true, aiType: 'simple' },
    ]);
    const back = deserializeGameState(serializeGameState(state));
    expect(back).toEqual(state);
  });

  it('preserves joker identity (id/isJoker/deckId) and config through a round trip', () => {
    const config: RulesConfig = { ...DEFAULT_RULES, deckCount: 1, jokersPerDeck: 1 };
    const deck = createDeck(config);
    const joker = deck.find((c) => c.isJoker)!;
    const naturals = deck.filter((c) => !c.isJoker);
    const table = [{ id: 't1', cards: [naturals[0]!, naturals[1]!, joker] }]; // 9S? just any 3 — validity irrelevant to (de)serialize
    const used = new Set(table[0]!.cards.map((c) => c.id));
    const rest = deck.filter((c) => !used.has(c.id));
    const p0Hand = rest.slice(0, 26);
    const p1Hand = rest.slice(26, 52);
    const drawPile = rest.slice(52);
    const state: GameState = {
      seed: 9,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: p0Hand },
        { id: 'p1', name: 'B', isAi: false, hand: p1Hand },
      ],
      activePlayerIndex: 0,
      table,
      drawPile,
      turn: 1,
      winnerId: null,
      phase: 'playing',
      config,
    };
    const back = deserializeGameState(serializeGameState(state));
    const backJoker = back.table[0]!.cards.find((c) => c.isJoker)!;
    expect(backJoker).toEqual(joker);
    expect(back.config).toEqual(config);
  });

  it('rejects a version-1 envelope with RulesError', () => {
    const state = createNewGame(1, [{ name: 'A', isAi: false }, { name: 'B', isAi: false }]);
    const v1 = JSON.stringify({ version: 1, state });
    expect(() => deserializeGameState(v1)).toThrow(RulesError);
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

  it('expected total derives from config: a valid single-deck 52-card state deserializes fine', () => {
    const config: RulesConfig = { ...DEFAULT_RULES, deckCount: 1, jokersPerDeck: 0 };
    const state = createNewGame(1, [{ name: 'A', isAi: false }, { name: 'B', isAi: false }], config);
    const all = [...state.players.flatMap((p) => p.hand), ...state.drawPile];
    expect(all).toHaveLength(52);
    const back = deserializeGameState(serializeGameState(state));
    expect(back).toEqual(state);
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
    expect(() => getInvalidMeldReasons(draft.melds)).not.toThrow();
    const reasons = getInvalidMeldReasons(draft.melds);
    expect(reasons.find((r2) => r2.meldId === 'empty1')).toEqual({
      meldId: 'empty1',
      reason: 'reason.meldTooSmall',
    });
  });

  it('singleton and pair melds are explicitly rejected as meldTooSmall', () => {
    const singleton = { id: 'm1', cards: [n('hearts', 5)] };
    const pair = { id: 'm2', cards: [n('spades', 7), n('spades', 8)] };
    expect(isValidMeld(singleton.cards)).toBe(false);
    expect(isValidMeld(pair.cards)).toBe(false);
    const reasons = getInvalidMeldReasons([singleton, pair]);
    expect(reasons).toEqual([
      { meldId: 'm1', reason: 'reason.meldTooSmall' },
      { meldId: 'm2', reason: 'reason.meldTooSmall' },
    ]);
  });
});

describe('one joker per meld', () => {
  it.each([
    ['joker + 7H + 8H', [j(0, 1), n('hearts', 7), n('hearts', 8)]],
    ['7H + 8H + joker', [n('hearts', 7), n('hearts', 8), j(0, 1)]],
    ['7H + joker + 9H', [n('hearts', 7), j(0, 1), n('hearts', 9)]],
    ['trinca 7H + 7S + joker', [n('hearts', 7), n('spades', 7), j(0, 1)]],
    ['run without a joker', [n('hearts', 7), n('hearts', 8), n('hearts', 9)]],
    ['trinca without a joker', [n('hearts', 7), n('spades', 7), n('clubs', 7)]],
  ])('accepts %s', (_label, cards) => {
    expect(isValidMeld(cards)).toBe(true);
  });

  it.each([
    ['joker + 7H + joker', [j(0, 1), n('hearts', 7), j(0, 2)]],
    ['joker + 7H + 8H + joker', [j(0, 1), n('hearts', 7), n('hearts', 8), j(0, 2)]],
    ['7H + joker + joker', [n('hearts', 7), j(0, 1), j(0, 2)]],
    ['trinca 7H + 7S + 2 jokers', [n('hearts', 7), n('spades', 7), j(0, 1), j(0, 2)]],
  ])('rejects %s with tooManyJokers', (_label, cards) => {
    const result = analyzeMeld(cards);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('reason.tooManyJokers');
  });

  it('an all-joker meld stays invalid', () => {
    expect(isValidMeld([j(0, 1), j(0, 2), j(1, 1)])).toBe(false);
  });

  it('validateTable rejects a table meld holding 2 jokers', () => {
    const melds = [{ id: 'm1', cards: [n('hearts', 7), j(0, 1), j(0, 2)] }];
    expect(validateTable(melds)).toBe(false);
    expect(getInvalidMeldReasons(melds)).toEqual([{ meldId: 'm1', reason: 'reason.tooManyJokers' }]);
  });

  it('canConfirmTurn rejects a draft meld holding 2 jokers', () => {
    const base = fixtureState();
    const jokers = [j(0, 1), j(0, 2)];
    const s: GameState = {
      ...base,
      players: [{ ...base.players[0]!, hand: [...base.players[0]!.hand, ...jokers] }, base.players[1]!],
    };
    const draft: DraftState = {
      melds: [s.table[0]!, { id: 'd1', cards: [n('hearts', 9), ...jokers] }],
      handCardsPlayed: [],
    };
    const r = canConfirmTurn(s, draft);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toContain('reason.tooManyJokers');
  });
});
