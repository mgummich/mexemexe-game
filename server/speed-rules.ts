/**
 * Speed Mode policy over a room's settings: which budget a turn gets, what a completed turn costs
 * the seat that took it, and what assistance the room grants.
 *
 * Kept out of `RoomManager` on purpose (ARCH-014 watches its size): a room owns seats, revisions
 * and broadcast, and this is arithmetic over the settings it happens to hold. The arithmetic
 * itself lives one layer further down still, in `src/game-state/timing.ts`, shared with the client.
 */
import type { RoomSettings } from '../src/net/protocol';
import { spendClock, type Assists } from '../src/game-state/timing';

/** A room has personal clocks exactly when it deals one. One answer, whatever the preset is
 * called — a custom room with a starting clock is a Time Attack room. */
export function isTimeAttack(settings: RoomSettings): boolean {
  return settings.startClockMs > 0;
}

/** The room's assistance, as the timing domain reads it. Each part is off at its own zero. */
export function assistsOf(settings: RoomSettings): Assists {
  const { panicMs, panicUses, lastBreathMs, freezeMs, freezeUses, maxDebtMs } = settings;
  return { panicMs, panicUses, lastBreathMs, freezeMs, freezeUses, maxDebtMs };
}

/** Time Attack budgets a turn with the active seat's own clock; every other mode with the room's
 * fixed per-turn allowance. */
export function turnBudgetMs(settings: RoomSettings, seatClocks: readonly number[], activeIndex: number): number {
  return isTimeAttack(settings) ? (seatClocks[activeIndex] ?? 0) : settings.turnMs;
}

/** Charge a completed turn to the seat that took it and pay it the increment. A no-op outside
 * Time Attack, where a turn costs a seat nothing it keeps. */
export function chargeSeat(
  settings: RoomSettings,
  seatClocks: number[],
  index: number,
  usedMs: number,
  debtMs = 0,
): number {
  if (!isTimeAttack(settings)) return debtMs;
  const spent = spendClock(seatClocks[index] ?? 0, usedMs, settings.incrementMs, debtMs);
  seatClocks[index] = spent.clockMs;
  return spent.debtMs;
}

/** Add an extension to a seat's personal clock, where it has one. The turn clock is extended by
 * the caller; this is the half that keeps Time Attack from charging for time it just granted. */
export function creditSeat(settings: RoomSettings, seatClocks: number[], index: number, ms: number): void {
  if (!isTimeAttack(settings)) return;
  seatClocks[index] = (seatClocks[index] ?? 0) + ms;
}
