import { describe, expect, it } from 'vitest';
import {
  attachSocket,
  closeRoomSockets,
  detachSocket,
  evictSeat,
  hitFlood,
  hitJoinLimit,
  moveSocket,
  newConnState,
  SOCK_OPEN,
  type ConnState,
  type Sock,
} from '../../server/connections';

/** Fake socket standing in for `ws`/browser WebSocket — enough of the interface for the
 * connection registry, with a `sent` log and a `closed` flag instead of a real transport. */
function fakeSock(): Sock & { sent: string[]; closed: boolean } {
  const sock = {
    readyState: SOCK_OPEN,
    sent: [] as string[],
    closed: false,
    send(data: string) {
      sock.sent.push(data);
    },
    close() {
      sock.closed = true;
      sock.readyState = 3; // CLOSED
    },
  };
  return sock;
}

describe('connections registry (docs/archive/PHASE5_SERVER_REVIEW.md S1/S2/S4/S5)', () => {
  it('S1/S2: closeRoomSockets notifies every attached socket, clears its ConnState, and drops the room', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const connections = new Map<ReturnType<typeof fakeSock>, ConnState>();
    const a = fakeSock();
    const b = fakeSock();
    const connA: ConnState = { code: 'ROOM1', seat: 0, msgCount: 0, windowStart: 0, failedJoins: 0 };
    const connB: ConnState = { code: 'ROOM1', seat: 1, msgCount: 0, windowStart: 0, failedJoins: 0 };
    connections.set(a, connA);
    connections.set(b, connB);
    attachSocket(sockets, 'ROOM1', 0, a);
    attachSocket(sockets, 'ROOM1', 1, b);

    closeRoomSockets(sockets, connections, 'ROOM1', { type: 'error', code: 'room_closed' });

    expect(a.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]!)).toEqual({ type: 'error', code: 'room_closed' });
    expect(b.sent).toHaveLength(1);
    expect(connA).toEqual({ code: null, seat: null, msgCount: 0, windowStart: 0, failedJoins: 0 });
    expect(connB).toEqual({ code: null, seat: null, msgCount: 0, windowStart: 0, failedJoins: 0 });
    expect(sockets.get('ROOM1')).toBeUndefined();
  });

  it('closeRoomSockets on an unknown code is a no-op', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const connections = new Map<ReturnType<typeof fakeSock>, ConnState>();
    expect(() => closeRoomSockets(sockets, connections, 'NOPE', {})).not.toThrow();
  });

  it('S4: reconnect evicts the previous socket holding the seat, closing it and clearing its ConnState', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const connections = new Map<ReturnType<typeof fakeSock>, ConnState>();
    const oldSock = fakeSock();
    const newSock = fakeSock();
    const oldConn: ConnState = { code: 'ROOM1', seat: 0, msgCount: 0, windowStart: 0, failedJoins: 0 };
    connections.set(oldSock, oldConn);
    connections.set(newSock, { code: null, seat: null, msgCount: 0, windowStart: 0, failedJoins: 0 });
    attachSocket(sockets, 'ROOM1', 0, oldSock);

    const evicted = evictSeat(sockets, connections, 'ROOM1', 0, newSock);

    expect(evicted).toBe(oldSock);
    expect(oldSock.closed).toBe(true);
    expect(oldConn.code).toBeNull();
    expect(oldConn.seat).toBeNull();
    // The old socket can no longer act for the seat — it's no longer attached.
    expect(sockets.get('ROOM1')?.get(0)).toBeUndefined();

    attachSocket(sockets, 'ROOM1', 0, newSock);
    expect(sockets.get('ROOM1')?.get(0)).toBe(newSock);
  });

  it('evictSeat is a no-op when the seat has no socket yet, or already holds this one', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const connections = new Map<ReturnType<typeof fakeSock>, ConnState>();
    const sock = fakeSock();
    expect(evictSeat(sockets, connections, 'ROOM1', 0, sock)).toBeNull();

    attachSocket(sockets, 'ROOM1', 0, sock);
    expect(evictSeat(sockets, connections, 'ROOM1', 0, sock)).toBeNull();
    expect(sock.closed).toBe(false);
  });

  it('detachSocket removes the room entry once its last socket leaves', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const sock = fakeSock();
    attachSocket(sockets, 'ROOM1', 0, sock);
    detachSocket(sockets, 'ROOM1', 0, sock);
    expect(sockets.get('ROOM1')).toBeUndefined();
  });

  it('reconnect moves a socket out of its old room before attaching its new seat', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const sock = fakeSock();
    const conn: ConnState = { code: 'ROOM_A', seat: 0, msgCount: 0, windowStart: 0, failedJoins: 0 };
    attachSocket(sockets, 'ROOM_A', 0, sock);

    moveSocket(sockets, conn, 'ROOM_B', 1, sock);

    expect(sockets.get('ROOM_A')).toBeUndefined();
    expect(sockets.get('ROOM_B')?.get(1)).toBe(sock);
    expect(conn.code).toBe('ROOM_B');
    expect(conn.seat).toBe(1);
  });

  it('S5: hitFlood allows traffic under the ceiling and flags a connection over it within the window', () => {
    const now = 0;
    const state = newConnState(now);
    for (let i = 0; i < 5; i++) expect(hitFlood(state, now, 5, 1000)).toBe(false);
    // 6th message in the same window exceeds the cap of 5.
    expect(hitFlood(state, now, 5, 1000)).toBe(true);
  });

  it('S5: hitFlood resets the counter once the window elapses', () => {
    const state = newConnState(0);
    expect(hitFlood(state, 0, 2, 1000)).toBe(false);
    expect(hitFlood(state, 0, 2, 1000)).toBe(false);
    expect(hitFlood(state, 0, 2, 1000)).toBe(true); // 3rd hit, still in window
    expect(hitFlood(state, 2000, 2, 1000)).toBe(false); // new window, counter reset
  });
});

describe('hitJoinLimit', () => {
  it('allows failures up to the ceiling, then flags the connection', () => {
    const state = newConnState(0);
    for (let i = 0; i < 3; i++) expect(hitJoinLimit(state, 3)).toBe(false);
    expect(hitJoinLimit(state, 3)).toBe(true);
  });

  it('counts per connection, not globally', () => {
    const a = newConnState(0);
    const b = newConnState(0);
    for (let i = 0; i < 10; i++) hitJoinLimit(a);
    expect(hitJoinLimit(b)).toBe(false);
    expect(hitJoinLimit(a)).toBe(true);
  });
});
