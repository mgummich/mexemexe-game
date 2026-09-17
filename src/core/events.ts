/** Minimal typed event bus. Decouples game logic from Phaser layer. */
type EventMap = Record<string, unknown>;

/**
 * Application-lifetime facts only: something that is true of the *page*, for as long as the page
 * exists, and that several unrelated scenes react to. Everything match-scoped is published by the
 * match that owns it (`LocalMatch.on`, `src/game-state/match.ts`) rather than here, so a stale
 * subscriber cannot hear the next match and gameplay never depends on a global singleton
 * (ARCH-004, ARCH-007).
 *
 * Every event here is a notification of a fact that already happened, never a command: no
 * subscriber is load-bearing and delivery order carries no meaning.
 */
export interface GameEvents extends EventMap {
  /** Orientation/pointer profile flipped (see src/ui/viewport.ts) — scenes re-lay-out.
   * Publisher: `src/main.ts`. Subscribers: every scene, plus the play log. */
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
