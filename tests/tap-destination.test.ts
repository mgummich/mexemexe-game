import { describe, expect, it } from 'vitest';
import { DraftEditor } from '../src/mexe-mode/draft';
import type { GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { resolveCardTapDestination } from '../src/table/tap-destination';
import { n } from './helpers/cards';

function state(): GameState {
  return {
    seed: 1,
    players: [
      {
        id: 'p0', name: 'A', isAi: false,
        hand: [n('hearts', 2), n('hearts', 6), n('spades', 9), n('clubs', 9), n('diamonds', 9)],
      },
      { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4)] },
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

describe('resolveCardTapDestination', () => {
  it('two hand cards: tapping the second names a switch, not "return to hand"', () => {
    const ed = new DraftEditor(state());
    const held = 'hearts-2-d0';
    const tapped = 'hearts-6-d0';
    expect(resolveCardTapDestination(ed, held, tapped)).toEqual({ kind: 'switch' });
    // Board untouched by the decision itself — resolveCardTapDestination is read-only.
    expect(ed.getRemainingHand().map((c) => c.id)).toContain(held);
    expect(ed.getRemainingHand().map((c) => c.id)).toContain(tapped);
  });

  it('held hand card tapped onto a table meld: names that meld', () => {
    const ed = new DraftEditor(state());
    const dest = resolveCardTapDestination(ed, 'hearts-2-d0', 'hearts-3-d0');
    expect(dest).toEqual({ kind: 'meld', meldId: 't1' });
  });

  it('held table card (played this turn) tapped onto a hand card: names the hand', () => {
    const ed = new DraftEditor(state());
    ed.playHandCard('hearts-2-d0', null); // new meld from a hand card
    const newMeldId = ed.getDraft().melds.find((m) => m.cards.some((c) => c.id === 'hearts-2-d0'))!.id;
    const dest = resolveCardTapDestination(ed, 'hearts-2-d0', 'hearts-6-d0');
    expect(dest).toEqual({ kind: 'hand' });
    expect(newMeldId).not.toBe('t1');
  });
});
