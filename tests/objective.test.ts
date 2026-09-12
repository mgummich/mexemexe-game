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

  it('gives an emptied hand its own two phases, because empty does not mean won', () => {
    // Rules: the hand emptying never wins on its own — the table must be legal too (END-07).
    expect(objectivePhase(false, true, true, false, true)).toBe('handEmptyInvalid');
    expect(objectivePhase(true, false, true, false, true)).toBe('canBater');
    // ...and an empty hand outranks every other phase it could otherwise be confused with.
    expect(objectivePhase(false, false, true, true, true)).toBe('handEmptyInvalid');
  });

  it('leaves a non-empty hand on the ordinary phases', () => {
    expect(objectivePhase(true, false, true, false, false)).toBe('readyToConfirm');
    expect(objectivePhase(false, true, true, false, false)).toBe('invalidEdit');
  });

  it('marks the returned-table-card line failed only on reason.cardMissing', () => {
    expect(doneChecklist(1, 0, ['reason.cardMissing'])[2]!.ok).toBe(false);
    expect(doneChecklist(1, 0, ['reason.runGap'])[2]!.ok).toBe(true);
  });

  it('formats with a tick/cross per line — the non-color cue', () => {
    const out = formatChecklist(doneChecklist(0, 1, ['reason.noHandCard']), (k) => k);
    expect(out).toBe('✕ check.handCard\n✕ check.meldsUnresolved.one\n✓ check.noReturn');
  });

  it('counts what is left to close rather than repeating "invalid"', () => {
    expect(doneChecklist(1, 3, [])[1]!).toEqual({ key: 'check.meldsUnresolved.many', ok: false, params: { n: 3 } });
    expect(doneChecklist(1, 1, [])[1]!.key).toBe('check.meldsUnresolved.one'); // never "1 melds"
    expect(doneChecklist(1, 0, [])[1]!.key).toBe('check.meldsValid');
  });

  it('passes the count through to the translator', () => {
    const out = formatChecklist(doneChecklist(1, 2, []), (k, p) => `${k}:${p?.n ?? ''}`);
    expect(out).toContain('✕ check.meldsUnresolved.many:2');
  });
});
