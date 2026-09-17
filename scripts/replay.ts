/**
 * Replay CLI — the developer/QA reproduction path for a local match.
 *
 *   npx tsx scripts/replay.ts run <file.json>        reproduce a replay, print the final hash
 *   npx tsx scripts/replay.ts record <seed> [out] [maxActions] [personalities]
 *
 * `record` exists so a reproduction can be produced without a browser (and is how the golden
 * fixtures in tests/fixtures/replays are made). A replay captured from a real session comes out
 * of `window.__MEXE__.replay()` instead; both are the same format and both run here.
 *
 * Output follows WORKFLOW.md §1: one line on success, the failing action and its reasons on
 * failure.
 */
import fs from 'node:fs';
import { createAi } from '../src/ai/ai';
import { GameStore } from '../src/game-state/store';
import { parseReplay, runReplay, serializeReplay } from '../src/game-state/replay';
import { createNewGame } from '../src/rules/rules';
import { RulesError } from '../src/rules/types';

/** `cida`/`juninho` run `SimpleAi`, which has no time budget, so recording twice from one seed
 * produces the same file. `bia`/`ze` rearrange under a wall-clock budget: their *recording* is
 * not reproducible, but the recorded actions replay deterministically like any other — which is
 * how a rearrangement-heavy fixture gets made. */
type RecordPersonality = 'cida' | 'juninho' | 'bia' | 'ze';
const DEFAULT_PERSONALITIES: RecordPersonality[] = ['cida', 'juninho'];
const MAX_TURNS = 400;

function record(seed: number, out: string, maxActions: number, personalities: RecordPersonality[]): void {
  const players = personalities.map((p) => ({
    name: p,
    isAi: true,
    aiType: (p === 'bia' || p === 'ze' ? 'rearranger' : 'simple') as 'simple' | 'rearranger',
  }));
  const store = new GameStore(createNewGame(seed, players));
  const ais = personalities.map((p) => createAi(p, 'smart'));
  for (let i = 0; i < Math.min(maxActions, MAX_TURNS) && store.get().phase === 'playing'; i++) {
    const actorIndex = store.get().activePlayerIndex;
    const decision = ais[actorIndex]!.decide(store.get());
    const outcome = store.dispatch(
      decision.kind === 'confirm'
        ? { type: 'confirmTurn', actorIndex, draft: decision.draft }
        : { type: 'drawAndEndTurn', actorIndex },
    );
    if (!outcome.ok) {
      console.error(`FAIL record: turn ${i} refused: ${outcome.reasons.join(',')}`);
      process.exit(1);
    }
  }
  const replay = store.replay();
  fs.writeFileSync(out, `${serializeReplay(replay)}\n`);
  const state = store.get();
  console.log(`PASS record ${out} actions=${replay.actions.length} phase=${state.phase} hash=${replay.finalHash}`);
}

function run(file: string): void {
  try {
    const result = runReplay(parseReplay(fs.readFileSync(file, 'utf8')));
    const { state } = result;
    console.log(
      `PASS replay ${file} actions=${result.applied} turn=${state.turn} phase=${state.phase}` +
        ` winner=${state.winnerId ?? 'none'} hash=${result.hash}`,
    );
  } catch (err) {
    const code = err instanceof RulesError ? err.code : 'error';
    console.error(`FAIL replay ${file}\n\n${code}\n${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

const [command, arg, out, maxActions, personalities] = process.argv.slice(2);
if (command === 'run' && arg) {
  run(arg);
} else if (command === 'record' && arg) {
  record(
    Number(arg),
    out ?? `tmp/replay-${arg}.json`,
    maxActions ? Number(maxActions) : MAX_TURNS,
    personalities ? (personalities.split(',') as RecordPersonality[]) : DEFAULT_PERSONALITIES,
  );
} else {
  console.error('usage: replay run <file.json> | replay record <seed> [out.json] [maxActions] [personalities]');
  process.exit(2);
}
