import { describe, expect, it } from 'vitest';
import { objectiveKey, objectivePhase } from '../src/core/objective';

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

  it('cards played but still not confirmable and nothing meld-invalid: no generic phase fits', () => {
    expect(objectivePhase(false, false, true)).toBeNull();
  });

  it('objectiveKey namespaces the phase for i18n lookup', () => {
    expect(objectiveKey('start')).toBe('objective.start');
    expect(objectiveKey('invalidEdit')).toBe('objective.invalidEdit');
    expect(objectiveKey('readyToConfirm')).toBe('objective.readyToConfirm');
  });
});
