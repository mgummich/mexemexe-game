import type { DraftEditor } from '../mexe-mode/draft';

/**
 * Pure decision for GameScene's `onCardTapped`: with `heldCardId` already selected, what does
 * tapping `tappedCardId` mean? Kept in its own module (no Phaser import) so it's unit-testable
 * without a browser `window`. Mirrors `placeSelected`'s hand-vs-table rule: the hand is only a
 * valid drop destination for a card played to the table this turn, never for another hand card —
 * so two hand cards means "switch selection", matching drag semantics.
 */
export function resolveCardTapDestination(
  editor: DraftEditor,
  heldCardId: string,
  tappedCardId: string,
): { kind: 'switch' } | { kind: 'meld'; meldId: string } | { kind: 'hand' } {
  const heldFromHand = editor.getRemainingHand().some((c) => c.id === heldCardId);
  const tappedInHand = editor.getRemainingHand().some((c) => c.id === tappedCardId);
  if (heldFromHand && tappedInHand) return { kind: 'switch' };
  const meld = editor.getDraft().melds.find((m) => m.cards.some((c) => c.id === tappedCardId));
  if (meld) return { kind: 'meld', meldId: meld.id };
  return { kind: 'hand' };
}
