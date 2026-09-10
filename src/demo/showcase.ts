import { SimpleAi } from '../ai/ai';
import { createNewGame, type PlayerConfig } from '../game-state/store';
import { applyConfirmedTurn, drawAndEndTurn } from '../rules/rules';
import type { GameState } from '../rules/types';

/** Total cards currently laid on the table, across every meld. */
function tableCardCount(state: GameState): number {
  return state.table.reduce((sum, m) => sum + m.cards.length, 0);
}

/**
 * Deterministic mid-game state for screenshots/e2e: runs bots forward until
 * the table has melds and it's the human's turn. Card conservation guaranteed
 * because only rules functions mutate state.
 *
 * `minTableCards`, when given, keeps driving turns past the normal "human's turn +
 * table non-empty" stop condition until the table holds at least that many cards (or a guard
 * below ends the loop first) — used to reach a crowded-table state for stress screenshots.
 */
export function buildShowcaseState(seed: number, players: PlayerConfig[], minTableCards?: number): GameState {
  let state = createNewGame(seed, players);
  const ai = new SimpleAi();
  const iterationCap = minTableCards ? 200 : 60; // measured: natural games finish by turn ~114 (2p, seed sweep 0-2999)
  for (let i = 0; i < iterationCap; i++) {
    const active = state.players[state.activePlayerIndex]!;
    const reachedFloor = minTableCards !== undefined && tableCardCount(state) >= minTableCards;
    if (!active.isAi && state.table.length > 0 && (minTableCards === undefined || reachedFloor)) return state;
    if (active.isAi) {
      const d = ai.decide(state);
      state = d.kind === 'confirm' ? applyConfirmedTurn(state, d.draft) : drawAndEndTurn(state);
    } else {
      state = drawAndEndTurn(state);
    }
    if (state.phase !== 'playing') break;
  }
  return state;
}
