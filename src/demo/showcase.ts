import { SimpleAi } from '../ai/ai';
import { createNewGame, type PlayerConfig } from '../game-state/store';
import { applyConfirmedTurn, drawAndEndTurn } from '../rules/rules';
import type { GameState } from '../rules/types';

/**
 * Deterministic mid-game state for screenshots/e2e: runs bots forward until
 * the table has melds and it's the human's turn. Card conservation guaranteed
 * because only rules functions mutate state.
 */
export function buildShowcaseState(seed: number, players: PlayerConfig[]): GameState {
  let state = createNewGame(seed, players);
  const ai = new SimpleAi();
  for (let i = 0; i < 60; i++) {
    const active = state.players[state.activePlayerIndex]!;
    if (!active.isAi && state.table.length > 0) return state;
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
