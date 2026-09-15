/**
 * Casual matchmaking queue. Pure-ish, like RoomManager: no sockets, no timers of its own (the
 * caller drives `expire`), so the whole matching policy is unit-testable in isolation.
 *
 * It chooses *who plays together* and nothing else. The moment a group is formed it stops being
 * involved: the caller allocates a room through RoomManager and the existing room lifecycle is
 * authoritative from there. There is no second gameplay path for queued matches.
 */
import { randomUUID } from 'node:crypto';
import type { QueueTarget } from '../src/net/protocol';

/** How long an entry may wait before it expires and the player is sent back to the online home.
 * Long enough that a quiet server still forms a table, short enough that nobody sits on a
 * searching screen believing something is still happening. */
export const QUEUE_TIMEOUT_MS = 120_000;

/** Hard ceiling on waiting entries. Past it new joins are refused with a friendly "busy" rather
 * than accepted into a structure that grows without bound. */
export const MAX_QUEUE_ENTRIES = 200;

/** Group sizes a room can have, smallest first — the order explicit preferences are honoured in. */
const SIZES = [2, 3, 4] as const;
/** Room capacity — server/rooms.ts MAX_PLAYERS. A group is never larger than a table. */
const MAX_GROUP = 4;

export interface QueueEntry {
  /** Session key for this entry. Becomes the *seat* token of the room it is matched into, which
   * is the whole reason reconnect needs no queue-specific recovery: one token, two lifetimes. */
  token: string;
  name: string;
  target: QueueTarget;
  joinedAt: number;
}

interface MatchQueueDeps {
  /** Injectable, for deterministic tests. Never client-chosen. */
  genToken?: () => string;
  timeoutMs?: number;
  maxEntries?: number;
}

export class MatchQueue {
  /** FIFO, oldest first. The only ordering the matcher has, and the only fairness it claims. */
  private entries: QueueEntry[] = [];
  private readonly genToken: () => string;
  private readonly timeoutMs: number;
  private readonly maxEntries: number;

  constructor(deps: MatchQueueDeps = {}) {
    this.genToken = deps.genToken ?? (() => randomUUID());
    this.timeoutMs = deps.timeoutMs ?? QUEUE_TIMEOUT_MS;
    this.maxEntries = deps.maxEntries ?? MAX_QUEUE_ENTRIES;
  }

  size(): number {
    return this.entries.length;
  }

  get(token: string): QueueEntry | null {
    return this.entries.find((e) => e.token === token) ?? null;
  }

  /** Add one waiting entry, or null when the queue is at its configured ceiling. The caller is
   * responsible for the one-entry-per-session rule — it holds the session identity, this holds
   * only the queue. */
  join(name: string, target: QueueTarget, now: number): QueueEntry | null {
    if (this.entries.length >= this.maxEntries) return null;
    const entry: QueueEntry = { token: this.genToken(), name, target, joinedAt: now };
    this.entries.push(entry);
    return entry;
  }

  /** Remove one entry. Idempotent: an unknown or already-matched token simply reports false. */
  cancel(token: string): boolean {
    const i = this.entries.findIndex((e) => e.token === token);
    if (i === -1) return false;
    this.entries.splice(i, 1);
    return true;
  }

  /** Remove and return every entry that has waited past the queue lifetime. Called from the
   * caller's existing sweep — a bounded scan of a bounded list, not a timer per entry. */
  expire(now: number): QueueEntry[] {
    const expired = this.entries.filter((e) => now - e.joinedAt >= this.timeoutMs);
    if (expired.length > 0) this.entries = this.entries.filter((e) => now - e.joinedAt < this.timeoutMs);
    return expired;
  }

  /**
   * Form every group that can be formed right now, **removing** each one from the queue as it is
   * formed. Removal is part of this call on purpose: an entry is either waiting or handed to the
   * caller, never both, so two matching passes cannot select the same entry.
   *
   * The policy, in full:
   *
   * 1. For each explicit size 2, then 3, then 4: while at least one entry still *asks* for that
   *    size and enough compatible entries exist (that size plus `any`), take the N oldest of them.
   *    Ascending, so the smallest table anyone explicitly asked for is the one that fills first.
   * 2. Then, from the `any` entries left over: while two or more remain, seat everyone waiting up
   *    to the room capacity of four. `any` means "play now", so it never waits for a bigger table.
   *
   * Oldest-first throughout, and no scoring of any kind. A group is never larger than four.
   */
  takeGroups(): QueueEntry[][] {
    const groups: QueueEntry[][] = [];
    let pool = this.entries;
    for (const size of SIZES) {
      for (;;) {
        const eligible = pool.filter((e) => e.target === size || e.target === 'any');
        if (eligible.length < size || !eligible.some((e) => e.target === size)) break;
        const group = eligible.slice(0, size);
        groups.push(group);
        pool = pool.filter((e) => !group.includes(e));
      }
    }
    for (;;) {
      const any = pool.filter((e) => e.target === 'any');
      if (any.length < 2) break;
      const group = any.slice(0, Math.min(MAX_GROUP, any.length));
      groups.push(group);
      pool = pool.filter((e) => !group.includes(e));
    }
    this.entries = pool;
    return groups;
  }

  /**
   * Put a taken group back, in its original wait order. The recovery path for a room allocation
   * that failed after the group was already removed: the players wait again instead of being
   * dropped on the floor with nothing said to them.
   */
  restore(group: QueueEntry[]): void {
    this.entries = [...this.entries, ...group].sort((a, b) => a.joinedAt - b.joinedAt);
  }
}
