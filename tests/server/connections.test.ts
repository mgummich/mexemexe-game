import { describe, expect, it } from 'vitest';
import {
  attachSocket,
  clientIp,
  closeRoomSockets,
  detachSocket,
  evictSeat,
  hitFlood,
  hitJoinLimit,
  hitResyncLimit,
  hitRoomCreateLimit,
  moveSocket,
  newConnState,
  originAllowed,
  pruneCounters,
  reapDeadSockets,
  type Counter,
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

describe('connections registry', () => {
  it('S1/S2: closeRoomSockets notifies every attached socket, clears its ConnState, and drops the room', () => {
    const sockets = new Map<string, Map<number, ReturnType<typeof fakeSock>>>();
    const connections = new Map<ReturnType<typeof fakeSock>, ConnState>();
    const a = fakeSock();
    const b = fakeSock();
    const connA: ConnState = { ...newConnState(0), code: 'ROOM1', seat: 0 };
    const connB: ConnState = { ...newConnState(0), code: 'ROOM1', seat: 1 };
    connections.set(a, connA);
    connections.set(b, connB);
    attachSocket(sockets, 'ROOM1', 0, a);
    attachSocket(sockets, 'ROOM1', 1, b);

    closeRoomSockets(sockets, connections, 'ROOM1', { type: 'error', code: 'room_closed' });

    expect(a.sent).toHaveLength(1);
    expect(JSON.parse(a.sent[0]!)).toEqual({ type: 'error', code: 'room_closed' });
    expect(b.sent).toHaveLength(1);
    expect(connA).toEqual(newConnState(0));
    expect(connB).toEqual(newConnState(0));
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
    const oldConn: ConnState = { ...newConnState(0), code: 'ROOM1', seat: 0 };
    connections.set(oldSock, oldConn);
    connections.set(newSock, newConnState(0));
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
    const conn: ConnState = { ...newConnState(0), code: 'ROOM_A', seat: 0 };
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

describe('OH-05 hitRoomCreateLimit', () => {
  it('allows a household making and remaking rooms, and flags a create-and-drop loop', () => {
    const map = new Map<string, Counter>();
    for (let i = 0; i < 20; i++) expect(hitRoomCreateLimit(map, '1.2.3.4', 0)).toBe(false);
    expect(hitRoomCreateLimit(map, '1.2.3.4', 0)).toBe(true);
    // Fresh window: the player who comes back a minute later is not still punished.
    expect(hitRoomCreateLimit(map, '1.2.3.4', 61_000)).toBe(false);
  });

  it('budgets each source separately, so one abuser cannot lock everyone else out', () => {
    const map = new Map<string, Counter>();
    for (let i = 0; i < 30; i++) hitRoomCreateLimit(map, 'abuser', 0);
    expect(hitRoomCreateLimit(map, 'someone-else', 0)).toBe(false);
  });

  it('OH-34: the budget map is pruned rather than kept for every source that ever connected', () => {
    const map = new Map<string, Counter>();
    for (let i = 0; i < 50; i++) hitRoomCreateLimit(map, `ip-${i}`, 0);
    expect(map.size).toBe(50);
    pruneCounters(map, 61_000, 60_000);
    expect(map.size).toBe(0);
  });
});

describe('OH-31 hitResyncLimit', () => {
  it('passes the bursts a real client makes and bounds a snapshot loop', () => {
    const state = newConnState(0);
    // Desync, dropped proposal, app resume — a legitimate client never reaches the ceiling.
    for (let i = 0; i < 5; i++) expect(hitResyncLimit(state, i * 100)).toBe(false);
    expect(hitResyncLimit(state, 500)).toBe(true);
    expect(hitResyncLimit(state, 11_000)).toBe(false);
  });
});

describe('OH-29/OH-30 originAllowed', () => {
  const allowed = ['https://mexe.example', 'http://localhost:5173'];

  it('accepts a configured production or development origin', () => {
    expect(originAllowed('https://mexe.example', allowed)).toBe(true);
    expect(originAllowed('http://localhost:5173', allowed)).toBe(true);
    // A trailing slash is a deployment typo, not a different origin.
    expect(originAllowed('https://mexe.example/', allowed)).toBe(true);
  });

  it('rejects an unexpected browser origin once a list is configured', () => {
    expect(originAllowed('https://evil.example', allowed)).toBe(false);
    expect(originAllowed('null', allowed)).toBe(false);
  });

  it('accepts everything when no list is configured, and never requires an Origin', () => {
    expect(originAllowed('https://evil.example', [])).toBe(true);
    // Only browsers send Origin; requiring it would block ws/curl clients and stop nobody.
    expect(originAllowed(undefined, allowed)).toBe(true);
  });
});

describe('OH-12/OH-13 heartbeat liveness', () => {
  it('reaps only the transports that missed the last probe, and re-probes the live ones', () => {
    const live = fakeSock();
    const halfOpen = fakeSock();
    const alive = new Set([live]); // halfOpen never answered the previous probe

    const first = reapDeadSockets([live, halfOpen], alive);
    expect(first.dead).toEqual([halfOpen]);
    expect(first.probe).toEqual([live]);

    // The live socket is pending again, not reaped for being quiet — it is reaped only if it
    // also misses this round.
    expect(alive.has(live)).toBe(false);
    alive.add(live); // it answered the pong
    const second = reapDeadSockets([live], alive);
    expect(second.dead).toEqual([]);
    expect(second.probe).toEqual([live]);
  });
});

describe('clientIp behind a proxy', () => {
  const DIRECT = '203.0.113.9';

  it('ignores X-Forwarded-For entirely when no proxy is trusted', () => {
    // The header is client-settable: honouring it by default would let anyone spoof their way
    // out of every per-source budget.
    expect(clientIp(DIRECT, '1.2.3.4', 0)).toBe(DIRECT);
    expect(clientIp(DIRECT, '1.2.3.4, 5.6.7.8', 0)).toBe(DIRECT);
  });

  it('takes the entry the nearest trusted proxy appended, not the leftmost claim', () => {
    // client -> edge -> app: the app's own proxy appended '70.0.0.1', and everything to its
    // left is whatever the client chose to send.
    expect(clientIp(DIRECT, '9.9.9.9, 70.0.0.1', 1)).toBe('70.0.0.1');
    expect(clientIp(DIRECT, '9.9.9.9, 70.0.0.1, 10.0.0.2', 2)).toBe('70.0.0.1');
  });

  it('accepts bracketed IPv6 and an appended port', () => {
    expect(clientIp(DIRECT, '[2001:db8::1]:443', 1)).toBe('2001:db8::1');
    expect(clientIp(DIRECT, '70.0.0.1:51234', 1)).toBe('70.0.0.1');
    expect(clientIp(DIRECT, '2001:db8::1', 1)).toBe('2001:db8::1');
  });

  it('falls back to the peer address for a missing, short or non-IP chain', () => {
    expect(clientIp(DIRECT, undefined, 1)).toBe(DIRECT);
    expect(clientIp(DIRECT, '', 1)).toBe(DIRECT);
    expect(clientIp(DIRECT, '70.0.0.1', 2)).toBe(DIRECT); // fewer hops than configured
    // A budget key must be an address, never free text a client chose.
    expect(clientIp(DIRECT, 'not-an-ip', 1)).toBe(DIRECT);
    expect(clientIp(undefined, undefined, 0)).toBe('unknown');
  });
});

describe('OH-30 an explicit any-origin deployment', () => {
  it('accepts every origin under the wildcard, without pretending it is a check', () => {
    expect(originAllowed('https://anything.example', ['*'])).toBe(true);
    expect(originAllowed(undefined, ['*'])).toBe(true);
  });
});
