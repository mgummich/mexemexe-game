import type { DraftState, GameState } from '../rules/types';

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
  readonly playedIds: readonly string[];
}

/** Pure: features of `draft` as played from `observation`'s active seat. */
export function evaluateDraft(observation: GameState, draft: DraftState): CandidateFeatures {
  const handSize = observation.players[observation.activePlayerIndex]!.hand.length;
  const played = draft.handCardsPlayed;
  return {
    winsNow: played.length === handSize && handSize > 0,
    cardsPlayed: played.length,
    jokersOnTable: draft.melds.reduce((n, m) => n + m.cards.filter((c) => c.isJoker).length, 0),
    playedIds: [...played].sort(),
  };
}

/**
 * Base objective hierarchy, strongest first:
 *   1. win immediately
 *   2. shed more hand cards
 *   3. leave fewer jokers on the shared table
 *   4. deterministic tie-break (sorted played ids)
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
  for (let i = 0; i < a.playedIds.length; i++) {
    const x = a.playedIds[i]!;
    const y = b.playedIds[i]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
