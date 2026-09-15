/**
 * Thin WebSocket client for online play. Never throws into the game: every
 * socket failure surfaces as a status change plus an optional message, never
 * an exception the caller has to catch.
 */
import { playlog } from '../core/playlog';
import { onConnectivityChange } from '../core/pwa';
import { resolveWsUrl } from '../config';
import { PROTOCOL_VERSION } from './protocol';
import type { ClientMessage, ReactionId, RoomSettings, RoomStateMsg, RoomVisibility, ServerMessage, SubmitTurnMeld } from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed' | 'error' | 'reconnecting';

const TOKEN_KEY = 'mexe.online.token';
/** localStorage (not sessionStorage): a display name is meant to survive the tab, the reconnect
 * token deliberately is not. */
const NAME_KEY = 'mexe.online.name';
/** Long enough for a real nickname, short enough to fit a seat row — and the server trims to 64
 * regardless, so this is presentation, not a trust boundary. */
export const MAX_NAME_LENGTH = 12;
/** Fewest visible characters a display name may have. One character is an initial, not a name,
 * and the seat badge already shows that initial — so a one-character name adds nothing and reads
 * as a mistake to the rest of the room. */
export const MIN_NAME_LENGTH = 2;
const PING_INTERVAL_MS = 20_000;
const TRACE_CAP = 80;
const STATUS_TRACE_CAP = 40;
/**
 * Bounded auto-reconnect schedule: the delay before attempt N after an unexpected close. A real
 * mobile drop (Wi-Fi handover, tunnel, screen lock) routinely outlasts one retry, and the server
 * holds the seat for the room's reconnect grace — 30s or 60s under every preset — so the schedule
 * spans that window (~63s total) and then gives up rather than retrying forever.
 */
const RECONNECT_DELAYS_MS = [800, 2000, 4000, 8000, 12_000, 16_000, 20_000];
/** Fraction of each delay added at random, so N clients dropped by one event do not all retry on
 * the same millisecond. Never subtracted: a delay must not shrink below its schedule slot. */
const RECONNECT_JITTER = 0.25;

type ServerListener = (msg: ServerMessage) => void;

/** sessionStorage throws in Safari with site data blocked/webviews with storage disabled —
 * these keep a throw from aborting the socket callback it's called inside of. */
function readToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage blocked — reconnect just won't be possible, not fatal
  }
}

function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

/** The name this device plays under online, or null if the player never set one. Stored locally
 * only — it is sent with create_room/join_room like any other name and the server sanitizes it. */
export function readDisplayName(): string | null {
  try {
    return localStorage.getItem(NAME_KEY);
  } catch {
    return null;
  }
}

export function writeDisplayName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.slice(0, MAX_NAME_LENGTH));
  } catch {
    // storage blocked — the name just won't survive a reload
  }
}

// ---------------------------------------------------------------------------
// Recent rooms (local display history)
// ---------------------------------------------------------------------------

/** Deliberately a *different* storage key, a different storage area and a different shape from
 * the reconnect token: this list is display history the player is meant to see, and the token is
 * a credential. Nothing that can reclaim a seat is representable in a `RecentRoom`. */
const RECENT_KEY = 'mexe.online.recent';

/** Short list on purpose. The point is "the room we were just in", not an account history — six
 * stale codes would cost a player more reading than typing five characters would. */
export const MAX_RECENT_ROOMS = 5;

/**
 * How long an entry is worth showing. Rooms die far sooner than this (the server's idle backstop
 * is minutes), so this is not a liveness claim — it is the point past which offering the room is
 * more likely to be a dead end than a shortcut. A surviving-but-dead entry is still handled the
 * only way it can be: the join is tried and the server says no.
 */
const RECENT_TTL_MS = 6 * 60 * 60 * 1000;

export interface RecentRoom {
  /** Public room code. A locator, never a credential — see RoomListing in protocol.ts. */
  code: string;
  /** Host display name when we were last there, purely so the entry reads as a place. */
  host: string;
  /** Epoch ms of the last visit, for ordering and ageing out. */
  at: number;
}

/** Persisted data is a trust boundary: anything unparseable, wrong-shaped or expired is dropped
 * rather than repaired, so a corrupt key can never become a join attempt on garbage. */
export function readRecentRooms(now = Date.now()): RecentRoom[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RECENT_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RecentRoom[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.code !== 'string' || typeof o.at !== 'number') continue;
    const code = o.code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    if (code.length === 0 || now - o.at > RECENT_TTL_MS) continue;
    if (out.some((r) => r.code === code)) continue;
    out.push({ code, host: typeof o.host === 'string' ? o.host.slice(0, MAX_NAME_LENGTH) : '', at: o.at });
    if (out.length >= MAX_RECENT_ROOMS) break;
  }
  return out.sort((a, b) => b.at - a.at);
}

function writeRecentRooms(rooms: RecentRoom[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(rooms.slice(0, MAX_RECENT_ROOMS)));
  } catch {
    // storage blocked — the list just won't survive a reload
  }
}

/** Record (or refresh) a room we actually got into. Most recent first, deduped by code. */
export function rememberRoom(code: string, host: string, now = Date.now()): void {
  const kept = readRecentRooms(now).filter((r) => r.code !== code);
  writeRecentRooms([{ code, host: host.slice(0, MAX_NAME_LENGTH), at: now }, ...kept]);
}

/** Drop an entry the server has just told us is gone, so a dead room stops being offered. */
export function forgetRoom(code: string, now = Date.now()): void {
  writeRecentRooms(readRecentRooms(now).filter((r) => r.code !== code));
}

export class NetClient {
  private ws: WebSocket | null = null;
  private reqCounter = 0;
  private status: ConnStatus = 'closed';
  private lastStatusMessage: string | undefined;
  private statusListeners = new Set<(s: ConnStatus, message?: string) => void>();
  private listeners = new Map<string, Set<ServerListener>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Set by disconnect()/leaveRoom() so onclose knows not to retry a deliberate close. */
  private explicitClose = false;
  /** How many reconnect attempts this drop has already spent. Indexes RECONNECT_DELAYS_MS; reset
   * on every successful open, so a later drop gets the full schedule again. */
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Unsubscribe for the online/offline listeners. One per client, ever — a re-`connect()` (or an
   * orientation change that re-renders the scene) must not stack a second pair. */
  private connectivityUnsub: (() => void) | null = null;

  /** Bounded trace of every message sent/received, newest last — for e2e/debug-api. */
  trace: { dir: 'out' | 'in'; type: string }[] = [];
  /** Bounded history of every status this client has been in, newest last — for e2e/debug-api.
   * `status()` alone cannot prove a *transient* state happened: 'reconnecting' only lasts
   * the first backoff delay plus one connect round-trip, so a verification step that samples it
   * after any other unbounded await (a screenshot, a wait on the other client) can arrive once it is
   * already back to 'open'. That raced on CI. Asserting against this history instead is
   * order-independent. */
  statusTrace: ConnStatus[] = [];
  /** The most recent `room_state`, or null before the first one. Read by scenes that need the
   * party state (seats, session wins, history, activity) without owning a subscription from
   * before it arrived — see the assignment in `connect()` for why. */
  lastRoomState: RoomStateMsg | null = null;

  getStatus(): ConnStatus {
    return this.status;
  }

  onStatus(cb: (s: ConnStatus, message?: string) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Register for one server message type. Returns an unsubscribe function. */
  on<K extends ServerMessage['type']>(
    type: K,
    cb: (msg: Extract<ServerMessage, { type: K }>) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const listener = cb as ServerListener;
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** @param isRetry internal — true when this call is one of the bounded reconnect attempts, so
   * it keeps the 'reconnecting' status instead of flashing back to 'connecting'. */
  connect(isRetry = false): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.explicitClose = false;
    this.clearReconnectTimer();
    this.wireConnectivity();
    if (!isRetry) this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(resolveWsUrl());
    } catch (err) {
      this.setStatus('error', String(err));
      return;
    }
    // A CLOSING socket can fire after its replacement is live. Detach its callbacks so it
    // cannot stop the new ping loop or overwrite the current connection status.
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (isRetry) playlog.record('net:reconnect');
      this.reconnectAttempt = 0;
      this.setStatus('open');
      this.startPing();
      const token = readToken();
      if (token) this.sendRaw({ v: PROTOCOL_VERSION, type: 'reconnect', reqId: this.nextReqId(), token });
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      // Only a socket that actually opened counts as a disconnect — a refused connection is a
      // never-reachable server (handled below), and counting it would inflate the drop metric.
      if (this.status !== 'connecting') playlog.record('net:disconnect');
      this.stopPing();
      // Never got past 'connecting': the socket never opened at all (server not running/refused),
      // not a mid-session drop. Distinct terminal status so the scene can show dedicated copy
      // instead of the generic dropped-connection message.
      if (this.status === 'connecting') {
        this.setStatus('error', 'unreachable');
        return;
      }
      if (!this.explicitClose && readToken() && this.scheduleReconnect()) return;
      this.setStatus('closed');
    };
    ws.onerror = () => {
      if (this.ws !== ws) return;
      // No status change here — onclose fires right after and owns the retry-vs-terminal
      // decision. Setting 'error' here first would race a still-pending reconnect.
      this.lastStatusMessage = 'connection error';
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return; // malformed frame from the server — ignore, never throw
      }
      this.pushTrace('in', msg.type);
      if (msg.type === 'room_joined') writeToken(msg.token);
      // Latched so a scene that starts *after* a push can still read it. The room_state carrying
      // the session score arrives in the same server tick as game_over, i.e. a frame before
      // WinScene exists — without this latch the result screen would have to wait for the next
      // broadcast to show the score of the match it is announcing.
      if (msg.type === 'room_state') this.lastRoomState = msg;
      // `invalid_token`/`room_closed` are definitive: the session or the room is gone, so no
      // number of further attempts can restore the seat. Keeping the token would make every
      // later entry into the online lobby re-send it, fail the same way and land on the same
      // error screen; keeping the loop alive would do the same without even being asked.
      if (msg.type === 'error' && (msg.code === 'invalid_token' || msg.code === 'room_closed')) {
        clearToken();
        this.clearReconnectTimer();
        this.reconnectAttempt = RECONNECT_DELAYS_MS.length;
      }
      if (msg.type === 'proposal_rejected') playlog.record('net:reject', { reason: msg.reasons[0] ?? '' });
      const set = this.listeners.get(msg.type);
      if (set) for (const cb of set) cb(msg);
    };
  }

  /** Explicit exit from the online flow: tells the server, drops the reconnect token, closes the socket. */
  leaveRoom(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'leave_room', reqId: this.nextReqId() });
    clearToken();
    this.disconnect();
  }

  /** Verification-only: closes the underlying socket as if the network died — unlike disconnect()/
   * leaveRoom() this leaves explicitClose false and the reconnect token in place, so onclose runs
   * the normal bounded reconnect loop. Used by verify:multiplayer to exercise reconnect. */
  forceDrop(): void {
    this.ws?.close();
  }

  /** How many reconnect attempts are still available for the current drop. 0 means the loop has
   * given up (or never started). Observability for the reconnect tests, which otherwise could
   * only infer the budget from socket counts. */
  reconnectAttemptsLeft(): number {
    return Math.max(0, RECONNECT_DELAYS_MS.length - this.reconnectAttempt);
  }

  /**
   * Queue the next bounded reconnect attempt. Returns false when the schedule is exhausted, which
   * is the caller's signal to go terminal. Parks instead of retrying while the browser reports no
   * network: a retry with the radio off would spend an attempt on a guaranteed failure, and the
   * `online` event (see wireConnectivity) resumes the loop the moment the radio is back.
   */
  private scheduleReconnect(): boolean {
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) return false;
    this.setStatus('reconnecting');
    // Parked, not scheduled: the `online` event resumes the loop (see wireConnectivity).
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const base = RECONNECT_DELAYS_MS[this.reconnectAttempt]!;
    this.reconnectAttempt += 1;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(true);
    }, base + Math.random() * base * RECONNECT_JITTER);
    return true;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /**
   * Wi-Fi to mobile data, a tunnel, airplane mode: the socket usually dies without any event the
   * page can act on, and the browser's `online` event is the earliest reliable signal that a
   * retry can succeed. Subscribed once per client — a re-`connect()`, a scene rebuild or an
   * orientation change must not stack a second pair of listeners.
   */
  private wireConnectivity(): void {
    if (this.connectivityUnsub || typeof window === 'undefined') return;
    this.connectivityUnsub = onConnectivityChange((offline) => {
      if (offline) {
        // Do not close the socket: the OS may hand it back intact on a short interruption, and a
        // close we caused ourselves would spend an attempt for nothing.
        this.clearReconnectTimer();
        return;
      }
      // Network is back: retry now instead of sitting out the rest of a backoff delay that was
      // measured against a network that no longer exists.
      this.retryNow();
    });
  }

  /**
   * Try the next reconnect attempt immediately instead of waiting out the current backoff delay.
   * For the two moments that are better evidence than a timer: the browser reporting the network
   * back, and the app returning to the foreground with a socket that may have died while
   * suspended. Still spends an attempt, so a player who backgrounds and resumes repeatedly cannot
   * turn a bounded loop into an unbounded one. No-op when connected, deliberately closed, without
   * a session token, or once the schedule is exhausted.
   */
  retryNow(): void {
    if (this.explicitClose || !readToken()) return;
    if (this.status === 'open' || this.status === 'connecting') return;
    if (this.reconnectAttempt >= RECONNECT_DELAYS_MS.length) return;
    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    this.setStatus('reconnecting');
    this.connect(true);
  }

  /** Closes the socket without touching the reconnect token — used when the scene just tears down. */
  disconnect(): void {
    this.explicitClose = true;
    this.connectivityUnsub?.();
    this.connectivityUnsub = null;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore — socket may already be closing
      }
      this.ws = null;
    }
    this.setStatus('closed');
  }

  createRoom(name: string): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'create_room', reqId: this.nextReqId(), name });
  }

  joinRoom(code: string, name: string): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'join_room', reqId: this.nextReqId(), code, name });
  }

  setReady(ready: boolean): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'ready', reqId: this.nextReqId(), ready });
  }

  /** Host-only lobby proposal. The server normalizes, applies and broadcasts — nothing is
   * applied locally, so a non-host or a mid-match send simply comes back as an error. */
  setRoomSettings(settings: RoomSettings): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'set_room_settings', reqId: this.nextReqId(), settings });
  }

  /** Host-only lobby proposal for who can find this room. Same shape as setRoomSettings: the
   * server decides, broadcasts, and a non-host or mid-match send comes back as an error. */
  setVisibility(visibility: RoomVisibility): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'set_room_visibility', reqId: this.nextReqId(), visibility });
  }

  /** Ask for the currently discoverable rooms. Answered with one bounded `room_list`. */
  listRooms(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'list_rooms', reqId: this.nextReqId() });
  }

  /** Claim this turn's one-off Mexe extension. Safe to call more than once: the server grants it
   * at most once per turn and answers a repeat with nothing. */
  mexeStarted(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'mexe_started', reqId: this.nextReqId() });
  }

  startGame(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'start_game', reqId: this.nextReqId() });
  }

  /** Returns the reqId used, so a caller could correlate a later rejection if it ever needs to,
   * or null when the socket was not open and the proposal never went out. */
  submitTurn(rev: number, melds: SubmitTurnMeld[]): string | null {
    const reqId = this.nextReqId();
    return this.sendRaw({ v: PROTOCOL_VERSION, type: 'submit_turn', reqId, rev, melds }) ? reqId : null;
  }

  /** Null when the socket was not open — same contract as `submitTurn`. */
  drawEndTurn(rev: number): string | null {
    const reqId = this.nextReqId();
    return this.sendRaw({ v: PROTOCOL_VERSION, type: 'draw_end_turn', reqId, rev }) ? reqId : null;
  }

  /** Send one preset reaction to the room. The server owns the cooldown and silently drops
   * anything sent too soon, so a caller never has to handle a refusal. */
  sendReaction(reaction: ReactionId): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'reaction', reqId: this.nextReqId(), reaction });
  }

  /** Ask the server to re-send authoritative state. Used when the local reconstruction's hash
   * disagrees with the server's, or after a stale-revision rejection. */
  requestResync(): void {
    this.sendRaw({ v: PROTOCOL_VERSION, type: 'resync', reqId: this.nextReqId() });
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.sendRaw({ v: PROTOCOL_VERSION, type: 'ping', reqId: this.nextReqId() });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private nextReqId(): string {
    return `r${++this.reqCounter}`;
  }

  /** Returns false when nothing left the device (socket not open, or send threw). Callers that
   * then wait for a server reply must surface that instead of waiting for an answer that can
   * never arrive. */
  private sendRaw(msg: ClientMessage): boolean {
    this.pushTrace('out', msg.type);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      this.setStatus('error', String(err));
      return false;
    }
  }

  private pushTrace(dir: 'out' | 'in', type: string): void {
    this.trace.push({ dir, type });
    if (this.trace.length > TRACE_CAP) this.trace.shift();
  }

  private setStatus(s: ConnStatus, message?: string): void {
    this.status = s;
    this.statusTrace.push(s);
    if (this.statusTrace.length > STATUS_TRACE_CAP) this.statusTrace.shift();
    this.lastStatusMessage = message;
    for (const cb of this.statusListeners) cb(s, message);
  }

  getLastStatusMessage(): string | undefined {
    return this.lastStatusMessage;
  }
}
