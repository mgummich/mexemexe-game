import { describe, expect, it } from 'vitest';
import { headToHeadRecord, matchStoryKey, playerStats, summarizeMoveKey } from '../src/core/results-summary';
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
    expect(key).toBe('game.lastMove.played.many');
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

describe('matchStoryKey', () => {
  const win = (over: Partial<Parameters<typeof matchStoryKey>[0][number]> = {}) => ({
    isWinner: true, cardsLeft: 0, cardsPlayed: 7, draws: 1, turnsPlayed: 6, ...over,
  });
  const rival = (over: Partial<Parameters<typeof matchStoryKey>[0][number]> = {}) => ({
    isWinner: false, cardsLeft: 3, cardsPlayed: 4, draws: 1, turnsPlayed: 6, ...over,
  });

  it('a stalemate is always the pile-out story', () => {
    expect(matchStoryKey([win({ cardsLeft: 2 }), rival()], true)).toBe('win.story.pileOut');
  });

  it('a winner who drew far more than the table still won: comeback', () => {
    expect(matchStoryKey([win({ draws: 5 }), rival({ draws: 1 })], false)).toBe('win.story.comeback');
  });

  it('a rival left holding one card: close finish', () => {
    expect(matchStoryKey([win(), rival({ cardsLeft: 1 })], false)).toBe('win.story.close');
  });

  it('many cards played in few turns: stylish', () => {
    expect(matchStoryKey([win({ cardsPlayed: 8, turnsPlayed: 4 }), rival()], false)).toBe('win.story.stylish');
  });

  it('rival still holding most of a hand: runaway', () => {
    expect(matchStoryKey([win({ cardsPlayed: 7, turnsPlayed: 7 }), rival({ cardsLeft: 5 })], false)).toBe('win.story.runaway');
  });

  it('an ordinary finish gets no label at all', () => {
    expect(matchStoryKey([win({ cardsPlayed: 7, turnsPlayed: 7 }), rival({ cardsLeft: 3 })], false)).toBeNull();
  });

  it('online results (all counters zero) fall back to cards left, never to a made-up story', () => {
    const zero = { cardsPlayed: 0, draws: 0, turnsPlayed: 0 };
    expect(matchStoryKey([win(zero), rival({ ...zero, cardsLeft: 5 })], false)).toBe('win.story.runaway');
    expect(matchStoryKey([win(zero), rival({ ...zero, cardsLeft: 3 })], false)).toBeNull();
  });

  it('returns null when the results list has no winner or no rival', () => {
    expect(matchStoryKey([win()], false)).toBeNull();
    expect(matchStoryKey([], false)).toBeNull();
  });
});

describe('headToHeadRecord', () => {
  it('renders nothing until a match has actually been played', () => {
    expect(headToHeadRecord(undefined)).toBeNull();
    expect(headToHeadRecord({ wins: 0, losses: 0 })).toBeNull();
  });

  it('flips the saved human-side tally into the opponent\'s own record', () => {
    expect(headToHeadRecord({ wins: 1, losses: 3 })).toEqual({ w: 3, l: 1 });
  });
});
