import {
  createNewGame,
  deserializeGameState,
  draftFromCardIds,
  GAME_STATE_VERSION,
  serializeGameState,
} from '../rules/rules';
import { fnv1a } from '../rules/hash';
import { RulesError, type GameState, type PlayerConfig, type RulesConfig } from '../rules/types';
import { applyGameAction, type GameAction } from './actions';

/**
 * Deterministic reproduction of a local match: a start point plus the ordered actions that were
 * dispatched, replayed through `applyGameAction` — the same function `GameStore.dispatch` uses.
 * There is no second gameplay path here, and nothing in this file touches Phaser, the DOM, the
 * network or a clock.
 *
 * This is developer/QA reproduction, not a player-facing feature, and it is a different artifact
 * from the two it sits next to:
 *
 *   SAVE   (`serializeGameState`) — restore a match where the player left it
 *   REPLAY (this file)            — reproduce how a match got there
 *   PLAYLOG (`src/core/playlog.ts`) — a human-readable timeline of what the session looked like
 *
 * Online matches are not replayable from a client: the local store there is a redacted projection
 * with placeholder cards (see `src/net/viewToState.ts`), so the actions never ran against the
 * authoritative state. The server's own replay would start from its seed, not from a view.
 */
export const REPLAY_VERSION = 1;

/**
 * How the recorded match began. `new` is preferred and is what a normal match produces: the deal
 * is rebuilt from the seed, so the artifact stays tiny and provably reconstructible. `snapshot`
 * exists for the states normal game creation cannot produce — the tutorial fixture and the
 * showcase tables — and carries the same versioned envelope a save does.
 */
export type ReplayStart =
  | { kind: 'new'; seed: number; players: PlayerConfig[]; config: RulesConfig }
  | { kind: 'snapshot'; state: GameState };

/**
 * A recorded action. Card *identity* is never stored — melds carry ids, exactly as the wire
 * protocol's `SubmitTurnMeld` does, and `draftFromCardIds` turns them back into cards against the
 * state the action is replayed on. That keeps a full match to a few kB instead of a few hundred,
 * and it means a replay cannot smuggle in a card the state does not hold.
 */
export type ReplayAction =
  | { type: 'confirmTurn'; actorIndex: number; melds: { id: string; cardIds: string[] }[] }
  | { type: 'drawAndEndTurn'; actorIndex: number };

export interface Replay {
  version: typeof REPLAY_VERSION;
  start: ReplayStart;
  actions: ReplayAction[];
  /** `replayHash` of the state the recorder ended on, when it knew it. Checked by `runReplay`. */
  finalHash?: string;
}

/** Full-state digest: every card, in order. Offline only — see `fnv1a` for why online uses the
 * redacted `stateHash` instead. */
export function replayHash(state: GameState): string {
  return fnv1a(serializeGameState(state));
}

function bad(message: string): never {
  throw new RulesError(`corrupt replay: ${message}`, 'corruptReplay');
}

/**
 * Build a replay from the state a match started in and the actions it dispatched.
 *
 * The start point is not guessed: a `new` start is emitted only when re-dealing from the state's
 * own seed/players/config reproduces exactly the state that was handed in. Anything else — a
 * tutorial fixture, a showcase table, an online projection — records as a snapshot.
 */
export function replayOf(initial: GameState, actions: readonly GameAction[], final?: GameState): Replay {
  const players: PlayerConfig[] = initial.players.map((p) => ({
    name: p.name,
    isAi: p.isAi,
    ...(p.aiType ? { aiType: p.aiType } : {}),
  }));
  let start: ReplayStart = { kind: 'snapshot', state: initial };
  try {
    if (replayHash(createNewGame(initial.seed, players, initial.config)) === replayHash(initial)) {
      start = { kind: 'new', seed: initial.seed, players, config: initial.config };
    }
  } catch {
    // A state whose player count or config the dealer refuses is by definition not re-dealable.
  }
  return {
    version: REPLAY_VERSION,
    start,
    actions: actions.map((a) =>
      a.type === 'confirmTurn'
        ? {
            type: 'confirmTurn' as const,
            actorIndex: a.actorIndex,
            melds: a.draft.melds.map((m) => ({ id: m.id, cardIds: m.cards.map((c) => c.id) })),
          }
        : { type: 'drawAndEndTurn' as const, actorIndex: a.actorIndex },
    ),
    ...(final ? { finalHash: replayHash(final) } : {}),
  };
}

function parseAction(raw: unknown, index: number): ReplayAction {
  if (!raw || typeof raw !== 'object') bad(`action ${index} is not an object`);
  const a = raw as Record<string, unknown>;
  if (typeof a.actorIndex !== 'number' || !Number.isInteger(a.actorIndex) || a.actorIndex < 0) {
    bad(`action ${index} has no actor`);
  }
  if (a.type === 'drawAndEndTurn') return { type: 'drawAndEndTurn', actorIndex: a.actorIndex };
  if (a.type !== 'confirmTurn') bad(`action ${index} has unknown type ${String(a.type)}`);
  if (!Array.isArray(a.melds)) bad(`action ${index} has no melds`);
  const melds = a.melds.map((raw2, m) => {
    const meld = raw2 as Record<string, unknown> | null;
    if (!meld || typeof meld.id !== 'string' || !Array.isArray(meld.cardIds) || meld.cardIds.some((c) => typeof c !== 'string')) {
      bad(`action ${index} meld ${m} is malformed`);
    }
    return { id: meld.id as string, cardIds: meld.cardIds as string[] };
  });
  // Legality is deliberately NOT checked here: `applyGameAction` runs the same check live
  // gameplay runs, against the state the action lands on. Checking it twice would be a second
  // authority.
  return { type: 'confirmTurn', actorIndex: a.actorIndex, melds };
}

/** Untrusted JSON → `Replay`, or a throw. Replay files come from bug reports and CI artifacts. */
export function parseReplay(json: string): Replay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    bad('not JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) bad('not an object');
  const r = parsed as Record<string, unknown>;
  if (r.version !== REPLAY_VERSION) {
    throw new RulesError(`replay version ${String(r.version)} is not supported`, 'unsupportedReplayVersion');
  }
  if (!Array.isArray(r.actions)) bad('actions is not an array');
  const s = r.start as Record<string, unknown> | undefined;
  if (!s || typeof s !== 'object') bad('no start');
  let start: ReplayStart;
  if (s.kind === 'new') {
    if (typeof s.seed !== 'number' || !Array.isArray(s.players) || !s.config || typeof s.config !== 'object') {
      bad('bad new-game start');
    }
    start = { kind: 'new', seed: s.seed, players: s.players as PlayerConfig[], config: s.config as RulesConfig };
  } else if (s.kind === 'snapshot') {
    // Reuse the save reader: a snapshot start is exactly a save, invariants included.
    start = { kind: 'snapshot', state: deserializeGameState(JSON.stringify({ version: GAME_STATE_VERSION, state: s.state })) };
  } else {
    bad(`unknown start kind ${String(s.kind)}`);
  }
  return {
    version: REPLAY_VERSION,
    start,
    actions: r.actions.map(parseAction),
    ...(typeof r.finalHash === 'string' ? { finalHash: r.finalHash } : {}),
  };
}

export function serializeReplay(replay: Replay): string {
  return JSON.stringify(replay);
}

export interface ReplayResult {
  state: GameState;
  hash: string;
  /** Actions applied — always `replay.actions.length` on success. */
  applied: number;
}

/** Recorded action → the `GameAction` live gameplay dispatches, resolved against this state. */
function toAction(state: GameState, recorded: ReplayAction, index: number): GameAction {
  if (recorded.type === 'drawAndEndTurn') return recorded;
  const draft = draftFromCardIds(state, recorded.actorIndex, recorded.melds);
  if (!draft) bad(`action ${index} names a card seat ${recorded.actorIndex} cannot play`);
  return { type: 'confirmTurn', actorIndex: recorded.actorIndex, draft };
}

/**
 * Run a replay to its end. Every action goes through `applyGameAction`, so a replay can only
 * reach states live gameplay could reach.
 *
 * Failures are explicit: an action the rules refuse throws `corruptReplay` naming the index and
 * the reasons, and a `finalHash` that does not match throws `replayDiverged` — which is the whole
 * point of recording one.
 */
export function runReplay(replay: Replay): ReplayResult {
  let state =
    replay.start.kind === 'new'
      ? createNewGame(replay.start.seed, replay.start.players, replay.start.config)
      : replay.start.state;
  for (const [i, recorded] of replay.actions.entries()) {
    const action = toAction(state, recorded, i);
    const outcome = applyGameAction(state, action);
    if (!outcome.ok) {
      throw new RulesError(
        `corrupt replay: action ${i} (${action.type}) refused: ${outcome.reasons.join(',')}`,
        'corruptReplay',
      );
    }
    state = outcome.state;
  }
  const hash = replayHash(state);
  if (replay.finalHash && replay.finalHash !== hash) {
    throw new RulesError(`replay diverged: expected ${replay.finalHash}, got ${hash}`, 'replayDiverged');
  }
  return { state, hash, applied: replay.actions.length };
}
