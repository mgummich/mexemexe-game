import { pluralKey } from '../localization/i18n';

/**
 * "What does the game want from me right now" — pure, testable so GameScene's render loop can
 * stay a thin caller. Meld-specific invalid reasons still show on hover over the offending meld
 * (see GameScene.showMeldReasonTooltip); this only covers the three whole-turn phases.
 */
type ObjectivePhase =
  | 'start'
  | 'selectCard'
  | 'invalidEdit'
  | 'playedConfirm'
  | 'readyToConfirm'
  /** Hand empty but the table is not legal yet — close to winning, not winning. */
  | 'handEmptyInvalid'
  /** Hand empty and the table is legal: the next press ends the match. */
  | 'canBater';

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
  handEmpty = false,
): ObjectivePhase | null {
  // An empty hand is the single most loaded state in the game, and it means two completely
  // different things depending on the table. Emptying your hand does not win — the table still has
  // to be legal — so these two get their own wording rather than the generic invalid/ready lines.
  if (handEmpty) return canConfirm ? 'canBater' : 'handEmptyInvalid';
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
interface ChecklistItem {
  key: string;
  ok: boolean;
  /** Interpolation values for `key`, e.g. how many melds are still unresolved. */
  params?: Record<string, string | number>;
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
    // Counting what is left to resolve, rather than repeating "invalid", is the difference between
    // a checklist that reads as progress and one that reads as a verdict.
    invalidMeldCount > 0
      ? { key: pluralKey('check.meldsUnresolved', invalidMeldCount), ok: false, params: { n: invalidMeldCount } }
      : { key: 'check.meldsValid', ok: !reasons.includes('reason.notAMeld') },
    { key: 'check.noReturn', ok: !reasons.includes('reason.cardMissing') },
  ];
}

/** Renders a checklist as "✓ text" / "✕ text" lines — the tick is the non-color cue. */
export function formatChecklist(
  items: ChecklistItem[],
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  return items.map((i) => `${i.ok ? '✓' : '✕'} ${translate(i.key, i.params)}`).join('\n');
}
