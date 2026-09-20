/**
 * Socket bookkeeping for the WebSocket server, kept as pure functions over
 * plain maps (not tied to `ws`) so it's unit-testable with fake sockets
 * instead of a real WebSocketServer.
 */
import { isIP } from 'node:net';

/** The subset of the WebSocket interface this module needs. A real `ws`/browser
 * WebSocket satisfies this structurally. */
export interface Sock {
  readyState: number;
  send(data: string): void;
  close(): void;
}

/** WebSocket.OPEN per the WebSocket spec — both `ws` and browsers use 1. */
export const SOCK_OPEN = 1;

/** A fixed-window counter. Coarse on purpose: a window boundary can let through up to 2x the
 * limit back to back, which is irrelevant for abuse control and much easier to reason about
 * than a token bucket. */
export interface Counter {
  count: number;
  start: number;
}

export interface ConnState {
  code: string | null;
  seat: number | null;
  msgCount: number;
  windowStart: number;
  failedJoins: number;
  /** Full-snapshot requests this connection has made, windowed (see `hitResyncLimit`). */
  resyncs: Counter;
  /** Room-list requests this connection has made, windowed (see `hitListLimit`). */
  listings: Counter;
  /** Queue join/cancel messages this connection has sent, windowed (see `hitQueueLimit`). */
  queueOps: Counter;
  /** The queue entry this connection currently speaks for, or null. Exactly like `code`/`seat`:
   * it is cleared when another socket takes the entry over, which is what stops a stale
   * transport from cancelling a queue membership that has moved on. */
  queueToken: string | null;
  /** The source this connection arrived from, as the key of the per-source room-creation
   * budget. Never logged — see server/log.ts, which redacts it by key name anyway. */
  ip: string;
}

export function newConnState(now: number, ip = 'unknown'): ConnState {
  return {
    code: null,
    seat: null,
    msgCount: 0,
    windowStart: now,
    failedJoins: 0,
    resyncs: { count: 0, start: now },
    listings: { count: 0, start: now },
    queueOps: { count: 0, start: now },
    queueToken: null,
    ip,
  };
}

/** Counts one hit and reports whether the window's allowance is now used up. */
function hitWindow(c: Counter, now: number, max: number, windowMs: number): boolean {
  if (now - c.start > windowMs) {
    c.start = now;
    c.count = 0;
  }
  c.count++;
  return c.count > max;
}

/** The same fixed window, keyed — one budget per source rather than per connection. */
function hitKeyedWindow(
  map: Map<string, Counter>,
  key: string,
  now: number,
  max: number,
  windowMs: number,
): boolean {
  let c = map.get(key);
  if (!c) {
    c = { count: 0, start: now };
    map.set(key, c);
  }
  return hitWindow(c, now, max, windowMs);
}

/** Drop counters whose window has elapsed, so a keyed budget map cannot grow with every source
 * that ever connected. Call from the existing sweep — it is a bounded map scan, not a timer. */
export function pruneCounters(map: Map<string, Counter>, now: number, windowMs: number): void {
  for (const [key, c] of map) if (now - c.start > windowMs) map.delete(key);
}

/**
 * Room-creation budget, per source rather than per connection: a connection can only hold one
 * room at a time, and leaving deletes an empty one, so the way to park rooms against the global
 * ceiling is to create one, drop the socket without leaving, and reconnect — a fresh connection
 * every time, which a per-connection counter would never see. The abandoned room then lives for
 * the disconnect grace. Twenty a minute is far above a household of players making and remaking
 * rooms and far below the rate needed to reach MEXE_MAX_ROOMS before the sweep reclaims them.
 */
export function hitRoomCreateLimit(
  map: Map<string, Counter>,
  ip: string,
  now: number,
  max = 20,
  windowMs = 60_000,
): boolean {
  return hitKeyedWindow(map, ip, now, max, windowMs);
}

/** A `resync` makes the server serialize a whole room view per caller, so it is the most
 * expensive message a client can send without playing. Legitimate clients ask on desync, on
 * app resume and on a dropped proposal — never five times in ten seconds. Over the limit the
 * request is ignored, not answered: the answer is the expensive part. */
export function hitResyncLimit(state: ConnState, now: number, max = 5, windowMs = 10_000): boolean {
  return hitWindow(state.resyncs, now, max, windowMs);
}

/**
 * Room-list budget. Discovery is the only message that reads across every room, so an unbounded
 * caller could turn one socket into a scraper — and the answer is already capped in size, which
 * means enumeration pressure comes from the *rate*, not from any single reply.
 *
 * Twelve in ten seconds is far above a human opening the browser and pulling to refresh, and far
 * below a poll loop. The room browser refreshes on demand, not on a timer, so a normal player
 * never approaches it.
 */
export function hitListLimit(state: ConnState, now: number, max = 12, windowMs = 10_000): boolean {
  return hitWindow(state.listings, now, max, windowMs);
}

/**
 * Queue budget, covering join and cancel together. Both are cheap on their own, but a
 * join/cancel loop is the one way to make the matcher run flat out from a single socket, so the
 * pair shares one allowance rather than each getting its own.
 *
 * Ten in ten seconds leaves room for the things real players do — queue, change their mind,
 * change the player count, queue again, resume a backgrounded phone — and none for a loop.
 */
export function hitQueueLimit(state: ConnState, now: number, max = 10, windowMs = 10_000): boolean {
  return hitWindow(state.queueOps, now, max, windowMs);
}

/**
 * Origin policy. A list of origins is the strict answer; `*` is the explicit "any origin", which
 * is the right answer behind someone else's proxy or for a deployment whose clients are not all
 * browsers. Production has to pick one of the two — see `loadConfig`, which refuses to start on
 * silence. An empty list only happens in development, where it means no check.
 *
 * A missing Origin is allowed under every setting: only browsers send one, so requiring it would
 * block `curl`/`ws` clients while stopping nobody, since anything that is not a browser can send
 * whatever Origin it likes. Origin is never treated as authentication; the session token is.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0 || allowed.includes('*')) return true;
  if (origin === undefined || origin === '') return true;
  return allowed.includes(origin.replace(/\/+$/, ''));
}

/**
 * The address the per-source budgets are keyed on.
 *
 * With no proxy (`trustedHops` 0, the default) that is the socket's own peer address and
 * `X-Forwarded-For` is ignored outright — the header is client-settable, so honouring it by
 * default would turn every per-source limit into something any abuser can spoof away.
 *
 * With `trustedHops` proxies in front, the entry that many places from the right is the one the
 * nearest trusted proxy appended, and everything to its left is client-supplied and ignored.
 * This is only sound while the server port is unreachable except through those proxies: a client
 * that can connect directly appends whatever chain it likes. Anything that does not parse as an
 * IP falls back to the peer address rather than becoming a budget key of its own.
 */
export function clientIp(remoteAddress: string | undefined, forwardedFor: string | undefined, trustedHops: number): string {
  const direct = remoteAddress ?? 'unknown';
  if (trustedHops <= 0 || !forwardedFor) return direct;
  const chain = forwardedFor.split(',').map((part) => part.trim()).filter((part) => part !== '');
  const candidate = chain[chain.length - trustedHops];
  if (candidate === undefined) return direct;
  // Proxies vary: bare address, bracketed IPv6, or either with a port appended.
  const bare = candidate.replace(/^\[([^\]]+)\](?::\d+)?$/, '$1').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1');
  return isIP(bare) === 0 ? direct : bare;
}

/**
 * The liveness rule, as a pure split. A connection that did not answer the last probe has missed
 * a full heartbeat interval and is `dead` — a half-open socket (closed lid, dead NAT entry) that
 * would otherwise hold its seat `connected` until TCP gives up, so the disconnect grace never
 * starts. Everything that did answer is cleared from `alive` and goes back in `probe`, so the
 * next round tests it again: an active socket must never be reaped for being quiet.
 */
export function reapDeadSockets<S>(conns: Iterable<S>, alive: Set<S>): { dead: S[]; probe: S[] } {
  const dead: S[] = [];
  const probe: S[] = [];
  for (const c of conns) {
    if (alive.has(c)) {
      alive.delete(c);
      probe.push(c);
    } else {
      dead.push(c);
    }
  }
  return { dead, probe };
}

/** Room codes are short shared secrets; a connection that keeps guessing nonexistent codes is
 * probing, not mistyping. Count each failed lookup and tell the caller when to close it. */
export function hitJoinLimit(state: ConnState, maxFailures = 10): boolean {
  state.failedJoins++;
  return state.failedJoins > maxFailures;
}

export function attachSocket<S extends Sock>(sockets: Map<string, Map<number, S>>, code: string, seat: number, sock: S): void {
  let bySeat = sockets.get(code);
  if (!bySeat) {
    bySeat = new Map();
    sockets.set(code, bySeat);
  }
  bySeat.set(seat, sock);
}

export function detachSocket<S extends Sock>(sockets: Map<string, Map<number, S>>, code: string, seat: number, sock: S): void {
  const bySeat = sockets.get(code);
  if (bySeat?.get(seat) === sock) bySeat.delete(seat);
  if (bySeat && bySeat.size === 0) sockets.delete(code);
}

/** Move a live socket between seats without leaving it reachable from its old room. */
export function moveSocket<S extends Sock>(
  sockets: Map<string, Map<number, S>>,
  conn: ConnState,
  code: string,
  seat: number,
  sock: S,
): void {
  if (conn.code !== null && conn.seat !== null) detachSocket(sockets, conn.code, conn.seat, sock);
  conn.code = code;
  conn.seat = seat;
  attachSocket(sockets, code, seat, sock);
}

/** On a successful reconnect: evict whatever socket currently holds the seat (if it isn't
 * `newSock` already), closing it and clearing its ConnState, so exactly one connection can
 * ever act for a seat (S4). Returns the evicted socket, or null if there was none to evict. */
export function evictSeat<S extends Sock>(
  sockets: Map<string, Map<number, S>>,
  connections: Map<S, ConnState>,
  code: string,
  seat: number,
  newSock: S,
): S | null {
  const old = sockets.get(code)?.get(seat);
  if (!old || old === newSock) return null;
  const oldState = connections.get(old);
  if (oldState) {
    oldState.code = null;
    oldState.seat = null;
  }
  detachSocket(sockets, code, seat, old);
  if (old.readyState === SOCK_OPEN) {
    try {
      old.close();
    } catch {
      // already closing
    }
  }
  return old;
}

/** Notify and detach every socket attached to a room (sweep reap, or a mid-game abandonment),
 * clearing each one's ConnState so it can never act on the dead room again (S1/S2). */
export function closeRoomSockets<S extends Sock>(
  sockets: Map<string, Map<number, S>>,
  connections: Map<S, ConnState>,
  code: string,
  msg: unknown,
): void {
  const bySeat = sockets.get(code);
  if (!bySeat) return;
  const payload = JSON.stringify(msg);
  for (const sock of bySeat.values()) {
    const state = connections.get(sock);
    if (state) {
      state.code = null;
      state.seat = null;
    }
    if (sock.readyState === SOCK_OPEN) {
      try {
        sock.send(payload);
      } catch {
        // ignore — socket may already be closing
      }
    }
  }
  sockets.delete(code);
}

/** Crude per-connection flood guard (S5): more than `maxPerWindow` inbound messages within
 * `windowMs` means the connection should be closed. Not a real rate limiter — just enough
 * that a looping client cannot exhaust the process. */
export function hitFlood(state: ConnState, now: number, maxPerWindow = 30, windowMs = 1000): boolean {
  if (now - state.windowStart > windowMs) {
    state.windowStart = now;
    state.msgCount = 0;
  }
  state.msgCount++;
  return state.msgCount > maxPerWindow;
}
