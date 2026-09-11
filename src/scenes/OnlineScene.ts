import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { bus } from '../core/events';
import { onAppVisible } from '../core/lifecycle';
import { isOffline, onConnectivityChange } from '../core/pwa';
import { t } from '../localization/i18n';
import { NetClient, type ConnStatus } from '../net/client';
import { errorMessage } from '../net/errors';
import type { GameView, RoomPlayerSummary } from '../net/protocol';
import { coverBackground, cx, cy, panelW, vy } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { fontStyle, gotoScene, label, PixelButton } from '../ui/widgets';
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
   * cooldown) resolves the first. Released by fireOnce's cooldown timer or by the 'error'
   * handler's clear() — never by a success answer (e.g. room_joined): the answer can land between
   * a double-click's two clicks, and clearing the guard right then would let the second click
   * through to fire a duplicate request. */
  private inFlight = new Set<string>();
  /** True while the current 'error' phase was entered because the device is offline (not a real
   * server rejection) — lets a regained connection drop back to 'idle' instead of staying stuck
   * on a stale error. */
  private offlineError = false;
  /** Offscreen DOM input that opens the soft keyboard on touch devices — see ensureJoinInput().
   * The keyboard-only handler below (wireCodeEntry) stays as the desktop path. */
  private joinInputEl: HTMLInputElement | null = null;

  constructor() {
    super('online');
  }

  create(): void {
    setMusicContext('menu');
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
    // A restart would tear down `this.client`'s live socket — re-lay-out in place instead, same
    // as every server push already does via rebuild().
    this.unsubs.push(bus.on('viewport:changed', () => this.rebuild()));
    // Connectivity regained just re-renders (buttons re-enable) — never auto-connects behind
    // the player's back. If the offline error put them here, drop back to 'idle' so they can retry.
    this.unsubs.push(
      // Mobile browsers suspend sockets and timers while backgrounded, so a lobby left on a phone
      // comes back with a socket that is closed (or looks open but is dead) and a stale status
      // line. Reuse the existing connect() path — which drives the same status copy a first
      // connection does — rather than inventing a separate resume state. Never auto-connects when
      // the player is offline or deliberately sitting on the offline error screen.
      onAppVisible(() => {
        if (isOffline() || this.offlineError) return;
        const s = this.client.getStatus();
        if (s === 'open') this.client.requestResync();
        else if (s !== 'connecting' && s !== 'reconnecting') this.client.connect();
      }),
      onConnectivityChange((offline) => {
        if (!offline && this.offlineError) {
          this.offlineError = false;
          this.phase = 'idle';
          // We entered this scene offline and skipped connect() entirely (see below), so
          // this.client's socket was never opened — establish it now, first time, not a
          // reconnect behind the player's back. They still have to press CRIAR SALA / ENTRAR.
          this.client.connect();
        }
        this.rebuild();
      }),
    );
    if (isOffline()) {
      // Skip the connect attempt entirely — a clear "you're offline" beats a connection timeout.
      this.offlineError = true;
      this.phase = 'error';
      this.errorMsg = t('offline.online');
    } else {
      this.client.connect();
    }
    this.rebuild();
    debugApi.ready = true;

    this.events.once('shutdown', () => {
      this.unsubs.forEach((u) => u());
      this.unsubs = [];
      this.destroyJoinInput();
    });
  }

  /** Mobile JOIN fix: OnlineScene's keyboard handler never opens a soft keyboard, so a touch
   * player had no way to type a room code. A visually hidden real `<input>` does — focusing it
   * is what makes the OS show the keyboard — and its sanitized value mirrors into `codeInput`,
   * same as every keystroke the desktop path already produces. Idempotent: safe to call on
   * every rebuild(). */
  private ensureJoinInput(): void {
    if (this.joinInputEl) return;
    const el = document.createElement('input');
    el.type = 'text';
    el.inputMode = 'text';
    el.autocapitalize = 'characters';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.maxLength = CODE_LENGTH;
    el.value = this.codeInput;
    // 1px, off-canvas but still focusable/tappable — a display:none input never opens a
    // soft keyboard on iOS/Android.
    el.style.cssText = 'position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;border:0;padding:0;';
    el.addEventListener('input', () => {
      const sanitized = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
      if (el.value !== sanitized) el.value = sanitized;
      this.codeInput = sanitized;
      this.rebuild();
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') this.fireOnce('join', 3000, () => this.submitJoin());
    });
    document.body.appendChild(el);
    this.joinInputEl = el;
    el.focus();
  }

  private destroyJoinInput(): void {
    this.joinInputEl?.remove();
    this.joinInputEl = null;
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
        // Do NOT clear 'create'/'join' here: this handler can fire between a double-click's two
        // clicks (fast on localhost, or whenever frames are slow — e.g. under Playwright
        // tracing), and clearing the guard right then reopens the window for the second click to
        // fire a duplicate create_room/join_room. Neither button exists once phase is 'lobby', so
        // the early clear bought nothing anyway — the 3s cooldown in fireOnce (or the 'error'
        // handler's clear() below, for a rejection) is what releases the guard.
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
      statusTrace: () => this.client.statusTrace,
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
    gotoScene(this, 'menu');
  }

  /** Keyboard-driven code entry: only characters the room alphabet can produce are accepted, so
   * the buffer is always a candidate code and never needs sanitizing on submit. */
  private wireCodeEntry(): void {
    const onKey = (ev: KeyboardEvent): void => {
      if (this.phase !== 'join') return;
      // The DOM join input (see ensureJoinInput) owns its own value edits and Enter handling
      // while focused — this global path is desktop-only and would otherwise double-process
      // every keystroke a touch player types into it.
      if (this.joinInputEl && document.activeElement === this.joinInputEl) return;
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

  /** Single place deciding whether a lobby action button is enabled: not already in flight, and
   * not offline (offline never even reaches the server, so there's nothing to be "in flight"). */
  private canAct(key: string): boolean {
    return !this.inFlight.has(key) && !isOffline();
  }

  /** Transient reason line shown when a disabled CRIAR SALA/ENTRAR is tapped while offline. */
  private flashOfflineReason(): void {
    if (!isOffline()) return;
    const el = label(this, cx(), view().portrait ? vy(270) : vy(260), t('offline.online'), 7, '#ff6b5e');
    this.time.delayedCall(2000, () => el.destroy());
  }

  private submitJoin(): void {
    if (this.codeInput.length === 0) return;
    this.client.joinRoom(this.codeInput, t('menu.you'));
  }

  /** Transient "code copied" confirmation, tracked so a second press replaces it instead of stacking. */
  private copiedLabel: Phaser.GameObjects.Text | null = null;

  private copyCode(): void {
    if (!this.code) return;
    navigator.clipboard?.writeText(this.code).then(() => {
      // Mashing COPY would otherwise stack a new label on top of the last one every press.
      if (this.copiedLabel?.active) this.copiedLabel.destroy();
      const el = label(this, cx(), vy(112), t('online.copied'), 7, '#3ec06a');
      this.copiedLabel = el;
      this.time.delayedCall(1500, () => {
        if (el.active) el.destroy(); // rebuild() may have already torn it down
      });
    }).catch(() => {
      // clipboard denied/unavailable — the code is already shown on screen, nothing else to do
    });
  }

  private rebuild(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    if (this.phase === 'join' && view().touch) this.ensureJoinInput();
    else this.destroyJoinInput();
    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.45);
    // backdrop panel so lobby text reads against the busy boteco scene, same treatment MenuScene
    // uses for its controls (L1) — legible by construction, not by luck of what's behind it.
    this.add.rectangle(cx(), vy(138), panelW(280), vy(236), 0x1a0f0a, 0.62).setStrokeStyle(1, 0xc0a878, 0.6);
    label(this, cx(), vy(26), t('online.title'), 15, '#f7d23e');

    const statusColor =
      this.status === 'open' ? '#3ec06a' : this.status === 'connecting' || this.status === 'reconnecting' ? '#f7d23e' : '#d83a3a';
    label(this, cx(), vy(44), t(`online.status.${this.status}`), 8, statusColor);

    if (this.phase === 'error') {
      this.add
        .text(cx(), vy(120), this.errorMsg ?? '', { ...fontStyle(9, '#ff6b5e'), align: 'center', wordWrap: { width: panelW(320) } })
        .setOrigin(0.5);
      // Only VOLTAR used to be offered here — a near dead end for a rejoinable failure (e.g. a
      // dropped connection). Retrying re-runs the same connect() path a fresh visit to this
      // scene would use; offline stays a flash, same reason as CRIAR SALA/ENTRAR above.
      new PixelButton(this, cx(), vy(155), t('online.retry'), () => {
        if (isOffline()) { this.flashOfflineReason(); return; }
        this.errorMsg = null;
        this.offlineError = false;
        this.phase = 'idle';
        this.client.connect();
        this.rebuild();
      }, { textureBase: 'btn-comprar', w: 140, h: 20, size: 8 });
    } else if (this.phase === 'join') {
      this.renderJoin();
    } else if (this.phase === 'lobby' && this.code !== null) {
      this.renderLobby();
    } else {
      const createBtn = new PixelButton(
        this, cx(), vy(110), t('online.create'),
        () => this.fireOnce('create', 3000, () => this.client.createRoom(t('menu.you'))),
        { textureBase: 'btn-feito', w: 140, h: 24, size: 9, onBlocked: () => this.flashOfflineReason() },
      );
      createBtn.setEnabled(this.canAct('create'));
      new PixelButton(this, cx(), vy(145), t('online.join'), () => {
        this.phase = 'join';
        this.codeInput = '';
        this.rebuild();
      }, { textureBase: 'btn-comprar', w: 140, h: 22, size: 8 });
    }

    // Portrait stacks START (and its reason line) under READY, so VOLTAR moves down to clear them.
    new PixelButton(this, cx(), view().portrait ? vy(256) : vy(245), t('online.back'), () => {
      // No cooldown/rebuild needed: backToMenu() leaves this scene immediately, so the guard
      // only needs to stop a second click before that happens.
      if (this.inFlight.has('leave')) return;
      this.inFlight.add('leave');
      this.backToMenu();
    }, { textureBase: 'btn-comprar', w: 110, h: view().portrait ? 24 : 18, size: 7 });
  }

  private renderJoin(): void {
    label(this, cx(), vy(86), t('online.enterCodePrompt'), 9, '#f7f2e7');
    const shown = this.codeInput.padEnd(CODE_LENGTH, '_');
    // tappable so a touch player who blurred the soft keyboard can bring it back
    label(this, cx(), vy(118), shown, 20, this.codeInput ? '#f7d23e' : '#8a7f6e')
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.joinInputEl?.focus());
    // A phone has no ENTER key on screen — point at the tappable code/JOIN path instead.
    label(this, cx(), vy(148), t(view().touch ? 'online.codeHintTouch' : 'online.codeHint'), 7, '#c0b8a8');
    const confirm = new PixelButton(this, cx(), vy(180), t('online.join'), () => this.fireOnce('join', 3000, () => this.submitJoin()), {
      textureBase: 'btn-feito', w: 120, h: 22, size: 8, onBlocked: () => this.flashOfflineReason(),
    });
    confirm.setEnabled(this.codeInput.length > 0 && this.canAct('join'));
  }

  private renderLobby(): void {
    label(this, cx(), vy(76), this.code ?? '', 20, '#f7f2e7');
    // room-code text and the copy button must stay comfortably tappable in portrait
    const copyH = view().portrait ? 24 : 16;
    new PixelButton(this, cx(), vy(100), t('online.copy'), () => this.copyCode(), {
      textureBase: 'btn-comprar', w: 90, h: copyH, size: 7,
    });

    let y = vy(128);
    for (const p of this.players) {
      const mark = p.ready ? t('online.playerReady') : t('online.playerWaiting');
      const offline = p.connected ? '' : ` (${t('online.status.closed')})`;
      label(this, cx(), y, `${p.name} — ${mark}${offline}`, 9, p.ready ? '#3ec06a' : '#c0b8a8');
      y += vy(16);
    }
    if (this.players.length < 2) {
      label(this, cx(), y + vy(4), t('online.waiting'), 8, '#c0b8a8');
    }

    // READY stays a real toggle: every click still sends exactly one `ready` message. The
    // short cooldown only blocks a second click before the first one's frame goes out.
    const stacked = view().portrait;
    const readyBtn = new PixelButton(this, cx(), stacked ? vy(202) : vy(215), this.ready ? t('online.readyOn') : t('online.ready'), () => {
      this.fireOnce('ready', 300, () => {
        this.ready = !this.ready;
        this.client.setReady(this.ready);
      });
    }, { textureBase: 'btn-feito', w: 100, h: 20, size: 8 });
    readyBtn.setEnabled(!this.inFlight.has('ready'));

    if (this.seat === 0) {
      const enoughPlayers = this.players.length >= 2;
      const allReady = enoughPlayers && this.players.every((p) => p.ready);
      // Landscape seats START beside READY; a 270-wide portrait world has no room beside anything,
      // so it stacks underneath instead of running off the right edge.
      const startX = stacked ? cx() : cx() + (350 - 240);
      const start = new PixelButton(this, startX, stacked ? vy(230) : vy(215), t('online.start'), () => this.fireOnce('start', 3000, () => this.client.startGame()), {
        textureBase: 'btn-feito', w: stacked ? 110 : 82, h: stacked ? 24 : 20, size: 7,
      });
      start.setEnabled(allReady && !this.inFlight.has('start'));
      // A greyed-out button with no stated reason is the single most common lobby complaint —
      // always say which condition is missing.
      if (!allReady) {
        label(this, startX, stacked ? vy(244) : vy(233), t(enoughPlayers ? 'online.startNeedReady' : 'online.startNeedPlayers'), 6, '#c0b8a8');
      }
    }
  }
}
