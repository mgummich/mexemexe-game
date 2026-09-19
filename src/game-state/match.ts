import { createAi, observeForAi, type AiDecision, type Difficulty, type Personality } from '../ai/ai';
import type { GameState, PlayerState } from '../rules/types';
import type { ActionOutcome, GameAction } from './actions';
import type { Replay } from './replay';
import { GameStore } from './store';

/**
 * A fact about the match that already happened. Notifications only: nothing here advances the
 * turn cycle (the caller does that from `dispatch`'s returned outcome), and a match with no
 * listener behaves identically to one with five.
 */
export type MatchEvent =
  | { type: 'turn:confirmed'; playerId: string; cardsPlayed: number }
  | { type: 'turn:drawn'; playerId: string }
  | { type: 'turn:start'; playerId: string; turn: number }
  | { type: 'game:won'; winnerId: string };

/** What one AI turn did. `stale` means the match moved on (or ended) while the search was yielding. */
export type AiTurnResult =
  | { kind: 'acted'; decision: AiDecision; outcome: ActionOutcome; before: GameState }
  | { kind: 'stale' }
  | { kind: 'fallback'; error: string; outcome: ActionOutcome; before: GameState };

export interface LocalMatchConfig {
  /** Which player index this device plays. 0 for every local match; an online match has no `LocalMatch`. */
  localSeat: number;
  /** Personality per player index, `null` for a human seat. Empty for the tutorial's scripted opponent. */
  personalities: (Personality | null)[];
}

/**
 * The local match's application boundary: one owner for committed state, the turn cycle and AI
 * turn routing, with no Phaser, no DOM and no timers in it (ARCH-001).
 *
 * A scene renders what `state()` says and forwards intents to `dispatch`/`runAiTurn`; it never
 * calls a `src/rules` transition and never advances the cycle itself. Everything a match must not
 * inherit from the previous one lives *here*, so a rematch is `new LocalMatch(...)` rather than a
 * list of fields to remember to clear (ARCH-018).
 *
 * Notifications are per-instance (`on`), not a process-global bus: a listener attached to the
 * previous match cannot hear this one (ARCH-004, ARCH-007).
 */
export class LocalMatch {
  private readonly store: GameStore;
  private readonly listeners = new Set<(e: MatchEvent) => void>();
  /** Set by `dispose()`. An AI search that yields across frames re-checks it before acting. */
  private disposed = false;

  constructor(initial: GameState, readonly config: LocalMatchConfig) {
    this.store = new GameStore(initial);
  }

  /** Subscribe to this match's notifications. The returned function detaches; the match holds no
   * global registration, so forgetting to call it leaks nothing past this instance. */
  on(fn: (e: MatchEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** No further action is accepted and an in-flight AI decision is discarded. Idempotent. */
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  state(): GameState {
    return this.store.get();
  }

  get activePlayer(): PlayerState {
    return this.store.activePlayer;
  }

  replay(): Replay {
    return this.store.replay();
  }

  /**
   * The one local gameplay-action path. Applies the action through the pure kernel, then
   * announces what happened. The caller drives what happens next from the outcome.
   */
  dispatch(action: GameAction): ActionOutcome {
    if (this.disposed) return { ok: false, reasons: ['reason.notYourTurn'] };
    const outcome = this.store.dispatch(action);
    if (!outcome.ok) return outcome;
    if (action.type === 'confirmTurn') {
      this.emit({ type: 'turn:confirmed', playerId: outcome.actorId, cardsPlayed: outcome.cardsPlayed });
    } else {
      this.emit({ type: 'turn:drawn', playerId: outcome.actorId });
    }
    if (outcome.finished) this.emit({ type: 'game:won', winnerId: this.store.get().winnerId! });
    else this.emit({ type: 'turn:start', playerId: this.activePlayer.id, turn: this.store.get().turn });
    return outcome;
  }

  /**
   * Decide and commit one AI turn for the active seat. The decision is the AI's; the routing from
   * decision to `GameAction` is here, so it is the same `dispatch` a person's FEITO takes.
   *
   * The engine may yield across frames (`decideSliced`), so the state is re-checked before the
   * action lands: anything that moved on in between makes the decision stale and it is dropped
   * rather than applied to a board it was not computed for. A throwing engine falls back to a
   * draw — an AI must never be able to end the match.
   */
  async runAiTurn(personality: Personality, difficulty: Difficulty): Promise<AiTurnResult> {
    const before = this.store.get();
    const actorIndex = before.activePlayerIndex;
    try {
      const ai = createAi(personality, difficulty);
      // The engine is handed the seat's player view, not the authoritative state: the hidden
      // halves (other hands, pile order, deal seed) are absent from the object it decides on.
      const observation = observeForAi(before);
      const decision = ai.decideSliced ? await ai.decideSliced(observation) : ai.decide(observation);
      if (this.disposed || this.store.get() !== before) return { kind: 'stale' };
      const outcome = this.dispatch(
        decision.kind === 'confirm'
          ? { type: 'confirmTurn', actorIndex, draft: decision.draft }
          : { type: 'drawAndEndTurn', actorIndex },
      );
      // Every candidate the engine offers has already passed `DraftEditor.canConfirm`, so a
      // refusal here means the proposal and the rules disagree — a bug, not a legal outcome. The
      // turn still has to end: without this the seat would keep the turn forever and the match
      // would stall on a board nobody can move (INV-A3).
      if (!outcome.ok && decision.kind === 'confirm') {
        return {
          kind: 'fallback',
          error: `ai confirm refused: ${outcome.reasons.join(',')}`,
          outcome: this.dispatch({ type: 'drawAndEndTurn', actorIndex }),
          before,
        };
      }
      return { kind: 'acted', decision, outcome, before };
    } catch (e) {
      if (this.disposed) return { kind: 'stale' };
      return { kind: 'fallback', error: String(e), outcome: this.dispatch({ type: 'drawAndEndTurn', actorIndex }), before };
    }
  }

  private emit(event: MatchEvent): void {
    for (const fn of [...this.listeners]) fn(event);
  }
}
