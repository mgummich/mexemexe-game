import type { DraftState, GameState } from '../rules/types';
import { settings } from '../core/settings';
import { playlog, type PlaylogEntry, type PlaylogSummary } from '../core/playlog';
import type { ConnStatus } from '../net/client';
import type { RoomPlayerSummary, SubmitTurnMeld } from '../net/protocol';

/** Online-alpha e2e surface — present from OnlineScene entry through the online match, null otherwise. */
export interface MexeOnlineDebugApi {
  status: () => ConnStatus;
  code: () => string | null;
  seat: () => number | null;
  rev: () => number | null;
  /** Verification-only: lobby player list (name/ready/connected) — empty mid-match. */
  players: () => RoomPlayerSummary[];
  /** Verification-only: current in-match connection notice text (opponent disconnected/reconnected,
   * "reconnecting...", etc) — empty string outside a match or when no notice is showing. */
  notice: () => string;
  lastRejections: () => string[];
  trace: () => { dir: 'out' | 'in'; type: string }[];
  createRoom: (name?: string) => void;
  joinRoom: (code: string, name?: string) => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  /** In-match draw-and-end-turn; a thin alias over the same action COMPRAR triggers. */
  comprar: () => void;
  /** Verification-only: submit a proposal straight to the server, bypassing the editor's
   * client-side gate — used by verify:multiplayer to exercise server-side rejection. */
  submitRaw: (rev: number, melds: SubmitTurnMeld[]) => void;
  /** Verification-only: force-close the socket as if the network died, to exercise the
   * disconnect/reconnect path (see NetClient.forceDrop). */
  forceDrop: () => void;
  /** Verification-only: number of server/client state-hash mismatches seen this match. Always 0
   * in a healthy run; non-zero means a desync was detected and a resync was requested. */
  desyncs: () => number;
  /** Verification-only: ask the server for a fresh authoritative snapshot. */
  requestResync: () => void;
}

/** Results-screen summary (see WinScene) — e2e can assert on it since the win/loss row text and
 * winning-move readback are canvas text, unreadable to Playwright otherwise. Null outside WinScene. */
export interface MexeResultsSummary {
  winnerName: string;
  stalemate: boolean;
  /** Localized readback of the final confirmed play (e.g. "X played 2 card(s)"); empty on a stalemate. */
  winningMoveText: string;
  results: {
    name: string;
    cardsLeft: number;
    isWinner: boolean;
    turnsPlayed: number;
    cardsPlayed: number;
    draws: number;
  }[];
}

/** Exposed on window.__MEXE__ for Playwright verification. */
export interface MexeDebugApi {
  ready: boolean;
  seed: number;
  scene: string;
  fps: number;
  errors: string[];
  missingAssets: string[];
  validation: { ok: boolean; reasons: string[] } | null;
  state: (() => GameState | null) | null;
  showcase: string | null;
  /** Current interactive-tutorial step index (0-based), or null outside tutorial mode. */
  tutorialStep: number | null;
  /** Explanation text of the most recent AI decision (`ai:thought`), or null before any AI turn. */
  lastAiThought: string | null;
  /** Accessibility state for e2e: count of meld zones currently showing the invalid (✗) badge. */
  a11y: { invalidBadges: number };
  /** Background-music state for e2e: current track file, whether it is actually playing, and its volume. */
  music: () => { track: string; playing: boolean; volume: number; context: string };
  /** Live Mexe Mode hooks for e2e (bound to the active DraftEditor on human turns). */
  mexe: {
    playHandCard: (cardId: string, meldId: string | null) => boolean;
    moveTableCard: (cardId: string, meldId: string | null) => boolean;
    undo: () => boolean;
    feito: () => boolean;
    comprar: () => void;
    /** Current Mexe Mode draft (melds may be temporarily invalid), for e2e. */
    getDraft: () => DraftState | null;
  } | null;
  online: MexeOnlineDebugApi | null;
  /** Results-screen summary — see MexeResultsSummary. Null outside WinScene. */
  results: MexeResultsSummary | null;
  /** Verification-only: logical y of WinScene's first action button (layout shifts with the
   * results-summary content above it) — null outside WinScene. Lets e2e click the real button
   * position instead of a coordinate that drifts whenever the summary content changes. */
  winButtonY: number | null;
  /** Dev-only playtest instrumentation: session-scoped, in-memory, never a network sink. */
  playlog: {
    entries: () => PlaylogEntry[];
    summary: () => PlaylogSummary;
    exportJson: () => string;
    clear: () => void;
    setEnabled: (on: boolean) => void;
  };
}

declare global {
  interface Window {
    __MEXE__: MexeDebugApi;
  }
}

export const debugApi: MexeDebugApi = {
  ready: false,
  seed: 0,
  scene: 'boot',
  fps: 0,
  errors: [],
  missingAssets: [],
  validation: null,
  state: null,
  showcase: null,
  tutorialStep: null,
  lastAiThought: null,
  a11y: { invalidBadges: 0 },
  music: () => ({ track: '', playing: false, volume: 0, context: 'menu' }),
  mexe: null,
  online: null,
  results: null,
  winButtonY: null,
  playlog: {
    entries: () => playlog.entries(),
    summary: () => playlog.summary(),
    exportJson: () => playlog.exportJson(),
    clear: () => playlog.clear(),
    setEnabled: (on) => playlog.setEnabled(on),
  },
};

export function installDebugApi(): void {
  window.__MEXE__ = debugApi;
  window.addEventListener('error', (e) => {
    debugApi.errors.push(String(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    debugApi.errors.push(`unhandledrejection: ${String(e.reason)}`);
  });
  const params = new URLSearchParams(location.search);
  debugApi.showcase = params.get('showcase');
  const lang = params.get('lang');
  if (lang === 'en' || lang === 'pt') settings.update({ locale: lang });
  // e2e hook mirroring ?lang= — ?textscale=125 flips the large-text setting on for a11y screenshot capture.
  if (params.get('textscale') === '125') settings.update({ largeText: true });
  // e2e hook — ?motion=0 flips reduced motion on for a11y screenshot capture.
  if (params.get('motion') === '0') settings.update({ reducedMotion: true });
}

export function urlSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : Date.now() % 2147483647;
}
