/** Minimal typed event bus. Decouples game logic from Phaser layer. */
type EventMap = Record<string, unknown>;

/**
 * Every event here is a *notification of a fact that already happened*, never a command and never
 * a step in advancing the game. Gameplay control flow runs on `GameStore.dispatch`'s returned
 * outcome (see src/game-state/actions.ts), so no subscriber is load-bearing and delivery order
 * carries no gameplay meaning. Nothing is added here that a return value could carry instead.
 */
export interface GameEvents extends EventMap {
  /** A turn was committed to the local store. Publisher: `GameStore`. */
  'turn:confirmed': { playerId: string; cardsPlayed: number };
  /** A card was drawn and the turn passed, locally. Publisher: `GameStore`. */
  'turn:drawn': { playerId: string };
  /** The next local turn began. Publisher: `GameStore`. */
  'turn:start': { playerId: string; turn: number };
  /** The local match ended. Publisher: `GameStore`. */
  'game:won': { winnerId: string };
  /** Orientation/pointer profile flipped (see src/ui/viewport.ts) — scenes re-lay-out. */
  'viewport:changed': { portrait: boolean };
}

type Handler<T> = (payload: T) => void;

export class EventBus<E extends EventMap = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(event: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<never>);
    return () => set.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.handlers.get(event)?.forEach((fn) => (fn as Handler<E[K]>)(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const bus = new EventBus();
