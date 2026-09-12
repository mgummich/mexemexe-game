import { describe, expect, it } from 'vitest';
import { computeSnapTargets, meldStatus, snapTargetFor } from '../src/table/snap';
import { DraftEditor } from '../src/mexe-mode/draft';
import { sortMeldCards } from '../src/rules/rules';
import type { DraftState, GameState, ReasonCode } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { n, j } from './helpers/cards';

function draft(melds: DraftState['melds']): DraftState {
  return { melds, handCardsPlayed: [] };
}

describe('computeSnapTargets', () => {
  it('legal sequence extension', () => {
    const d = draft([{ id: 'm1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }]);
    const targets = computeSnapTargets(d, n('hearts', 6));
    const t = snapTargetFor(targets, 'm1')!;
    expect(t.status).toBe('legal');
    expect(t.reason).toBeNull();
  });

  it('legal trinca target', () => {
    const d = draft([{ id: 'm1', cards: [n('hearts', 9), n('clubs', 9), n('diamonds', 9)] }]);
    const targets = computeSnapTargets(d, n('spades', 9));
    const t = snapTargetFor(targets, 'm1')!;
    expect(t.status).toBe('legal');
  });

  it('repeated-suit trinca rejected', () => {
    const d = draft([{ id: 'm1', cards: [n('hearts', 9), n('clubs', 9), n('diamonds', 9)] }]);
    const targets = computeSnapTargets(d, n('hearts', 9, 1));
    const t = snapTargetFor(targets, 'm1')!;
    expect(t.status).toBe('illegal');
    expect(t.reason).toBe('reason.groupDuplicateSuit');
  });

  it('two-joker meld rejected', () => {
    const d = draft([{ id: 'm1', cards: [n('hearts', 9), n('clubs', 9), j(0, 1)] }]);
    const targets = computeSnapTargets(d, j(1, 1));
    const t = snapTargetFor(targets, 'm1')!;
    expect(t.status).toBe('illegal');
    expect(t.reason).toBe('reason.tooManyJokers');
  });

  it('joker target valid only when legal', () => {
    const d = draft([
      { id: 'run', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] },
      { id: 'grp', cards: [n('clubs', 9), n('diamonds', 9), j(0, 1)] },
    ]);
    const targets = computeSnapTargets(d, j(1, 1));
    const runTarget = snapTargetFor(targets, 'run')!;
    expect(runTarget.status).toBe('legal');
    expect(runTarget.jokerAssignments).toHaveLength(1);
    expect(runTarget.jokerAssignments[0]!.suit).toBe('hearts');

    const grpTarget = snapTargetFor(targets, 'grp')!;
    expect(grpTarget.status).toBe('illegal');
  });

  it('no legal target for an impossible drop', () => {
    const d = draft([
      { id: 'm1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] },
      { id: 'm2', cards: [n('clubs', 9), n('diamonds', 9), n('spades', 9)] },
    ]);
    // A rank-2 spades card fits neither the hearts run nor the 9s group.
    const targets = computeSnapTargets(d, n('spades', 2));
    for (const t of targets) {
      expect(t.status === 'legal').toBe(false);
    }
  });

  it('new-meld target is always present', () => {
    const d = draft([{ id: 'm1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }]);
    const targets = computeSnapTargets(d, n('clubs', 2));
    const t = snapTargetFor(targets, null)!;
    expect(t).toBeTruthy();
    expect(t.status).toBe('incomplete');
    expect(t.reason).toBe('reason.meldTooSmall');
  });

  it('does not return the card\'s own current meld as a target', () => {
    const card = n('hearts', 3);
    const d = draft([{ id: 'm1', cards: [card, n('hearts', 4), n('hearts', 5)] }]);
    const targets = computeSnapTargets(d, card);
    expect(snapTargetFor(targets, 'm1')).toBeNull();
    // still get the new-meld target
    expect(snapTargetFor(targets, null)).toBeTruthy();
  });

  it('targets track draft changes', () => {
    const state: GameState = {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 6), n('spades', 9)] },
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
    const ed = new DraftEditor(state);
    const dropped = n('hearts', 6, 1);
    const before = computeSnapTargets(ed.getDraft(), dropped);
    expect(snapTargetFor(before, 't1')!.status).toBe('legal'); // extends 3-4-5 to 3-4-5-6

    ed.playHandCard('hearts-6-d0', 't1', Infinity);
    const after = computeSnapTargets(ed.getDraft(), dropped);
    // meld now 4 cards (3,4,5,6 hearts) - still legal to extend, but preview differs
    expect(before.length).toBe(after.length);
    expect(snapTargetFor(after, 't1')!.preview).not.toEqual(snapTargetFor(before, 't1')!.preview);
  });

  it('the accepted move lands exactly where the preview showed it (ghost preview trustworthiness)', () => {
    const state: GameState = {
      seed: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 6)] },
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
    const ed = new DraftEditor(state);
    const card = n('hearts', 6);
    const target = snapTargetFor(computeSnapTargets(ed.getDraft(), card), 't1')!;
    expect(target.status).toBe('legal');

    ed.playHandCard(card.id, 't1');
    const landed = ed.getDraft().melds.find((m) => m.id === 't1')!;
    expect(sortMeldCards(landed.cards, DEFAULT_RULES)).toEqual(target.preview);
  });

  it('purity: does not mutate the draft or share card objects', () => {
    const d = draft([{ id: 'm1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }]);
    const snapshot = JSON.parse(JSON.stringify(d));
    const targets = computeSnapTargets(d, n('hearts', 6));
    expect(d).toEqual(snapshot);
    const t = snapTargetFor(targets, 'm1')!;
    expect(t.preview[0]).not.toBe(d.melds[0]!.cards[0]);
  });
});

// R1: meldStatus() is now the ONE classifier every renderer (drag-time zone highlighting, the
// resting board, the touch editor, the meld-focus panel) calls to decide incomplete vs. illegal.
// This locks its behaviour so a second, diverging classifier can never quietly grow back — see
// GameScene.ts's STATUS_FILL/STATUS_TEXT comment for the render-side half of this guarantee.
describe('meldStatus (R1: the single incomplete/illegal classifier)', () => {
  it('null reason is legal', () => {
    expect(meldStatus(null)).toBe('legal');
  });

  it('meldTooSmall and runGap are incomplete, not illegal — both are normal mid-edit states', () => {
    expect(meldStatus('reason.meldTooSmall')).toBe('incomplete');
    expect(meldStatus('reason.runGap')).toBe('incomplete');
  });

  it('every other reason is a genuine contradiction: illegal', () => {
    const contradictions: ReasonCode[] = [
      'reason.notAMeld',
      'reason.runSuitMismatch',
      'reason.noHandCard',
      'reason.cardMissing',
      'reason.duplicateCard',
      'reason.foreignCard',
      'reason.groupTooLarge',
      'reason.groupDuplicateSuit',
      'reason.groupAllJokers',
      'reason.jokerUnassignable',
      'reason.tooManyJokers',
      'reason.runWrap',
    ];
    for (const reason of contradictions) expect(meldStatus(reason)).toBe('illegal');
  });

  it('drag-time preview classifies a run-gap drop as incomplete (gold), not illegal (red) — R1', () => {
    // 3-4-[5 missing]-6 hearts: dropping the 6 onto 3-4 leaves a single-step gap, not a
    // contradiction. Before R1 this returned 'illegal' here while the resting-board renderer
    // called the exact same reason 'incomplete', a live red/gold disagreement on the same drag.
    const d: DraftState = { melds: [{ id: 'm1', cards: [n('hearts', 3), n('hearts', 4)] }], handCardsPlayed: [] };
    const targets = computeSnapTargets(d, n('hearts', 6));
    const t = snapTargetFor(targets, 'm1')!;
    expect(t.reason).toBe('reason.runGap');
    expect(t.status).toBe('incomplete');
  });
});
