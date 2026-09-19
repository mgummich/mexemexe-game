/**
 * AI foundation properties — what must be true of *every* decision, on every state legal play can
 * reach, at 2, 3 and 4 seats.
 *
 * `tests/ai.test.ts` pins the behaviour of named fixtures and `tests/probes.test.ts` plays seeded
 * matches to the end; this file adds the three contracts of the AI boundary itself over generated
 * input: the decision is legal, the observation is not written to, and the same observation gives
 * the same decision. Budgets are kept small on purpose — a property loop is the wrong place to
 * pay for the widest search (the shipped budget is covered by the hardening cases in
 * `tests/ai.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { RearrangerAi, SimpleAi, type AiPlayer } from '../../src/ai/ai';
import { observeForAi } from '../../src/ai/observation';
import { canConfirmTurn } from '../../src/rules/rules';
import { describeMatch, playedMatch } from '../helpers/generators';
import { forAll, runs } from '../helpers/property';

const MATCH = { runs: runs(15, 300), size: 8, generate: playedMatch, describe: describeMatch };

/** One cheap engine per shape of generator: greedy lay-down, and the rearrange search on a
 *  deliberately small trial budget so exhaustion is the common case rather than the rare one. */
const ENGINES: readonly [string, () => AiPlayer][] = [
  ['SimpleAi', () => new SimpleAi()],
  ['RearrangerAi(budget=50)', () => new RearrangerAi(false, false, 50)],
];

describe('every AI decision', () => {
  it('is an action the rules accept, or a draw', () => {
    forAll('an AI decision is legal on any reachable state', MATCH, (match) => {
      for (const state of match.states) {
        if (state.phase !== 'playing') continue;
        for (const [name, make] of ENGINES) {
          const d = make().decide(observeForAi(state));
          if (d.kind === 'draw') continue;
          expect(`${name}: ${JSON.stringify(canConfirmTurn(state, d.draft))}`).toBe(`${name}: {"ok":true}`);
        }
      }
    });
  });

  it('leaves its observation exactly as it was given (INV-A2/INV-S2)', () => {
    forAll('an AI decision does not mutate its input', MATCH, (match) => {
      for (const state of match.states) {
        if (state.phase !== 'playing') continue;
        for (const [, make] of ENGINES) {
          const observation = observeForAi(state);
          const before = JSON.stringify(observation);
          make().decide(observation);
          expect(JSON.stringify(observation)).toBe(before);
        }
      }
    });
  });

  it('is reproducible from the observation alone (INV-A5)', () => {
    forAll('the same observation gives the same decision', MATCH, (match) => {
      for (const state of match.states) {
        if (state.phase !== 'playing') continue;
        for (const [, make] of ENGINES) {
          const first = make().decide(observeForAi(state));
          expect(make().decide(observeForAi(state))).toEqual(first);
        }
      }
    });
  });
});
