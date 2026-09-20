/**
 * The one timing domain shared by every timed MexeMexe match: the online turn clock today, and
 * the Speed Modes clocks as they land (docs/specs/speed-modes-timing.md).
 *
 * Pure, like the rest of the domain core: no `Date`, no timers, no platform. Every function takes
 * the caller's `now`, so the authority (the room server) and any client projection run the same
 * arithmetic and cannot disagree about when a turn ended. Timing is not legality — nothing here
 * decides whether a move is allowed, only whether it arrived in time.
 */

/** A per-turn budget being spent. `startedAt === null` means no turn is on the clock at all. */
export interface TurnClock {
  readonly startedAt: number | null;
  /** This turn's total allowance, including any bonus already granted. */
  readonly budgetMs: number;
  /** Whether this turn's one-off extension has been used. Resets with the turn, not the match. */
  readonly bonusClaimed: boolean;
}

/** No turn is being timed: an untimed room, a lobby, or a match that has finished. */
export const IDLE_CLOCK: TurnClock = { startedAt: null, budgetMs: 0, bonusClaimed: false };

/** Put a turn on the clock. A budget of zero or less is untimed, not an instant timeout. */
export function startTurn(now: number, budgetMs: number): TurnClock {
  if (budgetMs <= 0) return IDLE_CLOCK;
  return { startedAt: now, budgetMs, bonusClaimed: false };
}

/** ms left, or null when nothing is being timed. Never negative: a spent clock reads 0. */
export function msLeft(clock: TurnClock, now: number): number | null {
  if (clock.startedAt === null) return null;
  return Math.max(0, clock.startedAt + clock.budgetMs - now);
}

/**
 * Whether the budget is gone. The race rule for an action arriving at the same instant the
 * deadline passes: `>=` means the deadline itself belongs to the timeout, so an authority that
 * ticks and a submission that lands on the same millisecond resolve the same way in both.
 */
export function expired(clock: TurnClock, now: number): boolean {
  return clock.startedAt !== null && now - clock.startedAt >= clock.budgetMs;
}

/**
 * Grant this turn's one-off extension. Refused when nothing is on the clock, when it was already
 * claimed, or when the ruleset grants nothing — so re-sending the claim cannot hold a turn open.
 */
export function grantBonus(clock: TurnClock, bonusMs: number): { clock: TurnClock; granted: boolean } {
  if (clock.startedAt === null || clock.bonusClaimed || bonusMs <= 0) return { clock, granted: false };
  return { clock: { ...clock, budgetMs: clock.budgetMs + bonusMs, bonusClaimed: true }, granted: true };
}
