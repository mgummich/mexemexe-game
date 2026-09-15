/**
 * Socket bookkeeping for the WebSocket server, kept as pure functions over
 * plain maps (not tied to `ws`) so it's unit-testable with fake sockets
 * instead of a real WebSocketServer.
 */

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
    ip,
  };
}

/** Counts one hit and reports whether the window's allowance is now used up. */
export function hitWindow(c: Counter, now: number, max: number, windowMs: number): boolean {
  if (now - c.start > windowMs) {
    c.start = now;
    c.count = 0;
  }
  c.count++;
  return c.count > max;
}

/** The same fixed window, keyed — one budget per source rather than per connection. */
export function hitKeyedWindow(
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
 * Origin policy. `allowed` empty means every origin is accepted, which is the default: the
 * server is also deployed behind other people's proxies and reached by non-browser clients, and
 * a check that rejects those would be a broken check rather than a security gain. A deployment
 * that knows its front-end origins sets `MEXE_ALLOWED_ORIGINS` and gets the one thing an Origin
 * header can actually give: a browser on an unrelated page cannot open a socket here. A missing
 * Origin is allowed either way — only browsers send it, so requiring it would block `curl`/`ws`
 * clients while stopping nobody (anything not a browser can send any Origin it likes). Origin is
 * never treated as authentication; the session token is.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  if (origin === undefined || origin === '') return true;
  return allowed.includes(origin.replace(/\/+$/, ''));
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
