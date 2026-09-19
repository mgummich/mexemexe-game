import { t } from '../localization/i18n';
import { errorMessage } from './errors';
import {
  DEFAULT_QUEUE_TARGET, DEFAULT_ROOM_SETTINGS, DEFAULT_ROOM_VISIBILITY, EMPTY_PARTY,
  type ErrorMsg, type PartyState, type QueueStateMsg, type QueueTarget, type ReactionId,
  type RoomJoinedMsg, type RoomListing, type RoomListMsg, type RoomPlayerSummary, type RoomSettings,
  type RoomStateMsg, type RoomVisibility,
} from './protocol';

/**
 * The screens of the online flow. One value, always: every screen is mutually exclusive, and the
 * combinations that a pile of booleans would allow (in a room *and* on the error screen, queued
 * *and* browsing) do not exist.
 */
export type LobbyPhase =
  | 'idle' | 'join' | 'name' | 'lobby' | 'custom' | 'party' | 'browse' | 'queue' | 'matched' | 'error';

/** Something the caller must do in the world. The machine decides *that* it happens; the scene,
 * which owns the socket, the clock and local storage, decides how. */
export type LobbyEffect =
  | { type: 'connect' }
  | { type: 'requestResync' }
  | { type: 'join'; code: string }
  /** Local display history only — the code and the host's name, never the reconnect token. */
  | { type: 'rememberRoom'; code: string; host: string }
  | { type: 'forgetRoom'; code: string }
  /** Retire `text` from the lobby after the usual beat, unless a newer line replaced it first. */
  | { type: 'expireLobbyNotice'; text: string }
  | { type: 'expireReaction'; seat: number }
  /** The search just started — the caller owns the cosmetic elapsed counter's zero point. */
  | { type: 'queueEntered' }
  | { type: 'cancelQueue' };

/** Refusals that mean "this card described a room that has since moved on", as opposed to
 * something wrong with the player or the connection. All four are ordinary traffic for a list
 * built from a snapshot, so they are answered on the browser instead of on the error screen. */
const STALE_LISTING_CODES: readonly string[] = ['room_not_found', 'room_closed', 'room_full', 'game_started'];
/** Refusals the lobby answers in place. Each one says something about the room's current state
 * that the player can act on from the lobby they are already looking at — unlike `room_closed` or
 * `invalid_token`, which mean the seat itself is gone and the error screen is the honest answer. */
const LOBBY_NOTICE_CODES: readonly string[] = ['not_ready', 'not_host', 'game_started', 'rate_limited', 'room_full'];

/**
 * The lobby's application state and every legal transition over it (ARCH-003).
 *
 * Before this existed, `phase` was one string field written from ~25 Phaser handlers, so no single
 * place said which transitions exist. Here each input is a named method: it takes the server
 * message (or the player's intent), moves the state, and returns the effects the caller must
 * perform. It holds no Phaser, no socket, no DOM and no clock, so the whole flow — join, ready,
 * start, disconnect, matchmaking, discovery, refusal recovery, rematch — is testable directly.
 *
 * It is authoritative about *this client's screen*, never about the room: every room field here is
 * a mirror of the server's last word, written only by a server message.
 */
export class LobbyMachine {
  phase: LobbyPhase = 'idle';
  code: string | null = null;
  seat: number | null = null;
  players: RoomPlayerSummary[] = [];
  roomSettings: RoomSettings = DEFAULT_ROOM_SETTINGS;
  hostSeat = 0;
  party: PartyState = EMPTY_PARTY;
  visibility: RoomVisibility = DEFAULT_ROOM_VISIBILITY;
  settingsLocked = false;
  errorMsg: string | null = null;
  /** The current 'error' phase was entered because the device is offline, not because the server
   * refused anything — a regained connection drops back to 'idle' instead of staying stuck. */
  offlineError = false;
  /** Entered from a finished match (ONLINE-23): same room, same code, everyone back to not-ready. */
  rematch = false;
  /** ON-09: the host changed the room's terms, so the server cleared every ready bit. */
  settingsChangedNotice = false;
  /** A refusal about the room's current state, answered on the lobby instead of costing it. */
  lobbyNotice: string | null = null;
  lastReaction: { seat: number; reaction: ReactionId } | null = null;
  listings: RoomListing[] = [];
  browseState: 'loading' | 'ready' | 'failed' = 'loading';
  browseNotice: string | null = null;
  /** Code of the join currently in flight, so a refusal can retire a dead recent-room entry. */
  pendingJoinCode: string | null = null;
  queueTarget: QueueTarget = DEFAULT_QUEUE_TARGET;
  /** How the last search ended (cancelled, expired), shown on the online home. */
  queueNotice: string | null = null;
  matchPlayers = 0;
  /** ON-05: the last name submission had too few visible characters to be a name. */
  nameError = false;
  /** Screen the name editor was opened from, so committing returns to the code being entered. */
  nameReturn: 'idle' | 'join' = 'idle';
  /** Room code taken from a share link (`?room=`), joined once the socket opens. */
  autoJoinCode: string | null = null;
  /**
   * Lobby actions currently in flight — a button whose key is here stays disabled so a
   * double-click cannot send a second create_room/join_room/start_game before the first resolves.
   * Released by the caller's cooldown or by a server answer that names the action, never by a
   * success push: that push can land between a double-click's two clicks.
   */
  readonly inFlight = new Set<string>();

  /** Our own seat's ready bit, exactly as the server last reported it. Never a local mirror. */
  get ready(): boolean {
    return this.players.find((p) => p.seat === this.seat)?.ready ?? false;
  }

  /** Entry into the scene: resumed from a finished match, blocked by being offline, or a fresh visit. */
  start(opts: { resume: { code: string; seat: number } | null; offline: boolean; socketOpen: boolean; linkedCode: string | null }): LobbyEffect[] {
    this.autoJoinCode = opts.linkedCode;
    if (opts.resume) {
      // The room is already ours; the server's answer to `resync` is what repopulates the seats.
      this.code = opts.resume.code;
      this.seat = opts.resume.seat;
      this.phase = 'lobby';
      this.rematch = true;
      return [opts.socketOpen ? { type: 'requestResync' } : { type: 'connect' }];
    }
    if (opts.offline) {
      // Skip the connect attempt entirely — a clear "you're offline" beats a connection timeout.
      this.offlineError = true;
      this.phase = 'error';
      this.errorMsg = t('offline.online');
      return [];
    }
    return [{ type: 'connect' }];
  }

  /** Connection status changed. `reason` distinguishes "never opened at all" from a mid-session drop. */
  status(status: string, reason?: string): LobbyEffect[] {
    const effects: LobbyEffect[] = [];
    // The shared link's code is only useful once there is a socket to send it on.
    if (status === 'open' && this.autoJoinCode !== null && this.phase === 'idle' && this.code === null) {
      effects.push({ type: 'join', code: this.autoJoinCode });
      this.autoJoinCode = null;
    }
    if (status === 'error' && reason === 'unreachable') {
      this.errorMsg = t('online.err.unreachable');
      this.phase = 'error';
    }
    return effects;
  }

  /** Connectivity came back while the offline error screen was showing. */
  connectivityRestored(): LobbyEffect[] {
    if (!this.offlineError) return [];
    this.offlineError = false;
    this.phase = 'idle';
    // We entered offline and skipped connect() entirely, so the socket was never opened —
    // establish it now. The player still has to press CRIAR SALA / ENTRAR.
    return [{ type: 'connect' }];
  }

  /** Seated. A matchmade room arrives this way too, mid-handoff — that beat is not clobbered. */
  roomJoined(msg: RoomJoinedMsg): LobbyEffect[] {
    this.code = msg.code;
    this.seat = msg.seat;
    this.players = msg.players;
    this.roomSettings = msg.settings;
    this.hostSeat = msg.hostSeat;
    this.party = msg.party;
    this.visibility = msg.visibility;
    // A room you have just joined cannot have a match running — the server refuses a join to one
    // (`game_started`) — so its terms are open. Carrying the previous room's frozen flag in left
    // the host of a brand-new room unable to open their own terms screen, after an error screen
    // and a retry put a second room in the same machine.
    this.settingsLocked = false;
    this.settingsChangedNotice = false;
    if (this.phase !== 'matched') this.phase = 'lobby';
    this.pendingJoinCode = null;
    return [{ type: 'rememberRoom', code: msg.code, host: msg.players.find((p) => p.seat === msg.hostSeat)?.name ?? '' }];
  }

  /** The room changed. The only writer of ready bits, host, terms, party and visibility. */
  roomState(msg: RoomStateMsg): LobbyEffect[] {
    this.inFlight.delete('ready');
    // Read the "why" off the server's own transition (ready -> not ready) rather than a local
    // flag; the match->lobby recycle clears the same bit and is not a settings change.
    const recycled = this.settingsLocked && !msg.locked;
    const wasReady = this.ready;
    const nowReady = msg.players.find((p) => p.seat === this.seat)?.ready ?? false;
    if (wasReady && !nowReady && !recycled) this.settingsChangedNotice = true;
    this.players = msg.players;
    this.roomSettings = msg.settings;
    this.hostSeat = msg.hostSeat;
    this.party = msg.party;
    this.visibility = msg.visibility;
    this.settingsLocked = msg.locked;
    return [];
  }

  reaction(msg: { seat: number; reaction: ReactionId }): LobbyEffect[] {
    this.lastReaction = { seat: msg.seat, reaction: msg.reaction };
    return [{ type: 'expireReaction', seat: msg.seat }];
  }

  /** Retire a reaction line, unless a newer one from another seat replaced it. */
  expireReaction(seat: number): boolean {
    if (this.lastReaction?.seat !== seat) return false;
    this.lastReaction = null;
    return true;
  }

  /**
   * The only writer of this client's queue state. Every transition is the server's word: a cancel
   * that lost to a match arrives here as `matched`, a resumed phone as `queued`, and nothing on
   * this screen infers a state it was not told.
   */
  queueState(msg: QueueStateMsg): LobbyEffect[] {
    this.inFlight.delete('queue');
    this.queueTarget = msg.target;
    if (msg.status === 'queued') {
      const entering = this.phase !== 'queue';
      this.phase = 'queue';
      this.queueNotice = null;
      return entering ? [{ type: 'queueEntered' }] : [];
    }
    if (msg.status === 'matched') {
      this.matchPlayers = msg.players ?? 0;
      this.phase = 'matched';
    } else if (msg.status === 'expired') {
      this.phase = 'idle';
      this.queueNotice = t('online.queueExpired');
    } else if (this.phase === 'queue') {
      this.phase = 'idle';
      this.queueNotice = t('online.queueCancelled');
    }
    return [];
  }

  roomList(msg: RoomListMsg): LobbyEffect[] {
    this.listings = msg.rooms;
    this.browseState = 'ready';
    return [];
  }

  /**
   * A server refusal. Where it is answered depends on what it says about the player's place:
   * a listing that moved on is answered on the browser, a room-state refusal on the lobby itself,
   * a dead shortcut on the entry screen, and only "your seat is gone" costs the whole screen.
   */
  serverError(msg: Pick<ErrorMsg, 'code'>): LobbyEffect[] {
    // Any in-flight lobby action just got its answer (rejection) — unblock its button.
    this.inFlight.clear();
    const failedCode = this.pendingJoinCode;
    this.pendingJoinCode = null;
    const effects: LobbyEffect[] = [];
    if (failedCode && (msg.code === 'room_not_found' || msg.code === 'room_closed')) {
      // The server's refusal is the only reliable evidence a room is dead; re-offering it would
      // send the player down the same hole.
      effects.push({ type: 'forgetRoom', code: failedCode });
      if (this.phase === 'idle') {
        this.queueNotice = errorMessage(msg.code);
        return effects;
      }
    }
    // Discovery is additive: a refused room list must not throw the player off a screen from
    // which create/join-by-code still work. It degrades in place instead.
    if (this.phase === 'browse' && failedCode === null) {
      this.browseState = 'failed';
      return effects;
    }
    if (this.phase === 'browse' && failedCode !== null && STALE_LISTING_CODES.includes(msg.code)) {
      this.listings = this.listings.filter((r) => r.code !== failedCode);
      // "Check the code and try again" is the right sentence for a typed code and the wrong one
      // for a tapped card — nobody typed anything. A vanished room gets its own line.
      this.browseNotice =
        msg.code === 'room_full' || msg.code === 'game_started' ? errorMessage(msg.code) : t('online.browseGone');
      return effects;
    }
    if (this.phase === 'lobby' && LOBBY_NOTICE_CODES.includes(msg.code)) {
      this.lobbyNotice = errorMessage(msg.code);
      effects.push({ type: 'expireLobbyNotice', text: this.lobbyNotice });
      return effects;
    }
    // Player sees a translated, actionable sentence — never the raw dev-facing message or code.
    this.errorMsg = errorMessage(msg.code);
    this.phase = 'error';
    // Reaching here means the seat itself is gone, so nothing about that room is true any more.
    // The machine outlives it — RETRY leads back to a second room in the same instance — and a
    // line about the old room, or its rematch framing, would be rendered over the new one.
    this.lobbyNotice = null;
    this.lastReaction = null;
    this.rematch = false;
    return effects;
  }

  /** Retire a lobby notice, unless a newer refusal already replaced it. */
  expireLobbyNotice(text: string): boolean {
    if (this.lobbyNotice !== text) return false;
    this.lobbyNotice = null;
    return true;
  }

  // ---------- player intents ----------

  /** A join is on its way to the server, from whichever entrance. */
  joinStarted(code: string): void {
    this.pendingJoinCode = code;
  }

  openJoin(): void {
    this.phase = 'join';
  }

  openBrowse(): boolean {
    if (this.phase !== 'idle') return false;
    this.phase = 'browse';
    this.browseState = 'loading';
    this.browseNotice = null;
    return true;
  }

  openParty(): boolean {
    if (this.phase !== 'lobby' || this.code === null) return false;
    this.phase = 'party';
    return true;
  }

  /** Only the host can propose terms, and only before the match freezes them. */
  get isHost(): boolean {
    return this.seat !== null && this.seat === this.hostSeat;
  }

  openCustom(): boolean {
    if (this.phase !== 'lobby' || this.code === null || !this.isHost || this.settingsLocked) return false;
    this.phase = 'custom';
    return true;
  }

  /** The custom screen closed — applied or cancelled, both land back on the lobby. */
  closeCustom(): void {
    this.phase = 'lobby';
  }

  openName(from: 'idle' | 'join'): void {
    this.nameReturn = from;
    this.nameError = false;
    this.phase = 'name';
  }

  /** ON-05: a name with fewer than the minimum visible characters is refused on the spot — silently
   * keeping the old one looks like the button did nothing. Returns whether it was accepted. */
  commitName(name: string, minLength: number): boolean {
    if (name.length < minLength) {
      this.nameError = true;
      return false;
    }
    this.nameError = false;
    this.phase = this.nameReturn;
    return true;
  }

  /** The player readied up, so every explanation on this lobby has been seen and acted on. */
  readySent(): void {
    this.settingsChangedNotice = false;
    this.rematch = false;
    this.lobbyNotice = null;
  }

  /** A fresh listing request is on its way. */
  browseLoading(): void {
    this.browseState = 'loading';
    this.browseNotice = null;
  }

  /** Discovery is unavailable (offline, or the server refused the list). */
  browseFailed(): void {
    this.browseState = 'failed';
  }

  /** Escape from the code screen. */
  escapeToIdle(): void {
    this.phase = 'idle';
  }

  /**
   * VOLTAR. On a sub-screen it means "back one screen" (and, from the search, cancel it); on a
   * room screen it means leaving the room, which the caller performs.
   */
  back(): { leavesRoom: boolean; effects: LobbyEffect[] } {
    const isSubScreen = this.phase === 'custom' || this.phase === 'party' || this.phase === 'browse'
      || this.phase === 'queue' || this.phase === 'name';
    if (!isSubScreen) return { leavesRoom: true, effects: [] };
    const effects: LobbyEffect[] = [];
    // Backing out of a search *is* cancelling it: leaving the entry behind would keep the player
    // matchable from a screen that no longer says they are searching.
    if (this.phase === 'queue') effects.push({ type: 'cancelQueue' });
    this.phase = this.phase === 'name' ? this.nameReturn
      : this.phase === 'browse' || this.phase === 'queue' ? 'idle' : 'lobby';
    return { leavesRoom: false, effects };
  }

  /** RETRY on the error screen: the same connect path a fresh visit uses. */
  retry(): LobbyEffect[] {
    this.errorMsg = null;
    this.offlineError = false;
    this.phase = 'idle';
    return [{ type: 'connect' }];
  }

  /** A search is being started from this screen. */
  queueRequested(target: QueueTarget): void {
    this.queueTarget = target;
    this.queueNotice = null;
  }
}
