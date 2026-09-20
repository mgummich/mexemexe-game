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
}

/** Below this much left, the clock is critical regardless of the room's own warning threshold. */
export const TURN_CRITICAL_MS = 5000;

const CRITICAL_SCALE = 1.25;

export function turnClockReadout(deadlineAt: number | null, now: number, warnMs: number): TurnClockReadout {
  if (deadlineAt === null) return { visible: false, secs: 0, tone: 'muted', scale: 1 };
  const msLeft = Math.max(0, deadlineAt - now);
  // Two steps, not one: a single threshold gives the same red at twenty seconds and at three.
  const critical = msLeft <= TURN_CRITICAL_MS;
  const warning = warnMs > 0 && msLeft <= warnMs;
  return {
    visible: true,
    secs: Math.ceil(msLeft / 1000),
    tone: critical ? 'critical' : warning ? 'warning' : 'muted',
    scale: critical ? CRITICAL_SCALE : 1,
  };
}
