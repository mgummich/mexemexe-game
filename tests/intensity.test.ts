import { describe, expect, it } from 'vitest';
import { isComeback, matchIntensity, threatOf } from '../src/core/intensity';
import type { Card, GameState, Meld } from '../src/rules/types';

function card(i: number): Card {
  return { id: `c${i}`, suit: 'hearts', rank: 5, isJoker: false, deckId: 0 } as Card;
}
function meld(n: number, id: string): Meld {
  return { id, cards: Array.from({ length: n }, (_, i) => card(i)) } as Meld;
}
function state(handSizes: number[], deck: number, table: Meld[] = []): GameState {
  return {
    players: handSizes.map((n, i) => ({ id: `p${i}`, name: `P${i}`, isAi: i > 0, hand: Array.from({ length: n }, (_, j) => card(j)) })),
    drawPile: Array.from({ length: deck }, (_, i) => card(i)),
    table,
  } as unknown as GameState;
}

describe('threatOf', () => {
  it('escalates only over the last three cards', () => {
    expect(threatOf(9)).toBe('none');
    expect(threatOf(4)).toBe('none');
    expect(threatOf(3)).toBe('watch');
    expect(threatOf(2)).toBe('threat');
    expect(threatOf(1)).toBe('last');
  });

  it('keeps an emptied hand at maximum threat until the turn is actually confirmed', () => {
    // The hand being empty does not win the match — the table still has to be legal — so this
    // must not fall back to 'none' and quietly drop the tension right before BATER.
    expect(threatOf(0)).toBe('last');
  });
});

describe('matchIntensity', () => {
  it('opens calm: small hands-only board, full deck', () => {
    expect(matchIntensity(state([9, 9], 60)).level).toBe('calm');
  });

  it('warms up as the shared table grows', () => {
    expect(matchIntensity(state([9, 9], 60, [meld(4, 'a'), meld(4, 'b'), meld(4, 'c')])).level).toBe('active');
  });

  it('goes hot when anyone is two cards away', () => {
    const i = matchIntensity(state([2, 9], 60));
    expect(i.level).toBe('hot');
    expect(i.threat).toBe('threat');
    expect(i.lowestHand).toBe(2);
  });

  it('treats a draining deck as its own pressure, independent of hand sizes', () => {
    expect(matchIntensity(state([9, 9], 10)).level).toBe('active');
    const critical = matchIntensity(state([9, 9], 3));
    expect(critical.level).toBe('hot');
    expect(critical.deckLow).toBe(true);
    expect(critical.deckCritical).toBe(true);
  });

  it('reports the lowest hand at the table, not the local player', () => {
    expect(matchIntensity(state([9, 1, 7], 60)).lowestHand).toBe(1);
  });
});

describe('isComeback', () => {
  it('flags a seat that was strictly trailing the table by the comeback gap', () => {
    expect(isComeback(state([9, 4], 60), 0)).toBe(true);
  });

  it('does not flag a seat only barely ahead of the pack', () => {
    expect(isComeback(state([6, 4], 60), 0)).toBe(false);
  });

  it('does not flag the leader itself', () => {
    expect(isComeback(state([2, 9], 60), 0)).toBe(false);
  });

  it('does not flag an empty hand (already won, not catching up)', () => {
    expect(isComeback(state([0, 9], 60), 0)).toBe(false);
  });
});
