import type { Card, DraftState, GameState } from '../rules/types';

/**
 * The base evaluation of one legal candidate move. Neutral by design: it describes generally
 * competent play and nothing else. Personality and difficulty stay where they already are —
 * personality picks the *policy* (which candidates get generated at all: minimal play, joker
 * holding, patience), difficulty picks the *search tier* — so neither leans on these numbers.
 *
 * Features, what each measures and why it correlates with better play:
 * - `winsNow`: this draft empties the hand, which ends the match in this seat's favour. Nothing
 *   else can be worth more, so it is compared first rather than given a large weight.
 * - `cardsPlayed`: hand cards this draft sheds. The objective of the game is an empty hand, and
 *   every card shed is a card that cannot be left stranded. Range 1..hand size.
 * - `jokersOnTable`: jokers this draft leaves lying in the committed table. The table is shared,
 *   so a joker spent early mostly helps whoever moves next; fewer is better at equal shedding.
 * - `strandedCards`: the future-state half of the evaluation. Every other feature scores what a
 *   draft does *now*; this one scores the hand it leaves behind. A card is stranded when no other
 *   card left in hand could ever combine with it (`hasPartner` below), so it can only be shed once
 *   the draw pile or the shared table happens to hand over a partner. Two candidates that shed the
 *   same number of cards are not equally good if one keeps a pair and the other breaks it, and
 *   before this feature that choice fell through to the id tie-break, i.e. to chance. Counting the
 *   dead cards rather than the live ones keeps the comparison in the same "lower is better"
 *   direction as `jokersOnTable` and stays well defined for an empty remaining hand (0).
 * - `playedIds`: sorted ids of the cards played. Carries no strategy — it exists so that two
 *   otherwise indistinguishable candidates have a stable order that does not depend on the order
 *   the search happened to find them in.
 *
 * Deliberately a small lexicographic comparison rather than one weighted sum: the priorities are
 * genuinely ordinal (no amount of joker thrift is worth one fewer card shed), and a sum would need
 * magic constants to express that while quietly allowing a feature to dominate by accident.
 */
export interface CandidateFeatures {
  readonly winsNow: boolean;
  readonly cardsPlayed: number;
  readonly jokersOnTable: number;
  readonly strandedCards: number;
  readonly playedIds: readonly string[];
}

/**
 * Could `card` ever grow into a meld with something else still in hand? A joker partners with
 * anything; two naturals partner as the start of a set (same rank, different suits) or of a run
 * (same suit, within two ranks, so a one-card gap still counts). An ace is rank 1 but also plays
 * high, so it additionally partners the king and queen of its suit. A heuristic on purpose: it
 * asks whether a pair is worth keeping together, not whether a meld is actually reachable —
 * legality stays in `src/rules`.
 */
function hasPartner(card: Card, hand: readonly Card[], index: number): boolean {
  if (card.isJoker) return true;
  return hand.some((other, i) => {
    if (i === index) return false;
    if (other.isJoker) return true;
    if (other.rank === card.rank) return other.suit !== card.suit;
    if (other.suit !== card.suit || other.rank === null) return false;
    const lo = Math.min(other.rank, card.rank!);
    const hi = Math.max(other.rank, card.rank!);
    return hi - lo <= 2 || (lo === 1 && hi >= 12); // ...or the ace reaching up to Q/K
  });
}

/** Pure: features of `draft` as played from `observation`'s active seat. */
export function evaluateDraft(observation: GameState, draft: DraftState): CandidateFeatures {
  const handSize = observation.players[observation.activePlayerIndex]!.hand.length;
  const played = draft.handCardsPlayed;
  const spent = new Set(played);
  const remaining = observation.players[observation.activePlayerIndex]!.hand.filter((c) => !spent.has(c.id));
  return {
    winsNow: played.length === handSize && handSize > 0,
    cardsPlayed: played.length,
    jokersOnTable: draft.melds.reduce((n, m) => n + m.cards.filter((c) => c.isJoker).length, 0),
    strandedCards: remaining.filter((c, i) => !hasPartner(c, remaining, i)).length,
    playedIds: [...played].sort(),
  };
}

/**
 * Base objective hierarchy, strongest first:
 *   1. win immediately
 *   2. shed more hand cards
 *   3. leave fewer jokers on the shared table
 *   4. leave fewer stranded cards in hand (the one look at the resulting state)
 *   5. deterministic tie-break (sorted played ids)
 *
 * Legality is not in this list on purpose: an illegal candidate never reaches evaluation — the
 * generators only offer drafts `DraftEditor.canConfirm` has already accepted (INV-A1).
 *
 * Returns <0 when `a` is the better move, so an array of candidates can be `sort`ed directly.
 */
export function compareByBaseEvaluation(a: CandidateFeatures, b: CandidateFeatures): number {
  if (a.winsNow !== b.winsNow) return a.winsNow ? -1 : 1;
  if (a.cardsPlayed !== b.cardsPlayed) return b.cardsPlayed - a.cardsPlayed;
  if (a.jokersOnTable !== b.jokersOnTable) return a.jokersOnTable - b.jokersOnTable;
  if (a.strandedCards !== b.strandedCards) return a.strandedCards - b.strandedCards;
  for (let i = 0; i < a.playedIds.length; i++) {
    const x = a.playedIds[i]!;
    const y = b.playedIds[i]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
