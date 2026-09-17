/**
 * Replay contract: the same inputs reproduce the same match, and anything that is not those
 * inputs is refused loudly. Replay files come from bug reports and CI artifacts, so every case
 * below that starts with malformed JSON is a trust-boundary test, not a unit test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameStore } from '../src/game-state/store';
import {
  parseReplay,
  replayHash,
  replayOf,
  REPLAY_VERSION,
  runReplay,
  serializeReplay,
  type Replay,
} from '../src/game-state/replay';
import { createNewGame, serializeGameState } from '../src/rules/rules';
import { RulesError, type GameState } from '../src/rules/types';

const PLAYERS = [
  { name: 'A', isAi: false },
  { name: 'B', isAi: true, aiType: 'simple' as const },
];

const FIXTURES = path.join(process.cwd(), 'tests/fixtures/replays');
const golden = (name: string): string => fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8');

/** A match of draws only: legal from any deal, and it ends when the pile runs out. */
function drawOnly(seed: number, count: number): Replay {
  const store = new GameStore(createNewGame(seed, PLAYERS));
  for (let i = 0; i < count && store.get().phase === 'playing'; i++) {
    store.dispatch({ type: 'drawAndEndTurn', actorIndex: store.get().activePlayerIndex });
  }
  return store.replay();
}

describe('replay reproduction', () => {
  it('the same seed and the same actions reproduce the same state', () => {
    const replay = drawOnly(99, 12);
    const first = runReplay(replay);
    const second = runReplay(parseReplay(serializeReplay(replay)));
    expect(second.hash).toBe(first.hash);
    expect(serializeGameState(second.state)).toBe(serializeGameState(first.state));
    expect(first.applied).toBe(12);
  });

  it('a match started from a seed records its seed, not its deal', () => {
    const replay = drawOnly(7, 3);
    expect(replay.start.kind).toBe('new');
    expect(JSON.stringify(replay).length).toBeLessThan(1000);
  });

  it('a state normal game creation cannot produce records as a snapshot', () => {
    // The tutorial fixture and the showcase tables are exactly this shape: a hand-built state
    // whose seed does not deal it.
    const dealt = createNewGame(5, PLAYERS);
    // Cards move, none vanish — a staged table is still a valid state, it is just not one this
    // seed deals.
    const staged: GameState = {
      ...dealt,
      drawPile: dealt.drawPile.slice(1),
      players: dealt.players.map((p, i) => (i === 0 ? { ...p, hand: [...p.hand, dealt.drawPile[0]!] } : p)),
    };
    const replay = replayOf(staged, []);
    expect(replay.start.kind).toBe('snapshot');
    expect(runReplay(parseReplay(serializeReplay(replay))).hash).toBe(replayHash(staged));
  });

  it('only actions the store accepted are recorded', () => {
    const store = new GameStore(createNewGame(11, PLAYERS));
    // Out of turn: refused, changes nothing, and must not enter the reproduction.
    expect(store.dispatch({ type: 'drawAndEndTurn', actorIndex: 1 }).ok).toBe(false);
    store.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(store.replay().actions).toHaveLength(1);
  });

  it('the recorded final hash is checked on replay', () => {
    const replay = { ...drawOnly(3, 4), finalHash: 'deadbeef' };
    expect(() => runReplay(replay)).toThrow(RulesError);
    try {
      runReplay(replay);
    } catch (err) {
      expect((err as RulesError).code).toBe('replayDiverged');
    }
  });
});

describe('replay golden fixtures', () => {
  // Two committed artifacts, replayed against the current rules. If a rules change moves a
  // match's outcome, these are what says so.
  it('an AI match reproduces to its recorded finish', () => {
    const replay = parseReplay(golden('ai-match-finish'));
    const result = runReplay(replay);
    expect(result.hash).toBe(replay.finalHash);
    expect(result.state.phase).toBe('finished');
    expect(result.state.winnerId).toBe('p0');
    // The pile ran out — the fewest-cards ending, not a player emptying their hand.
    expect(result.state.drawPile).toHaveLength(0);
  });

  it('a rearranging, joker-heavy fragment reproduces', () => {
    const replay = parseReplay(golden('rearrange-joker'));
    const result = runReplay(replay);
    expect(result.hash).toBe(replay.finalHash);
    const jokerConfirms = replay.actions.filter(
      (a) => a.type === 'confirmTurn' && a.melds.some((m) => m.cardIds.some((id) => id.startsWith('joker'))),
    );
    expect(jokerConfirms.length).toBeGreaterThan(0);
  });
});

describe('replay input validation', () => {
  const expectCode = (json: string, code: string): void => {
    try {
      runReplay(parseReplay(json));
      throw new Error(`expected ${code}`);
    } catch (err) {
      expect(err).toBeInstanceOf(RulesError);
      expect((err as RulesError).code).toBe(code);
    }
  };

  const valid = (): Record<string, unknown> => JSON.parse(serializeReplay(drawOnly(21, 2)));

  it('refuses a replay from a future version', () => {
    expectCode(JSON.stringify({ ...valid(), version: REPLAY_VERSION + 1 }), 'unsupportedReplayVersion');
  });

  it('refuses malformed input', () => {
    expectCode('not json', 'corruptReplay');
    expectCode('[]', 'corruptReplay');
    expectCode(JSON.stringify({ version: REPLAY_VERSION, actions: [] }), 'corruptReplay');
    expectCode(JSON.stringify({ ...valid(), actions: {} }), 'corruptReplay');
  });

  it('refuses an unknown action type, actor or meld shape', () => {
    expectCode(JSON.stringify({ ...valid(), actions: [{ type: 'rewind', actorIndex: 0 }] }), 'corruptReplay');
    expectCode(JSON.stringify({ ...valid(), actions: [{ type: 'drawAndEndTurn' }] }), 'corruptReplay');
    expectCode(
      JSON.stringify({ ...valid(), actions: [{ type: 'confirmTurn', actorIndex: 0, melds: [{ id: 'm1' }] }] }),
      'corruptReplay',
    );
  });

  it('refuses an illegal action sequence', () => {
    // Legal shape, illegal order: seat 1 cannot open the match.
    expectCode(JSON.stringify({ ...valid(), actions: [{ type: 'drawAndEndTurn', actorIndex: 1 }] }), 'corruptReplay');
  });

  it('refuses a card the acting seat does not hold', () => {
    expectCode(
      JSON.stringify({
        ...valid(),
        actions: [{ type: 'confirmTurn', actorIndex: 0, melds: [{ id: 'm1', cardIds: ['hearts-3-d9'] }] }],
      }),
      'corruptReplay',
    );
  });

  it('refuses a corrupt snapshot start with the save reader that owns that check', () => {
    expectCode(JSON.stringify({ version: REPLAY_VERSION, start: { kind: 'snapshot', state: {} }, actions: [] }), 'corruptSave');
  });
});
