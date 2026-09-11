/**
 * "What does the game want from me right now" — pure, testable so GameScene's render loop can
 * stay a thin caller. Meld-specific invalid reasons still show on hover over the offending meld
 * (see GameScene.showMeldReasonTooltip); this only covers the three whole-turn phases.
 */
export type ObjectivePhase = 'start' | 'selectCard' | 'invalidEdit' | 'playedConfirm' | 'readyToConfirm';

/**
 * `null` means "no generic phase fits" — the caller should fall back to the specific
 * `canConfirm()` reason (e.g. a returned-to-hand table card), which is rare enough not to
 * deserve its own phase.
 */
export function objectivePhase(
  canConfirm: boolean,
  hasInvalidMelds: boolean,
  hasPlayedCards: boolean,
  hasSelection = false,
): ObjectivePhase | null {
  if (hasInvalidMelds) return 'invalidEdit';
  if (canConfirm) return 'readyToConfirm';
  // A card is in hand-limbo: the next thing to do is pick a destination, not "play or draw".
  if (hasSelection) return 'selectCard';
  if (!hasPlayedCards) return 'start';
  // Cards are down but the turn still isn't confirmable and no meld is flagged invalid — most
  // often a meld that's merely incomplete. "Tap DONE to confirm" is the goal to steer toward.
  return 'playedConfirm';
}

export function objectiveKey(phase: ObjectivePhase): string {
  return `objective.${phase}`;
}

/** One line of the DONE checklist: an i18n key plus whether that condition is already satisfied. */
export interface ChecklistItem {
  key: string;
  ok: boolean;
}

/**
 * The three conditions DONE gates on, as a checklist a beginner can read off the screen instead
 * of inferring from a single "first blocking reason" line. Derived purely from what the
 * validator already reported — it never decides legality itself, it only restates canConfirmTurn's
 * own result (`reasons`) plus the draft's invalid-meld list.
 */
export function doneChecklist(
  handCardsPlayed: number,
  invalidMeldCount: number,
  reasons: readonly string[],
): ChecklistItem[] {
  return [
    { key: 'check.handCard', ok: handCardsPlayed > 0 && !reasons.includes('reason.noHandCard') },
    { key: 'check.meldsValid', ok: invalidMeldCount === 0 && !reasons.includes('reason.notAMeld') },
    { key: 'check.noReturn', ok: !reasons.includes('reason.cardMissing') },
  ];
}

/** Renders a checklist as "✓ text" / "✕ text" lines — the tick is the non-color cue. */
export function formatChecklist(items: ChecklistItem[], translate: (key: string) => string): string {
  return items.map((i) => `${i.ok ? '✓' : '✕'} ${translate(i.key)}`).join('\n');
}
