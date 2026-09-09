import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { NetClient, type ConnStatus } from '../net/client';
import type { GameView, RoomPlayerSummary } from '../net/protocol';
import { fontStyle, label, PixelButton } from '../ui/widgets';
import { debugApi } from '../verification/debug-api';

/**
 * Online lobby: idle (create/join) -> lobby (code + ready) -> GameScene (server drives the
 * auto-start on `game_started`). VOLTAR works in every state and always leaves the room and
 * closes the socket. See docs/PHASE5_CLIENT_PLAN.md section A.
 */
export class OnlineScene extends Phaser.Scene {
  private client!: NetClient;
  private phase: 'idle' | 'lobby' | 'error' = 'idle';
  private code: string | null = null;
  private seat: number | null = null;
  private players: RoomPlayerSummary[] = [];
  private ready = false;
  private errorMsg: string | null = null;
  private status: ConnStatus = 'closed';
  private unsubs: (() => void)[] = [];

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
      this.client.onStatus((s) => {
        this.status = s;
        this.rebuild();
      }),
      this.client.on('room_joined', (msg) => {
        this.code = msg.code;
        this.seat = msg.seat;
        this.players = msg.players;
        this.phase = 'lobby';
        this.rebuild();
      }),
      this.client.on('room_state', (msg) => {
        this.players = msg.players;
        this.rebuild();
      }),
      this.client.on('game_started', (msg) => this.enterMatch(msg.view)),
      // Resuming after a reload: the server answers `reconnect` with `room_joined` (which set
      // code/seat just above) followed by `state_sync` for a match already in progress. Without
      // this the client re-established its seat but sat in the lobby forever.
      this.client.on('state_sync', (msg) => this.enterMatch(msg.view)),
      this.client.on('error', (msg) => {
        this.errorMsg = msg.code === 'room_closed' ? t('online.roomClosed') : msg.message || msg.code;
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
      comprar: () => { /* no in-match action while still in the lobby */ },
      submitRaw: () => { /* not applicable in the lobby */ },
      forceDrop: () => this.client.forceDrop(),
    };
  }

  private backToMenu(): void {
    this.client.leaveRoom();
    debugApi.online = null;
    this.scene.start('menu');
  }

  private promptJoin(): void {
    const raw = window.prompt(t('online.enterCodePrompt')) ?? '';
    const code = raw.replace(/\s+/g, '').toUpperCase();
    if (code) this.client.joinRoom(code, t('menu.you'));
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
    } else if (this.phase === 'lobby' && this.code !== null) {
      this.renderLobby();
    } else {
      new PixelButton(this, 240, 110, t('online.create'), () => this.client.createRoom(t('menu.you')), {
        textureBase: 'btn-feito', w: 140, h: 24, size: 9,
      });
      new PixelButton(this, 240, 145, t('online.join'), () => this.promptJoin(), {
        textureBase: 'btn-comprar', w: 140, h: 22, size: 8,
      });
    }

    new PixelButton(this, 240, 245, t('online.back'), () => this.backToMenu(), {
      textureBase: 'btn-comprar', w: 110, h: 18, size: 7,
    });
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

    new PixelButton(this, 240, 215, this.ready ? t('online.readyOn') : t('online.ready'), () => {
      this.ready = !this.ready;
      this.client.setReady(this.ready);
    }, { textureBase: 'btn-feito', w: 100, h: 20, size: 8 });
  }
}
