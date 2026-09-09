import Phaser from 'phaser';
import { createAi, type Personality } from '../ai/ai';
import { playSfx } from '../audio/sfx';
import { CARD_H, CARD_W } from '../assets/manifest';
import { rankLabel, SUIT_CHAR } from '../assets/fallbacks';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { createNewGame, GameStore } from '../game-state/store';
import { buildShowcaseState } from '../demo/showcase';
import { t } from '../localization/i18n';
import { DraftEditor } from '../mexe-mode/draft';
import type { ConnStatus, NetClient } from '../net/client';
import type { ErrorMsg, GameOverMsg, GameView, SubmitTurnMeld } from '../net/protocol';
import { viewToState } from '../net/viewToState';
import { analyzeMeld, sortMeldCards } from '../rules/rules';
import type { Card, GameState, Meld, ReasonCode, RulesConfig } from '../rules/types';
import { computeMeldLayout, type MeldLayoutInput } from '../table/layout';
import { buildTutorialState } from '../tutorial/fixture';
import { TutorialDirector, type TutorialAction } from '../tutorial/director';
import { openPauseMenu } from '../ui/pause-menu';
import { openRulesPanel } from '../ui/rules-panel';
import { fontStyle, label, PixelButton } from '../ui/widgets';
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

const W = 480;
const H = 270;
// pushed down from 36 + reserved column widened from 90: table backgrounds bake in props (napkin,
// bottle-cap, mug) near the top/right edge — this margin keeps the meld grid clear of them instead
// of fighting individual prop rects (ponytail: simple margin, not a full exclusion-zone layout).
const TABLE_TOP = 80;
const TABLE_BOTTOM = 188;
const HAND_Y = 240;
const MELD_PAD = 4;
const TABLE_LEFT = 14;
const TABLE_AREA_W = W - 96 - TABLE_LEFT; // right column reserved for HUD/buttons
const TABLE_AREA_H = TABLE_BOTTOM - TABLE_TOP - 6;
const GOLD = 0xf7d23e;
const BAR_H = 30; // top status bar height
const CONFIRM_GUARD_MS = 250;
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
  private dragZoneHighlights: { meldId: string; gfx: Phaser.GameObjects.Rectangle }[] = [];
  private dragTableOutline: Phaser.GameObjects.Graphics | null = null;

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
  /** True from FEITO/COMPRAR submit until state_sync or proposal_rejected — locks all input. */
  private onlinePending = false;
  private lastRejections: string[] = [];
  private onlineStatusDot: Phaser.GameObjects.Arc | null = null;
  private onlineNoticeText: Phaser.GameObjects.Text | null = null;

  // last opponent action: which table cards it touched, plus a one-line summary. A rearranging
  // opponent changes the puzzle's structure, so the new position needs to be readable, not guessed.
  private lastMoveIds = new Set<string>();
  private lastMoveText: Phaser.GameObjects.Text | null = null;

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
    this.onlinePending = false;
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

    const playerCount = this.store.get().players.length;
    // 2p at the boteco, 3-4p around the family kitchen table
    this.add.image(W / 2, H / 2, playerCount > 2 ? 'bg-kitchen' : 'bg-boteco').setDisplaySize(W, H);
    // calm the busy tablecloth/props so cards and HUD stay readable
    this.add.rectangle(W / 2, H / 2, W, H, 0x1a0f0a, playerCount > 2 ? 0.22 : 0.08);
    // near-opaque top bar: baked-in table props (mug/etc.) sit right behind this strip in some
    // backgrounds — keep it solid enough that avatars/names never fight prop art for legibility.
    this.add.rectangle(W / 2, BAR_H / 2, W, BAR_H, 0x1a0f0a, 0.88);
    this.add.rectangle(444, 226, 72, 96, 0x1a0f0a, 0.55);
    if (playerCount <= 2) {
      // covers a paint smudge on the boteco felt
      this.add.image(60, 60, 'prop-dominoes').setDisplaySize(32, 24).setDepth(1);
    }

    this.buildStaticUi();
    this.startAmbience();
    this.unsubs.push(
      bus.on('game:won', () => this.onWin()),
      bus.on('turn:start', () => this.onTurnStart()),
      settings.onChange(() => {
        if (this.ambienceSound) this.ambienceSound.volume = settings.musicVolume();
      }),
    );
    if (config.online) this.wireOnline(config.online.client);
    this.events.once('shutdown', () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.aiTimer?.remove();
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
      comprar: () => this.onComprar(),
      /** Verification-only: submit a raw (possibly illegal) proposal straight to the server,
       * bypassing the editor's client-side gate — the UI itself never constructs an illegal
       * draft, so this is the only way for `verify:multiplayer` to exercise server-side rejection. */
      submitRaw: (rev, melds) => client.submitTurn(rev, melds),
      forceDrop: () => client.forceDrop(),
    };
    this.onOnlineStatusChange(client.getStatus());
  }

  // ---------- online reconciliation (docs/MULTIPLAYER_ARCHITECTURE.md §6) ----------

  private onOnlineStateSync(view: GameView): void {
    if (!this.online) return;
    if (view.rev < this.online.lastRev) return; // stale/out-of-order delivery — ignore
    this.online.lastRev = view.rev;
    this.onlinePending = false;
    this.onlineNoticeText?.setText('');
    const before = this.store.get();
    const actingSeat = before.activePlayerIndex;
    this.store = new GameStore(viewToState(view));
    if (actingSeat === this.localSeat) this.clearLastMove();
    else this.noteOpponentMove(before, this.store.get(), actingSeat);
    debugApi.state = () => this.store.get();
    this.editor = null;
    if (this.store.get().phase === 'playing') this.onTurnStart();
  }

  private onOnlineRejected(reasons: ReasonCode[]): void {
    if (!this.online) return;
    this.onlinePending = false;
    this.lastRejections = reasons;
    playSfx(this, 'sfx-invalid');
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
    const results = state.players.map((p, i) => ({
      name: p.name,
      cardsLeft: p.hand.length,
      isWinner: p.id === msg.winnerId,
      avatarKey: this.avatarKey(i),
    }));
    const client = this.online.client;
    this.time.delayedCall(400, () => {
      this.scene.start('win', {
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
      this.scene.start('menu');
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
        this.scene.start('menu');
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
      this.editor = new DraftEditor(state);
      this.bindMexeHooks();
      this.renderAll();
      this.tweens.add({ targets: this.banner, scale: { from: 1, to: 1.22 }, yoyo: true, duration: Math.max(1, this.motion(160)) });
      return;
    }

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
      this.aiTimer = this.time.delayedCall(650, () => this.runAiTurn(personality));
    }
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
      undo: wrap(() => this.editor?.undo() ?? false),
      feito: () => {
        if (!this.tutorialAllows({ type: 'feito' })) return false;
        const ok = this.editor?.canConfirm().ok ?? false;
        if (ok) this.onFeito();
        return ok;
      },
      comprar: () => this.onComprar(),
      getDraft: () => this.editor?.getDraft() ?? null,
    };
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
      if (decision.kind === 'confirm') {
        const playedMany = decision.draft.handCardsPlayed.length >= 3;
        this.showEmote(state.activePlayerIndex, playedMany ? 'happy' : 'excited');
        playSfx(this, 'sfx-feito');
        this.store.confirmTurn(decision.draft);
      } else {
        this.showEmote(state.activePlayerIndex, 'thinking');
        playSfx(this, 'sfx-draw');
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
    const results = state.players.map((p, i) => ({
      name: p.name,
      cardsLeft: p.hand.length,
      isWinner: p.id === state.winnerId,
      avatarKey: this.avatarKey(i),
    }));
    this.time.delayedCall(400, () => {
      this.scene.start('win', {
        winnerName: winner.name,
        stalemate: winner.hand.length > 0,
        config: this.config,
        results,
      });
    });
  }

  // ---------- static UI ----------

  private buildStaticUi(): void {
    // opaque backdrop behind the whole FEITO/COMPRAR/undo cluster: table backgrounds bake props
    // (e.g. a cookie plate in the 4p kitchen) right under this column, and the disabled-reason
    // tooltip must stay readable regardless of what's drawn there.
    const panel = this.add.graphics();
    panel.fillStyle(0x1a1410, 0.82);
    panel.fillRoundedRect(398, 140, 78, 130, 4);
    panel.lineStyle(1, GOLD, 0.35);
    panel.strokeRoundedRect(398, 140, 78, 130, 4);

    this.feitoBtn = new PixelButton(this, 440, 210, t('game.feito'), () => this.onFeito(), {
      textureBase: 'btn-feito', w: 64, h: 22, size: 9, tooltip: t('tooltip.feito'),
    });
    this.comprarBtn = new PixelButton(this, 440, 237, t('game.comprar'), () => this.onComprar(), {
      textureBase: 'btn-comprar', w: 64, h: 20, size: 8, tooltip: t('tooltip.comprar'),
    });
    new PixelButton(this, 414, 260, '↶', () => this.editor && this.editor.undo() && this.refreshDraft(), { textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.undo') });
    new PixelButton(this, 434, 260, '↷', () => this.editor && this.editor.redo() && this.refreshDraft(), { textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.redo') });
    new PixelButton(this, 460, 260, '⟲', () => {
      if (this.editor) {
        this.editor.reset();
        this.refreshDraft();
      }
    }, { textureBase: 'btn-small', w: 22, h: 14, size: 8, color: 0x8e4632, tooltip: t('tooltip.reset') });

    // shifted off the corner: at (18,254) the table-frame art clipped this icon on both edges.
    new PixelButton(this, 30, 246, '⇅', () => {
      this.sortMode = this.sortMode === 'suit' ? 'rank' : 'suit';
      this.renderAll();
    }, { textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.sort') });

    if (!this.config.tutorial) {
      // tutorial mode uses the whole right column for its step panel — no room for the gear there (Esc still opens pause)
      new PixelButton(this, 462, 10, '⚙', () => this.togglePause(), {
        textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.settings'),
      });
    }

    this.reasonText = this.add
      .text(440, 191, '', { ...fontStyle(9, '#f7d23e'), align: 'center', wordWrap: { width: 72 } })
      .setOrigin(0.5, 1);
    // bolder turn prompt: its own row below the avatar strip (not overlapping opponent name/avatar
    // cells at 3-4p) with an opaque pill behind the text (resized in renderAll) so "Sua vez" / the
    // AI's name always reads clearly regardless of what's behind it.
    this.bannerBg = this.add.rectangle(240, 41, 10, 10, 0x1a1410, 0.78).setDepth(49);
    this.banner = label(this, 240, 41, '', 11, '#f7d23e').setDepth(50);
    // one-line readback of the opponent's last action, just above the table
    this.lastMoveText = this.add
      .text(240, 70, '', { ...fontStyle(8, '#d8c890'), align: 'center', wordWrap: { width: 300 } })
      .setOrigin(0.5)
      .setDepth(50);

    if (this.online) {
      // small corner connection indicator — never a modal, per docs/PHASE5_CLIENT_PLAN.md section A
      this.onlineStatusDot = this.add.circle(6, H - 6, 3, 0x3ec06a).setDepth(600);
      this.onlineNoticeText = this.add
        .text(240, 58, '', { ...fontStyle(8, '#f0c040'), align: 'center', wordWrap: { width: 300 } })
        .setOrigin(0.5)
        .setDepth(600);
    }
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
    this.scene.start('menu');
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
        if (e.shiftKey) {
          if (this.editor.redo()) this.refreshDraft();
        } else if (this.editor.undo()) {
          this.refreshDraft();
        }
        break;
      case 'y':
        if (this.editor.redo()) this.refreshDraft();
        break;
      case 'r':
        this.editor.reset();
        this.refreshDraft();
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
    if (!this.tutorialAllows({ type: fromHand ? 'playHandCard' : 'moveTableCard', cardId })) {
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
      return;
    }
    playSfx(this, 'sfx-feito');
    this.clearLastMove();
    const draft = this.editor.getDraft();
    const handCardIds = new Set(draft.handCardsPlayed);
    const sparkleTargets = this.cardSprites
      .filter((s) => handCardIds.has(s.getData('cardId') as string))
      .map((s) => ({ x: s.x, y: s.y }));
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
      return;
    }
    playSfx(this, 'sfx-feito');
    const draft = this.editor.getDraft();
    const melds: SubmitTurnMeld[] = draft.melds.map((m) => ({ id: m.id, cardIds: m.cards.map((c) => c.id) }));
    this.onlinePending = true;
    this.online.client.submitTurn(this.online.lastRev, melds);
    this.renderAll();
  }

  /** COMPRAR online: same submit-and-wait discipline as FEITO. */
  private onComprarOnline(): void {
    if (!this.editor || !this.online || this.onlinePending) return;
    playSfx(this, 'sfx-draw');
    this.onlinePending = true;
    this.online.client.drawEndTurn(this.online.lastRev);
    this.renderAll();
  }

  // ---------- rendering ----------

  private renderAll(): void {
    if (this.tutorialDirector) this.checkTutorialProgress();
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
    let x = 60;
    state.players.forEach((p, i) => {
      if (i === this.localSeat) return; // local seat rendered at bottom
      const key = this.avatarKey(i);
      const isActiveP = i === active;
      const avSize = isActiveP ? 25 : 20;
      // text offset follows the avatar's outer extent (rings included) so it clears them at every
      // size instead of a fixed offset that a short name can end up hiding behind (L3).
      const outer = isActiveP ? avSize + 11 : avSize;
      const textX = x + outer / 2 + 4;
      const av = this.add.image(x, 14, key).setDisplaySize(avSize, avSize);
      const name = this.add.text(textX, 3, p.name, fontStyle(9, isActiveP ? '#f7d23e' : '#d8d0c0'));
      const count = this.add.text(textX, 16, `x${p.hand.length}`, fontStyle(8));
      if (isActiveP) {
        const ring = this.add.rectangle(x, 14, avSize + 6, avSize + 6).setStrokeStyle(2, 0xf7d23e, 1);
        const glow = this.add.rectangle(x, 14, avSize + 11, avSize + 11).setStrokeStyle(1, 0xf7d23e, 0.4);
        this.hud.push(glow, ring);
      }
      this.hud.push(av, name, count);
      x += 105;
    });

    // deck counter
    const deckImg = this.add.image(22, 14, 'card-back-0').setDisplaySize(14, 19);
    const deckTxt = this.add.text(34, 8, String(state.drawPile.length), fontStyle(9));
    this.hud.push(deckImg, deckTxt);

    // banner
    const activeName = state.players[active]!.name;
    this.banner.setText(
      human ? t('game.yourTurn') : this.online ? t('game.opponentTurn', { name: activeName }) : t('game.turnOf', { name: activeName }),
    );
    this.bannerBg.setSize(this.banner.width + 14, this.banner.height + 6);

    // table melds (draft when human editing, committed otherwise)
    const melds = this.editor ? this.editor.getDraft().melds : state.table;
    const invalidReasons = new Map((this.editor?.invalidMelds() ?? []).map((r) => [r.meldId, t(r.reason)]));
    this.layoutMelds(melds, invalidReasons, interactive, state.config);

    // local seat's hand
    const hand = this.editor ? this.editor.getRemainingHand() : state.players[this.localSeat]!.hand;
    this.layoutHand(hand, interactive);

    // buttons + reason
    if (interactive && this.editor) {
      const check = this.editor.canConfirm();
      if (check.ok && !this.lastValidOk) this.validSince = this.time.now;
      if (!check.ok) this.validSince = null;
      this.lastValidOk = check.ok;
      this.setFeitoEnabled(check.ok && this.tutorialAllows({ type: 'feito' }));
      this.comprarBtn.setEnabled(this.tutorialAllows({ type: 'comprar' }));
      this.reasonText.setText(check.ok ? '' : t(check.reasons[0] ?? ''));
      debugApi.validation = { ok: check.ok, reasons: check.ok ? [] : check.reasons };
    } else {
      this.setFeitoEnabled(false);
      this.comprarBtn.setEnabled(false);
      this.reasonText.setText(human && this.onlinePending ? t('game.pending') : '');
      debugApi.validation = null;
      this.validSince = null;
      this.lastValidOk = false;
    }

    this.renderSelectionLayer(interactive);
    debugApi.a11y = { invalidBadges: invalidReasons.size };
    if (this.tutorialDirector) this.renderTutorialOverlay();
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
      this.hud.push(new PixelButton(this, cx, panelTop + panelH - 16, t('tutorial.skip'), () => this.scene.start('menu'), {
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
    this.scene.start('game', buildTutorialLaunchConfig());
  }

  /**
   * Hover-only reason tooltip for an invalid meld (rounded dark rect + yellow text). Shown only
   * while the pointer is over the meld's ✗ badge, so it never permanently occludes a neighboring
   * meld the way an always-on label would at crowded tables — the position is still clamped
   * fully inside the table/HUD area as a defensive belt-and-braces measure.
   */
  private showMeldReasonTooltip(rect: Phaser.Geom.Rectangle, text: string): void {
    this.hideMeldReasonTooltip();
    const maxW = 96;
    const txt = label(this, 0, 0, text, 8, '#f0c040').setDepth(500);
    txt.setWordWrapWidth(maxW - 8, true);
    const w = Math.min(maxW, txt.width + 8);
    const h = txt.height + 6;
    const x = Phaser.Math.Clamp(rect.centerX, w / 2 + 2, W - 92);
    const y = Phaser.Math.Clamp(rect.bottom + 6 + h / 2, h / 2 + 2, H - 30);
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
    if (playerIndex === this.localSeat) return 'avatar-player';
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
    const positions = computeMeldLayout(inputs, TABLE_AREA_W, TABLE_AREA_H);
    const posByMeld = new Map(positions.map((p) => [p.meldId, p]));

    melds.forEach((meld, meldIndex) => {
      const pos = posByMeld.get(meld.id);
      if (!pos) return; // computeMeldLayout always returns one per meld; defensive only
      const scale = pos.cardScale;
      const pad = MELD_PAD * scale;
      const cx = TABLE_LEFT + pos.x;
      const cy = TABLE_TOP + 6 + pos.y;
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
          badge.setInteractive({ useHandCursor: false });
          badge.on('pointerover', () => this.showMeldReasonTooltip(zoneRect, reason));
          badge.on('pointerout', () => this.hideMeldReasonTooltip());
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
    const maxSpan = 330;
    const gap = Math.min(CARD_W + 2, sorted.length > 1 ? maxSpan / (sorted.length - 1) : CARD_W);
    const total = (sorted.length - 1) * gap;
    const startX = 200 - total / 2;
    sorted.forEach((card, i) => {
      const sprite = this.makeCardSprite(startX + i * gap, HAND_Y, card, interactive, 'hand', false);
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
    });
  }

  /** Soft gold stroke over every meld zone + a dashed outline over the table area ("drop here for a new meld"). */
  private showDropZoneHighlights(): void {
    this.clearDropZoneHighlights();
    for (const z of this.meldZones) {
      const gfx = this.add
        .rectangle(z.rect.centerX, z.rect.centerY, z.rect.width, z.rect.height)
        .setStrokeStyle(1, GOLD, 0.45)
        .setDepth(150);
      this.dragZoneHighlights.push({ meldId: z.meldId, gfx });
    }
    const outline = this.add.graphics().setDepth(140);
    this.drawDashedRect(outline, TABLE_LEFT, TABLE_TOP, TABLE_AREA_W, TABLE_BOTTOM - TABLE_TOP, GOLD, 0.3);
    this.dragTableOutline = outline;
  }

  private updateDropZoneHover(x: number, y: number): void {
    const zone = this.meldZones.find((z) => z.rect.contains(x, y));
    for (const h of this.dragZoneHighlights) {
      const hovered = zone?.meldId === h.meldId;
      h.gfx.setStrokeStyle(hovered ? 2 : 1, GOLD, hovered ? 0.95 : 0.45);
    }
  }

  private clearDropZoneHighlights(): void {
    for (const h of this.dragZoneHighlights) h.gfx.destroy();
    this.dragZoneHighlights = [];
    this.dragTableOutline?.destroy();
    this.dragTableOutline = null;
  }

  // ponytail: hand-rolled dashed border — Phaser has no native dashed stroke and this is only a few lines.
  private drawDashedRect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, alpha: number): void {
    g.lineStyle(1, color, alpha);
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

    if (!this.tutorialAllows({ type: origin === 'hand' ? 'playHandCard' : 'moveTableCard', cardId })) {
      playSfx(this, 'sfx-invalid', 0.15);
      this.tweens.add({
        targets: sprite,
        x: sprite.getData('homeX') as number,
        y: sprite.getData('homeY') as number,
        displayWidth: CARD_W, displayHeight: CARD_H, ease: 'Back.out', duration: 140,
      });
      return;
    }

    const zone = this.meldZones.find((z) => z.rect.contains(x, y));
    const inTableArea = y > TABLE_TOP - 6 && y < TABLE_BOTTOM + 10 && x < W - 84;
    const inHandArea = y >= HAND_Y - 30;

    let acted = false;
    if (origin === 'hand') {
      if (zone) acted = this.editor.playHandCard(cardId, zone.meldId);
      else if (inTableArea) acted = this.editor.playHandCard(cardId, null);
    } else {
      const currentMeld = this.editor.getDraft().melds.find((m) => m.cards.some((c) => c.id === cardId));
      if (zone && zone.meldId !== currentMeld?.id) {
        acted = this.editor.moveTableCard(cardId, zone.meldId);
      } else if (inHandArea) {
        acted = this.editor.returnHandCard(cardId); // only works for cards played this turn
        if (!acted) playSfx(this, 'sfx-invalid', 0.5);
      } else if (inTableArea && !zone) {
        acted = this.editor.moveTableCard(cardId, null);
      }
    }

    const settle = { displayWidth: CARD_W, displayHeight: CARD_H, ease: 'Back.out', duration: Math.max(1, this.motion(140)) };
    if (acted) {
      this.clearLastMove();
      playSfx(this, 'sfx-drop', 0.5);
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
  private renderSelectionLayer(interactive: boolean): void {
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
        rect: new Phaser.Geom.Rectangle(TABLE_LEFT, TABLE_TOP, TABLE_AREA_W, TABLE_BOTTOM - TABLE_TOP),
      });
      for (const z of this.meldZones) this.focusTargets.push({ kind: 'meld', id: z.meldId, rect: z.rect });
      this.focusTargets.push({ kind: 'hand', rect: new Phaser.Geom.Rectangle(20, HAND_Y - 24, 360, 48) });

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
    if (this.focusVisible && focused) {
      const gfx = this.add.graphics().setDepth(280);
      this.drawDashedRect(gfx, focused.rect.x - 2, focused.rect.y - 2, focused.rect.width + 4, focused.rect.height + 4, 0xffffff, 0.95);
      this.hud.push(gfx, label(this, 190, 265, t('game.selectHint'), 7, '#b8b0a0'));
    }
  }

  private showEmote(playerIndex: number, emote: 'excited' | 'thinking' | 'annoyed' | 'happy'): void {
    if (playerIndex === 0) return;
    const x = 60 + (playerIndex - 1) * 105;
    const bubble = this.add.image(x + 16, -2, 'emote-bubble').setDisplaySize(18, 16).setDepth(400);
    const icon = this.add.image(x + 16, -3, `emote-${emote}`).setDisplaySize(12, 12).setDepth(401);
    this.tweens.add({ targets: [bubble, icon], y: '+=28', duration: Math.max(1, this.motion(180)), ease: 'Back.out' });
    this.time.delayedCall(900, () => {
      bubble.destroy();
      icon.destroy();
    });
  }

}

export { rankLabel };
