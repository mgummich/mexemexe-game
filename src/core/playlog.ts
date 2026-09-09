import type { EventBus, GameEvents } from './events';

const CAP = 2000;
/** Player-typed data must never leak into an export — strip these keys wherever a caller passes them. */
const BANNED_KEYS = new Set(['name', 'playerName', 'token', 'sessionToken']);

export type PlaylogValue = string | number | boolean;
export interface PlaylogEntry {
  /** ms since this module was loaded — `performance.now()`, never a wall clock. */
  t: number;
  type: string;
  data?: Record<string, PlaylogValue>;
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
}

const base = typeof performance !== 'undefined' ? performance.now() : 0;

function readInitialEnabled(): boolean {
  try {
    return new URLSearchParams(location.search).get('playlog') !== '0';
  } catch {
    return true;
  }
}

function sanitize(data?: Record<string, PlaylogValue>): Record<string, PlaylogValue> | undefined {
  if (!data) return undefined;
  const out: Record<string, PlaylogValue> = {};
  for (const [k, v] of Object.entries(data)) if (!BANNED_KEYS.has(k)) out[k] = v;
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

let entries: PlaylogEntry[] = [];
let enabled = readInitialEnabled();
let lastTurnStartT: number | null = null;

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
  },

  setEnabled(on: boolean): void {
    enabled = on;
  },

  isEnabled(): boolean {
    return enabled;
  },

  /** Subscribes to the shared bus once (from `main.ts`) to record turn lifecycle events plus
   * per-turn duration, computed here from consecutive `turn:start` timestamps — the store stays
   * timing-free. */
  attachToBus(bus: EventBus<GameEvents>): void {
    bus.on('turn:start', ({ turn }) => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      const durationMs = lastTurnStartT !== null ? Math.round(now - lastTurnStartT) : undefined;
      lastTurnStartT = now;
      playlog.record('turn:start', durationMs !== undefined ? { turn, durationMs } : { turn });
    });
    bus.on('turn:confirmed', ({ cardsPlayed }) => playlog.record('turn:confirmed', { cardsPlayed }));
    bus.on('turn:drawn', () => playlog.record('turn:drawn'));
    bus.on('game:won', () => playlog.record('game:won'));
  },

  summary(): PlaylogSummary {
    const durations = entries
      .filter((e) => e.type === 'turn:start' && typeof e.data?.durationMs === 'number')
      .map((e) => e.data!.durationMs as number);
    const stepEntries = entries.filter((e) => e.type === 'tutorial:step' && typeof e.data?.step === 'number');
    return {
      totalTurns: entries.filter((e) => e.type === 'turn:start').length,
      invalidFeitoByReason: countBy(entries, 'feito:blocked', 'reasons'),
      drawCount: entries.filter((e) => e.type === 'turn:drawn').length,
      undoCount: entries.filter((e) => e.type === 'undo').length,
      redoCount: entries.filter((e) => e.type === 'redo').length,
      resetCount: entries.filter((e) => e.type === 'reset').length,
      turnDurationMeanMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      turnDurationMaxMs: durations.length ? Math.max(...durations) : 0,
      tutorialFurthestStep: stepEntries.length ? Math.max(...stepEntries.map((e) => e.data!.step as number)) : null,
      disconnects: entries.filter((e) => e.type === 'net:disconnect').length,
      reconnects: entries.filter((e) => e.type === 'net:reconnect').length,
      desyncs: entries.filter((e) => e.type === 'desync').length,
      proposalRejectsByReason: countBy(entries, 'net:reject', 'reason'),
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
