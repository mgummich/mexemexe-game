import { describe, expect, it } from 'vitest';
import { doneChecklist, formatChecklist, objectiveKey, objectivePhase } from '../src/core/objective';

describe('objectivePhase', () => {
  it('an invalid meld always wins, regardless of confirm/played state', () => {
    expect(objectivePhase(false, true, false)).toBe('invalidEdit');
    expect(objectivePhase(true, true, true)).toBe('invalidEdit');
  });

  it('a confirmable draft (no invalid melds) is ready to confirm', () => {
    expect(objectivePhase(true, false, true)).toBe('readyToConfirm');
  });

  it('nothing played yet, nothing invalid: play or draw', () => {
    expect(objectivePhase(false, false, false)).toBe('start');
  });

  it('cards played but still not confirmable and nothing meld-invalid: steer toward DONE', () => {
    expect(objectivePhase(false, false, true)).toBe('playedConfirm');
  });

  it('a selected card outranks start/playedConfirm: the next action is picking a destination', () => {
    expect(objectivePhase(false, false, false, true)).toBe('selectCard');
    expect(objectivePhase(false, false, true, true)).toBe('selectCard');
  });

  it('a selection never overrides an invalid meld or a confirmable draft', () => {
    expect(objectivePhase(false, true, false, true)).toBe('invalidEdit');
    expect(objectivePhase(true, false, true, true)).toBe('readyToConfirm');
  });

  it('objectiveKey namespaces the phase for i18n lookup', () => {
    expect(objectiveKey('start')).toBe('objective.start');
    expect(objectiveKey('invalidEdit')).toBe('objective.invalidEdit');
    expect(objectiveKey('readyToConfirm')).toBe('objective.readyToConfirm');
    expect(objectiveKey('selectCard')).toBe('objective.selectCard');
    expect(objectiveKey('playedConfirm')).toBe('objective.playedConfirm');
  });
});

describe('doneChecklist', () => {
  it('all three conditions satisfied on a confirmable draft', () => {
    expect(doneChecklist(2, 0, [])).toEqual([
      { key: 'check.handCard', ok: true },
      { key: 'check.meldsValid', ok: true },
      { key: 'check.noReturn', ok: true },
    ]);
  });

  it('marks the hand-card line failed both by count and by the validator reason', () => {
    expect(doneChecklist(0, 0, [])[0]!.ok).toBe(false);
    expect(doneChecklist(2, 0, ['reason.noHandCard'])[0]!.ok).toBe(false);
  });

  it('marks the meld line failed by an invalid meld or by reason.notAMeld', () => {
    expect(doneChecklist(1, 1, [])[1]!.ok).toBe(false);
    expect(doneChecklist(1, 0, ['reason.notAMeld'])[1]!.ok).toBe(false);
  });

  it('marks the returned-table-card line failed only on reason.cardMissing', () => {
    expect(doneChecklist(1, 0, ['reason.cardMissing'])[2]!.ok).toBe(false);
    expect(doneChecklist(1, 0, ['reason.runGap'])[2]!.ok).toBe(true);
  });

  it('formats with a tick/cross per line — the non-color cue', () => {
    const out = formatChecklist(doneChecklist(0, 1, ['reason.noHandCard']), (k) => k);
    expect(out).toBe('✕ check.handCard\n✕ check.meldsValid\n✓ check.noReturn');
  });
});
