import { describe, expect, it } from 'vitest';
import { playerStats, summarizeMoveKey } from '../src/core/results-summary';
import type { PlaylogSummary } from '../src/core/playlog';
import { cardId } from '../src/rules/rules';
import type { Card, Meld, Rank, Suit } from '../src/rules/types';

function c(suit: Suit, rank: number, deckId = 0): Card {
  return { id: cardId(suit, rank as Rank, deckId), deckId, suit, rank: rank as Rank, isJoker: false };
}

function meld(id: string, cards: Card[]): Meld {
  return { id, cards };
}

describe('playerStats', () => {
  const perPlayer: PlaylogSummary['perPlayer'] = {
    p0: { cardsPlayed: 5, draws: 2, confirms: 3 },
  };

  it('reads turns/cards/draws for a tracked player', () => {
    expect(playerStats('p0', perPlayer)).toEqual({ turnsPlayed: 5, cardsPlayed: 5, draws: 2 });
  });

  it('defaults to all zeros for a player the playlog never observed (e.g. online)', () => {
    expect(playerStats('p1', perPlayer)).toEqual({ turnsPlayed: 0, cardsPlayed: 0, draws: 0 });
  });
});

describe('summarizeMoveKey', () => {
  it('a pure draw (0 cards played) reports the drew key', () => {
    const before: Meld[] = [meld('m1', [c('hearts', 9), c('spades', 9), c('clubs', 9)])];
    const { key, params } = summarizeMoveKey(before, before, 0);
    expect(key).toBe('game.lastMove.drew');
    expect(params).toEqual({ n: 0, m: 0 });
  });

  it('cards played into a brand-new meld, nothing rearranged: played key', () => {
    const before: Meld[] = [meld('m1', [c('hearts', 9), c('spades', 9), c('clubs', 9)])];
    const after: Meld[] = [...before, meld('m2', [c('diamonds', 3), c('diamonds', 4), c('diamonds', 5)])];
    const { key, params } = summarizeMoveKey(before, after, 3);
    expect(key).toBe('game.lastMove.played');
    expect(params).toEqual({ n: 3, m: 0 });
  });

  it('a table card moved to a different meld id: mexeu key, with the moved count', () => {
    const nine9h = c('hearts', 9);
    const before: Meld[] = [meld('m1', [nine9h, c('spades', 9), c('clubs', 9)])];
    // nine9h moved from m1 to a brand-new m2 alongside a played hand card
    const after: Meld[] = [
      meld('m1', [c('spades', 9), c('clubs', 9)]),
      meld('m2', [nine9h, c('diamonds', 9)]),
    ];
    const { key, params } = summarizeMoveKey(before, after, 1);
    expect(key).toBe('game.lastMove.mexeu');
    expect(params).toEqual({ n: 1, m: 1 });
  });
});
