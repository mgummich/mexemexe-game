/**
 * Canonical scenario library — the reusable states named in
 * [INVARIANTS.md](../../docs/INVARIANTS.md) (`SCN-xx`).
 *
 * Layering: `cards.ts` builds cards, this file builds *states*, and a test adds the action
 * sequence and the assertion. Nothing here imports Phaser, the DOM, Playwright or a clock, so a
 * unit, server or AI test can all reach for the same fixture.
 *
 * Every function returns a freshly constructed state — `GameState` is readonly (INV-S2), so a
 * test that needs a variant passes a patch rather than writing into a shared object.
 */
import { DraftEditor } from '../../src/mexe-mode/draft';
import { createDeck, createNewGame, dealInitialHands, shuffleDeck } from '../../src/rules/rules';
import { createRng } from '../../src/rules/rng';
import { DEFAULT_RULES, type Card, type DraftState, type GameState, type PlayerConfig } from '../../src/rules/types';
import { n } from './cards';

/**
 * Valid-by-default two-seat state: seat 0 (human) to play, one committed run on the table, cards
 * left in the pile. Patch only what the test is actually about.
 *
 * This is SCN-03, the normal legal turn: seat 0 holds `hearts-2`, which extends the table's
 * `hearts 3-4-5`; `spades-9`/`clubs-9` are there so a test can build a second meld or an illegal
 * singleton.
 */
export function gameState(patch: Partial<GameState> = {}): GameState {
  return {
    seed: 1,
    players: [
      { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2), n('spades', 9), n('clubs', 9)] },
      { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4), n('clubs', 5)] },
    ],
    activePlayerIndex: 0,
    table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
    drawPile: [n('spades', 7), n('spades', 8)],
    turn: 1,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
    ...patch,
  };
}

/**
 * The draft the UI would build for a state from this file: seat 0 plays `hearts-2` onto the
 * table run. The legal FEITO of SCN-03, shared by every test that needs an accepted turn rather
 * than the editing that produced it.
 */
export function legalDraft(state: GameState): DraftState {
  const editor = new DraftEditor(state);
  editor.playHandCard('hearts-2-d0', 't1', 0);
  return editor.getDraft();
}

/** SCN-01/SCN-02 — a real seeded deal, the same one the server and a local match start from. */
export function dealtMatch(seed: number, seats = 2, opts: { ai?: boolean } = {}): GameState {
  const configs: PlayerConfig[] = Array.from({ length: seats }, (_, i) => ({
    name: String.fromCharCode(65 + i),
    isAi: opts.ai ?? false,
  }));
  return createNewGame(seed, configs);
}

/**
 * SCN-09/SCN-12 — a table worth rearranging: seat 0 holds the two cards (`hearts-2`, `hearts-6`)
 * that let the run be split and rebuilt, plus three 9s for a group built from scratch. Empty pile
 * so a draw is not an escape hatch.
 */
export function tableRearrangement(): GameState {
  return gameState({
    players: [
      {
        id: 'p0', name: 'A', isAi: false,
        hand: [n('hearts', 2), n('hearts', 6), n('spades', 9), n('clubs', 9), n('diamonds', 9)],
      },
      { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4)] },
    ],
    drawPile: [],
  });
}

/** SCN-07 — seat 0 is one legal play away from an empty hand, so the next FEITO ends the match. */
export function oneCardFromWinning(): GameState {
  return gameState({
    players: [
      { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2)] },
      { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4), n('clubs', 5)] },
    ],
  });
}

/**
 * SCN-07/SCN-25 — already decided: seat 1 went out, seat 0 is still holding the hand it lost
 * with. Nothing may be applied on top of this (INV-S4), and the loser's hand is kept so a test
 * can build the turn it is *not* allowed to take.
 */
export function finishedMatch(): GameState {
  return gameState({
    players: [
      { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2), n('spades', 9), n('clubs', 9)] },
      { id: 'p1', name: 'B', isAi: true, hand: [] },
    ],
    phase: 'finished',
    winnerId: 'p1',
  });
}

/**
 * A deal seed whose seat-0 hand holds a same-rank triple in distinct suits — i.e. one legal meld
 * that can be played straight out of a real deal. Searched rather than hardcoded so a rules or
 * shuffle change moves the seed instead of silently breaking the test that depends on it.
 */
export function seedWithTriple(seats = 2): { seed: number; triple: Card[] } {
  for (let seed = 1; seed < 400; seed++) {
    const hand = dealInitialHands(shuffleDeck(createDeck(), createRng(seed)), seats).hands[0]!;
    for (const rank of new Set(hand.filter((c) => !c.isJoker).map((c) => c.rank))) {
      const sameRank = hand.filter((c) => c.rank === rank);
      const distinctSuits = sameRank.filter((c, i) => sameRank.findIndex((o) => o.suit === c.suit) === i);
      if (distinctSuits.length >= 3) return { seed, triple: distinctSuits.slice(0, 3) };
    }
  }
  throw new Error('no seed with a triple in the seat-0 hand (fixture bug)');
}

/**
 * Deliberately invalid states, for invariant and error-path tests. Named so that a reader never
 * has to work out *which* rule a fixture breaks; everything else in this file is valid.
 */
export const invalid = {
  /** INV-G1 — the same physical card is both in seat 0's hand and on the table. */
  duplicateCard(): GameState {
    const dupe: Card = n('hearts', 3);
    return gameState({
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [dupe, n('spades', 9)] },
        { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4), n('clubs', 5)] },
      ],
    });
  },

  /** INV-G1 — a card dealt into the match exists nowhere: not in a hand, on the table or in the pile. */
  missingCard(): GameState {
    const state = gameState();
    return { ...state, drawPile: state.drawPile.slice(1) };
  },

  /** INV-G2 — the committed table holds a meld `analyzeMeld` rejects (a gapped run). */
  illegalTable(): GameState {
    return gameState({ table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 7)] }] });
  },

  /** INV-S5 — seat 1 is active, so anything seat 0 submits is out of turn. */
  wrongActivePlayer(): GameState {
    return gameState({ activePlayerIndex: 1 });
  },
} as const;
