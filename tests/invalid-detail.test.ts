import { describe, expect, it } from 'vitest';
import { invalidMeldDetail } from '../src/table/invalid-detail';
import type { Card } from '../src/rules/types';

function card(suit: Card['suit'], rank: Card['rank'], id?: string): Card {
  return { id: id ?? `${suit}-${rank}-d0`, deckId: 0, suit, rank, isJoker: false };
}

describe('invalidMeldDetail', () => {
  it('flags the two cards sharing a suit in a duplicate-suit trinca', () => {
    const cards = [card('hearts', 5, 'a'), card('hearts', 5, 'b'), card('clubs', 5, 'c')];
    const detail = invalidMeldDetail(cards, 'reason.groupDuplicateSuit');
    expect(detail.conflictCardIds.sort()).toEqual(['a', 'b']);
  });

  it('flags the off-suit card in a mismatched run', () => {
    const cards = [card('hearts', 4), card('hearts', 5), card('clubs', 6)];
    const detail = invalidMeldDetail(cards, 'reason.runSuitMismatch');
    expect(detail.conflictCardIds).toEqual([`clubs-6-d0`]);
  });

  it('finds the single missing slot in a run with one gap', () => {
    const cards = [card('hearts', 4), card('hearts', 5), card('hearts', 7)];
    const detail = invalidMeldDetail(cards, 'reason.runGap');
    expect(detail.missingSlotIndex).toBe(2);
  });

  it('reports nothing extra for reasons with no spatial detail', () => {
    expect(invalidMeldDetail([card('hearts', 4)], 'reason.meldTooSmall')).toEqual({ conflictCardIds: [] });
  });

  it('gives up on a slot for a run with more than one gap, rather than guessing', () => {
    // 2, 4, 5, 9 has two separate holes (3, and 6-7-8) — no single placeholder can name "the" gap.
    const cards = [card('hearts', 2), card('hearts', 4), card('hearts', 5), card('hearts', 9)];
    const detail = invalidMeldDetail(cards, 'reason.runGap');
    expect(detail.missingSlotIndex).toBeUndefined();
  });
});
