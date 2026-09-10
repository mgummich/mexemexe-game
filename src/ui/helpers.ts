import type { HelperMode } from '../core/persistence';

export type { HelperMode };

/**
 * Display-only hints derived from the player's chosen helper mode. These flags only ever
 * change what the UI shows (highlights, tooltips, preview timing) — they are never an input
 * to rule legality. `canConfirmTurn` (src/rules/rules.ts) is the single authority on whether a
 * turn is legal, in every mode.
 */
export interface HelperFlags {
  /** Highlight legal destinations when a card is selected (tap/keyboard select-then-place). */
  legalDestinationsOnSelect: boolean;
  /** Auto-open the reason tooltip on an invalid meld badge instead of requiring a tap. */
  autoShowInvalidReason: boolean;
  /** When the non-mutating ghost preview appears. */
  ghostPreview: 'selectAndHover' | 'hover' | 'off';
  /** Whether the blocking FEITO reason is shown live, or only after the player presses FEITO. */
  feitoReason: 'live' | 'onAttempt';
}

const STANDARD_FLAGS: HelperFlags = {
  legalDestinationsOnSelect: false,
  autoShowInvalidReason: false,
  ghostPreview: 'hover',
  feitoReason: 'live',
};

const FLAGS_BY_MODE: Record<HelperMode, HelperFlags> = {
  beginner: {
    legalDestinationsOnSelect: true,
    autoShowInvalidReason: true,
    ghostPreview: 'selectAndHover',
    feitoReason: 'live',
  },
  standard: STANDARD_FLAGS,
  expert: {
    legalDestinationsOnSelect: false,
    autoShowInvalidReason: false,
    ghostPreview: 'off',
    feitoReason: 'onAttempt',
  },
};

/** Unknown/invalid input defensively falls back to the standard flags — never throws. */
export function helperFlags(mode: HelperMode): HelperFlags {
  return FLAGS_BY_MODE[mode] ?? STANDARD_FLAGS;
}
