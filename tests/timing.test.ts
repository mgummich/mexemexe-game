import { describe, expect, it } from 'vitest';
import {
  assistStateFor,
  enterLastBreath,
  expired,
  grantBonus,
  IDLE_CLOCK,
  msLeft,
  NO_ASSISTS,
  NO_RHYTHM,
  noteTurnTaken,
  startTurn,
  usePanic,
  type Assists,
} from '../src/game-state/timing';

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

describe('Perfect Rhythm', () => {
  const clock = startTurn(0, 8_000);

  it('keeps the streak for a turn decided inside the first half of the budget', () => {
    let r = noteTurnTaken(NO_RHYTHM, clock, 8_000);
    r = noteTurnTaken(r, clock, 4_000); // exactly half still counts
    expect(r).toEqual({ streak: 2, best: 2 });
  });

  it('breaks the streak for a turn that ran the clock down, and remembers the best', () => {
    let r = noteTurnTaken(NO_RHYTHM, clock, 8_000);
    r = noteTurnTaken(r, clock, 3_999);
    expect(r).toEqual({ streak: 0, best: 1 });
    r = noteTurnTaken(r, clock, 8_000);
    expect(r).toEqual({ streak: 1, best: 1 });
  });

  it('an untimed turn neither keeps nor breaks it', () => {
    const started = noteTurnTaken(NO_RHYTHM, clock, 8_000);
    expect(noteTurnTaken(started, IDLE_CLOCK, null)).toEqual(started);
    expect(noteTurnTaken(started, clock, null)).toEqual(started);
  });

  it('scales with the budget rather than with a wall-clock number', () => {
    const blitz = startTurn(0, 7_000);
    const casual = startTurn(0, 90_000);
    // 4s left is in rhythm on a 7s turn and long gone on a 90s one.
    expect(noteTurnTaken(NO_RHYTHM, blitz, 4_000).streak).toBe(1);
    expect(noteTurnTaken(NO_RHYTHM, casual, 4_000).streak).toBe(0);
  });
});

describe('Panic Button and Last Breath', () => {
  const both: Assists = { panicMs: 5_000, panicUses: 1, lastBreathMs: 3_000 };
  const panicOnly: Assists = { ...both, lastBreathMs: 0 };
  const breathOnly: Assists = { ...both, panicMs: 0, panicUses: 0 };

  it('ON/ON: each grants once, and Last Breath cannot chain', () => {
    const clock = startTurn(0, 7_000);
    const panicked = usePanic(clock, assistStateFor(both), both);
    expect(panicked.granted).toBe(true);
    expect(msLeft(panicked.clock, 0)).toBe(12_000);
    expect(usePanic(panicked.clock, panicked.state, both).granted).toBe(false);

    const breath = enterLastBreath(panicked.clock, both);
    expect(breath.entered).toBe(true);
    expect(msLeft(breath.clock, 0)).toBe(15_000);
    expect(enterLastBreath(breath.clock, both).entered).toBe(false);
  });

  it('ON/OFF: panic works, the turn simply ends when the clock runs out', () => {
    const clock = startTurn(0, 7_000);
    expect(usePanic(clock, assistStateFor(panicOnly), panicOnly).granted).toBe(true);
    expect(enterLastBreath(clock, panicOnly).entered).toBe(false);
  });

  it('OFF/ON: no panic to spend, one breath to take', () => {
    const clock = startTurn(0, 7_000);
    const state = assistStateFor(breathOnly);
    expect(state.panicLeft).toBe(0);
    expect(usePanic(clock, state, breathOnly).granted).toBe(false);
    expect(enterLastBreath(clock, breathOnly).entered).toBe(true);
  });

  it('OFF/OFF: the clock is the whole of it', () => {
    const clock = startTurn(0, 7_000);
    expect(usePanic(clock, assistStateFor(NO_ASSISTS), NO_ASSISTS).granted).toBe(false);
    expect(enterLastBreath(clock, NO_ASSISTS).entered).toBe(false);
  });

  it('refuses either one when no turn is on the clock', () => {
    expect(usePanic(IDLE_CLOCK, assistStateFor(both), both).granted).toBe(false);
    expect(enterLastBreath(IDLE_CLOCK, both).entered).toBe(false);
  });

  it('a new turn restores the breath but not the panic budget', () => {
    const spent = enterLastBreath(startTurn(0, 7_000), both);
    const panicked = usePanic(spent.clock, assistStateFor(both), both);
    const next = startTurn(20_000, 7_000);
    expect(next.lastBreathUsed).toBe(false);
    expect(usePanic(next, panicked.state, both).granted).toBe(false);
  });
});
