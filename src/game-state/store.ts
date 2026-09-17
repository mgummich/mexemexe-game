import { bus } from '../core/events';
import { applyConfirmedTurn, drawAndEndTurn } from '../rules/rules';
import type { DraftState, GameState, PlayerState } from '../rules/types';

/**
 * Authoritative local store. Committed state only; drafts live in mexe-mode.
 *
 * It owns one mutable field — the current `GameState` — and replaces it only with what a pure
 * `src/rules` transition returned. `GameState` itself is readonly (ARCH-005), so `get()` can hand
 * out the live object on the render path without a copy and still not be mutable by its readers.
 * Deals and transitions live in `src/rules` so the server shares them; the bus emission below is
 * the part that stays client-side (ARCH-004).
 */
export class GameStore {
  private state: GameState;

  constructor(initial: GameState) {
    this.state = initial;
  }

  /** The live authoritative object, readonly by type — never clone it on this path. */
  get(): GameState {
    return this.state;
  }

  get activePlayer(): PlayerState {
    return this.state.players[this.state.activePlayerIndex]!;
  }

  confirmTurn(draft: DraftState): GameState {
    const prev = this.activePlayer;
    const before = prev.hand.length;
    this.state = applyConfirmedTurn(this.state, draft);
    const after = this.state.players.find((p) => p.id === prev.id)!.hand.length;
    bus.emit('turn:confirmed', { playerId: prev.id, cardsPlayed: before - after });
    this.postTurn();
    return this.state;
  }

  drawEndTurn(): GameState {
    const playerId = this.activePlayer.id;
    this.state = drawAndEndTurn(this.state);
    bus.emit('turn:drawn', { playerId });
    this.postTurn();
    return this.state;
  }

  private postTurn(): void {
    if (this.state.winnerId) {
      bus.emit('game:won', { winnerId: this.state.winnerId });
    } else {
      bus.emit('turn:start', { playerId: this.activePlayer.id, turn: this.state.turn });
    }
  }
}
