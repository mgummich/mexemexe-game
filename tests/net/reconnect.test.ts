/**
 * Online Phase 3 — the client's bounded auto-reconnect loop (OR-*).
 *
 * The socket is transport: a drop must be retried on the schedule that matches the seat-hold
 * window the server offers, exactly once per attempt, and it must stop. These drive NetClient
 * against a fake WebSocket and fake timers, so "what did the client actually do over 60 seconds
 * of bad network" is observable without a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Every socket NetClient has opened this test, oldest first. */
let opened: FakeSocket[] = [];

class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    opened.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.fail();
  }

  /** Server accepted the connection. */
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Socket died (or the connect attempt was refused). */
  fail(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  deliver(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const fakeNavigator = { onLine: true };

type Listener = () => void;
const connectivityListeners = new Map<string, Set<Listener>>();

function fireConnectivity(type: 'online' | 'offline'): void {
  for (const fn of connectivityListeners.get(type) ?? []) fn();
}

function installGlobals(): void {
  const store = new Map<string, string>();
  const g = globalThis as Record<string, unknown>;
  g.WebSocket = FakeSocket;
  g.location = { protocol: 'http:', hostname: 'localhost', host: 'localhost', search: '' };
  // Node exposes `navigator` as a getter-only global, so it has to be redefined rather than
  // assigned. `fakeNavigator` stays mutable, which is how the offline cases flip the radio.
  fakeNavigator.onLine = true;
  Object.defineProperty(g, 'navigator', { value: fakeNavigator, configurable: true, writable: true });
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  g.window = {
    addEventListener: (type: string, fn: Listener) => {
      const set = connectivityListeners.get(type) ?? new Set();
      set.add(fn);
      connectivityListeners.set(type, set);
    },
    removeEventListener: (type: string, fn: Listener) => void connectivityListeners.get(type)?.delete(fn),
  };
}

/** NetClient reads its globals at call time, so they must exist before the module is imported
 * (`onConnectivityChange`'s default target is evaluated per call, but the import graph is not). */
installGlobals();
const { NetClient } = await import('../../src/net/client');

/** A client with a live session, dropped once — i.e. sitting in its reconnect loop. */
function droppedClient() {
  const client = new NetClient();
  client.connect();
  const first = opened[0]!;
  first.accept();
  first.deliver({ v: 4, type: 'room_joined', code: 'ABCDE', seat: 0, token: 'TOKEN1', players: [], settings: {}, hostSeat: 0 });
  first.fail();
  return client;
}

/** Let the next scheduled attempt fire. Delays are jittered upward by up to 25%, so advance by a
 * generous multiple rather than guessing the exact value. */
function runNextAttempt(): void {
  vi.advanceTimersByTime(60_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  opened = [];
  connectivityListeners.clear();
  installGlobals();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OR-20/OR-21 a dropped session reconnects itself', () => {
  it('retries on a bounded backoff schedule and gives up instead of looping forever', () => {
    const client = droppedClient();
    expect(client.getStatus()).toBe('reconnecting');

    let attempts = 0;
    while (client.getStatus() === 'reconnecting' && attempts < 50) {
      const before = opened.length;
      runNextAttempt();
      if (opened.length === before) break;
      attempts++;
      opened[opened.length - 1]!.fail();
    }
    // Bounded: a real schedule, then a terminal status the scene can act on. Not endless.
    expect(attempts).toBeGreaterThanOrEqual(5);
    expect(attempts).toBeLessThanOrEqual(10);
    expect(client.getStatus()).toBe('closed');
    expect(client.reconnectAttemptsLeft()).toBe(0);
    // Every attempt is one socket — never a second one racing beside it.
    expect(opened.length).toBe(1 + attempts);

    // Exhausted means exhausted: a later nudge opens nothing.
    runNextAttempt();
    expect(opened.length).toBe(1 + attempts);
  });

  it('OR-20 an exhausted loop still reconnects when the player asks, and gets the whole budget back', () => {
    // The gap this closes: every other case here ends either in recovery or in the terminal
    // status. Nothing drove the schedule to exhaustion and then back into a live session — which
    // is exactly what a phone that was in a tunnel past the last attempt does when its owner
    // taps reconnect (or reloads) inside the server's seat-hold window.
    const client = droppedClient();
    while (client.getStatus() === 'reconnecting') {
      const before = opened.length;
      runNextAttempt();
      if (opened.length === before) break;
      opened[opened.length - 1]!.fail();
    }
    expect(client.getStatus()).toBe('closed');
    const afterGivingUp = opened.length;

    client.connect();
    expect(opened.length).toBe(afterGivingUp + 1);
    const manual = opened[opened.length - 1]!;
    manual.accept();

    expect(client.getStatus()).toBe('open');
    // The token survived the exhausted loop, so the seat is reclaimed rather than re-joined.
    expect(JSON.parse(manual.sent[0]!)).toMatchObject({ type: 'reconnect', token: 'TOKEN1' });
    // And the next drop gets a full schedule, not the remains of the exhausted one.
    expect(client.reconnectAttemptsLeft()).toBe(7);
  });

  it('OR-20 a reload after the loop gave up still reclaims the seat — the token outlives the client', () => {
    // The other exhaustion case ends with the *same* client being asked to reconnect. This is the
    // one a player actually performs: the tab was in a tunnel past the last attempt, so they
    // reload. A fresh NetClient must find the token the dead one left in sessionStorage and
    // reclaim the seat rather than starting a join (P3-retry-exhaustion-unowned).
    const dead = droppedClient();
    while (dead.getStatus() === 'reconnecting') {
      const before = opened.length;
      runNextAttempt();
      if (opened.length === before) break;
      opened[opened.length - 1]!.fail();
    }
    expect(dead.getStatus()).toBe('closed');
    const beforeReload = opened.length;

    // The reload: the old client and its listeners are gone, a new one is constructed.
    const reloaded = new NetClient();
    reloaded.connect();
    expect(opened.length).toBe(beforeReload + 1);
    const fresh = opened[opened.length - 1]!;
    fresh.accept();

    expect(reloaded.getStatus()).toBe('open');
    expect(JSON.parse(fresh.sent[0]!)).toMatchObject({ type: 'reconnect', token: 'TOKEN1' });
    expect(reloaded.reconnectAttemptsLeft()).toBe(7);
  });

  it('re-sends the session token on the socket that comes back, and resets the budget', () => {
    const client = droppedClient();
    runNextAttempt();
    const retry = opened[1]!;
    retry.accept();
    expect(client.getStatus()).toBe('open');
    expect(JSON.parse(retry.sent[0]!)).toMatchObject({ type: 'reconnect', token: 'TOKEN1' });
    // A later drop gets the whole schedule again rather than the remains of the last one.
    expect(client.reconnectAttemptsLeft()).toBe(7);
  });
});

describe('OR-20 offline/online transitions', () => {
  it('parks the loop while the browser reports no network and resumes on the online event', () => {
    fakeNavigator.onLine = false;
    const client = droppedClient();
    expect(client.getStatus()).toBe('reconnecting');
    // No attempt is spent against a radio that is off — waiting costs nothing, failing costs one.
    runNextAttempt();
    expect(opened).toHaveLength(1);
    expect(client.reconnectAttemptsLeft()).toBe(7);

    fakeNavigator.onLine = true;
    fireConnectivity('online');
    expect(opened).toHaveLength(2);
    opened[1]!.accept();
    expect(client.getStatus()).toBe('open');
  });

  it('OR-21 a network handover mid-backoff retries at once instead of waiting out the delay', () => {
    const client = droppedClient();
    fireConnectivity('offline');
    fireConnectivity('online');
    // One socket for the handover, not one per event.
    expect(opened).toHaveLength(2);
    opened[1]!.accept();
    expect(client.getStatus()).toBe('open');
  });

  it('never reconnects a session the player deliberately left', () => {
    const client = droppedClient();
    client.leaveRoom();
    fireConnectivity('online');
    runNextAttempt();
    expect(opened).toHaveLength(1);
    expect(client.getStatus()).toBe('closed');
  });
});

describe('OR-19/OR-22/OR-23 resume and orientation', () => {
  it('retryNow pulls the next attempt forward but still spends it, so repeated resumes stay bounded', () => {
    const client = droppedClient();
    const budget = client.reconnectAttemptsLeft();
    for (let i = 0; i < budget + 5; i++) {
      client.retryNow();
      opened[opened.length - 1]!.fail();
    }
    // A player switching apps twenty times cannot turn a bounded loop into an unbounded one:
    // every resume draws from the same budget the backoff does, and past it retryNow is a no-op.
    expect(client.reconnectAttemptsLeft()).toBe(0);
    expect(opened.length).toBeLessThanOrEqual(1 + budget);
    expect(client.getStatus()).toBe('closed');
  });

  it('OR-22 a resume while connected opens no second socket', () => {
    const client = new NetClient();
    client.connect();
    opened[0]!.accept();
    client.retryNow();
    client.connect();
    expect(opened).toHaveLength(1);
    expect(client.getStatus()).toBe('open');
  });

  it('OR-22 repeated connect() calls install exactly one pair of connectivity listeners', () => {
    const client = droppedClient();
    runNextAttempt();
    opened[1]!.accept();
    expect(connectivityListeners.get('online')!.size).toBe(1);
    expect(connectivityListeners.get('offline')!.size).toBe(1);
    client.disconnect();
    expect(connectivityListeners.get('online')!.size).toBe(0);
  });
});

describe('a definitively dead session stops trying', () => {
  it('an invalid_token answer ends the loop instead of retrying back to the same error', () => {
    const client = new NetClient();
    client.connect();
    opened[0]!.accept();
    opened[0]!.deliver({ v: 4, type: 'room_joined', code: 'ABCDE', seat: 0, token: 'TOKEN1', players: [], settings: {}, hostSeat: 0 });
    opened[0]!.deliver({ v: 4, type: 'error', code: 'invalid_token', message: 'expired' });
    opened[0]!.fail();
    runNextAttempt();
    expect(opened).toHaveLength(1);
    expect(client.getStatus()).toBe('closed');
  });

  it('a closed room ends the loop too', () => {
    const client = new NetClient();
    client.connect();
    opened[0]!.accept();
    opened[0]!.deliver({ v: 4, type: 'room_joined', code: 'ABCDE', seat: 0, token: 'TOKEN1', players: [], settings: {}, hostSeat: 0 });
    opened[0]!.deliver({ v: 4, type: 'error', code: 'room_closed', message: 'gone' });
    opened[0]!.fail();
    runNextAttempt();
    expect(opened).toHaveLength(1);
    expect(client.getStatus()).toBe('closed');
  });
});

describe('RC-14 the reconnect token belongs to the endpoint that issued it', () => {
  /** Frames this socket sent, as parsed messages. */
  const sentTypes = (s: FakeSocket): string[] => s.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);

  it('replays the token when the client reconnects to the same server', () => {
    const client = new NetClient();
    client.connect();
    opened[0]!.accept();
    opened[0]!.deliver({ v: 4, type: 'room_joined', code: 'ABCDE', seat: 0, token: 'TOKEN1', players: [], settings: {}, hostSeat: 0 });
    opened[0]!.fail();
    runNextAttempt();
    opened[1]!.accept();
    expect(sentTypes(opened[1]!)).toContain('reconnect');
  });

  it('never hands the token to a different server a ?ws= link points it at', () => {
    const client = new NetClient();
    client.connect();
    opened[0]!.accept();
    opened[0]!.deliver({ v: 4, type: 'room_joined', code: 'ABCDE', seat: 0, token: 'TOKEN1', players: [], settings: {}, hostSeat: 0 });
    opened[0]!.fail();
    // The player follows a crafted link on the real origin: same tab, same sessionStorage, but
    // the endpoint the client now resolves is the attacker's.
    (globalThis as Record<string, unknown>).location = {
      protocol: 'http:', hostname: 'localhost', host: 'localhost', search: '?ws=ws://evil.example/ws',
    };
    client.connect();
    const attacker = opened[opened.length - 1]!;
    attacker.accept();
    expect(attacker.url).toBe('ws://evil.example/ws');
    expect(sentTypes(attacker)).not.toContain('reconnect');
  });
});
