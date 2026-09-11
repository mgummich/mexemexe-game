import { describe, expect, it } from 'vitest';
import { RearrangerAi, SimpleAi } from '../src/ai/ai';
import { applyConfirmedTurn, drawAndEndTurn, validateTable } from '../src/rules/rules';
import type { Card, GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { createNewGame } from '../src/game-state/store';
import { DraftEditor } from '../src/mexe-mode/draft';
import { n } from './helpers/cards';

/**
 * Seeded gameplay probes. Deterministic only — no Math.random anywhere. Reuses the
 * soak.test.ts full-game harness (SimpleAi vs RearrangerAi through the pure rules
 * functions) and ai.test.ts's card-count style invariant checks, but asserts a wider
 * invariant set on EVERY turn rather than only at the end.
 */
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const TOTAL_CARDS = DEFAULT_RULES.deckCount * (52 + DEFAULT_RULES.jokersPerDeck); // 108
const TURN_CAP = 2000;

function allCards(state: GameState): Card[] {
  return [...state.players.flatMap((p) => p.hand), ...state.table.flatMap((m) => m.cards), ...state.drawPile];
}

function assertInvariants(state: GameState, prevActive: number): void {
  const cards = allCards(state);
  expect(cards).toHaveLength(TOTAL_CARDS);
  expect(new Set(cards.map((c) => c.id)).size).toBe(TOTAL_CARDS);
  expect(validateTable(state.table)).toBe(true);
  expect(state.activePlayerIndex).toBeGreaterThanOrEqual(0);
  expect(state.activePlayerIndex).toBeLessThan(state.players.length);
  if (state.phase === 'playing') {
    expect(state.activePlayerIndex).toBe((prevActive + 1) % state.players.length);
  }
}

/** Plays one full seeded AI-vs-AI game, asserting invariants after every turn. */
function playSeededGame(seed: number): { turns: number; state: GameState } {
  let state: GameState = createNewGame(seed, [
    { name: 'A', isAi: true, aiType: 'simple' },
    { name: 'B', isAi: true, aiType: 'rearranger' },
  ]);
  const ais = [new SimpleAi(), new RearrangerAi()];
  let turns = 0;
  while (state.phase === 'playing' && turns < TURN_CAP) {
    const prevActive = state.activePlayerIndex;
    const activeHandBefore = state.players[prevActive]!.hand.length;
    const ai = ais[prevActive]!;
    const decision = ai.decide(state);
    if (decision.kind === 'confirm') {
      expect(decision.draft.handCardsPlayed.length).toBeGreaterThanOrEqual(1);
      state = applyConfirmedTurn(state, decision.draft);
      const activeHandAfter = state.players[prevActive]!.hand.length;
      expect(activeHandAfter).toBeLessThan(activeHandBefore);
    } else {
      state = drawAndEndTurn(state);
    }
    assertInvariants(state, prevActive);
    turns++;
  }
  expect(state.phase).toBe('finished');
  return { turns, state };
}

describe('seeded gameplay probes', () => {
  it.each(SEEDS)('seed %i: terminates, every turn holds all invariants, winner is a real player', (seed) => {
    const { state } = playSeededGame(seed);
    expect(state.winnerId).not.toBeNull();
    expect(state.players.some((p) => p.id === state.winnerId)).toBe(true);
  });

  it('determinism: same seed run twice yields an identical final state and turn count', () => {
    for (const seed of [1, 17, 40]) {
      const a = playSeededGame(seed);
      const b = playSeededGame(seed);
      expect(a.turns).toBe(b.turns);
      expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    }
  });
});

describe('edge probes', () => {
  function fixtureState(): GameState {
    return {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 9), n('spades', 9), n('clubs', 9)] },
        { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4), n('clubs', 5)] },
      ],
      activePlayerIndex: 0,
      table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
      drawPile: [],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      config: DEFAULT_RULES,
    };
  }

  it('near-exhausted draw pile: length 0 ends the game immediately, no throw', () => {
    const state = { ...fixtureState(), drawPile: [] };
    expect(() => drawAndEndTurn(state)).not.toThrow();
    const next = drawAndEndTurn(state);
    expect(next.phase).toBe('finished');
    expect(next.winnerId).not.toBeNull();
  });

  it('near-exhausted draw pile: length 1 draws the last card then leaves it empty, no throw', () => {
    const state = { ...fixtureState(), drawPile: [n('spades', 13)] };
    expect(() => drawAndEndTurn(state)).not.toThrow();
    const next = drawAndEndTurn(state);
    expect(next.phase).toBe('playing');
    expect(next.drawPile).toHaveLength(0);
    expect(next.players[0]!.hand.map((c) => c.id)).toContain('spades-13-d0');
  });

  it('crowded table (10 melds): still validates, AI decides without throwing', () => {
    const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
    const table: GameState['table'] = [];
    for (let rank = 1; rank <= 10; rank++) {
      table.push({
        id: `t${rank}`,
        cards: [n(suits[rank % 4]!, rank), n(suits[(rank + 1) % 4]!, rank), n(suits[(rank + 2) % 4]!, rank)],
      });
    }
    expect(validateTable(table)).toBe(true);
    const state: GameState = { ...fixtureState(), table };
    expect(() => new RearrangerAi().decide(state)).not.toThrow();
  });

  it('undo/reset abuse: 100+ DraftEditor ops then reset() restores exact turn-start state, card conservation holds', () => {
    const s = fixtureState();
    const ed = new DraftEditor(s);
    const committedMelds = ed.getDraft().melds;
    for (let i = 0; i < 120; i++) {
      ed.playHandCard('hearts-9-d0', null);
      ed.playHandCard('spades-9-d0', ed.getDraft().melds.at(-1)!.id);
      ed.undo();
      ed.redo();
      ed.returnHandCard('spades-9-d0');
      ed.returnHandCard('hearts-9-d0');
    }
    ed.playHandCard('hearts-9-d0', null);
    ed.reset();

    const draft = ed.getDraft();
    expect(draft.handCardsPlayed).toEqual([]);
    expect(draft.melds).toEqual(committedMelds);
    expect(ed.getRemainingHand()).toEqual(s.players[0]!.hand);

    const draftedCards = draft.melds.flatMap((m) => m.cards);
    const total = draftedCards.length + ed.getRemainingHand().length + s.players[1]!.hand.length + s.drawPile.length;
    const originalTotal =
      s.players.reduce((sum, p) => sum + p.hand.length, 0) + s.table.reduce((sum, m) => sum + m.cards.length, 0) + s.drawPile.length;
    expect(total).toBe(originalTotal);
  });
});
