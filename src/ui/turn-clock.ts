/**
 * The online turn clock's readout, as arithmetic. Pure: no Phaser, no clock of its own, no
 * settings — the caller passes `now`, so the same inputs always produce the same readout and the
 * boundaries (exactly at the warning threshold, exactly at zero) are testable without a browser.
 *
 * Never authoritative. The deadline it renders moves only when a server `state_sync` moves it, and
 * reaching zero here shows `0s` rather than ending anything — the server's own tick does that
 * (docs/MULTIPLAYER.md §7b).
 */
export type TurnClockTone = 'muted' | 'warning' | 'critical';

export interface TurnClockReadout {
  /** False when there is no deadline at all — an untimed room, or before the first sync. */
  visible: boolean;
  /** Whole seconds remaining, rounded up, floored at 0: a clock reading 0s is still a clock. */
  secs: number;
  tone: TurnClockTone;
  /** Text scale. The last seconds grow the readout, so the pressure is legible without reading digits. */
  scale: number;
  /**
   * Adrenaline: 0 outside the critical window, ramping to 1 at zero. Native to every timed mode,
   * never a setting — it is how hard the presentation leans on the last moments (readout size,
   * cue volume), and never what a move is worth.
   */
  adrenaline: number;
}

/** Below this much left, the clock is critical regardless of the room's own warning threshold. */
export const TURN_CRITICAL_MS = 5000;

/** A Speed turn is too short for a flat 5s critical window — on a 7s Blitz turn that would be
 * critical from the second second, which is pressure with no shape to it. Where the budget is
 * known, the window is this fraction of it, capped by TURN_CRITICAL_MS. */
export const CRITICAL_FRACTION = 0.3;

const CRITICAL_SCALE = 1.25;

/** How much of the critical window a turn has burned: 0 entering it, 1 at zero. */
function adrenalineOf(msLeft: number, criticalMs: number): number {
  if (msLeft > criticalMs || criticalMs <= 0) return 0;
  return Math.min(1, (criticalMs - msLeft) / criticalMs);
}

/**
 * `budgetMs` is the turn's full allowance, where the caller knows it. Omitting it keeps the flat
 * 5s critical window the online clock has always used.
 */
export function turnClockReadout(deadlineAt: number | null, now: number, warnMs: number, budgetMs = 0): TurnClockReadout {
  if (deadlineAt === null) return { visible: false, secs: 0, tone: 'muted', scale: 1, adrenaline: 0 };
  const msLeft = Math.max(0, deadlineAt - now);
  const criticalMs = budgetMs > 0 ? Math.min(TURN_CRITICAL_MS, budgetMs * CRITICAL_FRACTION) : TURN_CRITICAL_MS;
  // Two steps, not one: a single threshold gives the same red at twenty seconds and at three.
  const critical = msLeft <= criticalMs;
  const warning = warnMs > 0 && msLeft <= warnMs;
  const adrenaline = adrenalineOf(msLeft, criticalMs);
  return {
    visible: true,
    secs: Math.ceil(msLeft / 1000),
    tone: critical ? 'critical' : warning ? 'warning' : 'muted',
    // The readout grows through the critical window rather than snapping to one size: the growth
    // itself is the signal, and it is a size change, not motion — reduced motion loses nothing.
    scale: critical ? 1 + (CRITICAL_SCALE - 1) * adrenaline : 1,
    adrenaline,
  };
}
