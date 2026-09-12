import { settings } from '../core/settings';

/**
 * The timing bands every animation in the game picks from, with the easing that belongs to each.
 *
 * These exist so a card settling on the table and a banner landing on the results screen read as
 * the same physical world. Before this, durations were chosen per call site (100, 140, 160, 180,
 * 260, 300, 400, 700...) with mixed easings, and the game felt like unrelated effects stapled
 * together. Pick the band that matches how important the moment is, not the number that looks right.
 *
 * The bands double as the impact levels: `fast` is an acknowledgement, `normal` is ordinary play,
 * `expressive` is worth watching, and `major` is reserved for rare earned moments (FEITO landing,
 * BATER, victory) so those still feel bigger than everything around them.
 */
export const FEEL = {
  /** Tiny: a press, a highlight, a tooltip appearing. Felt more than seen. */
  fast: { ms: 110, ease: 'Quad.out' },
  /** Normal: card movement, state changes, the everyday language of the board. */
  normal: { ms: 200, ease: 'Back.out' },
  /** Strong: a Mexe settling, an AI's move landing — the player is meant to follow it. */
  expressive: { ms: 380, ease: 'Cubic.out' },
  /** Major: rare and earned. FEITO, BATER, victory. */
  major: { ms: 620, ease: 'Back.out' },
} as const;

export type FeelBand = keyof typeof FEEL;

/**
 * A band's duration in milliseconds, already scaled by the reduced-motion setting — 0 means "no
 * tween, jump straight to the end state". Callers that need a tween to still fire (a yoyo whose
 * end state matters) should clamp with `Math.max(1, ...)`, exactly as they did with raw numbers.
 */
export function feelMs(band: FeelBand): number {
  return Math.round(FEEL[band].ms * settings.motionScale());
}

/** How much a finished turn changed, as a presentation weight. */
export type MoveWeight = 'draw' | 'simple' | 'big' | 'huge';

/**
 * Weighs a turn from the committed before/after difference only — never from how much was dragged
 * around on the way there. Shuffling a card back and forth ten times is not a big Mexe, and paying
 * out presentation for intermediate motion would make it farmable.
 *
 * @param handCardsPlayed cards that left the hand this turn
 * @param tableCardsMoved cards already on the table that ended up in a different meld
 */
export function moveWeight(handCardsPlayed: number, tableCardsMoved: number): MoveWeight {
  if (handCardsPlayed <= 0 && tableCardsMoved <= 0) return 'draw';
  if (tableCardsMoved >= 4 || handCardsPlayed + tableCardsMoved >= 7) return 'huge';
  if (tableCardsMoved >= 1 || handCardsPlayed >= 3) return 'big';
  return 'simple';
}

/**
 * The band a move of each weight is presented at. This is the rule that keeps routine turns quick
 * and interesting ones readable: a draw is over almost before it starts, a table-wide rebuild gets
 * the full major treatment.
 */
export const WEIGHT_BAND: Record<MoveWeight, FeelBand> = {
  draw: 'fast',
  simple: 'normal',
  big: 'expressive',
  huge: 'major',
};
