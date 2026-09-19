/**
 * AI simulation harness — batch AI-vs-AI matches for balance and regression work.
 *
 *   npx tsx scripts/simulate.ts --seeds 1-200 --seats cida,juninho,bia,ze --difficulty smart
 *   npx tsx scripts/simulate.ts --seeds 1-50 --seats bia,ze --json tmp/sim.json
 *   npx tsx scripts/simulate.ts --seeds 1-200 --sweep difficulty   one row per tier
 *   npx tsx scripts/simulate.ts --seeds 1-200 --sweep matchups     one row per head-to-head pair
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
 * path on failure. `--json` additionally writes the machine-readable per-game rows that balance
 * work reads.
 *
 * Reading the numbers: no single one of them is the answer. A win count says who went out first
 * but not by how much; `avgCardsLeft` says how close the others were; `avgTurns` says whether the
 * table moved at all; `drawRate` separates a seat that had nothing to play from one that chose to
 * wait. `±` on a win count is the 95% confidence half-width for that share over this many games —
 * a gap smaller than the two intervals put together is not a difference, it is the sample size.
 * Every seat plays the same dealt seeds in the same seat order, so a comparison is paired: the
 * only difference between two rows is the thing being compared.
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

/** `12` is one seed; `1-200` is a range. Anything else is a typo, and a typo that silently
 *  becomes a different sample is worse than a crash. */
function parseSeeds(spec: string): number[] {
  const parts = spec.split('-').map(Number);
  const [from, to] = parts;
  if (parts.length > 2 || !Number.isFinite(from) || (parts.length === 2 && !Number.isFinite(to))) {
    throw new Error(`bad --seeds: ${spec} (expected N or N-M)`);
  }
  const last = parts.length === 2 ? to! : from!;
  if (last < from!) throw new Error(`bad --seeds: ${spec} (range runs backwards)`);
  return Array.from({ length: last - from! + 1 }, (_, i) => from! + i);
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

/** 95% confidence half-width for a win share over `n` games (normal approximation). */
function ci95(wins: number, n: number): number {
  const p = wins / n;
  return +(1.96 * Math.sqrt((p * (1 - p)) / n) * n).toFixed(1);
}

function stdDev(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return +Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length).toFixed(1);
}

const seeds = parseSeeds(arg('seeds', '1-50'));
const seats = arg('seats', 'cida,juninho,bia,ze').split(',') as Personality[];
const difficulty = arg('difficulty', 'smart') as Difficulty;
const jsonOut = process.argv.indexOf('--json') === -1 ? null : arg('json', 'tmp/simulate.json');
/** `difficulty` runs every tier over the same seeds; `matchups` runs every head-to-head pair. */
const sweep = process.argv.indexOf('--sweep') === -1 ? null : arg('sweep', 'difficulty');
if (sweep !== null && sweep !== 'difficulty' && sweep !== 'matchups') {
  throw new Error(`unknown --sweep: ${sweep} (expected difficulty or matchups)`);
}

for (const seat of seats) {
  if (!PERSONALITIES.includes(seat)) throw new Error(`unknown personality: ${seat}`);
}
if (!DIFFICULTIES.includes(difficulty)) throw new Error(`unknown difficulty: ${difficulty}`);

/** One batch: the same seeds, one configuration. Paired by construction — every row a sweep
 *  prints played the identical deals in the identical seat order. */
function run(runSeats: readonly Personality[], runDifficulty: Difficulty): { games: GameResult[]; ms: number } {
  const started = Date.now();
  const games = seeds.map((seed) => playGame(seed, runSeats, runDifficulty));
  return { games, ms: Date.now() - started };
}

function summarize(runSeats: readonly Personality[], runDifficulty: Difficulty, games: GameResult[], ms: number) {
  const wins = runSeats.map((_, seat) => games.filter((g) => g.winner === seat).length);
  return {
    config: { seeds: arg('seeds', '1-50'), seats: [...runSeats], difficulty: runDifficulty },
    games: games.length,
    wins: Object.fromEntries(runSeats.map((p, i) => [p, wins[i]!])),
    winsCi95: Object.fromEntries(runSeats.map((p, i) => [p, ci95(wins[i]!, games.length)])),
    stalemates: games.filter((g) => g.winner === null).length,
    avgTurns: +(games.reduce((n, g) => n + g.turns, 0) / games.length).toFixed(1),
    turnsStdDev: stdDev(games.map((g) => g.turns)),
    drawRate: +(games.reduce((n, g) => n + g.draws, 0) / games.reduce((n, g) => n + g.turns, 0)).toFixed(3),
    avgCardsLeft: Object.fromEntries(
      runSeats.map((p, seat) => [p, +(games.reduce((n, g) => n + g.cardsLeft[seat]!, 0) / games.length).toFixed(2)]),
    ),
    peakTrials: Math.max(...games.map((g) => g.peakTrials)),
    ms,
  };
}

type Summary = ReturnType<typeof summarize>;

function line(label: string, s: Summary): string {
  const wins = Object.entries(s.wins)
    .map(([p, w]) => `${p}=${w}±${s.winsCi95[p]}`)
    .join(' ');
  return (
    `${label} ${wins} stalemates=${s.stalemates} avgTurns=${s.avgTurns}±${s.turnsStdDev}` +
    ` drawRate=${s.drawRate} peakTrials=${s.peakTrials} ${(s.ms / 1000).toFixed(1)}s`
  );
}

const summaries: Summary[] = [];
if (sweep === 'difficulty') {
  for (const tier of DIFFICULTIES) {
    const { games, ms } = run(seats, tier);
    const s = summarize(seats, tier, games, ms);
    summaries.push(s);
    console.log(line(`PASS simulate ${s.games} games ${tier.padEnd(8)}`, s));
  }
} else if (sweep === 'matchups') {
  for (let i = 0; i < PERSONALITIES.length; i++) {
    for (let k = i + 1; k < PERSONALITIES.length; k++) {
      const pair = [PERSONALITIES[i]!, PERSONALITIES[k]!];
      // Each pair plays the seed set twice, once from each side. Moving first is worth real
      // games in this deal-heavy format, so a one-sided run would measure the seat as much as
      // the personality.
      const forward = run(pair, difficulty);
      const reverse = run([pair[1]!, pair[0]!], difficulty);
      const s = summarize(pair, difficulty, forward.games, forward.ms + reverse.ms);
      const swapped = summarize([pair[1]!, pair[0]!], difficulty, reverse.games, reverse.ms);
      const both: Summary = {
        ...s,
        games: s.games + swapped.games,
        wins: Object.fromEntries(pair.map((p) => [p, s.wins[p]! + swapped.wins[p]!])),
        winsCi95: Object.fromEntries(pair.map((p) => [p, ci95(s.wins[p]! + swapped.wins[p]!, s.games + swapped.games)])),
        stalemates: s.stalemates + swapped.stalemates,
        avgTurns: +((s.avgTurns + swapped.avgTurns) / 2).toFixed(1),
        turnsStdDev: stdDev([...forward.games, ...reverse.games].map((g) => g.turns)),
        drawRate: +((s.drawRate + swapped.drawRate) / 2).toFixed(3),
        avgCardsLeft: Object.fromEntries(
          pair.map((p) => [p, +((s.avgCardsLeft[p]! + swapped.avgCardsLeft[p]!) / 2).toFixed(2)]),
        ),
        peakTrials: Math.max(s.peakTrials, swapped.peakTrials),
      };
      summaries.push(both);
      console.log(line(`PASS simulate ${both.games} games ${pair.join(' vs ').padEnd(18)}`, both));
    }
  }
} else {
  const { games, ms } = run(seats, difficulty);
  const s = summarize(seats, difficulty, games, ms);
  summaries.push(s);
  console.log(line(`PASS simulate ${s.games} games ${difficulty}`, s) + (jsonOut ? ` json=${jsonOut}` : ''));
}

if (jsonOut) {
  fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
  fs.writeFileSync(jsonOut, `${JSON.stringify(summaries.length === 1 ? summaries[0] : summaries, null, 2)}\n`);
}
