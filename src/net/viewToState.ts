import type { Card, GameState, PlayerState } from '../rules/types';
import type { GameView } from './protocol';

/** A view arrived that no `GameState` can represent. Carries the specific problem, not a stack. */
export class UnprojectableViewError extends Error {
  constructor(readonly problem: string) {
    super(`unprojectable view: ${problem}`);
    this.name = 'UnprojectableViewError';
  }
}

/**
 * The seat/index consistency the projection cannot express as a `GameState`, or null when the view
 * projects. The server is trusted, but the wire is still a boundary (AGENTS.md), and this is the
 * one class of inconsistency the state digest cannot see: `digestOfView` hashes `view.activeSeat`
 * and `digestOfState` hashes the `activePlayerIndex` copied straight from it, so a seat pointing at
 * no player agrees with itself perfectly and passes the desync check. Everything else a malformed
 * view can get wrong (`handCount`, `drawCount`, the table) is re-derived from the projection on one
 * side and taken from the view on the other, so the digest already catches it.
 *
 * Deliberately narrow: this is not a schema validator for the whole frame. It answers exactly one
 * question — can the active seat be resolved to a player?
 */
export function viewProjectionProblem(view: GameView): string | null {
  if (view.players.length === 0) return 'no players';
  if (!Number.isInteger(view.activeSeat) || view.activeSeat < 0 || view.activeSeat >= view.players.length) {
    return `activeSeat ${view.activeSeat} outside 0..${view.players.length - 1}`;
  }
  return null;
}

/**
 * Synthesizes a full `GameState` from a redacted `GameView` so the existing renderer,
 * `DraftEditor`, and `canConfirmTurn` (which only ever read `state.table` and the active
 * player's own hand) work unchanged online — no fork of GameScene's rendering path needed.
 *
 * PLACEHOLDER TRICK: opponent hands and the draw pile are never sent to this client, so they
 * are filled with fabricated `Card` objects that exist only to make `.length` and array
 * iteration behave (avatar bar card counts, deck counter). These ids (`__placeholder-N`) are
 * never real cards, never sent back to the server, and must never be used for validation —
 * only the server's own state is authoritative. Do not "fix" a bug by reading suit/rank off one.
 *
 * Throws `UnprojectableViewError` when the view cannot become a coherent `GameState` — see
 * `viewProjectionProblem`. Callers with a recovery path (`OnlineSession.applySync`) catch it and
 * resync; the rest let it surface rather than render a state that cannot exist.
 */
export function viewToState(view: GameView): GameState {
  const problem = viewProjectionProblem(view);
  if (problem !== null) throw new UnprojectableViewError(problem);

  const placeholder = (i: number): Card => ({
    id: `__placeholder-${i}`,
    deckId: 0,
    suit: 'hearts',
    rank: 1,
    isJoker: false,
  });

  const players: PlayerState[] = view.players.map((p) => ({
    id: p.id,
    name: p.name,
    isAi: false,
    hand: p.hand ? p.hand.map((c) => ({ ...c })) : Array.from({ length: p.handCount }, (_, i) => placeholder(i)),
  }));

  return {
    seed: 0,
    players,
    activePlayerIndex: view.activeSeat,
    table: view.table.map((m) => ({ id: m.id, cards: m.cards.map((c) => ({ ...c })) })),
    drawPile: Array.from({ length: view.drawCount }, (_, i) => placeholder(i)),
    turn: view.turn,
    winnerId: view.winnerId,
    phase: view.phase,
    config: view.config,
  };
}
