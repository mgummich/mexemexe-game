/**
 * Deterministic `RoomManager` construction for the server suites.
 *
 * A room test must control four things the product leaves to the environment — the clock, the
 * room code, the reconnect token and the deal seed — or it is not reproducible. Every server test
 * built the same four injections by hand; they live here once instead.
 *
 * This is the manager level: no sockets and no process. `harness.ts` is the other end (a real
 * server process driven by raw `ws` clients), used only where the wire itself is the subject.
 */
import { RoomManager } from '../../server/rooms';

export interface TestManagerOpts {
  /** Deal seed. Fixed, so the dealt hands of a test are the same on every run. */
  seed?: number | (() => number);
  /** Mutable fake clock. Advance `clock.t` to move the server's time; defaults to a frozen 1000. */
  clock?: { t: number };
  /** Fixed room code, for a test that wants to name the room. Defaults to `CODE1`, `CODE2`, … */
  code?: string;
  /** A clock read the test drives itself, where a mutable `clock.t` does not fit. Wins over `clock`. */
  now?: () => number;
  disconnectGraceMs?: number;
  idleTimeoutMs?: number;
  maxRooms?: number;
}

export function testManager(opts: TestManagerOpts = {}): RoomManager {
  const { seed = 1, clock = { t: 1000 }, code, now = () => clock.t, ...rest } = opts;
  let codes = 0;
  let tokens = 0;
  return new RoomManager({
    now,
    genCode: () => code ?? `CODE${++codes}`,
    genToken: () => `TOKEN${++tokens}`,
    genSeed: typeof seed === 'function' ? seed : () => seed,
    ...rest,
  });
}

/**
 * A started room of `seats` players, returning the code and each seat's token in seat order.
 * Fails loudly rather than returning a half-built room: a broken setup must not read as a
 * behavioural failure further down the test.
 */
export function startedRoom(mgr: RoomManager, seats = 2): { code: string; tokens: string[] } {
  const host = mgr.createRoom('Ana');
  if (!host.ok) throw new Error('unexpected room_limit in test setup');
  const tokens = [host.token];
  for (let i = 1; i < seats; i++) {
    const joined = mgr.joinRoom(host.code, `P${i}`);
    if (!joined.ok) throw new Error(`setup: join ${i} failed: ${joined.error}`);
    tokens.push(joined.token);
  }
  for (let i = 0; i < seats; i++) mgr.setReady(host.code, i, true);
  const started = mgr.startGame(host.code, 0);
  if (!started.ok) throw new Error(`setup: start failed: ${started.error}`);
  return { code: host.code, tokens };
}
