/**
 * Server-authoritative turn timer, reconnect grace and anti-stall behaviour.
 *
 * The load-bearing claim these cover is that the client is never the authority: it cannot start,
 * pause, extend or expire a turn, and an expiry can only ever produce the one always-legal move
 * (draw one card, pass) on the server's own turn-start table.
 */
import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms';
import { DEFAULT_ROOM_SETTINGS, TIMER_PRESETS, normalizeRoomSettings } from '../../src/net/protocol';

function manager(clock: { t: number }, code = 'ROOM') {
  let tokens = 0;
  return new RoomManager({
    now: () => clock.t,
    genCode: () => code,
    genToken: () => `TOKEN${++tokens}`,
    genSeed: () => 7,
  });
}

/** A started 2-seat room with `settings` agreed in the lobby first. */
function startedRoom(clock: { t: number }, settings = TIMER_PRESETS.fast, code = 'ROOM') {
  const mgr = manager(clock, code);
  const created = mgr.createRoom('Host');
  if (!created.ok) throw new Error('setup');
  mgr.joinRoom(code, 'Guest');
  mgr.setRoomSettings(code, 0, settings);
  mgr.setReady(code, 0, true);
  mgr.setReady(code, 1, true);
  const start = mgr.startGame(code, 0);
  if (!start.ok) throw new Error(`setup: ${start.error}`);
  return mgr;
}

describe('room settings lifecycle', () => {
  it('a new room starts on the Casual preset with the deployment reconnect grace', () => {
    const clock = { t: 1000 };
    const mgr = new RoomManager({ now: () => clock.t, genCode: () => 'ROOM', disconnectGraceMs: 25_000 });
    mgr.createRoom('Host');
    const info = mgr.getRoomInfo('ROOM')!;
    expect(info.settings.timerMode).toBe('casual');
    expect(info.settings.turnMs).toBe(DEFAULT_ROOM_SETTINGS.turnMs);
    expect(info.settings.reconnectGraceMs).toBe(25_000);
    expect(info.locked).toBe(false);
  });

  it('only the host may change them', () => {
    const clock = { t: 1000 };
    const mgr = manager(clock);
    mgr.createRoom('Host');
    mgr.joinRoom('ROOM', 'Guest');
    expect(mgr.setRoomSettings('ROOM', 1, TIMER_PRESETS.fast)).toEqual({ ok: false, error: 'not_host' });
    expect(mgr.getRoomInfo('ROOM')!.settings.timerMode).toBe('casual');
    expect(mgr.setRoomSettings('ROOM', 0, TIMER_PRESETS.fast).ok).toBe(true);
    expect(mgr.getRoomInfo('ROOM')!.settings).toEqual(TIMER_PRESETS.fast);
  });

  it('an out-of-range proposal is clamped, not applied verbatim', () => {
    const clock = { t: 1000 };
    const mgr = manager(clock);
    mgr.createRoom('Host');
    mgr.setRoomSettings('ROOM', 0, normalizeRoomSettings({ timerMode: 'custom', turnMs: 1 }));
    expect(mgr.getRoomInfo('ROOM')!.settings.turnMs).toBe(15_000);
  });

  it('fairness settings lock the moment the match starts', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    expect(mgr.getRoomInfo('ROOM')!.locked).toBe(true);
    expect(mgr.setRoomSettings('ROOM', 0, TIMER_PRESETS.off)).toEqual({ ok: false, error: 'game_started' });
    expect(mgr.getRoomInfo('ROOM')!.settings).toEqual(TIMER_PRESETS.fast);
  });
});

describe('server-authoritative turn timer', () => {
  it('starts the clock at match start and reports the remaining time in the view', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(45_000);
    clock.t += 5_000;
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(40_000);
  });

  it('an Off room reports no clock and never times a turn out', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.off);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBeNull();
    clock.t += 10 * 60_000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
    expect(mgr.getRoom('ROOM')!.state!.activePlayerIndex).toBe(0);
  });

  it('expiry draws one card and passes — nothing else', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    const before = mgr.getRoom('ROOM')!.state!;
    const table = before.table;
    const rev = mgr.getRoom('ROOM')!.rev;
    const drawPile = before.drawPile.length;
    const hand = before.players[0]!.hand.length;

    clock.t += 45_000;
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, timedOut: 0 }]);

    const after = mgr.getRoom('ROOM')!.state!;
    expect(after.activePlayerIndex).toBe(1);
    expect(after.players[0]!.hand.length).toBe(hand + 1);
    expect(after.drawPile.length).toBe(drawPile - 1);
    // The table is untouched: a draft never leaves the client until FEITO, so there is no
    // half-finished rearrangement a timeout could ever commit.
    expect(after.table).toEqual(table);
    expect(mgr.getRoom('ROOM')!.rev).toBe(rev + 1);
  });

  it('applies exactly once — a second tick at the same instant does nothing', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    clock.t += 45_000;
    expect(mgr.advanceStalledTurns()).toHaveLength(1);
    expect(mgr.advanceStalledTurns()).toEqual([]);
    expect(mgr.getRoom('ROOM')!.state!.activePlayerIndex).toBe(1);
  });

  it('a turn actually taken restarts the clock for the next seat', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    clock.t += 40_000;
    const rev = mgr.getRoom('ROOM')!.rev;
    expect(mgr.drawEndTurn('ROOM', 0, rev).ok).toBe(true);
    expect(mgr.getView('ROOM', 1)!.turnMsLeft).toBe(45_000);
  });

  it('a client cannot extend its turn: only the Mexe bonus moves the deadline, once', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    clock.t += 10_000;
    expect(mgr.claimMexeBonus('ROOM', 0)).toEqual({ ok: true, msLeft: 55_000 });
    // Spamming the claim is a no-op — the bonus is once per turn.
    expect(mgr.claimMexeBonus('ROOM', 0).ok).toBe(false);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(55_000);
  });

  it('a seat that is not the active one gains nothing by claiming the bonus', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    expect(mgr.claimMexeBonus('ROOM', 1).ok).toBe(false);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(45_000);
  });

  it('the bonus is available again on the next turn, not carried over', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    expect(mgr.claimMexeBonus('ROOM', 0).ok).toBe(true);
    mgr.drawEndTurn('ROOM', 0, mgr.getRoom('ROOM')!.rev);
    expect(mgr.claimMexeBonus('ROOM', 1).ok).toBe(true);
  });

  it('an Off room grants no bonus at all', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.off);
    expect(mgr.claimMexeBonus('ROOM', 0)).toEqual({ ok: false, msLeft: null });
  });

  it('the clock is gone with the room — a deleted room leaves nothing to tick', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    mgr.deleteRoom('ROOM');
    clock.t += 10 * 60_000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
    expect(mgr.getRoomInfo('ROOM')).toBeNull();
  });
});

describe('reconnect grace and anti-stall', () => {
  it('holds a disconnected seat for the room\'s grace, then plays its turn', () => {
    const clock = { t: 1000 };
    // A named preset carries its own grace, so this has to be a custom room to pin 30s.
    const mgr = startedRoom(clock, normalizeRoomSettings({ timerMode: 'custom', turnMs: 600_000, reconnectGraceMs: 30_000 }));
    mgr.disconnect('ROOM', 0);
    clock.t += 20_000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
    clock.t += 15_000;
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, timedOut: 0 }]);
  });

  it('a reconnect resumes the running clock rather than restarting it', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    mgr.disconnect('ROOM', 0);
    clock.t += 20_000;
    const result = mgr.reconnect('TOKEN1');
    if (!result.ok) throw new Error('reconnect failed');
    expect(result.view!.turnMsLeft).toBe(25_000);
  });

  it('repeated reconnects cannot hold a turn open forever', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, normalizeRoomSettings({ ...TIMER_PRESETS.fast, timerMode: 'custom', missedTurnLimit: 10 }));
    for (let i = 0; i < 4; i++) {
      mgr.disconnect('ROOM', 0);
      clock.t += 5_000;
      mgr.reconnect('TOKEN1');
    }
    clock.t += 25_000; // 45s of turn budget has now elapsed across the hops
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, timedOut: 0 }]);
  });

  it('ends the match once a seat passes the missed-turn limit', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, normalizeRoomSettings({ ...TIMER_PRESETS.fast, timerMode: 'custom', missedTurnLimit: 2 }));
    // Seat 0 misses, seat 1 misses, seat 0 misses again — that is two in a row for seat 0.
    for (let i = 0; i < 2; i++) {
      clock.t += 45_000;
      expect(mgr.advanceStalledTurns()).toHaveLength(1);
    }
    clock.t += 45_000;
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, closed: true, timedOut: 0 }]);
    expect(mgr.getRoomInfo('ROOM')).toBeNull();
  });

  it('a turn the seat actually takes clears its missed-turn streak', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, normalizeRoomSettings({ ...TIMER_PRESETS.fast, timerMode: 'custom', missedTurnLimit: 2 }));
    clock.t += 45_000;
    mgr.advanceStalledTurns(); // seat 0 misses once
    // seat 1 plays, then seat 0 plays: the streak is broken, so the next miss is not the second.
    mgr.drawEndTurn('ROOM', 1, mgr.getRoom('ROOM')!.rev);
    mgr.drawEndTurn('ROOM', 0, mgr.getRoom('ROOM')!.rev);
    clock.t += 45_000;
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, timedOut: 1 }]);
    expect(mgr.getRoomInfo('ROOM')).not.toBeNull();
  });

  it('never fires while nobody else is connected — an empty room is the sweep\'s job', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    mgr.disconnect('ROOM', 0);
    mgr.disconnect('ROOM', 1);
    clock.t += 60_000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
  });
});
