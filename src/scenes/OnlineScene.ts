import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { NetClient, type ConnStatus } from '../net/client';
import { errorMessage } from '../net/errors';
import type { GameView, RoomPlayerSummary } from '../net/protocol';
import { fontStyle, label, PixelButton } from '../ui/widgets';
import { debugApi } from '../verification/debug-api';

/** Room codes are always this long — see server/rooms.ts CODE_LENGTH. */
const CODE_LENGTH = 5;

/**
 * Online lobby: idle (create/join) -> lobby (code + ready) -> GameScene (server drives the
 * auto-start on `game_started`). VOLTAR works in every state and always leaves the room and
 * closes the socket. See docs/PHASE5_CLIENT_PLAN.md section A.
 */
export class OnlineScene extends Phaser.Scene {
  private client!: NetClient;
  private phase: 'idle' | 'join' | 'lobby' | 'error' = 'idle';
  /** In-canvas join-code buffer. Replaces the Phase 5 `window.prompt`, which could not be
   * styled, localized, or driven by the verification suite. */
  private codeInput = '';
  private code: string | null = null;
  private seat: number | null = null;
  private players: RoomPlayerSummary[] = [];
  private ready = false;
  private errorMsg: string | null = null;
  private status: ConnStatus = 'closed';
  private unsubs: (() => void)[] = [];
  /** Lobby actions currently "in flight" — a button whose key is here stays disabled so a
   * double-click can't send a second create_room/join_room/start_game before the server (or a
   * cooldown) resolves the first. */
  private inFlight = new Set<string>();

  constructor() {
    super('online');
  }

  create(): void {
    debugApi.scene = 'online';
    this.client = new NetClient();
    this.phase = 'idle';
    this.code = null;
    this.seat = null;
    this.players = [];
    this.ready = false;
    this.errorMsg = null;
    this.codeInput = '';
    this.inFlight.clear();
    this.wireCodeEntry();
    this.wireClient();
    this.installDebugHooks();
    this.client.connect();
    this.rebuild();
    debugApi.ready = true;

    this.events.once('shutdown', () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
    });
  }

  private wireClient(): void {
    this.unsubs.push(
      this.client.onStatus((s, message) => {
        this.status = s;
        // 'error' with the 'unreachable' marker means the initial connection never opened at
        // all (server down/refused) — distinct from a mid-session drop, which uses the normal
        // 'reconnecting'/'closed' status copy instead.
        if (s === 'error' && message === 'unreachable') {
          this.errorMsg = t('online.err.unreachable');
          this.phase = 'error';
        }
        this.rebuild();
      }),
      this.client.on('room_joined', (msg) => {
        this.inFlight.delete('create');
        this.inFlight.delete('join');
        this.code = msg.code;
        this.seat = msg.seat;
        this.players = msg.players;
        this.phase = 'lobby';
        this.rebuild();
      }),
      this.client.on('room_state', (msg) => {
        this.inFlight.delete('ready');
        this.players = msg.players;
        this.rebuild();
      }),
      this.client.on('game_started', (msg) => this.enterMatch(msg.view)),
      // Resuming after a reload: the server answers `reconnect` with `room_joined` (which set
      // code/seat just above) followed by `state_sync` for a match already in progress. Without
      // this the client re-established its seat but sat in the lobby forever.
      this.client.on('state_sync', (msg) => this.enterMatch(msg.view)),
      this.client.on('error', (msg) => {
        // Any in-flight lobby action just got its answer (rejection) — unblock its button.
        this.inFlight.clear();
        // Player sees a translated, actionable sentence — never the raw dev-facing `msg.message`
        // or `msg.code`. The raw code stays available via `client.trace`/debug API for logs.
        this.errorMsg = errorMessage(msg.code);
        this.phase = 'error';
        this.rebuild();
      }),
    );
  }

  /** Hand off to GameScene for a match — from a fresh `game_started` or a resumed `state_sync`. */
  private enterMatch(view: GameView): void {
    if (this.code === null || this.seat === null) return;
    // seed 0: the server never discloses the shuffle seed, and an online client never deals.
    this.scene.start('game', {
      seed: 0,
      players: [],
      online: { client: this.client, view, seat: this.seat, code: this.code },
    });
  }

  private installDebugHooks(): void {
    debugApi.online = {
      status: () => this.status,
      code: () => this.code,
      seat: () => this.seat,
      rev: () => null,
      players: () => this.players,
      notice: () => '',
      lastRejections: () => [],
      trace: () => this.client.trace,
      createRoom: (name) => this.client.createRoom(name ?? t('menu.you')),
      joinRoom: (code, name) => this.client.joinRoom(code, name ?? t('menu.you')),
      setReady: (ready) => {
        this.ready = ready;
        this.client.setReady(ready);
      },
      startGame: () => this.client.startGame(),
      comprar: () => { /* no in-match action while still in the lobby */ },
      submitRaw: () => { /* not applicable in the lobby */ },
      forceDrop: () => this.client.forceDrop(),
      desyncs: () => 0,
      requestResync: () => this.client.requestResync(),
    };
  }

  private backToMenu(): void {
    this.client.leaveRoom();
    debugApi.online = null;
    this.scene.start('menu');
  }

  /** Keyboard-driven code entry: only characters the room alphabet can produce are accepted, so
   * the buffer is always a candidate code and never needs sanitizing on submit. */
  private wireCodeEntry(): void {
    const onKey = (ev: KeyboardEvent): void => {
      if (this.phase !== 'join') return;
      if (ev.key === 'Enter') {
        this.fireOnce('join', 3000, () => this.submitJoin());
        return;
      }
      if (ev.key === 'Escape') {
        this.phase = 'idle';
        this.codeInput = '';
        this.rebuild();
        return;
      }
      if (ev.key === 'Backspace') {
        this.codeInput = this.codeInput.slice(0, -1);
        this.rebuild();
        return;
      }
      const ch = ev.key.toUpperCase();
      if (ch.length === 1 && /[A-Z0-9]/.test(ch) && this.codeInput.length < CODE_LENGTH) {
        this.codeInput += ch;
        this.rebuild();
      }
    };
    this.input.keyboard?.on('keydown', onKey);
    this.unsubs.push(() => this.input.keyboard?.off('keydown', onKey));
  }

  /** Runs `fn` unless `key` is already in flight, then disables it for `cooldownMs` (cleared
   * earlier by a matching server response, e.g. room_joined/error above). */
  private fireOnce(key: string, cooldownMs: number, fn: () => void): void {
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    fn();
    this.time.delayedCall(cooldownMs, () => {
      if (this.inFlight.delete(key)) this.rebuild();
    });
    this.rebuild();
  }

  private submitJoin(): void {
    if (this.codeInput.length === 0) return;
    this.client.joinRoom(this.codeInput, t('menu.you'));
  }

  private copyCode(): void {
    if (!this.code) return;
    navigator.clipboard?.writeText(this.code).catch(() => {
      // clipboard denied/unavailable — the code is already shown on screen, nothing else to do
    });
  }

  private rebuild(): void {
    this.children.removeAll();
    this.add.image(240, 135, 'bg-menu').setDisplaySize(480, 270);
    this.add.rectangle(240, 135, 480, 270, 0x1a0f0a, 0.45);
    // backdrop panel so lobby text reads against the busy boteco scene, same treatment MenuScene
    // uses for its controls (L1) — legible by construction, not by luck of what's behind it.
    this.add.rectangle(240, 138, 280, 236, 0x1a0f0a, 0.62).setStrokeStyle(1, 0xc0a878, 0.6);
    label(this, 240, 26, t('online.title'), 15, '#f7d23e');

    const statusColor =
      this.status === 'open' ? '#3ec06a' : this.status === 'connecting' || this.status === 'reconnecting' ? '#f7d23e' : '#d83a3a';
    label(this, 240, 44, t(`online.status.${this.status}`), 8, statusColor);

    if (this.phase === 'error') {
      this.add
        .text(240, 120, this.errorMsg ?? '', { ...fontStyle(9, '#ff6b5e'), align: 'center', wordWrap: { width: 320 } })
        .setOrigin(0.5);
    } else if (this.phase === 'join') {
      this.renderJoin();
    } else if (this.phase === 'lobby' && this.code !== null) {
      this.renderLobby();
    } else {
      const createBtn = new PixelButton(
        this, 240, 110, t('online.create'),
        () => this.fireOnce('create', 3000, () => this.client.createRoom(t('menu.you'))),
        { textureBase: 'btn-feito', w: 140, h: 24, size: 9 },
      );
      createBtn.setEnabled(!this.inFlight.has('create'));
      new PixelButton(this, 240, 145, t('online.join'), () => {
        this.phase = 'join';
        this.codeInput = '';
        this.rebuild();
      }, { textureBase: 'btn-comprar', w: 140, h: 22, size: 8 });
    }

    new PixelButton(this, 240, 245, t('online.back'), () => {
      // No cooldown/rebuild needed: backToMenu() leaves this scene immediately, so the guard
      // only needs to stop a second click before that happens.
      if (this.inFlight.has('leave')) return;
      this.inFlight.add('leave');
      this.backToMenu();
    }, { textureBase: 'btn-comprar', w: 110, h: 18, size: 7 });
  }

  private renderJoin(): void {
    label(this, 240, 86, t('online.enterCodePrompt'), 9, '#f7f2e7');
    const shown = this.codeInput.padEnd(CODE_LENGTH, '_');
    label(this, 240, 118, shown, 20, this.codeInput ? '#f7d23e' : '#8a7f6e');
    label(this, 240, 148, t('online.codeHint'), 7, '#c0b8a8');
    const confirm = new PixelButton(this, 240, 180, t('online.join'), () => this.fireOnce('join', 3000, () => this.submitJoin()), {
      textureBase: 'btn-feito', w: 120, h: 22, size: 8,
    });
    confirm.setEnabled(this.codeInput.length > 0 && !this.inFlight.has('join'));
  }

  private renderLobby(): void {
    label(this, 240, 76, this.code ?? '', 20, '#f7f2e7');
    new PixelButton(this, 240, 100, t('online.copy'), () => this.copyCode(), {
      textureBase: 'btn-comprar', w: 90, h: 16, size: 7,
    });

    let y = 128;
    for (const p of this.players) {
      const mark = p.ready ? t('online.playerReady') : t('online.playerWaiting');
      const offline = p.connected ? '' : ` (${t('online.status.closed')})`;
      label(this, 240, y, `${p.name} — ${mark}${offline}`, 9, p.ready ? '#3ec06a' : '#c0b8a8');
      y += 16;
    }
    if (this.players.length < 2) {
      label(this, 240, y + 4, t('online.waiting'), 8, '#c0b8a8');
    }

    // READY stays a real toggle: every click still sends exactly one `ready` message. The
    // short cooldown only blocks a second click before the first one's frame goes out.
    const readyBtn = new PixelButton(this, 240, 215, this.ready ? t('online.readyOn') : t('online.ready'), () => {
      this.fireOnce('ready', 300, () => {
        this.ready = !this.ready;
        this.client.setReady(this.ready);
      });
    }, { textureBase: 'btn-feito', w: 100, h: 20, size: 8 });
    readyBtn.setEnabled(!this.inFlight.has('ready'));

    if (this.seat === 0) {
      const enoughPlayers = this.players.length >= 2;
      const allReady = enoughPlayers && this.players.every((p) => p.ready);
      const start = new PixelButton(this, 350, 215, t('online.start'), () => this.fireOnce('start', 3000, () => this.client.startGame()), {
        textureBase: 'btn-feito', w: 82, h: 20, size: 7,
      });
      start.setEnabled(allReady && !this.inFlight.has('start'));
      // A greyed-out button with no stated reason is the single most common lobby complaint —
      // always say which condition is missing.
      if (!allReady) {
        label(this, 350, 233, t(enoughPlayers ? 'online.startNeedReady' : 'online.startNeedPlayers'), 6, '#c0b8a8');
      }
    }
  }
}
