import Phaser from 'phaser';
import { createAi, PERSONALITY_STYLE, type EmoteKey, type Personality } from '../ai/ai';
import { playSfx } from '../audio/sfx';
import { setMusicContext } from '../audio/music';
import { CARD_H, CARD_W } from '../assets/manifest';
import { rankLabel, SUIT_CHAR } from '../assets/fallbacks';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { playlog } from '../core/playlog';
import { createNewGame, GameStore } from '../game-state/store';
import { buildShowcaseState } from '../demo/showcase';
import { objectiveKey, objectivePhase } from '../core/objective';
import { playerStats, summarizeMoveKey } from '../core/results-summary';
import { AVATARS, CARD_BACKS, cosmeticTextureKey, DEFAULT_AVATAR, DEFAULT_CARD_BACK, DEFAULT_TABLE_THEME, TABLE_THEMES } from '../cosmetics';
import { t } from '../localization/i18n';
import { DraftEditor } from '../mexe-mode/draft';
import type { ConnStatus, NetClient } from '../net/client';
import { digestOfState, stateHash } from '../net/protocol';
import type { ErrorMsg, GameOverMsg, GameView, SubmitTurnMeld } from '../net/protocol';
import { viewToState } from '../net/viewToState';
import { analyzeMeld, sortMeldCards } from '../rules/rules';
import type { Card, GameState, Meld, ReasonCode, RulesConfig } from '../rules/types';
import { computeMeldLayout, type MeldLayoutInput } from '../table/layout';
import { computeSnapTargets, snapTargetFor, type SnapStatus, type SnapTarget } from '../table/snap';
import { buildTutorialState } from '../tutorial/fixture';
import { TutorialDirector, type TutorialAction } from '../tutorial/director';
import { openPauseMenu } from '../ui/pause-menu';
import { gameRegions, type GameRegions } from '../ui/regions';
import { openRulesPanel } from '../ui/rules-panel';
import { view } from '../ui/viewport';
import { coverBackground } from '../ui/menu-layout';
import { fontStyle, gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi } from '../verification/debug-api';

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
      { name: 'Juninho', isAi: true, personality: 'juninho' },
    ],
    tutorial: true,
  };
}

const MELD_PAD = 4;
const GOLD = 0xf7d23e;
const CONFIRM_GUARD_MS = 250;
/** Bound on how long onlinePending may lock input: a healthy FEITO/COMPRAR round trip is well
 * under this. If neither state_sync nor proposal_rejected arrives in time (dropped/ignored
 * proposal, no socket close), the lock releases itself and a resync is requested. */
const ONLINE_PENDING_TIMEOUT_MS = 10000;
/** Prefix shown on the FEITO label whenever it's disabled — a text cue beyond the tint, for colorblind/low-contrast users. */
const FEITO_DISABLED_PREFIX = '✕ ';

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
  private meldGlowRects: { meldId: string; rect: Phaser.GameObjects.Rectangle }[] = [];
  private hud: Phaser.GameObjects.GameObject[] = [];
  private meldTooltip: Phaser.GameObjects.GameObject[] = [];
  private feitoBtn!: PixelButton;
  private comprarBtn!: PixelButton;
  private reasonText!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private bannerBg!: Phaser.GameObjects.Rectangle;
  private unsubs: (() => void)[] = [];
  private aiTimer: Phaser.Time.TimerEvent | null = null;

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
  /** Non-mutating ghost preview panel shown while hovering a drop zone. */
  private ghostPreview: Phaser.GameObjects.GameObject[] = [];
  /** Which zone the ghost preview currently reflects: undefined = none, '' = empty table area, else a meldId. Lets hover redraw only on actual change, never per pointer-move. */
  private hoverKey: string | undefined = undefined;

  // FEITO accidental-confirm guard
  private validSince: number | null = null;
  private lastValidOk = false;

  // tutorial mode
  private tutorialDirector: TutorialDirector | null = null;

  private sortMode: SortMode = 'suit';
  private ambienceSound: (Phaser.Sound.BaseSound & { volume: number }) | null = null;
  private pauseOpen = false;
  private tutorialCompletedRecorded = false;

  // online mode — 0 for every local/AI/tutorial game, the server-assigned seat when online
  private localSeat = 0;
  private online: { client: NetClient; seat: number; code: string; lastRev: number } | null = null;
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

  // last opponent action: which table cards it touched, plus a one-line summary. A rearranging
  // opponent changes the puzzle's structure, so the new position needs to be readable, not guessed.
  private lastMoveIds = new Set<string>();
  private lastMoveText: Phaser.GameObjects.Text | null = null;
  /** Readback of the most recently *confirmed* (meld) turn — read by onWin() to build the
   * results-screen "winning move" line. Cleared on a draw, since a stalemate win has no meld play
   * to describe. Set right before store.confirmTurn(), since game:won fires synchronously inside it. */
  private lastConfirmedMoveText: string | null = null;

  // select-then-place — the drag-free way to play (keyboard and touch both route through it)
  private selectedCardId: string | null = null;
  private focusIndex = 0;
  private focusTargets: FocusTarget[] = [];
  /** Focus ring is drawn only once the keyboard has been used, so mouse players never see it. */
  private focusVisible = false;

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
      ? { client: config.online.client, seat: config.online.seat, code: config.online.code, lastRev: config.online.view.rev }
      : null;
    this.localSeat = config.online ? config.online.seat : 0;
    this.setOnlinePending(false);
    this.lastRejections = [];
    this.lastMoveIds = new Set();
    this.selectedCardId = null;
    this.focusIndex = 0;
    this.focusVisible = false;
    debugApi.scene = config.tutorial ? 'tutorial' : 'game';
    debugApi.seed = config.seed;
    if (!config.tutorial && !config.online) settings.setLastSeed(config.seed);
    this.tutorialCompletedRecorded = false;

    if (config.online) {
      // Online: never construct AI seats. State comes from the server's redacted view only —
      // see src/net/viewToState.ts for why opponent hand/draw-pile are placeholders here.
      this.personalities = [];
      this.store = new GameStore(viewToState(config.online.view));
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
          ? buildShowcaseState(config.seed, playerCfgs)
          : createNewGame(config.seed, playerCfgs);
      this.store = new GameStore(state);
    }
    debugApi.state = () => this.store.get();
    this.tutorialDirector = config.tutorial ? new TutorialDirector() : null;
    debugApi.tutorialStep = this.tutorialDirector?.stepIndex ?? null;

    this.r = gameRegions(view());

    const playerCount = this.store.get().players.length;
    // Local cosmetic choice — purely visual, never affects rules/protocol. Missing art (theme
    // not shipped yet) degrades to the default table rather than a broken/blank image.
    const tableKey = cosmeticTextureKey(TABLE_THEMES, settings.cosmetics().tableTheme, DEFAULT_TABLE_THEME, debugApi.missingAssets);
    // Cover-fit, not stretch: the table art is authored 480x270, and squashing it into the
    // 270x480 portrait world smears the baked-in props. Identity in landscape.
    coverBackground(this, tableKey);
    // calm the busy tablecloth/props so cards and HUD stay readable
    this.add.rectangle(this.r.w / 2, this.r.h / 2, this.r.w, this.r.h, 0x1a0f0a, playerCount > 2 ? 0.22 : 0.08);
    // near-opaque top bar: baked-in table props (mug/etc.) sit right behind this strip in some
    // backgrounds — keep it solid enough that avatars/names never fight prop art for legibility.
    this.add.rectangle(this.r.w / 2, this.r.barH / 2, this.r.w, this.r.barH, 0x1a0f0a, 0.88);
    if (!this.r.portrait) {
      // Landscape-only felt dressing, both keyed to the 480x270 art: a dim patch behind the
      // right-hand action column, and a prop covering a paint smudge on the boteco felt. Portrait
      // reframes that art entirely (and puts the action bar along the bottom), so neither lands
      // where it was drawn for — the portrait board dims the whole table instead.
      this.add.rectangle(444, 226, 72, 96, 0x1a0f0a, 0.55);
      if (playerCount <= 2) {
        this.add.image(60, 60, 'prop-dominoes').setDisplaySize(32, 24).setDepth(1);
      }
    }

    this.buildStaticUi();
    this.startAmbience();
    this.unsubs.push(
      bus.on('game:won', () => this.onWin()),
      bus.on('turn:start', () => this.onTurnStart()),
      settings.onChange(() => {
        if (this.ambienceSound) this.ambienceSound.volume = settings.musicVolume();
      }),
      bus.on('viewport:changed', () => this.relayout()),
    );
    if (config.online) this.wireOnline(config.online.client);
    this.events.once('shutdown', () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.aiTimer?.remove();
      this.onlinePendingTimer?.remove();
      this.ambienceSound?.stop();
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.selectedCardId !== null) {
        this.clearSelection();
        return;
      }
      this.togglePause();
    });
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.handleShortcut(e));

    setMusicContext('game');
    playSfx(this, 'sfx-deal');
    this.onTurnStart();
    debugApi.ready = true;
  }

  /** Socket wiring + debug-api surface for an online match. Never runs offline. */
  private wireOnline(client: NetClient): void {
    this.unsubs.push(
      client.on('state_sync', (msg) => this.onOnlineStateSync(msg.view)),
      client.on('proposal_rejected', (msg) => this.onOnlineRejected(msg.reasons)),
      client.on('game_over', (msg) => this.onOnlineGameOver(msg)),
      client.on('player_disconnected', (msg) => this.onOnlineOpponentEvent(msg.seat, true)),
      client.on('player_reconnected', (msg) => this.onOnlineOpponentEvent(msg.seat, false)),
      client.on('error', (msg) => this.onOnlineTerminalError(msg)),
      client.onStatus((s) => this.onOnlineStatusChange(s)),
    );
    debugApi.online = {
      status: () => client.getStatus(),
      code: () => this.online?.code ?? null,
      seat: () => this.online?.seat ?? null,
      rev: () => this.online?.lastRev ?? null,
      players: () => [],
      notice: () => this.onlineNoticeText?.text ?? '',
      lastRejections: () => this.lastRejections,
      trace: () => client.trace,
      createRoom: () => { /* not applicable mid-match */ },
      joinRoom: () => { /* not applicable mid-match */ },
      setReady: () => { /* not applicable mid-match */ },
      startGame: () => { /* not applicable mid-match */ },
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

  // ---------- online reconciliation (docs/MULTIPLAYER_ARCHITECTURE.md §6) ----------

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
    this.onlineNoticeText?.setText(t('online.resyncing'));
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
    this.onlineNoticeText?.setText('');
    const before = this.store.get();
    const actingSeat = before.activePlayerIndex;
    this.store = new GameStore(viewToState(view));
    if (actingSeat === this.localSeat) this.clearLastMove();
    else this.noteOpponentMove(before, this.store.get(), actingSeat);
    debugApi.state = () => this.store.get();
    this.editor = null;
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
    this.onlineNoticeText?.setText(t('online.resyncing'));
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
    const perPlayer = playlog.summary().perPlayer; // best-effort — an online store never emits turn:confirmed/turn:drawn locally
    const results = state.players.map((p, i) => ({
      name: p.name,
      cardsLeft: p.hand.length,
      isWinner: p.id === msg.winnerId,
      avatarKey: this.avatarKey(i),
      ...playerStats(p.id, perPlayer),
    }));
    const client = this.online.client;
    this.time.delayedCall(400, () => {
      gotoScene(this, 'win', {
        winnerName: winner?.name ?? '',
        stalemate: msg.stalemate,
        config: this.config,
        online: { client },
        results,
      });
    });
  }

  /** Terminal server error mid-match: room reaped/opponent gone for good (S1/S2), or the C1
   * reconnect attempt was refused (`invalid_token` — the grace window expired server-side).
   * Either way: a clear localized notice, then back to the menu — never a silent scene switch. */
  private onOnlineTerminalError(msg: ErrorMsg): void {
    if (!this.online || (msg.code !== 'room_closed' && msg.code !== 'invalid_token')) return;
    this.onlineNoticeText?.setText(msg.code === 'room_closed' ? t('online.roomClosed') : t('online.connectionLost'));
    this.time.delayedCall(2000, () => {
      if (!this.online) return; // scene already moved on
      this.online.client.disconnect();
      debugApi.online = null;
      gotoScene(this, 'menu');
    });
  }

  private onOnlineOpponentEvent(seat: number, disconnected: boolean): void {
    if (!this.online || seat === this.localSeat || !this.onlineNoticeText) return;
    this.onlineNoticeText.setText(disconnected ? t('online.opponentDisconnected') : t('online.opponentReconnected'));
    if (!disconnected) this.time.delayedCall(3000, () => this.onlineNoticeText?.setText(''));
  }

  /** Corner connection dot +, on an unexpected close, one C1 reconnect attempt ("reconnecting..."),
   * then — only if that attempt also fails — the non-modal notice and a return to the menu. */
  private onOnlineStatusChange(status: ConnStatus): void {
    if (!this.onlineStatusDot) return;
    const color =
      status === 'open' ? 0x3ec06a : status === 'connecting' || status === 'reconnecting' ? 0xf7d23e : 0xd83a3a;
    this.onlineStatusDot.setFillStyle(color);
    if (status === 'reconnecting') {
      this.onlineNoticeText?.setText(t('online.reconnecting'));
      return;
    }
    if (status === 'closed' || status === 'error') {
      this.onlineNoticeText?.setText(t('online.connectionLost'));
      this.time.delayedCall(2500, () => {
        if (!this.online) return; // scene already moved on
        this.online.client.disconnect();
        debugApi.online = null;
        gotoScene(this, 'menu');
      });
    }
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

    if (isMyTurn) {
      setMusicContext('mexe');
      this.editor = new DraftEditor(state);
      this.bindMexeHooks();
      this.renderAll();
      this.tweens.add({ targets: this.banner, scale: { from: 1, to: 1.22 }, yoyo: true, duration: Math.max(1, this.motion(160)) });
      return;
    }

    setMusicContext('game');
    this.editor = null;
    debugApi.mexe = null;
    this.renderAll();
    if (this.online) return; // opponent's turn online: read-only, never an AI timer

    if (this.tutorialDirector) {
      // tutorial opponent: no thinking, always draws so the human's next scripted turn arrives fast
      this.aiTimer = this.time.delayedCall(500, () => {
        this.store.drawEndTurn();
        if (this.store.get().phase === 'playing') this.renderAll();
      });
    } else {
      const personality = this.personalities[state.activePlayerIndex]!;
      this.aiTimer = this.time.delayedCall(this.aiThinkDelay(personality, state), () => this.runAiTurn(personality));
    }
  }

  /** Presentation-only "thinking" pause before an AI's move lands — never affects the AI's own
   * 400ms search deadline. Bia's pace grows with table complexity (more melds to weigh); every
   * personality is capped and scaled by settings.motionScale() (0 under reducedMotion). */
  private aiThinkDelay(personality: Personality, state: GameState): number {
    const style = PERSONALITY_STYLE[personality];
    const complexityBonus = personality === 'bia' ? Math.min(400, state.table.length * 60) : 0;
    return Math.round(this.motion(style.thinkMs + complexityBonus));
  }

  /** Draft undo/redo/reset — shared by the toolbar buttons, keyboard shortcuts and the e2e hook,
   * so the playlog record lives in one place instead of five. */
  private onUndo(): void {
    if (this.editor?.undo()) {
      playlog.record('undo');
      this.refreshDraft();
    }
  }

  private onRedo(): void {
    if (this.editor?.redo()) {
      playlog.record('redo');
      this.refreshDraft();
    }
  }

  private onReset(): void {
    if (!this.editor) return;
    this.editor.reset();
    playlog.record('reset');
    this.refreshDraft();
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
      snapTargets: (cardId: string) =>
        this.computeSnapTargetsFor(cardId).map((tg) => ({ meldId: tg.meldId, status: tg.status, reason: tg.reason })),
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
    return computeSnapTargets(draft, card, this.store.get().config);
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
    const key = played <= 0 ? 'game.lastMove.drew' : moved > 0 ? 'game.lastMove.mexeu' : 'game.lastMove.played';
    this.lastMoveText?.setText(t(key, { name, n: Math.max(0, played), m: moved }));
  }

  private clearLastMove(): void {
    if (this.lastMoveIds.size === 0 && !this.lastMoveText?.text) return;
    this.lastMoveIds = new Set();
    this.lastMoveText?.setText('');
  }

  private runAiTurn(personality: Personality): void {
    const state = this.store.get();
    const player = state.players[state.activePlayerIndex]!;
    const actingSeat = state.activePlayerIndex;
    try {
      const decision = createAi(personality).decide(state);
      bus.emit('ai:thought', { playerId: player.id, text: decision.explanation });
      debugApi.lastAiThought = decision.explanation;
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
      // AI must never break the game: fall back to draw.
      debugApi.errors.push(`ai fallback: ${String(e)}`);
      this.showEmote(state.activePlayerIndex, 'annoyed');
      this.store.drawEndTurn();
    }
    this.noteOpponentMove(state, this.store.get(), actingSeat);
    if (this.store.get().phase === 'playing') this.renderAll();
  }

  private onWin(): void {
    const state = this.store.get();
    const winner = state.players.find((p) => p.id === state.winnerId)!;
    playSfx(this, 'sfx-win');
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
    this.time.delayedCall(400, () => {
      gotoScene(this, 'win', {
        winnerName: winner.name,
        stalemate,
        config: this.config,
        results,
        winningMoveText: stalemate ? '' : (this.lastConfirmedMoveText ?? ''),
      });
    });
  }

  // ---------- static UI ----------

  private buildStaticUi(): void {
    this.staticUi = [];
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
      panel.lineStyle(1, GOLD, 0.35);
      panel.strokeRect(ap.x, ap.y, ap.w, ap.h);
    } else {
      panel.fillRoundedRect(ap.x, ap.y, ap.w, ap.h, 4);
      panel.lineStyle(1, GOLD, 0.35);
      panel.strokeRoundedRect(ap.x, ap.y, ap.w, ap.h, 4);
    }

    this.feitoBtn = new PixelButton(this, this.r.feito.x, this.r.feito.y, t('game.feito'), () => this.onFeito(), {
      textureBase: 'btn-feito', w: this.r.feito.w, h: this.r.feito.h, size: this.r.feito.size, tooltip: t('tooltip.feito'),
      onBlocked: () => this.onFeitoBlocked(),
    });
    this.comprarBtn = new PixelButton(this, this.r.comprar.x, this.r.comprar.y, t('game.comprar'), () => this.onComprar(), {
      textureBase: 'btn-comprar', w: this.r.comprar.w, h: this.r.comprar.h, size: this.r.comprar.size, tooltip: t('tooltip.comprar'),
    });
    const undoBtn = new PixelButton(this, this.r.undo.x, this.r.undo.y, '↶', () => this.onUndo(), { textureBase: 'btn-small', w: this.r.undo.w, h: this.r.undo.h, size: this.r.undo.size, color: 0x5e5646, tooltip: t('tooltip.undo') });
    const redoBtn = new PixelButton(this, this.r.redo.x, this.r.redo.y, '↷', () => this.onRedo(), { textureBase: 'btn-small', w: this.r.redo.w, h: this.r.redo.h, size: this.r.redo.size, color: 0x5e5646, tooltip: t('tooltip.redo') });
    const resetBtn = new PixelButton(this, this.r.reset.x, this.r.reset.y, '⟲', () => this.onReset(), { textureBase: 'btn-small', w: this.r.reset.w, h: this.r.reset.h, size: this.r.reset.size, color: 0x8e4632, tooltip: t('tooltip.reset') });

    // shifted off the corner: at (18,254) the table-frame art clipped this icon on both edges.
    const sortBtn = new PixelButton(this, this.r.sort.x, this.r.sort.y, '⇅', () => {
      this.sortMode = this.sortMode === 'suit' ? 'rank' : 'suit';
      this.renderAll();
    }, { textureBase: 'btn-small', w: this.r.sort.w, h: this.r.sort.h, size: this.r.sort.size, color: 0x5e5646, tooltip: t('tooltip.sort') });

    this.staticUi.push(panel, this.feitoBtn, this.comprarBtn, undoBtn, redoBtn, resetBtn, sortBtn);

    if (!this.config.tutorial) {
      // tutorial mode uses the whole right column for its step panel — no room for the gear there (Esc still opens pause)
      const gearBtn = new PixelButton(this, this.r.gear.x, this.r.gear.y, '⚙', () => this.togglePause(), {
        textureBase: 'btn-small', w: this.r.gear.w, h: this.r.gear.h, size: this.r.gear.size, color: 0x5e5646, tooltip: t('tooltip.settings'),
      });
      this.staticUi.push(gearBtn);
    }

    this.reasonText = this.add
      .text(this.r.reason.x, this.r.reason.y, '', { ...fontStyle(this.r.reason.size, '#f7d23e'), align: 'center', wordWrap: { width: this.r.reason.wrap } })
      .setOrigin(0.5, this.r.reason.originY);
    // bolder turn prompt: its own row below the avatar strip (not overlapping opponent name/avatar
    // cells at 3-4p) with an opaque pill behind the text (resized in renderAll) so "Sua vez" / the
    // AI's name always reads clearly regardless of what's behind it.
    this.bannerBg = this.add.rectangle(this.r.banner.x, this.r.banner.y, 10, 10, 0x1a1410, 0.78).setDepth(49);
    this.banner = label(this, this.r.banner.x, this.r.banner.y, '', 11, '#f7d23e').setDepth(50);
    // one-line readback of the opponent's last action, just above the table
    this.lastMoveText = this.add
      .text(this.r.lastMove.x, this.r.lastMove.y, '', { ...fontStyle(8, '#d8c890'), align: 'center', wordWrap: { width: this.r.lastMove.wrap } })
      .setOrigin(0.5)
      .setDepth(50);
    this.staticUi.push(this.reasonText, this.bannerBg, this.banner, this.lastMoveText);

    if (this.online) {
      // small corner connection indicator — never a modal, per docs/PHASE5_CLIENT_PLAN.md section A
      this.onlineStatusDot = this.add.circle(this.r.onlineDot.x, this.r.onlineDot.y, 3, 0x3ec06a).setDepth(600);
      // named, not just a colored dot: a local/AI/tutorial match never shows this, so its mere
      // presence — not just its color — is the "you are online" tell (task: never ambiguous).
      const onlineLabel = label(this, this.r.onlineDot.x + 10, this.r.onlineDot.y, t('game.onlineBadge'), 6, '#8a7f68').setOrigin(0, 0.5).setDepth(600);
      this.onlineNoticeText = this.add
        .text(this.r.onlineNotice.x, this.r.onlineNotice.y, '', { ...fontStyle(8, '#f0c040'), align: 'center', wordWrap: { width: this.r.onlineNotice.wrap } })
        .setOrigin(0.5)
        .setDepth(600);
      this.staticUi.push(this.onlineStatusDot, onlineLabel, this.onlineNoticeText);
    }
  }

  /** Re-lays-out the live scene on an orientation/pointer flip (bus 'viewport:changed') without
   * restarting it — this.store/this.editor/the online client all hold live match state. */
  private relayout(): void {
    if (!this.scene.isActive()) return;
    this.r = gameRegions(view());
    const savedNotice = this.onlineNoticeText?.text ?? '';
    for (const o of this.staticUi) o.destroy();
    this.buildStaticUi();
    this.onlineNoticeText?.setText(savedNotice);
    this.renderAll();
  }

  private refreshDraft(): void {
    playSfx(this, 'sfx-snap', 0.3);
    this.renderAll();
  }

  /** Esc key or gear button: pauses the AI turn timer (guarded — tutorial's own timer just resumes when closed) while the pause overlay (Continue/Settings/Help/Quit) is open. */
  private togglePause(): void {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    const wasPaused = this.aiTimer?.paused ?? false;
    if (this.aiTimer) this.aiTimer.paused = true;
    openPauseMenu(this, { onQuit: () => this.quitToMenu() }, () => {
      this.pauseOpen = false;
      if (this.aiTimer) this.aiTimer.paused = wasPaused;
    });
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
    if (fromHand) {
      if (kind !== 'hand') acted = this.editor.playHandCard(cardId, kind === 'meld' ? meldId : null);
    } else if (kind === 'hand') {
      acted = this.editor.returnHandCard(cardId); // only cards played this turn can go back
    } else {
      acted = this.editor.moveTableCard(cardId, kind === 'meld' ? meldId : null);
    }
    playSfx(this, acted ? 'sfx-drop' : 'sfx-invalid', 0.5);
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
    const meld = this.editor.getDraft().melds.find((m) => m.cards.some((c) => c.id === cardId));
    if (meld) this.placeSelected('meld', meld.id);
    else this.placeSelected('hand', null);
  }

  /** H shortcut: opens the rules panel directly (same AI-timer pause/resume dance as the gear/Esc pause menu). */
  private openHelp(): void {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    const wasPaused = this.aiTimer?.paused ?? false;
    if (this.aiTimer) this.aiTimer.paused = true;
    openRulesPanel(this, () => {
      this.pauseOpen = false;
      if (this.aiTimer) this.aiTimer.paused = wasPaused;
    });
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
    const check = this.editor.canConfirm();
    const heldLongEnough = this.validSince !== null && this.time.now - this.validSince >= CONFIRM_GUARD_MS;
    if (!check.ok || !heldLongEnough) {
      playSfx(this, 'sfx-invalid');
      if (!check.ok) playlog.record('feito:blocked', { reasons: check.reasons.join(',') });
      return;
    }
    playSfx(this, 'sfx-feito');
    this.clearLastMove();
    const draft = this.editor.getDraft();
    const handCardIds = new Set(draft.handCardsPlayed);
    const sparkleTargets = this.cardSprites
      .filter((s) => handCardIds.has(s.getData('cardId') as string))
      .map((s) => ({ x: s.x, y: s.y }));
    const beforeState = this.store.get();
    const activePlayer = beforeState.players[beforeState.activePlayerIndex]!;
    const { key, params } = summarizeMoveKey(beforeState.table, draft.melds, draft.handCardsPlayed.length);
    this.lastConfirmedMoveText = t(key, { name: activePlayer.name, ...params });
    this.editor = null;
    this.store.confirmTurn(draft);
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
    this.store.drawEndTurn();
    if (this.store.get().phase === 'playing') this.renderAll();
  }

  /** FEITO online: submit-and-wait. Never mutates the store locally — only a server state_sync does. */
  private onFeitoOnline(): void {
    if (!this.editor || !this.online || this.onlinePending) return;
    const check = this.editor.canConfirm();
    const heldLongEnough = this.validSince !== null && this.time.now - this.validSince >= CONFIRM_GUARD_MS;
    if (!check.ok || !heldLongEnough) {
      playSfx(this, 'sfx-invalid');
      if (!check.ok) playlog.record('feito:blocked', { reasons: check.reasons.join(',') });
      return;
    }
    playSfx(this, 'sfx-feito');
    const draft = this.editor.getDraft();
    const melds: SubmitTurnMeld[] = draft.melds.map((m) => ({ id: m.id, cardIds: m.cards.map((c) => c.id) }));
    this.setOnlinePending(true);
    this.online.client.submitTurn(this.online.lastRev, melds);
    this.renderAll();
  }

  /** COMPRAR online: same submit-and-wait discipline as FEITO. */
  private onComprarOnline(): void {
    if (!this.editor || !this.online || this.onlinePending) return;
    playSfx(this, 'sfx-draw');
    this.setOnlinePending(true);
    this.online.client.drawEndTurn(this.online.lastRev);
    this.renderAll();
  }

  // ---------- rendering ----------

  private renderAll(): void {
    if (this.tutorialDirector) this.checkTutorialProgress();
    this.clearGhostPreview();
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
    const interactive = human && !this.onlinePending; // pending FEITO/COMPRAR locks input, not just AI turns

    // top bar: opponents — the active seat gets a bigger avatar + double gold ring, a static (not
    // animated) highlight so it stays reduced-motion-safe with zero extra tweens per render.
    let x = this.r.opponentX0;
    state.players.forEach((p, i) => {
      if (i === this.localSeat) return; // local seat rendered at bottom
      const key = this.avatarKey(i);
      const isActiveP = i === active;
      const avSize = isActiveP ? 25 : 20;
      // text offset follows the avatar's outer extent (rings included) so it clears them at every
      // size instead of a fixed offset that a short name can end up hiding behind (L3).
      const outer = isActiveP ? avSize + 11 : avSize;
      const textX = x + outer / 2 + 4;
      const av = this.add.image(x, this.r.opponentY, key).setDisplaySize(avSize, avSize);
      const name = this.add.text(textX, this.r.opponentY - 11, p.name, fontStyle(9, isActiveP ? '#f7d23e' : '#d8d0c0'));
      const count = this.add.text(textX, this.r.opponentY + 2, `x${p.hand.length}`, fontStyle(8));
      if (isActiveP) {
        const ring = this.add.rectangle(x, this.r.opponentY, avSize + 6, avSize + 6).setStrokeStyle(2, 0xf7d23e, 1);
        const glow = this.add.rectangle(x, this.r.opponentY, avSize + 11, avSize + 11).setStrokeStyle(1, 0xf7d23e, 0.4);
        this.hud.push(glow, ring);
      }
      this.hud.push(av, name, count);
      x += this.r.opponentStep;
    });

    // deck counter
    const cardBackKey = cosmeticTextureKey(CARD_BACKS, settings.cosmetics().cardBack, DEFAULT_CARD_BACK, debugApi.missingAssets);
    const deckImg = this.add.image(this.r.deckImg.x, this.r.deckImg.y, cardBackKey).setDisplaySize(14, 19);
    const deckTxt = this.add.text(this.r.deckText.x, this.r.deckText.y, String(state.drawPile.length), fontStyle(9));
    this.hud.push(deckImg, deckTxt);

    // banner
    const activeName = state.players[active]!.name;
    this.banner.setText(
      human ? t('game.yourTurn') : this.online ? t('game.opponentTurn', { name: activeName }) : t('game.turnOf', { name: activeName }),
    );
    this.bannerBg.setSize(this.banner.width + 14, this.banner.height + 6);

    // table melds (draft when human editing, committed otherwise). One shared analysis pass —
    // invalid-badge display and the FEITO gate below both need it, and each walks every meld.
    const melds = this.editor ? this.editor.getDraft().melds : state.table;
    const analysis = this.editor?.analyze() ?? null;
    const invalidReasons = new Map((analysis?.invalidMelds ?? []).map((r) => [r.meldId, t(r.reason)]));
    this.layoutMelds(melds, invalidReasons, interactive, state.config);

    // local seat's hand
    const hand = this.editor ? this.editor.getRemainingHand() : state.players[this.localSeat]!.hand;
    this.layoutHand(hand, interactive);

    // buttons + reason
    if (interactive && this.editor && analysis) {
      const check = analysis.check;
      if (check.ok && !this.lastValidOk) this.validSince = this.time.now;
      if (!check.ok) this.validSince = null;
      this.lastValidOk = check.ok;
      this.setFeitoEnabled(check.ok && this.tutorialAllows({ type: 'feito' }));
      this.comprarBtn.setEnabled(this.tutorialAllows({ type: 'comprar' }));
      this.reasonText.setText(this.blockingReasonText());
      debugApi.validation = { ok: check.ok, reasons: check.ok ? [] : check.reasons };
    } else {
      this.setFeitoEnabled(false);
      this.comprarBtn.setEnabled(false);
      this.reasonText.setText(human && this.onlinePending ? t('game.pending') : '');
      debugApi.validation = null;
      this.validSince = null;
      this.lastValidOk = false;
    }

    this.renderSelectionLayer(interactive, invalidReasons.size > 0);
    debugApi.a11y = { invalidBadges: invalidReasons.size };
    if (this.tutorialDirector) this.renderTutorialOverlay();
  }

  /** What's blocking FEITO right now: top invalid-meld reason, else the objective-phase text, else
   * the raw canConfirm() reason. Single source for both the on-screen reasonText and the disabled
   * FEITO button's tap feedback, so the two can never disagree. */
  private blockingReasonText(): string {
    if (!this.editor) return '';
    const analysis = this.editor.analyze();
    const check = analysis.check;
    // "what does the game want right now": ready-to-confirm / fix-the-invalid-meld / play-or-draw
    // cover almost every turn; the rare remainder (e.g. a returned table card) falls back to the
    // specific canConfirm() reason, same text as before.
    const phase = objectivePhase(check.ok, analysis.invalidMelds.length > 0, this.editor.getDraft().handCardsPlayed.length > 0);
    // The exact top reason beats the generic "fix the invalid meld" phase text whenever one exists.
    const topInvalidReason = analysis.invalidMelds[0]?.reason ?? null;
    return topInvalidReason ? t(topInvalidReason) : phase ? t(objectiveKey(phase)) : check.ok ? '' : t(check.reasons[0] ?? '');
  }

  /** Tap on a disabled FEITO: silently ignoring the press hides the reason it's blocked, so surface
   * it explicitly instead of only via the (hover-only, desktop) tint. */
  private onFeitoBlocked(): void {
    const reason = this.blockingReasonText() || t('tooltip.feito');
    this.reasonText.setText(`${t('mobile.feitoBlocked')} ${reason}`);
    playSfx(this, 'sfx-invalid', 0.15);
  }

  /** FEITO enabled state: beyond the tint, prefix the label with ✕ when disabled so it's not a color-only cue. */
  private setFeitoEnabled(on: boolean): void {
    this.feitoBtn.setEnabled(on);
    this.feitoBtn.setLabel(on ? t('game.feito') : `${FEITO_DISABLED_PREFIX}${t('game.feito')}`);
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

  /** Speech-bubble panel in the unused right column: step text, counter, highlights, SKIP/NEXT/REPLAY. */
  private renderTutorialOverlay(): void {
    const dir = this.tutorialDirector;
    if (!dir) return;
    const cx = 438;
    const panelTop = 2;
    const panelH = 176;

    const g = this.add.graphics().setDepth(300);
    g.fillStyle(0x1a1410, 0.88);
    g.fillRoundedRect(cx - 40, panelTop, 80, panelH, 4);
    g.lineStyle(1, GOLD, 0.7);
    g.strokeRoundedRect(cx - 40, panelTop, 80, panelH, 4);
    this.hud.push(g);

    this.hud.push(label(this, cx, panelTop + 10, t('tutorial.title'), 7, '#f7d23e'));
    this.hud.push(label(this, cx, panelTop + 20, `${dir.stepIndex + 1}/${dir.total}`, 6, '#c0b8a8'));

    const txt = this.add
      .text(cx, panelTop + 34, t(dir.step.textKey), { ...fontStyle(7), align: 'center', wordWrap: { width: 70 } })
      .setOrigin(0.5, 0)
      .setDepth(301);
    this.hud.push(txt);

    if (dir.finished) {
      this.hud.push(label(this, cx, panelTop + panelH - 34, t('win.title'), 10, '#f7d23e'));
      this.hud.push(new PixelButton(this, cx, panelTop + panelH - 20, t('tutorial.replay'), () => this.restartTutorial(), {
        textureBase: 'btn-comprar', w: 74, h: 14, size: 6, color: 0x2e9e50,
      }));
    } else {
      if (dir.step.allowed.some((a) => a.type === 'next')) {
        this.hud.push(new PixelButton(this, cx, panelTop + panelH - 34, t('tutorial.next'), () => {
          dir.next();
          debugApi.tutorialStep = dir.stepIndex;
          this.renderAll();
        }, { textureBase: 'btn-comprar', w: 74, h: 14, size: 6, color: 0x2e9e50 }));
      }
      this.hud.push(new PixelButton(this, cx, panelTop + panelH - 16, t('tutorial.skip'), () => {
        playlog.record('tutorial:skip', { step: dir.stepIndex });
        gotoScene(this, 'menu');
      }, {
        textureBase: 'btn-comprar', w: 74, h: 12, size: 6, color: 0x6b6b73,
      }));
    }

    // highlight cards named by the current step
    const highlightIds = new Set(dir.step.highlightCardIds ?? []);
    if (highlightIds.size > 0) {
      for (const s of this.cardSprites) {
        if (!highlightIds.has(s.getData('cardId') as string)) continue;
        const glow = this.add.rectangle(s.x, s.y, CARD_W + 6, CARD_H + 6).setStrokeStyle(1, GOLD, 0.9).setDepth(290);
        this.tweens.add({ targets: glow, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });
        this.hud.push(glow);
      }
    }

    // highlight named buttons
    for (const btnName of dir.step.highlightButtons ?? []) {
      const btn = btnName === 'feito' ? this.feitoBtn : this.comprarBtn;
      const arrow = label(this, btn.x - 40, btn.y, '▶', 10, '#f7d23e').setDepth(290);
      this.tweens.add({ targets: arrow, x: btn.x - 34, duration: 400, yoyo: true, repeat: -1 });
      this.hud.push(arrow);
    }
  }

  private restartTutorial(): void {
    gotoScene(this, 'game', buildTutorialLaunchConfig());
  }

  /**
   * Hover-only reason tooltip for an invalid meld (rounded dark rect + yellow text). Shown only
   * while the pointer is over the meld's ✗ badge, so it never permanently occludes a neighboring
   * meld the way an always-on label would at crowded tables — the position is still clamped
   * fully inside the table/HUD area as a defensive belt-and-braces measure.
   */
  private showMeldReasonTooltip(rect: Phaser.Geom.Rectangle, text: string): void {
    this.hideMeldReasonTooltip();
    const maxW = this.r.tooltip.maxW;
    const txt = label(this, 0, 0, text, 8, '#f0c040').setDepth(500);
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

  private sortedForDisplay(meld: Meld, config: RulesConfig): Card[] {
    return sortMeldCards(meld.cards, config);
  }

  private layoutMelds(
    melds: readonly Meld[],
    invalidReasons: Map<string, string>,
    interactive: boolean,
    config: RulesConfig,
  ): void {
    this.meldGlowRects = [];
    const handCardIds = new Set(this.editor?.getDraft().handCardsPlayed ?? []);
    const inputs: MeldLayoutInput[] = melds.map((m) => ({ id: m.id, cardCount: m.cards.length }));
    const positions = computeMeldLayout(inputs, this.r.tableAreaW, this.r.tableAreaH);
    const posByMeld = new Map(positions.map((p) => [p.meldId, p]));

    melds.forEach((meld, meldIndex) => {
      const pos = posByMeld.get(meld.id);
      if (!pos) return; // computeMeldLayout always returns one per meld; defensive only
      const scale = pos.cardScale;
      const pad = MELD_PAD * scale;
      const cx = this.r.tableLeft + pos.x;
      const cy = this.r.tableTop + 6 + pos.y;
      const cards = this.sortedForDisplay(meld, config);

      const zoneRect = new Phaser.Geom.Rectangle(cx, cy - pad, pos.width, pos.height);
      this.meldZones.push({ meldId: meld.id, rect: zoneRect });

      // Mexe UX: alternating neutral shading (independent of validity color) keeps crowded adjacent melds visually distinct.
      if (meldIndex % 2 === 1) {
        const shade = this.add
          .rectangle(zoneRect.centerX, zoneRect.centerY, zoneRect.width, zoneRect.height, 0x000000, 0.12)
          .setDepth(-1);
        this.hud.push(shade);
      }

      const isInvalid = invalidReasons.has(meld.id);
      // Joker hint: never derive this ourselves — analyzeMeld is the single source of truth for
      // what a joker stands for. Skip entirely on an invalid meld (task requirement: never invent
      // an assignment when the meld is invalid).
      const jokerLabels = new Map<string, string>();
      if (!isInvalid && meld.cards.some((c) => c.isJoker)) {
        const analysis = analyzeMeld(meld.cards, config);
        if (analysis.valid) {
          for (const a of analysis.assignments) {
            jokerLabels.set(a.cardId, a.suit ? `${SUIT_CHAR[a.suit]}${rankLabel(a.rank)}` : rankLabel(a.rank));
          }
        }
      }
      const color = isInvalid ? 0xd83a3a : 0x3ec06a;
      // colorblind-safe shape channel: solid stroke for valid, dashed for invalid — not hue alone.
      const glow = this.add
        .rectangle(zoneRect.centerX, zoneRect.centerY, zoneRect.width, zoneRect.height, color, this.editor ? 0.18 : 0.1)
        .setDepth(2);
      if (isInvalid) {
        const dashed = this.add.graphics().setDepth(2);
        this.drawDashedRect(dashed, zoneRect.x, zoneRect.y, zoneRect.width, zoneRect.height, color, this.editor ? 0.9 : 0.4);
        this.hud.push(dashed);
      } else {
        glow.setStrokeStyle(1, color, this.editor ? 0.9 : 0.4);
      }
      this.hud.push(glow);
      this.meldGlowRects.push({ meldId: meld.id, rect: glow });

      // colorblind-safe icon channel: ✓/✗ badge, only while the human is actively editing (committed melds are always valid).
      if (interactive) {
        const badge = label(this, zoneRect.x + 4, zoneRect.y + 2, isInvalid ? '✗' : '✓', 7, isInvalid ? '#ff6b5e' : '#7ee0a0')
          .setOrigin(0, 0)
          .setAlpha(isInvalid ? 0.95 : 0.35)
          .setDepth(50);
        this.hud.push(badge);
        // Full reason text only on hover, never rendered by default: at crowded tables rows sit
        // close together and any always-on label wide enough to read would spill onto a
        // neighboring meld. Hover is also the "nearest free space" — the tooltip is clamped
        // fully inside the table area so it can never render off the visible playfield.
        const reason = invalidReasons.get(meld.id);
        if (reason) {
          // Enlarged hit rect: the glyph itself is a few px, far under a usable touch target.
          const pad = 5;
          badge.setInteractive(
            new Phaser.Geom.Rectangle(-pad, -pad, badge.width + pad * 2, badge.height + pad * 2),
            Phaser.Geom.Rectangle.Contains,
          );
          // Tappable, not just hover-only: touch devices have no hover, and a tap there emits
          // pointerover -> pointerdown -> pointerup -> pointerout in one gesture. So the tap
          // latches (`tapped`) and pointerout only hides while unlatched — otherwise the release
          // half of the very tap that opened the tooltip would close it again the same instant.
          let tapped = false;
          badge.on('pointerover', () => this.showMeldReasonTooltip(zoneRect, reason));
          badge.on('pointerout', () => {
            if (!tapped) this.hideMeldReasonTooltip();
          });
          badge.on('pointerdown', () => {
            tapped = !tapped;
            if (tapped) this.showMeldReasonTooltip(zoneRect, reason);
            else this.hideMeldReasonTooltip();
          });
        }
      }

      cards.forEach((card, i) => {
        const cw = CARD_W * scale;
        const ch = CARD_H * scale;
        const x = cx + pad + cw / 2 + i * pos.cardGap;
        const y = cy + ch / 2;
        const sprite = this.makeCardSprite(x, y, card, interactive, 'table', handCardIds.has(card.id), scale);
        sprite.setDepth(3);
        this.cardSprites.push(sprite);
        const jokerLabel = jokerLabels.get(card.id);
        if (jokerLabel) {
          // Read-only hover, works even when it isn't the local player's turn — separate from
          // the drag/tap interactivity above, which is gated on `interactive`.
          if (!sprite.input) sprite.setInteractive();
          const rect = new Phaser.Geom.Rectangle(x - cw / 2, y - ch / 2, cw, ch);
          sprite.on('pointerover', () => this.showMeldReasonTooltip(rect, t('joker.standsFor', { card: jokerLabel })));
          sprite.on('pointerout', () => this.hideMeldReasonTooltip());
        }
        if (this.lastMoveIds.has(card.id)) {
          // persistent "the opponent touched this" marker — stays until the local player acts
          const mark = this.add
            .rectangle(x, y, cw + 3, ch + 3)
            .setStrokeStyle(1, 0xf0a030, 0.95)
            .setDepth(4);
          this.hud.push(mark);
        }
      });
    });
  }

  private layoutHand(hand: readonly Card[], interactive: boolean): void {
    const sorted = [...hand].sort((a, b) => {
      if (a.isJoker || b.isJoker) {
        if (a.isJoker && b.isJoker) return a.id.localeCompare(b.id);
        return a.isJoker ? 1 : -1;
      }
      return this.sortMode === 'suit'
        ? a.suit!.localeCompare(b.suit!) || a.rank! - b.rank!
        : a.rank! - b.rank! || a.suit!.localeCompare(b.suit!);
    });
    const maxSpan = this.r.handSpan;
    const gap = Math.min(CARD_W + 2, sorted.length > 1 ? maxSpan / (sorted.length - 1) : CARD_W);
    const total = (sorted.length - 1) * gap;
    const startX = this.r.handCenterX - total / 2;
    sorted.forEach((card, i) => {
      const sprite = this.makeCardSprite(startX + i * gap, this.r.handY, card, interactive, 'hand', false);
      sprite.setDepth(10 + i);
      this.cardSprites.push(sprite);
    });
  }

  private makeCardSprite(
    x: number,
    y: number,
    card: Card,
    interactive: boolean,
    origin: 'hand' | 'table',
    handAdded: boolean,
    scale = 1,
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
      const padY = fh * 0.3;
      sprite.setInteractive(
        new Phaser.Geom.Rectangle(-padX, -padY, fw + padX * 2, fh + padY * 2),
        Phaser.Geom.Rectangle.Contains,
      );
      if (sprite.input) sprite.input.cursor = 'pointer';
      this.input.setDraggable(sprite);
      this.wireDrag(sprite);
      sprite.on('pointerup', () => {
        if (sprite.getData('dragged')) return; // that was a drag, dragend already handled it
        this.onCardTapped(card.id);
      });
    }
    if (handAdded) {
      // marks a card played from hand this turn — still returnable to hand
      const dot = this.add.circle(x + w / 2 - 2, y - h / 2 + 2, 1.6, GOLD, 1).setDepth(250);
      this.hud.push(dot);
    }
    return sprite;
  }

  private wireDrag(sprite: Phaser.GameObjects.Image): void {
    const baseW = sprite.getData('baseW') as number;
    const baseH = sprite.getData('baseH') as number;
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
      this.dragShadow = this.add
        .ellipse(sprite.x + 2, sprite.y + 5, baseW * 1.05, baseH * 0.5, 0x000000, 0.35)
        .setDepth(299);
      playSfx(this, 'sfx-pickup', 0.4);
      this.hideMeldReasonTooltip();
      this.snapTargets = this.computeSnapTargetsFor(sprite.getData('cardId') as string);
      this.showDropZoneHighlights();
    });
    sprite.on('drag', (_p: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      sprite.setData('dragged', true);
      sprite.setPosition(dragX, dragY);
      this.dragShadow?.setPosition(dragX + 2, dragY + 7);
      this.updateDropZoneHover(dragX, dragY);
    });
    sprite.on('dragend', () => {
      sprite.setData('dragging', false);
      this.dragShadow?.destroy();
      this.dragShadow = null;
      this.clearDropZoneHighlights();
      this.onCardDropped(sprite);
      this.snapTargets = [];
    });
  }

  /** True inside the table drop area, matching `onCardDropped`'s own bounds check exactly — hover
   * preview and drop resolution must never disagree on where "the empty table" is. */
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
    this.drawDashedRect(outline, this.r.tableLeft, this.r.tableTop, this.r.tableAreaW, this.r.tableBottom - this.r.tableTop, GOLD, 0.3);
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
      if (status === 'illegal') {
        dashed = this.add.graphics().setDepth(150);
        this.drawDashedRect(dashed, z.rect.x, z.rect.y, z.rect.width, z.rect.height, 0xd83a3a, hovered ? 1 : 0.85, hovered ? 2 : 1);
      } else {
        const color = status === 'legal' ? 0x3ec06a : GOLD;
        const baseWidth = status === 'legal' ? 2 : 1;
        const baseAlpha = status === 'legal' ? 0.9 : 0.45;
        solid = this.add
          .rectangle(z.rect.centerX, z.rect.centerY, z.rect.width, z.rect.height)
          .setStrokeStyle(hovered ? baseWidth + 1 : baseWidth, color, hovered ? Math.min(1, baseAlpha + 0.3) : baseAlpha)
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
    if (!target) {
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

    const jokerLabels = new Map<string, string>();
    if (target.status === 'legal') {
      for (const a of target.jokerAssignments) {
        jokerLabels.set(a.cardId, a.suit ? `${SUIT_CHAR[a.suit]}${rankLabel(a.rank)}` : rankLabel(a.rank));
      }
    }
    const hasJokerHint = cards.some((c) => jokerLabels.has(c.id));
    const cardRowH = ch + (hasJokerHint ? 8 : 0);

    const statusText =
      target.status === 'legal' ? t('snap.legal') : target.status === 'incomplete' ? t('snap.incomplete') : t(target.reason ?? '');
    const statusColor = target.status === 'legal' ? '#7ee0a0' : target.status === 'incomplete' ? '#f0c040' : '#ff6b5e';
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
      if (hint) objs.push(label(this, x, rowY + ch / 2 + 5, hint, 5, '#f0c040').setDepth(501));
    });

    st.setPosition(cx, cy + panelH / 2 - 6 - st.height / 2).setDepth(501);
    objs.push(st);
    this.ghostPreview = objs;
  }

  private clearGhostPreview(): void {
    for (const o of this.ghostPreview) o.destroy();
    this.ghostPreview = [];
  }

  // ponytail: hand-rolled dashed border — Phaser has no native dashed stroke and this is only a few lines.
  private drawDashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number, width = 1): void {
    g.lineStyle(width, color, alpha);
    const dash = 4;
    const gap = 3;
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
      this.tweens.add({
        targets: sprite,
        x: sprite.getData('homeX') as number,
        y: sprite.getData('homeY') as number,
        displayWidth: CARD_W, displayHeight: CARD_H, ease: 'Back.out', duration: 140,
      });
      return;
    }

    // Which meld target (existing/new) this drop lands on, for the snap-status sfx below.
    // Stays undefined for a return-to-hand — that path has no snap target.
    let landedMeldId: string | null | undefined;
    let acted = false;
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

    const settle = { displayWidth: CARD_W, displayHeight: CARD_H, ease: 'Back.out', duration: Math.max(1, this.motion(140)) };
    if (acted) {
      this.clearLastMove();
      const landedTarget = landedMeldId !== undefined ? snapTargetFor(this.snapTargets, landedMeldId) : null;
      playSfx(this, landedTarget?.status === 'legal' ? 'sfx-snap' : 'sfx-drop', 0.5);
      this.tweens.add({ targets: sprite, ...settle, onComplete: () => this.renderAll() });
    } else {
      // snap back
      this.tweens.add({
        targets: sprite,
        x: sprite.getData('homeX') as number,
        y: sprite.getData('homeY') as number,
        ...settle,
        onComplete: () => this.renderAll(),
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
      return;
    }
    const heldSprite = this.cardSprites.find((s) => s.getData('cardId') === this.selectedCardId);
    if (this.selectedCardId !== null && !heldSprite) this.selectedCardId = null; // undo/reset ate it

    if (this.selectedCardId === null) {
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

      for (const target of this.focusTargets) {
        const zone = this.add
          .rectangle(target.rect.centerX, target.rect.centerY, target.rect.width, target.rect.height, GOLD, 0.07)
          .setDepth(1)
          .setInteractive({ useHandCursor: true });
        zone.on('pointerup', () => this.placeSelected(target.kind, target.id ?? null));
        this.hud.push(zone);
      }
      if (heldSprite) {
        this.hud.push(
          this.add
            .rectangle(heldSprite.x, heldSprite.y, heldSprite.displayWidth + 4, heldSprite.displayHeight + 4)
            .setStrokeStyle(2, GOLD, 1)
            .setDepth(260),
        );
      }
    }

    if (this.focusIndex >= this.focusTargets.length) this.focusIndex = 0;
    const focused = this.focusTargets[this.focusIndex];
    const focusRingVisible = this.focusVisible && !!focused;
    if (focusRingVisible) {
      const gfx = this.add.graphics().setDepth(280);
      this.drawDashedRect(gfx, focused.rect.x - 2, focused.rect.y - 2, focused.rect.width + 4, focused.rect.height + 4, 0xffffff, 0.95);
      this.hud.push(gfx, label(this, this.r.selectHint.x, this.r.selectHint.y, t('game.selectHint'), 7, '#b8b0a0'));
    } else if (this.r.portrait && this.selectedCardId === null) {
      // touch-only one-line caption: guides an untouched board, or points at the ✗ badge once a
      // meld is invalid — replaced above by the keyboard-driven select hint once the focus ring shows.
      const capText = hasInvalidMeld ? t('mobile.warnHint') : t('mobile.tapHint');
      this.hud.push(label(this, this.r.selectHint.x, this.r.selectHint.y, capText, 7, '#b8b0a0'));
    }
  }

  /** `lineMoment` + `personality` together pick a short characterful line (`ai.line.<personality>.<moment>`,
   * see i18n) shown alongside the emote for the handful of moments that call for one — big play,
   * forced draw, near-win. Omit either to show the emote alone (e.g. the error fallback). */
  private showEmote(playerIndex: number, emote: EmoteKey, lineMoment?: 'bigPlay' | 'nearWin' | 'forcedDraw' | null, personality?: Personality): void {
    if (playerIndex === 0) return;
    const x = this.r.opponentX0 + (playerIndex - 1) * this.r.opponentStep;
    const bubble = this.add.image(x + 16, -2, 'emote-bubble').setDisplaySize(18, 16).setDepth(400);
    const icon = this.add.image(x + 16, -3, `emote-${emote}`).setDisplaySize(12, 12).setDepth(401);
    const targets: Phaser.GameObjects.GameObject[] = [bubble, icon];
    let line: Phaser.GameObjects.Text | null = null;
    if (lineMoment && personality) {
      line = this.add
        .text(x + 16, 12, t(`ai.line.${personality}.${lineMoment}`), { ...fontStyle(7, '#f7d23e'), align: 'center', wordWrap: { width: 90 } })
        .setOrigin(0.5, 0)
        .setDepth(402);
      targets.push(line);
    }
    this.tweens.add({ targets, y: '+=28', duration: Math.max(1, this.motion(180)), ease: 'Back.out' });
    this.time.delayedCall(900, () => {
      bubble.destroy();
      icon.destroy();
      line?.destroy();
    });
  }

}

export { rankLabel };
