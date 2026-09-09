import { analyzeMeld, sortMeldCards } from '../rules/rules';
import type { Card, DraftState, JokerAssignment, ReasonCode, RulesConfig } from '../rules/types';
import { DEFAULT_RULES } from '../rules/types';

export type SnapStatus = 'legal' | 'incomplete' | 'illegal';

/**
 * Three statuses, not a boolean: in Mexe Mode a meld under 3 cards ('incomplete') is a normal
 * mid-edit state, not an error — it must not be painted red like a real contradiction
 * ('illegal': repeated suit, second joker, unassignable joker).
 */
export interface SnapTarget {
  /** Existing meld id, or null for the "empty table area = start a new meld" target. */
  meldId: string | null;
  status: SnapStatus;
  /** The validator's reason when status is not 'legal'; null when 'legal'. */
  reason: ReasonCode | null;
  /** The meld as it would look after this drop, display-sorted. Fresh copies — never shares
   * card objects with the draft. */
  preview: Card[];
  /** Joker assignments for the previewed meld; empty unless status === 'legal'. */
  jokerAssignments: JokerAssignment[];
}

function statusFor(reason: ReasonCode | null): SnapStatus {
  if (reason === null) return 'legal';
  return reason === 'reason.meldTooSmall' ? 'incomplete' : 'illegal';
}

function targetFor(meldId: string | null, cards: readonly Card[], card: Card, config: RulesConfig): SnapTarget {
  const next = [...cards, card].map((c) => ({ ...c }));
  const analysis = analyzeMeld(next, config);
  const reason = analysis.valid ? null : analysis.reason;
  return {
    meldId,
    status: statusFor(reason),
    reason,
    preview: sortMeldCards(next, config),
    jokerAssignments: analysis.valid ? analysis.assignments : [],
  };
}

export function computeSnapTargets(
  draft: DraftState,
  card: Card,
  config: RulesConfig = DEFAULT_RULES,
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const meld of draft.melds) {
    if (meld.cards.some((c) => c.id === card.id)) continue;
    targets.push(targetFor(meld.id, meld.cards, card, config));
  }
  targets.push(targetFor(null, [], card, config));
  return targets;
}

export function snapTargetFor(targets: readonly SnapTarget[], meldId: string | null): SnapTarget | null {
  return targets.find((t) => t.meldId === meldId) ?? null;
}
