/** Minimal typed event bus. Decouples game logic from Phaser layer. */
export type EventMap = Record<string, unknown>;

export interface GameEvents extends EventMap {
  'game:ready': { seed: number };
  'turn:start': { playerId: string; turn: number };
  'draft:changed': { valid: boolean; reasons: string[] };
  'turn:confirmed': { playerId: string; cardsPlayed: number };
  'turn:drawn': { playerId: string };
  'game:won': { winnerId: string };
  'ai:thought': { playerId: string; text: string };
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
