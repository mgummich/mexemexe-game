/**
 * Transition properties — what must be true of *every* application action, on every state legal
 * play can reach, at 2, 3 and 4 seats.
 *
 * `tests/probes.test.ts` already plays 40 seeded matches through the rules functions and checks
 * conservation and table legality after every turn; this file deliberately does not repeat that.
 * What it adds is the `applyGameAction` **contract** — the facts the action reports back, and the
 * guarantee that a refusal changes nothing — over generated states rather than two fixed seats.
 */
import { describe, expect, it } from 'vitest';
import { applyGameAction, type GameAction } from '../../src/game-state/actions';
import { serializeGameState } from '../../src/rules/rules';
import type { GameState } from '../../src/rules/types';
import { aiAction, describeMatch, playedMatch } from '../helpers/generators';
import { allCards, expectCardConservation } from '../helpers/invariants';
import { forAll, runs } from '../helpers/property';

const MATCH = { runs: runs(15, 400), size: 10, generate: playedMatch, describe: describeMatch };

/** Contract equality: two states are the same state if they serialize the same (INV-S6). */
const same = (a: GameState, b: GameState): boolean => serializeGameState(a) === serializeGameState(b);

describe('accepted actions', () => {
  it('report what they did and conserve the dealt cards', () => {
    forAll('an accepted action reports what it did', MATCH, (match) => {
      const dealt = allCards(match.initial).map((c) => c.id);
      for (const [i, before] of match.states.entries()) {
        const action = match.actions[i];
        if (!action) break;
        const actor = before.players[action.actorIndex]!;
        const outcome = applyGameAction(before, action);
        expect(outcome.ok, `action ${i} was refused`).toBe(true);
        if (!outcome.ok) return;
        expectCardConservation(outcome.state, dealt);
        expect(outcome.actorId).toBe(actor.id);
        // `cardsPlayed` is the number the UI and the play log report; it has to be the hand
        // difference, not a count the action was told.
        const after = outcome.state.players.find((p) => p.id === actor.id)!;
        const handDelta = actor.hand.length - after.hand.length;
        expect(outcome.cardsPlayed).toBe(action.type === 'drawAndEndTurn' ? 0 : handDelta);
        if (action.type === 'drawAndEndTurn' && outcome.state.phase === 'playing') expect(handDelta).toBe(-1);
        expect(outcome.finished).toBe(outcome.state.phase === 'finished');
        expect(outcome.finished).toBe(outcome.state.winnerId !== null);
      }
    });
  });

  it('advance exactly one seat and one turn while the match is live', () => {
    forAll('an accepted action advances one seat and one turn', MATCH, (match) => {
      for (const [i, before] of match.states.entries()) {
        const after = match.states[i + 1];
        if (!after) break;
        if (after.phase === 'finished') {
          // The last transition may end the match instead of rotating; nothing after it applies.
          expect(after.winnerId).not.toBeNull();
          continue;
        }
        expect(after.turn).toBe(before.turn + 1);
        expect(after.activePlayerIndex).toBe((before.activePlayerIndex + 1) % before.players.length);
        expect(after.players.map((p) => p.id)).toEqual(before.players.map((p) => p.id));
        expect(after.seed).toBe(before.seed);
      }
    });
  });

  it('are deterministic: the same state and action twice give the same next state', () => {
    forAll('the same state and action twice give the same next state', MATCH, (match) => {
      const state = match.state;
      if (state.phase !== 'playing') return;
      const action = aiAction(state);
      const first = applyGameAction(state, action);
      const second = applyGameAction(state, action);
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;
      expect(same(first.state, second.state)).toBe(true);
      // And the state it was applied to is untouched — transitions return, they do not write.
      expect(same(state, match.states.at(-1)!)).toBe(true);
    });
  });
});

describe('refused actions', () => {
  /** Every way a caller can be wrong that the action layer itself owns. */
  function illegalActions(state: GameState): { why: string; action: GameAction }[] {
    const active = state.activePlayerIndex;
    const other = (active + 1) % state.players.length;
    const legal = aiAction(state);
    return [
      { why: 'out of turn', action: { ...legal, actorIndex: other } as GameAction },
      { why: 'no such seat', action: { type: 'drawAndEndTurn', actorIndex: state.players.length } },
      { why: 'empty draft', action: { type: 'confirmTurn', actorIndex: active, draft: { melds: [], handCardsPlayed: [] } } },
      {
        why: 'a card the seat does not hold',
        action: {
          type: 'confirmTurn',
          actorIndex: active,
          draft: { melds: [{ id: 'x', cards: [...state.players[other]!.hand.slice(0, 3)] }], handCardsPlayed: [] },
        },
      },
    ];
  }

  it('leave the state byte-identical and always say why', () => {
    forAll('a refused action leaves the state untouched', MATCH, (match) => {
      const state = match.state;
      if (state.phase !== 'playing') return;
      const frozen = serializeGameState(state);
      for (const { why, action } of illegalActions(state)) {
        const outcome = applyGameAction(state, action);
        expect(outcome.ok, `accepted an illegal action: ${why}`).toBe(false);
        if (outcome.ok) return;
        expect(outcome.reasons.length, `no reason given for: ${why}`).toBeGreaterThan(0);
        for (const reason of outcome.reasons) expect(reason).toMatch(/^reason\./);
        expect(serializeGameState(state), `state changed after: ${why}`).toBe(frozen);
      }
    });
  });

  it('are the only outcome once a match is finished (INV-S4)', () => {
    forAll(
      'a finished match refuses everything',
      { runs: runs(10, 120), size: 400, generate: playedMatch, describe: describeMatch },
      (match) => {
        const state = match.state;
        expect(state.phase, 'generator did not reach a finished match').toBe('finished');
        expect(state.winnerId).not.toBeNull();
        const frozen = serializeGameState(state);
        for (let seat = 0; seat < state.players.length; seat++) {
          const outcome = applyGameAction(state, { type: 'drawAndEndTurn', actorIndex: seat });
          expect(outcome.ok).toBe(false);
          if (!outcome.ok) expect(outcome.reasons).toEqual(['reason.notYourTurn']);
        }
        expect(serializeGameState(state)).toBe(frozen);
      },
    );
  });
});
