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

/**
 * Perfect Rhythm: how many turns in a row were decided without letting the clock run down.
 *
 * Native to every Speed Mode rather than a setting — there is no toggle for it, and nothing about
 * it changes what a move is worth. It is a read on how the seat is playing, fed back as a quiet
 * streak marker and a line in the summary, which is why a "fast" turn is defined against the
 * budget rather than against a wall-clock number: at 7s and at 90s, keeping rhythm means the same
 * thing (deciding inside the first half of your own turn).
 */
export interface Rhythm {
  readonly streak: number;
  readonly best: number;
}

export const NO_RHYTHM: Rhythm = { streak: 0, best: 0 };

/** The part of a turn's budget that counts as in rhythm. Half: a turn spent mostly thinking is
 * not a rhythm turn, and a turn decided in the first moments is not required to be one either. */
export const RHYTHM_FRACTION = 0.5;

/**
 * Fold one completed turn into the streak. `msLeft` is what the clock had left when the turn was
 * taken — anything at or above half the budget keeps the streak, anything below breaks it. An
 * untimed turn (no clock) leaves the streak exactly as it was: there was no pressure to keep.
 */
export function noteTurnTaken(rhythm: Rhythm, clock: TurnClock, msLeftAtAction: number | null): Rhythm {
  if (clock.startedAt === null || msLeftAtAction === null) return rhythm;
  if (msLeftAtAction < clock.budgetMs * RHYTHM_FRACTION) return { streak: 0, best: rhythm.best };
  const streak = rhythm.streak + 1;
  return { streak, best: Math.max(streak, rhythm.best) };
}
