import { expect } from 'vitest';
import type { Card, GameState } from '../../src/rules/types';
import { DEFAULT_RULES } from '../../src/rules/types';

/** Every card an authoritative state can account for: hands + table + draw pile. */
export function allCards(state: GameState): Card[] {
  return [...state.players.flatMap((p) => p.hand), ...state.table.flatMap((m) => m.cards), ...state.drawPile];
}

/** The whole card set a default match is dealt from. */
export const TOTAL_CARDS = DEFAULT_RULES.deckCount * (52 + DEFAULT_RULES.jokersPerDeck); // 108

/**
 * GQA-02 card conservation. No card lost, duplicated or invented.
 *
 * `expected` is either the id set the state must hold exactly (use the ids taken
 * before the action) or a count (defaults to a full deal). Counting alone is not
 * enough: one lost card paired with one duplicated card keeps the total intact,
 * which is why the duplicate check is unconditional.
 */
export function expectCardConservation(state: GameState, expected: readonly string[] | number = TOTAL_CARDS): void {
  const ids = allCards(state).map((c) => c.id);
  expect(new Set(ids).size, 'duplicate card id').toBe(ids.length);
  if (typeof expected === 'number') expect(ids).toHaveLength(expected);
  else expect([...ids].sort()).toEqual([...expected].sort());
}
