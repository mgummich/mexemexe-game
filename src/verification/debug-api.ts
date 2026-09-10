import type { DraftState, GameState } from '../rules/types';
import { settings } from '../core/settings';
import { playlog, type PlaylogEntry, type PlaylogSummary } from '../core/playlog';
import type { ConnStatus } from '../net/client';
import type { RoomPlayerSummary, SubmitTurnMeld } from '../net/protocol';
import type { HelperMode } from '../ui/helpers';
import { view, type ViewProfile } from '../ui/viewport';

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
  /** Verification-only (Phase 15 PWA): current offline state, kept in sync by src/core/pwa.ts. */
  offline: boolean;
  /** Verification-only (Phase 14 perf fix): running count of DraftEditor.analyze() calls this
   * session — used to prove a table pan / editor scroll never re-triggers a legality analysis
   * mid-gesture (it should only grow on an actual content change or renderAll at gesture end). */
  analyzeCount: number;
  /** Verification-only: every reason string currently displayed for each invalid meld (Phase 14
   * Wave B — a meld can carry more than one, e.g. an analysis reason plus reason.duplicateCard). */
  invalidMeldReasons: () => { meldId: string; reasons: string[] }[];
  /** Active layout world + input mode (see src/ui/viewport.ts). Lets e2e map world coordinates
   * onto the canvas without assuming an orientation or a scale factor. */
  viewport: () => ViewProfile;
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
    /** Verification-only: logical canvas position of a rendered card sprite, or null if not on screen. */
    cardPos: (cardId: string) => { x: number; y: number } | null;
    /** Verification-only: logical canvas centre of a meld's drop zone, or null. */
    meldPos: (meldId: string) => { x: number; y: number } | null;
    /** Verification-only: the card the tap/keyboard "select then place" path currently holds, or null. */
    selection: () => string | null;
    /** Verification-only: snap-target readback for the given card — the same model the drag highlights use. */
    snapTargets: (cardId: string) => { meldId: string | null; status: string; reason: string | null }[];
    /** Verification-only (Wave B): current helper mode. */
    helperMode: () => HelperMode;
    /** Verification-only (Wave B): the snap targets currently painted for the selected card —
     * empty when nothing is selected or the mode doesn't highlight (legalDestinationsOnSelect off). */
    selectionTargets: () => { meldId: string | null; status: string; reason: string | null }[];
    /** Verification-only (Phase 14 Wave C): whether the focused Mexe editor (portrait) is open. */
    editorOpen: () => boolean;
    /** Verification-only: open/close the focused editor — a no-op outside a human's own turn. */
    openEditor: () => void;
    closeEditor: () => void;
    /** Verification-only: the meld list row currently focused in the editor's workspace — an
     * existing meld id, null for the "new meld" row, or null when nothing has been focused yet. */
    editorMeldId: () => string | null;
    /** Verification-only: the editor's meld-list vertical scroll offset. */
    editorScroll: () => number;
    /** Verification-only (Phase 14 Wave D): current table zoom level — index into ZOOM_FLOORS,
     * 0 is "auto" (today's shrink-to-fit, no zoom applied). */
    zoomLevel: () => number;
    /** Verification-only (Phase 14 Wave D): current vertical pan offset into the zoomed table
     * layout, already clamped to [0, content height - table area height]. */
    panOffset: () => number;
    /** Verification-only (Phase 14 Wave D): the meld id shown in the landscape meld-focus
     * overlay, or null when it's closed. */
    focusedMeldId: () => string | null;
    /** Verification-only (Phase 14 Wave E): whether a table card sprite currently carries the
     * zoomed-table geometry mask, or null if the card isn't on screen. */
    cardMasked: (cardId: string) => boolean | null;
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
  offline: false,
  analyzeCount: 0,
  invalidMeldReasons: () => [],
  viewport: () => view(),
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
  // e2e hook — ?helper=beginner|standard|expert forces the helper mode before the scene loads,
  // rather than clicking through the settings panel for every capture.
  const helper = params.get('helper');
  if (helper === 'beginner' || helper === 'standard' || helper === 'expert') settings.update({ helperMode: helper });
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
