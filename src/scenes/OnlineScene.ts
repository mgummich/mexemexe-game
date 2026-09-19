import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { bus } from '../core/events';
import { onAppVisible } from '../core/lifecycle';
import { settings } from '../core/settings';
import { isOffline, onConnectivityChange } from '../core/pwa';
import { plural, t } from '../localization/i18n';
import {
  forgetRoom, MAX_NAME_LENGTH, MIN_NAME_LENGTH, NetClient, readDisplayName, readRecentRooms,
  rememberRoom, writeDisplayName, type ConnStatus, type RecentRoom,
} from '../net/client';
import { LobbyMachine, type LobbyEffect, type LobbyPhase } from '../net/lobby';
import {
  CUSTOM_BOUNDS, MAX_SEATS, QUEUE_TARGETS, REACTION_COOLDOWN_MS, REACTIONS, ROOM_CODE_LENGTH, TIMER_PRESETS,
  type ActivityEvent, type GameView, type PartyState, type QueueTarget, type ReactionId,
  type RoomListing, type RoomPlayerSummary, type RoomSettings, type RoomVisibility, type TimerMode,
} from '../net/protocol';
import { coverBackground, cx, cy, panelW, vy, woodPanel } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { fontStyle, gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi, type LobbyBox, type RenderedSeatRow } from '../verification/debug-api';
import { lobbyDebugSurface } from '../verification/online-debug';
import { SURFACE, TEXT } from '../ui/tokens';

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

/** An empty chair's badge: seat identity with the identity taken out, so the row still reads as a
 * seat. Named beside SEAT_COLORS rather than folded into the chrome tokens, for the same reason
 * they are — this is seat identity, not panel furniture. */
const EMPTY_SEAT_BADGE = 0x3a2c20;

/** Room cards drawn on one browser screen. The server's answer is bounded much higher
 * (MAX_ROOM_LISTINGS); the rest becomes a "+N more" line rather than a scroll container, which
 * nothing on this screen needs yet. Portrait fits one fewer: its cards are taller (a phone needs
 * the touch height) and its ATUALIZAR sits higher, so a fourth row would land under the button. */
function browseRows(portrait: boolean): number {
  return portrait ? 3 : 4;
}

/**
 * How long MATCH FOUND stays on screen before the table does. Long enough to read three words and
 * understand what just happened, short enough that Quick Match still feels quick. The handoff is
 * already committed on the server while this runs — nothing is waiting on the player.
 */
const MATCH_FOUND_MS = 1200;

/** Player-count preference cycle, in the order one tap moves through it. `any` first because it
 * is the default and the only one that can be honoured at any queue size. */
const QUEUE_TARGET_CYCLE = QUEUE_TARGETS;

/** Recent-room codes offered as one-tap shortcuts under the entry screen's buttons. The stored
 * list is longer (MAX_RECENT_ROOMS); more than three on screen is clutter, not recall. */
const RECENT_SHOWN = 3;

/** Room code glyph size at 100% text. The lobby shrinks it (never below this) when the column is
 * tight — see renderLobby's squeeze. */
const CODE_SIZE = 20;

/** Floor for a lobby seat row: below this the name and its status word start to touch. */
const SEAT_ROW_MIN_H = 11;

function nextTimerPreset(current: TimerMode): (typeof PRESET_CYCLE)[number] {
  const i = PRESET_CYCLE.indexOf(current as (typeof PRESET_CYCLE)[number]);
  return PRESET_CYCLE[(i + 1) % PRESET_CYCLE.length]!;
}

/** Only characters the room alphabet can produce, so the buffer is always a candidate code. */
function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
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
  /**
   * Where the lobby actually lives (`src/net/lobby.ts`): the phase, the room mirror, the queue,
   * discovery and every transition between them, with no Phaser in reach of any of it (ARCH-003).
   *
   * Rebuilt on every `create()`, so a second visit cannot inherit the first one's room, error or
   * search — the class of bug a per-field reset list keeps producing (ARCH-018). This scene reads
   * it through the accessors below and writes to it only by calling a named transition.
   */
  private lobby = new LobbyMachine();
  /** What the lobby painted, block by block, on the last rebuild — the evidence the responsive
   * gate asserts against (see `LobbyBox`). Rebuilt with the screen, never read by product code. */
  private lobbyBoxes: LobbyBox[] = [];
  private get phase(): LobbyPhase { return this.lobby.phase; }
  private get code(): string | null { return this.lobby.code; }
  private get seat(): number | null { return this.lobby.seat; }
  private get players(): RoomPlayerSummary[] { return this.lobby.players; }
  private get roomSettings(): RoomSettings { return this.lobby.roomSettings; }
  private get hostSeat(): number { return this.lobby.hostSeat; }
  private get party(): PartyState { return this.lobby.party; }
  private get visibility(): RoomVisibility { return this.lobby.visibility; }
  private get settingsLocked(): boolean { return this.lobby.settingsLocked; }
  private get errorMsg(): string | null { return this.lobby.errorMsg; }
  private get offlineError(): boolean { return this.lobby.offlineError; }
  private get rematch(): boolean { return this.lobby.rematch; }
  private get settingsChangedNotice(): boolean { return this.lobby.settingsChangedNotice; }
  private get lobbyNotice(): string | null { return this.lobby.lobbyNotice; }
  private get lastReaction(): { seat: number; reaction: ReactionId } | null { return this.lobby.lastReaction; }
  private get listings(): RoomListing[] { return this.lobby.listings; }
  private get browseState(): 'loading' | 'ready' | 'failed' { return this.lobby.browseState; }
  private get browseNotice(): string | null { return this.lobby.browseNotice; }
  private get queueTarget(): QueueTarget { return this.lobby.queueTarget; }
  private get queueNotice(): string | null { return this.lobby.queueNotice; }
  private get matchPlayers(): number { return this.lobby.matchPlayers; }
  private get nameError(): boolean { return this.lobby.nameError; }
  private get inFlight(): Set<string> { return this.lobby.inFlight; }
  private get ready(): boolean { return this.lobby.ready; }
  /** The custom screen's working copy. Edited freely while that screen is open and sent as one
   * proposal on APLICAR — a field-by-field send would clear everyone's ready bit five times for
   * one decision. Null whenever the screen is closed. */
  private customDraft: RoomSettings | null = null;
  /** In-canvas join-code buffer. Replaces the Phase 5 `window.prompt`, which could not be
   * styled, localized, or driven by the verification suite. */
  private codeInput = '';
  private status: ConnStatus = 'closed';
  private unsubs: (() => void)[] = [];
  /** Offscreen DOM input that opens the soft keyboard on touch devices — see ensureJoinInput().
   * The keyboard-only handler below (wireCodeEntry) stays as the desktop path. */
  private joinInputEl: HTMLInputElement | null = null;
  /** Which buffer the hidden DOM input is currently mirroring, so switching screens rebuilds it
   * with the right length/sanitizer instead of typing a name into the code buffer. */
  private inputFor: 'code' | 'name' = 'code';
  /** The last DOM key event `wireCodeEntry` acted on, so a repeat delivery of the same event is
   * ignored rather than replayed against whatever screen the first delivery moved to. */
  private lastKeyEvent: KeyboardEvent | null = null;
  /** Name-entry buffer, mirrored the same way `codeInput` is. */
  private nameInput = '';
  private resume: { client: NetClient; code: string; seat: number } | null = null;
  /** Rooms this device recently got into, read from local display history (never the token). */
  private recent: RecentRoom[] = [];
  /** What the seat rows actually PAINTED on the last rebuild, in row order — recorded by
   * `renderSeatRow` as it draws. Canvas text is unreadable to Playwright, and the internal
   * `players` list is exactly the thing a rendering bug can disagree with, so a lobby test that
   * only asserts `players()` cannot see a seat that vanished off the screen. */
  private renderedSeats: RenderedSeatRow[] = [];
  /** When the current search started, for the cosmetic elapsed counter. The server owns the
   * actual queue lifetime; this number is only ever shown, never acted on. */
  private queueStartedAt = 0;
  /** True once the handoff into GameScene is scheduled, so a second view arriving during the
   * MATCH FOUND beat cannot start the match twice. */
  private matchHandoff = false;
  /** The newest view seen during the MATCH FOUND beat. Kept rather than dropped: a `state_sync`
   * that lands inside that second would otherwise be discarded and GameScene would open on a
   * revision the server has already moved past. */
  private pendingMatchView: GameView | null = null;
  /** The elapsed-search label, ticked in place once a second instead of by rebuilding the screen. */
  private searchLabel: Phaser.GameObjects.Text | null = null;
  /** Every button on the current screen, in reading order — the keyboard focus ring's targets.
   * Collected from the display list after each rebuild rather than registered per call site, so
   * a screen cannot be keyboard-unreachable by forgetting to opt in. */
  private focusables: PixelButton[] = [];
  /** Which of `focusables` the ring is on. -1 until the player actually uses the keyboard, so a
   * mouse or touch player never sees a focus ring they did not ask for. */
  private focusIndex = -1;
  /** The phase the ring's index was last meaningful in. A new screen starts the ring at its top
   * button; a redraw of the same screen (a room_state push, a flash label) keeps it where it is. */
  private focusPhase: LobbyPhase | null = null;
  /** The label the ring was on when the screen was last drawn. A redraw can change how many
   * buttons a screen has — a room card appearing or leaving the browser, a reason line showing —
   * and an index kept across that change points at a *different* action than the one the player
   * put the ring on. The label is what the ring is actually on, so it is what gets restored. */
  private focusLabel: string | null = null;

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
    // A fresh machine *is* the reset: every lobby/room/queue/discovery field this scene used to
    // clear one at a time is a field of it, so a new visit starts clean by construction (ARCH-018).
    this.lobby = new LobbyMachine();
    this.codeInput = '';
    this.nameInput = '';
    // Holding a DOM event across a scene restart would keep it alive for nothing.
    this.lastKeyEvent = null;
    this.focusables = [];
    this.focusIndex = -1;
    this.focusPhase = null;
    this.focusLabel = null;
    this.recent = readRecentRooms();
    this.queueStartedAt = 0;
    this.matchHandoff = false;
    this.pendingMatchView = null;
    this.searchLabel = null;
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
        if (!offline) this.runEffects(this.lobby.connectivityRestored());
        this.rebuild();
      }),
    );
    // ONLINE-03: a shared link carries the room code, so the invited player lands in the lobby
    // instead of transcribing five characters. Still a normal join — the server validates the
    // code exactly as it does a typed one.
    const linked = new URLSearchParams(location.search).get('room');
    this.runEffects(
      this.lobby.start({
        resume: this.resume ? { code: this.resume.code, seat: this.resume.seat } : null,
        offline: isOffline(),
        socketOpen: this.client.getStatus() === 'open',
        linkedCode: linked ? linked.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH) || null : null,
      }),
    );
    // One scene-wide timer for the searching counter, rather than a rebuild a second: the screen
    // is unchanged apart from this number, and a full rebuild would also reset the focus ring.
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (this.phase === 'queue' && this.searchLabel?.active) {
          this.searchLabel.setText(t('online.queueElapsed', { time: this.elapsedSearch() }));
        }
      },
    });

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
    el.maxLength = isCode ? ROOM_CODE_LENGTH : MAX_NAME_LENGTH;
    el.value = isCode ? this.codeInput : this.nameInput;
    // 1px, off-canvas but still focusable/tappable — a display:none input never opens a
    // soft keyboard on iOS/Android.
    el.style.cssText = 'position:fixed;left:-1px;top:-1px;width:1px;height:1px;opacity:0;border:0;padding:0;';
    // The visible label for this field is painted on the canvas, where no assistive technology can
    // reach it — so the input carries its own localized name instead of being announced as a
    // nameless text box that just took focus.
    el.setAttribute('aria-label', t(isCode ? 'online.enterCodePrompt' : 'online.namePrompt'));
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

  /**
   * Perform what a lobby transition decided. The machine owns the decision, this owns the socket,
   * the clock and local display history — the split that lets every transition above be driven
   * from a test with no Phaser and no network (ARCH-003).
   */
  private runEffects(effects: LobbyEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case 'connect':
          this.client.connect();
          break;
        case 'requestResync':
          this.client.requestResync();
          break;
        case 'join':
          this.fireOnce('join', 3000, () => this.joinCode(effect.code));
          break;
        case 'rememberRoom':
          // Local display history only: the code and the host's name, both already on screen. The
          // credential that could reclaim this seat lives in sessionStorage and never comes here.
          rememberRoom(effect.code, effect.host);
          this.recent = readRecentRooms();
          break;
        case 'forgetRoom':
          forgetRoom(effect.code);
          this.recent = readRecentRooms();
          break;
        case 'expireLobbyNotice':
          // Retires only the line it was started for — a second refusal in the same four seconds
          // owns its own timer, and this one must not cut the newer line short.
          this.time.delayedCall(4000, () => {
            if (this.lobby.expireLobbyNotice(effect.text)) this.rebuild();
          });
          break;
        case 'expireReaction':
          // Same lifetime as the server cooldown, so the line never outlives the next one.
          this.time.delayedCall(REACTION_COOLDOWN_MS, () => {
            if (this.lobby.expireReaction(effect.seat)) this.rebuild();
          });
          break;
        case 'queueEntered':
          this.queueStartedAt = Date.now();
          break;
        case 'cancelQueue':
          this.cancelQueue();
          break;
      }
    }
  }

  /** Every server push and status change, routed through one lobby transition each. No handler
   * here decides anything: it hands the message to the machine and performs what comes back. */
  private wireClient(): void {
    this.unsubs.push(
      this.client.onStatus((s, reason) => {
        this.status = s;
        this.runEffects(this.lobby.status(s, reason));
        this.rebuild();
      }),
      this.client.on('room_joined', (msg) => {
        // The in-flight guard for 'create'/'join' is deliberately NOT released here: this handler
        // can fire between a double-click's two clicks (fast on localhost, or whenever frames are
        // slow — e.g. under Playwright tracing), and clearing it right then reopens the window for
        // the second click to fire a duplicate create_room/join_room. Neither button exists once
        // the phase is 'lobby', so an early clear buys nothing; fireOnce's cooldown (or a
        // rejection) is what releases it.
        this.runEffects(this.lobby.roomJoined(msg));
        this.rebuild();
      }),
      this.client.on('room_state', (msg) => {
        this.runEffects(this.lobby.roomState(msg));
        this.rebuild();
      }),
      this.client.on('player_reaction', (msg) => {
        this.runEffects(this.lobby.reaction(msg));
        this.rebuild();
      }),
      this.client.on('queue_state', (msg) => {
        this.runEffects(this.lobby.queueState(msg));
        this.rebuild();
      }),
      this.client.on('room_list', (msg) => {
        this.runEffects(this.lobby.roomList(msg));
        if (this.phase === 'browse') this.rebuild();
      }),
      this.client.on('game_started', (msg) => this.enterMatch(msg.view)),
      // Resuming after a reload: the server answers `reconnect` with `room_joined` (which set
      // code/seat just above) followed by `state_sync` for a match already in progress. Without
      // this the client re-established its seat but sat in the lobby forever.
      this.client.on('state_sync', (msg) => this.enterMatch(msg.view)),
      this.client.on('error', (msg) => {
        this.runEffects(this.lobby.serverError(msg));
        this.rebuild();
      }),
    );
  }

  /** Hand off to GameScene for a match — from a fresh `game_started` or a resumed `state_sync`.
   *
   * A matchmade match pauses on MATCH FOUND first. The pause is presentation only: the room, the
   * seat and the deal already exist on the server, so a player who closes the tab during it
   * reconnects into the match exactly as they would from any other moment. */
  private enterMatch(view: GameView): void {
    if (this.code === null || this.seat === null) return;
    if (this.phase === 'matched' || this.matchHandoff) {
      // Newest wins: the handoff opens GameScene on the last view the server sent, not on the
      // one that happened to arrive first.
      this.pendingMatchView = view;
      if (this.matchHandoff) return;
      this.matchHandoff = true;
      this.time.delayedCall(MATCH_FOUND_MS, () => {
        const latest = this.pendingMatchView;
        this.pendingMatchView = null;
        if (latest) this.startMatch(latest);
      });
      return;
    }
    this.startMatch(view);
  }

  private startMatch(view: GameView): void {
    if (this.code === null || this.seat === null) return;
    // seed 0: the server never discloses the shuffle seed, and an online client never deals.
    this.scene.start('game', {
      seed: 0,
      players: [],
      online: { client: this.client, view, seat: this.seat, code: this.code },
    });
  }

  /** The e2e surface is built from the lobby machine and the socket; this scene supplies only the
   * actions it owns and the two facts that exist purely on screen (ARCH-011). */
  private installDebugHooks(): void {
    debugApi.online = lobbyDebugSurface(this.lobby, this.client, {
      displayName: () => this.playerName(),
      join: (code, name) => this.joinCode(code, name),
      startQueue: () => this.startQueue(),
      cancelQueue: () => this.cancelQueue(),
      openCustomSettings: () => this.openCustomSettings(),
      openParty: () => {
        if (this.lobby.openParty()) this.rebuild();
      },
      openBrowse: () => {
        if (!this.lobby.openBrowse()) return;
        this.rebuild();
        this.refreshListings();
      },
      focus: () => ({
        index: this.focusIndex,
        count: this.focusables.length,
        label: this.focusIndex < 0 ? '' : this.focusables[this.focusIndex]?.labelText() ?? '',
      }),
      lobbySeats: () => this.renderedSeats,
      lobbyBoxes: () => this.lobbyBoxes,
    });
  }

  /** mm:ss since the search started. Cosmetic: the server decides when a search is over, and a
   * client whose clock disagrees changes nothing. */
  private elapsedSearch(): string {
    const secs = Math.max(0, Math.floor((Date.now() - this.queueStartedAt) / 1000));
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  }

  private queueTargetLabel(target: QueueTarget): string {
    return t(target === 'any' ? 'online.queueTargetAny' : `online.queueTarget${target}`);
  }

  private startQueue(): void {
    this.lobby.queueRequested(this.queueTarget);
    this.queueStartedAt = Date.now();
    this.client.joinQueue(this.queueTarget, this.playerName());
  }

  /** Leave the search. Idempotent by construction — the button is gone after the first press, and
   * the server answers a duplicate with the same authoritative state either way. */
  private cancelQueue(): void {
    this.client.cancelQueue();
  }

  private backToMenu(): void {
    // A room we were alone in dies with our exit, so remembering it would put a CONTINUAR on the
    // entry screen whose only possible answer is room_not_found. Leaving a populated room still
    // leaves something to come back to.
    if (this.code !== null && this.players.length <= 1) forgetRoom(this.code);
    this.client.leaveRoom();
    debugApi.online = null;
    gotoScene(this, 'menu');
  }

  /** Keyboard-driven text entry for the code and name screens. Every keystroke goes through the
   * same sanitizer the DOM input uses, so a buffer is always a submittable value. */
  private wireCodeEntry(): void {
    const onKey = (ev: KeyboardEvent): void => {
      // Phaser can hand the same DOM event to this listener twice — a keydown and its keyup
      // landing in one frame (an ordinary quick Enter tap) drains the queue in a way that emits
      // the keydown again. Acting on it twice is not cosmetic here: the first Enter commits the
      // name and switches the screen back to the code, and the second one then submits the
      // half-typed code that screen is still holding. One event, one action.
      if (ev === this.lastKeyEvent) return;
      this.lastKeyEvent = ev;
      const naming = this.phase === 'name';
      if (this.phase !== 'join' && !naming) {
        this.onNavKey(ev);
        return;
      }
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
        this.lobby.escapeToIdle();
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

  /**
   * Keyboard navigation for every screen that is not a text field.
   *
   * The code and name screens are excluded by the caller: there Enter already means "submit" and
   * every printable key is a character, so a second meaning for them would be a trap. Everywhere
   * else Tab/arrows move a ring and Enter/Space presses what it is on — including a *disabled*
   * button, which answers with its own blocking reason exactly as a click on it does. Skipping
   * disabled buttons would hide the one explanation the player is looking for.
   */
  private onNavKey(ev: KeyboardEvent): void {
    if (ev.key === 'Tab' || ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.moveFocus(ev.key === 'ArrowUp' || (ev.key === 'Tab' && ev.shiftKey) ? -1 : 1);
      return;
    }
    if (ev.key === 'Enter' || ev.key === ' ') {
      if (this.focusIndex < 0) return;
      ev.preventDefault();
      this.focusables[this.focusIndex]?.press();
    }
  }

  private moveFocus(delta: number): void {
    const n = this.focusables.length;
    if (n === 0) return;
    const from = this.focusIndex;
    if (from >= 0) this.focusables[from]?.setSelected(false);
    this.focusIndex = from < 0 ? (delta > 0 ? 0 : n - 1) : (from + delta + n) % n;
    this.focusables[this.focusIndex]?.setSelected(true);
    this.focusLabel = this.focusables[this.focusIndex]?.labelText() ?? null;
  }

  /**
   * Re-read the screen's buttons after a rebuild and put the ring back.
   *
   * Reading order, not creation order: the reactions strip and the READY/START pair are built in
   * whatever order their renderers happen to run, and a ring that jumped sideways up the screen
   * would be worse than no ring.
   *
   * The index survives a redraw of the same screen — pressing a button usually redraws it, and
   * losing the ring every time would make the keyboard path one-shot — but a *new* screen starts
   * the ring at its top button rather than at whatever index happens to still be in range, which
   * would otherwise land somewhere arbitrary on a shorter screen.
   */
  private collectFocusables(): void {
    const wasOn = this.focusLabel;
    this.focusables = this.children.list
      .filter((o): o is PixelButton => o instanceof PixelButton)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (this.focusIndex >= 0) {
      if (this.focusPhase !== this.phase) {
        this.focusIndex = 0;
      } else if (wasOn !== null) {
        // Same screen, redrawn: follow the button, not the slot. A card that disappeared between
        // two frames must not silently hand the ring's Enter to whatever moved into its place.
        const same = this.focusables.findIndex((b) => b.labelText() === wasOn);
        if (same !== -1) this.focusIndex = same;
      }
    }
    this.focusPhase = this.phase;
    if (this.focusIndex >= this.focusables.length) this.focusIndex = this.focusables.length - 1;
    if (this.focusIndex >= 0) this.focusables[this.focusIndex]?.setSelected(true);
    this.focusLabel = this.focusIndex >= 0 ? this.focusables[this.focusIndex]?.labelText() ?? null : null;
  }

  /** Runs `fn` unless `key` is already in flight, then disables it for `cooldownMs` (released
   * earlier by a server response that ends the attempt — a rejection clears every guard, and
   * `room_state`/`queue_state` clear their own. `room_joined` deliberately does not: see the
   * handler above). */
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
    const el = label(this, cx(), view().portrait ? vy(248) : vy(260), t('offline.online'), 7, TEXT.error);
    this.time.delayedCall(2000, () => el.destroy());
  }

  private submitJoin(): void {
    if (this.codeInput.length === 0) return;
    this.joinCode(this.codeInput);
  }

  /**
   * The single join path behind every entrance — typed code, invite link, recent room, browser
   * card. One place, so the client can never treat a discovered room as a different kind of join
   * than a typed one: the server validates lifecycle, capacity and seat ownership identically,
   * and a live session token has already reclaimed its seat before any of this runs.
   */
  private joinCode(code: string, name?: string): void {
    this.lobby.joinStarted(code);
    this.client.joinRoom(code, name ?? this.playerName());
  }

  /**
   * Store the typed name and go back to the entry screen. ON-05: a name that survives the
   * sanitizer with fewer than MIN_NAME_LENGTH visible characters (empty, spaces only, or a
   * string that was nothing but emoji/control characters) is refused on the spot and said so —
   * silently keeping the old name looks like the button did nothing.
   */
  private commitName(): void {
    const name = sanitizeName(this.nameInput).trim();
    if (!this.lobby.commitName(name, MIN_NAME_LENGTH)) {
      this.rebuild();
      return;
    }
    writeDisplayName(name);
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
    const el = label(this, cx(), vy(106), t(key), 7, TEXT.success);
    this.copiedLabel = el;
    this.time.delayedCall(1500, () => {
      if (el.active) el.destroy(); // rebuild() may have already torn it down
    });
  }

  /** One tap, one outcome: hand the invite to the device's share sheet where there is one, and
   * fall back to the clipboard everywhere else. Used by the waiting-seat row and the between-match
   * invite, so "get someone in here" is never two decisions. */
  private inviteSomeone(): void {
    if (typeof navigator.share === 'function') this.shareCode();
    else this.copyCode();
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
    this.renderedSeats = [];
    this.lobbyBoxes = [];
    this.tweens.killAll();
    this.children.removeAll(true);
    // Destroyed with the rest of the display list; the once-a-second tick checks for it.
    this.searchLabel = null;
    if (view().touch && (this.phase === 'join' || this.phase === 'name')) {
      this.ensureTextInput(this.phase === 'join' ? 'code' : 'name');
    } else this.destroyJoinInput();
    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, SURFACE.base, 0.45);
    // backdrop panel so lobby text reads against the busy boteco scene, same treatment MenuScene
    // uses for its controls (L1) — legible by construction, not by luck of what's behind it.
    // `woodPanel`, not a near-transparent rect with a hairline stroke: that rect is exactly what
    // the menu screens replaced when it read as a debug overlay in playtests, and at 0.62 over the
    // boteco art the connection-error copy was competing with a lamp and a bar stool behind it.
    woodPanel(this, cx(), vy(138), panelW(280), vy(236));
    label(this, cx(), vy(26), t('online.title'), 15, TEXT.accent);

    // ONLINE-10: a working connection is the expected case and says nothing worth a line of the
    // player's attention. Only the states they can act on — connecting, reconnecting, dropped —
    // get promoted to a visible status.
    if (this.status !== 'open') {
      const statusColor = this.status === 'connecting' || this.status === 'reconnecting' ? TEXT.accent : TEXT.error;
      label(this, cx(), vy(44), t(`online.status.${this.status}`), 8, statusColor);
    }

    if (this.phase === 'error') {
      this.add
        .text(cx(), vy(120), this.errorMsg ?? '', { ...fontStyle(9, TEXT.error), align: 'center', wordWrap: { width: panelW(320) } })
        .setOrigin(0.5);
      // Only VOLTAR used to be offered here — a near dead end for a rejoinable failure (e.g. a
      // dropped connection). Retrying re-runs the same connect() path a fresh visit to this
      // scene would use; offline stays a flash, same reason as CRIAR SALA/ENTRAR above.
      new PixelButton(this, cx(), vy(155), t('online.retry'), () => {
        if (isOffline()) { this.flashOfflineReason(); return; }
        this.runEffects(this.lobby.retry());
        this.rebuild();
      }, { textureBase: 'btn-comprar', w: 140, h: 20, size: 8 });
    } else if (this.phase === 'join') {
      this.renderJoin();
    } else if (this.phase === 'name') {
      this.renderName();
    } else if (this.phase === 'custom' && this.code !== null) {
      this.renderCustom();
    } else if (this.phase === 'party' && this.code !== null) {
      this.renderParty();
    } else if (this.phase === 'browse') {
      this.renderBrowse();
    } else if (this.phase === 'queue') {
      this.renderQueue();
    } else if (this.phase === 'matched') {
      this.renderMatchFound();
    } else if (this.phase === 'lobby' && this.code !== null) {
      this.renderLobby();
    } else {
      this.renderEntry();
    }

    // Portrait stacks START (and its reason line) under READY, so VOLTAR moves down to clear them.
    // On the custom screen the same button means "back to the lobby, change nothing" — leaving the
    // room from a settings screen would be a trap, and the draft is deliberately thrown away.
    // 'browse' is reached from the entry screen without a room, so VOLTAR there means "back to
    // create/join", not "leave the room" — leaving one we were never in would drop the socket.
    // MATCH FOUND has no way out on purpose: the seat already exists and the match has already
    // been dealt, so an exit here would be an abandonment dressed up as a choice.
    if (this.phase === 'matched') {
      this.collectFocusables();
      return;
    }
    const isSubScreen = this.phase === 'custom' || this.phase === 'party' || this.phase === 'browse'
      || this.phase === 'queue' || this.phase === 'name';
    const leavingRoom = !isSubScreen;
    const backLabel = this.phase === 'custom' ? 'online.customCancel' : 'online.back';
    new PixelButton(this, cx(), view().portrait ? vy(260) : vy(245), t(backLabel), () => {
      if (!leavingRoom) {
        this.customDraft = null;
        // Backing out of a search *is* cancelling it, and out of the name editor returns to the
        // screen that opened it — which, coming from JOIN, still holds a half-typed code. Both
        // are the machine's `back()`.
        this.runEffects(this.lobby.back().effects);
        this.rebuild();
        return;
      }
      // No cooldown/rebuild needed: backToMenu() leaves this scene immediately, so the guard
      // only needs to stop a second click before that happens.
      if (this.inFlight.has('leave')) return;
      this.inFlight.add('leave');
      this.backToMenu();
    }, { textureBase: 'btn-comprar', w: this.phase === 'custom' ? 150 : 110, h: view().portrait ? 24 : 18, size: 7 });

    // Last, because it reads the finished display list: every button this rebuild created, in
    // reading order, is what the keyboard ring walks.
    this.collectFocusables();
  }

  /** ONLINE-22: the entry screen says who you will show up as before you commit to a room, and
   * lets you change it there — an identity you can see is worth more than one you have to guess. */
  /**
   * Online home. One vertical stack, in the order a returning player wants it: the room they
   * were just in, then making a new one, then the two ways into someone else's.
   *
   * CONTINUE and RECENT are local display history, not a second source of room truth — both do
   * nothing but hand a code to the same join path a typed code uses, and the server is free to
   * answer that the room is gone. BROWSE is offered unconditionally: it is additive, and a
   * discovery outage degrades on its own screen instead of taking CREATE/JOIN down with it.
   */
  private renderEntry(): void {
    this.renderNameLine(62, 72);

    // Quick Match is the primary action: one tap into a table with strangers, with the only
    // choice that changes what it does — how many of them — directly under it.
    const quick = new PixelButton(
      this, cx(), vy(94), t('online.quickMatch'),
      () => this.fireOnce('queue', 3000, () => this.startQueue()),
      { textureBase: 'btn-feito', w: 160, h: 22, size: 9, primary: true, onBlocked: () => this.flashOfflineReason() },
    );
    quick.setEnabled(this.canAct('queue'));
    const targetLine = label(this, cx(), vy(110), this.queueTargetLabel(this.queueTarget), 7, TEXT.accent);
    targetLine
      .setInteractive(
        new Phaser.Geom.Rectangle(-20, -14, targetLine.width + 40, Math.max(targetLine.height + 16, 34)),
        Phaser.Geom.Rectangle.Contains,
      )
      .on('pointerup', () => {
        const i = QUEUE_TARGET_CYCLE.indexOf(this.queueTarget);
        this.lobby.queueRequested(QUEUE_TARGET_CYCLE[(i + 1) % QUEUE_TARGET_CYCLE.length]!);
        this.rebuild();
      });

    // How the last search ended, where the player actually landed rather than on a screen they
    // have already left. It takes the caption's place for a moment: both are explanation, and
    // only one of them is news.
    if (this.queueNotice !== null) {
      this.add
        .text(cx(), vy(120), this.queueNotice, {
          ...fontStyle(7, TEXT.accent), align: 'center', wordWrap: { width: panelW(250) },
        })
        .setOrigin(0.5);
    } else {
      label(this, cx(), vy(120), t('online.playWithFriends'), 6, TEXT.dim);
    }

    // Two stacks, one cursor. A returning player gets CONTINUAR above the create/join pair; a
    // first-time one sees only the pair, because nothing has been remembered to make room for.
    const last = this.recent[0];
    let y = last ? 164 : 136;
    if (last) {
      // Secondary emphasis on purpose: QUICK MATCH above is this screen's one primary action, and
      // a second full-strength green button beside it left the entry screen with two competing
      // calls to action (Wave 5B control hierarchy). CONTINUAR keeps its size and its place at the
      // top of the room stack, so it still outranks CREATE/JOIN without outshouting the primary.
      const cont = new PixelButton(
        this, cx(), vy(138), t('online.continue'),
        () => this.fireOnce('join', 3000, () => this.joinCode(last.code)),
        { textureBase: 'btn-comprar', w: 150, h: 20, size: 8, onBlocked: () => this.flashOfflineReason() },
      );
      cont.setEnabled(this.canAct('join'));
      label(
        this, cx(), vy(149),
        last.host ? t('online.continueRoom', { code: last.code, host: last.host }) : last.code,
        6, TEXT.muted,
      );
    }

    const createBtn = new PixelButton(
      this, cx(), vy(y), t('online.create'),
      () => this.fireOnce('create', 3000, () => this.client.createRoom(this.playerName())),
      { textureBase: 'btn-comprar', w: 140, h: 20, size: 8, onBlocked: () => this.flashOfflineReason() },
    );
    createBtn.setEnabled(this.canAct('create'));
    y += 20;

    new PixelButton(this, cx(), vy(y), t('online.join'), () => {
      this.lobby.openJoin();
      this.codeInput = '';
      this.rebuild();
    }, { textureBase: 'btn-comprar', w: 140, h: 20, size: 8 });
    y += 18;

    const browse = new PixelButton(this, cx(), vy(y), t('online.browse'), () => {
      if (!this.lobby.openBrowse()) return;
      this.rebuild();
      this.refreshListings();
    }, { textureBase: 'btn-comprar', w: 140, h: 18, size: 7, onBlocked: () => this.flashOfflineReason() });
    browse.setEnabled(!isOffline());
    y += 16;

    // Anything older than "the room before last" is offered as a bare code strip: small, one tap,
    // and gone from the list the moment the server says that room no longer exists.
    const others = this.recent.slice(1, 1 + RECENT_SHOWN);
    if (others.length > 0) {
      label(this, cx(), vy(y), t('online.recent'), 6, TEXT.dim);
      const gap = 56;
      others.forEach((room, i) => {
        const x = cx() - ((others.length - 1) * gap) / 2 + i * gap;
        const el = label(this, x, vy(y + 11), room.code, 8, TEXT.accent);
        el.setInteractive(
          new Phaser.Geom.Rectangle(-12, -14, el.width + 24, Math.max(el.height + 20, 34)),
          Phaser.Geom.Rectangle.Contains,
        ).on('pointerup', () => {
          if (isOffline()) { this.flashOfflineReason(); return; }
          this.fireOnce('join', 3000, () => this.joinCode(room.code));
        });
      });
    }
  }

  /**
   * The searching screen. Three facts and one action: that we are searching, what for, how long
   * it has been, and how to stop. No queue size, no position, no estimate and no roster — none of
   * it is on the wire (§3e), and a made-up number would be worse than the honest sentence.
   *
   * Nothing here is animated: the state is readable from words alone, so reduced motion and a
   * still screenshot say exactly the same thing a moving one would.
   */
  private renderQueue(): void {
    label(this, cx(), vy(72), t('online.queueSearching'), 11, TEXT.accent);
    label(this, cx(), vy(88), this.queueTargetLabel(this.queueTarget), 8, TEXT.primary);
    this.searchLabel = label(
      this, cx(), vy(116), t('online.queueElapsed', { time: this.elapsedSearch() }), 9, TEXT.muted,
    );
    // The place in the queue is held server-side across a brief drop, so the honest line here is
    // "it continues", not "it failed". The status line at the top already names the connection
    // state itself.
    if (this.status !== 'open') {
      this.add
        .text(cx(), vy(140), t('online.queueLost'), {
          ...fontStyle(7, TEXT.accent), align: 'center', wordWrap: { width: panelW(250) },
        })
        .setOrigin(0.5);
    }
    new PixelButton(this, cx(), vy(172), t('online.queueCancel'), () => this.cancelQueue(), {
      textureBase: 'btn-comprar', w: 150, h: view().portrait ? 26 : 22, size: 9,
    });
  }

  /** The beat between the queue and the table. No action on it, because there is nothing left to
   * decide: the room, the seat and the deal already exist. */
  private renderMatchFound(): void {
    label(this, cx(), vy(100), t('online.matchFound'), 14, TEXT.accent);
    label(this, cx(), vy(122), plural('online.matchPlayers', this.matchPlayers), 9, TEXT.primary);
    label(this, cx(), vy(140), t('online.matchJoining'), 8, TEXT.muted);
  }

  /** Ask the server for the currently discoverable rooms. Manual only — this fires when the
   * browser is opened and when ATUALIZAR is tapped, never on a timer. */
  private refreshListings(): void {
    if (isOffline()) {
      this.lobby.browseFailed();
      this.rebuild();
      return;
    }
    this.lobby.browseLoading();
    this.client.listRooms();
    this.rebuild();
  }

  /** Player-facing status word for a card. Never the raw enum, and never colour alone. */
  private listingStatus(room: RoomListing): string {
    return t(room.status === 'full' ? 'online.cardFull' : 'online.cardWaiting');
  }

  /**
   * The room browser: only rooms their hosts explicitly listed, only while they can actually
   * seat someone, and only the small public projection (protocol.ts `RoomListing`). Nothing here
   * is a room snapshot — there is no seat, no token, no revision and no hand count to leak.
   */
  private renderBrowse(): void {
    label(this, cx(), vy(62), t('online.browseTitle'), 11, TEXT.accent);
    // One line, for the player who has never been in a room with strangers: what this list is
    // and what happens after the tap. Anything longer belongs in the room, not in front of it.
    label(this, cx(), vy(74), t('online.browseIntro'), 6, TEXT.dim);

    const portrait = view().portrait;
    const rowW = Math.min(panelW(260), view().w - 24);
    const left = cx() - rowW / 2;
    const step = portrait ? 32 : 26;
    const top = 92;

    if (this.browseState === 'loading') {
      label(this, cx(), vy(120), t('online.browseLoading'), 8, TEXT.muted);
    } else if (this.browseState === 'failed') {
      this.add
        .text(cx(), vy(116), t('online.browseFailed'), {
          ...fontStyle(8, TEXT.error), align: 'center', wordWrap: { width: rowW },
        })
        .setOrigin(0.5);
      // Discovery is not a dependency of private multiplayer — say so, and keep the door open.
      label(this, cx(), vy(136), t('online.browseStillWorks'), 6, TEXT.muted);
    } else if (this.listings.length === 0) {
      this.add
        .text(cx(), vy(120), t('online.browseEmpty'), {
          ...fontStyle(8, TEXT.muted), align: 'center', wordWrap: { width: rowW },
        })
        .setOrigin(0.5);
    } else {
      const shown = this.listings.slice(0, browseRows(portrait));
      shown.forEach((room, i) => {
        const y = vy(top + i * step);
        this.add.rectangle(cx(), y, rowW, vy(step - 4), SURFACE.panel, 0.75).setStrokeStyle(1, SURFACE.panelBorder, 0.5);
        // Both lines are clamped to the space the JOIN button leaves, rather than trusted to be
        // short: a 12-character name and the large-text scale together are enough to run a label
        // straight under the button. Least important word last, because that is what gets cut.
        const textW = rowW - 76;
        const cardLine = (ly: number, str: string, size: number, color: string): void => {
          this.add
            .text(left + 8, ly, str, { ...fontStyle(size, color), wordWrap: { width: textW }, maxLines: 1 })
            .setOrigin(0, 0.5);
        };
        cardLine(y - vy(6), t('online.cardHost', { host: room.hostName }), 7, TEXT.primary);
        cardLine(
          y + vy(6),
          `${t('online.cardSeats', { n: room.players, max: room.capacity })} · ${this.listingStatus(room)} · ${t(`online.timer.${room.timerMode}`)}`,
          6, TEXT.muted,
        );
        const join = new PixelButton(this, left + rowW - 34, y, t('online.join'), () => {
          this.fireOnce('join', 3000, () => this.joinCode(room.code));
        }, { textureBase: 'btn-feito', w: 58, h: portrait ? 22 : 18, size: 6, onBlocked: () => this.flashOfflineReason() });
        // A full room keeps its card (so "it just filled up" is readable) but not its action.
        join.setEnabled(room.status !== 'full' && this.canAct('join'));
      });
      if (this.listings.length > shown.length) {
        label(this, cx(), vy(top + shown.length * step), t('online.browseMore', { n: this.listings.length - shown.length }), 6, TEXT.dim);
      }
    }

    // Above ATUALIZAR, because that is the action the notice asks for: the list it belongs to
    // is now one card shorter, and a refresh is how it gets honest again.
    if (this.browseNotice !== null) {
      this.add
        .text(cx(), portrait ? vy(212) : vy(200), this.browseNotice, {
          ...fontStyle(7, TEXT.accent), align: 'center', wordWrap: { width: rowW },
        })
        .setOrigin(0.5);
    }

    new PixelButton(this, cx(), portrait ? vy(228) : vy(216), t('online.browseRefresh'), () => {
      this.fireOnce('refresh', 1500, () => this.refreshListings());
    }, { textureBase: 'btn-comprar', w: 120, h: portrait ? 22 : 18, size: 7 });
  }

  /** Who this device will show up as, and the tap that changes it. Offered on every screen that
   * can still be the last one before a seat is taken — the name is only editable up to that
   * point, so a screen that leads into a room must carry it. */
  private renderNameLine(y: number, captionY: number): void {
    const nameLine = label(this, cx(), vy(y), t('online.playingAs', { name: this.playerName() }), 8, TEXT.primary);
    nameLine
      // A text line's own bounds are a thin strip; a coarse pointer needs a real target, so the
      // hit area is grown to the touch floor without moving the text.
      .setInteractive(
        new Phaser.Geom.Rectangle(-20, -16, nameLine.width + 40, Math.max(nameLine.height + 16, 34)),
        Phaser.Geom.Rectangle.Contains,
      )
      .on('pointerup', () => {
        this.lobby.openName(this.phase === 'join' ? 'join' : 'idle');
        this.nameInput = readDisplayName() ?? '';
        this.rebuild();
      });
    label(this, cx(), vy(captionY), t('online.changeName'), 6, TEXT.dim);
  }

  private renderJoin(): void {
    label(this, cx(), vy(86), t('online.enterCodePrompt'), 9, TEXT.primary);
    const shown = this.codeInput.padEnd(ROOM_CODE_LENGTH, '_');
    // tappable so a touch player who blurred the soft keyboard can bring it back
    label(this, cx(), vy(118), shown, 20, this.codeInput ? TEXT.accent : TEXT.dim)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.joinInputEl?.focus());
    // A phone has no ENTER key on screen — point at the tappable code/JOIN path instead.
    label(this, cx(), vy(148), t(view().touch ? 'online.codeHintTouch' : 'online.codeHint'), 7, TEXT.muted);
    const confirm = new PixelButton(this, cx(), vy(180), t('online.join'), () => this.fireOnce('join', 3000, () => this.submitJoin()), {
      textureBase: 'btn-feito', w: 120, h: 22, size: 8, onBlocked: () => this.flashOfflineReason(),
    });
    confirm.setEnabled(this.codeInput.length > 0 && this.canAct('join'));
    this.renderNameLine(206, 216);
  }

  /** Name entry, deliberately the same shape as the code screen so there is one thing to learn. */
  private renderName(): void {
    label(this, cx(), vy(86), t('online.namePrompt'), 9, TEXT.primary);
    const shown = this.nameInput || '_';
    label(this, cx(), vy(118), shown, 16, this.nameInput ? TEXT.accent : TEXT.dim)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.joinInputEl?.focus());
    label(this, cx(), vy(148), t(view().touch ? 'online.nameHintTouch' : 'online.nameHint'), 7, TEXT.muted);
    if (this.nameError) label(this, cx(), vy(160), t('online.nameTooShort'), 7, TEXT.error);
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
  private renderRoomSummary(top: number): number {
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
    // Wrapped to the panel, not laid out as one line: the four-clause pt-BR summary is wider than
    // the 270-unit portrait world, so on a phone it ran out through both wooden edges.
    const line = this.add
      .text(cx(), top, text, {
        ...fontStyle(7, isHost ? TEXT.accent : TEXT.muted), align: 'center', wordWrap: { width: panelW(250) },
      })
      .setOrigin(0.5, 0);
    if (!isHost) return line.y + line.height;
    line.setInteractive({ useHandCursor: true }).on('pointerup', () => {
      this.fireOnce('settings', 300, () => this.client.setRoomSettings({ ...TIMER_PRESETS[nextTimerPreset(this.roomSettings.timerMode)] }));
    });
    // AJUSTAR and the tap hint share one row only while the row has space for both. A centred hint
    // grows into the right-anchored link as soon as the text scale or the locale makes it longer,
    // and the two used to run together into one unreadable word. Neither is dropped now — the
    // lobby is a flow (see renderLobby), so the hint simply takes its own row underneath and
    // everything below it moves down.
    // `y` here is a row centre: every label() in this file is origin-centred.
    const link = this.openCustomLink(line.y + line.height + 6);
    const hint = label(this, cx(), link.y, t('online.timerTapHint'), 6, TEXT.dim);
    if (hint.x + hint.width / 2 + 4 > link.x - link.width / 2) hint.setY(link.y + hint.height + 1);
    return Math.max(link.y, hint.y) + hint.height / 2;
  }

  /** The host-only way into the custom screen. A separate target from the summary line above it,
   * so cycling presets and opening the editor can never be the same mis-tap. */
  private openCustomLink(y: number): Phaser.GameObjects.Text {
    const link = label(this, cx() + panelW(240) / 2 - 26, y, t('online.customize'), 6, TEXT.accent);
    link
      .setInteractive(
        new Phaser.Geom.Rectangle(-12, -12, link.width + 24, Math.max(link.height + 16, 30)),
        Phaser.Geom.Rectangle.Contains,
      )
      .on('pointerup', () => this.openCustomSettings());
    return link;
  }

  /** Opens the custom screen on a copy of whatever the room is playing under now, so the host
   * edits the real current terms instead of starting from an unrelated default. */
  private openCustomSettings(): void {
    if (!this.lobby.openCustom()) return;
    this.customDraft = { ...this.roomSettings, timerMode: 'custom' };
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
    label(this, cx(), vy(62), t('online.customTitle'), 10, TEXT.primary);

    const rowW = Math.min(panelW(250), view().w - 30);
    const left = cx() - rowW / 2;
    const step = portrait ? 26 : 20;
    CUSTOM_ROWS.forEach((row, i) => {
      const y = vy(82 + i * step);
      const [lo, hi] = CUSTOM_BOUNDS[row.key];
      const value = draft[row.key];
      label(this, left + 2, y, t(`online.custom.${row.key}`), 7, TEXT.muted).setOrigin(0, 0.5);
      const shown = row.unit === 'seconds'
        ? t('online.custom.seconds', { n: Math.round(value / 1000) })
        : t('online.custom.turns', { n: value });
      label(this, left + rowW - 62, y, shown, 8, TEXT.primary).setOrigin(1, 0.5);
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
          ...fontStyle(6, TEXT.accent), align: 'center', wordWrap: { width: rowW },
        })
        .setOrigin(0.5);
    }
    new PixelButton(this, cx(), bottom + (portrait ? 22 : 16), t('online.customApply'), () => {
      this.fireOnce('settings', 300, () => {
        this.client.setRoomSettings({ ...draft, timerMode: 'custom' });
        this.customDraft = null;
        this.lobby.closeCustom();
        this.rebuild();
      });
    }, { textureBase: 'btn-feito', w: 130, h: portrait ? 24 : 20, size: 8, primary: true });
  }

  /** Display name for a seat, or the generic placeholder when the seat is still empty. */
  private seatName(seat: number): string {
    return this.players.find((p) => p.seat === seat)?.name ?? t('online.emptySeat');
  }

  /** True once this room has finished at least one match: the lobby is then a *between-matches*
   * lobby, where a ready bit means "I want a rematch" rather than "I want to start". Same bit,
   * different sentence — see docs/MULTIPLAYER.md §3c. */
  private betweenMatches(): boolean {
    return this.party.matches.length > 0;
  }

  /**
   * ONLINE-04/05/07: one row per seat at the table — a coloured badge with the seat's initial, the
   * name, the host marker, and the ready state spelled out in words. Colour is never the only
   * carrier: every row states READY/WAITING (and OFFLINE) as text.
   *
   * Once the room has a history, the same row also carries that seat's session wins, immediately
   * left of the status word. It costs no extra line — which is what keeps four seats, a score and
   * a status readable on a 360-wide phone.
   */
  private renderSeatRow(y: number, player: RoomPlayerSummary | null, seat: number): void {
    const rowW = Math.min(panelW(240), view().w - 30);
    const left = cx() - rowW / 2;
    const filled = player !== null;
    const badge = this.add.circle(left + 8, y, 7, filled ? SEAT_COLORS[seat % SEAT_COLORS.length]! : EMPTY_SEAT_BADGE);
    badge.setStrokeStyle(1, SURFACE.panelBorder, filled ? 0.9 : 0.4);
    const name = filled ? player.name : t('online.emptySeat');
    label(this, badge.x, y, filled ? name.slice(0, 1).toUpperCase() : '+', 8, TEXT.primary);

    const isMe = filled && player.seat === this.seat;
    // Badges are spelled out, never carried by colour alone: the yellow name used to be the only
    // thing saying which row is yours, which is invisible to a colour-blind player and to anyone
    // reading a small phone screen in sunlight.
    // "Você · Você · ANFITRIÃO": the default display name *is* the you-badge word (playerName()
    // falls back to t('menu.you')), so an unnamed player's own row said the same word twice. The
    // badge exists to answer "which row is mine" — a name that already answers it needs no badge.
    const badges = [
      ...(isMe && name !== t('menu.you') ? [t('menu.you')] : []),
      ...(seat === this.hostSeat && filled ? [t('online.host')] : []),
    ];
    const nameText = badges.length ? `${name} · ${badges.join(' · ')}` : name;
    const nameEl = this.add
      .text(left + 20, y, nameText, fontStyle(8, filled ? (isMe ? TEXT.accent : TEXT.primary) : TEXT.dim))
      .setOrigin(0, 0.5);

    if (!filled) {
      this.renderedSeats.push({ seat, name: '', you: false, host: false, status: 'empty', wins: 0 });
      // An empty chair is an invitation, not dead space: it says what it is waiting for and hands
      // over the share/copy path on tap, which is the action a player actually wants there.
      this.add.text(left + rowW, y, t('online.waitingPlayer'), fontStyle(7, TEXT.dim)).setOrigin(1, 0.5);
      const invite = label(this, left + 20 + nameEl.width + 10, y, t('online.invitePlayer'), 6, TEXT.accent).setOrigin(0, 0.5);
      invite
        .setInteractive(
          new Phaser.Geom.Rectangle(-10, -12, invite.width + 20, Math.max(invite.height + 16, 30)),
          Phaser.Geom.Rectangle.Contains,
        )
        .on('pointerup', () => this.inviteSomeone());
      return;
    }
    const readyWord = this.betweenMatches() ? t('online.wantsRematch') : t('online.playerReady');
    const statusText = !player.connected
      ? t('online.status.closed')
      : player.ready
        ? `✓ ${readyWord}`
        : t('online.playerWaiting');
    const statusColor = !player.connected ? TEXT.error : player.ready ? TEXT.success : TEXT.muted;
    const statusEl = this.add
      .text(left + rowW, y, this.betweenMatches() ? `${player.wins} · ${statusText}` : statusText, fontStyle(7, statusColor))
      .setOrigin(1, 0.5);
    this.renderedSeats.push({
      seat,
      name,
      you: isMe,
      host: seat === this.hostSeat,
      status: !player.connected ? 'offline' : player.ready ? 'ready' : 'waiting',
      wins: player.wins,
    });
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
  /**
   * Who can *find* this room, stated in words rather than by a colour or an icon — and, for the
   * host, the control that changes it.
   *
   * Private is the state a room is born in and the state it returns to with one tap. Changing it
   * deliberately does not clear anyone's ready bit: visibility is not one of the terms a seat
   * agreed to play under (contrast renderRoomSummary / ON-09), so resetting the lobby over it
   * would be friction with no fairness behind it. Locked once the match starts, same as settings.
   */
  /** Returns the bottom edge of the two-line visibility block, so the lobby's flow can start
   * under it instead of assuming it ends above vy(74) — it does not at 125% text. */
  private renderVisibility(): number {
    const listed = this.visibility === 'listed';
    const isHost = this.seat === this.hostSeat && !this.settingsLocked;
    const state = t(listed ? 'online.visibilityListed' : 'online.visibilityPrivate');
    const right = cx() + panelW(260) / 2 - 4;
    const badge = label(this, right, vy(54), isHost ? `${state} · ${t('online.visibilityChange')}` : state, 6, listed ? TEXT.success : TEXT.muted)
      .setOrigin(1, 0.5);
    // Ten grid units apart, not eight: at the large-text scale (1.25x) two size-6 lines eight
    // apart touch. The gap is the layout's, so it holds without the label knowing its own scale.
    const hint = label(this, right, vy(64), t(listed ? 'online.visibilityListedHint' : 'online.visibilityPrivateHint'), 6, TEXT.dim)
      .setOrigin(1, 0.5);
    const bottom = hint.y + hint.height / 2;
    if (!isHost) return bottom;
    badge
      .setInteractive(
        new Phaser.Geom.Rectangle(-14, -14, badge.width + 28, Math.max(badge.height + 20, 34)),
        Phaser.Geom.Rectangle.Contains,
      )
      .on('pointerup', () => {
        // Proposal only: the server decides and broadcasts, and the next room_state is the only
        // thing that moves `this.visibility`.
        this.fireOnce('visibility', 300, () => this.client.setVisibility(listed ? 'private' : 'listed'));
      });
    return bottom;
  }

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


  /** One structured event as a sentence. The server sends a kind and public facts; every word
   * here comes from the local dictionary, so a feed line can never be client-authored text. */
  private activityLine(e: ActivityEvent): string {
    const name = e.name ?? t('online.emptySeat');
    if (e.kind === 'reaction') {
      return t('online.activity.reaction', { name, reaction: e.reaction ? t(`online.reaction.${e.reaction}`) : '' });
    }
    return t(`online.activity.${e.kind}`, { name });
  }

  /**
   * Progressive disclosure for everything the room remembers: the session score, the matches it
   * has played, and what has happened lately. It lives on its own screen rather than in the lobby
   * because the lobby's job is "who is here and are we starting", and three more blocks there is
   * what makes a 360-wide phone unreadable.
   */
  private renderParty(): void {
    const portrait = view().portrait;
    label(this, cx(), vy(58), t('online.partyTitle'), 10, TEXT.primary);
    const rowW = Math.min(panelW(250), view().w - 30);
    const left = cx() - rowW / 2;

    // Session score first: it is the one number anyone came to this screen for.
    label(this, left + 2, vy(74), t('online.sessionScore'), 7, TEXT.accent).setOrigin(0, 0.5);
    const ranked = [...this.players].sort((a, b) => b.wins - a.wins || a.seat - b.seat);
    ranked.slice(0, MAX_SEATS).forEach((p, i) => {
      const y = vy(84 + i * 10);
      label(this, left + 6, y, p.name, 7, p.seat === this.seat ? TEXT.accent : TEXT.primary).setOrigin(0, 0.5);
      const wins = plural('online.wins', p.wins);
      label(this, left + rowW - 4, y, wins, 7, TEXT.muted).setOrigin(1, 0.5);
    });

    // Then the matches, newest first, bounded by what fits rather than by a scroll nobody can see.
    const matchesTop = 84 + ranked.length * 10 + 8;
    label(this, left + 2, vy(matchesTop), t('online.matches'), 7, TEXT.accent).setOrigin(0, 0.5);
    const matches = [...this.party.matches].reverse().slice(0, portrait ? 5 : 4);
    if (matches.length === 0) label(this, left + 6, vy(matchesTop + 10), t('online.noMatches'), 6, TEXT.dim).setOrigin(0, 0.5);
    matches.forEach((m, i) => {
      const key = m.stalemate ? 'online.matchLineStalemate' : 'online.matchLine';
      label(this, left + 6, vy(matchesTop + 10 + i * 9), t(key, { n: m.seq, name: m.winnerName ?? t('online.emptySeat') }), 6, TEXT.primary)
        .setOrigin(0, 0.5);
    });

    const activityTop = matchesTop + 10 + Math.max(1, matches.length) * 9 + 6;
    label(this, left + 2, vy(activityTop), t('online.activity'), 7, TEXT.accent).setOrigin(0, 0.5);
    const feed = [...this.party.activity].reverse().slice(0, portrait ? 8 : 5);
    if (feed.length === 0) label(this, left + 6, vy(activityTop + 10), t('online.noActivity'), 6, TEXT.dim).setOrigin(0, 0.5);
    feed.forEach((e, i) => {
      label(this, left + 6, vy(activityTop + 10 + i * 9), this.activityLine(e), 6, TEXT.muted).setOrigin(0, 0.5);
    });
  }

  /**
   * The lobby, laid out as a flow rather than at fixed y-coordinates.
   *
   * Every block used to be pinned (`vy(132 + seat * 13)` for the seats, `vy(180)` for the notice,
   * `vy(194)` for the reactions), which meant the layout only held at one text scale in one
   * locale: a summary that wrapped, a longer tap hint or 125% text pushed one block into the next
   * and something had to be hidden to make room. Now the informational half flows down from the
   * room code and the action half is anchored up from VOLTAR, so a block that grows moves what is
   * below it instead of overlapping it, and the space left over is spent on the gaps.
   *
   * Everything is measured in world units already scaled by the large-text setting, so the same
   * code holds at 100% and 125%.
   */
  private renderLobby(): void {
    const portrait = view().portrait;
    const scale = settings.fontScale();
    const box = (id: string, top: number, h: number): void => { this.lobbyBoxes.push({ id, top, h }); };
    // The visibility block is part of the column, not furniture floating above it: at 125% text
    // its second line reaches below vy(74) and the room code used to be drawn straight through it.
    const visTop = vy(54) - 6 * scale;
    const visBottom = this.renderVisibility();
    box('visibility', visTop, visBottom - visTop);

    // ---- action half: measured first, anchored to the bottom, because these are the controls the
    // screen exists for and they must never be the thing that gets pushed off it.
    const reactH = (portrait ? 18 : 14) * scale;
    const readyH = 20 * scale;
    const startH = (portrait ? 24 : 20) * scale;
    const backTop = (portrait ? vy(260) : vy(245)) - 12 * scale;
    const isHost = this.seat === this.hostSeat;
    const enoughPlayers = this.players.length >= 2;
    const notReady = this.players.filter((p) => !p.ready);
    const allReady = enoughPlayers && notReady.length === 0;
    const startReason = isHost && !allReady
      ? (!enoughPlayers
          ? t('online.startNeedPlayers')
          : t(this.betweenMatches() ? 'online.waitingRematch' : 'online.startNeedReadyNames', {
              names: notReady.map((p) => p.name).join(', '),
            }))
      : '';
    const reasonH = startReason ? this.measureText(startReason, 6, panelW(200)) + 3 : 0;
    // Portrait stacks START under READY; landscape seats it beside READY, so it costs no height.
    const stackedStartH = portrait && isHost ? startH + 4 : 0;

    // ---- informational half: flows down from the room code.
    const btnH = portrait ? 24 : 16;
    const top = Math.max(vy(74) - this.measureText(this.code ?? '', CODE_SIZE, view().w) / 2, visBottom + 2);

    const canShare = typeof navigator.share === 'function';
    // Three actions at most — copy, share, history — laid out as one evenly spaced strip rather
    // than at hand-tuned offsets, so the row stays inside the panel whether or not this browser
    // has a share sheet. The history button is the progressive-disclosure door to the room's
    // score, its matches and its feed; the lobby itself stays "who is here, are we starting".
    const actions: { key: string; run: () => void }[] = [
      { key: 'online.copy', run: () => this.copyCode() },
      ...(canShare ? [{ key: 'online.share', run: () => this.shareCode() }] : []),
      { key: 'online.partyOpen', run: () => { if (this.lobby.openParty()) this.rebuild(); } },
    ];
    const bw = actions.length > 2 ? 76 : 100;
    const bgap = 6;
    const total = actions.length * bw + (actions.length - 1) * bgap;

    // One spare seat row is drawn while the table is not full, so "someone else can still join" is
    // visible rather than implied. Counted from the highest OCCUPIED seat, never from
    // players.length: seats never move, so a room holding seats 0 and 3 has two players and four
    // rows. Sizing by length dropped the occupant of every seat above a gap off the screen
    // entirely (LB-04/05/06).
    const highestOccupied = this.players.reduce((max, p) => Math.max(max, p.seat), -1);
    let spare = this.players.length < MAX_SEATS ? 1 : 0;
    const seatRows = (): number => Math.min(MAX_SEATS, Math.max(highestOccupied + 1, this.players.length + spare));
    let seatCount = seatRows();
    const seatPitch = 13 * scale;

    const notice = this.lobbyNoticeText();
    const noticeH = notice ? this.measureText(notice.text, 6, panelW(240)) : 0;
    const summaryH = this.measureRoomSummary();

    // What the column costs before any of it is drawn, so the squeeze below is a decision and not
    // a discovery halfway down the screen.
    const gaps = 4; // code→actions, actions→summary, summary→seats, seats→notice
    const fixed = (): number => btnH + summaryH + seatCount * seatPitch + noticeH;

    // Nothing is hidden when the column is tight — three things give, in order of how little they
    // cost the player. First the gaps close, down to nothing (every block already carries its own
    // padding, so a closed gap reads as tight, not as broken). Then the room code, which is the
    // largest glyph on the screen by a wide margin, gives back the large-text bonus it does not
    // need in order to stay the biggest thing there — never below its 100% size. Only if that is
    // still not enough do the seat rows tighten, down to the height of the text in them. A
    // landscape phone at 125% text in English is the case that needs all three.
    let codeSize = CODE_SIZE;
    let pitch = seatPitch;
    // The reactions row is the one thing that may go, and only at the very end: four emotes are a
    // nicety, and the alternative at this size is a seat row or the START button leaving the
    // screen. Every player, every control and every word of explanation stays.
    let showReactions = true;
    const actionsH = (): number => (showReactions ? reactH + 6 : 0) + readyH + stackedStartH + reasonH;
    let actionTop = backTop - actionsH();
    let room = actionTop - top;
    const gap = Phaser.Math.Clamp((room - fixed() - this.measureText(this.code ?? '', codeSize, view().w)) / gaps, 0, 10 * scale);
    const over = (): number => fixed() + this.measureText(this.code ?? '', codeSize, view().w)
      + gaps * gap + seatCount * (SEAT_ROW_MIN_H - seatPitch) - room;
    if (over() > 0) {
      codeSize = Math.max(CODE_SIZE / scale, CODE_SIZE - over() / scale);
    }
    if (over() > 0) {
      showReactions = false;
      actionTop = backTop - actionsH();
      room = actionTop - top;
    }
    // Last of all, the spare chair. It is an affordance rather than information — an empty row
    // saying "someone can still join", whose INVITE is the same action as the COPY button already
    // at the top of this screen — so it is the only row that may go, and only once the emotes
    // already have. No occupied seat is ever dropped: those are the room.
    if (over() > 0 && spare > 0) {
      spare = 0;
      seatCount = seatRows();
    }

    const code = label(this, cx(), top + this.measureText(this.code ?? '', codeSize, view().w) / 2, this.code ?? '', codeSize, TEXT.primary);
    box('code', code.y - code.height / 2, code.height);
    let y = code.y + code.height / 2;

    y += gap;
    box('actions', y, btnH);
    actions.forEach((a, i) => {
      new PixelButton(this, cx() - total / 2 + bw / 2 + i * (bw + bgap), y + btnH / 2, t(a.key), a.run, {
        textureBase: 'btn-comprar', w: bw, h: btnH, size: 7,
      });
    });
    y += btnH + gap;

    const summaryTop = y;
    y = this.renderRoomSummary(y);
    box('summary', summaryTop, y - summaryTop);
    y += gap;

    // The seat pitch is decided here, against the space that is actually left rather than against
    // an estimate: everything above has been drawn and measured by now, so this is the one number
    // that can guarantee the rows never reach the action stack. It only ever shrinks — a room with
    // space keeps the authored 13-unit pitch.
    pitch = Phaser.Math.Clamp(
      (actionTop - y - noticeH - (notice ? gap : 0)) / seatCount,
      SEAT_ROW_MIN_H,
      seatPitch,
    );

    for (let seat = 0; seat < seatCount; seat++) {
      this.renderSeatRow(y + pitch / 2 + seat * pitch, this.players.find((p) => p.seat === seat) ?? null, seat);
      box(`seat${seat}`, y + seat * pitch, pitch);
    }
    y += seatCount * pitch + gap;

    if (notice) {
      this.add
        .text(cx(), y, notice.text, {
          ...fontStyle(6, notice.color), align: 'center', wordWrap: { width: panelW(240) },
        })
        .setOrigin(0.5, 0);
      box('notice', y, noticeH);
    }

    // ---- action half, placed.
    let a = actionTop;
    if (showReactions) {
      this.renderReactions(a + reactH / 2);
      box('reactions', a, reactH);
      a += reactH + 6;
    }

    // READY stays a real toggle: every click still sends exactly one `ready` message. The
    // short cooldown only blocks a second click before the first one's frame goes out.
    const readyBtn = new PixelButton(this, portrait || !isHost ? cx() : cx() - 8, a + readyH / 2, this.ready ? t('online.readyOn') : t('online.ready'), () => {
      this.fireOnce('ready', 300, () => {
        this.lobby.readySent();
        this.client.setReady(!this.ready);
      });
    }, { textureBase: 'btn-feito', w: 100, h: 20, size: 8, primary: true });
    readyBtn.setEnabled(!this.inFlight.has('ready'));
    box('ready', a, readyH);

    if (isHost) {
      // Landscape seats START beside READY; a 270-wide portrait world has no room beside anything,
      // so it stacks underneath instead of running off the right edge. Far enough from READY to
      // read as a separate button, near enough that its right edge stays inside the backdrop panel.
      const start = new PixelButton(
        this, portrait ? cx() : cx() + 95, portrait ? a + readyH + 4 + startH / 2 : a + readyH / 2,
        t('online.start'), () => this.fireOnce('start', 3000, () => this.client.startGame()),
        { textureBase: 'btn-feito', w: portrait ? 110 : 82, h: portrait ? 24 : 20, size: 7 },
      );
      start.setEnabled(allReady && !this.inFlight.has('start'));
      // Only portrait gives START a row of its own; in landscape it sits beside READY and is
      // already covered by that row's box. Recording it separately there would describe two
      // blocks at the same height as an overlap.
      if (portrait) box('start', a + readyH + 4, startH);
    }
    a += readyH + stackedStartH;

    // ONLINE-06: a greyed-out button with no stated reason is the single most common lobby
    // complaint, and "someone isn't ready" is barely better — name the seats being waited on.
    // Centred on the panel, not under START: wrapped at 200 it would run off the panel's right
    // edge from an off-centre anchor.
    if (startReason) {
      this.add
        .text(cx(), a + 3, startReason, {
          ...fontStyle(6, TEXT.muted), align: 'center', wordWrap: { width: panelW(200) },
        })
        .setOrigin(0.5, 0);
      box('startReason', a + 3, reasonH);
    }
  }

  /**
   * The one line above the reactions row, and what it is about: a refusal, a terms change, a
   * rematch invitation or somebody's emote. Only one is ever shown — they are all "the newest
   * thing that happened" — and picking it here lets the layout ask for its height before drawing.
   */
  private lobbyNoticeText(): { text: string; color: string } | null {
    if (this.lobbyNotice) return { text: this.lobbyNotice, color: TEXT.warning };
    if (this.settingsChangedNotice) return { text: t('online.settingsChanged'), color: TEXT.accent };
    if (this.rematch) return { text: t('online.rematch'), color: TEXT.accent };
    if (this.lastReaction) {
      return {
        text: t('online.reactionFrom', {
          name: this.seatName(this.lastReaction.seat),
          reaction: t(`online.reaction.${this.lastReaction.reaction}`),
        }),
        color: TEXT.accent,
      };
    }
    return null;
  }

  /** Height a wrapped block of copy will take, measured with the real font and the real scale —
   * the layout above needs it before it decides where anything goes. */
  private measureText(text: string, size: number, wrap: number): number {
    const probe = this.add.text(0, 0, text, { ...fontStyle(size), align: 'center', wordWrap: { width: wrap } });
    const h = probe.height;
    probe.destroy();
    return h;
  }

  /** How tall renderRoomSummary will be: the wrapped terms line, plus the host's hint/link row,
   * plus a second row when the hint and AJUSTAR cannot share one. */
  private measureRoomSummary(): number {
    const s = this.roomSettings;
    const text = s.turnMs <= 0
      ? t('online.summaryNoTimer', { grace: Math.round(s.reconnectGraceMs / 1000) })
      : t('online.roomSummary', {
          timer: t(`online.timer.${s.timerMode}`),
          turn: Math.round(s.turnMs / 1000),
          bonus: Math.round(s.mexeBonusMs / 1000),
          grace: Math.round(s.reconnectGraceMs / 1000),
        });
    const lineH = this.measureText(text, 7, panelW(250));
    if (!(this.seat === this.hostSeat && !this.settingsLocked)) return lineH;
    const hintW = this.measureWidth(t('online.timerTapHint'), 6);
    const linkLeft = panelW(240) / 2 - 26 - this.measureWidth(t('online.customize'), 6) / 2;
    const rowH = this.measureText(t('online.timerTapHint'), 6, panelW(240));
    return lineH + 6 + rowH * (hintW / 2 + 4 > linkLeft ? 2 : 1);
  }

  /** Rendered width of one short label — the hint/link collision test needs it before either
   * exists. */
  private measureWidth(text: string, size: number): number {
    const probe = this.add.text(0, 0, text, fontStyle(size));
    const w = probe.width;
    probe.destroy();
    return w;
  }
}
