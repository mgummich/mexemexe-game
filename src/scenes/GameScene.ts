import Phaser from 'phaser';
import { aiReasonKeySuffix, AI_SPEED_SCALE, createAi, PERSONALITY_STYLE, type EmoteKey, type Personality } from '../ai/ai';
import { playSfx } from '../audio/sfx';
import { setMusicContext } from '../audio/music';
import { CARD_H, CARD_W } from '../assets/manifest';
import { rankLabel, SUIT_CHAR } from '../assets/fallbacks';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { onAppHidden, onAppVisible } from '../core/lifecycle';
import { haptic } from '../core/haptics';
import { playlog } from '../core/playlog';
import { GameStore } from '../game-state/store';
import { buildShowcaseState } from '../demo/showcase';
import { isComeback, matchIntensity, threatOf } from '../core/intensity';
import { doneChecklist, formatChecklist, objectiveKey, objectivePhase } from '../core/objective';
import { playerStats, summarizeMoveKey } from '../core/results-summary';
import { AVATARS, CARD_BACKS, cosmeticTextureKey, DEFAULT_AVATAR, DEFAULT_CARD_BACK, DEFAULT_TABLE_THEME, TABLE_THEMES } from '../cosmetics';
import { t } from '../localization/i18n';
import { DraftEditor } from '../mexe-mode/draft';
import { readRecentRooms, type ConnStatus, type NetClient } from '../net/client';
import { DEFAULT_QUEUE_TARGET, DEFAULT_ROOM_VISIBILITY, digestOfState, EMPTY_PARTY, stateHash } from '../net/protocol';
import type { ErrorMsg, GameOverMsg, GameView, RoomSettings, SubmitTurnMeld } from '../net/protocol';
import { viewToState } from '../net/viewToState';
import { analyzeMeld, createNewGame, sortMeldCards } from '../rules/rules';
import type { Card, GameState, JokerAssignment, Meld, MeldReason, ReasonCode, RulesConfig } from '../rules/types';
import {
  clampScroll,
  editorZones,
  hitTestMeldListRow,
  meldListContentHeight,
  meldListRows,
  meldListRowY,
  MELD_LIST_ROW_H,
  type MeldListRow,
} from '../table/editor-layout';
import { computeMeldLayout, type MeldLayoutInput } from '../table/layout';
import { computeSnapTargets, meldStatus, snapTargetFor, STATUS_COLOR, type SnapStatus, type SnapTarget } from '../table/snap';
import { invalidMeldDetail, type InvalidDetail } from '../table/invalid-detail';
import { resolveCardTapDestination } from '../table/tap-destination';
import { ZOOM_FLOORS, zoomStepIn, zoomStepOut } from '../table/zoom';
import { buildTutorialState } from '../tutorial/fixture';
import { TutorialDirector, type TutorialAction } from '../tutorial/director';
import { FEEL, feelMs, moveWeight, WEIGHT_BAND, type FeelBand } from '../ui/feel';
import { openPauseMenu } from '../ui/pause-menu';
import { gameRegions, wideReason, type GameRegions } from '../ui/regions';
import { openRulesPanel } from '../ui/rules-panel';
import { view } from '../ui/viewport';
import { coverBackground } from '../ui/menu-layout';
import { CHROME_GOLD, CHROME_GOLD_TEXT, fontStyle, gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi, urlSeed } from '../verification/debug-api';

type SortMode = 'suit' | 'rank';


export interface GameSceneConfig {
  seed: number;
  players: { name: string; isAi: boolean; personality?: Personality }[];
  /** Interactive teach-by-doing tutorial: hand-crafted fixture + step overlay instead of a real deal. */
  tutorial?: boolean;
  /** Present only for an online match — server drives state, this scene never computes it locally. */
  online?: { client: NetClient; view: GameView; seat: number; code: string };
}

/** Config used to (re)launch GameScene in tutorial mode — shared by TutorialScene and the in-scene REPLAY button. */
export function buildTutorialLaunchConfig(): GameSceneConfig {
  return {
    seed: 0,
    players: [
      { name: t('menu.you'), isAi: false },
      { name: 'Dona Cida', isAi: true, personality: 'cida' },
    ],
    tutorial: true,
  };
}

const MELD_PAD = 4;
const CONFIRM_GUARD_MS = 250;
/** Bound on how long onlinePending may lock input: a healthy FEITO/COMPRAR round trip is well
 * under this. If neither state_sync nor proposal_rejected arrives in time (dropped/ignored
 * proposal, no socket close), the lock releases itself and a resync is requested. */
const ONLINE_PENDING_TIMEOUT_MS = 10000;
/** Last seconds of an online turn, where the clock escalates from warning to critical. */
const TURN_CRITICAL_MS = 5000;
/** How long an opponent stays quiet after reacting — see `lastEmoteBySeat`. */
const EMOTE_COOLDOWN_MS = 2500;

/** What one `DraftEditor.analyze()` pass returns — the single legality read a render frame makes. */
type DraftAnalysis = ReturnType<DraftEditor['analyze']>;
/**
 * Ceiling on how many cards move at once. A packed table can hold 80+, and animating all of them
 * both costs frames and tells the player nothing they can follow — past a couple of dozen it is
 * noise. The rest are simply placed, which is where they were going anyway.
 */
const MAX_ANIMATED_CARDS = 24;
/**
 * Narrowest a hand may fan before it scrolls instead. At this spacing the rank and suit corner of
 * every card is still visible, which is the only part that has to be readable to pick one.
 */
const MIN_HAND_GAP = 9;
/** Band at the top and bottom of a zoomed table where holding a dragged card scrolls it. */
const EDGE_PAN_ZONE = 24;
/** Fastest edge-pan step per drag event, in world units. */
const EDGE_PAN_MAX_STEP = 4;
/** How far a dragged card rides above a finger, so the thumb never covers it or its target. */
const FINGER_LIFT_TOUCH = 18;
/** Degrees of lean per world-unit of drag velocity, and the hard cap on it. Readability first. */
const DRAG_TILT_PER_UNIT = 0.5;
const DRAG_TILT_MAX = 6;
/** Squared distance below which a card is considered not to have travelled (repacking jitter). */
const MIN_TRAVEL_SQ = 4;
/** Gap between consecutive cards in the opening deal. Keeps a full 4-player deal under ~2s. */
const DEAL_STAGGER_MS = 22;
/** Quiet for this long on your own turn and the game offers a hint. See `armHesitationHint`. */
const HESITATION_MS = 18_000;
/** MEXE-14/RECOVERY-09: a draft this many edits deep arms Reset instead of firing it immediately —
 * below this, undo/reset are interchangeable enough that a confirm step would only be friction. */
const RESET_CONFIRM_EDITS = 4;
/** How long a confirm-armed Reset stays armed before it quietly disarms again. */
const RESET_ARM_MS = 3000;

/** What each joker in a resolved meld is standing in for, keyed by card id, for the hint badge. */
function jokerLabelsOf(assignments: readonly JokerAssignment[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of assignments) out.set(a.cardId, a.suit ? `${SUIT_CHAR[a.suit]}${rankLabel(a.rank)}` : rankLabel(a.rank));
  return out;
}

/**
 * The same labels resolved from a meld on the table. `resolvable` is the caller's own judgement
 * that this meld is worth asking about (an illegal meld has no role to show); analyzeMeld stays
 * the only thing that ever decides what a joker is standing in for.
 */
function jokerLabelsForMeld(meld: Meld, resolvable: boolean): Map<string, string> {
  if (!resolvable || !meld.cards.some((c) => c.isJoker)) return new Map();
  const analysis = analyzeMeld(meld.cards);
  return analysis.valid ? jokerLabelsOf(analysis.assignments) : new Map();
}

interface MeldZone {
  meldId: string;
  rect: Phaser.Geom.Rectangle;
}

/**
 * One stop in the select-then-place ring. With nothing selected the ring holds every playable
 * card; with a card selected it holds every destination. Drives both the keyboard path (arrows +
 * Enter) and the touch path (the same rects become tappable drop zones), so neither needs a
 * separate model of "where can this card go".
 */
interface FocusTarget {
  kind: 'card' | 'meld' | 'new' | 'hand';
  id?: string;
  rect: Phaser.Geom.Rectangle;
}

export class GameScene extends Phaser.Scene {
  private store!: GameStore;
  private editor: DraftEditor | null = null;
  private config!: GameSceneConfig;
  private personalities: (Personality | null)[] = [];
  private r!: GameRegions;
  /** Every object buildStaticUi() creates, so relayout() can destroy and rebuild the lot on an orientation flip. */
  private staticUi: Phaser.GameObjects.GameObject[] = [];

  private cardSprites: Phaser.GameObjects.Image[] = [];
  private meldZones: MeldZone[] = [];
  /** R1 verification: the status each meld was actually PAINTED with on the last render, filled by
   * whichever table renderer ran (layoutMelds or renderMexeEditor) and exposed via debugApi. */
  private renderedMeldStatus = new Map<string, SnapStatus>();
  private meldGlowRects: { meldId: string; rect: Phaser.GameObjects.Rectangle }[] = [];
  private hud: Phaser.GameObjects.GameObject[] = [];
  private meldTooltip: Phaser.GameObjects.GameObject[] = [];
  private feitoBtn!: PixelButton;
  private comprarBtn!: PixelButton;
  private reasonText!: Phaser.GameObjects.Text;
  private reasonBg!: Phaser.GameObjects.Rectangle;
  private banner!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Rectangle;
  private unsubs: (() => void)[] = [];
  private aiTimer: Phaser.Time.TimerEvent | null = null;
  /** Set on shutdown so an in-flight sliced AI decision never acts on a dead scene. */
  private sceneGone = false;

  // drag feel
  private dragShadow: Phaser.GameObjects.Ellipse | null = null;
  private dragZoneHighlights: {
    meldId: string;
    status: SnapStatus;
    solid: Phaser.GameObjects.Rectangle | null;
    dashed: Phaser.GameObjects.Graphics | null;
  }[] = [];
  private dragTableOutline: Phaser.GameObjects.Graphics | null = null;
  /** Snap targets for the card currently being dragged — computed once on dragstart (Phase 12). */
  private snapTargets: SnapTarget[] = [];
  /** Snap targets for the currently *selected* (tap/keyboard) card — computed once on select/render,
   * never per frame (Phase 14 Wave B). Empty unless helperFlags().legalDestinationsOnSelect is on. */
  private selectionTargets: SnapTarget[] = [];
  /** Non-mutating ghost preview panel shown while hovering a drop zone. */
  private ghostPreview: Phaser.GameObjects.GameObject[] = [];
  /** Which zone the ghost preview currently reflects: undefined = none, '' = empty table area, else a meldId. Lets hover redraw only on actual change, never per pointer-move. */
  private hoverKey: string | undefined = undefined;

  // FEITO accidental-confirm guard
  private validSince: number | null = null;
  private lastValidOk = false;

  /** MEXE-14/RECOVERY-09: this.time.now a Reset tap armed a confirm until, or 0 when unarmed. */
  private resetArmedUntil = 0;

  // tutorial mode
  private tutorialDirector: TutorialDirector | null = null;

  private sortMode: SortMode = 'suit';
  private ambienceSound: (Phaser.Sound.BaseSound & { volume: number }) | null = null;
  private pauseOpen = false;
  /** D12: close() handle for the currently open pause overlay, so relayout() can rebuild it
   * centred on the new world instead of leaving it stranded over a relaid-out board. */
  private pauseMenuClose: (() => void) | null = null;
  /** D12: {locale, largeText, tableTheme} the static UI/board were last built with, so the one
   * settings.onChange subscriber can tell a layout-affecting change from a volume tweak and only
   * pay for a relayout() when the board/HUD would actually look wrong otherwise. */
  private layoutSettingsKey = '';
  private tutorialCompletedRecorded = false;

  // online mode — 0 for every local/AI/tutorial game, the server-assigned seat when online
  private localSeat = 0;
  private online: {
    client: NetClient;
    /** This client's ROOM seat — the stable chair, used for the handoff back into the lobby.
     * Not a player index: see `seats` and `localSeat`. */
    seat: number;
    /** Room seat per player index, from the view. Translates the room seats that arrive on
     * `turn_timeout`/`player_disconnected`/`player_reconnected`/`winningMove` into the dense
     * indices everything in this scene (and in `GameState`) counts by. */
    seats: number[];
    code: string;
    lastRev: number;
    /** Last state_sync's mexeBonusClaimed — the false->true edge is what triggers the notice. */
    mexeBonusClaimed: boolean;
    /** Last state_sync's missedTurns per seat — read by onOnlineTurnTimeout to size the warning
     * and to know whether a timeout is about to hit the room's missedTurnLimit. */
    missedTurns: number[];
    /** The match this scene is rendering. A rematch mints a new one; this scene never sees the
     * change (a new match arrives as a fresh scene start), so it is a constant here. */
    matchId: string;
  } | null = null;
  /** Set in onOnlineTurnTimeout when a timeout is about to push a seat to missedTurnLimit, so the
   * room_closed that follows can show the specific "match ended" copy instead of the generic one. */
  private pendingMissedLimitClose = false;
  /** True from FEITO/COMPRAR submit until state_sync or proposal_rejected — locks all input.
   * Set/cleared only via setOnlinePending() so the timeout timer never drifts from the flag. */
  private onlinePending = false;
  /** Fires ONLINE_PENDING_TIMEOUT_MS after onlinePending goes true; released whenever it goes
   * false first (the normal case). */
  private onlinePendingTimer: Phaser.Time.TimerEvent | null = null;
  /** Count of detected state-hash mismatches this match — surfaced to verify:multiplayer. */
  private onlineDesyncs = 0;
  /** Set while a requested resync is outstanding: input stays locked and the overlay shows. */
  private onlineResyncing = false;
  private lastRejections: string[] = [];
  private onlineStatusDot: Phaser.GameObjects.Arc | null = null;
  private onlineNoticeText: Phaser.GameObjects.Text | null = null;
  private onlineTimerText: Phaser.GameObjects.Text | null = null;
  /** Local wall-clock instant the server's remaining time maps to, re-anchored on every
   * state_sync. Display only — the client counting to zero does nothing; the server decides. */
  private turnDeadlineAt: number | null = null;
  private turnWarnMs = 0;
  /** The room's frozen settings, as the last state_sync reported them. */
  private onlineSettings: RoomSettings | null = null;
  /** Last whole second already ticked, so the warning cue fires once per second, not per frame. */
  private lastTickSecond = -1;
  /** Last status seen by onOnlineStatusChange — only used to detect the reconnecting -> open
   * edge, so a self-reconnect gets the same "you're back" notice the opponent's already gets. */
  private lastOnlineStatus: ConnStatus | null = null;
  /** Wall-clock instant the current drop started, so the reconnect notice can count down the
   * room's reconnect grace — the window the server holds this seat for. 0 when connected. */
  private reconnectStartedAt = 0;
  /** Repaints the reconnect notice once a second while the socket is down. One ticker for the
   * whole scene: a per-component timer is exactly the leak this phase is meant to avoid. */
  private reconnectTicker: Phaser.Time.TimerEvent | null = null;

  // last opponent action: which table cards it touched, plus a one-line summary. A rearranging
  // opponent changes the puzzle's structure, so the new position needs to be readable, not guessed.
  private lastMoveIds = new Set<string>();
  /**
   * What each opponent seat last reacted with, and when. A character who reacts to every single
   * thing stops reading as a character, and the same line twice in a row reads as a bug — so a
   * seat stays quiet for a beat after speaking, and never repeats its previous line back to back.
   */
  private lastEmoteBySeat = new Map<number, { line: string | null; at: number }>();
  /** True only while `create()` is dealing, so the first turn's SUA VEZ waits for the cards. */
  private dealPending = false;
  /** Which seat the last render showed as active, so a handover can be staged rather than swapped. */
  private lastRenderedActiveSeat = -1;
  private hesitationTimer: Phaser.Time.TimerEvent | null = null;
  /** Pending re-render for when the accidental-confirm guard expires — see renderAll. */
  private guardTimer: Phaser.Time.TimerEvent | null = null;
  /** Kept so a refused FEITO can briefly point at Undo — see checkMyWork. */
  private undoBtn?: PixelButton;
  private resetBtn?: PixelButton;
  /** While an opponent's move is still being shown (or the initial deal is still flying in), the
   * board is read-only — see presentAiMove and dealIn/create. An absolute time.now deadline, so it
   * must be reset in create() same as every other field a restart must not inherit. */
  private presentingUntil = 0;
  /** D6: the online turn-clock ticker's handle, so relayout() (buildStaticUi on every
   * viewport:changed) removes the previous one instead of leaking a second 250ms looper. */
  private onlineTimerEvent: Phaser.Time.TimerEvent | null = null;
  /** D16: per-seat handle for the currently on-screen think/emote bubble, so a fast personality
   * (or an `aiSpeed: instant` / reduced-motion match) never stacks a second bubble on the same
   * seat before the first's 900ms timer clears it. */
  private activeEmotes = new Map<number, { objs: Phaser.GameObjects.GameObject[]; timer: Phaser.Time.TimerEvent }>();
  /** Seats whose last card has already been announced, so the moment fires once, not every render. */
  private lastCardAnnounced = new Set<number>();
  /** END-15: seats already given the subtle 2-cards tension cue, so it plays once per entry into
   * `threat`, not every render — mirrors `lastCardAnnounced` one rung down the escalation. */
  private threatAnnounced = new Set<number>();
  /** Horizontal scroll offset of the main hand, for hands too long to fit — see enableHandScroll. */
  private handScroll = 0;
  private hesitationHint: Phaser.GameObjects.Text | null = null;
  private lastMoveText: Phaser.GameObjects.Text | null = null;
  /** Readback of the most recently *confirmed* (meld) turn — read by onWin() to build the
   * results-screen "winning move" line. Cleared on a draw, since a stalemate win has no meld play
   * to describe. Set right before store.confirmTurn(), since game:won fires synchronously inside it. */
  private lastConfirmedMoveText: string | null = null;
  /** Reason tag of the move the AI just made (`ai.why.*` suffix), or null when the last move was
   * a person's. Drives the `aiExplain` setting — a human opponent's move is never suppressed. */
  private lastAiReason: string | null = null;

  // select-then-place — the drag-free way to play (keyboard and touch both route through it)
  private selectedCardId: string | null = null;
  private focusIndex = 0;
  private focusTargets: FocusTarget[] = [];
  /** Focus ring is drawn only once the keyboard has been used, so mouse players never see it. */
  private focusVisible = false;

  // focused Mexe editor (Phase 14 Wave C — portrait only)
  /** Open/closed toggle. Never discards draft state — the draft lives in DraftEditor regardless. */
  private mexeEditorOpen = false;
  /** Which meld-list row is the workspace's subject: an existing meld id, null for the "new meld"
   * row, or undefined when nothing has been focused yet this turn. */
  private mexeEditorMeldId: string | null | undefined = undefined;
  private mexeEditorScroll = 0;
  /** Hand-strip horizontal scroll offset — separate axis/field from the meld list's. */
  private mexeHandScroll = 0;
  /** Absent in tutorial mode — the step panel owns that column (see buildStaticUi). */
  private mexeToggleBtn?: PixelButton;

  // table zoom/pan (Phase 14 Wave D — crowded table legibility)
  /** Index into ZOOM_FLOORS; 0 is "auto", today's shrink-to-fit computeMeldLayout call. */
  private zoomLevel = 0;
  /** Vertical scroll into the (possibly taller-than-the-table-area) zoomed layout, clamped every
   * render to [0, content height - tableAreaH] — never lets zoomed content drift off-screen. */
  private tablePan = 0;
  /** Real content height of the last layoutMelds() pass, used to clamp tablePan. */
  private tableContentH = 0;
  private zoomInBtn!: PixelButton;
  private zoomOutBtn!: PixelButton;
  /** Meld focus view (Phase 14 Wave C landscape counterpart — see layoutMelds): id of the meld
   * currently shown large in the read-only overlay, or null when closed. Only ever set by the
   * explicit 🔍 icon (layoutMelds) — kept separate from `problemHighlightMeldId` (R3/R4) so
   * cycleProblem's "show next problem" ping never opens this modal on top of the FEITO button it
   * was tapped from. */
  private focusedMeldId: string | null = null;
  /** R3/R4: which meld cycleProblem() last pointed at — a static (reduced-motion-safe), non-modal
   * ring layoutMelds draws, distinct in both colour and shape from `focusedMeldId`'s full-screen
   * modal and from the gold dashed "incomplete" meld outline. Cleared once that meld stops being
   * invalid, so a fixed meld never keeps wearing a stale "look here" ring. */
  private problemHighlightMeldId: string | null = null;
  /** Geometry mask clipping zoomed/panned table content to the table area — recreated each
   * layoutMelds() pass (only while zoomed; at the default zoom nothing is masked, so today's
   * landscape rendering is untouched), destroyed at the top of the next renderAll(). */
  private tableMaskGfx: Phaser.GameObjects.Graphics | null = null;
  /** Holds every masked table object as one Container so the mask is applied once, not per
   * object (CI perf fix: a crowded zoomed table used to setMask() hundreds of separate sprites,
   * each forcing its own stencil pass — ~2.3x slower than the same table unmasked on a software
   * renderer, enough to drop a CI run under the fps floor). Positioned at (0,0) with no scale, so
   * every child keeps the exact same world coordinates layoutMelds() already computed for it —
   * meldZones/hit-tests never had to change. Destroyed and recreated each layoutMelds() pass. */
  private tableContainer: Phaser.GameObjects.Container | null = null;
  /** Pan-drag anchor (world Y + tablePan at pointerdown). Every pan tick calls renderAll(), which
   * destroys and recreates the pan surface (and would reset a same-pass local closure) — these
   * must survive across that recreation for the whole gesture, hence instance fields, not locals. */
  private panDragStartY = 0;
  private panDragStartPan = 0;
  /** Objects whose y depends on tablePan (every masked table object layoutMelds() draws) — a pan
   * tick shifts these directly instead of re-running renderAll()/analyze() per pointermove (see
   * finding 1, Phase 14 review): nothing about the draft changes while panning, so nothing needs
   * re-analyzing mid-gesture. Repopulated every layoutMelds() pass; the full renderAll() still runs
   * once on pointerup to settle everything (clamping, meldZones, etc.) authoritatively. */
  private tablePanTargets: Array<Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform> = [];
  /** Same idea as tablePanTargets, for the portrait Mexe editor's meld-list vertical scroll. */
  private mexeListPanTargets: Array<Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform> = [];
  /** Same idea, for the portrait Mexe editor's hand-strip horizontal scroll. */
  private mexeHandPanTargets: Array<Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform> = [];

  /**
   * Everything a reused scene instance must not inherit from the match before it.
   *
   * Phaser keeps ONE GameScene instance for the whole page load and calls create() again on every
   * `scene.start`, so a field initializer runs once per page — not once per match. Any field whose
   * initial value matters is reset here, and this is the only place that does it, so the list can
   * be read against the declarations above. Shipped bugs from getting this wrong include a dead
   * board on every second match (`sceneGone`) and silent last-card/threat moments (the announce
   * latches below, which had never been cleared at all).
   *
   * Deliberately NOT reset: `sortMode`, the player's hand-sort choice, which is a preference and
   * survives for the session.
   */
  private resetForNewMatch(): void {
    this.sceneGone = false;
    this.hoverKey = undefined;
    this.validSince = null;
    this.lastValidOk = false;
    this.resetArmedUntil = 0;
    this.pauseOpen = false;
    this.pauseMenuClose = null;
    this.tutorialCompletedRecorded = false;

    // online
    // A player index into `GameState.players`, never a room seat — the two differ whenever the
    // room has a seat gap (see GameView.seats).
    this.localSeat = this.config.online ? this.config.online.view.seat : 0;
    this.pendingMissedLimitClose = false;
    this.setOnlinePending(false);
    this.onlineDesyncs = 0;
    this.onlineResyncing = false;
    this.lastRejections = [];
    this.lastTickSecond = -1;
    this.lastOnlineStatus = null;
    this.onlineTimerEvent = null;
    this.reconnectStartedAt = 0;
    this.reconnectTicker = null;

    // opponent presentation
    this.lastMoveIds = new Set();
    this.lastEmoteBySeat.clear();
    this.lastRenderedActiveSeat = -1;
    this.lastConfirmedMoveText = null;
    this.lastAiReason = null;
    for (const e of this.activeEmotes.values()) e.timer.remove();
    this.activeEmotes.clear();
    this.lastCardAnnounced.clear();
    this.threatAnnounced.clear();
    // An absolute this.time.now deadline: always long expired by the next match in practice, but
    // "in practice" is not an invariant.
    this.presentingUntil = 0;
    this.guardTimer = null;

    // selection, focus and the portrait Mexe editor
    this.selectedCardId = null;
    this.focusIndex = 0;
    this.focusVisible = false;
    this.mexeEditorOpen = false;
    this.mexeEditorMeldId = undefined;
    this.mexeEditorScroll = 0;
    this.mexeHandScroll = 0;
    this.handScroll = 0;

    // table view
    this.renderedMeldStatus.clear();
    this.problemHighlightMeldId = null;
    this.resetZoomPan();
  }

  constructor() {
    super('game');
  }

  /** Multiplies cosmetic tween durations; 0 (instant) when reduced motion is on. */
  private motion(ms: number): number {
    return ms * settings.motionScale();
  }

  create(config: GameSceneConfig): void {
    this.config = config;
    this.online = config.online
      ? {
          client: config.online.client,
          seat: config.online.seat,
          seats: config.online.view.seats,
          code: config.online.code,
          lastRev: config.online.view.rev,
          matchId: config.online.view.matchId,
          mexeBonusClaimed: config.online.view.mexeBonusClaimed,
          missedTurns: config.online.view.missedTurns,
        }
      : null;
    this.resetForNewMatch();
    debugApi.scene = config.tutorial ? 'tutorial' : 'game';
    debugApi.seed = config.seed;
    if (!config.tutorial && !config.online) {
      settings.setLastSeed(config.seed);
      settings.noteGameStarted();
      // A reused scene instance carries the previous match's confirms/draws/cardsPlayed
      // (player ids are always p0/p1) — start each local match with a clean log so the results
      // panel and matchStoryKey read this match's numbers, not the sum of both.
      playlog.clear();
      // Which game this is for this browser, so the playtest log can tell a first match from a
      // rematch. Two counts, no identifier — read after noteGameStarted so this match is included.
      playlog.setSessionContext({
        gamesStarted: settings.progress().gamesStarted,
        tutorialCompleted: settings.progress().tutorialCompleted,
      });
    }

    if (config.online) {
      // Online: never construct AI seats. State comes from the server's redacted view only —
      // see src/net/viewToState.ts for why opponent hand/draw-pile are placeholders here.
      this.personalities = [];
      this.store = new GameStore(viewToState(config.online.view));
      // Anchor the clock off the view the match started with — waiting for the next state_sync
      // would leave the first turn showing nothing.
      this.onlineSettings = config.online.view.settings;
      this.turnWarnMs = config.online.view.settings.warnMs;
      this.turnDeadlineAt = config.online.view.turnMsLeft === null ? null : Date.now() + config.online.view.turnMsLeft;
    } else {
      this.personalities = config.players.map((p) => (p.isAi ? (p.personality ?? 'juninho') : null));
      const playerCfgs = config.players.map((p) => ({
        name: p.name,
        isAi: p.isAi,
        aiType: (p.personality === 'bia' || p.personality === 'ze' ? 'rearranger' : 'simple') as 'simple' | 'rearranger',
      }));
      const state = config.tutorial
        ? buildTutorialState()
        : debugApi.showcase === 'mexe'
          ? buildShowcaseState(config.seed, playerCfgs, debugApi.crowd ?? undefined)
          : createNewGame(config.seed, playerCfgs);
      this.store = new GameStore(state);
    }
    debugApi.state = () => this.store.get();
    this.tutorialDirector = config.tutorial ? new TutorialDirector() : null;
    debugApi.tutorialStep = this.tutorialDirector?.stepIndex ?? null;

    this.r = this.regionsForMode();

    // D5: the background/dim/top-bar/landscape-dressing chrome used to be built once here in
    // create() and never touched again — relayout() (buildStaticUi + renderAll on every
    // viewport:changed) had no handle on it, so a rotation left a cover-fit background sized for
    // the wrong world, a dim rect centred on the old world's midpoint, and landscape-only felt
    // dressing stranded in portrait. It now lives in buildStaticUi() itself, tracked in staticUi
    // like every other piece of chrome, so a flip destroys and rebuilds it same as the buttons.
    this.buildStaticUi();
    this.startAmbience();
    this.layoutSettingsKey = this.layoutKey();
    this.unsubs.push(
      bus.on('game:won', () => this.onWin()),
      bus.on('turn:start', () => this.onTurnStart()),
      settings.onChange(() => {
        if (this.ambienceSound) this.ambienceSound.volume = settings.musicVolume();
        // D12: large text, language and table theme are all read once at build time (regionsForMode
        // sizing, buildStaticUi's t()-built captions, the cover-fit background) and never applied
        // mid-match before this — the settings panel showed the new value while the board quietly
        // kept the old scale/locale/felt until some unrelated action happened to trigger a relayout.
        // relayout() already rebuilds all of that from current settings; only pay for it when one of
        // those three actually changed, not on every sfx/volume tweak this same handler also fires for.
        const key = this.layoutKey();
        if (key !== this.layoutSettingsKey) {
          this.layoutSettingsKey = key;
          this.relayout();
        }
      }),
      bus.on('viewport:changed', () => this.relayout()),
      // App sleep/resume (phone lock, tab switch, app switch): a stranded mid-drag card or a
      // stale selection must never survive to the resumed session, and a single relayout on
      // resume covers whatever changed (orientation, safe-area insets) while backgrounded.
      onAppHidden(() => {
        this.cancelActiveDrag();
        this.clearSelection();
      }),
      onAppVisible(() => {
        this.relayout();
        // Mobile browsers throttle/suspend sockets and timers while hidden — the C1 reconnect
        // timer may never have fired, or the connection may look open but be dead. Reuse the
        // existing reconnecting/resync path rather than inventing a new one: nudge a fresh state
        // if the socket claims to still be open, or kick the existing connect()/reconnect flow
        // (which drives onOnlineStatusChange's own notice text) if it isn't.
        if (this.online) {
          const status = this.online.client.getStatus();
          if (status === 'open') this.online.client.requestResync();
          // Already mid-loop: pull the next attempt forward rather than opening a second socket
          // beside the one the loop owns. retryNow() still spends an attempt, so repeated
          // background/resume cycles cannot make the bounded loop unbounded.
          else if (status === 'reconnecting') this.online.client.retryNow();
          else this.online.client.connect();
        }
      }),
    );
    if (config.online) this.wireOnline(config.online.client);
    // Phaser's drag plugin has no pointercancel handling (only pointerup/pointerupoutside), so a
    // pointer the OS steals mid-drag (system gesture, notification) never fires either and leaves
    // a card stranded with dragging=true. The browser does emit pointercancel — listen for it
    // directly on the canvas and restore the card exactly like an out-of-bounds drop would.
    const cancelDragOnPointerCancel = () => this.cancelActiveDrag();
    this.game.canvas.addEventListener('pointercancel', cancelDragOnPointerCancel);
    this.events.once('shutdown', () => {
      this.sceneGone = true;
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.aiTimer?.remove();
      this.onlinePendingTimer?.remove();
      this.onlineTimerEvent?.remove();
      this.reconnectTicker?.remove();
      for (const e of this.activeEmotes.values()) e.timer.remove();
      this.activeEmotes.clear();
      this.ambienceSound?.stop();
      this.resetZoomPan();
      this.game.canvas.removeEventListener('pointercancel', cancelDragOnPointerCancel);
      this.cancelActiveDrag();
      this.clearHesitationHint();
      this.guardTimer?.remove();
      playlog.setHumanPlayer(null);
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.selectedCardId !== null) {
        this.clearSelection();
        return;
      }
      this.togglePause();
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.handleShortcut(e));

    // The playtest log splits human from AI turns, which it cannot do until it knows which seat
    // is the player. It stores the seat's game-scoped id only — never a name.
    playlog.setHumanPlayer(this.store.get().players[this.localSeat]?.id ?? null);
    setMusicContext('game');
    playSfx(this, 'sfx-deal');
    this.dealPending = true;
    // D13: onTurnStart() below (which builds the DraftEditor and renders the hand as draggable,
    // if this is the human's turn) runs before dealIn() even exists to report how long the deal's
    // flight animation takes — the exact duration used to only become known, and only get applied
    // to `interactive`, after that first render had already made every hand card draggable and
    // COMPRAR live mid-tween. A conservative upper bound (worst case ~380ms flight + 24 cards *
    // 22ms stagger ~= 900ms, see dealIn/MAX_ANIMATED_CARDS/DEAL_STAGGER_MS) gates that first render
    // correctly; it is corrected to the real duration a few lines down, all inside the same
    // synchronous tick, so no input can land in between.
    this.presentingUntil = this.time.now + 1000;
    this.onTurnStart();
    const dealMs = this.dealIn();
    this.dealPending = false;
    // The deal and SUA VEZ are two separate beats: landing them together reads as noise, so the
    // turn announcement waits for the cards to arrive. Reduced motion collapses this to nothing,
    // because dealIn() then has no flight time to wait for (dealMs === 0 here expires the gate
    // immediately, same as the announcement).
    this.presentingUntil = this.time.now + dealMs;
    const dealUntil = this.presentingUntil;
    debugApi.dealing = dealMs > 0;
    if (dealMs > 0) {
      this.time.delayedCall(dealMs, () => {
        this.announceTurn();
        debugApi.dealing = false;
        // Cards were built non-interactive for the flight above — re-render once it actually lands
        // so a still-human turn picks up dragging/COMPRAR now that presentingUntil has passed.
        this.endPresentation(dealUntil);
        if (!this.sceneGone && this.store.get().phase === 'playing') this.renderAll();
      });
    }
    debugApi.ready = true;
  }

  /** Room seat -> dense player index. Falls back to the identity mapping, which is what a room
   * with no seat gap has anyway. */
  private playerIndexOf(roomSeat: number): number {
    const i = this.online?.seats.indexOf(roomSeat) ?? -1;
    return i === -1 ? roomSeat : i;
  }

  /** Socket wiring + debug-api surface for an online match. Never runs offline. */
  private wireOnline(client: NetClient): void {
    this.unsubs.push(
      client.on('state_sync', (msg) => this.onOnlineStateSync(msg.view)),
      client.on('proposal_rejected', (msg) => this.onOnlineRejected(msg.reasons)),
      client.on('game_over', (msg) => this.onOnlineGameOver(msg)),
      // Room seats on the wire, player indices in this scene — translated once, here.
      client.on('turn_timeout', (msg) => this.onOnlineTurnTimeout(this.playerIndexOf(msg.seat))),
      client.on('player_disconnected', (msg) => this.onOnlineOpponentEvent(this.playerIndexOf(msg.seat), true)),
      client.on('player_reconnected', (msg) => this.onOnlineOpponentEvent(this.playerIndexOf(msg.seat), false)),
      client.on('error', (msg) => this.onOnlineTerminalError(msg)),
      client.onStatus((s) => this.onOnlineStatusChange(s)),
    );
    debugApi.online = {
      status: () => client.getStatus(),
      code: () => this.online?.code ?? null,
      seat: () => this.online?.seat ?? null,
      localSeat: () => this.localSeat,
      rev: () => this.online?.lastRev ?? null,
      players: () => [],
      notice: () => this.onlineNoticeText?.text ?? '',
      // No lobby error screen exists mid-match — a refusal here surfaces as the notice above.
      errorText: () => '',
      lastRejections: () => this.lastRejections,
      trace: () => client.trace,
      statusTrace: () => client.statusTrace,
      createRoom: () => { /* not applicable mid-match */ },
      joinRoom: () => { /* not applicable mid-match */ },
      setReady: () => { /* not applicable mid-match */ },
      startGame: () => { /* not applicable mid-match */ },
      setRoomSettings: () => { /* fairness settings are frozen once the match starts */ },
      roomSettings: () => this.onlineSettings,
      // The party state rides on room_state, which a match does not receive — the client's latched
      // copy from the lobby is the right answer here, not a stale empty one.
      party: () => client.lastRoomState?.party ?? EMPTY_PARTY,
      matchId: () => this.online?.matchId ?? null,
      openParty: () => { /* the lobby owns the history screen; there is none mid-match */ },
      openCustomSettings: () => { /* the lobby owns the settings screen; there is none mid-match */ },
      turnMsLeft: () => (this.turnDeadlineAt === null ? null : Math.max(0, this.turnDeadlineAt - Date.now())),
      phase: () => 'match',
      focus: () => ({ index: -1, count: 0, label: '' }),
      // Discovery belongs to the lobby: a running match is neither listed nor browsable, and its
      // visibility is frozen with the rest of the room's terms.
      visibility: () => client.lastRoomState?.visibility ?? DEFAULT_ROOM_VISIBILITY,
      setVisibility: () => { /* visibility is frozen once the match starts */ },
      openBrowse: () => { /* the lobby owns the room browser; there is none mid-match */ },
      // Matchmaking ends at the handoff: a seated player is refused by the server anyway (OM-04),
      // so the mid-match surface does not offer a way to ask.
      joinQueue: () => { /* not applicable mid-match */ },
      cancelQueue: () => { /* not applicable mid-match */ },
      queue: () => ({ status: 'idle', target: DEFAULT_QUEUE_TARGET }),
      listings: () => [],
      browseNotice: () => null,
      recentRooms: () => readRecentRooms().map((r) => ({ code: r.code, host: r.host })),
      comprar: () => this.onComprar(),
      /** Verification-only: submit a raw (possibly illegal) proposal straight to the server,
       * bypassing the editor's client-side gate — the UI itself never constructs an illegal
       * draft, so this is the only way for `verify:multiplayer` to exercise server-side rejection. */
      submitRaw: (rev, melds) => client.submitTurn(rev, melds),
      forceDrop: () => client.forceDrop(),
      desyncs: () => this.onlineDesyncs,
      requestResync: () => client.requestResync(),
    };
    this.onOnlineStatusChange(client.getStatus());
  }

  // ---------- online reconciliation (docs/MULTIPLAYER.md §6) ----------

  /** Single set/clear point for onlinePending — keeps the timeout timer in lockstep with the
   * flag instead of letting scattered raw assignments each need their own timer bookkeeping. */
  private setOnlinePending(on: boolean): void {
    this.onlinePending = on;
    this.onlinePendingTimer?.remove();
    this.onlinePendingTimer = on ? this.time.delayedCall(ONLINE_PENDING_TIMEOUT_MS, () => this.onOnlinePendingTimeout()) : null;
  }

  /** No state_sync or proposal_rejected arrived in time — the proposal was dropped or ignored
   * with no socket close, so nothing else would ever release the lock. Release it, tell the
   * player, and ask for a fresh authoritative snapshot rather than leaving a dead board. */
  private onOnlinePendingTimeout(): void {
    this.setOnlinePending(false);
    this.setOnlineNotice(t('online.resyncing'));
    this.online?.client.requestResync();
    // The lock is read at render time, and the message that would normally trigger the next
    // render is the one that never came — so re-render here or the board stays visibly dead.
    this.renderAll();
  }

  private onOnlineStateSync(view: GameView): void {
    if (!this.online) return;
    if (view.rev < this.online.lastRev) return; // stale/out-of-order delivery — ignore
    this.online.lastRev = view.rev;
    this.setOnlinePending(false);
    this.setOnlineNotice('');
    const before = this.store.get();
    const actingSeat = before.activePlayerIndex;
    this.store = new GameStore(viewToState(view));
    this.lastAiReason = null; // every online seat is a person
    this.turnDeadlineAt = view.turnMsLeft === null ? null : Date.now() + view.turnMsLeft;
    this.onlineSettings = view.settings;
    this.turnWarnMs = view.settings.warnMs;
    this.lastTickSecond = -1;
    if (actingSeat === this.localSeat) this.clearLastMove();
    else this.noteOpponentMove(before, this.store.get(), actingSeat);
    debugApi.state = () => this.store.get();
    // historyLength() starts at 1 (the DraftEditor constructor snapshots the turn's starting
    // position before any edit) — see onReset's `historyLength() - 1` for the same convention.
    // Bug found alongside ONLINE-09: comparing against 0 here meant a state_sync mid-own-turn
    // with zero edits (which is exactly what a Mexe bonus claim's broadcast now causes) always
    // read as a dropped draft.
    const hadDraft = (this.editor?.historyLength() ?? 0) > 1;
    this.editor = null;
    // ONLINE-09: the server flips mexeBonusClaimed false->true the instant a Mexe grants the
    // once-per-turn time extension. A dropped draft takes priority — it is the rarer, more
    // disruptive event for the player who just lost work.
    const bonusJustClaimed = view.mexeBonusClaimed && !this.online.mexeBonusClaimed;
    this.online.mexeBonusClaimed = view.mexeBonusClaimed;
    this.online.missedTurns = view.missedTurns;
    this.online.seats = view.seats;
    if (hadDraft) this.setOnlineNotice(t('online.draftDropped'));
    else if (bonusJustClaimed) {
      this.setOnlineNotice(t('online.mexeBonusGranted', { s: Math.round(view.settings.mexeBonusMs / 1000) }));
      this.time.delayedCall(4000, () => this.setOnlineNotice(''));
    }
    if (!this.verifyOnlineHash(view)) return;
    this.onlineResyncing = false;
    if (this.store.get().phase === 'playing') this.onTurnStart();
  }

  /** Compare the server's digest against one recomputed from the local reconstruction. A mismatch
   * means this client can no longer be trusted to render or propose, so it locks input and asks
   * for a fresh authoritative snapshot instead of continuing from a bad state. Returns false when
   * a resync was requested. */
  private verifyOnlineHash(view: GameView): boolean {
    if (!this.online) return false;
    const local = stateHash(digestOfState(this.store.get(), view.rev));
    if (local === view.hash) return true;
    this.onlineDesyncs++;
    console.warn(`state desync at rev ${view.rev}: local ${local} != server ${view.hash}`);
    playlog.record('desync', { rev: view.rev });
    if (this.onlineResyncing) return true; // already asked once for this snapshot — take it and move on
    this.onlineResyncing = true;
    this.setOnlinePending(true);
    this.setOnlineNotice(t('online.resyncing'));
    this.online.client.requestResync();
    return false;
  }

  private onOnlineRejected(reasons: ReasonCode[]): void {
    if (!this.online) return;
    this.setOnlinePending(false);
    this.lastRejections = reasons;
    playSfx(this, 'sfx-invalid');
    // A stale revision means this client acted on a state the server has already moved past —
    // the local view is behind, so pull the authoritative one rather than letting the player
    // retry against stale cards.
    if (reasons.includes('reason.staleRevision')) this.online.client.requestResync();
    // Discard the draft entirely and rebuild from the last synced (committed) state — never a
    // half-applied draft survives a rejection.
    const state = this.store.get();
    this.editor = state.activePlayerIndex === this.localSeat ? new DraftEditor(state) : null;
    this.renderAll();
    this.reasonText.setText(reasons[0] ? t(reasons[0]) : '');
  }

  private onOnlineGameOver(msg: GameOverMsg): void {
    if (!this.online) return;
    this.store = new GameStore(viewToState(msg.view));
    const state = this.store.get();
    const winner = state.players.find((p) => p.id === msg.winnerId) ?? null;
    playSfx(this, 'sfx-win');
    // Online turns are server-driven and never write to the local playlog, so reading
    // playlog.summary() here was never actually observing this match — only whatever a PRIOR
    // local match (same page load, same p0/p1 ids) happened to leave behind, which
    // matchStoryKey/WinScene would then read as this match's confirms/draws/cardsPlayed. An
    // online result has no local counters to report, ever — say so directly instead of reading a
    // log this match can't have written to.
    const results = state.players.map((p, i) => ({
      name: p.name,
      cardsLeft: p.hand.length,
      isWinner: p.id === msg.winnerId,
      avatarKey: this.avatarKey(i),
      turnsPlayed: 0,
      cardsPlayed: 0,
      draws: 0,
    }));
    const client = this.online.client;
    const { code, seat } = this.online;
    // The room survives a finished match now, so the results screen needs the way back into it.
    // The winning move is named in public terms the server already publishes — how many cards the
    // winner put down — never the cards themselves.
    const mover = msg.winningMove ? state.players[this.playerIndexOf(msg.winningMove.seat)] : undefined;
    const winningMoveText = mover && msg.winningMove
      ? t('game.lastMove.played', { name: mover.name, n: msg.winningMove.cardsPlayed })
      : '';
    this.time.delayedCall(400, () => {
      gotoScene(this, 'win', {
        winnerName: winner?.name ?? '',
        stalemate: msg.stalemate,
        config: this.config,
        online: { client, code, seat },
        results,
        winningMoveText,
        finalTable: state.table,
      });
    });
  }

  /** Terminal server error mid-match: room reaped/opponent gone for good (S1/S2), or the C1
   * reconnect attempt was refused (`invalid_token` — the grace window expired server-side).
   * Either way: a clear localized notice, then back to the menu — never a silent scene switch. */
  private onOnlineTerminalError(msg: ErrorMsg): void {
    if (!this.online || (msg.code !== 'room_closed' && msg.code !== 'invalid_token')) return;
    const missedLimitClose = msg.code === 'room_closed' && this.pendingMissedLimitClose;
    this.pendingMissedLimitClose = false;
    this.setOnlineNotice(
      missedLimitClose
        ? t('online.timeout.missedLimit')
        : msg.code === 'room_closed'
          ? t('online.roomClosed')
          : t('online.connectionLost'),
    );
    this.leaveOnlineToMenu(2000);
  }

  private onOnlineOpponentEvent(seat: number, disconnected: boolean): void {
    if (!this.online || seat === this.localSeat || !this.onlineNoticeText) return;
    // At three and four players "an opponent" is not enough to act on — say who, so the remaining
    // players know whose clock they are waiting on. Falls back to the anonymous copy if the seat
    // has no name yet (a very early drop).
    const name = this.store.get().players[seat]?.name;
    this.setOnlineNotice(
      name
        ? t(disconnected ? 'online.playerDisconnected' : 'online.playerReconnected', { name })
        : t(disconnected ? 'online.opponentDisconnected' : 'online.opponentReconnected'),
    );
    if (!disconnected) this.time.delayedCall(3000, () => this.setOnlineNotice(''));
  }

  /** Corner connection dot +, on an unexpected close, one C1 reconnect attempt ("reconnecting..."),
   * then — only if that attempt also fails — the non-modal notice and a return to the menu. */
  private onOnlineStatusChange(status: ConnStatus): void {
    if (!this.onlineStatusDot) return;
    const color =
      status === 'open' ? 0x3ec06a : status === 'connecting' || status === 'reconnecting' ? 0xf7d23e : 0xd83a3a;
    this.onlineStatusDot.setFillStyle(color);
    // D14: `interactive` (renderAll) reads lastOnlineStatus, but nothing else re-renders on a
    // status change — without this, a drop mid-turn left every control exactly as interactive as
    // it was the instant before the socket died, until some unrelated event happened to redraw.
    // Read and write lastOnlineStatus up front so every branch below sees the NEW status and the
    // re-render (once connectedness actually flips) reads it too, not the stale value.
    const wasConnected = this.lastOnlineStatus === null || this.lastOnlineStatus === 'open';
    const nowConnected = status === 'open';
    const prevStatus = this.lastOnlineStatus;
    this.lastOnlineStatus = status;
    if (wasConnected !== nowConnected && this.store.get().phase === 'playing') this.renderAll();
    if (status === 'reconnecting') {
      // Only the first 'reconnecting' of a drop starts the clock — the bounded retry loop passes
      // through this status once per attempt, and restarting the countdown on each would make the
      // held-seat window look infinite.
      if (prevStatus !== 'reconnecting') {
        this.reconnectStartedAt = Date.now();
        playSfx(this, 'sfx-invalid', 0.3);
      }
      this.startReconnectTicker();
      return;
    }
    this.stopReconnectTicker();
    // Only the opponent's reconnect is announced elsewhere (onOnlineOpponentEvent) — this own
    // socket coming back from a reconnect attempt was silent, leaving the player to guess
    // whether they're actually back in the room.
    if (status === 'open' && prevStatus === 'reconnecting') {
      playSfx(this, 'sfx-feito', 0.3);
      // The socket is back but this client's board is whatever it was when the network died —
      // possibly many turns stale. Lock input until the server's post-reconnect state_sync lands
      // and replaces it; onOnlineStateSync clears the lock and the notice. The pending watchdog
      // is the safety net for a reconnect that attaches but never syncs.
      this.setOnlineNotice(t('online.selfReconnected'));
      this.setOnlinePending(true);
      this.renderAll();
    }
    if (status === 'closed' || status === 'error') {
      this.setOnlineNotice(t('online.connectionLost'));
      playSfx(this, 'sfx-invalid', 0.5);
      this.leaveOnlineToMenu(2500);
    }
  }

  /**
   * While the socket is down, tell the player the two things they actually need: the game is
   * trying to get back, and their seat is being held. The number is the room's reconnect grace
   * counted down locally from the drop — the server owns the real deadline, so this is an
   * estimate and reaching zero decides nothing. Past zero the seat is still theirs to reclaim,
   * but the server starts playing its turns (draw and pass), which is what the second line says.
   */
  private startReconnectTicker(): void {
    this.paintReconnectNotice();
    if (this.reconnectTicker) return;
    this.reconnectTicker = this.time.addEvent({
      delay: 1000, loop: true, callback: () => this.paintReconnectNotice(),
    });
  }

  private stopReconnectTicker(): void {
    this.reconnectTicker?.remove();
    this.reconnectTicker = null;
    this.reconnectStartedAt = 0;
  }

  private paintReconnectNotice(): void {
    const graceMs = this.onlineSettings?.reconnectGraceMs ?? 0;
    const leftMs = graceMs - (Date.now() - this.reconnectStartedAt);
    this.setOnlineNotice(
      leftMs > 0
        ? t('online.reconnectingHeld', { secs: Math.ceil(leftMs / 1000) })
        : t('online.reconnectingStill'),
    );
  }

  /** Reading the notice takes a moment, so the drop back to the menu is delayed — and skipped
   * entirely if the scene has already moved on by then. */
  private leaveOnlineToMenu(delayMs: number): void {
    this.time.delayedCall(delayMs, () => {
      if (!this.online) return;
      this.online.client.disconnect();
      debugApi.online = null;
      gotoScene(this, 'menu');
    });
  }

  private startAmbience(): void {
    if (!this.cache.audio.exists('ambience')) return;
    try {
      this.ambienceSound = this.sound.add('ambience', { loop: true, volume: settings.musicVolume() }) as Phaser.Sound.BaseSound & { volume: number };
      this.ambienceSound.play();
    } catch {
      // audio blocked — silent no-op
    }
  }

  // ---------- turn flow ----------

  private onTurnStart(): void {
    const state = this.store.get();
    if (state.phase !== 'playing') return;
    const player = state.players[state.activePlayerIndex]!;
    const isMyTurn = !player.isAi && state.activePlayerIndex === this.localSeat;
    // Fresh per-turn UI state: a new turn gets a fresh DraftEditor, so the editor's own view
    // (which row is focused, scroll position, open/closed) starts fresh alongside it.
    this.mexeEditorOpen = false;
    this.mexeEditorMeldId = undefined;
    this.mexeEditorScroll = 0;
    this.mexeHandScroll = 0;
    this.resetArmedUntil = 0;
    this.resetBtn?.setSelected(false);
    this.resetZoomPan();
    // One board sample per turn (not per render): hand size, deck left and table complexity, which
    // is how the playtest log answers "when did this match get heavy?".
    playlog.recordBoard({
      deckRemaining: state.drawPile.length,
      handSize: state.players[this.localSeat]?.hand.length ?? 0,
      tableMelds: state.table.length,
      tableCards: state.table.reduce((n, m) => n + m.cards.length, 0),
    });

    if (isMyTurn) {
      setMusicContext('mexe');
      this.editor = new DraftEditor(state);
      this.bindMexeHooks();
      this.renderAll();
      if (!this.dealPending) this.announceTurn();
      playSfx(this, 'sfx-deal', 0.35);
      this.armHesitationHint();
      return;
    }

    setMusicContext('game');
    this.editor = null;
    debugApi.mexe = null;
    this.clearHesitationHint(); // not your turn any more — a hint about your move would be stale
    this.renderAll();
    if (this.online) return; // opponent's turn online: read-only, never an AI timer

    // AI-01: the opponent's turn gets its own brief start, same beat as the player's own, minus
    // the "board becomes editable" wash (see announceTurn) — the seat/avatar activation ring and
    // the receded hand (layoutHand) are already handled by renderAll above.
    if (!this.dealPending) this.announceTurn(false);

    if (this.tutorialDirector) {
      // tutorial opponent: no thinking, always draws so the human's next scripted turn arrives fast
      this.aiTimer = this.time.delayedCall(500, () => {
        this.store.drawEndTurn();
        if (this.store.get().phase === 'playing') this.renderAll();
      });
    } else {
      const personality = this.personalities[state.activePlayerIndex]!;
      // AI-02: a personality-flavored pre-move tell (see PERSONALITY_STYLE.thinkEmote) instead of
      // a generic pause — wordless and cooldown-exempt so it never eats the post-move reaction.
      this.showEmote(state.activePlayerIndex, PERSONALITY_STYLE[personality].thinkEmote, null, undefined, true);
      this.aiTimer = this.time.delayedCall(this.aiThinkDelay(personality, state), () => void this.runAiTurn(personality));
    }
  }

  /** Presentation-only "thinking" pause before an AI's move lands — never affects the AI's own
   * 400ms search deadline. Bia's pace grows with table complexity (more melds to weigh); every
   * personality is capped and scaled by settings.motionScale() (0 under reducedMotion). */
  private aiThinkDelay(personality: Personality, state: GameState): number {
    const style = PERSONALITY_STYLE[personality];
    const complexityBonus = personality === 'bia' ? Math.min(400, state.table.length * 60) : 0;
    return Math.round(this.motion((style.thinkMs + complexityBonus) * AI_SPEED_SCALE[settings.get().aiSpeed]));
  }

  /** Draft undo/redo/reset — shared by the toolbar buttons, keyboard shortcuts and the e2e hook,
   * so the playlog record lives in one place instead of five. */
  private onUndo(): void {
    const before = this.cardPositions();
    if (this.editor?.undo()) {
      playSfx(this, 'sfx-pickup', 0.35);
      playlog.record('undo');
      this.refreshDraft(before);
    }
  }

  private onRedo(): void {
    const before = this.cardPositions();
    if (this.editor?.redo()) {
      playSfx(this, 'sfx-snap', 0.35);
      playlog.record('redo');
      this.refreshDraft(before);
    }
  }

  /**
   * MEXE-14/RECOVERY-09: a small draft resets immediately — undo already covers that case, so a
   * confirm step would just be friction. A draft with real work in it (RESET_CONFIRM_EDITS+ edits)
   * arms instead of firing: the reason line names it, and a second tap within RESET_ARM_MS commits
   * it. No modal — experimentation stays uninterrupted, the cost of a mistake is just one more tap.
   */
  private onReset(): void {
    if (!this.editor) return;
    const edits = this.editor.historyLength() - 1;
    const armed = this.resetArmedUntil > this.time.now;
    if (edits >= RESET_CONFIRM_EDITS && !armed) {
      const until = this.time.now + RESET_ARM_MS;
      this.resetArmedUntil = until;
      this.reasonText.setText(t('mobile.resetConfirm'));
      this.fitReasonBackdrop();
      debugApi.reasonLine = this.reasonText.text;
      // N7: arming is a neutral "are you sure", not a rejection — sfx-invalid is the punishment
      // sound used elsewhere for a blocked action, wrong cue for this. sfx-pickup is the same
      // neutral cue MEXE-17's reverse-commit already reuses.
      playSfx(this, 'sfx-pickup', 0.35);
      // N7: a visible armed state on the button itself (reused from the "chosen" ring elsewhere),
      // plus the timer that clears both it and the reason line when the arm window lapses — before
      // this, the line kept claiming the button was armed long after it had silently disarmed.
      this.resetBtn?.setSelected(true);
      this.time.delayedCall(RESET_ARM_MS, () => {
        if (this.resetArmedUntil !== until || this.sceneGone) return; // re-armed or reset already fired
        this.resetArmedUntil = 0;
        this.resetBtn?.setSelected(false);
        if (this.editor) this.renderAll();
      });
      return;
    }
    this.resetArmedUntil = 0;
    this.resetBtn?.setSelected(false);
    const before = this.cardPositions();
    playSfx(this, 'sfx-drop', 0.4);
    this.editor.reset();
    playlog.record('reset');
    this.refreshDraft(before);
  }

  /** Back to 1x / offset 0 / no focus — called on turn start, an orientation flip, and scene
   * shutdown so zoomed/panned/focused view state never survives past the board it described. */
  private resetZoomPan(): void {
    this.zoomLevel = 0;
    this.tablePan = 0;
    this.tableContentH = 0;
    this.focusedMeldId = null;
  }

  private onZoomIn(): void {
    const next = zoomStepIn(this.zoomLevel);
    if (next === this.zoomLevel) return;
    playlog.record('zoom', { level: next });
    this.zoomLevel = next;
    this.renderAll();
  }

  private onZoomOut(): void {
    const next = zoomStepOut(this.zoomLevel);
    if (next === this.zoomLevel) return;
    playlog.record('zoom', { level: next });
    this.zoomLevel = next;
    this.renderAll();
  }

  /** Entry/exit for the focused Mexe editor. A no-op with no live editor (opponent's turn, or an
   * online player mid-pending) — same interactive gate every other draft mutation honours. Never
   * discards draft state: the draft lives in DraftEditor, untouched by this toggle either way. */
  private toggleMexeEditor(): void {
    if (!this.editor) return;
    this.mexeEditorOpen = !this.mexeEditorOpen;
    // Claim the room's one-off Mexe extension. The server grants it at most once per turn and to
    // the active seat only, so re-opening the editor cannot be used to hold a turn open.
    if (this.mexeEditorOpen && this.online && this.store.get().activePlayerIndex === this.localSeat) {
      this.online.client.mexeStarted();
    }
    this.selectedCardId = null;
    playSfx(this, 'sfx-snap', 0.3);
    playlog.record(this.mexeEditorOpen ? 'mexe:editorOpen' : 'mexe:editorClose');
    this.renderAll();
  }

  /** e2e hooks: drive the live editor from Playwright and re-render. */
  private bindMexeHooks(): void {
    const wrap = <A extends unknown[]>(fn: (...args: A) => boolean) => (...args: A): boolean => {
      const ok = fn(...args);
      this.renderAll();
      return ok;
    };
    debugApi.mexe = {
      playHandCard: wrap((cardId: string, meldId: string | null) => {
        if (!this.tutorialAllows({ type: 'playHandCard', cardId })) return false;
        return this.editor?.playHandCard(cardId, meldId) ?? false;
      }),
      moveTableCard: wrap((cardId: string, meldId: string | null) => {
        if (!this.tutorialAllows({ type: 'moveTableCard', cardId })) return false;
        return this.editor?.moveTableCard(cardId, meldId) ?? false;
      }),
      undo: wrap(() => {
        const ok = this.editor?.undo() ?? false;
        if (ok) playlog.record('undo');
        return ok;
      }),
      feito: () => {
        if (!this.tutorialAllows({ type: 'feito' })) return false;
        const ok = this.editor?.canConfirm().ok ?? false;
        if (ok) this.onFeito();
        return ok;
      },
      comprar: () => this.onComprar(),
      getDraft: () => this.editor?.getDraft() ?? null,
      // Verification-only reads (Phase 12) — mirror what the drag highlights use, never mutate anything.
      cardPos: (cardId: string) => {
        const s = this.cardSprites.find((c) => c.getData('cardId') === cardId);
        return s ? { x: s.x, y: s.y } : null;
      },
      meldPos: (meldId: string) => {
        const z = this.meldZones.find((m) => m.meldId === meldId);
        return z ? { x: z.rect.centerX, y: z.rect.centerY } : null;
      },
      selection: () => this.selectedCardId,
      snapTargets: (cardId: string) =>
        this.computeSnapTargetsFor(cardId).map((tg) => ({ meldId: tg.meldId, status: tg.status, reason: tg.reason })),
      // Phase 14 Wave B — verification-only reads for the helper-mode UI.
      helperMode: () => settings.helperMode(),
      selectionTargets: () =>
        this.selectionTargets.map((tg) => ({ meldId: tg.meldId, status: tg.status, reason: tg.reason })),
      // Phase 14 Wave C — focused Mexe editor (portrait).
      editorOpen: () => this.mexeEditorOpen,
      openEditor: () => {
        if (this.editor && !this.mexeEditorOpen) this.toggleMexeEditor();
      },
      closeEditor: () => {
        if (this.editor && this.mexeEditorOpen) this.toggleMexeEditor();
      },
      editorMeldId: () => this.mexeEditorMeldId ?? null,
      editorScroll: () => this.mexeEditorScroll,
      handScroll: () => this.handScroll,
      // Phase 14 Wave D — table zoom/pan/focus, verification-only reads.
      zoomLevel: () => this.zoomLevel,
      panOffset: () => this.tablePan,
      focusedMeldId: () => this.focusedMeldId,
      problemHighlightMeldId: () => this.problemHighlightMeldId,
      // Phase 14 Wave E: whether a card sprite currently carries the zoomed-table geometry mask —
      // lets e2e prove a dragged sprite drops the mask mid-drag instead of visually clipping.
      cardMasked: (cardId: string) => {
        const s = this.cardSprites.find((c) => c.getData('cardId') === cardId);
        // Masking now lives on the shared tableContainer, not per-sprite (CI perf fix) — a card
        // is effectively masked exactly when it's still a child of that container.
        if (!s) return null;
        return this.tableContainer != null && s.parentContainer === this.tableContainer;
      },
      // D4: proves a mid-drag orientation flip (or any other render) never orphans the drag
      // layer — see cancelActiveDrag's call inside renderAll().
      dragArtifactCount: () => this.dragZoneHighlights.length + (this.dragShadow ? 1 : 0) + (this.dragTableOutline ? 1 : 0),
      // D13: sprite.input only exists once makeCardSprite() was told `interactive: true` — the
      // one true readout of whether a card actually accepts pointer input right now.
      cardInteractive: (cardId: string) => {
        const s = this.cardSprites.find((c) => c.getData('cardId') === cardId);
        return s ? s.input != null : null;
      },
    };
  }

  /** Resolves `cardId` against the live draft (table melds, then remaining hand) and runs the pure
   * snap model once. Shared by dragstart and the debug-api readback so they can never disagree. */
  private computeSnapTargetsFor(cardId: string): SnapTarget[] {
    if (!this.editor) return [];
    const draft = this.editor.getDraft();
    const card =
      draft.melds.flatMap((m) => m.cards).find((c) => c.id === cardId) ??
      this.editor.getRemainingHand().find((c) => c.id === cardId);
    if (!card) return [];
    return computeSnapTargets(draft, card);
  }

  /**
   * Board regions for this scene. Portrait has no spare column for the tutorial panel, so in
   * tutorial mode the table starts below the panel's band instead of underneath it — otherwise
   * the panel (depth 300) would cover the very melds the step is talking about.
   */
  private regionsForMode(): GameRegions {
    const r = gameRegions(view());
    if (!this.tutorialDirector) return r;
    if (!r.portrait) {
      // Landscape parks the step panel in the right column (y2-178), which is where the reason
      // line is bottom-anchored at y191 — its upper lines drew through the panel. Same strip the
      // touch layout already uses.
      return { ...r, reason: wideReason(r.w) };
    }
    const shift = r.tutorialPanel.y + r.tutorialPanel.h + 4 - r.tableTop;
    return { ...r, tableTop: r.tableTop + shift, tableAreaH: r.tableAreaH - shift };
  }

  /** Tutorial-mode action gate — always true outside a tutorial. */
  private tutorialAllows(action: TutorialAction): boolean {
    if (!this.tutorialDirector) return true;
    return this.tutorialDirector.isAllowed(action);
  }

  /** cardId -> meld it currently sits in, for diffing one table position against the next. */
  private static meldOf(state: GameState): Map<string, string> {
    const m = new Map<string, string>();
    for (const meld of state.table) for (const c of meld.cards) m.set(c.id, meld.id);
    return m;
  }

  /**
   * Record what the opponent just did: every table card that is new or changed meld, plus a
   * one-line summary. Both stay on screen for the whole of the local player's turn (the moment
   * they edit or end it, the note is stale and gets cleared), so a rearranged table can be read
   * rather than re-derived.
   */
  private noteOpponentMove(before: GameState, after: GameState, seat: number): void {
    const prev = GameScene.meldOf(before);
    const changed = new Set<string>();
    for (const [id, meldId] of GameScene.meldOf(after)) if (prev.get(id) !== meldId) changed.add(id);
    this.lastMoveIds = changed;
    const name = after.players[seat]?.name ?? '';
    const played = (before.players[seat]?.hand.length ?? 0) - (after.players[seat]?.hand.length ?? 0);
    const moved = Math.max(0, changed.size - Math.max(0, played));
    const explain = settings.get().aiExplain;
    // 'off' hides only AI narration — a hot-seat or online opponent's move still gets its line,
    // because there the text is the only record of what the other person did.
    if (this.lastAiReason !== null && explain === 'off') {
      this.lastMoveText?.setText('');
      return;
    }
    const key = played <= 0 ? 'game.lastMove.drew' : moved > 0 ? 'game.lastMove.mexeu' : 'game.lastMove.played';
    let text = t(key, { name, n: Math.max(0, played), m: moved });
    if (this.lastAiReason !== null && explain === 'detailed') text += ` ${t(`ai.why.${this.lastAiReason}`)}`;
    this.lastMoveText?.setText(text);
  }

  private clearLastMove(): void {
    if (this.lastMoveIds.size === 0 && !this.lastMoveText?.text) return;
    this.lastMoveIds = new Set();
    this.lastMoveText?.setText('');
  }

  private async runAiTurn(personality: Personality): Promise<void> {
    const state = this.store.get();
    const player = state.players[state.activePlayerIndex]!;
    const actingSeat = state.activePlayerIndex;
    // Where the cards sit before the AI touches anything, so its move can be replayed as movement
    // rather than simply appearing as a different board.
    const boardBefore = this.cardPositions();
    try {
      const ai = createAi(personality, settings.get().aiDifficulty);
      // Sliced (frame-friendly) search where the engine offers it. The yields let other events
      // run mid-search, so the guard below re-checks scene and store before acting.
      const decision = ai.decideSliced ? await ai.decideSliced(state) : ai.decide(state);
      if (this.sceneGone || this.store.get() !== state) return; // scene quit or state moved on mid-search
      bus.emit('ai:thought', { playerId: player.id, text: decision.explanation });
      debugApi.lastAiThought = decision.explanation;
      this.lastAiReason = aiReasonKeySuffix(decision.explanation);
      const style = PERSONALITY_STYLE[personality];
      if (decision.kind === 'confirm') {
        const played = decision.draft.handCardsPlayed.length;
        const remaining = player.hand.length - played;
        const playedMany = played >= 3;
        const lineMoment = remaining <= 2 ? 'nearWin' : playedMany ? 'bigPlay' : null;
        this.showEmote(state.activePlayerIndex, playedMany ? style.emoteBig : style.emoteSmall, lineMoment, personality);
        playSfx(this, 'sfx-feito');
        const { key, params } = summarizeMoveKey(state.table, decision.draft.melds, played);
        this.lastConfirmedMoveText = t(key, { name: player.name, ...params });
        this.store.confirmTurn(decision.draft);
      } else {
        this.showEmote(state.activePlayerIndex, style.emoteDraw, 'forcedDraw', personality);
        playSfx(this, 'sfx-draw');
        this.lastConfirmedMoveText = null; // a stalemate win has no meld play to describe
        this.store.drawEndTurn();
      }
    } catch (e) {
      if (this.sceneGone) return;
      // AI must never break the game: fall back to draw.
      debugApi.errors.push(`ai fallback: ${String(e)}`);
      this.showEmote(state.activePlayerIndex, 'annoyed');
      this.store.drawEndTurn();
    }
    this.noteOpponentMove(state, this.store.get(), actingSeat);
    // presentAiMove does the re-render itself, so that the new board can be animated in from the
    // old positions rather than replacing it.
    this.presentAiMove(state, this.store.get(), actingSeat, boardBefore);
  }

  private onWin(): void {
    const state = this.store.get();
    const winner = state.players.find((p) => p.id === state.winnerId)!;
    // JUICE-06: a short held beat before the BATER sting, so it reads as an earned impact instead
    // of firing in the same frame the winning card touched the table. Scales to 0 under reduced
    // motion — the sound still plays, it just loses the wind-up, which carries no information.
    this.time.delayedCall(feelMs('fast'), () => playSfx(this, 'sfx-win'));
    if (this.tutorialDirector) {
      // stay in-scene: the overlay shows the BATEU banner + REPLAY/SKIP instead of leaving to WinScene
      this.renderAll();
      return;
    }
    const perPlayer = playlog.summary().perPlayer;
    const stalemate = winner.hand.length > 0;
    const results = state.players.map((p, i) => ({
      name: p.name,
      cardsLeft: p.hand.length,
      isWinner: p.id === state.winnerId,
      avatarKey: this.avatarKey(i),
      personality: this.personalities[i] ?? undefined,
      ...playerStats(p.id, perPlayer),
    }));
    // Local matches keep a running tally per character, so a rematch can say who is ahead.
    // Skipped online and in the tutorial: neither is a match against one of the four characters.
    if (!this.online) {
      const humanWon = state.winnerId === state.players[this.localSeat]?.id;
      for (const [i, personality] of this.personalities.entries()) {
        if (personality && i !== this.localSeat) settings.recordMatchResult(personality, humanWon);
      }
    }
    // END-12: FEEL's own docs name victory as a `major`-band moment (FEEL's `major` comment:
    // "FEITO, BATER, victory") — reusing that band instead of a bespoke 400ms gives the winning
    // move's own animation (now fully played out, see presentAiMove/playFeitoConfirmFx) room to
    // actually land on screen before results appear, and it still respects reduced motion since
    // feelMs already scales by motionScale.
    this.time.delayedCall(Math.max(400, feelMs('major')), () => {
      gotoScene(this, 'win', {
        winnerName: winner.name,
        stalemate,
        config: this.config,
        results,
        winningMoveText: stalemate ? '' : (this.lastConfirmedMoveText ?? ''),
        // The board as it finished, so the results screen can show what the match actually ended on.
        finalTable: state.table,
      });
    });
  }

  // ---------- static UI ----------

  private buildStaticUi(): void {
    this.staticUi = [];
    this.mexeToggleBtn = undefined; // stale handle after a relayout destroys the previous build

    const playerCount = this.store.get().players.length;
    // Local cosmetic choice — purely visual, never affects rules/protocol. Missing art (theme
    // not shipped yet) degrades to the default table rather than a broken/blank image. Read here
    // (not cached) so a mid-match table-theme change (D12) picks it up on the next relayout.
    const tableKey = cosmeticTextureKey(TABLE_THEMES, settings.cosmetics().tableTheme, DEFAULT_TABLE_THEME, debugApi.missingAssets);
    // Cover-fit, not stretch: the table art is authored 480x270, and squashing it into the
    // 270x480 portrait world smears the baked-in props. Identity in landscape.
    const bg = coverBackground(this, tableKey);
    // calm the busy tablecloth/props so cards and HUD stay readable
    const dim = this.add.rectangle(this.r.w / 2, this.r.h / 2, this.r.w, this.r.h, 0x1a0f0a, playerCount > 2 ? 0.22 : 0.08);
    // near-opaque top bar: baked-in table props (mug/etc.) sit right behind this strip in some
    // backgrounds — keep it solid enough that avatars/names never fight prop art for legibility.
    const topBar = this.add.rectangle(this.r.w / 2, this.r.barH / 2, this.r.w, this.r.barH, 0x1a0f0a, 0.88);
    this.staticUi.push(bg, dim, topBar);
    if (!this.r.portrait) {
      // Landscape-only felt dressing, both keyed to the 480x270 art: a dim patch behind the
      // right-hand action column, and a prop covering a paint smudge on the boteco felt. Portrait
      // reframes that art entirely (and puts the action bar along the bottom), so neither lands
      // where it was drawn for — the portrait board dims the whole table instead.
      this.staticUi.push(this.add.rectangle(this.r.w - 36, 226, 72, 96, 0x1a0f0a, 0.55));
      if (playerCount <= 2) {
        this.staticUi.push(this.add.image(60, 60, 'prop-dominoes').setDisplaySize(32, 24).setDepth(1));
      }
    }

    // opaque backdrop behind the whole FEITO/COMPRAR/undo cluster: table backgrounds bake props
    // (e.g. a cookie plate in the 4p kitchen) right under this column, and the disabled-reason
    // tooltip must stay readable regardless of what's drawn there.
    const ap = this.r.actionPanel;
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1410, 0.82);
    if (this.r.portrait) {
      // portrait's bottom bar is a plain full-width strip, not a floating card — a rounded rect
      // there would leave visible corners of table art poking through.
      panel.fillRect(ap.x, ap.y, ap.w, ap.h);
      panel.lineStyle(1, CHROME_GOLD, 0.35);
      panel.strokeRect(ap.x, ap.y, ap.w, ap.h);
    } else {
      panel.fillRoundedRect(ap.x, ap.y, ap.w, ap.h, 4);
      panel.lineStyle(1, CHROME_GOLD, 0.35);
      panel.strokeRoundedRect(ap.x, ap.y, ap.w, ap.h, 4);
    }

    // Same backdrop for the touch-landscape top cluster (gear / zoom / reset / Mexe toggle),
    // which sits on bare table art. Skipped in tutorial mode: the step panel already owns that
    // column there, and gear/zoom aren't built at all (see below).
    const cp = this.r.controlPanel;
    if (cp && !this.config.tutorial) {
      panel.fillStyle(0x1a1410, 0.82);
      panel.fillRoundedRect(cp.x, cp.y, cp.w, cp.h, 4);
      panel.lineStyle(1, CHROME_GOLD, 0.35);
      panel.strokeRoundedRect(cp.x, cp.y, cp.w, cp.h, 4);
    }

    this.feitoBtn = new PixelButton(this, this.r.feito.x, this.r.feito.y, t('game.feito'), () => this.onFeito(), {
      textureBase: 'btn-feito', w: this.r.feito.w, h: this.r.feito.h, size: this.r.feito.size, tooltip: t('tooltip.feito'),
      onBlocked: () => this.onFeitoBlocked(),
    });
    this.comprarBtn = new PixelButton(this, this.r.comprar.x, this.r.comprar.y, t('game.comprar'), () => this.onComprar(), {
      textureBase: 'btn-comprar', w: this.r.comprar.w, h: this.r.comprar.h, size: this.r.comprar.size, tooltip: t('tooltip.comprar'),
    });
    const undoBtn = new PixelButton(this, this.r.undo.x, this.r.undo.y, '↶', () => this.onUndo(), { textureBase: 'btn-small', w: this.r.undo.w, h: this.r.undo.h, size: this.r.undo.size, color: 0x5e5646, tooltip: t('tooltip.undo') });
    this.undoBtn = undoBtn;
    const redoBtn = new PixelButton(this, this.r.redo.x, this.r.redo.y, '↷', () => this.onRedo(), { textureBase: 'btn-small', w: this.r.redo.w, h: this.r.redo.h, size: this.r.redo.size, color: 0x5e5646, tooltip: t('tooltip.redo') });
    // N8: tooltip flips below the button — "above" (the default) sits right over DRAW/COMPRAR,
    // which reset's row is directly beneath in every layout.
    const resetBtn = new PixelButton(this, this.r.reset.x, this.r.reset.y, '⟲', () => this.onReset(), { textureBase: 'btn-small', w: this.r.reset.w, h: this.r.reset.h, size: this.r.reset.size, color: 0x8e4632, tooltip: t('tooltip.reset'), tooltipSide: 'below' });
    this.resetBtn = resetBtn;

    // shifted off the corner: at (18,254) the table-frame art clipped this icon on both edges.
    const sortBtn = new PixelButton(this, this.r.sort.x, this.r.sort.y, '⇅', () => {
      this.sortMode = this.sortMode === 'suit' ? 'rank' : 'suit';
      this.renderAll();
    }, { textureBase: 'btn-small', w: this.r.sort.w, h: this.r.sort.h, size: this.r.sort.size, color: 0x5e5646, tooltip: t('tooltip.sort') });

    this.staticUi.push(panel, this.feitoBtn, this.comprarBtn, undoBtn, redoBtn, resetBtn, sortBtn);

    if (!this.config.tutorial) {
      // Focused Mexe editor toggle (Phase 14 Wave C; landscape support added later) — both
      // orientations. Skipped in tutorial mode for the same reason as the gear and zoom buttons
      // below: the step panel covers this strip (r.tutorialPanel spans y2-178), so the button
      // would sit under it and be untappable.
      this.mexeToggleBtn = new PixelButton(this, this.r.mexeToggle.x, this.r.mexeToggle.y, t('mobile.editorToggle'), () => this.toggleMexeEditor(), {
        textureBase: 'btn-small', w: this.r.mexeToggle.w, h: this.r.mexeToggle.h, size: this.r.mexeToggle.size, color: 0x5e5646, tooltip: t('tooltip.mexeEditor'),
      });
      this.staticUi.push(this.mexeToggleBtn);

      // tutorial mode uses the whole right column for its step panel — no room for the gear there (Esc still opens pause)
      const gearBtn = new PixelButton(this, this.r.gear.x, this.r.gear.y, '⚙', () => this.togglePause(), {
        textureBase: 'btn-small', w: this.r.gear.w, h: this.r.gear.h, size: this.r.gear.size, color: 0x5e5646, tooltip: t('tooltip.settings'),
      });
      // Table zoom (Phase 14 Wave D) — tutorial melds are always few, so tutorial mode keeps this
      // free strip for its step panel instead (same gate as the gear button above).
      this.zoomInBtn = new PixelButton(this, this.r.zoomIn.x, this.r.zoomIn.y, '+', () => this.onZoomIn(), {
        textureBase: 'btn-small', w: this.r.zoomIn.w, h: this.r.zoomIn.h, size: this.r.zoomIn.size, color: 0x5e5646, tooltip: t('tooltip.zoomIn'),
      });
      this.zoomOutBtn = new PixelButton(this, this.r.zoomOut.x, this.r.zoomOut.y, '−', () => this.onZoomOut(), {
        textureBase: 'btn-small', w: this.r.zoomOut.w, h: this.r.zoomOut.h, size: this.r.zoomOut.size, color: 0x5e5646, tooltip: t('tooltip.zoomOut'),
      });
      this.staticUi.push(gearBtn, this.zoomInBtn, this.zoomOutBtn);
    }

    // Opaque backdrop, sized to the text in renderAll: the reason can grow to several lines (the
    // beginner checklist) and then reaches past its band onto table art, where yellow-on-green is
    // not readable on its own.
    this.reasonBg = this.add.rectangle(this.r.reason.x, this.r.reason.y, 10, 10, 0x1a1410, 0.8).setDepth(48).setVisible(false);
    this.reasonText = this.add
      .text(this.r.reason.x, this.r.reason.y, '', { ...fontStyle(this.r.reason.size, CHROME_GOLD_TEXT), align: 'center', wordWrap: { width: this.r.reason.wrap } })
      .setOrigin(0.5, this.r.reason.originY)
      .setDepth(49);
    this.reasonBg.setOrigin(0.5, this.r.reason.originY);
    // bolder turn prompt: its own row below the avatar strip (not overlapping opponent name/avatar
    // cells at 3-4p) with an opaque pill behind the text (resized in renderAll) so "Sua vez" / the
    // AI's name always reads clearly regardless of what's behind it.
    this.bannerBg = this.add.rectangle(this.r.banner.x, this.r.banner.y, 10, 10, 0x1a1410, 0.78).setDepth(49);
    this.banner = label(this, this.r.banner.x, this.r.banner.y, '', 11, CHROME_GOLD_TEXT).setDepth(50);
    // one-line readback of the opponent's last action, just above the table
    this.lastMoveText = this.add
      .text(this.r.lastMove.x, this.r.lastMove.y, '', { ...fontStyle(8, '#d8c890'), align: 'center', wordWrap: { width: this.r.lastMove.wrap } })
      .setOrigin(0.5)
      .setDepth(50);
    this.staticUi.push(this.reasonBg, this.reasonText, this.bannerBg, this.banner, this.lastMoveText);

    if (this.online) {
      // small corner connection indicator — never a modal
      this.onlineStatusDot = this.add.circle(this.r.onlineDot.x, this.r.onlineDot.y, 3, 0x3ec06a).setDepth(600);
      // named, not just a colored dot: a local/AI/tutorial match never shows this, so its mere
      // presence — not just its color — is the "you are online" tell (task: never ambiguous).
      const onlineLabel = label(this, this.r.onlineDot.x + 10, this.r.onlineDot.y, t('game.onlineBadge'), 6, '#8a7f68').setOrigin(0, 0.5).setDepth(600);
      // Turn clock under the online badge. Hidden outright in a no-timer room rather than showing
      // a dash, so an untimed match looks exactly like it did before timers existed.
      this.onlineTimerText = label(this, this.r.onlineTimer.x, this.r.onlineTimer.y, '', 8, '#c0b8a8')
        .setOrigin(0, 0.5)
        .setDepth(600)
        .setVisible(false);
      this.staticUi.push(this.onlineTimerText);
      // 250 ms, not a per-frame update: the readout has one-second resolution, and a timer event
      // stops with the scene instead of outliving it the way a bare setInterval would.
      // D6: buildStaticUi() re-runs on every viewport:changed (relayout) — without removing the
      // previous ticker first, each rotation left the old one running forever alongside the new
      // one, one extra 250ms loop per flip.
      this.onlineTimerEvent?.remove();
      this.onlineTimerEvent = this.time.addEvent({ delay: 250, loop: true, callback: () => this.updateTurnTimer() });
      // Backing strip, not bare text: the notice sits over baked-in table props (napkin, mug) and
      // the longer connection sentences were unreadable against them. Hidden entirely while empty,
      // so the strip never shows as a stray blob (see setOnlineNotice).
      this.onlineNoticeText = this.add
        .text(this.r.onlineNotice.x, this.r.onlineNotice.y, '', {
          ...fontStyle(8, '#f0c040'),
          align: 'center',
          wordWrap: { width: this.r.onlineNotice.wrap },
          backgroundColor: 'rgba(26,15,10,0.85)',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5)
        .setDepth(600)
        .setVisible(false);
      this.staticUi.push(this.onlineStatusDot, onlineLabel, this.onlineNoticeText);
    }
  }

  /** Single set point for the online notice: an empty message hides the whole object, so its
   * backing strip never lingers as an empty box over the table. */
  /**
   * The server ended someone's turn for them. The authoritative result already arrived as a
   * state_sync (which threw away whatever draft this client had), so this is only the sentence
   * that explains it — a different one when the local player still had a draft on screen, because
   * from their side the table visibly snapped back.
   */
  private onOnlineTurnTimeout(seat: number): void {
    if (!this.online) return;
    if (seat === this.localSeat) {
      const hadDraft = (this.editor?.getDraft().handCardsPlayed.length ?? 0) > 0 || this.mexeEditorOpen;
      this.setOnlineNotice(t(hadDraft ? 'online.timeout.selfReset' : 'online.timeout.self'));
    } else {
      const name = this.store.get().players[seat]?.name ?? '';
      this.setOnlineNotice(t('online.timeout.other', { name }));
    }
    // ONLINE-14: a room that closes on missedTurnLimit never gets the state_sync that would move
    // play off `seat` — the tick loop skips broadcastStateSync when the room closed (see
    // server/index.ts) — so if `seat` is still the active player here, this timeout is the one
    // that pushed it over the limit. Remember that so onOnlineTerminalError can show the specific
    // "match ended" copy instead of the generic one. Short of the limit, the preceding state_sync
    // already landed (its handler updated this.online.missedTurns), so chain a warning naming the
    // remaining allowance — repeated misses should never end a match by surprise.
    const limit = this.onlineSettings?.missedTurnLimit ?? 0;
    this.pendingMissedLimitClose = limit > 0 && this.store.get().activePlayerIndex === seat;
    if (limit > 0 && !this.pendingMissedLimitClose) {
      const missed = this.online.missedTurns[seat] ?? 0;
      const name = this.store.get().players[seat]?.name ?? '';
      this.time.delayedCall(2500, () =>
        this.setOnlineNotice(t('online.missedWarning', { name, n: missed, left: Math.max(0, limit - missed) })),
      );
      this.time.delayedCall(5000, () => this.setOnlineNotice(''));
    } else {
      this.time.delayedCall(4000, () => this.setOnlineNotice(''));
    }
  }

  /** One-second-resolution readout of the server's clock. Never authoritative: it renders
   * `turnDeadlineAt`, which only a server state_sync can move, and reaching zero here does
   * nothing but show 0s until the server's own tick lands. */
  private updateTurnTimer(): void {
    if (!this.onlineTimerText) return;
    if (this.turnDeadlineAt === null) {
      this.onlineTimerText.setVisible(false);
      return;
    }
    const msLeft = Math.max(0, this.turnDeadlineAt - Date.now());
    const secs = Math.ceil(msLeft / 1000);
    // Two steps, not one: a single threshold gives the same red at twenty seconds and at three.
    // The last few seconds also grow the clock, so the pressure is legible without watching digits.
    const warning = this.turnWarnMs > 0 && msLeft <= this.turnWarnMs;
    const critical = msLeft <= TURN_CRITICAL_MS;
    this.onlineTimerText
      .setVisible(true)
      .setText(t('online.turnTimeLeft', { secs }))
      .setColor(critical ? '#ff3b2e' : warning ? '#ffb35c' : '#c0b8a8')
      .setScale(critical ? 1.25 : 1);
    if (warning && secs !== this.lastTickSecond && secs > 0) {
      this.lastTickSecond = secs;
      // Own turn only: a cue for someone else's clock is noise, and the setting is off by choice.
      if (settings.get().timerTickSound && this.store.get().activePlayerIndex === this.localSeat) {
        playSfx(this, 'sfx-snap', critical ? 0.35 : 0.2);
      }
    }
  }

  private setOnlineNotice(message: string): void {
    this.onlineNoticeText?.setText(message).setVisible(message !== '');
  }

  /** D12: the subset of settings that change how the board/HUD are built (as opposed to how they
   * sound) — see the settings.onChange subscriber in create(). */
  private layoutKey(): string {
    const s = settings.get();
    return `${s.locale}|${s.largeText}|${settings.cosmetics().tableTheme}`;
  }

  /** Re-lays-out the live scene on an orientation/pointer flip (bus 'viewport:changed') without
   * restarting it — this.store/this.editor/the online client all hold live match state. */
  private relayout(): void {
    if (!this.scene.isActive()) return;
    this.r = this.regionsForMode();
    // MOBILE-14: the zoom *level* is an index into the fixed, orientation-independent ZOOM_FLOORS
    // table, so it survives the flip even though resetZoomPan() below also clears tablePan (a raw
    // pixel offset, meaningless once the table geometry changes size) and focusedMeldId (the
    // landscape-only meld-focus popup, which portrait has no equivalent of).
    const zoomLevel = this.zoomLevel;
    this.resetZoomPan();
    this.zoomLevel = zoomLevel;
    // An orientation flip invalidates the portrait editor's scroll/focus state same as zoom/pan —
    // leaving it stale let a reopen after the flip restore a scroll offset or focused meld from
    // before it (finding 3, Phase 14 review).
    this.mexeEditorMeldId = undefined;
    this.mexeEditorScroll = 0;
    this.mexeHandScroll = 0;
    const savedNotice = this.onlineNoticeText?.text ?? '';
    for (const o of this.staticUi) o.destroy();
    this.buildStaticUi();
    this.setOnlineNotice(savedNotice);
    this.renderAll();
    // D12: the pause overlay (and any panel nested in it) is centred on the world size current at
    // the moment it was built and never told about a later viewport:changed — left open, it sat
    // off-centre (and its dim backdrop mis-sized) over the board relayout() just rebuilt. Rebuilding
    // it fresh is simplest: it drops back to the main pause page, which is a fair trade against
    // shipping a stranded panel.
    if (this.pauseOpen && this.pauseMenuClose) {
      this.pauseMenuClose();
      this.togglePause();
    }
  }

  /**
   * @param before card positions captured before the mutation. Passing them lets the cards travel
   * to their new places instead of the board being torn down and rebuilt underneath the player,
   * which is what makes a multi-step undo followable rather than a sequence of jump cuts.
   */
  private refreshDraft(before?: Map<string, { x: number; y: number }>): void {
    playSfx(this, 'sfx-snap', 0.3);
    this.renderAll();
    if (before) this.animateBoardFrom(before, 'normal');
    this.armHesitationHint(); // the player is clearly working — reset the clock on offering help
  }

  /**
   * Progressive help for a player who has gone quiet on their own turn: nothing at first, then one
   * short line. Which line depends on where they are stuck — with nothing played yet the useful
   * answer is that drawing is always available; mid-edit it is whatever is actually blocking FEITO.
   *
   * Re-armed on every draft change, so it only ever fires at someone who has genuinely stopped.
   */
  private armHesitationHint(): void {
    this.clearHesitationHint();
    if (!this.editor || this.config.tutorial) return;
    this.hesitationTimer = this.time.delayedCall(HESITATION_MS, () => {
      if (!this.editor) return;
      // D10: historyLength() is seeded with one snapshot at construction (the turn's starting
      // position), so it is never 0 — "untouched" means only that seed snapshot, i.e. length 1.
      const untouched = this.editor.historyLength() === 1;
      const text = untouched ? t('game.hint.noPlay') : this.blockingReasonText();
      if (!text) return;
      this.hesitationHint = this.add
        .text(this.r.handCenterX, this.r.handY - CARD_H, text, fontStyle(7, '#f7d23e'))
        .setOrigin(0.5)
        .setDepth(500);
    });
  }

  private clearHesitationHint(): void {
    this.hesitationTimer?.remove();
    this.hesitationTimer = null;
    this.hesitationHint?.destroy();
    this.hesitationHint = null;
  }

  /** Esc key or gear button: pauses the AI turn timer (guarded — tutorial's own timer just resumes when closed) while the pause overlay (Continue/Settings/Help/Quit) is open. */
  private togglePause(): void {
    const resume = this.holdForOverlay();
    if (!resume) return;
    this.pauseMenuClose = openPauseMenu(this, { onQuit: () => this.quitToMenu(), online: this.online !== null }, () => {
      this.pauseMenuClose = null;
      resume();
    });
  }

  /**
   * Opening a full-screen overlay: refuses a second one, and freezes the AI turn timer for as
   * long as it is up (guarded — the tutorial's own timer just resumes when the overlay closes).
   * Returns the resume fn to call on close, or null if an overlay is already open.
   */
  private holdForOverlay(): (() => void) | null {
    if (this.pauseOpen) return null;
    this.pauseOpen = true;
    const wasPaused = this.aiTimer?.paused ?? false;
    if (this.aiTimer) this.aiTimer.paused = true;
    return () => {
      this.pauseOpen = false;
      if (this.aiTimer) this.aiTimer.paused = wasPaused;
    };
  }

  /**
   * Abandoning the match. An online seat must tell the server on the way out: otherwise its
   * socket and reconnect token stay live and the opponent waits on a player who is never coming
   * back. Nulling `this.online` also stops the connection-lost watchdog from racing this exit.
   */
  private quitToMenu(): void {
    if (this.online) {
      this.online.client.leaveRoom();
      this.online = null;
      debugApi.online = null;
    }
    gotoScene(this, 'menu');
  }

  /**
   * Z=undo, Y/Shift+Z=redo, R=reset, C=comprar, F=feito, S=sort, H=help.
   * Human turn only, ignored while a panel/pause is open or it's the AI's turn.
   * C/F already gate on tutorial-allowed actions inside onComprar/onFeito.
   */
  private handleShortcut(e: KeyboardEvent): void {
    if (this.pauseOpen) return;
    const state = this.store.get();
    if (state.phase !== 'playing') return;
    const active = state.players[state.activePlayerIndex];
    if (!active || active.isAi || !this.editor) return;
    switch (e.key.toLowerCase()) {
      case 'z':
        if (e.shiftKey) this.onRedo();
        else this.onUndo();
        break;
      case 'y':
        this.onRedo();
        break;
      case 'r':
        this.onReset();
        break;
      case 'c':
        this.onComprar();
        break;
      case 'f':
        this.onFeito();
        break;
      case 's':
        this.sortMode = this.sortMode === 'suit' ? 'rank' : 'suit';
        this.renderAll();
        break;
      case 'h':
        this.openHelp();
        break;
      case 'arrowleft':
      case 'arrowup':
        this.moveFocus(-1);
        e.preventDefault();
        break;
      case 'arrowright':
      case 'arrowdown':
        this.moveFocus(1);
        e.preventDefault();
        break;
      case 'enter':
      case ' ':
        this.focusVisible = true;
        this.activateFocus();
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  // ---------- select-then-place (keyboard + touch) ----------

  private moveFocus(delta: number): void {
    if (this.focusTargets.length === 0) return;
    this.focusVisible = true;
    this.focusIndex = (this.focusIndex + delta + this.focusTargets.length) % this.focusTargets.length;
    this.renderAll();
  }

  /** Enter on the focused ring entry: pick a card up, or drop the held card here. */
  private activateFocus(): void {
    const target = this.focusTargets[this.focusIndex];
    if (!target || !this.editor) return;
    if (target.kind === 'card') {
      this.selectCard(target.id!);
      return;
    }
    this.placeSelected(target.kind, target.id ?? null);
  }

  private selectCard(cardId: string): void {
    this.selectedCardId = this.selectedCardId === cardId ? null : cardId;
    this.focusIndex = 0;
    playSfx(this, this.selectedCardId ? 'sfx-pickup' : 'sfx-snap', 0.4);
    this.renderAll();
  }

  private clearSelection(): void {
    if (this.selectedCardId === null) return;
    this.selectedCardId = null;
    this.focusIndex = 0;
    this.renderAll();
  }

  /**
   * Commit the held card to a destination. Mirrors `onCardDropped`'s rules exactly — same
   * tutorial gate, same hand-vs-table branch — so tapping and dragging can never disagree.
   */
  private placeSelected(kind: FocusTarget['kind'], meldId: string | null): void {
    const cardId = this.selectedCardId;
    if (!cardId || !this.editor) return;
    const fromHand = this.editor.getRemainingHand().some((c) => c.id === cardId);
    const action: TutorialAction = fromHand
      ? { type: 'playHandCard', cardId }
      : kind === 'hand'
        ? { type: 'returnToHand' }
        : { type: 'moveTableCard', cardId };
    if (!this.tutorialAllows(action)) {
      playSfx(this, 'sfx-invalid', 0.15);
      return;
    }
    let acted = false;
    const returning = !fromHand && kind === 'hand';
    if (fromHand) {
      if (kind !== 'hand') acted = this.editor.playHandCard(cardId, kind === 'meld' ? meldId : null);
    } else if (kind === 'hand') {
      acted = this.editor.returnHandCard(cardId); // only cards played this turn can go back
    } else {
      acted = this.editor.moveTableCard(cardId, kind === 'meld' ? meldId : null);
    }
    // MEXE-17: a returned card gets the "picked back up" cue, same as the drag path.
    playSfx(this, acted ? (returning ? 'sfx-pickup' : 'sfx-drop') : 'sfx-invalid', 0.5);
    if (acted) this.clearLastMove();
    this.selectedCardId = null;
    this.focusIndex = 0;
    this.renderAll();
  }

  /** Tap on a card while holding another: the tapped card names the destination (its meld, or the hand). */
  private onCardTapped(cardId: string): void {
    if (!this.editor) return;
    if (this.selectedCardId === null || this.selectedCardId === cardId) {
      this.selectCard(cardId);
      return;
    }
    const dest = resolveCardTapDestination(this.editor, this.selectedCardId, cardId);
    if (dest.kind === 'switch') this.selectCard(cardId);
    else if (dest.kind === 'meld') this.placeSelected('meld', dest.meldId);
    else this.placeSelected('hand', null);
  }

  /** H shortcut: opens the rules panel directly (same AI-timer pause/resume dance as the gear/Esc pause menu). */
  private openHelp(): void {
    const resume = this.holdForOverlay();
    if (!resume) return;
    // Someone opening Help in the middle of their own turn almost always has one specific
    // question, and the game already knows the answer — lead with it instead of making them find
    // the right paragraph.
    const hint = this.editor ? this.blockingReasonText() : '';
    openRulesPanel(this, resume, hint ? { hint } : undefined);
  }

  /**
   * Shared FEITO gate for both the local and the online path. The draft must be confirmable AND
   * have been confirmable for CONFIRM_GUARD_MS, so a card landing under an already-moving finger
   * cannot complete a turn the player never chose to end.
   */
  private feitoAccepted(editor: DraftEditor): boolean {
    const check = editor.canConfirm();
    const heldLongEnough = this.validSince !== null && this.time.now - this.validSince >= CONFIRM_GUARD_MS;
    if (check.ok && heldLongEnough) return true;
    playSfx(this, 'sfx-invalid');
    if (!check.ok) playlog.record('feito:blocked', { reasons: check.reasons.join(',') });
    return false;
  }

  private onFeito(): void {
    if (!this.editor) return;
    if (this.online) {
      this.onFeitoOnline();
      return;
    }
    if (!this.tutorialAllows({ type: 'feito' })) {
      playSfx(this, 'sfx-invalid', 0.15);
      return;
    }
    if (!this.feitoAccepted(this.editor)) return;
    playSfx(this, 'sfx-feito');
    haptic('thud');
    this.clearLastMove();
    const draft = this.editor.getDraft();
    const handCardIds = new Set(draft.handCardsPlayed);
    const sparkleTargets = this.cardSprites
      .filter((s) => handCardIds.has(s.getData('cardId') as string))
      .map((s) => ({ x: s.x, y: s.y }));
    const beforeState = this.store.get();
    const activePlayer = beforeState.players[beforeState.activePlayerIndex]!;
    const { key, params } = summarizeMoveKey(beforeState.table, draft.melds, draft.handCardsPlayed.length);
    this.lastAiReason = null; // a local player's own confirmed turn, not an AI move
    this.lastConfirmedMoveText = t(key, { name: activePlayer.name, ...params });
    this.editor = null;
    this.store.confirmTurn(draft);
    // Weighed from the committed before/after only, so a player who drags a card back and forth
    // twenty times gets exactly the same recognition as one who did it in two moves.
    const afterState = this.store.get();
    const prev = GameScene.meldOf(beforeState);
    let moved = 0;
    for (const [id, meldId] of GameScene.meldOf(afterState)) if (prev.has(id) && prev.get(id) !== meldId) moved++;
    if (moveWeight(draft.handCardsPlayed.length, moved) === 'huge') {
      // PACE-14/END-14: same comeback check as the AI's own huge moves, and — unlike before —
      // shown on a winning huge move too (END-13's fix did the same for the AI side), not just
      // ones that leave the match still playing.
      this.flashMoment(t(isComeback(beforeState, beforeState.activePlayerIndex) ? 'game.moment.comeback' : 'game.moment.mexeu'));
      if (afterState.phase === 'playing') this.reactToPlayerMexe(afterState); // an opponent reacting to being just defeated would read oddly
    }
    this.playFeitoConfirmFx(sparkleTargets, () => {
      if (this.store.get().phase === 'playing') this.renderAll();
    });
  }

  /** Purely cosmetic: pulse the just-confirmed melds and fly sparkles to the new cards. Runs after the store already committed the turn. */
  private playFeitoConfirmFx(sparkleTargets: { x: number; y: number }[], onDone: () => void): void {
    for (const g of this.meldGlowRects) {
      this.tweens.add({ targets: g.rect, alpha: 0.7, duration: Math.max(1, this.motion(100)), yoyo: true, repeat: 1 });
    }
    sparkleTargets.forEach((pos, i) => {
      const spark = this.add.image(pos.x, pos.y, 'sparkle').setDisplaySize(6, 6).setAlpha(0.95).setDepth(500);
      this.tweens.add({
        targets: spark,
        scale: 1.8,
        alpha: 0,
        duration: Math.max(1, this.motion(260)),
        delay: this.motion(i * 15),
        onComplete: () => spark.destroy(),
      });
    });
    this.time.delayedCall(settings.get().reducedMotion ? 0 : 320, onDone);
  }

  private onComprar(): void {
    if (!this.editor) return;
    if (this.online) {
      this.onComprarOnline();
      return;
    }
    if (!this.tutorialAllows({ type: 'comprar' })) {
      playSfx(this, 'sfx-invalid', 0.15);
      return;
    }
    playSfx(this, 'sfx-draw');
    this.clearLastMove();
    this.lastConfirmedMoveText = null; // a stalemate win has no meld play to describe
    this.editor = null;
    const before = this.cardPositions();
    this.store.drawEndTurn();
    if (this.store.get().phase !== 'playing') return;
    this.renderAll();
    // The new card is the only one without a previous position, so it is the only one that moves:
    // it comes off the deck and the hand re-fans around it.
    this.animateBoardFrom(before, 'normal', { x: this.r.deckImg.x, y: this.r.deckImg.y });
  }

  /** FEITO online: submit-and-wait. Never mutates the store locally — only a server state_sync does. */
  private onFeitoOnline(): void {
    if (!this.editor || !this.online || this.onlinePending) return;
    if (!this.feitoAccepted(this.editor)) return;
    playSfx(this, 'sfx-feito');
    const draft = this.editor.getDraft();
    const melds: SubmitTurnMeld[] = draft.melds.map((m) => ({ id: m.id, cardIds: m.cards.map((c) => c.id) }));
    this.setOnlinePending(true);
    if (this.online.client.submitTurn(this.online.lastRev, melds) === null) this.onOnlineSendFailed();
    this.renderAll();
  }

  /** The socket was not open, so the proposal never left the device. Release the submit lock and
   * say so, instead of leaving the board locked until the pending timeout expires on a reply that
   * can never arrive. The draft itself is untouched — the player can retry once reconnected. */
  private onOnlineSendFailed(): void {
    this.setOnlinePending(false);
    this.setOnlineNotice(t('online.sendFailed'));
    playSfx(this, 'sfx-invalid');
  }

  /** COMPRAR online: same submit-and-wait discipline as FEITO. */
  private onComprarOnline(): void {
    if (!this.editor || !this.online || this.onlinePending) return;
    playSfx(this, 'sfx-draw');
    this.setOnlinePending(true);
    if (this.online.client.drawEndTurn(this.online.lastRev) === null) this.onOnlineSendFailed();
    this.renderAll();
  }

  // ---------- rendering ----------

  /** Single choke point for DraftEditor.analyze() — instruments debugApi.analyzeCount so e2e can
   * assert panning/scrolling never re-triggers it mid-gesture (finding 1, Phase 14 review). */
  private analyzeDraft(): DraftAnalysis {
    debugApi.analyzeCount++;
    return this.editor!.analyze();
  }

  // ---------- presentation: replaying a board change as movement ----------

  /**
   * Where every card sprite currently sits, keyed by card id. Take this *before* changing state.
   *
   * `renderAll()` destroys and recreates every sprite, so there is no object continuity to tween
   * across a change. Rather than rewrite the renderer around persistent sprites — which would
   * touch every layout path in the scene — we remember the old coordinates and, once the new
   * board exists, put each new sprite back where its card was and let it slide into place.
   */
  private cardPositions(): Map<string, { x: number; y: number }> {
    const out = new Map<string, { x: number; y: number }>();
    for (const s of this.cardSprites) out.set(String(s.getData('cardId')), { x: s.x, y: s.y });
    return out;
  }

  /**
   * Slides the freshly rendered cards in from wherever they were in `before`. Cards with no
   * previous position (drawn, or dealt at match start) come from `origin` — normally the deck,
   * which is what makes a draw read as "that card came off the pile".
   *
   * The board is already correct and interactive before this runs; under reduced motion nothing
   * moves at all, and the player sees the same final state either way.
   *
   * @param stagger ms between consecutive cards, for sequences that should read as a sequence.
   */
  private animateBoardFrom(
    before: Map<string, { x: number; y: number }>,
    band: FeelBand,
    origin?: { x: number; y: number },
    stagger = 0,
  ): void {
    const duration = feelMs(band);
    if (duration <= 0) return; // reduced motion: the board is already right, just don't move
    let newcomers = 0;
    let animated = 0;
    for (const sprite of this.cardSprites) {
      if (animated >= MAX_ANIMATED_CARDS) break;
      const from = before.get(String(sprite.getData('cardId'))) ?? origin;
      if (!from) continue;
      const dx = from.x - sprite.x;
      const dy = from.y - sprite.y;
      // Repacking nudges most of a crowded table by a pixel or two. That carries no information and
      // costs a tween per card, so only real travel is animated.
      if (dx * dx + dy * dy < MIN_TRAVEL_SQ) continue;
      const toX = sprite.x;
      const toY = sprite.y;
      const delay = before.has(String(sprite.getData('cardId'))) ? 0 : newcomers++ * stagger;
      sprite.setPosition(from.x, from.y);
      this.tweens.add({ targets: sprite, x: toX, y: toY, delay, duration, ease: FEEL[band].ease });
      animated++;
    }
  }

  /**
   * Replays what an opponent just did, at a length proportional to how much it actually changed.
   *
   * Cards it laid down fly out of its seat, cards it rearranged travel from where they were, and
   * the board then holds for a beat so the player can read the new arrangement before it becomes
   * their problem. A draw is over almost instantly; a table-wide rebuild earns the long version.
   * This is the rule that stops routine AI turns feeling slow while keeping the interesting ones
   * legible — the pause is never there to make the AI look clever.
   */
  private presentAiMove(before: GameState, after: GameState, seat: number, boardBefore: Map<string, { x: number; y: number }>): void {
    // END-13: this used to bail out entirely once `after.phase` left 'playing', so an opponent's
    // WINNING move never animated at all — the board sat frozen on last turn's state until
    // WinScene simply cut in. The board still needs to resolve visibly first (END-12), so this
    // now renders and animates the winning move exactly like any other; only the "hold, then
    // re-render for the next turn" tail below is moot once the match is over (its own guard —
    // `this.store.get().phase === 'playing'` — already makes that a safe no-op).
    const changed = GameScene.meldOf(after);
    const prev = GameScene.meldOf(before);
    let moved = 0;
    for (const [id, meldId] of changed) if (prev.has(id) && prev.get(id) !== meldId) moved++;
    const played = (before.players[seat]?.hand.length ?? 0) - (after.players[seat]?.hand.length ?? 0);
    const weight = moveWeight(Math.max(0, played), moved);
    this.renderAll();
    this.animateBoardFrom(boardBefore, WEIGHT_BAND[weight], this.seatPosition(seat));
    // PACE-14: a huge Mexe from whoever was trailing hardest reads as a comeback, not just a
    // tidy table — no score is kept, this only ever looks at the one before/after pair in hand.
    if (weight === 'huge') this.flashMoment(t(isComeback(before, seat) ? 'game.moment.comeback' : 'game.moment.mexeu'));

    // Hold the board for a beat after the movement lands. Without this the turn is handed over on
    // the same frame the cards arrive, and a big rearrangement is gone before it can be read.
    const hold = feelMs(WEIGHT_BAND[weight]);
    if (hold <= 0) return;
    this.presentingUntil = this.time.now + hold * 2;
    const until = this.presentingUntil;
    this.time.delayedCall(hold * 2, () => {
      this.endPresentation(until);
      if (!this.sceneGone && this.store.get().phase === 'playing') this.renderAll();
    });
  }

  /**
   * Ends the presentation hold a just-fired timer was scheduled for.
   *
   * `presentingUntil` is an absolute `time.now` deadline, but the timer that wakes the board up
   * counts smoothed frame deltas instead — the two clocks drift, so the wake-up can land a frame
   * *short* of its own deadline. The re-render then still reads the board as presenting, leaves
   * FEITO/COMPRAR and every card disabled, and nothing is left scheduled to try again: the turn
   * stays dead until some unrelated input happens to force another render (tapping a card was the
   * workaround players found). Clearing the deadline in the waker removes the race instead of
   * re-comparing two clocks that disagree. Guarded on the deadline this timer was created for, so
   * a newer, longer hold set in the meantime is never cut short.
   */
  private endPresentation(until: number): void {
    if (this.presentingUntil === until) this.presentingUntil = 0;
  }

  /**
   * A rare banner for a moment worth naming. Deliberately short, above the table rather than over
   * it, and never used for anything routine — its value is entirely in how seldom it appears.
   */
  private flashMoment(text: string, x = this.r.banner.x, y = this.r.banner.y + 16): void {
    const dur = feelMs('expressive');
    if (dur <= 0) return;
    const label = this.add
      .text(x, y, text, fontStyle(13, '#f7d23e'))
      .setOrigin(0.5)
      .setDepth(600)
      .setAlpha(0.01);
    this.tweens.add({
      targets: label,
      alpha: 1,
      scale: { from: 0.7, to: 1 },
      duration: dur,
      ease: FEEL.major.ease,
      yoyo: true,
      hold: dur * 2,
      onComplete: () => label.destroy(),
    });
  }

  /**
   * Announces a seat reaching its last card, exactly once per seat per match. It is the loudest
   * single fact in the endgame — somebody can win on their next turn — and it fires at that seat,
   * so the player learns who to worry about rather than just that something happened.
   */
  private announceLastCards(state: GameState): void {
    state.players.forEach((p, i) => {
      if (threatOf(p.hand.length) !== 'last' || p.hand.length === 0) {
        if (p.hand.length > 1) this.lastCardAnnounced.delete(i); // drew back up — it can happen again
        return;
      }
      if (this.lastCardAnnounced.has(i)) return;
      this.lastCardAnnounced.add(i);
      const at = this.seatPosition(i);
      this.flashMoment(t('game.moment.lastCard'), at.x, at.y + 22);
      playSfx(this, 'sfx-invalid', 0.3); // the sharpest cue the game ships; not an error here
    });
  }

  /**
   * END-15: a quieter cue than `announceLastCards` for the rung just below it — 2 cards is worth
   * noticing, not alarming. No banner (that would compete with the 1-card moment for attention);
   * the existing size/colour bump (threatOf) already carries the visual half.
   */
  private announceThreat(state: GameState): void {
    state.players.forEach((p, i) => {
      if (threatOf(p.hand.length) !== 'threat') {
        if (p.hand.length !== 2) this.threatAnnounced.delete(i); // moved off 2 either way — can fire again
        return;
      }
      if (this.threatAnnounced.has(i)) return;
      this.threatAnnounced.add(i);
      playSfx(this, 'sfx-drop', 0.2);
    });
  }

  /** Where a seat sits on screen: the avatar strip for opponents, the hand for the local player. */
  private seatPosition(index: number): { x: number; y: number } {
    if (index === this.localSeat) return { x: this.r.handCenterX, y: this.r.handY };
    let slot = 0;
    for (let i = 0; i < index; i++) if (i !== this.localSeat) slot++;
    return { x: this.r.opponentX0 + slot * this.r.opponentStep, y: this.r.opponentY };
  }

  /**
   * The opening deal. Every card flies off the deck to where it belongs, and a card back flies to
   * each opponent's seat, so the first thing a player learns is where the pile is, which cards are
   * theirs and who else is at the table — without a line of explanation.
   */
  private dealIn(): number {
    const deck = { x: this.r.deckImg.x, y: this.r.deckImg.y };
    // Only hands are dealt. A real match starts with an empty table, so anything already on it is
    // a showcase fixture and should simply be there — giving each card a "previous position" of
    // exactly where it already is leaves it untouched, and keeps the deal to the cards that were
    // actually handed out.
    const alreadyOnTable = new Map<string, { x: number; y: number }>();
    for (const sprite of this.cardSprites) {
      if (sprite.getData('origin') === 'table') alreadyOnTable.set(String(sprite.getData('cardId')), { x: sprite.x, y: sprite.y });
    }
    this.animateBoardFrom(alreadyOnTable, 'expressive', deck, DEAL_STAGGER_MS);
    const flightMs = feelMs('expressive');
    if (flightMs <= 0) return 0;
    const cardBackKey = cosmeticTextureKey(CARD_BACKS, settings.cosmetics().cardBack, DEFAULT_CARD_BACK, debugApi.missingAssets);
    this.store.get().players.forEach((_, i) => {
      if (i === this.localSeat) return;
      const seat = this.seatPosition(i);
      const back = this.add.image(deck.x, deck.y, cardBackKey).setDisplaySize(14, 19).setDepth(300);
      this.tweens.add({
        targets: back,
        x: seat.x,
        y: seat.y,
        alpha: 0,
        delay: i * DEAL_STAGGER_MS * 3,
        duration: flightMs,
        ease: FEEL.expressive.ease,
        onComplete: () => back.destroy(),
      });
    });
    return flightMs + Math.min(MAX_ANIMATED_CARDS, this.cardSprites.length) * DEAL_STAGGER_MS;
  }

  /**
   * `SUA VEZ` arrives as its own beat and then settles into the HUD line it normally is, so the
   * handover is something you notice once rather than a label that was always there.
   */
  private announceTurn(editable = true): void {
    const dur = feelMs('expressive');
    if (dur <= 0) return;
    this.tweens.killTweensOf([this.banner, this.bannerBg]);
    this.banner.setScale(1.6);
    this.bannerBg.setScale(1.6);
    this.tweens.add({
      targets: [this.banner, this.bannerBg],
      scale: 1,
      delay: dur, // hold the big form first — the whole beat lands in roughly 400-600ms
      duration: dur,
      ease: FEEL.expressive.ease,
    });
    // AI-01: an opponent's turn gets the same brief name/turn cue as the player's own — just
    // without the "board becomes editable" wash below, which would be a lie while it's not
    // actually editable.
    if (!editable) return;
    // MEXE-01: "the board becomes editable" gets a beat of its own too, not just the banner — a
    // soft wash across the table that fades as the turn settles in, standing in for a physical
    // lift without needing new art. Self-destroying, so it needs no renderAll teardown entry.
    // N5: sized to the whole felt band (top bar to hand strip, edge to edge) rather than the
    // narrower meld-layout box (tableTop/tableLeft/tableAreaW) — that box's edges don't coincide
    // with anything visible, so a translucent rect stopping there read as a rendering glitch
    // (cutting mid-surface, across the move toast). The top-bar/hand-strip seams are real edges.
    const washTop = this.r.barH;
    const washBottom = this.r.handY - CARD_H / 2 - 4;
    const wash = this.add
      .rectangle(this.r.w / 2, (washTop + washBottom) / 2, this.r.w, washBottom - washTop, CHROME_GOLD, 0.1)
      .setDepth(1);
    this.tweens.add({ targets: wash, alpha: 0, scaleY: 1.015, duration: dur * 2, ease: FEEL.expressive.ease, onComplete: () => wash.destroy() });
  }

  /**
   * The short beat that marks a seat taking over the turn — see the handover note in renderAll.
   * Only the rings animate: the avatar is sized with setDisplaySize (the art ships at 3x), so
   * touching its scale would blow it up to native size rather than pop it.
   */
  private activateSeat(rings: Phaser.GameObjects.Rectangle[]): void {
    const dur = feelMs('fast');
    if (dur <= 0) return;
    for (const ring of rings) {
      const restAlpha = ring.strokeAlpha;
      ring.setScale(0.8).setAlpha(0.01); // not 0: Phaser skips input hit-testing on transparent objects
      this.tweens.add({ targets: ring, scale: 1, alpha: restAlpha, delay: dur, duration: dur, ease: FEEL.normal.ease });
    }
  }

  /**
   * The moment the last unresolved meld comes good. Every meld settles together and a crisp cue
   * lands, so solving the table is something you feel rather than something you notice by checking
   * whether the button went green. Deliberately the only synchronized whole-table effect in the
   * game — it is what makes this the signature moment of a Mexe.
   */
  private playTableResolved(): void {
    // PACE-06: the same cue, a touch louder once the table's own state (not the clock) says the
    // match is hot — a busy/close-to-the-wire table lands with a bit more weight.
    const hot = matchIntensity(this.store.get()).level === 'hot';
    playSfx(this, 'sfx-snap', hot ? 0.8 : 0.65);
    const dur = feelMs('fast');
    if (dur <= 0) return; // reduced motion: the cue and the woken-up button still say it resolved
    for (const { rect } of this.meldGlowRects) {
      this.tweens.add({ targets: rect, scaleX: 1.04, scaleY: 1.04, duration: dur, yoyo: true, ease: FEEL.fast.ease });
    }
  }

  private renderAll(): void {
    if (this.tutorialDirector) this.checkTutorialProgress();
    // D4: every caller that changes the board routes through here, and this destroys and rebuilds
    // every card sprite below — including one mid-drag (e.g. an orientation flip while dragging).
    // Phaser's drag plugin only cleans up on its own dragend/pointerup, which a destroyed sprite
    // can never fire, so without this the drag layer (dragShadow, drop-zone highlights,
    // snapTargets) survived the render as permanent stray UI. Same restore onAppHidden already
    // does on backgrounding — cancelActiveDrag() is a no-op when nothing is dragging.
    this.cancelActiveDrag();
    this.clearGhostPreview();
    // D7: any real edit (undo/redo/drag/drop) re-renders and would otherwise silently overwrite
    // the reset-confirm warning text below while leaving resetArmedUntil (and the button's armed
    // ring) still live — the next single tap on Reset would then wipe the draft with no visible
    // warning. Disarm here, in the one place every such render passes through: the guard's own
    // expiry (onReset's delayedCall) and a committed reset both already zero resetArmedUntil
    // before calling renderAll, so this never fires for those.
    if (this.resetArmedUntil > this.time.now) {
      this.resetArmedUntil = 0;
      this.resetBtn?.setSelected(false);
    }
    // The tooltip's objects live outside `hud`, and a latched (tapped) one has no pointerout to
    // close it — a re-render must not leave it floating over a board it no longer describes.
    this.hideMeldReasonTooltip();
    for (const s of this.cardSprites) s.destroy();
    this.cardSprites = [];
    for (const h of this.hud) h.destroy();
    this.hud = [];
    this.meldZones = [];
    this.hideMeldReasonTooltip();

    const state = this.store.get();
    const active = state.activePlayerIndex;
    const human = this.editor !== null; // editor only exists on the local seat's own turn
    // D14: online input stays live-editable while the socket is reconnecting/closed — nothing
    // desyncs (client.ts returns null and onOnlineSendFailed recovers), but the player only
    // learns the table wasn't actually theirs to edit after FEITO fails, instead of the control
    // being visibly disabled the moment the connection isn't open. Same shape as presentingUntil.
    const connected = this.online === null || this.lastOnlineStatus === 'open';
    const interactive =
      human && connected && !this.onlinePending && !this.onlineResyncing && this.time.now >= this.presentingUntil;

    // top bar: opponents — the active seat gets a bigger avatar + double gold ring, a static (not
    // animated) highlight so it stays reduced-motion-safe with zero extra tweens per render.
    let x = this.r.opponentX0;
    state.players.forEach((p, i) => {
      if (i === this.localSeat) return; // local seat rendered at bottom
      const key = this.avatarKey(i);
      // C6: once winnerId is set the match is over and no seat is "up next" — activePlayerIndex
      // can still point at whoever's turn advance landed on right before the win was detected
      // (e.g. the human goes out, turn flips to the next seat, then winnerId is checked), which
      // left that seat's avatar wearing the active-seat gold ring after the human had already won.
      const isActiveP = i === active && state.winnerId === null;
      const avSize = isActiveP ? 25 : 20;
      // text offset follows the avatar's outer extent (rings included) so it clears them at every
      // size instead of a fixed offset that a short name can end up hiding behind (L3).
      const outer = isActiveP ? avSize + 11 : avSize;
      const textX = x + outer / 2 + 4;
      const av = this.add.image(x, this.r.opponentY, key).setDisplaySize(avSize, avSize);
      const name = this.add.text(textX, this.r.opponentY - 11, p.name, fontStyle(9, isActiveP ? CHROME_GOLD_TEXT : '#d8d0c0'));
      // Hand counts grow and change wording as a seat closes in, so the race is legible from the
      // HUD instead of needing to be counted. Size and the word carry it, never colour alone.
      const threat = threatOf(p.hand.length);
      const countText = threat === 'last' ? t('game.lastCard') : `x${p.hand.length}`;
      const countSize = threat === 'last' ? 11 : threat === 'threat' ? 10 : threat === 'watch' ? 9 : 8;
      const count = this.add.text(textX, this.r.opponentY + 2, countText, fontStyle(countSize, threat === 'none' ? '#f7f2e7' : '#ffb35c'));
      // AI-11: the size/word/colour jump above is the reduced-motion-safe fact of "2 or 1 cards
      // left" — this pulse is the extra decoration on top for a near-win opponent, never the only
      // carrier of the information.
      if (threat === 'threat' || threat === 'last') {
        const pulseDur = feelMs('normal');
        if (pulseDur > 0) this.tweens.add({ targets: count, scale: 1.18, duration: pulseDur, yoyo: true, repeat: -1, ease: FEEL.normal.ease });
      }
      // MEXE-01: "surrounding HUD quiets" while the board is yours to edit — an opponent who is
      // neither active nor a threat recedes a little so attention reads as belonging to the table.
      // Never dims the threat count itself: that signal has to stay legible regardless of whose turn it is.
      if (human && !isActiveP && threat === 'none') { av.setAlpha(0.7); name.setAlpha(0.7); }
      if (isActiveP) {
        const ring = this.add.rectangle(x, this.r.opponentY, avSize + 6, avSize + 6).setStrokeStyle(2, CHROME_GOLD, 1);
        const glow = this.add.rectangle(x, this.r.opponentY, avSize + 11, avSize + 11).setStrokeStyle(1, CHROME_GOLD, 0.4);
        this.hud.push(glow, ring);
        // Handing over is a sequence, not a swap: the hand has just receded, so the seat taking
        // over lights up a beat later rather than at the same instant.
        if (active !== this.lastRenderedActiveSeat) this.activateSeat([ring, glow]);
      }
      this.hud.push(av, name, count);
      x += this.r.opponentStep;
    });
    this.lastRenderedActiveSeat = active;
    this.announceThreat(state);
    this.announceLastCards(state);

    // deck counter
    const cardBackKey = cosmeticTextureKey(CARD_BACKS, settings.cosmetics().cardBack, DEFAULT_CARD_BACK, debugApi.missingAssets);
    const intensity = matchIntensity(state);
    // The pile visibly thins as it drains: running out is one of the two ways a match ends, and it
    // used to be readable only by reading a number.
    const deckHeight = intensity.deckCritical ? 13 : intensity.deckLow ? 16 : 19;
    const deckImg = this.add.image(this.r.deckImg.x, this.r.deckImg.y, cardBackKey).setDisplaySize(14, deckHeight);
    const deckTxt = this.add.text(this.r.deckText.x, this.r.deckText.y, String(state.drawPile.length), fontStyle(intensity.deckLow ? 10 : 9, intensity.deckLow ? '#ffb35c' : '#f7f2e7'));
    this.hud.push(deckImg, deckTxt);
    if (intensity.deckCritical) {
      // Names the ending that is now in play, at the pile it will come from.
      this.hud.push(this.add.text(this.r.deckText.x, this.r.deckText.y + 12, t('game.deckEnding'), fontStyle(6, '#ffb35c')).setOrigin(0, 0));
    }

    // banner
    const activeName = state.players[active]!.name;
    // T-C: once someone has gone out, "Vez de X" is stale for however long the win overlay/scene
    // transition takes to land (the tutorial stays in-scene on a win, see onWin) — the victory beat
    // owns the banner instead of a turn announcement nobody is waiting on.
    this.banner.setText(
      state.winnerId !== null
        ? t('win.title')
        : human
          ? t('game.yourTurn')
          : this.online
            ? t('game.opponentTurn', { name: activeName })
            : t('game.turnOf', { name: activeName }),
    );
    this.bannerBg.setSize(this.banner.width + 14, this.banner.height + 6);

    // table melds (draft when human editing, committed otherwise). One shared analysis pass —
    // invalid-badge display and the FEITO gate below both need it, and each walks every meld.
    const melds = this.editor ? this.editor.getDraft().melds : state.table;
    const analysis = this.editor ? this.analyzeDraft() : null;
    // A meld can carry more than one reason (e.g. the analysis reason plus reason.duplicateCard) —
    // collect all of them, not just the last one a Map key would keep.
    const invalidReasons = new Map<string, string[]>();
    this.renderedMeldStatus.clear();
    for (const r of analysis?.invalidMelds ?? []) {
      const list = invalidReasons.get(r.meldId) ?? [];
      list.push(t(r.reason));
      invalidReasons.set(r.meldId, list);
    }
    // R4: the "show problem" ring never lingers on a meld the player has already fixed — clear it
    // the moment that meld stops being invalid, same render pass, no separate edit hook needed.
    if (this.problemHighlightMeldId && !invalidReasons.has(this.problemHighlightMeldId)) {
      this.problemHighlightMeldId = null;
    }
    // local seat's hand
    const hand = this.editor ? this.editor.getRemainingHand() : state.players[this.localSeat]!.hand;

    // Focused Mexe editor (Phase 14 Wave C, both orientations): only while a live draft exists —
    // losing the editor (turn change) drops back to the normal board. An orientation flip
    // re-lays-out (relayout()) but must not close the editor or touch the draft itself.
    const editorMode = this.mexeEditorOpen && this.editor !== null;
    if (editorMode) {
      this.renderMexeEditor(melds, hand, invalidReasons, interactive, state.config, analysis?.invalidMelds ?? []);
    } else {
      this.layoutMelds(melds, invalidReasons, interactive, state.config, analysis?.invalidMelds ?? []);
      this.layoutHand(hand, interactive, human);
    }

    // buttons + reason
    // D13 follow-up: this used to be gated on `interactive` too, which made debugApi.validation/
    // reasonLine (and the e2e/debug-API mutation helpers that read them right after a
    // debug-triggered renderAll) go dark for the whole deal-lock window, not just the real
    // FEITO/COMPRAR buttons the lock is actually about — those two are still gated below.
    if (this.editor && analysis) {
      const check = analysis.check;
      const becameValid = check.ok && !this.lastValidOk;
      if (becameValid) this.validSince = this.time.now;
      if (!check.ok) this.validSince = null;
      this.lastValidOk = check.ok;
      playlog.noteTableValidity(check.ok, check.ok ? [] : check.reasons);
      // FEITO must not look pressable before it *is* pressable. onFeito refuses a confirm inside
      // CONFIRM_GUARD_MS of the table becoming valid (so a drop that happens to land on the button
      // can't end the turn), and for that quarter second the button used to look live and do
      // nothing. It now stays disabled until the guard is up, and re-renders once when it is.
      const heldLongEnough = this.validSince !== null && this.time.now - this.validSince >= CONFIRM_GUARD_MS;
      if (check.ok && !heldLongEnough && !this.guardTimer) {
        this.guardTimer = this.time.delayedCall(CONFIRM_GUARD_MS, () => {
          this.guardTimer = null;
          // Same clock drift endPresentation() documents: this can fire a frame short of
          // `validSince + CONFIRM_GUARD_MS`, which would re-render FEITO still disabled with
          // nothing left to wake it. Backdate the mark so the guard is unambiguously up.
          if (this.validSince !== null) this.validSince = Math.min(this.validSince, this.time.now - CONFIRM_GUARD_MS);
          if (this.editor) this.renderAll();
        });
      }
      if (becameValid) this.playTableResolved();
      this.setFeitoEnabled(interactive && check.ok && heldLongEnough && this.tutorialAllows({ type: 'feito' }), hand.length === 0);
      this.comprarBtn.setEnabled(interactive && this.tutorialAllows({ type: 'comprar' }));
      // Always live, in every helper mode: "why is DONE greyed out" is the single question the
      // old expert mode left unanswered, and the button no longer carries a ✕ of its own. Expert
      // still gets less than the others — no legal-target glow, no auto-opened badge tooltip, no
      // checklist. The gate itself never changes with the mode: it's canConfirmTurn via check.ok.
      this.reasonText.setText(this.reasonLineText(check.ok, analysis));
      this.fitReasonBackdrop();
      debugApi.reasonLine = this.reasonText.text;
      debugApi.validation = { ok: check.ok, reasons: check.ok ? [] : check.reasons };
    } else {
      this.setFeitoEnabled(false);
      this.comprarBtn.setEnabled(false);
      this.reasonText.setText(human && this.onlinePending ? t('game.pending') : '');
      this.fitReasonBackdrop();
      debugApi.reasonLine = this.reasonText.text;
      debugApi.validation = null;
      this.validSince = null;
      this.lastValidOk = false;
    }
    // Task 4 (Wave C carry-over): the portrait editor toggle looked live to an inactive online
    // player and silently no-op'd on tap. Drive it from the same gate comprarBtn already uses.
    this.mexeToggleBtn?.setEnabled(interactive);
    if (!this.config.tutorial) {
      this.zoomInBtn.setEnabled(!editorMode && this.zoomLevel < ZOOM_FLOORS.length - 1);
      this.zoomOutBtn.setEnabled(!editorMode && this.zoomLevel > 0);
    }

    if (editorMode) {
      // The editor drives its own tap-to-select-then-place targets (see renderMexeEditor) instead
      // of the normal board's drag zones / keyboard focus ring.
      this.focusTargets = [];
      this.clearDropZoneHighlights();
    } else {
      this.renderSelectionLayer(interactive, invalidReasons.size > 0);
    }
    debugApi.a11y = { invalidBadges: invalidReasons.size };
    debugApi.invalidMeldReasons = () => [...invalidReasons].map(([meldId, reasons]) => ({ meldId, reasons }));
    // R1: expose what was actually painted, not what the draft says — the resting-board counterpart
    // of mexe.snapTargets()'s drag-time status, so the two can be asserted to agree.
    debugApi.renderedMeldStatus = () => [...this.renderedMeldStatus].map(([meldId, status]) => ({ meldId, status }));

    // Beginner: auto-open the first invalid meld's tooltip so the reason is visible without a
    // tap/hover. Only one at a time (first meld in table order) so a crowded table doesn't get covered.
    if (interactive && settings.helperFlags().autoShowInvalidReason) {
      const firstInvalid = melds.find((m) => invalidReasons.has(m.id));
      const zone = firstInvalid && this.meldZones.find((z) => z.meldId === firstInvalid.id);
      if (firstInvalid && zone) {
        const rawReason = analysis?.invalidMelds.find((r) => r.meldId === firstInvalid.id)?.reason ?? null;
        this.showMeldReasonTooltip(zone.rect, invalidReasons.get(firstInvalid.id)!.join('\n'), meldStatus(rawReason));
      }
    }

    // Meld focus view (Task 2): landscape only — in portrait the Wave C editor's workspace
    // already shows one meld large plus its reasons, so this would be a second, redundant way to
    // do the same thing there. Landscape has no such view, hence adding it here.
    if (!this.r.portrait && !editorMode) this.renderMeldFocus(melds, invalidReasons, state.config, analysis?.invalidMelds ?? []);

    if (this.tutorialDirector) this.renderTutorialOverlay();
  }

  /** D11: `invalidMelds` is in table-position order, not severity order — a lone real
   * contradiction (duplicate suit, second joker, unassignable joker) sitting next to several
   * trivially-fixable under-3-card melds used to lose to whichever one happened to sit first on
   * the table. `meldStatus()` (src/table/snap.ts) is the one classifier for illegal-vs-incomplete;
   * this only orders by its result, it never re-decides it. Stable otherwise — a tie keeps table
   * order, same as before. Shared by blockingReasonText (the reason line) and cycleProblem (the
   * "show next problem" ring), so the two can never point at a different meld first. */
  private bySeverity(reasons: readonly MeldReason[]): MeldReason[] {
    const rank = (r: MeldReason) => (meldStatus(r.reason) === 'illegal' ? 0 : 1);
    return [...reasons].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * What's blocking FEITO right now: top invalid-meld reason, else the objective-phase text, else
   * the raw canConfirm() reason. Single source for both the on-screen reasonText and the disabled
   * FEITO button's tap feedback, so the two can never disagree.
   *
   * @param known the render pass's own analysis, when there is one. Analysing is the expensive part
   * of a frame, so the reason line, the checklist and the unresolved count all share the single
   * pass renderAll already made rather than each recomputing it.
   */
  private blockingReasonText(known?: DraftAnalysis): string {
    if (!this.editor) return '';
    // While an online socket is down the board is locked, so "play cards or draw one" is an
    // instruction the player cannot follow and that contradicts the reconnect notice sitting
    // above it. The notice is the only thing to say until the table is authoritative again.
    if (this.online && this.lastOnlineStatus !== null && this.lastOnlineStatus !== 'open') return '';
    const analysis = known ?? this.analyzeDraft();
    const check = analysis.check;
    // "what does the game want right now": ready-to-confirm / fix-the-invalid-meld / play-or-draw
    // cover almost every turn; the rare remainder (e.g. a returned table card) falls back to the
    // specific canConfirm() reason, same text as before.
    const phase = objectivePhase(
      check.ok,
      analysis.invalidMelds.length > 0,
      this.editor.getDraft().handCardsPlayed.length > 0,
      this.selectedCardId !== null,
      this.editor.getRemainingHand().length === 0,
    );
    // D11: the real contradiction outranks a merely-incomplete meld for which reason names the
    // problem, even though both keep equal weight in `phase` above (any invalid meld blocks FEITO
    // the same way either way).
    const topInvalidReason = this.bySeverity(analysis.invalidMelds)[0]?.reason ?? null;
    // Emptying your hand outranks whatever else is wrong: "you are one fix from winning" is the
    // headline, and the specific reason rides behind it rather than replacing it.
    if (phase === 'handEmptyInvalid' || phase === 'canBater') {
      const detail = topInvalidReason ? ` ${t(topInvalidReason)}` : '';
      return `${t(objectiveKey(phase))}${detail}`;
    }
    return topInvalidReason ? t(topInvalidReason) : phase ? t(objectiveKey(phase)) : check.ok ? '' : t(check.reasons[0] ?? '');
  }

  /** Matches the reason backdrop to the text currently in it, and hides it when there is none. */
  private fitReasonBackdrop(): void {
    const shown = this.reasonText.text.length > 0;
    this.reasonBg.setVisible(shown);
    if (shown) this.reasonBg.setSize(this.reasonText.width + 8, this.reasonText.height + 4);
  }

  /**
   * How much is left to close, for the reason line. A player mid-Mexe wants to know they are two
   * melds from done, not just that something is currently not a meld — the count turns a verdict
   * into progress, which is the point of temporary invalidity being normal here.
   */
  private unresolvedCountText(open: number): string {
    if (open === 0) return '';
    return t(open === 1 ? 'objective.unresolved.one' : 'objective.unresolved.many', { n: open });
  }

  /**
   * The reason line under/next to FEITO: the top blocking reason, plus (beginner mode, and only
   * where the line has room to wrap) the three-condition DONE checklist. The checklist is a
   * restatement of what canConfirmTurn already reported — see doneChecklist — never its own
   * legality judgement.
   */
  private reasonLineText(ok: boolean, analysis: DraftAnalysis): string {
    const reason = this.blockingReasonText(analysis);
    if (ok || !this.editor) return reason;
    if (!settings.helperFlags().doneChecklist) {
      // Without the checklist, the reason line is the only place the count can live.
      const tail = this.unresolvedCountText(analysis.invalidMelds.length);
      return tail ? `${reason} ${tail}` : reason;
    }
    // The desktop landscape reason lives in a 72-unit-wide column (see regions.ts) where three
    // checklist lines wrap into an unreadable stack. Portrait and the touch-landscape wide strip
    // both have room.
    if (this.r.reason.wrap < 150) return reason;
    const reasons = analysis.check.ok ? [] : analysis.check.reasons;
    let items = doneChecklist(this.editor.getDraft().handCardsPlayed.length, analysis.invalidMelds.length, reasons);
    // Portrait has one narrow band between the hand and the action bar. A full three-line checklist
    // stacked under a wrapped reason overruns it and covers either the buttons or the player's own
    // cards, so there we list only what is still outstanding — which is the part a beginner acts
    // on. Landscape's wide strip has the room, and keeps all three so the conditions stay learnable.
    if (this.r.portrait) items = items.filter((i) => !i.ok);
    return `${reason}\n${formatChecklist(items, t)}`;
  }

  /** Tap on a disabled FEITO: silently ignoring the press hides the reason it's blocked, so surface
   * it explicitly instead of only via the (hover-only, desktop) tint. */
  private onFeitoBlocked(): void {
    const reason = this.blockingReasonText() || t('tooltip.feito');
    this.reasonText.setText(`${t('mobile.feitoBlocked')} ${reason}`);
    playSfx(this, 'sfx-invalid', 0.15);
    // R3: cycleProblem() first — it ends in renderAll(), which destroys and rebuilds the whole
    // `hud` array (meldGlowRects included). checkMyWork() tweens those rects, so it must run
    // *after* renderAll() has rebuilt them, never before — the old order started tweens on
    // objects renderAll destroyed in the same tick, and the "valid melds step back, open ones
    // stay lit" beat never played.
    this.cycleProblem();
    this.checkMyWork();
  }

  /**
   * RECOVERY-13's `show problem` interaction: each blocked-FEITO tap steps to the next unresolved
   * meld, wrapping around, so a crowded table's problems can be walked one at a time instead of
   * only ever naming the first. Opens whichever per-meld detail view is already on screen — the
   * touch editor's own workspace inside it — or, outside the editor, points the static
   * `problemHighlightMeldId` ring at it (R3: deliberately NOT `focusedMeldId` — that field also
   * opens renderMeldFocus's full-screen modal backdrop, which would sit at depth 700 over the
   * FEITO button this was tapped from and swallow the very next "show me the next problem" tap).
   */
  private cycleProblem(): void {
    if (!this.editor) return;
    const analysis = this.analyzeDraft();
    if (analysis.invalidMelds.length === 0) return;
    // D11: same severity order as blockingReasonText, so "show next problem" and the reason line
    // never disagree about which meld is the real contradiction versus a merely-incomplete one.
    // A meld can carry more than one reason (e.g. also reason.duplicateCard) — dedupe by meld id,
    // keeping each meld's place from its worst (first-sorted) entry.
    const seen = new Set<string>();
    const order: string[] = [];
    for (const r of this.bySeverity(analysis.invalidMelds)) {
      if (seen.has(r.meldId)) continue;
      seen.add(r.meldId);
      order.push(r.meldId);
    }
    if (order.length === 0) return;
    const current = this.mexeEditorOpen ? this.mexeEditorMeldId : this.problemHighlightMeldId;
    const idx = current ? order.indexOf(current) : -1;
    const next = order[(idx + 1) % order.length]!;
    if (this.mexeEditorOpen) {
      this.mexeEditorMeldId = next;
    } else {
      // B3: portrait outside the editor has no popup detail view (renderMeldFocus is landscape-only,
      // see its call site), but layoutMelds still draws a static ring around whichever meld is
      // `problemHighlightMeldId` — that ring is the portrait "show problem" feedback, and unlike
      // checkMyWork()'s pulse it needs no motion to read, so it is the reduced-motion fallback too.
      // Landscape gets the same ring, non-modal, so a repeated tap keeps landing on FEITO.
      this.problemHighlightMeldId = next;
    }
    this.renderAll();
  }

  /**
   * A refused FEITO behaves like asking someone to check your work, not like an error dialog: the
   * melds that are fine step back, the ones still open stay lit and nudge, the button shakes once,
   * and Undo brightens for a moment in case the last edit was the mistake.
   *
   * Everything here is temporary and self-reverting. Nothing latches, because a table mid-Mexe is
   * allowed to be unfinished — this is a stronger answer to a direct question, not a punishment.
   */
  private checkMyWork(): void {
    const dur = feelMs('normal');
    // B3: reduced motion drops the pulse/shake below, but onFeitoBlocked() calls cycleProblem()
    // right after this — its static focus ring (layoutMelds) is the non-animated equivalent, so
    // returning early here does not leave the tap with no feedback at all.
    if (dur <= 0) return;
    const open = new Set(this.analyzeDraft().invalidMelds.map((m) => m.meldId));
    for (const { meldId, rect } of this.meldGlowRects) {
      if (open.has(meldId)) {
        this.tweens.add({ targets: rect, scaleX: 1.06, scaleY: 1.06, duration: dur, yoyo: true, repeat: 1, ease: FEEL.fast.ease });
      } else {
        const rest = rect.alpha;
        this.tweens.add({ targets: rect, alpha: rest * 0.25, duration: dur, yoyo: true, ease: FEEL.fast.ease });
      }
    }
    // A short horizontal shake, not a red flash: the press registered, it just cannot go through.
    const x = this.feitoBtn.x;
    this.tweens.add({ targets: this.feitoBtn, x: x + 2, duration: Math.max(1, Math.round(dur / 4)), yoyo: true, repeat: 2, onComplete: () => this.feitoBtn.setX(x) });
    // D10: historyLength() starts at 1 (the turn's seed snapshot) — never 0 — so this always fired
    // even when undo had nothing to undo. > 1 means at least one real edit has been pushed.
    if ((this.editor?.historyLength() ?? 1) > 1) {
      this.undoBtn?.setScale(1);
      this.tweens.add({ targets: this.undoBtn, scale: 1.18, duration: dur, yoyo: true, repeat: 1, ease: FEEL.fast.ease });
    }
  }

  /**
   * FEITO enabled state. The label stays plain FEITO/DONE in both states: the old "✕ FEITO"
   * prefix mixed a cancel glyph into a confirm button and playtesters read it as "press this to
   * cancel". The non-color cue for "blocked" is the reason line right next to the button, which
   * `renderAll` now keeps filled in every helper mode, plus the ✕/✓ checklist in beginner mode.
   */
  /**
   * Three states, not two. Before the player has touched anything there is nothing to confirm, so
   * the button sits back rather than presenting itself as a thing that is refusing to work; once a
   * draft exists it takes normal weight; and when confirming would empty the hand it stops saying
   * FEITO and says BATER, because that press ends the match.
   */
  private setFeitoEnabled(on: boolean, winning = false): void {
    this.feitoBtn.setEnabled(on);
    // D10: same historyLength() baseline as above — 1, not 0, means "nothing played yet".
    const dormant = !on && (this.editor?.historyLength() ?? 1) === 1;
    this.feitoBtn.setAlpha(dormant ? 0.45 : on ? 1 : 0.75);
    this.feitoBtn.setLabel(winning && on ? t('game.bater') : t('game.feito'));
  }

  // ---------- tutorial mode ----------

  /** Advance the script if the current step's fixture goal was reached; keeps debugApi in sync. */
  private checkTutorialProgress(): void {
    const dir = this.tutorialDirector;
    if (!dir) return;
    dir.checkComplete(this.store.get(), this.editor?.getDraft() ?? null);
    if (debugApi.tutorialStep !== dir.stepIndex) playlog.record('tutorial:step', { step: dir.stepIndex });
    debugApi.tutorialStep = dir.stepIndex;
    if (dir.finished && !this.tutorialCompletedRecorded) {
      this.tutorialCompletedRecorded = true;
      settings.setTutorialCompleted();
    }
  }

  /** Speech-bubble panel (right column in landscape, a band over the top of the table in portrait
   * — see r.tutorialPanel): step text, counter, highlights, SKIP/NEXT/REPLAY. */
  private renderTutorialOverlay(): void {
    const dir = this.tutorialDirector;
    if (!dir) return;
    const p = this.r.tutorialPanel;
    const cx = p.x + p.w / 2;
    const panelTop = p.y;
    const panelH = p.h;
    // Portrait's panel is wide and short, so its buttons sit side by side on one row instead of
    // stacked — a stacked pair would eat the whole band and leave no room for the step text.
    const sideBySide = this.r.portrait;
    const btnW = 74;
    const nextX = sideBySide ? cx - 42 : cx;
    const skipX = sideBySide ? cx + 42 : cx;
    const nextY = sideBySide ? panelTop + panelH - 12 : panelTop + panelH - 34;
    const skipY = sideBySide ? panelTop + panelH - 12 : panelTop + panelH - 16;

    const g = this.add.graphics().setDepth(300);
    g.fillStyle(0x1a1410, 0.88);
    g.fillRoundedRect(p.x, panelTop, p.w, panelH, 4);
    g.lineStyle(1, CHROME_GOLD, 0.7);
    g.strokeRoundedRect(p.x, panelTop, p.w, panelH, 4);
    this.hud.push(g);

    // above the panel graphic (depth 300), or the 0.88-alpha fill washes the text out
    this.hud.push(label(this, cx, panelTop + 10, t('tutorial.title'), 7, CHROME_GOLD_TEXT).setDepth(301));
    // TUTORIAL-15: the counter names the phase it's in ("MEXE · 9/12"), not just a bare N/total —
    // the 12 internal steps read as belonging to a turn's real BAIXAR/MEXE/COMPRAR/BATER shape.
    // Finished carries no current step (T-B: dir.step still reports step 12's stale data), so the
    // phase is dropped there rather than showing a phase the lesson is no longer in.
    const counter = dir.finished ? `${dir.stepIndex + 1}/${dir.total}` : `${t(`tutorial.phase.${dir.step.phase}`)} · ${dir.stepIndex + 1}/${dir.total}`;
    this.hud.push(
      label(this, sideBySide ? cx + 60 : cx, sideBySide ? panelTop + 10 : panelTop + 20, counter, 6, '#c0b8a8').setDepth(301),
    );

    // T-A: the completion beat gets its own line instead of the leftover step-12 instruction
    // ("drag the 9♦/7♦ and press DONE") — telling the player to do something they just finished.
    const txt = this.add
      .text(cx, panelTop + (sideBySide ? 20 : 34), t(dir.finished ? 'tutorial.complete' : dir.step.textKey), {
        ...fontStyle(7), align: 'center', wordWrap: { width: p.w - 10 },
      })
      .setOrigin(0.5, 0)
      .setDepth(301);
    this.hud.push(txt);

    // While the opponent is playing, every board control is disabled — say so, or a step that
    // asks for DRAW/DONE reads as a broken button for as long as that turn lasts.
    if (!dir.finished && !this.editor && this.store.get().phase === 'playing') {
      const active = this.store.get().players[this.store.get().activePlayerIndex]!;
      const waitY = Math.min(txt.y + txt.height + 6, nextY - 12);
      this.hud.push(label(this, cx, waitY, t('game.turnOf', { name: active.name }), 6, '#f7d23e').setDepth(301));
    }

    if (dir.finished) {
      // TUTORIAL-13: land straight in the first real match instead of stranding the player on a
      // replay-only screen — REPLAY stays for anyone who wants to redo the lesson.
      this.hud.push(label(this, cx, nextY - 14, t('win.title'), 10, '#f7d23e').setDepth(301));
      this.hud.push(new PixelButton(this, nextX, nextY, t('tutorial.play'), () => this.startFirstMatch(), {
        textureBase: 'btn-feito', w: btnW, h: 14, size: 6, primary: true,
      }).setDepth(302));
      this.hud.push(new PixelButton(this, skipX, skipY, t('tutorial.replay'), () => this.restartTutorial(), {
        textureBase: 'btn-comprar', w: btnW, h: 12, size: 6, color: 0x6b6b73,
      }).setDepth(302));
    } else {
      if (dir.step.allowed.some((a) => a.type === 'next')) {
        this.hud.push(new PixelButton(this, nextX, nextY, t('tutorial.next'), () => {
          dir.next();
          debugApi.tutorialStep = dir.stepIndex;
          this.renderAll();
        }, { textureBase: 'btn-comprar', w: btnW, h: 14, size: 6, color: 0x2e9e50 }).setDepth(302));
      }
      this.hud.push(new PixelButton(this, skipX, skipY, t('tutorial.skip'), () => {
        playlog.record('tutorial:skip', { step: dir.stepIndex });
        gotoScene(this, 'menu');
      }, {
        textureBase: 'btn-comprar', w: btnW, h: 12, size: 6, color: 0x6b6b73,
      }).setDepth(302));
    }

    // T-B: no step is "current" once the script is finished — dir.step still reports step 12's
    // data (highlightCardIds/highlightButtons included), so without this gate the FEITO arrow and
    // card glow kept pointing at a button/cards from a lesson that's already over.
    const highlightIds = dir.finished ? new Set<string>() : new Set(dir.step.highlightCardIds ?? []);
    if (highlightIds.size > 0) {
      for (const s of this.cardSprites) {
        if (!highlightIds.has(s.getData('cardId') as string)) continue;
        const glow = this.add.rectangle(s.x, s.y, CARD_W + 6, CARD_H + 6).setStrokeStyle(1, CHROME_GOLD, 0.9).setDepth(290);
        // reduced motion: the outline itself already marks the card — the pulse is decoration, not information.
        if (settings.motionScale() > 0) this.tweens.add({ targets: glow, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });
        this.hud.push(glow);
      }
    }

    // highlight named buttons (T-B: none once finished — see the card-highlight gate above)
    for (const btnName of dir.finished ? [] : (dir.step.highlightButtons ?? [])) {
      const btn = btnName === 'feito' ? this.feitoBtn : btnName === 'comprar' ? this.comprarBtn : this.undoBtn;
      if (!btn) continue;
      const arrow = label(this, btn.x - 40, btn.y, '▶', 10, '#f7d23e').setDepth(290);
      // reduced motion: the static arrow already points at the button — the wiggle is decoration.
      if (settings.motionScale() > 0) this.tweens.add({ targets: arrow, x: btn.x - 34, duration: 400, yoyo: true, repeat: -1 });
      this.hud.push(arrow);
    }
  }

  private restartTutorial(): void {
    gotoScene(this, 'game', buildTutorialLaunchConfig());
  }

  /** TUTORIAL-13/14: the tutorial's JOGAR button — same mentor (Dona Cida) as the lesson, straight
   * into a real match instead of back to the menu. TUTORIAL-14: a genuinely first-ever match
   * (gamesStarted still 0 — checked before the new scene's init() counts this one) starts with
   * Beginner assistance so the highlights/checklist keep teaching; a REPLAY-then-JOGAR player who
   * already has a match under their belt keeps whatever helper mode they already chose. */
  private startFirstMatch(): void {
    if (settings.progress().gamesStarted === 0) settings.update({ helperMode: 'beginner' });
    gotoScene(this, 'game', {
      seed: urlSeed(),
      players: [{ name: t('menu.you'), isAi: false }, { name: 'Dona Cida', isAi: true, personality: 'cida' }],
    });
  }

  /**
   * Hover-only reason tooltip for an invalid meld (rounded dark rect + yellow text). Shown only
   * while the pointer is over the meld's ✗ badge, so it never permanently occludes a neighboring
   * meld the way an always-on label would at crowded tables — the position is still clamped
   * fully inside the table/HUD area as a defensive belt-and-braces measure.
   */
  /**
   * @param status R2: when this tooltip is naming an actual meld-invalid reason, the text colour
   * must match the outline/badge colour for that same meld — both now come from the one
   * STATUS_COLOR map (src/table/snap.ts) keyed by meldStatus(). Omitted for purely informational hints
   * (joker-stands-for, the 🔍 focus icon) that carry no legal/illegal verdict of their own; those
   * keep the neutral gold they always had.
   */
  private showMeldReasonTooltip(rect: Phaser.Geom.Rectangle, text: string, status?: SnapStatus): void {
    this.hideMeldReasonTooltip();
    const maxW = this.r.tooltip.maxW;
    const txt = label(this, 0, 0, text, 8, status ? STATUS_COLOR[status].text : STATUS_COLOR.incomplete.text).setDepth(500);
    txt.setWordWrapWidth(maxW - 8, true);
    const w = Math.min(maxW, txt.width + 8);
    const h = txt.height + 6;
    const x = Phaser.Math.Clamp(rect.centerX, w / 2 + 2, this.r.tooltip.maxX);
    const y = Phaser.Math.Clamp(rect.bottom + 6 + h / 2, h / 2 + 2, this.r.tooltip.maxY);
    const g = this.add.graphics().setDepth(499);
    g.fillStyle(0x1a1410, 0.9);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 3);
    txt.setPosition(x, y);
    this.meldTooltip = [g, txt];
  }

  private hideMeldReasonTooltip(): void {
    for (const g of this.meldTooltip) g.destroy();
    this.meldTooltip = [];
  }

  private avatarKey(playerIndex: number): string {
    if (playerIndex === this.localSeat) {
      return cosmeticTextureKey(AVATARS, settings.cosmetics().avatar, DEFAULT_AVATAR, debugApi.missingAssets);
    }
    const p = this.personalities[playerIndex];
    return p ? `avatar-${p}` : 'avatar-player';
  }

  /** R8: the one call site for invalidMeldDetail — layoutMelds (landscape) and renderMexeEditor's
   * workspace (touch editor) both route through this instead of each calling the pure function
   * directly, so the two can never quietly drift apart on what "the conflicting card(s)"/"the
   * missing slot" means for the same (cards, reason) pair. */
  private meldDetailFor(cards: readonly Card[], rawReason: ReasonCode | null | undefined): InvalidDetail | undefined {
    return rawReason ? invalidMeldDetail(cards, rawReason) : undefined;
  }

  private layoutMelds(
    melds: readonly Meld[],
    invalidReasons: Map<string, string[]>,
    interactive: boolean,
    config: RulesConfig,
    rawInvalid: DraftAnalysis['invalidMelds'] = [],
  ): void {
    this.meldGlowRects = [];
    this.tableMaskGfx?.destroy();
    this.tableMaskGfx = null;
    this.tableContainer?.destroy();
    this.tableContainer = null;
    this.tablePanTargets = [];
    const handCardIds = new Set(this.editor?.getDraft().handCardsPlayed ?? []);
    // MEXE-19/RECOVERY-04: a run's missing-slot placeholder needs its own reserved column, not a
    // squeeze between two real cards — compute it before layout so computeMeldLayout accounts for
    // it in the meld's width and every card after the gap shifts right to make room.
    const detailByMeld = new Map<string, InvalidDetail>();
    for (const m of melds) {
      const raw = rawInvalid.find((r) => r.meldId === m.id)?.reason;
      const detail = this.meldDetailFor(sortMeldCards(m.cards), raw);
      if (detail) detailByMeld.set(m.id, detail);
    }
    const inputs: MeldLayoutInput[] = melds.map((m) => ({
      id: m.id,
      cardCount: m.cards.length + (detailByMeld.get(m.id)?.missingSlotIndex !== undefined ? 1 : 0),
    }));
    const floor = ZOOM_FLOORS[this.zoomLevel];
    const positions = computeMeldLayout(inputs, this.r.tableAreaW, this.r.tableAreaH, floor ? { minCardScale: floor } : undefined);
    const posByMeld = new Map(positions.map((p) => [p.meldId, p]));

    // Zoomed content can be taller than the table area — clamp the pan window to it (reuses the
    // editor's own clampScroll pattern) and clip the overflow so it never spills into the top bar,
    // hand, or action panel. At the default zoom (floor undefined) neither runs: content already
    // fits, so today's landscape rendering is untouched.
    this.tableContentH = positions.length > 0 ? Math.max(...positions.map((p) => p.y + p.height)) : 0;
    this.tablePan = floor ? clampScroll(this.tablePan, this.tableContentH, this.r.tableAreaH) : 0;
    // Reuses one Container as the mask target instead of setMask() per object (see tableContainer
    // doc comment) — `container` is only defined while zoomed, so applyMask degrades to a no-op
    // exactly like the old per-object setMask() did at the default zoom.
    let container: Phaser.GameObjects.Container | undefined;
    const applyMask = <T extends Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform>(o: T): T => {
      if (container) container.add(o);
      // Every masked object is exactly the set whose y is offset by tablePan (see layoutMelds'
      // `cy = ... - this.tablePan` below) — reuse that gate to track pan-follow targets too.
      if (floor) this.tablePanTargets.push(o);
      return o;
    };
    if (floor) {
      const maskGfx = this.make.graphics(undefined, false);
      maskGfx.fillStyle(0xffffff);
      maskGfx.fillRect(this.r.tableLeft, this.r.tableTop, this.r.tableAreaW, this.r.tableBottom - this.r.tableTop);
      this.tableMaskGfx = maskGfx;
      container = this.add.container(0, 0);
      // Phaser 4 ignores setMask() under WebGL ("use a Mask filter instead"), so the geometry mask
      // this used to build silently did nothing and a zoomed table's rows spilled over the top bar
      // and the hand. A Mask filter on the container is the supported form.
      container.enableFilters();
      container.filters?.internal.addMask(maskGfx, false, undefined, 'world');
      this.tableContainer = container;

      // Pan surface: the empty table background, added first (lowest depth) so a card sitting on
      // top of it always wins the pointer hit-test — dragging a card can never start a pan, and
      // panning can never move a card. See tests/pan-precedence in e2e for the guard.
      const panBg = this.add
        .rectangle(this.r.tableLeft + this.r.tableAreaW / 2, this.r.tableTop + (this.r.tableBottom - this.r.tableTop) / 2, this.r.tableAreaW, this.r.tableBottom - this.r.tableTop, 0x000000, 0)
        .setDepth(-5)
        .setInteractive({ useHandCursor: false });
      panBg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        this.panDragStartY = p.worldY;
        this.panDragStartPan = this.tablePan;
      });
      panBg.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const next = clampScroll(this.panDragStartPan - (p.worldY - this.panDragStartY), this.tableContentH, this.r.tableAreaH);
        if (next !== this.tablePan) {
          // Reposition only — never renderAll()/analyze() mid-gesture (finding 1, Phase 14 review).
          // The draft doesn't change while panning, so nothing needs re-analyzing per tick; a single
          // renderAll() on pointerup settles everything (clamping, meldZones, mask) authoritatively.
          const delta = next - this.tablePan;
          this.tablePan = next;
          for (const o of this.tablePanTargets) o.y -= delta;
          for (const z of this.meldZones) z.rect.y -= delta;
        }
      });
      panBg.on('pointerup', () => this.renderAll());
      panBg.on('pointerupoutside', () => this.renderAll());
      this.hud.push(panBg);
    }

    if (melds.length === 0 && interactive) this.drawEmptyTableGuide();

    melds.forEach((meld, meldIndex) => {
      const pos = posByMeld.get(meld.id);
      if (!pos) return; // computeMeldLayout always returns one per meld; defensive only
      const scale = pos.cardScale;
      const pad = MELD_PAD * scale;
      const cx = this.r.tableLeft + pos.x;
      const cy = this.r.tableTop + 6 + pos.y - this.tablePan;
      const cards = sortMeldCards(meld.cards);

      const zoneRect = new Phaser.Geom.Rectangle(cx, cy - pad, pos.width, pos.height);
      this.meldZones.push({ meldId: meld.id, rect: zoneRect });

      // Cull rows scrolled fully outside the visible band (CI perf: fill rate, not draw-call
      // count, is the dominant software-rasterizer cost at scale 1.0 — a crowded zoomed table's
      // content is often several rows taller than the table area, so most rows are off-screen and
      // skipping their sprite creation entirely is real pixels never drawn, not just hidden by the
      // mask). meldZones above is pushed unconditionally and untouched by this: a real pointer can
      // never land inside a rect that's outside the visible viewport anyway, so a culled row's zone
      // sitting in the array is inert, never mis-targetable. The margin (one row's own height,
      // constant across every row while zoomed — see computeMeldLayout's fixed `rowH`) keeps a
      // partially-visible row rendered and absorbs the pan drift between pointermove ticks; the
      // gesture's own pointerup already calls renderAll() once to resettle the rendered set for
      // wherever panning ends up.
      if (floor) {
        const margin = pos.height;
        if (zoneRect.bottom < this.r.tableTop - margin || zoneRect.y > this.r.tableBottom + margin) return;
      }

      // Mexe UX: alternating neutral shading (independent of validity color) keeps crowded adjacent melds visually distinct.
      if (meldIndex % 2 === 1) {
        const shade = applyMask(
          this.add.rectangle(zoneRect.centerX, zoneRect.centerY, zoneRect.width, zoneRect.height, 0x000000, 0.12).setDepth(-1),
        );
        this.hud.push(shade);
      }

      const isInvalid = invalidReasons.has(meld.id);
      // MEXE-19/RECOVERY-04: point at the exact problem instead of only naming it — the conflicting
      // card(s) pulse and, for a run with a single gap, a dashed "missing card" slot appears where it
      // belongs. Presentation only: invalidMeldDetail never re-judges legality, just reads the same
      // reason the validator already gave for this meld.
      const rawReason = rawInvalid.find((r) => r.meldId === meld.id)?.reason ?? null;
      const detail = detailByMeld.get(meld.id);
      // B2/R1: under-length / no contradiction (too few cards, or a run missing one step) reads as
      // 'incomplete', not 'illegal' — a lone card or a single-gap run mid-rearrange must not carry
      // the same red alarm as a genuine contradiction (duplicate suit, mismatched suit, joker
      // overflow/unassignable, ...). meldStatus() (src/table/snap.ts) is the single classifier for
      // this — drag-time (snap.ts targetFor) and the resting board both call it now, so they can
      // never disagree about a reason's severity again.
      const status: SnapStatus = !isInvalid ? 'legal' : meldStatus(rawReason);
      this.renderedMeldStatus.set(meld.id, status);
      const color = STATUS_COLOR[status].fill;
      // Joker hint: never derive this ourselves — analyzeMeld is the single source of truth for
      // what a joker stands for. Skipped only on a genuine contradiction (task requirement: never
      // invent an assignment there) — an incomplete meld can still legitimately resolve one.
      const jokerLabels = jokerLabelsForMeld(meld, status !== 'illegal');
      // colorblind-safe shape channel: solid stroke for valid, dashed for incomplete/illegal — not hue alone.
      const glow = applyMask(
        this.add
          .rectangle(zoneRect.centerX, zoneRect.centerY, zoneRect.width, zoneRect.height, color, this.editor ? 0.18 : 0.1)
          .setDepth(2),
      );
      if (isInvalid) {
        const dashed = applyMask(this.add.graphics().setDepth(2));
        // incomplete gets the same lighter "still working on it" weight the drag-time painter
        // uses for 'incomplete' zones; a real contradiction keeps the stronger alarm weight.
        const weight = status === 'incomplete' ? (this.editor ? 0.55 : 0.3) : this.editor ? 0.9 : 0.4;
        this.drawDashedRect(dashed, zoneRect.x, zoneRect.y, zoneRect.width, zoneRect.height, color, weight);
        this.hud.push(dashed);
      } else {
        glow.setStrokeStyle(1, color, this.editor ? 0.9 : 0.4);
      }
      this.hud.push(glow);
      this.meldGlowRects.push({ meldId: meld.id, rect: glow });

      // B3/R3/R4: static (non-animated) pointer at whichever meld cycleProblem() last targeted —
      // the reduced-motion-safe half of "show problem", non-modal (see problemHighlightMeldId's
      // doc comment). A dashed light-blue ring: solid gold is already the 'incomplete' outline
      // colour, so a solid gold ring here would read as a second, contradictory status instead of
      // "look here" (R4) — dashed + a colour no status uses keeps the two unmistakably separate.
      if (this.problemHighlightMeldId === meld.id) {
        const focusRing = applyMask(this.add.graphics().setDepth(6));
        this.drawDashedRect(focusRing, zoneRect.x - 3, zoneRect.y - 3, zoneRect.width + 6, zoneRect.height + 6, 0x6fc3ff, 0.95, 2, 8, 4);
        this.hud.push(focusRing);
      }

      // colorblind-safe icon channel: ✓/✗ badge, only while the human is actively editing (committed melds are always valid).
      if (interactive) {
        // Bigger, easier to hit on touch/portrait — same dashed-outline shape channel either way,
        // colour is never the only cue.
        const strong = this.r.touch || this.r.portrait;
        const badgeSize = isInvalid && strong ? 10 : 7;
        const badgeColor = STATUS_COLOR[status].text;
        const badge = applyMask(
          label(this, zoneRect.x + 4, zoneRect.y + 2, isInvalid ? '✗' : '✓', badgeSize, badgeColor)
            .setOrigin(0, 0)
            .setAlpha(isInvalid ? 0.95 : 0.35)
            .setDepth(50),
        );
        this.hud.push(badge);
        // Full reason text only on hover, never rendered by default: at crowded tables rows sit
        // close together and any always-on label wide enough to read would spill onto a
        // neighboring meld. Hover is also the "nearest free space" — the tooltip is clamped
        // fully inside the table area so it can never render off the visible playfield.
        const reasons = invalidReasons.get(meld.id);
        if (reasons) {
          const reasonText = reasons.join('\n');
          // Enlarged hit rect: the glyph itself is a few px, far under a usable touch target.
          // Kept small on touch/portrait (2px) — a bigger pad here covers the card art
          // underneath and wins the hit test over tap/drag on the card (see IOS_UI_UX_AUDIT.md).
          const pad = strong ? 2 : 5;
          badge.setInteractive(
            new Phaser.Geom.Rectangle(-pad, -pad, badge.width + pad * 2, badge.height + pad * 2),
            Phaser.Geom.Rectangle.Contains,
          );
          // Tappable, not just hover-only: touch devices have no hover, and a tap there emits
          // pointerover -> pointerdown -> pointerup -> pointerout in one gesture. So the tap
          // latches (`tapped`) and pointerout only hides while unlatched — otherwise the release
          // half of the very tap that opened the tooltip would close it again the same instant.
          let tapped = false;
          badge.on('pointerover', () => this.showMeldReasonTooltip(zoneRect, reasonText, status));
          badge.on('pointerout', () => {
            if (!tapped) this.hideMeldReasonTooltip();
          });
          badge.on('pointerdown', () => {
            tapped = !tapped;
            if (tapped) this.showMeldReasonTooltip(zoneRect, reasonText, status);
            else this.hideMeldReasonTooltip();
          });
        }
      }

      // Meld focus view (Task 2, landscape only — see renderMeldFocus): a small read-only
      // magnifier per meld, top-right corner of the zone (the ✗/✓ badge already owns top-left).
      // Never gated on `interactive` — it only reads melds/invalidReasons, works on any turn.
      if (!this.r.portrait) {
        const focusIcon = applyMask(
          label(this, zoneRect.x + zoneRect.width - 3, zoneRect.y + 2, '🔍', 7, '#d8c890')
            .setOrigin(1, 0)
            .setAlpha(0.55)
            .setDepth(50),
        );
        // The glyph itself is ~7 units — under any usable tap target. Grow the hit rect past the
        // art (same fix the invalid badge already carries), so a finger, or a click a pixel off
        // the corner, opens the focus view instead of selecting the card underneath.
        const focusPad = 4;
        focusIcon
          .setInteractive(
            new Phaser.Geom.Rectangle(-focusPad, -focusPad, focusIcon.width + focusPad * 2, focusIcon.height + focusPad * 2),
            Phaser.Geom.Rectangle.Contains,
          );
        if (focusIcon.input) focusIcon.input.cursor = 'pointer';
        focusIcon.on('pointerup', () => {
          this.focusedMeldId = meld.id;
          this.renderAll();
        });
        focusIcon.on('pointerover', () => this.showMeldReasonTooltip(zoneRect, t('tooltip.meldFocus')));
        focusIcon.on('pointerout', () => this.hideMeldReasonTooltip());
        if (this.r.touch) {
          // No hover on touch: show on tap and auto-hide, same pattern as PixelButton's tooltip.
          focusIcon.on('pointerdown', () => {
            this.showMeldReasonTooltip(zoneRect, t('tooltip.meldFocus'));
            this.time.delayedCall(2500, () => this.hideMeldReasonTooltip());
          });
        }
        this.hud.push(focusIcon);
      }

      // MEXE-19/RECOVERY-04: cards at/after the reserved gap column shift one cardGap right so the
      // placeholder gets its own space instead of overlapping the next real card.
      const slotAt = detail?.missingSlotIndex;
      const visualIndex = (i: number): number => (slotAt !== undefined && i >= slotAt ? i + 1 : i);
      cards.forEach((card, i) => {
        const cw = CARD_W * scale;
        const ch = CARD_H * scale;
        const x = cx + pad + cw / 2 + visualIndex(i) * pos.cardGap;
        const y = cy + ch / 2;
        const sprite = this.makeCardSprite(x, y, card, interactive, 'table', handCardIds.has(card.id), scale);
        sprite.setDepth(3);
        applyMask(sprite);
        this.cardSprites.push(sprite);
        const jokerLabel = jokerLabels.get(card.id);
        if (jokerLabel) {
          // Read-only hover, works even when it isn't the local player's turn — separate from
          // the drag/tap interactivity above, which is gated on `interactive`.
          if (!sprite.input) sprite.setInteractive();
          const rect = new Phaser.Geom.Rectangle(x - cw / 2, y - ch / 2, cw, ch);
          sprite.on('pointerover', () => this.showMeldReasonTooltip(rect, t('joker.standsFor', { card: jokerLabel })));
          sprite.on('pointerout', () => this.hideMeldReasonTooltip());
          if (this.r.touch) {
            // No hover on touch: show on tap and auto-hide, same pattern as PixelButton's tooltip.
            sprite.on('pointerdown', () => {
              this.showMeldReasonTooltip(rect, t('joker.standsFor', { card: jokerLabel }));
              this.time.delayedCall(2500, () => this.hideMeldReasonTooltip());
            });
          }
        } else if (card.isJoker && detail?.conflictCardIds.includes(card.id)) {
          // RECOVERY-14: a joker with nowhere to go still gets a plain-language reason instead of
          // silence — "never invent an assignment" only meant never claiming it stands for a card.
          const failText = rawReason === 'reason.tooManyJokers' ? t('joker.tooMany') : rawReason === 'reason.jokerUnassignable' ? t('joker.noRole') : null;
          if (failText) {
            if (!sprite.input) sprite.setInteractive();
            const rect = new Phaser.Geom.Rectangle(x - cw / 2, y - ch / 2, cw, ch);
            sprite.on('pointerover', () => this.showMeldReasonTooltip(rect, failText, 'illegal'));
            sprite.on('pointerout', () => this.hideMeldReasonTooltip());
            if (this.r.touch) {
              sprite.on('pointerdown', () => {
                this.showMeldReasonTooltip(rect, failText, 'illegal');
                this.time.delayedCall(2500, () => this.hideMeldReasonTooltip());
              });
            }
          }
        } else if (card.isJoker && status === 'incomplete') {
          // R5: N6's "always show a role" was dead code — analyzeMeld returns no assignments for
          // an under-length/gapped meld, so jokerLabels is always empty here and this joker got no
          // hint at all. A concrete role is genuinely impossible before the meld is complete (e.g.
          // a 2-card meld), so the honest delivery is an explicit "not decided yet" hint rather
          // than reusing the illegal-joker failText (this isn't a contradiction) or inventing one.
          if (!sprite.input) sprite.setInteractive();
          const rect = new Phaser.Geom.Rectangle(x - cw / 2, y - ch / 2, cw, ch);
          const hint = t('joker.roleUnknown');
          sprite.on('pointerover', () => this.showMeldReasonTooltip(rect, hint, 'incomplete'));
          sprite.on('pointerout', () => this.hideMeldReasonTooltip());
          if (this.r.touch) {
            sprite.on('pointerdown', () => {
              this.showMeldReasonTooltip(rect, hint, 'incomplete');
              this.time.delayedCall(2500, () => this.hideMeldReasonTooltip());
            });
          }
        }
        if (this.lastMoveIds.has(card.id)) {
          // Coherence-2: this used to be a 1px ring nested half a pixel inside the conflict ring's
          // 2px one (cw+3 vs cw+4) — a third near-identical ring in the exact hue band between
          // incomplete-gold and illegal-red, even though it means recency/ownership, not status.
          // A small corner dot carries "the opponent touched this" on a channel status doesn't
          // already own, so it can never be mistaken for (or visually collide with) a status ring.
          const mark = applyMask(
            this.add.circle(x + cw / 2 - 2, y - ch / 2 + 2, 2, 0xf0a030, 1).setStrokeStyle(1, 0x1a0f0a, 0.9).setDepth(5),
          );
          this.hud.push(mark);
        }
        // MEXE-19/RECOVERY-04: the exact card(s) breaking this meld, not just the meld outline.
        // Shape (thicker ring) + a pulse carries it, never colour alone — the ring itself is still
        // there, static, under reduced motion.
        if (detail?.conflictCardIds.includes(card.id)) {
          const ring = applyMask(
            this.add.rectangle(x, y, cw + 4, ch + 4).setStrokeStyle(2, parseInt(STATUS_COLOR.illegal.text.slice(1), 16), 0.95).setDepth(4),
          );
          this.hud.push(ring);
          const dur = feelMs('normal');
          if (dur > 0) this.tweens.add({ targets: ring, scaleX: 1.1, scaleY: 1.1, duration: dur, yoyo: true, repeat: -1, ease: FEEL.normal.ease });
        }
      });
      // MEXE-19/RECOVERY-04: a run missing exactly one step gets a dashed placeholder in its own
      // reserved column (see `inputs` above), named when the missing rank/suit is unambiguous —
      // "here" beats "somewhere". No longer squeezed between two real cards: computeMeldLayout was
      // told about this extra column up front, so it sized/spaced the whole meld to fit it.
      if (slotAt !== undefined) {
        const cw = CARD_W * scale;
        const ch = CARD_H * scale;
        const slotX = cx + pad + cw / 2 + slotAt * pos.cardGap;
        const slotY = cy + ch / 2;
        const slotGfx = applyMask(this.add.graphics().setDepth(3));
        this.drawDashedRect(slotGfx, slotX - cw / 2, slotY - ch / 2, cw, ch, STATUS_COLOR.incomplete.fill, 0.85);
        this.hud.push(slotGfx);
        if (detail?.missingCard) {
          const missing = detail.missingCard;
          // N12: at font size 6 only the dashed box survives portrait's smaller card scale — bump
          // to the same "strong" size the invalid badge already uses there so "here" still reads
          // as "this exact card" instead of degrading to just "something goes here".
          const slotFontSize = this.r.touch || this.r.portrait ? 9 : 6;
          const slotLabel = applyMask(
            label(this, slotX, slotY, `${SUIT_CHAR[missing.suit]}${rankLabel(missing.rank)}`, slotFontSize, STATUS_COLOR.incomplete.text).setOrigin(0.5).setDepth(4),
          );
          this.hud.push(slotLabel);
        }
      }
    });
  }

  /**
   * Meld focus view (Task 2, landscape only): a big read-only look at one meld plus its invalid
   * reason(s), opened via the 🔍 icon layoutMelds() draws on every meld zone. Dismissible by the ✕
   * or a tap anywhere outside the panel. Reuses the ghost-preview panel's own look (dark rounded
   * rect, small status-colored text, card row) so the board never grows a second panel style.
   * Purely additive drawing over whatever renderAll() already built this pass — never touches the
   * editor/draft, so it can never disagree with (or mutate) the real board.
   */
  private renderMeldFocus(
    melds: readonly Meld[],
    invalidReasons: Map<string, string[]>,
    config: RulesConfig,
    rawInvalid: DraftAnalysis['invalidMelds'] = [],
  ): void {
    if (this.focusedMeldId === null) return;
    const meld = melds.find((m) => m.id === this.focusedMeldId);
    if (!meld) {
      // undone/reset/turn ended out from under it — never point the panel at nothing
      this.focusedMeldId = null;
      return;
    }
    const cards = sortMeldCards(meld.cards);
    const isInvalid = invalidReasons.has(meld.id);
    // R1/R2: same single classifier every other renderer now uses — never a second illegal/
    // incomplete judgement of its own.
    const rawReason = rawInvalid.find((r) => r.meldId === meld.id)?.reason ?? null;
    const status: SnapStatus = isInvalid ? meldStatus(rawReason) : 'legal';
    const jokerLabels = jokerLabelsForMeld(meld, !isInvalid);

    const cw = CARD_W * 1.6;
    const ch = CARD_H * 1.6;
    const maxSpread = this.r.w - 60;
    const gap = Math.min(cw + 6, cards.length > 1 ? maxSpread / (cards.length - 1) : cw);
    const cardsW = cards.length > 0 ? (cards.length - 1) * gap + cw : cw;
    const reasons = invalidReasons.get(meld.id);
    const reasonText = reasons?.join('\n') ?? '';
    const statusText = isInvalid ? reasonText : t('snap.legal');
    const statusColor = STATUS_COLOR[status].text;

    const panelW = Math.min(this.r.w - 20, Math.max(140, cardsW + 24));
    const st = label(this, 0, 0, statusText, 8, statusColor);
    st.setWordWrapWidth(panelW - 16, true);
    const panelH = 14 + ch + 10 + st.height + 10;
    const cx = this.r.w / 2;
    const cy = this.r.h / 2;

    const close = () => {
      this.focusedMeldId = null;
      this.renderAll();
    };
    const objs: Phaser.GameObjects.GameObject[] = [];

    // Full-scene backdrop: dismiss on any tap outside the panel, and blocks input to whatever's
    // behind it (cards, zoom pan, badges) while the panel is open — a focus view is modal.
    const backdrop = this.add.rectangle(cx, cy, this.r.w, this.r.h, 0x000000, 0.45).setDepth(700).setInteractive({ useHandCursor: false });
    backdrop.on('pointerup', close);
    objs.push(backdrop);

    const g = this.add.graphics().setDepth(701);
    g.fillStyle(0x1a1410, 0.96);
    g.fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 4);
    g.lineStyle(1, CHROME_GOLD, 0.6);
    g.strokeRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 4);
    objs.push(g);

    const rowY = cy - panelH / 2 + 14 + ch / 2;
    const startX = cx - cardsW / 2 + cw / 2;
    cards.forEach((card, i) => {
      const key = card.isJoker ? 'card-joker' : `card-${card.suit}-${card.rank}`;
      const x = startX + i * gap;
      const img = this.add.image(x, rowY, key).setDisplaySize(cw, ch).setDepth(702);
      objs.push(img);
      const hint = jokerLabels.get(card.id);
      if (hint) objs.push(label(this, x, rowY + ch / 2 + 7, hint, 7, '#f7d23e').setDepth(702));
      // C4: R5's "role not decided yet" hint existed in layoutMelds and the editor workspace but
      // not here — the surface a player opens specifically to understand a meld. Same trigger
      // (joker + incomplete status), same tooltip helper, ported rather than reinvented.
      else if (card.isJoker && status === 'incomplete') {
        img.setInteractive({ useHandCursor: false });
        const rect = new Phaser.Geom.Rectangle(x - cw / 2, rowY - ch / 2, cw, ch);
        const roleHint = t('joker.roleUnknown');
        img.on('pointerover', () => this.showMeldReasonTooltip(rect, roleHint, 'incomplete'));
        img.on('pointerout', () => this.hideMeldReasonTooltip());
        if (this.r.touch) {
          img.on('pointerdown', () => {
            this.showMeldReasonTooltip(rect, roleHint, 'incomplete');
            this.time.delayedCall(2500, () => this.hideMeldReasonTooltip());
          });
        }
      }
    });

    st.setPosition(cx, cy + panelH / 2 - 10 - st.height / 2).setDepth(702);
    objs.push(st);

    objs.push(
      new PixelButton(this, cx + panelW / 2 - 10, cy - panelH / 2 + 10, '✕', close, {
        textureBase: 'btn-small', w: 14, h: 12, size: 8, color: 0x8e4632,
      }).setDepth(703),
    );

    this.hud.push(...objs);
  }

  /**
   * An empty table is the one board state with nothing to read, and it is the one a new player
   * meets first. Rather than explain in a sentence, show the two shapes the game accepts: three
   * in a row of one suit, or three of a kind. Ghosted, non-interactive, and gone the moment the
   * first meld exists — this is a starting point, not a permanent instruction panel.
   */
  private drawEmptyTableGuide(): void {
    const cx = this.r.tableLeft + this.r.tableAreaW / 2;
    const cy = this.r.tableTop + this.r.tableAreaH / 2;
    const examples: [string, string[]][] = [
      [t('game.empty.run'), ['card-hearts-5', 'card-hearts-6', 'card-hearts-7']],
      [t('game.empty.set'), ['card-clubs-9', 'card-hearts-9', 'card-spades-9']],
    ];
    const rowH = 30;
    const top = cy - ((examples.length - 1) * rowH) / 2 - 8;
    this.hud.push(this.add.text(cx, top - 20, t('game.empty.title'), fontStyle(8, '#c0b8a8')).setOrigin(0.5));
    examples.forEach(([caption, keys], row) => {
      const y = top + row * rowH;
      keys.forEach((key, i) => {
        if (!this.textures.exists(key)) return;
        const ghost = this.add.image(cx - 34 + i * 15, y, key).setDisplaySize(13, 17).setAlpha(0.32);
        this.hud.push(ghost);
      });
      this.hud.push(this.add.text(cx + 12, y, caption, fontStyle(7, '#a89e8c')).setOrigin(0, 0.5));
    });
  }

  private sortedHand(hand: readonly Card[]): Card[] {
    return [...hand].sort((a, b) => {
      if (a.isJoker || b.isJoker) {
        if (a.isJoker && b.isJoker) return a.id.localeCompare(b.id);
        return a.isJoker ? 1 : -1;
      }
      return this.sortMode === 'suit'
        ? a.suit!.localeCompare(b.suit!) || a.rank! - b.rank!
        : a.rank! - b.rank! || a.suit!.localeCompare(b.suit!);
    });
  }

  /**
   * @param active whether this is the local player's own turn. The hand is lit and forward when it
   * is, and sits back — dimmer and a touch smaller — when it is not, so "can I act right now?" is
   * answered by the cards themselves and not only by the banner. Never the sole signal: the banner
   * text and the disabled buttons say the same thing without relying on brightness.
   */
  private layoutHand(hand: readonly Card[], interactive: boolean, active: boolean): void {
    const sorted = this.sortedHand(hand);
    const maxSpan = this.r.handSpan;
    // Spacing adapts down to a floor, not to nothing. Dividing the span by the card count alone
    // meant a long hand squeezed every card into a sliver where the rank corner was unreadable;
    // below MIN_HAND_GAP the cards keep a legible overlap and the row scrolls instead.
    const fitted = sorted.length > 1 ? maxSpan / (sorted.length - 1) : CARD_W;
    const gap = Math.min(CARD_W + 2, Math.max(fitted, MIN_HAND_GAP));
    const total = (sorted.length - 1) * gap;
    const overflow = Math.max(0, total - maxSpan);
    if (overflow === 0) this.handScroll = 0;
    this.handScroll = Phaser.Math.Clamp(this.handScroll, 0, overflow);
    const startX = this.r.handCenterX - Math.min(total, maxSpan) / 2 - this.handScroll;
    if (overflow > 0 && interactive) this.enableHandScroll(overflow);
    // MOBILE-16: enableHandScroll's gesture needs a reachable strip pixel above/below the card
    // row. Every card in an overflowing hand overlaps its neighbours horizontally by design (the
    // "readable overlap" MOBILE-15 prefers over unreadable compression), so the strip is only
    // ever reachable vertically — but the default touch-friendly hit pad (MOBILE-06, ~9.6 units)
    // plus the card's own half-height (16) exceeds the hand zone's half-height (24), leaving no
    // margin at all. Shrink the pad only here, only while overflowing: tap precision between
    // already-overlapping cards is resolved by depth order, not by hit-area size, so this costs
    // nothing real.
    const overflowVPad = overflow > 0 ? Math.max(0, (this.r.handZone.h - CARD_H) / 2 - 2) : undefined;
    sorted.forEach((card, i) => {
      const sprite = this.makeCardSprite(startX + i * gap, this.r.handY, card, interactive, 'hand', false, 1, true, overflowVPad);
      sprite.setDepth(10 + i);
      if (!active) {
        sprite.setAlpha(0.72);
        sprite.setDisplaySize(Number(sprite.getData('baseW')) * 0.94, Number(sprite.getData('baseH')) * 0.94);
      } else if (sorted.length === 1) {
        // Down to one card, that card is the match. It is the only thing left to decide, so it
        // stops being one of a row and becomes the focal object on the screen.
        sprite.setDisplaySize(Number(sprite.getData('baseW')) * 1.18, Number(sprite.getData('baseH')) * 1.18);
        sprite.setData({ ...(sprite.data?.getAll() ?? {}), lastCard: true });
      }
      this.clipToHandStrip(sprite);
      this.cardSprites.push(sprite);
    });
  }

  /**
   * Hides (and un-clicks) a hand card that has scrolled past the ends of the hand strip.
   *
   * An overflowing hand keeps MIN_HAND_GAP between cards and scrolls instead of compressing, so
   * the row is wider than the strip by design — but nothing clipped it, and the tail simply kept
   * drawing to the right of the strip. In landscape that is exactly where the action cluster
   * lives, and a hand card (depth 10+) beats a button (depth 0) in the hit test: past roughly
   * forty cards the spill sat on top of COMPRAR/FEITO and swallowed every click on them, which
   * looked like the whole board had gone dead. Tapping the spilled card and placing it moved it
   * off the button again — the workaround players found.
   */
  private clipToHandStrip(sprite: Phaser.GameObjects.Image): void {
    const zone = this.r.handZone;
    const half = sprite.displayWidth / 2;
    const inside = sprite.x - half >= zone.x && sprite.x + half <= zone.x + zone.w;
    sprite.setVisible(inside);
    if (sprite.input) sprite.input.enabled = inside;
  }

  /**
   * Horizontal drag-scroll for a hand too long to fit, on a strip behind the cards.
   *
   * The gesture rule is the same one the Mexe editor's strip already uses, and it has to be: a
   * card sits on top of this strip, so a press that lands on a card is a card drag and only a
   * press that lands on the bare strip scrolls. A movement under the tap threshold stays a tap.
   */
  private enableHandScroll(overflow: number): void {
    const zone = this.r.handZone;
    const strip = this.add
      .rectangle(zone.x + zone.w / 2, zone.y + zone.h / 2, zone.w, zone.h, 0x000000, 0.001)
      .setDepth(1); // below the cards (depth 10+), so a card always wins the hit test
    strip.setInteractive({ useHandCursor: false });
    let startX = 0;
    let scrollStart = 0;
    strip.on('pointerdown', (p: Phaser.Input.Pointer) => {
      startX = p.worldX;
      scrollStart = this.handScroll;
    });
    strip.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const next = Phaser.Math.Clamp(scrollStart - (p.worldX - startX), 0, overflow);
      if (next === this.handScroll) return;
      const delta = next - this.handScroll;
      this.handScroll = next;
      // Reposition only — a re-render mid-gesture would destroy the sprites under the finger.
      for (const sprite of this.cardSprites) {
        if (sprite.getData('origin') !== 'hand') continue;
        sprite.x -= delta;
        this.clipToHandStrip(sprite);
      }
    });
    this.hud.push(strip);
  }

  /**
   * Focused Mexe editor (Phase 14 Wave C): three stacked zones replacing the normal table+hand
   * rendering — meld list (scrollable, tap a row to focus it), workspace (the focused meld, large),
   * hand strip (scrollable, tap to select). Every mutation still runs through
   * selectCard/placeSelected/onCardTapped, so tapping here can never disagree with the normal
   * board about what's legal — this method only ever decides *what to draw and what a tap means*.
   */
  private renderMexeEditor(
    melds: readonly Meld[],
    hand: readonly Card[],
    invalidReasons: Map<string, string[]>,
    interactive: boolean,
    config: RulesConfig,
    rawInvalid: DraftAnalysis['invalidMelds'] = [],
  ): void {
    this.mexeListPanTargets = [];
    this.mexeHandPanTargets = [];
    const zones = editorZones(this.r);
    const meldIds = melds.map((m) => m.id);
    // D8: mirrors renderMeldFocus's own guard for the landscape magnifier — an undo/redo/reset can
    // make the workspace's meld vanish out from under it. Without this, the workspace kept
    // pointing at the dead id and DraftEditor.insert (unknown meldId) silently created a brand new
    // meld the moment the player tried to place a card into what looked like the old one.
    if (this.mexeEditorMeldId !== undefined && this.mexeEditorMeldId !== null && !meldIds.includes(this.mexeEditorMeldId)) {
      this.mexeEditorMeldId = undefined;
    }
    const rows = meldListRows(meldIds);
    const contentH = meldListContentHeight(rows.length);
    this.mexeEditorScroll = clampScroll(this.mexeEditorScroll, contentH, zones.meldList.h);

    // ---- meld list ----
    const listBg = this.add
      .rectangle(zones.meldList.x + zones.meldList.w / 2, zones.meldList.y + zones.meldList.h / 2, zones.meldList.w, zones.meldList.h, 0x000000, 0.22)
      .setDepth(0);
    if (interactive) {
      listBg.setInteractive({ useHandCursor: false });
      let dragStartY = 0;
      let scrollStart = 0;
      // pointer.x/y are raw canvas-pixel coordinates (pre camera-zoom); pointer.worldX/worldY are
      // transformed through the (zoomed, centred) main camera into the same world-unit space every
      // other GameScene coordinate (meldZones, sprite.x/y, GameRegions) already lives in.
      listBg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragStartY = p.worldY;
        scrollStart = this.mexeEditorScroll;
      });
      listBg.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const next = clampScroll(scrollStart - (p.worldY - dragStartY), contentH, zones.meldList.h);
        if (next !== this.mexeEditorScroll) {
          // Reposition only — see the table-pan handler above for why (finding 1, Phase 14 review).
          const delta = next - this.mexeEditorScroll;
          this.mexeEditorScroll = next;
          for (const o of this.mexeListPanTargets) o.y -= delta;
        }
      });
      listBg.on('pointerup', (p: Phaser.Input.Pointer) => {
        // A tap (negligible vertical movement) selects the row under it; a drag only scrolled.
        if (Math.abs(p.worldY - dragStartY) > 4) {
          this.renderAll();
          return;
        }
        const row = hitTestMeldListRow(rows, zones.meldList, this.mexeEditorScroll, p.worldX, p.worldY);
        if (row) this.onMeldListRowTapped(row);
      });
      listBg.on('pointerupoutside', () => this.renderAll());
    }
    this.hud.push(listBg);

    const cw = CARD_W * 0.45;
    const ch = CARD_H * 0.45;
    for (const row of rows) {
      const y = meldListRowY(row, zones.meldList, this.mexeEditorScroll);
      if (y + MELD_LIST_ROW_H < zones.meldList.y || y > zones.meldList.y + zones.meldList.h) continue; // scrolled out of view
      const focused = row.meldId === this.mexeEditorMeldId;
      const rowRect = this.add
        .rectangle(zones.meldList.x + zones.meldList.w / 2, y + MELD_LIST_ROW_H / 2, zones.meldList.w - 2, MELD_LIST_ROW_H - 2, focused ? 0xf7d23e : 0xffffff, focused ? 0.14 : 0.04)
        .setDepth(1);
      this.hud.push(rowRect);
      this.mexeListPanTargets.push(rowRect);
      if (row.meldId === null) {
        const newMeldLabel = label(this, zones.meldList.x + 6, y + MELD_LIST_ROW_H / 2, t('mobile.editorNewMeld'), 7, '#d8c890').setOrigin(0, 0.5).setDepth(2);
        this.hud.push(newMeldLabel);
        this.mexeListPanTargets.push(newMeldLabel);
        continue;
      }
      const meld = melds.find((m) => m.id === row.meldId);
      if (!meld) continue;
      const cards = sortMeldCards(meld.cards);
      cards.forEach((card, i) => {
        const key = card.isJoker ? 'card-joker' : `card-${card.suit}-${card.rank}`;
        const img = this.add.image(zones.meldList.x + 8 + cw / 2 + i * (cw * 0.7), y + MELD_LIST_ROW_H / 2, key).setDisplaySize(cw, ch).setDepth(2);
        this.hud.push(img);
        this.cardSprites.push(img);
        this.mexeListPanTargets.push(img);
      });
      const isInvalid = invalidReasons.has(meld.id);
      // R1/R2: the meld-list ✗/✓ verdict used to be plain red/green — now the same meldStatus()
      // classifier every other renderer uses, so it can never contradict the workspace it opens.
      const rowRawReason = rawInvalid.find((r) => r.meldId === meld.id)?.reason ?? null;
      const rowStatus: SnapStatus = isInvalid ? meldStatus(rowRawReason) : 'legal';
      this.renderedMeldStatus.set(meld.id, rowStatus);
      const verdictLabel = label(this, zones.meldList.x + zones.meldList.w - 12, y + MELD_LIST_ROW_H / 2, isInvalid ? '✗' : '✓', 8, STATUS_COLOR[rowStatus].text)
        .setOrigin(0.5)
        .setDepth(2);
      this.hud.push(verdictLabel);
      this.mexeListPanTargets.push(verdictLabel);
    }

    // ---- workspace ----
    const wsRect = new Phaser.Geom.Rectangle(zones.workspace.x, zones.workspace.y, zones.workspace.w, zones.workspace.h);
    const wsBg = this.add
      .rectangle(wsRect.centerX, wsRect.centerY, wsRect.width, wsRect.height, 0x000000, 0.3)
      .setDepth(0)
      .setStrokeStyle(1, CHROME_GOLD, 0.5);
    this.hud.push(wsBg);
    this.meldZones = this.mexeEditorMeldId !== undefined ? [{ meldId: this.mexeEditorMeldId ?? '', rect: wsRect }] : [];

    if (this.mexeEditorMeldId === undefined) {
      this.hud.push(label(this, wsRect.centerX, wsRect.centerY - 6, t('mobile.mexeModeHint'), 7, '#b8b0a0'));
      this.hud.push(label(this, wsRect.centerX, wsRect.centerY + 6, t('mobile.editorSelectMeld'), 8, '#b8b0a0'));
    } else {
      const wsMeld = melds.find((m) => m.id === this.mexeEditorMeldId);
      const wsCards = wsMeld ? sortMeldCards(wsMeld.cards) : [];
      // B1: this workspace card row is the touch editor's only view of a meld — the conflict ring,
      // reserved gap column and missing-slot placeholder previously lived only in layoutMelds()
      // (the landscape/desktop path), so cycleProblem() could step here (mexeEditorMeldId) and show
      // nothing about why the meld is unresolved. Same detailByMeld computation as layoutMelds,
      // built fresh here since the workspace only ever renders one meld at a time.
      const wsRawReason = wsMeld ? (rawInvalid.find((r) => r.meldId === wsMeld.id)?.reason ?? null) : null;
      const wsDetail = wsMeld ? this.meldDetailFor(wsCards, wsRawReason) : undefined;
      const wsSlotAt = wsDetail?.missingSlotIndex;
      const wsVisualIndex = (i: number): number => (wsSlotAt !== undefined && i >= wsSlotAt ? i + 1 : i);
      const wcw = CARD_W * 1.3;
      const wch = CARD_H * 1.3;
      const slotCount = wsCards.length + (wsSlotAt !== undefined ? 1 : 0);
      const gap = Math.min(wcw + 6, slotCount > 1 ? (wsRect.width - wcw - 16) / (slotCount - 1) : wcw);
      const total = slotCount > 0 ? (slotCount - 1) * gap + wcw : 0;
      const startX = wsRect.centerX - total / 2 + wcw / 2;
      const cardY = wsRect.y + 16 + wch / 2;
      const handCardIds = new Set(this.editor?.getDraft().handCardsPlayed ?? []);
      wsCards.forEach((card, i) => {
        const x = startX + wsVisualIndex(i) * gap;
        const sprite = this.makeCardSprite(x, cardY, card, interactive, 'table', handCardIds.has(card.id), 1.3, false);
        sprite.setDepth(3);
        this.cardSprites.push(sprite);
        // B1: the exact conflicting card(s) pulse here too — same visual as layoutMelds, static
        // under reduced motion (the ring itself, not just the pulse, is the cue).
        if (wsDetail?.conflictCardIds.includes(card.id)) {
          const ring = this.add.rectangle(x, cardY, wcw + 4, wch + 4).setStrokeStyle(2, parseInt(STATUS_COLOR.illegal.text.slice(1), 16), 0.95).setDepth(4);
          this.hud.push(ring);
          const dur = feelMs('normal');
          if (dur > 0) this.tweens.add({ targets: ring, scaleX: 1.08, scaleY: 1.08, duration: dur, yoyo: true, repeat: -1, ease: FEEL.normal.ease });
          // RECOVERY-14: a joker with nowhere to go gets a plain-language reason, same as layoutMelds.
          // R10: hover only, deliberately no `this.r.touch` pointerdown tooltip here — unlike
          // layoutMelds' cards (drag-primary, tap-select secondary), every card in this workspace
          // is tap-to-select ONLY (draggable=false), so a pointerdown tooltip on the same sprite
          // fires on every tap-to-select gesture and turns one tap into two competing actions. The
          // original skip existed for exactly this reason; B1 re-added it here and widened the
          // collision instead of respecting the skip.
          if (card.isJoker) {
            const failText = wsRawReason === 'reason.tooManyJokers' ? t('joker.tooMany') : wsRawReason === 'reason.jokerUnassignable' ? t('joker.noRole') : null;
            if (failText) {
              if (!sprite.input) sprite.setInteractive();
              const rect = new Phaser.Geom.Rectangle(x - wcw / 2, cardY - wch / 2, wcw, wch);
              sprite.on('pointerover', () => this.showMeldReasonTooltip(rect, failText, 'illegal'));
              sprite.on('pointerout', () => this.hideMeldReasonTooltip());
            }
          }
        } else if (card.isJoker && meldStatus(wsRawReason) === 'incomplete') {
          // R5, ported from layoutMelds: a joker in an under-length/gapped meld gets an explicit
          // "not decided yet" hint instead of the silence N6's dead-code gate left here. R10: hover
          // only — see the comment above.
          if (!sprite.input) sprite.setInteractive();
          const rect = new Phaser.Geom.Rectangle(x - wcw / 2, cardY - wch / 2, wcw, wch);
          const hint = t('joker.roleUnknown');
          sprite.on('pointerover', () => this.showMeldReasonTooltip(rect, hint, 'incomplete'));
          sprite.on('pointerout', () => this.hideMeldReasonTooltip());
        }
      });
      // B1: the reserved-column missing-slot placeholder, ported from layoutMelds.
      if (wsSlotAt !== undefined) {
        const slotX = startX + wsSlotAt * gap;
        const slotGfx = this.add.graphics().setDepth(3);
        this.drawDashedRect(slotGfx, slotX - wcw / 2, cardY - wch / 2, wcw, wch, STATUS_COLOR.incomplete.fill, 0.85);
        this.hud.push(slotGfx);
        if (wsDetail?.missingCard) {
          const missing = wsDetail.missingCard;
          this.hud.push(
            label(this, slotX, cardY, `${SUIT_CHAR[missing.suit]}${rankLabel(missing.rank)}`, 9, STATUS_COLOR.incomplete.text).setOrigin(0.5).setDepth(4),
          );
        }
      }
      if (wsCards.length === 0) {
        this.hud.push(label(this, wsRect.centerX, cardY, t('mobile.editorEmpty'), 8, '#b8b0a0'));
      }
      const reasons = wsMeld && invalidReasons.get(wsMeld.id);
      if (reasons) {
        // R1/R2: same meldStatus() classifier as the meld-list verdict and layoutMelds — this used
        // to be hardcoded red for every reason, including the gold-outlined runGap case.
        this.hud.push(
          this.add
            .text(wsRect.centerX, wsRect.y + wsRect.height - 20, reasons.join('\n'), {
              ...fontStyle(7, STATUS_COLOR[meldStatus(wsRawReason)].text),
              align: 'center',
              wordWrap: { width: wsRect.width - 12 },
            })
            .setOrigin(0.5, 0),
        );
      }

      if (interactive && this.selectedCardId !== null) {
        wsBg.setInteractive({ useHandCursor: true });
        wsBg.on('pointerup', () => this.placeSelected('meld', this.mexeEditorMeldId ?? null));
        const flags = settings.helperFlags();
        if (flags.legalDestinationsOnSelect || flags.ghostPreview !== 'off') {
          const targets = this.computeSnapTargetsFor(this.selectedCardId);
          this.selectionTargets = targets;
          const snap = snapTargetFor(targets, this.mexeEditorMeldId ?? null);
          if (snap) {
            if (flags.legalDestinationsOnSelect) {
              wsBg.setStrokeStyle(2, STATUS_COLOR[snap.status].fill, 0.9);
            }
            if (flags.ghostPreview !== 'off') this.showGhostPreview(snap, wsRect);
          }
        }
      }
    }

    // ---- hand strip ----
    const hsZone = zones.handStrip;
    const sortedHand = this.sortedHand(hand);
    const step = Math.min(CARD_W + 4, 40);
    const contentW = sortedHand.length > 0 ? (sortedHand.length - 1) * step + CARD_W : 0;
    const hsScroll = clampScroll(this.mexeHandScroll, contentW, hsZone.w);
    this.mexeHandScroll = hsScroll;
    const hsBg = this.add
      .rectangle(hsZone.x + hsZone.w / 2, hsZone.y + hsZone.h / 2, hsZone.w, hsZone.h, 0x000000, 0.18)
      .setDepth(0);
    if (interactive && sortedHand.length > 0) {
      hsBg.setInteractive({ useHandCursor: false });
      let dragStartX = 0;
      let scrollStartX = 0;
      hsBg.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragStartX = p.worldX;
        scrollStartX = this.mexeHandScroll;
      });
      hsBg.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const next = clampScroll(scrollStartX - (p.worldX - dragStartX), contentW, hsZone.w);
        if (next !== this.mexeHandScroll) {
          // Reposition only — see the table-pan handler above for why (finding 1, Phase 14 review).
          const delta = next - this.mexeHandScroll;
          this.mexeHandScroll = next;
          for (const o of this.mexeHandPanTargets) o.x -= delta;
        }
      });
      hsBg.on('pointerup', () => this.renderAll());
      hsBg.on('pointerupoutside', () => this.renderAll());
    }
    this.hud.push(hsBg);
    const startHX = hsZone.x + CARD_W / 2 + 4 - hsScroll;
    sortedHand.forEach((card, i) => {
      const x = startHX + i * step;
      if (x < hsZone.x - CARD_W || x > hsZone.x + hsZone.w + CARD_W) return; // scrolled out of view
      const sprite = this.makeCardSprite(x, hsZone.y + hsZone.h / 2, card, interactive, 'hand', false, 1, false);
      sprite.setDepth(10 + i);
      this.cardSprites.push(sprite);
      this.mexeHandPanTargets.push(sprite);
    });

    // Selected-card ring — the normal board draws this in renderSelectionLayer, which the editor
    // skips in favour of driving its own tap targets above.
    if (this.selectedCardId !== null) {
      const heldSprite = this.cardSprites.find((s) => s.getData('cardId') === this.selectedCardId);
      if (heldSprite) {
        this.hud.push(this.selectionRing(heldSprite));
      }
    }

    // ✕ closes the editor without discarding the draft — the draft lives in DraftEditor either way.
    this.hud.push(
      new PixelButton(this, zones.meldList.x + zones.meldList.w - 10, zones.meldList.y + 8, t('mobile.editorClose'), () => this.toggleMexeEditor(), {
        textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x8e4632,
      }).setDepth(5),
    );
  }

  /** Meld-list row tap: with a card held, commit it there (same path a normal-board meld-zone tap
   * uses); otherwise the row just becomes the workspace's subject. */
  private onMeldListRowTapped(row: MeldListRow): void {
    if (this.selectedCardId !== null) {
      this.placeSelected('meld', row.meldId);
      return;
    }
    this.mexeEditorMeldId = row.meldId;
    this.renderAll();
  }

  private makeCardSprite(
    x: number,
    y: number,
    card: Card,
    interactive: boolean,
    origin: 'hand' | 'table',
    handAdded: boolean,
    scale = 1,
    draggable = true,
    vPad?: number,
  ): Phaser.GameObjects.Image {
    const key = card.isJoker ? 'card-joker' : `card-${card.suit}-${card.rank}`;
    const w = CARD_W * scale;
    const h = CARD_H * scale;
    const sprite = this.add.image(x, y, key).setDisplaySize(w, h);
    sprite.setData({ cardId: card.id, origin, homeX: x, homeY: y, baseW: w, baseH: h });
    if (interactive) {
      // Hit area padded past the art, mostly vertically: on a phone-sized viewport a hand card
      // renders around 20x26 CSS px, far under a comfortable touch target. The pad is in frame
      // coordinates so it scales with the card and costs nothing on desktop. Overlapping hand
      // cards still resolve by depth, so the fanned order behaves as before.
      const fw = sprite.frame.width;
      const fh = sprite.frame.height;
      const padX = fw * 0.12;
      const padY = vPad ?? fh * 0.3;
      sprite.setInteractive(
        new Phaser.Geom.Rectangle(-padX, -padY, fw + padX * 2, fh + padY * 2),
        Phaser.Geom.Rectangle.Contains,
      );
      if (sprite.input) sprite.input.cursor = 'pointer';
      // Focused editor (Phase 14 Wave C): tap-to-select-then-place only, never draggable — the
      // workspace/hand-strip cards there still call this with draggable=false.
      if (draggable) {
        this.input.setDraggable(sprite);
        this.wireDrag(sprite);
      }
      sprite.on('pointerup', () => {
        if (sprite.getData('dragged')) return; // that was a drag, dragend already handled it
        this.onCardTapped(card.id);
      });
    }
    if (handAdded) {
      // marks a card played from hand this turn — still returnable to hand
      const dot = this.add.circle(x + w / 2 - 2, y - h / 2 + 2, 1.6, CHROME_GOLD, 1).setDepth(250);
      this.hud.push(dot);
    }
    return sprite;
  }

  /** Restores whichever card sprite is mid-drag and clears its drag state — see the pointercancel
   * listener in create(). Safe to call when nothing is dragging (no-op). */
  private cancelActiveDrag(): void {
    const sprite = this.cardSprites.find((s) => s.getData('dragging'));
    if (!sprite || !sprite.active) return;
    playlog.recordDrop('cancelled', (sprite.getData('origin') as 'hand' | 'table') ?? 'hand');
    sprite.setData('dragging', false);
    sprite.setAngle(0);
    this.dragShadow?.destroy();
    this.dragShadow = null;
    this.clearDropZoneHighlights();
    this.snapTargets = [];
    this.tweenSpriteHome(sprite);
    if (this.tableContainer && sprite.active) this.tableContainer.add(sprite);
  }

  /** Gold ring around the selected card, drawn wherever the card currently is. */
  private selectionRing(sprite: Phaser.GameObjects.Image): Phaser.GameObjects.Rectangle {
    return this.add
      .rectangle(sprite.x, sprite.y, sprite.displayWidth + 4, sprite.displayHeight + 4)
      .setStrokeStyle(2, CHROME_GOLD, 1)
      .setDepth(260);
  }

  /** Springs a card back to the position the last layout gave it — a refused or cancelled drag. */
  private tweenSpriteHome(sprite: Phaser.GameObjects.Image): void {
    this.tweens.add({
      targets: sprite,
      x: sprite.getData('homeX') as number,
      y: sprite.getData('homeY') as number,
      displayWidth: CARD_W, displayHeight: CARD_H, ease: 'Back.out', duration: 140,
    });
  }

  private wireDrag(sprite: Phaser.GameObjects.Image): void {
    const baseW = sprite.getData('baseW') as number;
    const baseH = sprite.getData('baseH') as number;
    const FINGER_LIFT = view().touch ? FINGER_LIFT_TOUCH : 0;
    sprite.on('pointerover', () => {
      if (sprite.getData('dragging')) return;
      sprite.setDisplaySize(baseW + 4, baseH + 5);
      sprite.setDepth(200);
    });
    sprite.on('pointerout', () => {
      if (sprite.getData('dragging')) return;
      sprite.setDisplaySize(baseW, baseH);
      sprite.setDepth(10);
    });
    sprite.on('pointerdown', () => sprite.setData('dragged', false));
    sprite.on('dragstart', () => {
      sprite.setData('dragging', true);
      sprite.setDepth(300);
      sprite.setAlpha(0.95);
      sprite.setDisplaySize(baseW * 1.15, baseH * 1.15);
      // Zoomed table (Phase 14 Wave D) clips content to the table area via the tableContainer's
      // geometry mask; a dragged card must escape it so dragging toward the hand doesn't visually
      // clip mid-drag. Drop logic never consulted the mask, so this is purely cosmetic. Lift the
      // sprite out of the masked container back onto the scene's own display list — renderAll()
      // fully rebuilds the table on drop/settle, so nothing needs to put it back afterward.
      if (sprite.parentContainer) {
        sprite.parentContainer.remove(sprite);
        this.sys.displayList.add(sprite);
      }
      this.dragShadow = this.add
        .ellipse(sprite.x + 2, sprite.y + 5, baseW * 1.05, baseH * 0.5, 0x000000, 0.35)
        .setDepth(299);
      // Picking up the card that would end the match is worth hearing. A louder sample, not slow
      // motion — the player is mid-decision and does not want to be waited on.
      playSfx(this, 'sfx-pickup', sprite.getData('lastCard') ? 0.75 : 0.4);
      haptic('tick');
      this.hideMeldReasonTooltip();
      this.snapTargets = this.computeSnapTargetsFor(sprite.getData('cardId') as string);
      this.showDropZoneHighlights();
    });
    sprite.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      sprite.setData('dragged', true);
      // A card leans into the direction it is being thrown, capped hard: enough to feel like a
      // physical object, never enough to make the rank and suit harder to read mid-drag.
      const lean = Phaser.Math.Clamp((dragX - sprite.x) * DRAG_TILT_PER_UNIT, -DRAG_TILT_MAX, DRAG_TILT_MAX);
      sprite.setAngle(settings.motionScale() > 0 ? lean : 0);
      // On a finger, the card is held above the contact point instead of under it — otherwise the
      // thumb covers both the card being moved and the place it is going.
      const y = dragY - FINGER_LIFT;
      sprite.setPosition(dragX, y);
      this.dragShadow?.setPosition(dragX + 2, y + 7);
      this.edgePanWhileDragging(y);
      this.updateDropZoneHover(dragX, dragY);
    });
    sprite.on('dragend', () => {
      sprite.setData('dragging', false);
      sprite.setAngle(0); // drop the drag lean before the card settles anywhere
      this.dragShadow?.destroy();
      this.dragShadow = null;
      this.clearDropZoneHighlights();
      this.onCardDropped(sprite);
      this.snapTargets = [];
      // Restore container membership synchronously, mirroring the old per-object setMask()
      // restore here. Most drop outcomes tween the sprite and call renderAll() on completion,
      // which destroys this sprite and the whole container together anyway — but a
      // tutorial-blocked drop only tweens the sprite back home without ever re-rendering, so it
      // must be re-clipped, not left floating outside the table's mask.
      if (this.tableContainer && sprite.active) this.tableContainer.add(sprite);
    });
  }

  /** True inside the table drop area, matching `onCardDropped`'s own bounds check exactly — hover
   * preview and drop resolution must never disagree on where "the empty table" is. */
  /**
   * Scrolls a zoomed table when a dragged card is held near its top or bottom edge, so a meld that
   * is off-screen can still be reached in one gesture. Below the dead zone nothing happens at all,
   * and the speed ramps with how far past it the card is — a constant-speed pan is impossible to
   * stop on the row you want.
   */
  private edgePanWhileDragging(y: number): void {
    if (this.tableContentH <= this.r.tableAreaH) return; // nothing to scroll
    const top = this.r.tableTop + EDGE_PAN_ZONE;
    const bottom = this.r.tableTop + this.r.tableAreaH - EDGE_PAN_ZONE;
    const past = y < top ? y - top : y > bottom ? y - bottom : 0;
    if (past === 0) return;
    const speed = Phaser.Math.Clamp(past / EDGE_PAN_ZONE, -1, 1) * EDGE_PAN_MAX_STEP;
    const next = clampScroll(this.tablePan + speed, this.tableContentH, this.r.tableAreaH);
    if (next === this.tablePan) return;
    const delta = next - this.tablePan;
    this.tablePan = next;
    // Reposition only, exactly like the pan gesture — re-rendering mid-drag would destroy the
    // sprite currently under the finger.
    for (const o of this.tablePanTargets) o.y -= delta;
  }

  private inTableArea(x: number, y: number): boolean {
    return y > this.r.tableTop - 6 && y < this.r.tableBottom + 10 && x < this.r.tableRightBound;
  }

  /**
   * Colours each meld zone by its snap status (Phase 12) — solid green for legal, today's soft
   * gold for incomplete, dashed red for illegal (shape channel, not just hue). Targets were
   * computed once on dragstart; this only draws them.
   */
  private showDropZoneHighlights(): void {
    this.clearDropZoneHighlights();
    this.hoverKey = undefined;
    this.redrawZoneHighlights();
    const outline = this.add.graphics().setDepth(140);
    this.drawDashedRect(outline, this.r.tableLeft, this.r.tableTop, this.r.tableAreaW, this.r.tableBottom - this.r.tableTop, CHROME_GOLD, 0.3, 1, 2, 2);
    this.dragTableOutline = outline;
  }

  private redrawZoneHighlights(): void {
    for (const h of this.dragZoneHighlights) {
      h.solid?.destroy();
      h.dashed?.destroy();
    }
    this.dragZoneHighlights = [];
    for (const z of this.meldZones) {
      const target = snapTargetFor(this.snapTargets, z.meldId);
      const status: SnapStatus = target?.status ?? 'incomplete';
      const hovered = this.hoverKey === z.meldId;
      let solid: Phaser.GameObjects.Rectangle | null = null;
      let dashed: Phaser.GameObjects.Graphics | null = null;
      if (status !== 'legal') {
        // C2: layoutMelds' resting state draws dashed for BOTH incomplete and illegal (the shape
        // channel a colourblind player relies on) — this drag-time painter used to draw incomplete
        // as solid, so the same zone visibly changed shape channel on drop. Dashed for both here
        // too, keeping illegal's stronger weight so the two still read as different severities.
        dashed = this.add.graphics().setDepth(150);
        const weight = status === 'illegal' ? (hovered ? 1 : 0.85) : hovered ? 0.6 : 0.45;
        const lineWidth = status === 'illegal' ? (hovered ? 2 : 1) : 1;
        this.drawDashedRect(dashed, z.rect.x, z.rect.y, z.rect.width, z.rect.height, STATUS_COLOR[status].fill, weight, lineWidth);
      } else {
        const color = STATUS_COLOR.legal.fill;
        solid = this.add
          .rectangle(z.rect.centerX, z.rect.centerY, z.rect.width, z.rect.height)
          .setStrokeStyle(hovered ? 3 : 2, color, hovered ? 1 : 0.9)
          .setDepth(150);
      }
      this.dragZoneHighlights.push({ meldId: z.meldId, status, solid, dashed });
    }
  }

  /** Emphasises the hovered zone within its own status colour (never overwrites it with gold) and
   * redraws the ghost preview — only when the hovered zone actually changed, never per pointer-move. */
  private updateDropZoneHover(x: number, y: number): void {
    const zone = this.meldZones.find((z) => z.rect.contains(x, y));
    const inTable = !zone && this.inTableArea(x, y);
    const key = zone ? zone.meldId : inTable ? '' : undefined;
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.redrawZoneHighlights();
    if (key === undefined) {
      this.clearGhostPreview();
      return;
    }
    const target = snapTargetFor(this.snapTargets, zone ? zone.meldId : null);
    if (!target || settings.helperFlags().ghostPreview === 'off') {
      this.clearGhostPreview();
      return;
    }
    const rect = zone ? zone.rect : new Phaser.Geom.Rectangle(this.r.tableLeft, this.r.tableTop, this.r.tableAreaW, this.r.tableBottom - this.r.tableTop);
    this.showGhostPreview(target, rect);
  }

  private clearDropZoneHighlights(): void {
    for (const h of this.dragZoneHighlights) {
      h.solid?.destroy();
      h.dashed?.destroy();
    }
    this.dragZoneHighlights = [];
    this.dragTableOutline?.destroy();
    this.dragTableOutline = null;
    this.hoverKey = undefined;
    this.clearGhostPreview();
  }

  /**
   * Non-mutating ghost preview (Phase 12): builds purely from `target` — never touches
   * `cardSprites`/`meldZones`, never calls a DraftEditor mutator. Dark rounded panel clamped
   * inside the playfield, small card images in resulting order, a joker hint taken only from
   * `target.jokerAssignments` (never derived here), and one status line.
   */
  private showGhostPreview(target: SnapTarget, rect: Phaser.Geom.Rectangle): void {
    this.clearGhostPreview();
    const cw = CARD_W * 0.6;
    const ch = CARD_H * 0.6;
    const cards = target.preview;
    const maxSpread = 120;
    const cardGap = Math.min(cw + 3, cards.length > 1 ? maxSpread / (cards.length - 1) : cw);
    const cardsW = cards.length > 0 ? (cards.length - 1) * cardGap + cw : cw;

    const jokerLabels = target.status === 'legal' ? jokerLabelsOf(target.jokerAssignments) : new Map<string, string>();
    const hasJokerHint = cards.some((c) => jokerLabels.has(c.id));
    const cardRowH = ch + (hasJokerHint ? 8 : 0);

    const statusText =
      target.status === 'legal' ? t('snap.legal') : target.status === 'incomplete' ? t('snap.incomplete') : t(target.reason ?? '');
    const statusColor = STATUS_COLOR[target.status].text;
    const panelW = Math.min(150, Math.max(70, cardsW + 16));
    const st = label(this, 0, 0, statusText, 6, statusColor);
    st.setWordWrapWidth(panelW - 8, true);

    const panelH = 6 + cardRowH + 4 + st.height + 6;
    const cx = Phaser.Math.Clamp(rect.centerX, panelW / 2 + 2, this.r.w - 96 - 2);
    const cy = Phaser.Math.Clamp(rect.bottom + 8 + panelH / 2, panelH / 2 + 2, this.r.h - 30);

    const g = this.add.graphics().setDepth(500);
    g.fillStyle(0x1a1410, 0.9);
    g.fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 3);

    const rowY = cy - panelH / 2 + 6 + ch / 2;
    const startX = cx - cardsW / 2;
    const objs: Phaser.GameObjects.GameObject[] = [g];
    cards.forEach((card, i) => {
      const key = card.isJoker ? 'card-joker' : `card-${card.suit}-${card.rank}`;
      const x = startX + i * cardGap + cw / 2;
      objs.push(this.add.image(x, rowY, key).setDisplaySize(cw, ch).setAlpha(0.75).setDepth(501));
      const hint = jokerLabels.get(card.id);
      if (hint) objs.push(label(this, x, rowY + ch / 2 + 5, hint, 5, STATUS_COLOR.incomplete.text).setDepth(501));
    });

    st.setPosition(cx, cy + panelH / 2 - 6 - st.height / 2).setDepth(501);
    objs.push(st);

    // MEXE-05 (in-place destination preview) is DEFERRED-PRODUCT: an attempt at drawing a ghost
    // card inside the meld itself (under the dragged sprite, gold-tinted on an already-light card
    // face, overlapping both neighbours by half a card) was found illegible in round-2 review and
    // reverted rather than shipped as invisible code. The detached panel above remains the one
    // preview surface.
    this.ghostPreview = objs;
  }

  private clearGhostPreview(): void {
    for (const o of this.ghostPreview) o.destroy();
    this.ghostPreview = [];
  }

  // ponytail: hand-rolled dashed border — Phaser has no native dashed stroke and this is only a few lines.
  /**
   * Coherence-3: "dashed rectangle" used to be one visual grammar carrying four unrelated
   * meanings (invalid status, missing-card slot, "look here", drag-time table boundary),
   * separated only by hue — the one channel the tri-state work was built to avoid depending on.
   * `dash`/`gap` give each MEANING (not each colour) its own rhythm: the default (4/3) is the
   * status truth STATUS_COLOR/meldStatus() owns (the meld outline, the missing-card slot inside
   * it — same meaning, just a more precise location, so they intentionally keep the same rhythm);
   * a "look here" pointer (the blue cycle ring, the white focus ring) uses a longer, sparser
   * rhythm so it reads as a highlight, never a status; the whole-table drag boundary uses a
   * tighter one so it reads as a frame, never a per-meld outline.
   */
  private drawDashedRect(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    alpha: number,
    width = 1,
    dash = 4,
    gap = 3,
  ): void {
    g.lineStyle(width, color, alpha);
    for (let sx = x; sx < x + w; sx += dash + gap) {
      const ex = Math.min(sx + dash, x + w);
      g.lineBetween(sx, y, ex, y);
      g.lineBetween(sx, y + h, ex, y + h);
    }
    for (let sy = y; sy < y + h; sy += dash + gap) {
      const ey = Math.min(sy + dash, y + h);
      g.lineBetween(x, sy, x, ey);
      g.lineBetween(x + w, sy, x + w, ey);
    }
  }

  private onCardDropped(sprite: Phaser.GameObjects.Image): void {
    if (!this.editor) {
      sprite.destroy();
      return;
    }
    const cardId = sprite.getData('cardId') as string;
    const origin = sprite.getData('origin') as 'hand' | 'table';
    const x = sprite.x;
    const y = sprite.y;

    const zone = this.meldZones.find((z) => z.rect.contains(x, y));
    const inTableArea = this.inTableArea(x, y);
    const inHandArea = y >= this.r.handY - 30;

    const action: TutorialAction = origin === 'hand'
      ? { type: 'playHandCard', cardId }
      : inHandArea && !zone
        ? { type: 'returnToHand' }
        : { type: 'moveTableCard', cardId };
    if (!this.tutorialAllows(action)) {
      playSfx(this, 'sfx-invalid', 0.15);
      playlog.recordDrop('blocked', origin);
      this.tweenSpriteHome(sprite);
      return;
    }

    // Which meld target (existing/new) this drop lands on, for the snap-status sfx below.
    // Stays undefined for a return-to-hand — that path has no snap target.
    let landedMeldId: string | null | undefined;
    let acted = false;
    // MEXE-17: a table card going back to hand reads as "picked back up", not as a drop — it gets
    // its own sfx and motion below rather than sharing sfx-drop/sfx-snap with every other landing.
    const returning = origin === 'table' && inHandArea && !zone;
    if (origin === 'hand') {
      if (zone) { acted = this.editor.playHandCard(cardId, zone.meldId); landedMeldId = zone.meldId; }
      else if (inTableArea) { acted = this.editor.playHandCard(cardId, null); landedMeldId = null; }
    } else {
      const currentMeld = this.editor.getDraft().melds.find((m) => m.cards.some((c) => c.id === cardId));
      if (zone && zone.meldId !== currentMeld?.id) {
        acted = this.editor.moveTableCard(cardId, zone.meldId);
        landedMeldId = zone.meldId;
      } else if (inHandArea) {
        acted = this.editor.returnHandCard(cardId); // only works for cards played this turn
        if (!acted) playSfx(this, 'sfx-invalid', 0.5);
      } else if (inTableArea && !zone) {
        acted = this.editor.moveTableCard(cardId, null);
        landedMeldId = null;
      }
    }

    // Re-render from wherever everything has visibly settled, so a meld closing around a removed
    // card and another opening to receive it both read as movement rather than a new screen.
    const rerenderWithMotion = (): void => {
      const before = this.cardPositions();
      this.renderAll();
      this.animateBoardFrom(before, 'normal');
    };
    const settle = { displayWidth: CARD_W, displayHeight: CARD_H, ease: 'Back.out', duration: Math.max(1, this.motion(140)) };
    if (acted) {
      this.clearLastMove();
      playlog.recordDrop(origin === 'hand' ? 'played' : inHandArea && !zone ? 'returned' : 'moved', origin);
      if (returning) {
        playSfx(this, 'sfx-pickup', 0.5); // picked back up, not dropped
        haptic('tick');
        this.tweens.add({ targets: sprite, ...settle, angle: { from: -10, to: 0 }, onComplete: rerenderWithMotion });
      } else {
        const landedTarget = landedMeldId !== undefined ? snapTargetFor(this.snapTargets, landedMeldId) : null;
        playSfx(this, landedTarget?.status === 'legal' ? 'sfx-snap' : 'sfx-drop', 0.5);
        haptic(landedTarget?.status === 'legal' ? 'bump' : 'tick');
        this.tweens.add({ targets: sprite, ...settle, onComplete: rerenderWithMotion });
      }
    } else {
      // snap back
      playlog.recordDrop('rejected', origin);
      haptic('tick'); // the drop registered, it just could not be taken
      this.tweens.add({
        targets: sprite,
        x: sprite.getData('homeX') as number,
        y: sprite.getData('homeY') as number,
        ...settle,
        onComplete: rerenderWithMotion,
      });
    }
  }

  private spriteRect(s: Phaser.GameObjects.Image): Phaser.Geom.Rectangle {
    return new Phaser.Geom.Rectangle(s.x - s.displayWidth / 2, s.y - s.displayHeight / 2, s.displayWidth, s.displayHeight);
  }

  /**
   * Rebuilds the select-then-place ring for the current board and draws it. With no card held the
   * ring is every playable card; with one held it is every destination, and each destination also
   * becomes a tappable zone under the cards (depth 1, cards sit at 3+) so touch players can drop
   * without dragging. The dashed white outline only appears once the keyboard has been used.
   */
  private renderSelectionLayer(interactive: boolean, hasInvalidMeld: boolean): void {
    this.focusTargets = [];
    if (!interactive || !this.editor) {
      this.selectedCardId = null;
      this.selectionTargets = [];
      this.snapTargets = [];
      this.clearDropZoneHighlights();
      return;
    }
    const heldSprite = this.cardSprites.find((s) => s.getData('cardId') === this.selectedCardId);
    if (this.selectedCardId !== null && !heldSprite) this.selectedCardId = null; // undo/reset ate it

    const flags = settings.helperFlags();
    if (this.selectedCardId === null) {
      this.selectionTargets = [];
      this.snapTargets = [];
      this.clearDropZoneHighlights();
      for (const s of this.cardSprites) {
        this.focusTargets.push({ kind: 'card', id: s.getData('cardId') as string, rect: this.spriteRect(s) });
      }
    } else {
      // widest destination first: equal-depth zones resolve by display order, so the melds and the
      // hand strip added afterwards stay tappable on top of the whole-table "new meld" zone.
      this.focusTargets.push({
        kind: 'new',
        rect: new Phaser.Geom.Rectangle(this.r.tableLeft, this.r.tableTop, this.r.tableAreaW, this.r.tableBottom - this.r.tableTop),
      });
      for (const z of this.meldZones) this.focusTargets.push({ kind: 'meld', id: z.meldId, rect: z.rect });
      this.focusTargets.push({
        kind: 'hand',
        rect: new Phaser.Geom.Rectangle(this.r.handZone.x, this.r.handZone.y, this.r.handZone.w, this.r.handZone.h),
      });

      // Selected-card legal destinations (beginner): the same pure snap model + zone painter the
      // drag path uses — computed once here, not per frame. meldZones was just rebuilt by
      // layoutMelds() above, so this must run after that (never before, or the rects are stale).
      if (flags.legalDestinationsOnSelect) {
        this.selectionTargets = this.computeSnapTargetsFor(this.selectedCardId);
        this.snapTargets = this.selectionTargets;
        this.showDropZoneHighlights();
      } else {
        this.selectionTargets = [];
        this.snapTargets = [];
        this.clearDropZoneHighlights();
      }

      for (const target of this.focusTargets) {
        const zone = this.add
          .rectangle(target.rect.centerX, target.rect.centerY, target.rect.width, target.rect.height, CHROME_GOLD, 0.07)
          .setDepth(1)
          .setInteractive({ useHandCursor: true });
        zone.on('pointerup', () => this.placeSelected(target.kind, target.id ?? null));
        // Ghost preview (beginner): non-mutating, cleared on pointerout/deselect/place — same
        // panel the drag path shows, never a second implementation.
        if (flags.ghostPreview === 'selectAndHover' && (target.kind === 'meld' || target.kind === 'new')) {
          const meldId = target.kind === 'meld' ? (target.id ?? null) : null;
          zone.on('pointerover', () => {
            const snap = snapTargetFor(this.selectionTargets, meldId);
            if (snap) this.showGhostPreview(snap, target.rect);
          });
          zone.on('pointerout', () => this.clearGhostPreview());
        }
        this.hud.push(zone);
      }
      if (heldSprite) {
        this.hud.push(this.selectionRing(heldSprite));
      }
    }

    if (this.focusIndex >= this.focusTargets.length) this.focusIndex = 0;
    const focused = this.focusTargets[this.focusIndex];
    const focusRingVisible = this.focusVisible && !!focused;
    if (focusRingVisible) {
      const gfx = this.add.graphics().setDepth(280);
      this.drawDashedRect(gfx, focused.rect.x - 2, focused.rect.y - 2, focused.rect.width + 4, focused.rect.height + 4, 0xffffff, 0.95);
      this.hud.push(gfx, label(this, this.r.selectHint.x, this.r.selectHint.y, t('game.selectHint'), 7, '#b8b0a0'));
      // Keyboard-focused destination gets the same ghost preview a pointer hover would.
      if (flags.ghostPreview === 'selectAndHover' && this.selectedCardId !== null && (focused.kind === 'meld' || focused.kind === 'new')) {
        const meldId = focused.kind === 'meld' ? (focused.id ?? null) : null;
        const snap = snapTargetFor(this.selectionTargets, meldId);
        if (snap) this.showGhostPreview(snap, focused.rect);
      }
    } else if (this.r.portrait && this.selectedCardId === null) {
      // touch-only one-line caption: guides an untouched board, or points at the ✗ badge once a
      // meld is invalid — replaced above by the keyboard-driven select hint once the focus ring shows.
      const capText = hasInvalidMeld ? t('mobile.warnHint') : t('mobile.tapHint');
      this.hud.push(label(this, this.r.selectHint.x, this.r.selectHint.y, capText, 7, '#b8b0a0'));
    }
  }

  /**
   * AI-16: an opponent occasionally notices an unusually strong PLAYER Mexe (the same `huge`
   * weight that earns the human their own MEXEU BONITO flash). Not every huge Mexe gets a
   * reaction — "occasionally" — and it rides the same per-seat cooldown as every other reaction,
   * so it can never double up with one already showing.
   */
  private reactToPlayerMexe(state: GameState): void {
    if (Math.random() >= 0.5) return;
    const seats = state.players.map((_, i) => i).filter((i) => i !== this.localSeat && state.players[i]!.isAi);
    if (seats.length === 0) return;
    const seat = seats[Math.floor(Math.random() * seats.length)]!;
    const personality = this.personalities[seat];
    if (!personality) return;
    this.showEmote(seat, PERSONALITY_STYLE[personality].emoteBig, 'playerMexe', personality);
  }

  /** `lineMoment` + `personality` together pick a short characterful line (`ai.line.<personality>.<moment>`,
   * see i18n) shown alongside the emote for the handful of moments that call for one — big play,
   * forced draw, near-win. Omit either to show the emote alone (e.g. the error fallback). */
  /** @param skipCooldown AI-02's pre-move "thinking" tell: a wordless bubble shown before the AI
   * has even decided its move, which must never consume the reaction cooldown slot the real
   * post-move reaction (with its character line) relies on a few hundred ms later. */
  private showEmote(
    playerIndex: number,
    emote: EmoteKey,
    lineMoment?: 'bigPlay' | 'nearWin' | 'forcedDraw' | 'playerMexe' | null,
    personality?: Personality,
    skipCooldown = false,
  ): void {
    if (playerIndex === 0) return;
    const now = Date.now();
    const previous = this.lastEmoteBySeat.get(playerIndex);
    // PACE-06: the table's calm/active/hot tier (state-derived, never the clock) tightens or
    // loosens how often a seat is allowed to react — a hot table talks more.
    const level = matchIntensity(this.store.get()).level;
    const cooldown = level === 'hot' ? EMOTE_COOLDOWN_MS * 0.6 : level === 'calm' ? EMOTE_COOLDOWN_MS * 1.3 : EMOTE_COOLDOWN_MS;
    if (!skipCooldown && previous && now - previous.at < cooldown) return; // they just spoke — let it breathe
    // Show the face but drop the words when the line would repeat the one before it.
    const lineText = lineMoment && personality ? t(`ai.line.${personality}.${lineMoment}`) : null;
    const sayLine = lineText !== null && lineText !== previous?.line;
    if (!skipCooldown) this.lastEmoteBySeat.set(playerIndex, { line: sayLine ? lineText : (previous?.line ?? null), at: now });

    // D16: the pre-move "thinking" tell (skipCooldown=true) and the post-move emote share this
    // same call with independent 900ms self-destroy timers and no handle kept — at `aiSpeed:
    // instant` or reduced motion the AI can decide before the tell has cleared, stacking a second
    // bubble on the same seat. Clear whatever is still showing there first.
    const existing = this.activeEmotes.get(playerIndex);
    if (existing) {
      existing.timer.remove();
      for (const o of existing.objs) o.destroy();
      this.activeEmotes.delete(playerIndex);
    }

    const x = this.r.opponentX0 + (playerIndex - 1) * this.r.opponentStep;
    const bubble = this.add.image(x + 16, -2, 'emote-bubble').setDisplaySize(18, 16).setDepth(400);
    const icon = this.add.image(x + 16, -3, `emote-${emote}`).setDisplaySize(12, 12).setDepth(401);
    const targets: Phaser.GameObjects.GameObject[] = [bubble, icon];
    let line: Phaser.GameObjects.Text | null = null;
    if (sayLine) {
      line = this.add
        .text(x + 16, 12, lineText, { ...fontStyle(7, CHROME_GOLD_TEXT), align: 'center', wordWrap: { width: 90 } })
        .setOrigin(0.5, 0)
        .setDepth(402);
      targets.push(line);
    }
    this.tweens.add({ targets, y: '+=28', duration: Math.max(1, this.motion(180)), ease: 'Back.out' });
    const timer = this.time.delayedCall(900, () => {
      bubble.destroy();
      icon.destroy();
      line?.destroy();
      this.activeEmotes.delete(playerIndex);
    });
    this.activeEmotes.set(playerIndex, { objs: targets, timer });
  }

}

export { rankLabel };
