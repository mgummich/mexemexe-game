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
  /** Whether this turn already spent its Last Breath. Per turn, which is what stops it chaining. */
  readonly lastBreathUsed: boolean;
}

/** No turn is being timed: an untimed room, a lobby, or a match that has finished. */
export const IDLE_CLOCK: TurnClock = { startedAt: null, budgetMs: 0, bonusClaimed: false, lastBreathUsed: false };

/** Put a turn on the clock. A budget of zero or less is untimed, not an instant timeout. */
export function startTurn(now: number, budgetMs: number): TurnClock {
  if (budgetMs <= 0) return IDLE_CLOCK;
  return { startedAt: now, budgetMs, bonusClaimed: false, lastBreathUsed: false };
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
  return noteTurnUsed(rhythm, clock.budgetMs - msLeftAtAction, clock.budgetMs * RHYTHM_FRACTION);
}

/**
 * The same fold, against a threshold the caller chooses. Time Attack has no per-turn budget to
 * take a fraction of, so it keeps rhythm by the increment instead: a turn decided in less than the
 * increment paid for itself, which is the same idea — moving at the pace the mode is built around.
 */
export function noteTurnUsed(rhythm: Rhythm, usedMs: number, thresholdMs: number): Rhythm {
  if (usedMs > thresholdMs) return { streak: 0, best: rhythm.best };
  const streak = rhythm.streak + 1;
  return { streak, best: Math.max(streak, rhythm.best) };
}

/**
 * Optional assistance for a Speed turn. Both are off at zero, and both are always individually
 * disableable — that is the rule the modes are built around, not a preference a preset may
 * override (docs/specs/speed-modes-timing.md).
 */
export interface Assists {
  /** Emergency extension, in ms. 0 disables the Panic Button outright. */
  readonly panicMs: number;
  /** How many times a match may panic. 0 disables it just as surely as a 0 duration. */
  readonly panicUses: number;
  /** A last window granted once per turn when the clock runs out. 0 disables Last Breath. */
  readonly lastBreathMs: number;
  /** Time Attack Freeze: how long one activation stops the personal clock for. 0 disables it. */
  readonly freezeMs: number;
  /** How many freezes a match grants. 0 disables it just as surely as a 0 duration. */
  readonly freezeUses: number;
  /** Time Attack Time Debt: the most a seat may borrow against future increments. 0 disables it. */
  readonly maxDebtMs: number;
}

export const NO_ASSISTS: Assists = {
  panicMs: 0, panicUses: 0, lastBreathMs: 0, freezeMs: 0, freezeUses: 0, maxDebtMs: 0,
};

/** What the match has left of its assistance. Panic is a match-long budget; Last Breath is per
 * turn and lives on the clock, so a new turn cannot inherit a spent one. */
export interface AssistState {
  readonly panicLeft: number;
  readonly freezeLeft: number;
  /** Time borrowed against future increments, always >= 0. Repaid before a clock grows. */
  readonly debtMs: number;
}

export function assistStateFor(assists: Assists): AssistState {
  return {
    panicLeft: assists.panicMs > 0 ? assists.panicUses : 0,
    freezeLeft: assists.freezeMs > 0 ? assists.freezeUses : 0,
    debtMs: 0,
  };
}

/**
 * Spend one Panic Button. Refused with nothing changed when the feature is off, when the budget is
 * spent, or when no turn is on the clock — so a double tap, a replayed message or a press on
 * someone else's turn can only ever grant one extension.
 */
export function usePanic(
  clock: TurnClock,
  state: AssistState,
  assists: Assists,
): { clock: TurnClock; state: AssistState; granted: boolean } {
  if (clock.startedAt === null || assists.panicMs <= 0 || state.panicLeft <= 0) {
    return { clock, state, granted: false };
  }
  return {
    clock: { ...clock, budgetMs: clock.budgetMs + assists.panicMs },
    state: { ...state, panicLeft: state.panicLeft - 1 },
    granted: true,
  };
}

/**
 * Freeze: stop the personal clock for a fixed span. Modelled as time added to both the turn and
 * the clock rather than as a paused timer — the seat is charged for the whole turn either way, so
 * granting exactly the frozen span leaves it having spent nothing while frozen. Deterministic, and
 * nothing about it can be stretched by a slow connection, because no client tells the authority
 * when the freeze ended.
 */
export function useFreeze(
  clock: TurnClock,
  state: AssistState,
  assists: Assists,
): { clock: TurnClock; state: AssistState; granted: boolean } {
  if (clock.startedAt === null || assists.freezeMs <= 0 || state.freezeLeft <= 0) {
    return { clock, state, granted: false };
  }
  return {
    clock: { ...clock, budgetMs: clock.budgetMs + assists.freezeMs },
    state: { ...state, freezeLeft: state.freezeLeft - 1 },
    granted: true,
  };
}

/**
 * Time Debt: borrow against future increments instead of losing the match now. Explicit, bounded
 * by `maxDebtMs`, and never negative — a clock stays a clock, and what is owed is a separate,
 * visible number that the next increments pay off first (`spendClock`).
 */
export function borrowTime(
  clockMs: number,
  state: AssistState,
  assists: Assists,
): { clockMs: number; state: AssistState; borrowedMs: number } {
  const room = Math.max(0, assists.maxDebtMs - state.debtMs);
  if (room <= 0) return { clockMs, state, borrowedMs: 0 };
  return { clockMs: clockMs + room, state: { ...state, debtMs: state.debtMs + room }, borrowedMs: room };
}

/**
 * The clock just ran out. Returns the extended clock if this turn still has its Last Breath, and
 * `entered: false` when the turn is simply over. Once per turn by construction: the flag rides on
 * the clock, and a clock is replaced wholesale by `startTurn`, so a granted breath cannot chain
 * into another one.
 */
export function enterLastBreath(clock: TurnClock, assists: Assists): { clock: TurnClock; entered: boolean } {
  if (clock.startedAt === null || assists.lastBreathMs <= 0 || clock.lastBreathUsed) return { clock, entered: false };
  return { clock: { ...clock, budgetMs: clock.budgetMs + assists.lastBreathMs, lastBreathUsed: true }, entered: true };
}

/**
 * Blitz difficulty presets. A preset is a set of *defaults*, not a lock: Panic and Last Breath
 * stay individually switchable afterwards, and Perfect Rhythm and Adrenaline are in every one of
 * them because they are not settings at all.
 *
 * The ladder is turn length first and assistance second — Expert is short *and* unassisted, which
 * is the same game with nothing between the player and the clock.
 */
export type BlitzDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'custom';

export interface BlitzPreset {
  readonly turnMs: number;
  readonly assists: Assists;
}

export const BLITZ_PRESETS: Record<BlitzDifficulty, BlitzPreset> = {
  easy: { turnMs: 12_000, assists: { ...NO_ASSISTS, panicMs: 6_000, panicUses: 2, lastBreathMs: 4_000 } },
  medium: { turnMs: 9_000, assists: { ...NO_ASSISTS, panicMs: 5_000, panicUses: 1, lastBreathMs: 3_000 } },
  // Hard is the online Blitz preset's 7s, so a player practising offline is practising the real one.
  hard: { turnMs: 7_000, assists: { ...NO_ASSISTS, panicMs: 4_000, panicUses: 1, lastBreathMs: 2_000 } },
  expert: { turnMs: 5_000, assists: NO_ASSISTS },
  // Custom starts from Medium and is then whatever the player set; the stored turn length and the
  // two assist switches are the only things it carries.
  custom: { turnMs: 9_000, assists: { ...NO_ASSISTS, panicMs: 5_000, panicUses: 1, lastBreathMs: 3_000 } },
};

/** Inclusive bounds for a custom Blitz turn. The floor matches the server's own
 * `CUSTOM_BOUNDS.turnMs`, so offline practice cannot be faster than any room can be. */
export const BLITZ_TURN_BOUNDS: readonly [number, number] = [5_000, 30_000];

/**
 * Time Attack: a personal clock that persists across turns, spent by thinking and topped up by
 * moving. The increment is the whole reason a long game stays playable — without it a 60s clock is
 * a countdown to a forfeit rather than a budget to manage.
 *
 * `usedMs` is the authoritative time the turn actually took. A clock that reaches zero stays at
 * zero and earns no increment: the turn that spent the last millisecond is the turn that ended the
 * match, and paying it for finishing would un-end it.
 */
export function spendClock(clockMs: number, usedMs: number, incrementMs: number, debtMs = 0): { clockMs: number; debtMs: number } {
  const left = Math.max(0, clockMs - Math.max(0, usedMs));
  if (left === 0) return { clockMs: 0, debtMs };
  // Debt is repaid out of the increment before the clock sees any of it, so borrowing buys time
  // now at the price of the next few turns' gains — never a surprise deduction from the clock.
  const earned = Math.max(0, incrementMs);
  const repaid = Math.min(debtMs, earned);
  return { clockMs: left + (earned - repaid), debtMs: debtMs - repaid };
}

/**
 * Time Attack difficulty presets. Same rule as Blitz: a preset is a set of defaults, Perfect
 * Rhythm and Adrenaline are in all of them because they are not settings, and Panic and Last
 * Breath keep their own switches.
 *
 * The ladder is clock first, then how much help manages it: Easy has a long clock, a generous
 * increment and every power; Expert has a short clock, a thin increment and nothing else at all.
 */
export interface TimeAttackPreset {
  readonly startClockMs: number;
  readonly incrementMs: number;
  readonly assists: Assists;
}

export const TIME_ATTACK_PRESETS: Record<BlitzDifficulty, TimeAttackPreset> = {
  easy: {
    startClockMs: 120_000, incrementMs: 5_000,
    assists: { panicMs: 8_000, panicUses: 2, lastBreathMs: 4_000, freezeMs: 10_000, freezeUses: 1, maxDebtMs: 20_000 },
  },
  medium: {
    startClockMs: 90_000, incrementMs: 4_000,
    assists: { panicMs: 6_000, panicUses: 1, lastBreathMs: 3_000, freezeMs: 10_000, freezeUses: 1, maxDebtMs: 0 },
  },
  // Hard is the lobby's Time Attack preset, so practice and the real room agree.
  hard: {
    startClockMs: 60_000, incrementMs: 3_000,
    assists: { ...NO_ASSISTS, panicMs: 6_000, panicUses: 1, lastBreathMs: 3_000 },
  },
  expert: { startClockMs: 45_000, incrementMs: 2_000, assists: NO_ASSISTS },
  custom: {
    startClockMs: 90_000, incrementMs: 4_000,
    assists: { panicMs: 6_000, panicUses: 1, lastBreathMs: 3_000, freezeMs: 10_000, freezeUses: 1, maxDebtMs: 20_000 },
  },
};
