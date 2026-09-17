import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { testManager } from './manager';
import { createRng } from '../../src/rules/rng';

/**
 * Seeded lobby soak: a deterministic random walk of lobby operations (join, leave,
 * ready, disconnect, reconnect, start, play, rematch) against a real RoomManager,
 * re-checking the room's invariants after every single step.
 *
 * The LB-* acceptance suite covers the same invariants on named scenarios; this one
 * covers the orderings nobody thought to name — a seat gap opening while a player is
 * disconnected, a host leaving between a start refusal and a rematch, and so on. A
 * failure prints the step log, and the seed replays it exactly.
 */

type Member = { seat: number; token: string; name: string };

function makeManager(seed: number): RoomManager {
  let seeds = seed;
  return testManager({ seed: () => ++seeds });
}

/** Every invariant that must hold between any two operations, whatever the room is doing. */
function checkInvariants(mgr: RoomManager, code: string, members: Member[], log: string[]): void {
  const why = (what: string): string => `${what}\nsteps:\n${log.join('\n')}`;
  const info = mgr.getRoomInfo(code);
  if (members.length === 0) {
    expect(info, why('empty room still exists')).toBeNull();
    return;
  }
  expect(info, why('room vanished with members still seated')).not.toBeNull();
  const seats = info!.players.map((p) => p.seat);

  // Seats are stable chairs: unique, in range, and exactly the ones we were handed.
  expect(new Set(seats).size, why('duplicate seat')).toBe(seats.length);
  expect(seats.every((s) => s >= 0 && s < 4), why(`seat out of range: ${seats}`)).toBe(true);
  expect([...seats].sort(), why('roster disagrees with our members')).toEqual(
    members.map((m) => m.seat).sort(),
  );

  // Host authority always points at an occupied chair.
  const hostSeat = mgr.getHostSeat(code);
  expect(seats.includes(hostSeat), why(`host seat ${hostSeat} is empty`)).toBe(true);

  const room = mgr.getRoom(code);
  expect(info!.locked, why('locked disagrees with having a state')).toBe(room?.state != null);

  // A token is the seat's identity and never migrates.
  for (const m of members) {
    const back = mgr.reconnect(m.token);
    expect(back.ok && back.seat, why(`token for seat ${m.seat} resolved elsewhere`)).toBe(m.seat);
  }

  if (!room?.state) return;

  // Mid-match: the dense player indices and the room seats must agree, both ways (§3f).
  const view = mgr.getView(code, members[0]!.seat)!;
  expect(view.seats.length, why('matchSeats length != player count')).toBe(room.state.players.length);
  expect(new Set(view.seats).size, why('duplicate seat in matchSeats')).toBe(view.seats.length);
  expect(view.seats.every((s) => seats.includes(s)), why('matchSeats points at an empty chair')).toBe(true);
  expect(view.seat, why('my player index disagrees with matchSeats')).toBe(view.seats.indexOf(members[0]!.seat));
  expect(view.activeSeat, why('activeSeat is not a player index')).toBe(room.state.activePlayerIndex);
}

function soak(seed: number, steps: number): void {
  const mgr = makeManager(seed);
  const rng = createRng(seed);
  const log: string[] = [];
  let names = 0;

  const create = (): { code: string; members: Member[] } => {
    const res = mgr.createRoom(`P${++names}`);
    if (!res.ok) throw new Error('unexpected room_limit in soak');
    return { code: res.code, members: [{ seat: res.seat, token: res.token, name: `P${names}` }] };
  };

  let { code, members } = create();

  for (let step = 0; step < steps; step++) {
    const playing = mgr.getRoom(code)?.state ?? null;
    const pick = members[rng.int(members.length)]!;

    if (playing) {
      // A running match is mostly played: a match only ends by exhausting the draw pile, so
      // the disruptions stay rare enough that some of these matches reach a real finish.
      const op = rng.int(40);
      if (op === 0) {
        // Leaving mid-match tears the room down for everyone (S2).
        log.push(`leave(playing) ${pick.seat}`);
        mgr.leaveRoom(code, pick.seat);
        members = [];
      } else if (op === 1) {
        log.push(`disconnect ${pick.seat}`);
        mgr.disconnect(code, pick.seat);
      } else if (op === 2) {
        log.push(`reconnect ${pick.seat}`);
        mgr.reconnect(pick.token);
      } else {
        // Play a turn for whoever is active; the draw path always terminates a match.
        const view = mgr.getView(code, members[0]!.seat)!;
        const activeSeat = view.seats[playing.activePlayerIndex]!;
        const rev = mgr.getRoom(code)!.rev;
        const res = mgr.drawEndTurn(code, activeSeat, rev);
        log.push(`draw ${activeSeat} rev${rev} ${res.ok ? 'ok' : res.reasons.join(',')}`);
        expect(res.ok, `active seat was refused its own turn\nsteps:\n${log.join('\n')}`).toBe(true);
        if (res.ok && res.gameOver) {
          mgr.recycleForRematch(code);
          log.push('recycle');
          const info = mgr.getRoomInfo(code)!;
          expect(info.locked, 'rematch lobby stayed locked').toBe(false);
          expect(info.players.every((p) => !p.ready), 'rematch lobby kept a stale ready').toBe(true);
        }
      }
    } else {
      // Weighted so the walk actually reaches a running match: joins and ready bits are
      // common, a leave is rare, and a start is attempted often (mostly refused, which is
      // the half of the verdict worth checking).
      const op = rng.int(12);
      if (op <= 1 && members.length < 4) {
        const res = mgr.joinRoom(code, `P${++names}`);
        log.push(`join -> ${res.ok ? res.seat : res.error}`);
        if (res.ok) members.push({ seat: res.seat, token: res.token, name: `P${names}` });
      } else if (op === 2) {
        log.push(`leave ${pick.seat}`);
        const { roomClosed } = mgr.leaveRoom(code, pick.seat);
        members = roomClosed ? [] : members.filter((m) => m.seat !== pick.seat);
      } else if (op === 3) {
        log.push(`disconnect ${pick.seat}`);
        mgr.disconnect(code, pick.seat);
      } else if (op === 4) {
        log.push(`reconnect ${pick.seat}`);
        mgr.reconnect(pick.token);
      } else if (op <= 7) {
        log.push(`ready ${pick.seat}=true`);
        mgr.setReady(code, pick.seat, true);
      } else if (op === 8) {
        log.push(`ready ${pick.seat}=false`);
        mgr.setReady(code, pick.seat, false);
      } else {
        const host = mgr.getHostSeat(code);
        const info = mgr.getRoomInfo(code)!;
        const startable = info.players.length >= 2 && info.players.every((p) => p.ready && p.connected);
        const res = mgr.startGame(code, pick.seat);
        log.push(`start ${pick.seat} -> ${res.ok ? 'started' : res.error}`);
        // A start is accepted exactly when the host asks and every occupied seat is ready and
        // present — a seat *gap* is never a reason to refuse (§3f).
        expect(res.ok, `start verdict wrong\nsteps:\n${log.join('\n')}`).toBe(pick.seat === host && startable);
        if (res.ok) {
          const joined = mgr.joinRoom(code, 'latecomer');
          expect(joined.ok ? 'ok' : joined.error, 'started room accepted a join').toBe('game_started');
        }
      }
    }

    checkInvariants(mgr, code, members, log);
    if (members.length === 0) ({ code, members } = create());
  }
}

describe('lobby soak: seeded random walk of room operations', () => {
  it('holds every room invariant across 10 seeds x 1200 steps', () => {
    for (let seed = 1; seed <= 10; seed++) soak(seed, 1200);
  }, 30_000);
});
