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
  type ReplayResult,
} from '../src/game-state/replay';
import { createNewGame, serializeGameState, validateTable } from '../src/rules/rules';
import { RulesError, type GameState } from '../src/rules/types';
import { expectCardConservation } from './helpers/invariants';

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

/**
 * The golden corpus. Five committed matches, each protecting a whole-game outcome that no unit
 * test asserts end to end, replayed against the current rules on every `npm run test`.
 *
 * Kept deliberately small — one artifact per *ending*, not one per rule. The contract each one
 * defends is the row below: the outcome facts a player would notice, plus the full-state digest
 * the file carries. A change here is a product change until proven otherwise; regenerating a file
 * is a reviewed act, never a command that rubber-stamps a diff. See
 * [TESTING.md](../docs/TESTING.md#golden-replays).
 */
interface GoldenContract {
  /** What the outcome must be. Read this as "what a player saw at the end of this match". */
  actions: number;
  turn: number;
  phase: 'playing' | 'finished';
  winner: string | null;
  drawPile: number;
  hands: number[];
}

interface Golden {
  id: string;
  /** The regression this artifact exists to catch — not a description of the file. */
  protects: string;
  contract: GoldenContract;
  /** The one claim only this replay can make. Optional: the contract carries the rest. */
  also?: (replay: Replay, result: ReplayResult) => void;
}

/** A card that changes meld between two committed tables — the Mexe rearrangement signature. */
function meldMoves(replay: Replay): { moves: number; jokerMoves: number } {
  let previous = new Map<string, string>();
  let moves = 0;
  let jokerMoves = 0;
  for (const action of replay.actions) {
    if (action.type !== 'confirmTurn') continue;
    const now = new Map<string, string>();
    for (const meld of action.melds) for (const cardId of meld.cardIds) now.set(cardId, meld.id);
    for (const [cardId, meldId] of now) {
      if (previous.get(cardId) && previous.get(cardId) !== meldId) {
        moves++;
        if (cardId.startsWith('joker')) jokerMoves++;
      }
    }
    previous = now;
  }
  return { moves, jokerMoves };
}

const CORPUS: Golden[] = [
  {
    id: 'basic-turns',
    protects: 'the ordinary opening: draws, one confirmed turn, the turn counter and the seat rotating',
    contract: { actions: 8, turn: 9, phase: 'playing', winner: null, drawPile: 87, hands: [11, 7] },
    also: (replay, result) => {
      expect(replay.actions.filter((a) => a.type === 'confirmTurn')).toHaveLength(1);
      expect(result.state.table).toHaveLength(1);
      // Seven draws took seven cards off a 94-card pile; the eighth action laid a meld down.
      expect(result.state.activePlayerIndex).toBe(0);
    },
  },
  {
    id: 'rearrange-joker',
    protects: 'Mexe rearrangement: cards — jokers included — moving between committed melds without loss',
    contract: { actions: 60, turn: 61, phase: 'playing', winner: null, drawPile: 51, hands: [7, 13] },
    also: (replay) => {
      const { moves, jokerMoves } = meldMoves(replay);
      expect(moves, 'no card ever changed meld: this stopped being a rearrangement fixture').toBe(4);
      // INV-G4: a joker keeps its identity while its role changes with the meld it lands in.
      expect(jokerMoves).toBe(2);
    },
  },
  {
    id: 'win-empty-hand',
    protects: 'the win ending: a seat empties its hand while cards remain in the pile',
    contract: { actions: 140, turn: 141, phase: 'finished', winner: 'p1', drawPile: 6, hands: [8, 0] },
  },
  {
    id: 'ai-match-finish',
    protects: 'the exhaustion ending at two seats: the pile runs out and fewest cards wins',
    contract: { actions: 148, turn: 148, phase: 'finished', winner: 'p0', drawPile: 0, hands: [3, 4] },
  },
  {
    id: 'four-seat-pile-out',
    protects: 'four-seat rotation to an exhausted pile, decided by the seat-order tiebreak',
    contract: { actions: 131, turn: 131, phase: 'finished', winner: 'p1', drawPile: 0, hands: [8, 5, 5, 7] },
    also: (_replay, result) => {
      // p1 and p2 both end on five cards; the earliest seat takes it (INV-G6).
      expect(result.state.players.filter((p) => p.hand.length === 5).map((p) => p.id)).toEqual(['p1', 'p2']);
    },
  },
];

describe('replay golden fixtures', () => {
  it.each(CORPUS)('$id: $protects', (entry) => {
    const replay = parseReplay(golden(entry.id));
    const start =
      replay.start.kind === 'new'
        ? `seed ${replay.start.seed}, ${replay.start.players.length} seats`
        : 'snapshot start';
    let result: ReplayResult;
    try {
      result = runReplay(replay);
    } catch (err) {
      // The refusal already names the action index and the reasons; what it cannot know is which
      // artifact it came from or how to run that one alone.
      throw new Error(
        `golden replay ${entry.id} (${start}) no longer runs\n` +
          `${err instanceof Error ? err.message : String(err)}\n` +
          `run this one: npm run replay run tests/fixtures/replays/${entry.id}.json`,
      );
    }
    const state = result.state;
    // One object, one diff: a changed outcome shows up as the fields that moved, not as a hash.
    expect({
      actions: result.applied,
      turn: state.turn,
      phase: state.phase,
      winner: state.winnerId,
      drawPile: state.drawPile.length,
      hands: state.players.map((p) => p.hand.length),
    }).toEqual(entry.contract);
    expect(result.hash, `${entry.id}: same outcome, different full-state digest`).toBe(replay.finalHash);
    expectCardConservation(state);
    expect(validateTable(state.table)).toBe(true);
    entry.also?.(replay, result);
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

  it('refuses a snapshot start whose active player is not a seat', () => {
    // Regression: this used to pass validation — every card accounted for, table legal — and then
    // kill the first action with a TypeError on `players[9].hand`.
    const state = JSON.parse(serializeGameState(createNewGame(7, PLAYERS))) as { state: GameState };
    expectCode(
      JSON.stringify({
        version: REPLAY_VERSION,
        start: { kind: 'snapshot', state: { ...state.state, activePlayerIndex: 9 } },
        actions: [],
      }),
      'corruptSave',
    );
  });
});
