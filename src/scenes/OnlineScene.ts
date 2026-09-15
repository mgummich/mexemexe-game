import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { bus } from '../core/events';
import { onAppVisible } from '../core/lifecycle';
import { isOffline, onConnectivityChange } from '../core/pwa';
import { t } from '../localization/i18n';
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, NetClient, readDisplayName, writeDisplayName, type ConnStatus } from '../net/client';
import { errorMessage } from '../net/errors';
import {
  CUSTOM_BOUNDS, DEFAULT_ROOM_SETTINGS, REACTION_COOLDOWN_MS, REACTIONS, TIMER_PRESETS,
  type GameView, type ReactionId, type RoomPlayerSummary, type RoomSettings, type TimerMode,
} from '../net/protocol';
import { coverBackground, cx, cy, panelW, vy } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { fontStyle, gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi } from '../verification/debug-api';

/** Room codes are always this long — see server/rooms.ts CODE_LENGTH. */
const CODE_LENGTH = 5;

/** Lobby preset cycle — one tap moves between the three answers a room of friends actually
 * chooses between. `custom` is deliberately not in the cycle: it lives behind the CUSTOM screen,
 * so nobody lands on a six-field configuration by tapping past Fast. */
const PRESET_CYCLE = ['casual', 'fast', 'off'] as const;

/**
 * The custom screen's rows, in display order: the setting, how far one tap moves it, and the
 * unit it is shown in. Bounds come from `CUSTOM_BOUNDS` rather than a second copy here, so the
 * buttons stop exactly where the server's clamp would have stopped them anyway.
 */
const CUSTOM_ROWS = [
  { key: 'turnMs', stepMs: 15_000, unit: 'seconds' },
  { key: 'mexeBonusMs', stepMs: 5_000, unit: 'seconds' },
  { key: 'warnMs', stepMs: 5_000, unit: 'seconds' },
  { key: 'reconnectGraceMs', stepMs: 10_000, unit: 'seconds' },
  { key: 'missedTurnLimit', stepMs: 1, unit: 'turns' },
] as const satisfies readonly { key: keyof typeof CUSTOM_BOUNDS; stepMs: number; unit: 'seconds' | 'turns' }[];

/** Seats never move, so seat N always gets badge colour N — the badge is a *secondary* cue on a
 * row that already spells out the name and the status word, never the only one. */
const SEAT_COLORS = [0xc8543a, 0x3a7fc8, 0x3ea05a, 0xc8a33a];

/** Highest seat index the server will ever hand out — server/rooms.ts MAX_PLAYERS. */
const MAX_SEATS = 4;

function nextTimerPreset(current: TimerMode): (typeof PRESET_CYCLE)[number] {
  const i = PRESET_CYCLE.indexOf(current as (typeof PRESET_CYCLE)[number]);
  return PRESET_CYCLE[(i + 1) % PRESET_CYCLE.length]!;
}

/** Only characters the room alphabet can produce, so the buffer is always a candidate code. */
function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

/** A display name is shown to strangers, so it stays letters/digits/spaces — no markup, no
 * lookalike control characters, nothing that could impersonate the game's own UI text. */
function sanitizeName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}

/**
 * Online lobby: idle (create/join) -> lobby (code + ready) -> GameScene (server drives the
 * auto-start on `game_started`). VOLTAR works in every state and always leaves the room and
 * closes the socket.
 */
export class OnlineScene extends Phaser.Scene {
  private client!: NetClient;
  private phase: 'idle' | 'join' | 'name' | 'lobby' | 'custom' | 'error' = 'idle';
  /** The custom screen's working copy. Edited freely while that screen is open and sent as one
   * proposal on APLICAR — a field-by-field send would clear everyone's ready bit five times for
   * one decision. Null whenever the screen is closed. */
  private customDraft: RoomSettings | null = null;
  /** In-canvas join-code buffer. Replaces the Phase 5 `window.prompt`, which could not be
   * styled, localized, or driven by the verification suite. */
  private codeInput = '';
  private code: string | null = null;
  private seat: number | null = null;
  private players: RoomPlayerSummary[] = [];
  /** The room's settings as the server last reported them. Never edited locally: tapping the
   * summary sends a proposal and the next `room_state` is what actually changes this. */
  private roomSettings: RoomSettings = DEFAULT_ROOM_SETTINGS;
  private hostSeat = 0;
  private settingsLocked = false;
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
  /** Which buffer the hidden DOM input is currently mirroring, so switching screens rebuilds it
   * with the right length/sanitizer instead of typing a name into the code buffer. */
  private inputFor: 'code' | 'name' = 'code';
  /** Name-entry buffer, mirrored the same way `codeInput` is. */
  private nameInput = '';
  /** Set when this scene was entered from a finished match (ONLINE-23): same room, same code,
   * everyone back to not-ready. Cleared as soon as the player readies up. */
  private rematch = false;
  /** Room code taken from a share link (`?room=`), joined automatically once the socket opens. */
  private autoJoinCode: string | null = null;
  /** ON-05: set when the last name submission had too few visible characters to be a name. */
  private nameError = false;
  /** ON-09: shown until the player readies again after the host changed the room's fairness
   * settings and the server cleared everyone's ready bit. */
  private settingsChangedNotice = false;
  /** Last reaction the room sent, shown briefly in the lobby. */
  private lastReaction: { seat: number; reaction: ReactionId } | null = null;
  private resume: { client: NetClient; code: string; seat: number } | null = null;

  constructor() {
    super('online');
  }

  /**
   * Re-entry from a finished online match (ONLINE-23/24): the server keeps the room alive and
   * hands it back as a lobby, so this scene adopts the live client/seat instead of opening a new
   * socket and making the group re-create and re-share a room. Without all three fields it is an
   * ordinary fresh visit.
   */
  init(data?: { client?: NetClient; code?: string; seat?: number }): void {
    this.resume =
      data?.client && typeof data.code === 'string' && typeof data.seat === 'number'
        ? { client: data.client, code: data.code, seat: data.seat }
        : null;
  }

  /** Name this device plays under. Falls back to the generic "you" until the player sets one. */
  private playerName(): string {
    return readDisplayName() ?? t('menu.you');
  }

  create(): void {
    setMusicContext('menu');
    debugApi.scene = 'online';
    this.client = this.resume?.client ?? new NetClient();
    this.phase = 'idle';
    this.code = null;
    this.seat = null;
    this.players = [];
    this.ready = false;
    this.errorMsg = null;
    this.codeInput = '';
    this.nameInput = '';
    this.lastReaction = null;
    this.rematch = false;
    this.settingsChangedNotice = false;
    this.nameError = false;
    this.inFlight.clear();
    // Field initializer, not reset here, is exactly the class of bug this run's worst defect
    // (D1) came from — a restart must never inherit a scene's previous life's state.
    this.offlineError = false;
    // ONLINE-03: a shared link carries the room code, so the invited player lands in the lobby
    // instead of transcribing five characters. Still a normal join — the server validates the
    // code exactly as it does a typed one.
    const linked = new URLSearchParams(location.search).get('room');
    this.autoJoinCode = linked ? linked.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH) || null : null;
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
        else if (s === 'reconnecting') this.client.retryNow();
        else if (s !== 'connecting') this.client.connect();
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
    if (this.resume) {
      // The room is already ours; the server's answer to `resync` is what repopulates the seats.
      this.code = this.resume.code;
      this.seat = this.resume.seat;
      this.phase = 'lobby';
      this.rematch = true;
      if (this.client.getStatus() === 'open') this.client.requestResync();
      else this.client.connect();
    } else if (isOffline()) {
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

  /** Mobile text-entry fix: OnlineScene's keyboard handler never opens a soft keyboard, so a
   * touch player had no way to type a room code (or a name). A visually hidden real `<input>`
   * does — focusing it is what makes the OS show the keyboard — and its sanitized value mirrors
   * into the matching buffer, same as every keystroke the desktop path already produces.
   * Idempotent per mode: safe to call on every rebuild(). */
  private ensureTextInput(mode: 'code' | 'name'): void {
    if (this.joinInputEl && this.inputFor === mode) return;
    this.destroyJoinInput();
    const isCode = mode === 'code';
    const el = document.createElement('input');
    el.type = 'text';
    el.inputMode = 'text';
    el.autocapitalize = isCode ? 'characters' : 'words';
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.maxLength = isCode ? CODE_LENGTH : MAX_NAME_LENGTH;
    el.value = isCode ? this.codeInput : this.nameInput;
    // 1px, off-canvas but still focusable/tappable — a display:none input never opens a
    // soft keyboard on iOS/Android.
    el.style.cssText = 'position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;border:0;padding:0;';
    el.addEventListener('input', () => {
      const sanitized = isCode ? sanitizeCode(el.value) : sanitizeName(el.value);
      if (el.value !== sanitized) el.value = sanitized;
      if (isCode) this.codeInput = sanitized;
      else this.nameInput = sanitized;
      this.rebuild();
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      if (isCode) this.fireOnce('join', 3000, () => this.submitJoin());
      else this.commitName();
    });
    document.body.appendChild(el);
    this.joinInputEl = el;
    this.inputFor = mode;
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
        // The shared link's code is only useful once there is a socket to send it on.
        if (s === 'open' && this.autoJoinCode !== null && this.phase === 'idle' && this.code === null) {
          const code = this.autoJoinCode;
          this.autoJoinCode = null;
          this.fireOnce('join', 3000, () => this.client.joinRoom(code, this.playerName()));
        }
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
        this.roomSettings = msg.settings;
        this.hostSeat = msg.hostSeat;
        this.phase = 'lobby';
        this.rebuild();
      }),
      this.client.on('room_state', (msg) => {
        this.inFlight.delete('ready');
        // The room re-opened as a lobby: seats are back to not-ready, so our own flag must be too,
        // or READY would render as already pressed and its next tap would send `false`.
        if (msg.locked === false && this.settingsLocked) this.ready = false;
        // ON-09: the host changed the room's terms, so the server cleared every ready bit. The
        // server's word is the only source of it — mirror it locally and say why, otherwise READY
        // renders as still pressed and the player never learns the terms moved.
        else if (this.ready && msg.players.some((p) => p.seat === this.seat && !p.ready)) {
          this.ready = false;
          this.settingsChangedNotice = true;
        }
        this.players = msg.players;
        this.roomSettings = msg.settings;
        this.hostSeat = msg.hostSeat;
        this.settingsLocked = msg.locked;
        this.rebuild();
      }),
      this.client.on('player_reaction', (msg) => {
        this.lastReaction = { seat: msg.seat, reaction: msg.reaction };
        this.rebuild();
        // Same lifetime as the server cooldown, so the line never outlives the next one.
        this.time.delayedCall(REACTION_COOLDOWN_MS, () => {
          if (this.lastReaction?.seat === msg.seat) {
            this.lastReaction = null;
            this.rebuild();
          }
        });
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
      createRoom: (name) => this.client.createRoom(name ?? this.playerName()),
      joinRoom: (code, name) => this.client.joinRoom(code, name ?? this.playerName()),
      displayName: () => this.playerName(),
      react: (reaction) => this.client.sendReaction(reaction),
      setReady: (ready) => {
        this.ready = ready;
        this.client.setReady(ready);
      },
      startGame: () => this.client.startGame(),
      setRoomSettings: (s) => this.client.setRoomSettings(s),
      roomSettings: () => this.roomSettings,
      openCustomSettings: () => this.openCustomSettings(),
      turnMsLeft: () => null,
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

  /** Keyboard-driven text entry for the code and name screens. Every keystroke goes through the
   * same sanitizer the DOM input uses, so a buffer is always a submittable value. */
  private wireCodeEntry(): void {
    const onKey = (ev: KeyboardEvent): void => {
      const naming = this.phase === 'name';
      if (this.phase !== 'join' && !naming) return;
      // The DOM input (see ensureTextInput) owns its own value edits and Enter handling while
      // focused — this global path is desktop-only and would otherwise double-process every
      // keystroke a touch player types into it.
      if (this.joinInputEl && document.activeElement === this.joinInputEl) return;
      if (ev.key === 'Enter') {
        if (naming) this.commitName();
        else this.fireOnce('join', 3000, () => this.submitJoin());
        return;
      }
      if (ev.key === 'Escape') {
        this.phase = 'idle';
        this.codeInput = '';
        this.rebuild();
        return;
      }
      if (ev.key === 'Backspace') {
        if (naming) this.nameInput = this.nameInput.slice(0, -1);
        else this.codeInput = this.codeInput.slice(0, -1);
        this.rebuild();
        return;
      }
      if (ev.key.length !== 1) return;
      const next = naming ? sanitizeName(this.nameInput + ev.key) : sanitizeCode(this.codeInput + ev.key);
      if (naming) this.nameInput = next;
      else this.codeInput = next;
      this.rebuild();
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
    // vy(270) is the bottom edge itself in portrait — the reason was drawn off-screen there.
    const el = label(this, cx(), view().portrait ? vy(248) : vy(260), t('offline.online'), 7, '#ff6b5e');
    this.time.delayedCall(2000, () => el.destroy());
  }

  private submitJoin(): void {
    if (this.codeInput.length === 0) return;
    this.client.joinRoom(this.codeInput, this.playerName());
  }

  /**
   * Store the typed name and go back to the entry screen. ON-05: a name that survives the
   * sanitizer with fewer than MIN_NAME_LENGTH visible characters (empty, spaces only, or a
   * string that was nothing but emoji/control characters) is refused on the spot and said so —
   * silently keeping the old name looks like the button did nothing.
   */
  private commitName(): void {
    const name = sanitizeName(this.nameInput).trim();
    if (name.length < MIN_NAME_LENGTH) {
      this.nameError = true;
      this.rebuild();
      return;
    }
    writeDisplayName(name);
    this.nameError = false;
    this.phase = 'idle';
    this.rebuild();
  }

  /** The invite link for this room — the current URL with the code attached, so a deployment
   * running on a custom host (or an e2e run carrying `?ws=`) shares a link that actually works. */
  private inviteUrl(): string {
    const url = new URL(location.href);
    url.searchParams.set('room', this.code ?? '');
    url.hash = '';
    return url.toString();
  }

  /** Transient confirmation shown after COPIAR/COMPARTILHAR, tracked so a second press replaces
   * it instead of stacking. */
  private copiedLabel: Phaser.GameObjects.Text | null = null;

  private flashCopied(key: string): void {
    if (this.copiedLabel?.active) this.copiedLabel.destroy();
    const el = label(this, cx(), vy(106), t(key), 7, '#3ec06a');
    this.copiedLabel = el;
    this.time.delayedCall(1500, () => {
      if (el.active) el.destroy(); // rebuild() may have already torn it down
    });
  }

  private copyCode(): void {
    if (!this.code) return;
    navigator.clipboard?.writeText(this.code).then(() => this.flashCopied('online.copied')).catch(() => {
      // clipboard denied/unavailable — the code is already shown on screen, nothing else to do
    });
  }

  /** ONLINE-02: hand the invite to whatever the device already uses to share things. Only offered
   * where the browser actually has a share sheet; everywhere else COPIAR is the whole path. */
  private shareCode(): void {
    if (!this.code || !navigator.share) return;
    navigator
      .share({ text: t('online.shareText', { code: this.code }), url: this.inviteUrl() })
      .then(() => this.flashCopied('online.shared'))
      .catch(() => {
        // the player dismissed the share sheet — not an error, nothing to say
      });
  }

  private rebuild(): void {
    this.tweens.killAll();
    this.children.removeAll(true);
    if (view().touch && (this.phase === 'join' || this.phase === 'name')) {
      this.ensureTextInput(this.phase === 'join' ? 'code' : 'name');
    } else this.destroyJoinInput();
    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.45);
    // backdrop panel so lobby text reads against the busy boteco scene, same treatment MenuScene
    // uses for its controls (L1) — legible by construction, not by luck of what's behind it.
    this.add.rectangle(cx(), vy(138), panelW(280), vy(236), 0x1a0f0a, 0.62).setStrokeStyle(1, 0xc0a878, 0.6);
    label(this, cx(), vy(26), t('online.title'), 15, '#f7d23e');

    // ONLINE-10: a working connection is the expected case and says nothing worth a line of the
    // player's attention. Only the states they can act on — connecting, reconnecting, dropped —
    // get promoted to a visible status.
    if (this.status !== 'open') {
      const statusColor = this.status === 'connecting' || this.status === 'reconnecting' ? '#f7d23e' : '#d83a3a';
      label(this, cx(), vy(44), t(`online.status.${this.status}`), 8, statusColor);
    }

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
    } else if (this.phase === 'name') {
      this.renderName();
    } else if (this.phase === 'custom' && this.code !== null) {
      this.renderCustom();
    } else if (this.phase === 'lobby' && this.code !== null) {
      this.renderLobby();
    } else {
      this.renderEntry();
    }

    // Portrait stacks START (and its reason line) under READY, so VOLTAR moves down to clear them.
    // On the custom screen the same button means "back to the lobby, change nothing" — leaving the
    // room from a settings screen would be a trap, and the draft is deliberately thrown away.
    const leavingRoom = this.phase !== 'custom';
    new PixelButton(this, cx(), view().portrait ? vy(260) : vy(245), t(leavingRoom ? 'online.back' : 'online.customCancel'), () => {
      if (!leavingRoom) {
        this.customDraft = null;
        this.phase = 'lobby';
        this.rebuild();
        return;
      }
      // No cooldown/rebuild needed: backToMenu() leaves this scene immediately, so the guard
      // only needs to stop a second click before that happens.
      if (this.inFlight.has('leave')) return;
      this.inFlight.add('leave');
      this.backToMenu();
    }, { textureBase: 'btn-comprar', w: leavingRoom ? 110 : 150, h: view().portrait ? 24 : 18, size: 7 });
  }

  /** ONLINE-22: the entry screen says who you will show up as before you commit to a room, and
   * lets you change it there — an identity you can see is worth more than one you have to guess. */
  private renderEntry(): void {
    const nameLine = label(this, cx(), vy(82), t('online.playingAs', { name: this.playerName() }), 8, '#f7f2e7');
    nameLine
      // A text line's own bounds are a thin strip; a coarse pointer needs a real target, so the
      // hit area is grown to the touch floor without moving the text.
      .setInteractive(
        new Phaser.Geom.Rectangle(-20, -16, nameLine.width + 40, Math.max(nameLine.height + 16, 34)),
        Phaser.Geom.Rectangle.Contains,
      )
      .on('pointerup', () => {
        this.phase = 'name';
        this.nameError = false;
        this.nameInput = readDisplayName() ?? '';
        this.rebuild();
      });
    label(this, cx(), vy(93), t('online.changeName'), 6, '#8a7f6e');

    const createBtn = new PixelButton(
      this, cx(), vy(110), t('online.create'),
      () => this.fireOnce('create', 3000, () => this.client.createRoom(this.playerName())),
      { textureBase: 'btn-feito', w: 140, h: 24, size: 9, primary: true, onBlocked: () => this.flashOfflineReason() },
    );
    createBtn.setEnabled(this.canAct('create'));
    new PixelButton(this, cx(), vy(145), t('online.join'), () => {
      this.phase = 'join';
      this.codeInput = '';
      this.rebuild();
    }, { textureBase: 'btn-comprar', w: 140, h: 22, size: 8 });
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

  /** Name entry, deliberately the same shape as the code screen so there is one thing to learn. */
  private renderName(): void {
    label(this, cx(), vy(86), t('online.namePrompt'), 9, '#f7f2e7');
    const shown = this.nameInput || '_';
    label(this, cx(), vy(118), shown, 16, this.nameInput ? '#f7d23e' : '#8a7f6e')
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.joinInputEl?.focus());
    label(this, cx(), vy(148), t(view().touch ? 'online.nameHintTouch' : 'online.nameHint'), 7, '#c0b8a8');
    if (this.nameError) label(this, cx(), vy(160), t('online.nameTooShort'), 7, '#ff6b5e');
    new PixelButton(this, cx(), vy(180), t('online.nameOk'), () => this.commitName(), {
      textureBase: 'btn-feito', w: 120, h: 22, size: 8,
    });
  }

  /**
   * One line with everything the seats agreed to play under. The host taps it to cycle the timer
   * preset; everyone else reads it. Nothing here applies a setting — the tap sends a proposal and
   * the server's `room_state` answer is what redraws this line, so host and guests can never show
   * different terms.
   */
  private renderRoomSummary(): void {
    const s = this.roomSettings;
    const text =
      s.turnMs <= 0
        ? t('online.summaryNoTimer', { grace: Math.round(s.reconnectGraceMs / 1000) })
        : t('online.roomSummary', {
            timer: t(`online.timer.${s.timerMode}`),
            turn: Math.round(s.turnMs / 1000),
            bonus: Math.round(s.mexeBonusMs / 1000),
            grace: Math.round(s.reconnectGraceMs / 1000),
          });
    const isHost = this.seat === this.hostSeat && !this.settingsLocked;
    const line = label(this, cx(), vy(112), text, 7, isHost ? '#f7d23e' : '#c0b8a8');
    if (!isHost) return;
    line.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      this.fireOnce('settings', 300, () => this.client.setRoomSettings({ ...TIMER_PRESETS[nextTimerPreset(this.roomSettings.timerMode)] }));
    });
    label(this, cx(), vy(121), t('online.timerTapHint'), 6, '#8a7f6e');
    // Progressive disclosure: the presets answer the question for almost every room, and the
    // five-field screen is one deliberate tap away for the room that wants its own numbers.
    this.openCustomLink(vy(view().portrait ? 122 : 121));
  }

  /** The host-only way into the custom screen. A separate target from the summary line above it,
   * so cycling presets and opening the editor can never be the same mis-tap. */
  private openCustomLink(y: number): void {
    const link = label(this, cx() + panelW(240) / 2 - 26, y, t('online.customize'), 6, '#f7d23e');
    link
      .setInteractive(
        new Phaser.Geom.Rectangle(-12, -12, link.width + 24, Math.max(link.height + 16, 30)),
        Phaser.Geom.Rectangle.Contains,
      )
      .on('pointerup', () => this.openCustomSettings());
  }

  /** Opens the custom screen on a copy of whatever the room is playing under now, so the host
   * edits the real current terms instead of starting from an unrelated default. */
  private openCustomSettings(): void {
    if (this.phase !== 'lobby' || this.code === null) return;
    if (this.seat !== this.hostSeat || this.settingsLocked) return;
    this.customDraft = { ...this.roomSettings, timerMode: 'custom' };
    this.phase = 'custom';
    this.rebuild();
  }

  /**
   * Custom timing, one row per setting: name, value, and a −/+ pair that steps within the exact
   * bounds the server enforces. Nothing here is applied while editing — APLICAR sends a single
   * proposal, and (like every settings change) the server's answer is what clears ready bits and
   * redraws the lobby.
   */
  private renderCustom(): void {
    const draft = this.customDraft ?? { ...this.roomSettings, timerMode: 'custom' as const };
    this.customDraft = draft;
    const portrait = view().portrait;
    label(this, cx(), vy(62), t('online.customTitle'), 10, '#f7f2e7');

    const rowW = Math.min(panelW(250), view().w - 30);
    const left = cx() - rowW / 2;
    const step = portrait ? 26 : 20;
    CUSTOM_ROWS.forEach((row, i) => {
      const y = vy(82 + i * step);
      const [lo, hi] = CUSTOM_BOUNDS[row.key];
      const value = draft[row.key];
      label(this, left + 2, y, t(`online.custom.${row.key}`), 7, '#c0b8a8').setOrigin(0, 0.5);
      const shown = row.unit === 'seconds'
        ? t('online.custom.seconds', { n: Math.round(value / 1000) })
        : t('online.custom.turns', { n: value });
      label(this, left + rowW - 62, y, shown, 8, '#f7f2e7').setOrigin(1, 0.5);
      // Each button states its own limit by going dead at it: a host cannot propose a value the
      // server would silently clamp, so what the screen shows is what the room will play under.
      const bump = (delta: number): void => {
        const next = Math.min(hi, Math.max(lo, value + delta));
        this.customDraft = { ...draft, [row.key]: next };
        this.rebuild();
      };
      const minus = new PixelButton(this, left + rowW - 40, y, '−', () => bump(-row.stepMs), {
        textureBase: 'btn-comprar', w: portrait ? 22 : 18, h: portrait ? 20 : 16, size: 9,
      });
      minus.setEnabled(value > lo);
      const plus = new PixelButton(this, left + rowW - 14, y, '+', () => bump(row.stepMs), {
        textureBase: 'btn-comprar', w: portrait ? 22 : 18, h: portrait ? 20 : 16, size: 9,
      });
      plus.setEnabled(value < hi);
    });

    const bottom = vy(82 + CUSTOM_ROWS.length * step + 6);
    // The one rule the bounds alone cannot express: a warning longer than the turn would render
    // every turn as "about to end". The server caps it; saying so beats being silently corrected.
    if (draft.warnMs > draft.turnMs) {
      this.add
        .text(cx(), bottom, t('online.customWarnCapped'), {
          ...fontStyle(6, '#f7d23e'), align: 'center', wordWrap: { width: rowW },
        })
        .setOrigin(0.5);
    }
    new PixelButton(this, cx(), bottom + (portrait ? 22 : 16), t('online.customApply'), () => {
      this.fireOnce('settings', 300, () => {
        this.client.setRoomSettings({ ...draft, timerMode: 'custom' });
        this.customDraft = null;
        this.phase = 'lobby';
        this.rebuild();
      });
    }, { textureBase: 'btn-feito', w: 130, h: portrait ? 24 : 20, size: 8, primary: true });
  }

  /** Display name for a seat, or the generic placeholder when the seat is still empty. */
  private seatName(seat: number): string {
    return this.players.find((p) => p.seat === seat)?.name ?? t('online.emptySeat');
  }

  /**
   * ONLINE-04/05/07: one row per seat at the table — a coloured badge with the seat's initial, the
   * name, the host marker, and the ready state spelled out in words. Colour is never the only
   * carrier: every row states READY/WAITING (and OFFLINE) as text.
   */
  private renderSeatRow(y: number, player: RoomPlayerSummary | null, seat: number): void {
    const rowW = Math.min(panelW(240), view().w - 30);
    const left = cx() - rowW / 2;
    const filled = player !== null;
    const badge = this.add.circle(left + 8, y, 7, filled ? SEAT_COLORS[seat % SEAT_COLORS.length]! : 0x3a2c20);
    badge.setStrokeStyle(1, 0xc0a878, filled ? 0.9 : 0.4);
    const name = filled ? player.name : t('online.emptySeat');
    label(this, badge.x, y, filled ? name.slice(0, 1).toUpperCase() : '+', 8, '#f7f2e7');

    const isMe = filled && player.seat === this.seat;
    // Badges are spelled out, never carried by colour alone: the yellow name used to be the only
    // thing saying which row is yours, which is invisible to a colour-blind player and to anyone
    // reading a small phone screen in sunlight.
    const badges = [
      ...(isMe ? [t('menu.you')] : []),
      ...(seat === this.hostSeat && filled ? [t('online.host')] : []),
    ];
    const nameText = badges.length ? `${name} · ${badges.join(' · ')}` : name;
    const nameEl = this.add
      .text(left + 20, y, nameText, fontStyle(8, filled ? (isMe ? '#f7d23e' : '#f7f2e7') : '#8a7f6e'))
      .setOrigin(0, 0.5);

    if (!filled) return;
    const statusText = !player.connected
      ? t('online.status.closed')
      : player.ready
        ? `✓ ${t('online.playerReady')}`
        : t('online.playerWaiting');
    const statusColor = !player.connected ? '#d83a3a' : player.ready ? '#3ec06a' : '#c0b8a8';
    const statusEl = this.add.text(left + rowW, y, statusText, fontStyle(7, statusColor)).setOrigin(1, 0.5);
    // Name plus badges plus status has to fit one row on a 390-wide phone too. The status word is
    // the one that must never be cut (it is the state of the seat), so the name side gives way —
    // trimmed character by character, never overlapped.
    const maxNameW = statusEl.x - statusEl.width - 4 - nameEl.x;
    if (nameEl.width > maxNameW) {
      let shown = nameText;
      while (shown.length > 1 && nameEl.width > maxNameW) {
        shown = shown.slice(0, -1);
        nameEl.setText(`${shown}…`);
      }
    }
  }

  /** ONLINE-21: four preset things to say, and nothing else — no free text to moderate. The
   * server owns the real cooldown; this only greys the row out so the tap feels answered. */
  private renderReactions(y: number): void {
    const w = view().portrait ? 56 : 50;
    const gap = 4;
    const total = REACTIONS.length * w + (REACTIONS.length - 1) * gap;
    REACTIONS.forEach((id, i) => {
      const btn = new PixelButton(
        this, cx() - total / 2 + w / 2 + i * (w + gap), y, t(`online.reaction.${id}`),
        () => this.fireOnce('react', REACTION_COOLDOWN_MS, () => this.client.sendReaction(id)),
        { textureBase: 'btn-comprar', w, h: view().portrait ? 18 : 14, size: 7 },
      );
      btn.setEnabled(!this.inFlight.has('react'));
    });
  }

  private renderLobby(): void {
    label(this, cx(), vy(74), this.code ?? '', 20, '#f7f2e7');
    // room-code text and its buttons must stay comfortably tappable in portrait
    const btnH = view().portrait ? 24 : 16;
    const canShare = typeof navigator.share === 'function';
    const offset = canShare ? 48 : 0;
    new PixelButton(this, cx() - offset, vy(94), t('online.copy'), () => this.copyCode(), {
      textureBase: 'btn-comprar', w: 88, h: btnH, size: 7,
    });
    if (canShare) {
      new PixelButton(this, cx() + offset, vy(94), t('online.share'), () => this.shareCode(), {
        textureBase: 'btn-comprar', w: 88, h: btnH, size: 7,
      });
    }

    this.renderRoomSummary();

    // Seat rows start below the summary line and its host hint, not at a fixed 128 — the two
    // lines above would otherwise sit on top of the first seat. One spare row is drawn while the
    // table is not full, so "someone else can still join" is visible rather than implied.
    const seatCount = Math.min(MAX_SEATS, this.players.length + (this.players.length < MAX_SEATS ? 1 : 0));
    for (let seat = 0; seat < seatCount; seat++) {
      this.renderSeatRow(vy(132 + seat * 13), this.players.find((p) => p.seat === seat) ?? null, seat);
    }

    if (this.settingsChangedNotice) {
      this.add
        .text(cx(), vy(180), t('online.settingsChanged'), {
          ...fontStyle(6, '#f7d23e'), align: 'center', wordWrap: { width: panelW(240) },
        })
        .setOrigin(0.5);
    } else if (this.rematch) {
      label(this, cx(), vy(180), t('online.rematch'), 6, '#f7d23e');
    } else if (this.lastReaction) {
      label(
        this, cx(), vy(180),
        t('online.reactionFrom', {
          name: this.seatName(this.lastReaction.seat),
          reaction: t(`online.reaction.${this.lastReaction.reaction}`),
        }),
        7, '#f7d23e',
      );
    }
    this.renderReactions(view().portrait ? vy(192) : vy(194));

    // READY stays a real toggle: every click still sends exactly one `ready` message. The
    // short cooldown only blocks a second click before the first one's frame goes out.
    const stacked = view().portrait;
    const readyBtn = new PixelButton(this, cx(), stacked ? vy(208) : vy(216), this.ready ? t('online.readyOn') : t('online.ready'), () => {
      this.fireOnce('ready', 300, () => {
        this.ready = !this.ready;
        this.rematch = false;
        this.settingsChangedNotice = false;
        this.client.setReady(this.ready);
      });
    }, { textureBase: 'btn-feito', w: 100, h: 20, size: 8, primary: true });
    readyBtn.setEnabled(!this.inFlight.has('ready'));

    if (this.seat === this.hostSeat) {
      const enoughPlayers = this.players.length >= 2;
      const notReady = this.players.filter((p) => !p.ready);
      const allReady = enoughPlayers && notReady.length === 0;
      // Landscape seats START beside READY; a 270-wide portrait world has no room beside anything,
      // so it stacks underneath instead of running off the right edge.
      const startX = stacked ? cx() : cx() + (350 - 240);
      const start = new PixelButton(this, startX, stacked ? vy(231) : vy(216), t('online.start'), () => this.fireOnce('start', 3000, () => this.client.startGame()), {
        textureBase: 'btn-feito', w: stacked ? 110 : 82, h: stacked ? 24 : 20, size: 7,
      });
      start.setEnabled(allReady && !this.inFlight.has('start'));
      // ONLINE-06: a greyed-out button with no stated reason is the single most common lobby
      // complaint, and "someone isn't ready" is barely better — name the seats being waited on.
      if (!allReady) {
        const reason = enoughPlayers
          ? t('online.startNeedReadyNames', { names: notReady.map((p) => p.name).join(', ') })
          : t('online.startNeedPlayers');
        this.add
          .text(startX, stacked ? vy(243) : vy(232), reason, {
            ...fontStyle(6, '#c0b8a8'), align: 'center', wordWrap: { width: panelW(200) },
          })
          .setOrigin(0.5);
      }
    }
  }
}
