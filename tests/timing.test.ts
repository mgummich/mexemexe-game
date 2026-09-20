import { describe, expect, it } from 'vitest';
import { IDLE_CLOCK, expired, grantBonus, msLeft, startTurn } from '../src/game-state/timing';

describe('shared turn clock', () => {
  it('an untimed budget puts nothing on the clock', () => {
    expect(startTurn(1000, 0)).toEqual(IDLE_CLOCK);
    expect(msLeft(startTurn(1000, 0), 1000)).toBeNull();
    // Untimed is not an instant timeout: a room with no timer must never expire a turn.
    expect(expired(startTurn(1000, 0), 9_999_999)).toBe(false);
  });

  it('counts down and floors at zero', () => {
    const clock = startTurn(1000, 45_000);
    expect(msLeft(clock, 1000)).toBe(45_000);
    expect(msLeft(clock, 31_000)).toBe(15_000);
    expect(msLeft(clock, 999_000)).toBe(0);
  });

  it('the deadline millisecond belongs to the timeout', () => {
    const clock = startTurn(1000, 45_000);
    expect(expired(clock, 45_999)).toBe(false);
    expect(expired(clock, 46_000)).toBe(true);
  });

  it('grants the one-off bonus exactly once', () => {
    const first = grantBonus(startTurn(1000, 45_000), 20_000);
    expect(first.granted).toBe(true);
    expect(msLeft(first.clock, 1000)).toBe(65_000);
    const second = grantBonus(first.clock, 20_000);
    expect(second.granted).toBe(false);
    expect(second.clock).toBe(first.clock);
  });

  it('refuses a bonus with no turn on the clock or nothing to grant', () => {
    expect(grantBonus(IDLE_CLOCK, 20_000).granted).toBe(false);
    expect(grantBonus(startTurn(1000, 45_000), 0).granted).toBe(false);
  });

  it('a new turn clears the previous turn’s bonus', () => {
    const spent = grantBonus(startTurn(1000, 45_000), 20_000).clock;
    expect(spent.bonusClaimed).toBe(true);
    expect(startTurn(70_000, 45_000).bonusClaimed).toBe(false);
  });
});
