import type { Card, Rank, Suit } from '../rules/types';

/**
 * Presentation-only breakdown of *why* an invalid meld looks wrong, derived from the same cards
 * the validator already rejected — never a second legality opinion (see rules/rules.ts, the only
 * source of truth for validity). Feeds MEXE-19/RECOVERY-04: pulsing the exact conflicting cards
 * and drawing the missing run slot, instead of only naming the reason in text.
 */
export interface InvalidDetail {
  /** Card ids directly responsible for the conflict (duplicate/mismatched suit). */
  conflictCardIds: string[];
  /** Index within `cards` (rendered order) where a missing run card belongs, if determinable. */
  missingSlotIndex?: number;
  /** The exact card that would fill `missingSlotIndex`, when known. */
  missingCard?: { suit: Suit; rank: Rank };
}

const EMPTY: InvalidDetail = { conflictCardIds: [] };

/** A trinca/group with 2+ naturals sharing a suit: the cards of the repeated suit(s) are the conflict. */
function groupDuplicateSuitDetail(cards: readonly Card[]): InvalidDetail {
  const bySuit = new Map<string, Card[]>();
  for (const c of cards) {
    if (c.isJoker || !c.suit) continue;
    const list = bySuit.get(c.suit) ?? [];
    list.push(c);
    bySuit.set(c.suit, list);
  }
  const conflictCardIds = [...bySuit.values()].filter((l) => l.length > 1).flatMap((l) => l.map((c) => c.id));
  return { conflictCardIds };
}

/** A run whose naturals don't all share a suit: cards off the majority suit are the conflict. */
function runSuitMismatchDetail(cards: readonly Card[]): InvalidDetail {
  const naturals = cards.filter((c) => !c.isJoker && c.suit);
  const counts = new Map<string, number>();
  for (const c of naturals) counts.set(c.suit!, (counts.get(c.suit!) ?? 0) + 1);
  let majority: Suit | null = naturals[0]?.suit ?? null;
  let best = 0;
  for (const [suit, n] of counts) if (n > best) { best = n; majority = suit as Suit; }
  const conflictCardIds = naturals.filter((c) => c.suit !== majority).map((c) => c.id);
  return { conflictCardIds };
}

/**
 * A jokerless run missing exactly one step: finds the single gap between rendered naturals and
 * reports where a placeholder card belongs. Anything messier (multiple gaps, no clean single-suit
 * ladder) reports no slot rather than guessing — the reason text still names the problem.
 */
function runGapDetail(cards: readonly Card[]): InvalidDetail {
  const naturals = cards.filter((c) => !c.isJoker && c.rank !== null);
  if (naturals.length < 2) return EMPTY;
  for (const high of [false, true]) {
    const values = naturals.map((c) => (c.rank === 1 && high ? 14 : (c.rank as Rank)));
    const sorted = [...values].sort((a, b) => a - b);
    if (new Set(sorted).size !== sorted.length) continue; // duplicate rank in this mode
    let gapAt = -1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]! - sorted[i - 1]! === 2 && gapAt === -1) gapAt = i;
      else if (sorted[i]! - sorted[i - 1]! !== 1) { gapAt = -1; break; } // more than one hole: give up
    }
    if (gapAt === -1) continue;
    const missingValue = sorted[gapAt - 1]! + 1;
    // Slot index in rendered order: right after the natural whose value is just below the gap.
    const before = cards.findIndex((c) => !c.isJoker && (c.rank === 1 && high ? 14 : c.rank) === sorted[gapAt - 1]);
    if (before === -1) continue;
    const suit = naturals[0]!.suit as Suit;
    const rank = (missingValue === 14 ? 1 : missingValue) as Rank;
    return { conflictCardIds: [], missingSlotIndex: before + 1, missingCard: { suit, rank } };
  }
  return EMPTY;
}

/** RECOVERY-14: a joker with nowhere to go — every joker in the meld is the conflict, since which
 * one is "the" problem is arbitrary once there's too many, and a lone unassignable joker is always
 * itself the problem. */
function jokerConflictDetail(cards: readonly Card[]): InvalidDetail {
  return { conflictCardIds: cards.filter((c) => c.isJoker).map((c) => c.id) };
}

/** Dispatches on the reason code the validator already produced. `cards` must be the same meld's cards. */
export function invalidMeldDetail(cards: readonly Card[], reason: string): InvalidDetail {
  switch (reason) {
    case 'reason.groupDuplicateSuit':
      return groupDuplicateSuitDetail(cards);
    case 'reason.runSuitMismatch':
      return runSuitMismatchDetail(cards);
    case 'reason.runGap':
      return runGapDetail(cards);
    case 'reason.tooManyJokers':
    case 'reason.jokerUnassignable':
      return jokerConflictDetail(cards);
    default:
      return EMPTY;
  }
}
