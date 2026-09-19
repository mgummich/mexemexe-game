/**
 * AI simulation harness — batch AI-vs-AI matches for balance and regression work.
 *
 *   npx tsx scripts/simulate.ts --seeds 1-200 --seats cida,juninho,bia,ze --difficulty smart
 *   npx tsx scripts/simulate.ts --seeds 1-50 --seats bia,ze --json tmp/sim.json
 *
 * It plays through the production path and nothing else: `createNewGame`, `observeForAi`, the
 * personality engines from `createAi`, and `GameStore.dispatch`, which is the same dispatcher a
 * real match uses. There is no simulation-only rule, no shortcut around legality and no separate
 * copy of the turn loop — a result that could not happen in the game cannot happen here.
 *
 * Every run is reproducible from the line printed with it: the seat list, the difficulty and the
 * seed are the whole input. A refused action (which would be a bug, since every AI draft has
 * already passed `canConfirm`) dumps that game's replay so the exact match can be re-run with
 * `npm run replay run <file>`.
 *
 * Output follows WORKFLOW.md §1: one summary line on success, the failing seed and its replay
 * path on failure. `--json` additionally writes the machine-readable per-game rows that Phase 54
 * balance metrics read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAi, DIFFICULTIES, type Difficulty, type Personality } from '../src/ai/ai';
import { observeForAi } from '../src/ai/observation';
import { serializeReplay } from '../src/game-state/replay';
import { GameStore } from '../src/game-state/store';
import { createNewGame } from '../src/rules/rules';

const PERSONALITIES: readonly Personality[] = ['cida', 'juninho', 'bia', 'ze'];
/** A match that has not ended by here is a stalemate, not a hang — the same bound the soak uses. */
const MAX_TURNS = 600;

interface GameResult {
  readonly seed: number;
  /** Seat index that went out, or null when the pile ran dry with nobody out. */
  readonly winner: number | null;
  readonly turns: number;
  readonly draws: number;
  readonly cardsLeft: readonly number[];
  /** Largest share of the trial budget any single decision in this game spent. */
  readonly peakTrials: number;
}

function playGame(seed: number, seats: readonly Personality[], difficulty: Difficulty): GameResult {
  const store = new GameStore(createNewGame(seed, seats.map((p) => ({ name: p, isAi: true }))));
  const ais = seats.map((p) => createAi(p, difficulty));
  let turns = 0;
  let draws = 0;
  let peakTrials = 0;
  while (store.get().phase === 'playing' && turns < MAX_TURNS) {
    const actorIndex = store.get().activePlayerIndex;
    const decision = ais[actorIndex]!.decide(observeForAi(store.get()));
    peakTrials = Math.max(peakTrials, decision.trace.trialsSpent);
    if (decision.kind === 'draw') draws++;
    const outcome = store.dispatch(
      decision.kind === 'confirm'
        ? { type: 'confirmTurn', actorIndex, draft: decision.draft }
        : { type: 'drawAndEndTurn', actorIndex },
    );
    if (!outcome.ok) {
      const file = path.join('tmp', `sim-refused-seed${seed}.json`);
      fs.mkdirSync('tmp', { recursive: true });
      fs.writeFileSync(file, `${serializeReplay(store.replay())}\n`);
      console.error(
        `FAIL simulate\n\nseed ${seed} seat ${actorIndex} (${seats[actorIndex]}) refused: ${outcome.reasons.join(',')}\n` +
          `replay: ${file}\nrerun: npm run replay run ${file}`,
      );
      process.exit(1);
    }
    turns++;
  }
  const state = store.get();
  const winner = state.winnerId === null ? null : state.players.findIndex((p) => p.id === state.winnerId);
  return {
    seed,
    winner: winner === -1 ? null : winner,
    turns,
    draws,
    cardsLeft: state.players.map((p) => p.hand.length),
    peakTrials,
  };
}

function parseSeeds(spec: string): number[] {
  const [from, to] = spec.split('-').map(Number);
  if (!Number.isFinite(from!)) throw new Error(`bad --seeds: ${spec}`);
  const last = Number.isFinite(to!) ? to! : from!;
  return Array.from({ length: last - from! + 1 }, (_, i) => from! + i);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const seeds = parseSeeds(arg('seeds', '1-50'));
const seats = arg('seats', 'cida,juninho,bia,ze').split(',') as Personality[];
const difficulty = arg('difficulty', 'smart') as Difficulty;
const jsonOut = process.argv.indexOf('--json') === -1 ? null : arg('json', 'tmp/simulate.json');

for (const seat of seats) {
  if (!PERSONALITIES.includes(seat)) throw new Error(`unknown personality: ${seat}`);
}
if (!DIFFICULTIES.includes(difficulty)) throw new Error(`unknown difficulty: ${difficulty}`);

const started = Date.now();
const games: GameResult[] = [];
for (const seed of seeds) {
  games.push(playGame(seed, seats, difficulty));
}
const ms = Date.now() - started;

const wins = seats.map((_, seat) => games.filter((g) => g.winner === seat).length);
const stalemates = games.filter((g) => g.winner === null).length;
const summary = {
  config: { seeds: arg('seeds', '1-50'), seats, difficulty },
  games: games.length,
  wins: Object.fromEntries(seats.map((p, i) => [p, wins[i]!])),
  stalemates,
  avgTurns: +(games.reduce((n, g) => n + g.turns, 0) / games.length).toFixed(1),
  drawRate: +(games.reduce((n, g) => n + g.draws, 0) / games.reduce((n, g) => n + g.turns, 0)).toFixed(3),
  avgCardsLeft: seats.map((_, seat) => +(games.reduce((n, g) => n + g.cardsLeft[seat]!, 0) / games.length).toFixed(2)),
  peakTrials: Math.max(...games.map((g) => g.peakTrials)),
  ms,
};

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, `${JSON.stringify({ ...summary, games }, null, 2)}\n`);
}

const winLine = seats.map((p, i) => `${p}=${wins[i]}`).join(' ');
console.log(
  `PASS simulate ${games.length} games ${difficulty} ${winLine} stalemates=${stalemates}` +
    ` avgTurns=${summary.avgTurns} peakTrials=${summary.peakTrials} ${(ms / 1000).toFixed(1)}s` +
    (jsonOut ? ` json=${jsonOut}` : ''),
);
