import type { Card, GameState, PlayerState } from '../rules/types';
import type { GameView } from './protocol';

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
 */
export function viewToState(view: GameView): GameState {
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
