/**
 * Socket bookkeeping for the WebSocket server, kept as pure functions over
 * plain maps (not tied to `ws`) so it's unit-testable with fake sockets
 * instead of a real WebSocketServer. See docs/PHASE5_SERVER_REVIEW.md S1/S2/S4/S5.
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

export interface ConnState {
  code: string | null;
  seat: number | null;
  msgCount: number;
  windowStart: number;
  failedJoins: number;
}

export function newConnState(now: number): ConnState {
  return { code: null, seat: null, msgCount: 0, windowStart: now, failedJoins: 0 };
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
