import type { DraftState, GameState } from '../rules/types';
import { settings } from '../core/settings';
import { playlog, type PlaylogEntry, type PlaylogSummary } from '../core/playlog';
import type { Replay } from '../game-state/replay';
import type { ConnStatus } from '../net/client';
import type {
  PartyState, QueueTarget, ReactionId, RoomListing, RoomPlayerSummary, RoomSettings, RoomVisibility,
  SubmitTurnMeld,
} from '../net/protocol';
import type { HelperMode } from '../ui/helpers';
import { view, type ViewProfile } from '../ui/viewport';

/** One seat row exactly as the lobby PAINTED it on the last rebuild. Recorded at render time by
 * `OnlineScene.renderSeatRow`, so it proves what is on screen rather than what the client was
 * told — the two can disagree, which is the whole class of bug it exists to catch. */
export interface RenderedSeatRow {
  seat: number;
  /** '' for an empty chair. */
  name: string;
  you: boolean;
  host: boolean;
  status: 'empty' | 'waiting' | 'ready' | 'offline';
  wins: number;
}

/** Online-alpha e2e surface — present from OnlineScene entry through the online match, null otherwise. */
interface MexeOnlineDebugApi {
  status: () => ConnStatus;
  code: () => string | null;
  seat: () => number | null;
  /** Verification-only: this client's dense player index inside the running match. Equal to
   * `seat()` unless the room has a seat gap (see GameView.seats). Absent in the lobby. */
  localSeat?: () => number;
  rev: () => number | null;
  /** Verification-only: lobby player list (name/ready/connected) — empty mid-match. */
  players: () => RoomPlayerSummary[];
  /** Verification-only: current in-match connection notice text (opponent disconnected/reconnected,
   * "reconnecting...", etc) — empty string outside a match or when no notice is showing. */
  notice: () => string;
  /** Verification-only: the lobby's current player-facing error text (the localized copy for a
   * server refusal), or empty string when no error is showing. Canvas text, unreadable to
   * Playwright otherwise. */
  errorText: () => string;
  lastRejections: () => string[];
  trace: () => { dir: 'out' | 'in'; type: string }[];
  /** Verification-only: every connection status this client has passed through, newest last.
   * `status()` samples the present; this proves a transient state (notably 'reconnecting')
   * actually happened even if the sample arrives after it ended. See NetClient.statusTrace. */
  statusTrace: () => ConnStatus[];
  createRoom: (name?: string) => void;
  joinRoom: (code: string, name?: string) => void;
  setReady: (ready: boolean) => void;
  startGame: () => void;
  /** Verification-only: host lobby proposal for the room's settings. Goes through the same
   * `set_room_settings` message the UI sends — the server still normalizes and can refuse it. */
  setRoomSettings: (settings: RoomSettings) => void;
  /** Verification-only: the room settings as the server last reported them. */
  roomSettings: () => RoomSettings | null;
  /** Verification-only: open the lobby's custom-timing screen, the way the host's CUSTOM link
   * does. No-op off the lobby, for a non-host, or once the match has locked the settings. */
  openCustomSettings: () => void;
  /** Verification-only: ms left on the active seat's turn as of the last state_sync, or null in
   * a room with no timer. Rendered, never authoritative. */
  turnMsLeft: () => number | null;
  /** Verification-only: where the keyboard focus ring is and how many buttons this screen has.
   * `index` is -1 until the keyboard has been used. Canvas-only UI has no DOM focus to query. */
  focus: () => { index: number; count: number; label: string };
  /** Verification-only: which screen of the online flow is showing (idle/join/lobby/browse/...).
   * Canvas text is unreadable to Playwright, so a screen transition has no other observable. */
  phase: () => string;
  /** Verification-only: the room's visibility as the server last reported it. */
  visibility: () => RoomVisibility;
  /** Verification-only: host-only proposal for the room's visibility. Goes through the same
   * `set_room_visibility` message the badge sends — the server still refuses a non-host. */
  setVisibility: (visibility: RoomVisibility) => void;
  /** Verification-only: enter the casual queue with a player-count preference, the way QUICK
   * MATCH does. The server still owns the entry — this only sends the same `join_queue`. */
  joinQueue: (target: QueueTarget) => void;
  /** Verification-only: leave the queue the way CANCELAR does. */
  cancelQueue: () => void;
  /** Verification-only: what this client believes its queue state is. Rendered from the server's
   * `queue_state` pushes only — the client never infers one. */
  queue: () => { status: string; target: QueueTarget };
  /** Verification-only: open the room browser and ask for a fresh listing. */
  openBrowse: () => void;
  /** Verification-only: the last `room_list` answer, exactly as it came off the wire. */
  listings: () => RoomListing[];
  /** Verification-only: the line the room browser is showing about a card that could not be
   * joined, or null when the list is not answering for anything. */
  browseNotice: () => string | null;
  /** Verification-only: leave the current room the way VOLTAR does, without the scene change —
   * the only way a test can retire a room on demand instead of waiting out the sweep. */
  leaveRoom?: () => void;
  /** Verification-only: this device's local recent-room display history. */
  recentRooms: () => { code: string; host: string }[];
  /** Verification-only: the seat rows the lobby actually rendered, in row order. Empty off the
   * lobby screen. Asserting on this (not on `players()`) is what makes a vanished occupied seat
   * visible to a test. */
  lobbySeats?: () => RenderedSeatRow[];
  /** Verification-only: the lobby's in-place refusal line (not ready / not host / already
   * started), or null when nothing is being explained. */
  lobbyNotice?: () => string | null;
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
  /** Verification-only: the display name this device joins rooms under (lobby only). */
  displayName?: () => string;
  /** Verification-only: send one preset reaction to the room. The server still owns the
   * cooldown, so a call inside it is dropped there, not here. */
  react?: (reaction: ReactionId) => void;
  /** Verification-only: the room's party state (match history + public activity feed) as the
   * server last reported it. Session wins live on `players()`, one per seat. */
  party: () => PartyState;
  /** Verification-only: the match id of the view this client is rendering, or null in a lobby.
   * A rematch mints a new one, which is what proves the room started a *different* match. */
  matchId: () => string | null;
  /** Verification-only: open the lobby's room-history screen, the way its link does. */
  openParty: () => void;
}

/** Results-screen summary (see WinScene) — e2e can assert on it since the win/loss row text and
 * winning-move readback are canvas text, unreadable to Playwright otherwise. Null outside WinScene. */
interface MexeResultsSummary {
  winnerName: string;
  stalemate: boolean;
  /** Localized readback of the final confirmed play (e.g. "X played 2 card(s)"); empty on a stalemate. */
  winningMoveText: string;
  /** i18n key of the single match-story label (see core/results-summary.matchStoryKey), or null
   * when the match had no story worth labelling. */
  storyKey: string | null;
  /** The rendered character reaction line, or '' when no seat has a personality. */
  reactionText: string;
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
interface MexeDebugApi {
  ready: boolean;
  /** Verification-only: true while the rules panel is open. A screenshot that is *named* for a
   * panel has to be able to prove that panel is the one on screen — the capture used to click a
   * hardcoded row that had drifted onto Settings, and photographed Settings for a year. */
  rulesOpen: boolean;
  seed: number;
  scene: string;
  fps: number;
  errors: string[];
  missingAssets: string[];
  validation: { ok: boolean; reasons: string[] } | null;
  /** Verification-only: the live reason line rendered next to FEITO, checklist lines included. */
  reasonLine: string;
  state: (() => GameState | null) | null;
  showcase: string | null;
  /** Verification-only (Phase 16): ?crowd=N — minTableCards passed to buildShowcaseState for the
   * 80+ card crowded-table stress test. Null when the param is absent (default path, unchanged). */
  crowd: number | null;
  /** True while the opening deal is still flying cards to their places. Card sprites are not yet
   * where they will settle, so anything reading a live coordinate (e2e taps, drags) must wait for
   * this to clear. */
  dealing: boolean;
  /** Current interactive-tutorial step index (0-based), or null outside tutorial mode. */
  tutorialStep: number | null;
  /** Explanation text of the most recent AI decision, written by GameScene.runAiTurn. Null before any AI turn. */
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
  /** R1 verification: the three-way status (`legal` / `incomplete` / `illegal`) the board actually
   * PAINTED for each meld on the last render, as classified by `meldStatus()` in src/table/snap.ts.
   * Drag-time status comes from `mexe.snapTargets()`; this is its resting-board counterpart, so a
   * test can assert the two agree for the same meld. Reason STRINGS cannot prove this — a run with
   * a gap reports `reason.runGap` whether it is classified incomplete or illegal; only the status
   * distinguishes gold from red.
   *
   * NOT test-only any more (MOBILE-13): `src/main.ts`'s portrait rotate-hint reads `.length` off
   * this as its "is the table dense" gate — do not remove or restrict this field without updating
   * that call site too. */
  renderedMeldStatus: () => { meldId: string; status: 'legal' | 'incomplete' | 'illegal' }[];
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
    /** Verification-only (MOBILE-15/16): the hand strip's horizontal scroll offset — 0 unless the
     * hand overflows its span (see enableHandScroll in GameScene.ts). */
    handScroll: () => number;
    /** Verification-only (Phase 14 Wave D): current table zoom level — index into ZOOM_FLOORS,
     * 0 is "auto" (today's shrink-to-fit, no zoom applied). */
    zoomLevel: () => number;
    /** Verification-only (Phase 14 Wave D): current vertical pan offset into the zoomed table
     * layout, already clamped to [0, content height - table area height]. */
    panOffset: () => number;
    /** Verification-only (Phase 14 Wave D): the meld id shown in the landscape meld-focus
     * overlay, or null when it's closed. */
    focusedMeldId: () => string | null;
    /** Verification-only (R3/R4 remediation): the meld id cycleProblem() last pointed the
     * non-modal "show problem" ring at, or null. Deliberately separate from focusedMeldId — see
     * GameScene's problemHighlightMeldId doc comment. */
    problemHighlightMeldId: () => string | null;
    /** Verification-only (Phase 14 Wave E): whether a table card sprite currently carries the
     * zoomed-table geometry mask, or null if the card isn't on screen. */
    cardMasked: (cardId: string) => boolean | null;
    /** Verification-only (D4): count of drag-time visual objects still alive (drop-zone shadow,
     * zone highlights, table-boundary outline) — 0 whenever nothing is being actively dragged. A
     * stray non-zero reading with no drag in progress is the orphaned-drag-layer bug (an
     * orientation flip mid-drag used to leave these behind since renderAll's normal sprite
     * teardown never owned them). */
    dragArtifactCount: () => number;
    /** Verification-only (D13): whether the given card's sprite currently accepts pointer input
     * (drag/click) at all — null if it isn't on screen. False during the opening deal (and any
     * other `presentingUntil` hold) while the card is still flying to its place. */
    cardInteractive: (cardId: string) => boolean | null;
  } | null;
  online: MexeOnlineDebugApi | null;
  /** Results-screen summary — see MexeResultsSummary. Null outside WinScene. */
  results: MexeResultsSummary | null;
  /** Verification-only: logical y of WinScene's first action button (layout shifts with the
   * results-summary content above it) — null outside WinScene. Lets e2e click the real button
   * position instead of a coordinate that drifts whenever the summary content changes. */
  winButtonY: number | null;
  /**
   * The deterministic reproduction artifact for the match on screen — seed, start and the ordered
   * actions that were dispatched (`src/game-state/replay.ts`). Attach its JSON to a bug report and
   * run it with `npm run replay run <file>`.
   *
   * Null online, and not because of size: online the local store is a redacted projection whose
   * actions never ran against the authoritative state, so a "replay" of it would be a fiction —
   * and offering one would mean deciding what to do with placeholder opponent cards. The server
   * owns online reproduction, from its own seed.
   */
  replay: () => Replay | null;
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
  rulesOpen: false,
  scene: 'boot',
  fps: 0,
  errors: [],
  missingAssets: [],
  validation: null,
  reasonLine: '',
  state: null,
  showcase: null,
  crowd: null,
  dealing: false,
  tutorialStep: null,
  lastAiThought: null,
  a11y: { invalidBadges: 0 },
  offline: false,
  analyzeCount: 0,
  invalidMeldReasons: () => [],
  renderedMeldStatus: () => [],
  viewport: () => view(),
  music: () => ({ track: '', playing: false, volume: 0, context: 'menu' }),
  mexe: null,
  online: null,
  results: null,
  winButtonY: null,
  replay: () => null,
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
  // URL input is owned here, not by the modules that react to it — `?playlog=0` opts a session
  // out of the in-memory play log.
  playlog.setEnabled(params.get('playlog') !== '0');
  debugApi.showcase = params.get('showcase');
  const crowd = params.get('crowd');
  debugApi.crowd = crowd ? Number(crowd) : null;
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
