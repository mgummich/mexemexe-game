/**
 * "What does the game want from me right now" — pure, testable so GameScene's render loop can
 * stay a thin caller. Meld-specific invalid reasons still show on hover over the offending meld
 * (see GameScene.showMeldReasonTooltip); this only covers the three whole-turn phases.
 */
export type ObjectivePhase = 'start' | 'invalidEdit' | 'readyToConfirm';

/**
 * `null` means "no generic phase fits" — the caller should fall back to the specific
 * `canConfirm()` reason (e.g. a returned-to-hand table card), which is rare enough not to
 * deserve its own phase.
 */
export function objectivePhase(
  canConfirm: boolean,
  hasInvalidMelds: boolean,
  hasPlayedCards: boolean,
): ObjectivePhase | null {
  if (hasInvalidMelds) return 'invalidEdit';
  if (canConfirm) return 'readyToConfirm';
  if (!hasPlayedCards) return 'start';
  return null;
}

export function objectiveKey(phase: ObjectivePhase): string {
  return `objective.${phase}`;
}
