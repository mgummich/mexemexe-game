import { describe, expect, it } from 'vitest';
import { DraftEditor } from '../src/mexe-mode/draft';
import type { GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
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

describe('DraftEditor', () => {
  it('starts as copy of committed table, cannot confirm untouched', () => {
    const ed = new DraftEditor(state());
    expect(ed.getDraft().melds).toHaveLength(1);
    const r = ed.canConfirm();
    expect(r.ok).toBe(false);
  });

  it('play hand card to extend run then confirm ok', () => {
    const ed = new DraftEditor(state());
    ed.playHandCard('hearts-2-d0', 't1', 0);
    expect(ed.canConfirm()).toEqual({ ok: true });
    expect(ed.getRemainingHand().map((x) => x.id)).not.toContain('hearts-2-d0');
  });

  it('temporary invalid mid-edit, valid after rebuild', () => {
    const ed = new DraftEditor(state());
    // Break the run: move hearts-5 out to a new meld (invalid: 2-card + 1-card melds)
    ed.moveTableCard('hearts-5-d0', null);
    expect(ed.invalidMelds().length).toBeGreaterThan(0);
    expect(ed.canConfirm().ok).toBe(false);
    // Rebuild: hearts-5 + hearts-6 hand card + ... put 5 back, add 2 and 6
    ed.moveTableCard('hearts-5-d0', 't1');
    ed.playHandCard('hearts-2-d0', 't1', 0);
    ed.playHandCard('hearts-6-d0', 't1');
    expect(ed.invalidMelds()).toHaveLength(0);
    expect(ed.canConfirm()).toEqual({ ok: true });
  });

  it('split and merge melds', () => {
    const ed = new DraftEditor(state());
    const id = ed.getDraft().melds[0]!.id;
    expect(ed.splitMeld(id, 1)).toBe(true);
    expect(ed.getDraft().melds).toHaveLength(2);
    const [a, b] = ed.getDraft().melds;
    expect(ed.mergeMelds(b!.id, a!.id)).toBe(true);
    expect(ed.getDraft().melds).toHaveLength(1);
    expect(ed.getDraft().melds[0]!.cards).toHaveLength(3);
  });

  it('undo/redo/reset', () => {
    const ed = new DraftEditor(state());
    ed.playHandCard('hearts-2-d0', 't1', 0);
    ed.playHandCard('hearts-6-d0', 't1');
    expect(ed.getDraft().melds[0]!.cards).toHaveLength(5);
    expect(ed.undo()).toBe(true);
    expect(ed.getDraft().melds[0]!.cards).toHaveLength(4);
    expect(ed.redo()).toBe(true);
    expect(ed.getDraft().melds[0]!.cards).toHaveLength(5);
    ed.reset();
    expect(ed.getDraft().melds[0]!.cards).toHaveLength(3);
    expect(ed.getRemainingHand()).toHaveLength(5);
    expect(ed.undo()).toBe(true); // undo the reset itself
    expect(ed.getDraft().melds[0]!.cards).toHaveLength(5);
  });

  it('returnHandCard allowed for a card played this turn, refused for a table-start card', () => {
    const ed = new DraftEditor(state());
    ed.playHandCard('spades-9-d0', null);
    expect(ed.returnHandCard('spades-9-d0')).toBe(true);
    expect(ed.getRemainingHand().map((x) => x.id)).toContain('spades-9-d0');
    // committed table card can't be "returned" — not in handCardsPlayed
    expect(ed.returnHandCard('hearts-3-d0')).toBe(false);
  });

  it('empty melds are pruned after moves', () => {
    const ed = new DraftEditor(state());
    ed.playHandCard('spades-9-d0', null);
    const draft = ed.getDraft();
    const single = draft.melds.find((m) => m.cards.length === 1)!;
    ed.moveTableCard('spades-9-d0', draft.melds[0]!.id);
    expect(ed.getDraft().melds.find((m) => m.id === single.id)).toBeUndefined();
  });

  it('splitting a run into two valid runs without a hand card blocks FEITO with noHandCard', () => {
    const s = state();
    s.table = [
      {
        id: 't1',
        cards: [n('diamonds', 3), n('diamonds', 4), n('diamonds', 5), n('diamonds', 6), n('diamonds', 7), n('diamonds', 8)],
      },
    ];
    const ed = new DraftEditor(s);
    const id = ed.getDraft().melds[0]!.id;
    expect(ed.splitMeld(id, 3)).toBe(true);
    expect(ed.getDraft().melds).toHaveLength(2);
    expect(ed.invalidMelds()).toHaveLength(0); // both halves are valid 3-runs
    const r = ed.canConfirm();
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.reasons).toContain('reason.noHandCard');
  });

  it('moving all cards of one meld into another via moveTableCard preserves card conservation', () => {
    const ed = new DraftEditor(state());
    const before = ed.getDraft().melds.flatMap((m) => m.cards.map((x) => x.id));
    ed.playHandCard('spades-9-d0', null);
    const newMeldId = ed.getDraft().melds.find((m) => m.id !== 't1')!.id;
    ed.playHandCard('clubs-9-d0', newMeldId);
    ed.playHandCard('diamonds-9-d0', newMeldId);
    const source = ed.getDraft().melds.find((m) => m.id === newMeldId)!;
    for (const card of [...source.cards]) {
      expect(ed.moveTableCard(card.id, 't1')).toBe(true);
    }
    const after = ed.getDraft().melds.flatMap((m) => m.cards.map((x) => x.id));
    expect(after.sort()).toEqual([...before, 'spades-9-d0', 'clubs-9-d0', 'diamonds-9-d0'].sort());
    expect(ed.getDraft().melds).toHaveLength(1); // fully merged, empty meld pruned
  });

  it('returnHandCard stays consistent after undo/redo sequences', () => {
    const ed = new DraftEditor(state());
    ed.playHandCard('spades-9-d0', null);
    ed.undo();
    ed.redo();
    expect(ed.returnHandCard('spades-9-d0')).toBe(true);
    expect(ed.getRemainingHand().map((x) => x.id)).toContain('spades-9-d0');
    expect(ed.getDraft().melds.find((m) => m.cards.some((x) => x.id === 'spades-9-d0'))).toBeUndefined();
  });

  it('playHandCard with a bogus card id fails without pushing undo history', () => {
    const ed = new DraftEditor(state());
    const before = ed.historyLength();
    expect(ed.playHandCard('nope-99-d0', null)).toBe(false);
    expect(ed.historyLength()).toBe(before);
  });

  it('reset() restores exact committed state (meld ids + card order, full hand) after a scrambled sequence including undo/redo past invalid drafts', () => {
    const s = state();
    const ed = new DraftEditor(s);
    const committedMelds = ed.getDraft().melds; // snapshot 0, before any mutation

    // Scramble: split, play cards, break into an invalid shape, undo/redo across it,
    // merge, return a card, split again.
    ed.splitMeld('t1', 1);
    ed.playHandCard('hearts-2-d0', 't1', 0);
    ed.playHandCard('hearts-6-d0', null); // new (temporarily invalid, singleton) meld
    expect(ed.canConfirm().ok).toBe(false); // confirm invalid mid-scramble
    ed.undo();
    ed.redo();
    const melds = ed.getDraft().melds;
    const newMeld = melds.find((m) => m.id !== 't1' && m.cards.some((c) => c.id !== 'hearts-4-d0' && c.id !== 'hearts-5-d0'));
    if (newMeld && melds.length > 1) {
      const other = melds.find((m) => m.id !== newMeld.id)!;
      ed.mergeMelds(newMeld.id, other.id);
    }
    ed.returnHandCard('hearts-2-d0');
    ed.splitMeld('t1', 1);
    ed.undo();
    ed.redo();
    ed.undo();

    ed.reset();

    const draft = ed.getDraft();
    expect(draft.handCardsPlayed).toEqual([]);
    expect(draft.melds).toEqual(committedMelds); // deep-equal: ids + card order
    expect(ed.getRemainingHand()).toEqual(s.players[0]!.hand); // full hand back, original order
  });
});

describe('DraftEditor.reset past the undo-history cap', () => {
  it('still restores the turn’s starting position after more than HISTORY_CAP edits', () => {
    const s = state();
    const ed = new DraftEditor(s);
    // Place and return the same card repeatedly so the bounded undo history drops its oldest
    // snapshots — history[0] stops being the start, the separate initial snapshot does not.
    for (let i = 0; i < 120; i++) {
      expect(ed.playHandCard('spades-9-d0', null)).toBe(true);
      expect(ed.returnHandCard('spades-9-d0')).toBe(true);
    }
    expect(ed.historyLength()).toBeLessThanOrEqual(100);
    ed.playHandCard('spades-9-d0', null);
    ed.reset();
    expect(ed.getDraft().handCardsPlayed).toEqual([]);
    expect(ed.getDraft().melds).toEqual(s.table);
  });
});
