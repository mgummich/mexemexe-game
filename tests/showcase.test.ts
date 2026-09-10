import { describe, expect, it } from 'vitest';
import { buildShowcaseState } from '../src/demo/showcase';
import type { PlayerConfig } from '../src/game-state/store';

const players: PlayerConfig[] = [
  { name: 'You', isAi: false },
  { name: 'Dona Cida', isAi: true, aiType: 'simple' },
];

function tableCardCount(state: ReturnType<typeof buildShowcaseState>): number {
  return state.table.reduce((sum, m) => sum + m.cards.length, 0);
}

describe('buildShowcaseState minTableCards', () => {
  it('is deterministic: same seed and floor produce an identical state', () => {
    const a = buildShowcaseState(12460, players, 44);
    const b = buildShowcaseState(12460, players, 44);
    expect(a).toEqual(b);
  });

  it('reaches the requested floor when the deck allows it', () => {
    // seed 12460 is the known-good crowded-table fixture (see e2e/screenshot.spec.ts
    // crowded-table-max): a seed sweep found 44 committed table cards as the ceiling for this
    // 2-player SimpleAi matchup, and this seed reaches it mid-game.
    const state = buildShowcaseState(12460, players, 44);
    expect(tableCardCount(state)).toBeGreaterThanOrEqual(44);
    expect(state.phase).toBe('playing');
  });

  it('terminates instead of spinning forever when the floor is unreachable', () => {
    // 108-card deck can never pile 1000 cards onto the table — the loop must give up when the
    // game naturally ends (phase !== 'playing') rather than looping past the iteration cap.
    const state = buildShowcaseState(12460, players, 1000);
    expect(state.phase).toBe('finished');
    expect(tableCardCount(state)).toBeLessThan(1000);
  });

  it('omitting minTableCards keeps the original stop condition (human turn, non-empty table)', () => {
    const withDefault = buildShowcaseState(77, players);
    const withUndefinedFloor = buildShowcaseState(77, players, undefined);
    expect(withDefault).toEqual(withUndefinedFloor);
    expect(withDefault.table.length).toBeGreaterThan(0);
    expect(withDefault.players[withDefault.activePlayerIndex]!.isAi).toBe(false);
  });
});
