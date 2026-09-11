import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/core/persistence';
import { settings } from '../src/core/settings';
import { canConfirmTurn } from '../src/rules/rules';
import type { DraftState, GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { helperFlags, type HelperMode } from '../src/ui/helpers';
import { n } from './helpers/cards';

describe('DEFAULT_SETTINGS', () => {
  it('defaults helperMode to standard', () => {
    expect(DEFAULT_SETTINGS.helperMode).toBe('standard');
  });
});

describe('settings.update helperMode', () => {
  it('persists and reads back', () => {
    settings.update({ helperMode: 'beginner' });
    expect(settings.get().helperMode).toBe('beginner');
    expect(settings.helperMode()).toBe('beginner');
    settings.update({ helperMode: 'standard' }); // leave clean for other tests
  });
});

describe('helperFlags', () => {
  it('beginner', () => {
    expect(helperFlags('beginner')).toEqual({
      legalDestinationsOnSelect: true,
      autoShowInvalidReason: true,
      ghostPreview: 'selectAndHover',
      doneChecklist: true,
    });
  });

  it('standard', () => {
    expect(helperFlags('standard')).toEqual({
      legalDestinationsOnSelect: false,
      autoShowInvalidReason: false,
      ghostPreview: 'hover',
      doneChecklist: false,
    });
  });

  it('expert', () => {
    expect(helperFlags('expert')).toEqual({
      legalDestinationsOnSelect: false,
      autoShowInvalidReason: false,
      ghostPreview: 'off',
      doneChecklist: false,
    });
  });

  it('falls back to standard flags for an unknown mode', () => {
    expect(helperFlags('banana' as HelperMode)).toEqual(helperFlags('standard'));
  });
});

/**
 * Regression guard: helper mode is display-only and must never be an input to rule legality.
 *
 * This passes today by construction — src/rules/rules.ts imports neither `settings` nor
 * `helpers`, so there is no coupling to break. That is the point: it is deliberately a guard
 * against a future change that reaches for the helper mode from inside the validator, not a
 * test of current behaviour. Do not delete it as tautological.
 */
describe('helper mode never affects canConfirmTurn', () => {
  function fixtureState(): GameState {
    return {
      seed: 1,
      players: [
        { id: 'p1', name: 'A', hand: [n('hearts', 9), n('spades', 9), n('clubs', 9)], isAi: false },
        { id: 'p2', name: 'B', hand: [n('spades', 2)], isAi: false },
      ],
      activePlayerIndex: 0,
      table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
      drawPile: [n('spades', 13), n('spades', 12)],
      turn: 1,
      winnerId: null,
      phase: 'playing',
      config: DEFAULT_RULES,
    };
  }

  const modes: HelperMode[] = ['beginner', 'standard', 'expert'];

  it('identical result for a valid draft under every mode', () => {
    const state = fixtureState();
    const draft: DraftState = {
      melds: [state.table[0]!, { id: 'd1', cards: [n('hearts', 9), n('spades', 9), n('clubs', 9)] }],
      handCardsPlayed: [],
    };
    const results = modes.map((m) => {
      settings.update({ helperMode: m });
      return canConfirmTurn(state, draft);
    });
    expect(results[0]).toEqual({ ok: true });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    settings.update({ helperMode: 'standard' });
  });

  it('identical result for an invalid draft under every mode', () => {
    const state = fixtureState();
    const draft: DraftState = { melds: [state.table[0]!], handCardsPlayed: [] }; // no hand card added
    const results = modes.map((m) => {
      settings.update({ helperMode: m });
      return canConfirmTurn(state, draft);
    });
    expect(results[0]!.ok).toBe(false);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    settings.update({ helperMode: 'standard' });
  });
});
