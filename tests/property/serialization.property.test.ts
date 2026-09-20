/**
 * Round-trip and rejection properties for the two places a `GameState` leaves the process: the
 * save envelope (`serializeGameState`/`deserializeGameState`) and a replay file.
 *
 * Both are trust boundaries — a save comes out of storage, a replay out of a bug report — so the
 * properties come in pairs: anything the domain produced must survive the round trip unchanged,
 * and anything corrupted must come back as a `RulesError` with a code the caller can act on,
 * never as a crash and never as trusted state.
 *
 * The `activePlayerIndex` guard in `deserializeGameState` exists because the rejection property
 * below found a corrupt snapshot that passed validation and killed the next action with a
 * `TypeError`.
 */
import { describe, expect, it } from 'vitest';
import { parseReplay, replayHash, replayOf, runReplay, serializeReplay } from '../../src/game-state/replay';
import { deserializeGameState, GAME_STATE_VERSION, serializeGameState } from '../../src/rules/rules';
import { RulesError, type GameState } from '../../src/rules/types';
import { corrupt, describeMatch, playedMatch, reachableState } from '../helpers/generators';
import { forAll, runs } from '../helpers/property';

const MATCH = { runs: runs(15, 300), size: 10, generate: playedMatch, describe: describeMatch };
const STATE = {
  runs: runs(15, 300),
  size: 10,
  generate: reachableState,
  describe: (s: GameState) => `deal ${s.seed}, ${s.players.length} seats, turn ${s.turn}`,
};

/** The code a rejection must carry, and the proof it was a rejection rather than a crash. */
function expectRefused(fn: () => unknown, code: string, what: string): void {
  try {
    fn();
  } catch (err) {
    expect(err, `${what} threw something that is not a RulesError`).toBeInstanceOf(RulesError);
    expect((err as RulesError).code, what).toBe(code);
    return;
  }
  expect.fail(`${what} was accepted`);
}

describe('game state serialization', () => {
  it('round-trips any state legal play can reach', () => {
    forAll('a reachable state round-trips', STATE, (state) => {
      const back = deserializeGameState(serializeGameState(state));
      // Contract equality, not identity: the save format is the contract (INV-S6).
      expect(serializeGameState(back)).toBe(serializeGameState(state));
      expect(back.players.map((p) => p.hand.map((c) => c.id))).toEqual(state.players.map((p) => p.hand.map((c) => c.id)));
      // INV-G4: a joker comes back a joker, never as the face it was standing in for.
      for (const card of back.table.flatMap((m) => m.cards)) {
        if (card.isJoker) expect([card.suit, card.rank]).toEqual([null, null]);
      }
    });
  });

  it('refuses every named corruption with a code, not a crash', () => {
    forAll('a corrupted save is refused', STATE, (state) => {
      for (const [name, breakIt] of Object.entries(corrupt)) {
        const broken = serializeGameState(breakIt(state));
        expectRefused(() => deserializeGameState(broken), 'corruptSave', name);
      }
      const json = JSON.parse(serializeGameState(state)) as { version: number };
      expectRefused(
        () => deserializeGameState(JSON.stringify({ ...json, version: GAME_STATE_VERSION + 1 })),
        'unsupportedSaveVersion',
        'a future version',
      );
    });
  });
});

describe('replay', () => {
  it('reproduces the match it recorded, through its own file format', () => {
    forAll('a recorded match replays to the same state', MATCH, (match) => {
      const replay = replayOf(match.initial, match.actions, match.state);
      const result = runReplay(parseReplay(serializeReplay(replay)));
      expect(result.applied).toBe(match.actions.length);
      expect(result.hash).toBe(replayHash(match.state));
      expect(serializeGameState(result.state)).toBe(serializeGameState(match.state));
    });
  });

  it('refuses a recording whose outcome no longer matches', () => {
    forAll('a diverged replay is refused', MATCH, (match) => {
      if (match.actions.length === 0) return;
      const replay = replayOf(match.initial, match.actions, match.state);
      // Drop the last action but keep the recorded hash: exactly what a rules change that moves a
      // match's outcome looks like from here.
      expectRefused(
        () => runReplay({ ...replay, actions: replay.actions.slice(0, -1) }),
        'replayDiverged',
        'a truncated replay with the original hash',
      );
    });
  });

  it('refuses a recording that names a card the acting seat cannot play', () => {
    forAll('a replay naming an impossible card is refused', MATCH, (match) => {
      const replay = replayOf(match.initial, match.actions, match.state);
      const smuggled = {
        ...replay,
        finalHash: undefined,
        actions: [{ type: 'confirmTurn' as const, actorIndex: 0, melds: [{ id: 'x', cardIds: ['no-such-card'] }] }],
      };
      expectRefused(() => runReplay(parseReplay(serializeReplay(smuggled))), 'corruptReplay', 'a foreign card id');
    });
  });
});
