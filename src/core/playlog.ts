import type { EventBus, GameEvents } from './events';
// Type-only, erased at build: the match owns the shape of its own notifications, and a second
// copy of that union here would be a second owner of it (see tests/boundaries.test.ts).
import type { MatchEvent } from '../game-state/match';

const CAP = 2000;
/** A gap this long between two actions inside your own turn is a hesitation worth reading (TELEMETRY-02). */
const HESITATION_MS = 3000;
/** An undo this soon after a drop reads as "that card did not land where I meant" (TELEMETRY-09). */
const UNDO_AFTER_DROP_MS = 3000;
/** Player-typed data must never leak into an export — strip these keys wherever a caller passes them. */
const BANNED_KEYS = new Set(['name', 'playerName', 'token', 'sessionToken']);

type PlaylogValue = string | number | boolean;
/** What happened to a dragged/tapped card. `rejected` = the editor refused it, `blocked` = the
 * tutorial refused it, `cancelled` = the drag was abandoned (pointercancel). */
type DropOutcome = 'played' | 'moved' | 'returned' | 'rejected' | 'blocked' | 'cancelled';
export interface PlaylogEntry {
  /** ms since this module was loaded — `performance.now()`, never a wall clock. */
  t: number;
  type: string;
  data?: Record<string, PlaylogValue>;
}

/** Cross-session continuity, read from saved progress by GameScene and handed in — counts only,
 * never an identifier (TELEMETRY-12, TELEMETRY-13). */
interface PlaylogSessionContext {
  /** How many real matches this browser has started, including this one. */
  gamesStarted: number;
  tutorialCompleted: boolean;
}

interface PlaylogPlayerStats {
  cardsPlayed: number;
  draws: number;
  confirms: number;
}

export interface PlaylogSummary {
  totalTurns: number;
  invalidFeitoByReason: Record<string, number>;
  drawCount: number;
  undoCount: number;
  redoCount: number;
  resetCount: number;
  turnDurationMeanMs: number;
  turnDurationMaxMs: number;
  tutorialFurthestStep: number | null;
  disconnects: number;
  reconnects: number;
  desyncs: number;
  proposalRejectsByReason: Record<string, number>;
  /** Per-player cards played / draws / meld-confirm count, keyed by GameState player id — feeds
   * the results-screen rematch summary (see core/results-summary.ts). */
  perPlayer: Record<string, PlaylogPlayerStats>;
  /** Gaps of HESITATION_MS or more between two actions inside the human's own turn, and the
   * longest one (TELEMETRY-02). Both stay 0 until setHumanPlayer() says which seat is the human. */
  hesitations: number;
  hesitationMaxMs: number;
  /** Total ms the table sat in an invalid state, and the same total split by rule reason code
   * (TELEMETRY-07). A span counts once, against the reasons it started with. */
  tableInvalidTotalMs: number;
  tableInvalidByReason: Record<string, number>;
  /** Drops by what happened to them and by pointer kind (`coarse`/`fine`), plus undos that landed
   * within UNDO_AFTER_DROP_MS of a drop — the mis-drop signal (TELEMETRY-09). */
  dropsByOutcome: Record<string, number>;
  dropsByPointer: Record<string, number>;
  undoAfterDropCount: number;
  /** Table-zoom steps and orientation flips taken during the session (TELEMETRY-10). */
  zoomChanges: number;
  orientationFlips: number;
  /** Tutorial start (first tutorial step, else session start) to the first confirmed turn
   * (TELEMETRY-11). Null until a turn is confirmed. */
  timeToFirstMexeMs: number | null;
  /** Longest run of consecutive draws by one player, across all players (TELEMETRY-15). */
  drawStreakMax: number;
  /** Turn durations split human vs AI (TELEMETRY-15). 0 until setHumanPlayer() is called. */
  humanTurnDurationMeanMs: number;
  aiTurnDurationMeanMs: number;
  /** Which game this is for this browser and whether the tutorial was done first — the only way
   * to see tutorial → first game and first game → second game, since the log itself dies on
   * reload (TELEMETRY-12, TELEMETRY-13). Null until GameScene supplies it. */
  session: PlaylogSessionContext | null;
  /** Board shape sampled by recordBoard() — hand size, deck left and table complexity
   * (TELEMETRY-08, TELEMETRY-15). */
  boardSamples: number;
  handSizeMean: number;
  deckRemainingMin: number | null;
  tableMeldsMax: number;
  tableCardsMax: number;
}

const base = typeof performance !== 'undefined' ? performance.now() : 0;

function sanitize(data?: Record<string, PlaylogValue>): Record<string, PlaylogValue> | undefined {
  if (!data) return undefined;
  const out: Record<string, PlaylogValue> = {};
  for (const [k, v] of Object.entries(data)) if (!BANNED_KEYS.has(k)) out[k] = v;
  return out;
}

function perPlayerStats(entries: PlaylogEntry[]): Record<string, PlaylogPlayerStats> {
  const out: Record<string, PlaylogPlayerStats> = {};
  const bump = (id: string): PlaylogPlayerStats => (out[id] ??= { cardsPlayed: 0, draws: 0, confirms: 0 });
  for (const e of entries) {
    const playerId = e.data?.playerId;
    if (typeof playerId !== 'string') continue;
    if (e.type === 'turn:confirmed') {
      const s = bump(playerId);
      s.confirms++;
      s.cardsPlayed += typeof e.data?.cardsPlayed === 'number' ? e.data.cardsPlayed : 0;
    } else if (e.type === 'turn:drawn') {
      bump(playerId).draws++;
    }
  }
  return out;
}

function countBy(entries: PlaylogEntry[], type: string, field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    if (e.type !== type) continue;
    const raw = e.data?.[field];
    if (typeof raw !== 'string') continue;
    for (const reason of raw.split(',')) counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
}

/** The ms-weighted twin of countBy(): sums `valueField` against each reason token in `field`. */
function sumBy(entries: PlaylogEntry[], type: string, field: string, valueField: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    if (e.type !== type) continue;
    const raw = e.data?.[field];
    const value = e.data?.[valueField];
    if (typeof raw !== 'string' || typeof value !== 'number') continue;
    for (const reason of raw.split(',')) out[reason] = (out[reason] ?? 0) + value;
  }
  return out;
}

/**
 * One pass over the log for the three metrics that need to know which turn an entry sits in:
 * hesitation gaps inside the human's own turn, and turn durations split human vs AI.
 *
 * A `turn:start` carries the duration of the turn *before* it, so each duration is attributed to
 * the player whose `turn:start` we last saw. Without a known human seat there is nothing to split
 * on, so both lists stay empty and the flat turnDuration* fields remain the whole story.
 */
function turnMetrics(entries: PlaylogEntry[], humanId: string | null): {
  hesitations: number;
  hesitationMaxMs: number;
  humanDurations: number[];
  aiDurations: number[];
} {
  let hesitations = 0;
  let hesitationMaxMs = 0;
  const humanDurations: number[] = [];
  const aiDurations: number[] = [];
  let currentPlayer: string | null = null;
  let prevT = 0;
  for (const e of entries) {
    if (e.type === 'turn:start') {
      const d = e.data?.durationMs;
      if (humanId !== null && typeof d === 'number' && currentPlayer !== null) {
        (currentPlayer === humanId ? humanDurations : aiDurations).push(d);
      }
      currentPlayer = typeof e.data?.playerId === 'string' ? e.data.playerId : null;
    } else if (humanId !== null && currentPlayer === humanId) {
      const gap = Math.round(e.t - prevT);
      if (gap >= HESITATION_MS) {
        hesitations++;
        hesitationMaxMs = Math.max(hesitationMaxMs, gap);
      }
    }
    prevT = e.t;
  }
  return { hesitations, hesitationMaxMs, humanDurations, aiDurations };
}

/** Longest run of consecutive draws by any one player — a confirmed turn breaks that player's run. */
function drawStreakMax(entries: PlaylogEntry[]): number {
  const streaks: Record<string, number> = {};
  let max = 0;
  for (const e of entries) {
    const id = e.data?.playerId;
    if (typeof id !== 'string') continue;
    if (e.type === 'turn:drawn') max = Math.max(max, (streaks[id] = (streaks[id] ?? 0) + 1));
    else if (e.type === 'turn:confirmed') streaks[id] = 0;
  }
  return max;
}

/** Undos that followed a drop closely enough to read as "that is not where I wanted it". */
function undoAfterDropCount(entries: PlaylogEntry[]): number {
  let count = 0;
  let lastDropT: number | null = null;
  for (const e of entries) {
    if (e.type === 'drop') lastDropT = e.t;
    else if (e.type === 'undo' && lastDropT !== null && e.t - lastDropT <= UNDO_AFTER_DROP_MS) {
      count++;
      lastDropT = null; // one drop can only be regretted once
    }
  }
  return count;
}

function mean(values: number[]): number {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
}

let entries: PlaylogEntry[] = [];
/** On unless a caller turns it off — `?playlog=0` is read where URL input is owned
 * (`installDebugApi`), so this module needs no browser API but its own timeline clock. */
let enabled = true;
let lastTurnStartT: number | null = null;
/** Which seat the person at the keyboard holds — set by GameScene, never exported or persisted. */
let humanPlayerId: string | null = null;
/** Open invalid-table span: when it started and the reasons it started with (TELEMETRY-07). */
let invalidSinceT: number | null = null;
let invalidReasons = '';
let firstMexeRecorded = false;
let sessionContext: PlaylogSessionContext | null = null;

/** Session-scoped, in-memory ring-buffer play log — dev/e2e instrumentation only, never a network sink. */
export const playlog = {
  record(type: string, data?: Record<string, PlaylogValue>): void {
    if (!enabled) return;
    entries.push({ t: (typeof performance !== 'undefined' ? performance.now() : 0) - base, type, data: sanitize(data) });
    if (entries.length > CAP) entries.shift();
  },

  entries(): PlaylogEntry[] {
    return enabled ? entries.slice() : [];
  },

  clear(): void {
    entries = [];
    lastTurnStartT = null;
    invalidSinceT = null;
    invalidReasons = '';
    firstMexeRecorded = false;
    sessionContext = null;
  },

  /** Saved-progress counts for this browser, passed in by GameScene at match start. Playlog never
   * reads or writes storage itself — it only carries the two numbers into the summary. */
  setSessionContext(context: PlaylogSessionContext): void {
    sessionContext = { gamesStarted: context.gamesStarted, tutorialCompleted: context.tutorialCompleted };
  },

  /** Which seat is the human, so hesitation and AI pacing can be told apart. A GameState player
   * id ("p0"), not a name — nothing identifying, and it never leaves memory. */
  setHumanPlayer(playerId: string | null): void {
    humanPlayerId = playerId;
  },

  /**
   * Called whenever the draft's validity is re-evaluated (TELEMETRY-07). Times how long the table
   * stays unresolved and against which rule reasons; only the transitions are recorded, so calling
   * this on every render costs two comparisons.
   */
  noteTableValidity(ok: boolean, reasons: string[]): void {
    if (ok) {
      playlog.closeInvalidSpan();
    } else if (invalidSinceT === null) {
      invalidSinceT = typeof performance !== 'undefined' ? performance.now() : 0;
      invalidReasons = reasons.join(',');
    }
  },

  /** Ends an open invalid-table span and records it. Also runs at every turn boundary so a turn
   * abandoned with an unresolved table still gets counted. */
  closeInvalidSpan(): void {
    if (invalidSinceT === null) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    const ms = Math.round(now - invalidSinceT);
    invalidSinceT = null;
    playlog.record('table:invalid', { ms, reasons: invalidReasons });
  },

  /** One card drop resolved (TELEMETRY-09). The pointer kind is passed in by the scene that owns
   * the viewport profile, so desktop and touch mis-drop rates can be compared without this module
   * reading anything about the device. */
  recordDrop(outcome: DropOutcome, origin: 'hand' | 'table', pointer: 'coarse' | 'fine'): void {
    playlog.record('drop', { outcome, origin, pointer });
  },

  /** A sample of the board's shape at a turn boundary (TELEMETRY-08, TELEMETRY-15). */
  recordBoard(board: { deckRemaining: number; handSize: number; tableMelds: number; tableCards: number }): void {
    playlog.record('board', board);
  },

  setEnabled(on: boolean): void {
    enabled = on;
  },

  isEnabled(): boolean {
    return enabled;
  },

  /**
   * App-lifetime subscriptions: facts about the *session*, not about any one match. Owned by
   * `main.ts` from boot to page unload, which is exactly this bus's own lifetime. Returns the
   * detach so that ownership is stated rather than assumed (ARCH-007).
   */
  attachAppEvents(bus: EventBus<GameEvents>): () => void {
    // Orientation flips (TELEMETRY-10). Fires only on a real profile change, never per frame.
    return bus.on('viewport:changed', ({ portrait }) => playlog.record('orientation', { portrait }));
  },

  /**
   * Match-lifetime subscription: records the turn lifecycle plus per-turn duration, computed here
   * from consecutive `turn:start` timestamps so the store stays timing-free.
   *
   * Attached to one `LocalMatch` instance and detached with the returned function when that match
   * ends, so a finished match can never record into the next one and a rematch can never be
   * recorded twice (ARCH-007).
   */
  attachMatch(match: { on(fn: (event: MatchEvent) => void): () => void }): () => void {
    return match.on((event) => {
      playlog.closeInvalidSpan();
      if (event.type === 'turn:start') {
        const now = typeof performance !== 'undefined' ? performance.now() : 0;
        const durationMs = lastTurnStartT !== null ? Math.round(now - lastTurnStartT) : undefined;
        lastTurnStartT = now;
        const { playerId, turn } = event;
        playlog.record('turn:start', durationMs !== undefined ? { playerId, turn, durationMs } : { playerId, turn });
      } else if (event.type === 'turn:confirmed') {
        playlog.record('turn:confirmed', { playerId: event.playerId, cardsPlayed: event.cardsPlayed });
        // A confirmed turn is a legal table plus a card from hand — the first one is the moment the
        // player first made the game work (TELEMETRY-11).
        if (!firstMexeRecorded) {
          firstMexeRecorded = true;
          playlog.record('mexe:first', { playerId: event.playerId });
        }
      } else if (event.type === 'turn:drawn') {
        playlog.record('turn:drawn', { playerId: event.playerId });
      } else {
        playlog.record('game:won');
      }
    });
  },

  summary(): PlaylogSummary {
    const durations = entries
      .filter((e) => e.type === 'turn:start' && typeof e.data?.durationMs === 'number')
      .map((e) => e.data!.durationMs as number);
    const stepEntries = entries.filter((e) => e.type === 'tutorial:step' && typeof e.data?.step === 'number');
    const turns = turnMetrics(entries, humanPlayerId);
    const boards = entries.filter((e) => e.type === 'board');
    const boardField = (field: string): number[] =>
      boards.map((e) => e.data?.[field]).filter((v): v is number => typeof v === 'number');
    const firstMexe = entries.find((e) => e.type === 'mexe:first');
    const tutorialStart = entries.find((e) => e.type === 'tutorial:step');
    const deckRemaining = boardField('deckRemaining');
    const tableMelds = boardField('tableMelds');
    const tableCards = boardField('tableCards');
    return {
      totalTurns: entries.filter((e) => e.type === 'turn:start').length,
      invalidFeitoByReason: countBy(entries, 'feito:blocked', 'reasons'),
      drawCount: entries.filter((e) => e.type === 'turn:drawn').length,
      undoCount: entries.filter((e) => e.type === 'undo').length,
      redoCount: entries.filter((e) => e.type === 'redo').length,
      resetCount: entries.filter((e) => e.type === 'reset').length,
      turnDurationMeanMs: mean(durations),
      turnDurationMaxMs: durations.length ? Math.max(...durations) : 0,
      tutorialFurthestStep: stepEntries.length ? Math.max(...stepEntries.map((e) => e.data!.step as number)) : null,
      disconnects: entries.filter((e) => e.type === 'net:disconnect').length,
      reconnects: entries.filter((e) => e.type === 'net:reconnect').length,
      desyncs: entries.filter((e) => e.type === 'desync').length,
      proposalRejectsByReason: countBy(entries, 'net:reject', 'reason'),
      perPlayer: perPlayerStats(entries),
      hesitations: turns.hesitations,
      hesitationMaxMs: turns.hesitationMaxMs,
      tableInvalidTotalMs: entries
        .filter((e) => e.type === 'table:invalid')
        .reduce((sum, e) => sum + (typeof e.data?.ms === 'number' ? e.data.ms : 0), 0),
      tableInvalidByReason: sumBy(entries, 'table:invalid', 'reasons', 'ms'),
      dropsByOutcome: countBy(entries, 'drop', 'outcome'),
      dropsByPointer: countBy(entries, 'drop', 'pointer'),
      undoAfterDropCount: undoAfterDropCount(entries),
      zoomChanges: entries.filter((e) => e.type === 'zoom').length,
      orientationFlips: entries.filter((e) => e.type === 'orientation').length,
      timeToFirstMexeMs: firstMexe ? Math.round(firstMexe.t - (tutorialStart?.t ?? 0)) : null,
      drawStreakMax: drawStreakMax(entries),
      humanTurnDurationMeanMs: mean(turns.humanDurations),
      aiTurnDurationMeanMs: mean(turns.aiDurations),
      session: sessionContext ? { ...sessionContext } : null,
      boardSamples: boards.length,
      handSizeMean: mean(boardField('handSize')),
      deckRemainingMin: deckRemaining.length ? Math.min(...deckRemaining) : null,
      tableMeldsMax: tableMelds.length ? Math.max(...tableMelds) : 0,
      tableCardsMax: tableCards.length ? Math.max(...tableCards) : 0,
    };
  },

  /** Never throws — a serialization failure (e.g. a caller smuggling a circular/BigInt value into
   * `data`) must not break the debug API or the game loop. */
  exportJson(): string {
    try {
      return JSON.stringify({ version: 1, startedAt: null, entries: playlog.entries(), summary: playlog.summary() });
    } catch {
      return JSON.stringify({ version: 1, startedAt: null, entries: [], summary: null });
    }
  },
};
