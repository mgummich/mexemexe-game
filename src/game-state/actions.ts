import { applyConfirmedTurn, canConfirmTurn, drawAndEndTurn } from '../rules/rules';
import type { DraftState, GameState, ReasonCode } from '../rules/types';

/**
 * The application-level vocabulary for "change the committed local game state".
 *
 * Every local actor — human FEITO/COMPRAR, AI, tutorial opponent, the `window.__MEXE__` hooks —
 * expresses intent as one of these and nothing else calls a `src/rules` transition directly.
 * Only state-*changing* gameplay intent belongs here: opening a panel, zooming the table or
 * starting a scene are not actions.
 *
 * Deliberately not modelled: a timer expiry action. A timeout is not its own transition anywhere
 * — online the server applies `timerExpireTurn`, and a local Blitz turn that runs out dispatches
 * the ordinary `drawAndEndTurn` from the scene that owns the deadline. The server keeps its own
 * precondition path (`claimTurn`) because it also has `rev` and seat authority to check.
 */
export type GameAction =
  | { type: 'confirmTurn'; actorIndex: number; draft: DraftState }
  | { type: 'drawAndEndTurn'; actorIndex: number };

/** What an action did. `ok: false` is the only shape that leaves the state untouched. */
export type ActionOutcome =
  | { ok: false; reasons: ReasonCode[] }
  | {
      ok: true;
      state: GameState;
      /** Who acted — the player as they were *before* the turn passed. */
      actorId: string;
      /** Hand cards the action committed to the table. 0 for a draw. */
      cardsPlayed: number;
      /** The transition ended the match; `state.winnerId` is set. */
      finished: boolean;
    };

/**
 * Pure: validate an action against a state and return either the next state or the reasons it was
 * refused. No bus, no store, no side effects — this is what makes a test or a replay able to
 * drive the same path a scene drives, without Phaser.
 *
 * Preconditions checked here, in order: the match is still playing, the actor is the active
 * player, then the rules' own legality check. Anything refused returns `ReasonCode`s the UI
 * already knows how to translate.
 */
export function applyGameAction(state: GameState, action: GameAction): ActionOutcome {
  // Acting on a finished match and acting out of turn are the same mistake from the kernel's
  // point of view: this seat has no move to make right now.
  if (state.phase !== 'playing' || state.activePlayerIndex !== action.actorIndex) {
    return { ok: false, reasons: ['reason.notYourTurn'] };
  }
  const actor = state.players[action.actorIndex]!;

  if (action.type === 'drawAndEndTurn') {
    const next = drawAndEndTurn(state);
    return { ok: true, state: next, actorId: actor.id, cardsPlayed: 0, finished: next.phase === 'finished' };
  }

  const check = canConfirmTurn(state, action.draft);
  if (!check.ok) return { ok: false, reasons: check.reasons };
  const next = applyConfirmedTurn(state, action.draft);
  const after = next.players.find((p) => p.id === actor.id)!;
  return {
    ok: true,
    state: next,
    actorId: actor.id,
    cardsPlayed: actor.hand.length - after.hand.length,
    finished: next.phase === 'finished',
  };
}
