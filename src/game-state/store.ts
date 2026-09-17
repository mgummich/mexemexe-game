import { bus } from '../core/events';
import type { GameState, PlayerState } from '../rules/types';
import { applyGameAction, type ActionOutcome, type GameAction } from './actions';

/**
 * Authoritative local store. Committed state only; drafts live in mexe-mode.
 *
 * It owns one mutable field — the current `GameState` — and replaces it only with what
 * `applyGameAction` returned. `GameState` itself is readonly (ARCH-005), so `get()` can hand out
 * the live object on the render path without a copy and still not be mutable by its readers.
 *
 * `dispatch` is the only way in. It is the local *application* boundary: preconditions and the
 * transition are the pure `applyGameAction`; the store adds the one mutable slot and announces
 * what happened. The bus emissions below are notifications only — a refused action emits nothing,
 * and no subscriber is part of advancing the turn cycle. The caller drives what happens next from
 * the returned outcome (ARCH-006). The server shares the rules, not this class (ARCH-004).
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

  /** Validate, apply, announce. Returns the outcome; the state is untouched when `ok` is false. */
  dispatch(action: GameAction): ActionOutcome {
    const outcome = applyGameAction(this.state, action);
    if (!outcome.ok) return outcome;
    this.state = outcome.state;
    if (action.type === 'confirmTurn') {
      bus.emit('turn:confirmed', { playerId: outcome.actorId, cardsPlayed: outcome.cardsPlayed });
    } else {
      bus.emit('turn:drawn', { playerId: outcome.actorId });
    }
    if (outcome.finished) bus.emit('game:won', { winnerId: this.state.winnerId! });
    else bus.emit('turn:start', { playerId: this.activePlayer.id, turn: this.state.turn });
    return outcome;
  }
}
