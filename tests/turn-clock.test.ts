import { describe, expect, it } from 'vitest';
import { TURN_CRITICAL_MS, turnClockReadout } from '../src/ui/turn-clock';

/**
 * The online clock used to be arithmetic inlined in a 4,500-line scene, reachable only through a
 * browser. The behaviour is unchanged; these are the boundaries that were previously unasserted —
 * exactly at the room's warning threshold, exactly at critical, and past zero.
 */
const WARN = 20_000;

describe('turn clock readout', () => {
  it('shows nothing when the room has no deadline', () => {
    expect(turnClockReadout(null, 1_000, WARN)).toEqual({ visible: false, secs: 0, tone: 'muted', scale: 1 });
  });

  it('rounds up, so a clock never reads a second it has not finished', () => {
    expect(turnClockReadout(10_400, 0, WARN).secs).toBe(11);
    expect(turnClockReadout(10_000, 0, WARN).secs).toBe(10);
    expect(turnClockReadout(9_001, 0, WARN).secs).toBe(10);
  });

  it('floors at zero and keeps showing — reaching zero is the server\'s business, not the clock\'s', () => {
    const past = turnClockReadout(1_000, 9_999, WARN);
    expect(past.visible).toBe(true);
    expect(past.secs).toBe(0);
    expect(past.tone).toBe('critical');
  });

  it('turns warning exactly at the threshold, not a millisecond later', () => {
    expect(turnClockReadout(WARN, 0, WARN).tone).toBe('warning');
    expect(turnClockReadout(WARN + 1, 0, WARN).tone).toBe('muted');
  });

  it('turns critical exactly at the threshold, and grows the readout there', () => {
    expect(turnClockReadout(TURN_CRITICAL_MS, 0, WARN).tone).toBe('critical');
    expect(turnClockReadout(TURN_CRITICAL_MS, 0, WARN).scale).toBeGreaterThan(1);
    expect(turnClockReadout(TURN_CRITICAL_MS + 1, 0, WARN).tone).toBe('warning');
    expect(turnClockReadout(TURN_CRITICAL_MS + 1, 0, WARN).scale).toBe(1);
  });

  it('is critical below five seconds even in a room with no warning threshold', () => {
    expect(turnClockReadout(3_000, 0, 0).tone).toBe('critical');
    expect(turnClockReadout(30_000, 0, 0).tone).toBe('muted');
  });
});
