import { describe, expect, it } from 'vitest';
import { RearrangerAi, SimpleAi } from '../src/ai/ai';
import { applyConfirmedTurn, drawAndEndTurn } from '../src/rules/rules';
import type { GameState } from '../src/rules/types';
import { createNewGame } from '../src/game-state/store';

/**
 * Perf/regression soak: 20 full AI-vs-AI games (SimpleAi vs RearrangerAi,
 * seeds 1..20) through the pure rules functions only (no Phaser). Tripwire,
 * not a benchmark — catches infinite loops and unbounded heap growth.
 */
function playFullGame(seed: number): { turns: number; winnerId: string | null } {
  let state: GameState = createNewGame(seed, [
    { name: 'A', isAi: true, aiType: 'simple' },
    { name: 'B', isAi: true, aiType: 'rearranger' },
  ]);
  const ais = [new SimpleAi(), new RearrangerAi()];
  const TURN_CAP = 2000; // generous; stalemate/win must resolve well before this
  let turns = 0;
  while (state.phase === 'playing' && turns < TURN_CAP) {
    const ai = ais[state.activePlayerIndex]!;
    const decision = ai.decide(state);
    state = decision.kind === 'confirm' ? applyConfirmedTurn(state, decision.draft) : drawAndEndTurn(state);
    turns++;
  }
  if (state.phase !== 'finished') {
    throw new Error(`seed ${seed} did not terminate within ${TURN_CAP} turns`);
  }
  return { turns, winnerId: state.winnerId };
}

describe('perf soak: 20 AI-vs-AI games', () => {
  // 15s runner timeout > the 10s wall-time budget asserted below, so a slow run fails on
  // the explicit assertion (with its number) instead of vitest's 5s default cutting it off.
  it('every game terminates (win or stalemate), total wall time < 10s, heap stays bounded', () => {
    const start = performance.now();
    const results: { turns: number; winnerId: string | null }[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      results.push(playFullGame(seed));
    }
    const elapsedMs = performance.now() - start;

    expect(results).toHaveLength(20);
    for (const r of results) {
      expect(r.winnerId).not.toBeNull();
    }
    expect(elapsedMs).toBeLessThan(10_000);

    // ponytail: single post-run heap sample as a regression tripwire, not a leak detector.
    const heapMb = process.memoryUsage().heapUsed / (1024 * 1024);
    expect(heapMb).toBeLessThan(150);
  }, 15_000);
});
