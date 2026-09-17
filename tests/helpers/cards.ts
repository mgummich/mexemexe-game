import { cardId, jokerId } from '../../src/rules/rules';
import type { Card, GameState, Rank, Suit } from '../../src/rules/types';

/** Natural card test helper. Mirrors createDeck()'s id format exactly. */
export function n(suit: Suit, rank: number, deckId = 0): Card {
  return { id: cardId(suit, rank as Rank, deckId), deckId, suit, rank: rank as Rank, isJoker: false };
}

/** Joker test helper. `k` is the 1-based joker index within its deck (matches createDeck()). */
export function j(deckId: number, k: number): Card {
  return { id: jokerId(deckId, k), deckId, suit: null, rank: null, isJoker: true };
}

/**
 * Restage a seat's hand. `GameState` is readonly (ARCH-005), so a fixture that wants a specific
 * hand rebuilds the state instead of writing into the store's object.
 */
export function withHand(state: GameState, index: number, hand: Card[]): GameState {
  return { ...state, players: state.players.map((p, i) => (i === index ? { ...p, hand } : p)) };
}
