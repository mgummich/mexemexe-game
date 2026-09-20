import { describe, expect, it } from 'vitest';
import { normalizeRoomSettings, TIMER_PRESETS } from '../src/net/protocol';
import {
  assistStateFor,
  borrowTime,
  BLITZ_PRESETS,
  BLITZ_TURN_BOUNDS,
  enterLastBreath,
  expired,
  grantBonus,
  IDLE_CLOCK,
  msLeft,
  NO_ASSISTS,
  NO_RHYTHM,
  noteTurnTaken,
  noteTurnUsed,
  spendClock,
  startTurn,
  useFreeze,
  usePanic,
  type Assists,
  HEAT_OFF,
  heatLevel,
  NO_HEAT,
  noteHeat,
  powersAvailable,
  TIME_ATTACK_PRESETS,
  type BlitzDifficulty,
  type HeatConfig,
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
  const both: Assists = { panicMs: 5_000, panicUses: 1, lastBreathMs: 3_000, freezeMs: 0, freezeUses: 0, maxDebtMs: 0 };
  const panicOnly: Assists = { ...both, lastBreathMs: 0, freezeMs: 0, freezeUses: 0, maxDebtMs: 0 };
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

describe('Blitz difficulty presets', () => {
  it('get shorter and less forgiving down the ladder', () => {
    const order: BlitzDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
    const turns = order.map((d) => BLITZ_PRESETS[d].turnMs);
    expect(turns).toEqual([...turns].sort((a, b) => b - a));
    const panic = order.map((d) => BLITZ_PRESETS[d].assists.panicMs * BLITZ_PRESETS[d].assists.panicUses);
    expect(panic).toEqual([...panic].sort((a, b) => b - a));
  });

  it('Expert is the unassisted one, and nothing else is', () => {
    expect(BLITZ_PRESETS.expert.assists).toEqual(NO_ASSISTS);
    for (const d of ['easy', 'medium', 'hard', 'custom'] as BlitzDifficulty[]) {
      expect(assistStateFor(BLITZ_PRESETS[d].assists).panicLeft).toBeGreaterThan(0);
      expect(BLITZ_PRESETS[d].assists.lastBreathMs).toBeGreaterThan(0);
    }
  });

  it('every preset turn length is one a custom match could also pick', () => {
    const [lo, hi] = BLITZ_TURN_BOUNDS;
    for (const preset of Object.values(BLITZ_PRESETS)) {
      expect(preset.turnMs).toBeGreaterThanOrEqual(lo);
      expect(preset.turnMs).toBeLessThanOrEqual(hi);
    }
  });
});

describe('Time Attack personal clock', () => {
  it('spends what the turn took and pays the increment', () => {
    expect(spendClock(60_000, 4_000, 3_000).clockMs).toBe(59_000);
    expect(spendClock(60_000, 0, 3_000).clockMs).toBe(63_000);
  });

  it('floors at zero, and a flagged clock earns nothing', () => {
    expect(spendClock(2_000, 5_000, 3_000).clockMs).toBe(0);
    expect(spendClock(2_000, 2_000, 3_000).clockMs).toBe(0);
    expect(spendClock(0, 0, 3_000).clockMs).toBe(0);
  });

  it('works with no increment at all', () => {
    expect(spendClock(60_000, 4_000, 0).clockMs).toBe(56_000);
  });
});

describe('Perfect Rhythm in Time Attack', () => {
  it('keeps the streak for a turn that paid for itself', () => {
    // Increment 3s: a turn decided in 2s costs less than it earns.
    let r = noteTurnUsed(NO_RHYTHM, 2_000, 3_000);
    r = noteTurnUsed(r, 3_000, 3_000);
    expect(r).toEqual({ streak: 2, best: 2 });
    expect(noteTurnUsed(r, 3_001, 3_000)).toEqual({ streak: 0, best: 2 });
  });

  it('is the same fold the per-turn modes use', () => {
    const clock = startTurn(0, 8_000);
    expect(noteTurnTaken(NO_RHYTHM, clock, 5_000)).toEqual(noteTurnUsed(NO_RHYTHM, 3_000, 4_000));
  });
});

describe('Freeze and Time Debt, in the domain', () => {
  const FULL: Assists = { ...NO_ASSISTS, freezeMs: 10_000, freezeUses: 1, maxDebtMs: 20_000 };

  it('Freeze extends the turn once, and never with the feature off', () => {
    const clock = startTurn(0, 30_000);
    const first = useFreeze(clock, assistStateFor(FULL), FULL);
    expect(first.granted).toBe(true);
    expect(msLeft(first.clock, 0)).toBe(40_000);
    expect(useFreeze(first.clock, first.state, FULL).granted).toBe(false);
    expect(useFreeze(clock, assistStateFor(NO_ASSISTS), NO_ASSISTS).granted).toBe(false);
  });

  it('borrowing is bounded by the debt ceiling and recorded explicitly', () => {
    const first = borrowTime(0, assistStateFor(FULL), FULL);
    expect(first).toMatchObject({ clockMs: 20_000, borrowedMs: 20_000 });
    expect(first.state.debtMs).toBe(20_000);
    expect(borrowTime(first.clockMs, first.state, FULL).borrowedMs).toBe(0);
  });

  it('the increment repays debt before the clock sees it, and never goes negative', () => {
    expect(spendClock(20_000, 0, 3_000, 20_000)).toEqual({ clockMs: 20_000, debtMs: 17_000 });
    expect(spendClock(20_000, 0, 3_000, 1_000)).toEqual({ clockMs: 22_000, debtMs: 0 });
    expect(spendClock(1_000, 5_000, 3_000, 4_000)).toEqual({ clockMs: 0, debtMs: 4_000 });
  });
});

describe('Time Attack difficulty presets', () => {
  it('shorten the clock and thin the increment down the ladder', () => {
    const order: BlitzDifficulty[] = ['easy', 'medium', 'hard', 'expert'];
    const clocks = order.map((d) => TIME_ATTACK_PRESETS[d].startClockMs);
    const increments = order.map((d) => TIME_ATTACK_PRESETS[d].incrementMs);
    expect(clocks).toEqual([...clocks].sort((a, b) => b - a));
    expect(increments).toEqual([...increments].sort((a, b) => b - a));
  });

  it('Expert is the unassisted one, and Hard matches the lobby preset', () => {
    expect(TIME_ATTACK_PRESETS.expert.assists).toEqual(NO_ASSISTS);
    expect(TIME_ATTACK_PRESETS.hard.startClockMs).toBe(TIMER_PRESETS.timeattack.startClockMs);
    expect(TIME_ATTACK_PRESETS.hard.incrementMs).toBe(TIMER_PRESETS.timeattack.incrementMs);
    expect(TIME_ATTACK_PRESETS.hard.assists.panicMs).toBe(TIMER_PRESETS.timeattack.panicMs);
    expect(TIME_ATTACK_PRESETS.hard.assists.lastBreathMs).toBe(TIMER_PRESETS.timeattack.lastBreathMs);
  });

  it('every preset is one a custom room could actually be given', () => {
    for (const preset of Object.values(TIME_ATTACK_PRESETS)) {
      const applied = normalizeRoomSettings({
        timerMode: 'custom', startClockMs: preset.startClockMs, incrementMs: preset.incrementMs,
        ...preset.assists,
      });
      expect(applied.startClockMs).toBe(preset.startClockMs);
      expect(applied.incrementMs).toBe(preset.incrementMs);
      expect(applied.panicUses).toBe(preset.assists.panicUses);
      expect(applied.maxDebtMs).toBe(preset.assists.maxDebtMs);
    }
  });
});

describe('Heat and Overheat', () => {
  const HEAT: HeatConfig = { perCloseCallMs: 30, coolPerCalmTurn: 10, overheatAt: 90, cooldownTurns: 2 };

  it('climbs the ladder on close calls and comes back down on calm turns', () => {
    let h = noteHeat(NO_HEAT, HEAT, true, false);
    expect(heatLevel(h, HEAT)).toBe('warm');
    h = noteHeat(h, HEAT, true, false);
    expect(heatLevel(h, HEAT)).toBe('hot');
    h = noteHeat(h, HEAT, false, true);
    expect(heatLevel(h, HEAT)).toBe('warm');
  });

  it('overheats at the ceiling, and the cooldown ends by itself', () => {
    let h = { heat: 80, cooldown: 0 };
    h = noteHeat(h, HEAT, true, false);
    expect(h).toEqual({ heat: 0, cooldown: 2 });
    expect(heatLevel(h, HEAT)).toBe('overheat');
    expect(powersAvailable(h)).toBe(false);
    h = noteHeat(h, HEAT, true, false);
    h = noteHeat(h, HEAT, true, false);
    expect(h.cooldown).toBe(0);
    expect(powersAvailable(h)).toBe(true);
  });

  it('never goes negative, and is inert when switched off', () => {
    expect(noteHeat(NO_HEAT, HEAT, false, true)).toEqual(NO_HEAT);
    expect(noteHeat({ heat: 50, cooldown: 0 }, HEAT_OFF, true, false)).toEqual(NO_HEAT);
    expect(heatLevel({ heat: 999, cooldown: 0 }, HEAT_OFF)).toBe('calm');
  });
});
