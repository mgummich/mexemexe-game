import type { Card, GameState } from '../rules/types';

declare const observed: unique symbol;

/**
 * What an AI seat is allowed to look at: a `GameState` in which everything the seat could not
 * legitimately know has been replaced by count-only stand-ins (INV-A2). It is a `GameState`, so
 * `DraftEditor` and `canConfirmTurn` read it unchanged — the difference is that the hidden halves
 * simply are not in the object any more, instead of being present and merely not read.
 *
 * The brand is what makes that structural rather than conventional: only `observeForAi` can
 * produce one, so `ai.decide(state)` with an authoritative state no longer type-checks.
 */
export type AiObservation = GameState & { readonly [observed]: true };

/**
 * Stand-in for a card this seat may not see. Same trick as `viewToState`'s `__placeholder-`
 * cards: it exists so `.length` and iteration behave (an opponent's hand size and the pile depth
 * are public), and its suit/rank are meaningless. Never use one for validation — the ids are not
 * real cards and never reach a draft (a draft only ever contains the active hand and the table).
 */
function hidden(tag: string, i: number): Card {
  return { id: `__hidden-${tag}-${i}`, deckId: 0, suit: 'hearts', rank: 1, isJoker: false };
}

function countOnly(tag: string, count: number): Card[] {
  return Array.from({ length: count }, (_, i) => hidden(tag, i));
}

/** Freezes the projection, not the authoritative state: every object below is a fresh copy. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * Project the active seat's player view out of authoritative state. Redacted: the other seats'
 * hand identities, the draw pile's order and the deal seed (which is the pile's order, one step
 * removed). Kept: own hand, the committed table, whose turn it is, the turn number, the public
 * per-seat metadata and the rules config — the same information a remote player is sent online.
 *
 * The copy is deep-frozen, so an engine that tried to work in place on its input would throw
 * rather than quietly corrupt the board it is deciding about.
 */
export function observeForAi(state: GameState): AiObservation {
  const seat = state.activePlayerIndex;
  const view: GameState = {
    ...state,
    seed: 0,
    players: state.players.map((p, i) => ({
      ...p,
      hand: i === seat ? p.hand.map((c) => ({ ...c })) : countOnly(`p${i}`, p.hand.length),
    })),
    table: state.table.map((m) => ({ id: m.id, cards: m.cards.map((c) => ({ ...c })) })),
    drawPile: countOnly('pile', state.drawPile.length),
  };
  return deepFreeze(view) as AiObservation;
}
