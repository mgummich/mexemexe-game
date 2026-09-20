/**
 * Server-authoritative turn timer, reconnect grace and anti-stall behaviour.
 *
 * The load-bearing claim these cover is that the client is never the authority: it cannot start,
 * pause, extend or expire a turn, and an expiry can only ever produce the one always-legal move
 * (draw one card, pass) on the server's own turn-start table.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SETTINGS, TIMER_PRESETS, normalizeRoomSettings } from '../../src/net/protocol';
import { testManager } from './manager';

/** A started room with `settings` agreed in the lobby first. Two seats unless asked otherwise. */
function startedRoom(clock: { t: number }, settings = TIMER_PRESETS.fast, code = 'ROOM', seats = 2) {
  const mgr = testManager({ clock, code, seed: 7 });
  const created = mgr.createRoom('Host');
  if (!created.ok) throw new Error('setup');
  for (let i = 1; i < seats; i++) mgr.joinRoom(code, `Guest${i}`);
  mgr.setRoomSettings(code, 0, settings);
  for (let i = 0; i < seats; i++) mgr.setReady(code, i, true);
  const start = mgr.startGame(code, 0);
  if (!start.ok) throw new Error(`setup: ${start.error}`);
  return mgr;
}

describe('room settings lifecycle', () => {
  it('a new room starts on the Casual preset with the deployment reconnect grace', () => {
    const clock = { t: 1000 };
    const mgr = testManager({ clock, code: 'ROOM', disconnectGraceMs: 25_000 });
    mgr.createRoom('Host');
    const info = mgr.getRoomInfo('ROOM')!;
    expect(info.settings.timerMode).toBe('casual');
    expect(info.settings.turnMs).toBe(DEFAULT_ROOM_SETTINGS.turnMs);
    expect(info.settings.reconnectGraceMs).toBe(25_000);
    expect(info.locked).toBe(false);
  });

  it('only the host may change them', () => {
    const clock = { t: 1000 };
    const mgr = testManager({ clock, code: 'ROOM', seed: 7 });
    mgr.createRoom('Host');
    mgr.joinRoom('ROOM', 'Guest');
    expect(mgr.setRoomSettings('ROOM', 1, TIMER_PRESETS.fast)).toEqual({ ok: false, error: 'not_host' });
    expect(mgr.getRoomInfo('ROOM')!.settings.timerMode).toBe('casual');
    expect(mgr.setRoomSettings('ROOM', 0, TIMER_PRESETS.fast).ok).toBe(true);
    expect(mgr.getRoomInfo('ROOM')!.settings).toEqual(TIMER_PRESETS.fast);
  });

  it('an out-of-range proposal is clamped, not applied verbatim', () => {
    const clock = { t: 1000 };
    const mgr = testManager({ clock, code: 'ROOM', seed: 7 });
    mgr.createRoom('Host');
    mgr.setRoomSettings('ROOM', 0, normalizeRoomSettings({ timerMode: 'custom', turnMs: 1 }));
    expect(mgr.getRoomInfo('ROOM')!.settings.turnMs).toBe(5_000);
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

  it.each([3, 4])('times each seat of a %i-player room in turn, on its own fresh budget', (seats) => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast, 'ROOM', seats);
    for (let i = 0; i < seats; i++) {
      expect(mgr.getRoom('ROOM')!.state!.activePlayerIndex).toBe(i);
      // Only the active seat is on a clock: every view reports the same single remaining time.
      expect(mgr.getView('ROOM', (i + 1) % seats)!.turnMsLeft).toBe(45_000);
      clock.t += 45_000;
      expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, timedOut: i }]);
    }
    // Back to seat 0 with a full budget, not a leftover one.
    expect(mgr.getRoom('ROOM')!.state!.activePlayerIndex).toBe(0);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(45_000);
  });

  it('a DONE racing the deadline resolves once: whichever lands first, the other is refused', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    const rev = mgr.getRoom('ROOM')!.rev;
    const hand = mgr.getRoom('ROOM')!.state!.players[0]!.hand.length;

    clock.t += 45_000;
    expect(mgr.advanceStalledTurns()).toHaveLength(1);
    // The DONE was already in flight against the pre-timeout revision: it must not draw a second
    // card or advance the turn a second time.
    expect(mgr.drawEndTurn('ROOM', 0, rev)).toEqual({ ok: false, reasons: ['reason.notYourTurn'] });
    const after = mgr.getRoom('ROOM')!;
    expect(after.state!.players[0]!.hand.length).toBe(hand + 1);
    expect(after.state!.activePlayerIndex).toBe(1);
    expect(after.rev).toBe(rev + 1);
  });

  it('a client cannot extend its turn: only the Mexe bonus moves the deadline, once', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    clock.t += 10_000;
    expect(mgr.getView('ROOM', 0)!.mexeBonusClaimed).toBe(false);
    expect(mgr.claimMexeBonus('ROOM', 0)).toEqual({ ok: true, msLeft: 55_000 });
    // Spamming the claim is a no-op — the bonus is once per turn.
    expect(mgr.claimMexeBonus('ROOM', 0).ok).toBe(false);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(55_000);
    // ONLINE-09: the view carries the grant explicitly, for every seat, not just the claimant —
    // this is what lets a client show a one-time "extension granted" notice off the false->true edge.
    expect(mgr.getView('ROOM', 0)!.mexeBonusClaimed).toBe(true);
    expect(mgr.getView('ROOM', 1)!.mexeBonusClaimed).toBe(true);
  });

  it('a seat that is not the active one gains nothing by claiming the bonus', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    expect(mgr.claimMexeBonus('ROOM', 1).ok).toBe(false);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBe(45_000);
  });

  it('LB-14: the active chair in a gapped room can claim the bonus, and an idle chair still cannot', () => {
    // Seats 0 and 2 with the gap at 1: chair 2 is player index 1, so a server comparing the chair
    // number against the active player index would refuse the claim its own timer is offering.
    const clock = { t: 1000 };
    const mgr = testManager({ clock, code: 'GAP', seed: 7 });
    mgr.createRoom('Host');
    mgr.joinRoom('GAP', 'Bob');
    mgr.joinRoom('GAP', 'Carol');
    mgr.leaveRoom('GAP', 1);
    mgr.setRoomSettings('GAP', 0, TIMER_PRESETS.fast);
    mgr.setReady('GAP', 0, true);
    mgr.setReady('GAP', 2, true);
    expect(mgr.startGame('GAP', 0)).toMatchObject({ ok: true });
    mgr.drawEndTurn('GAP', 0, mgr.getRoom('GAP')!.rev); // hand the turn to chair 2
    expect(mgr.getRoom('GAP')!.state!.activePlayerIndex).toBe(1);
    expect(mgr.claimMexeBonus('GAP', 0).ok).toBe(false); // chair 0 is not on the clock
    expect(mgr.claimMexeBonus('GAP', 2).ok).toBe(true);
  });

  it('the bonus is available again on the next turn, not carried over', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    expect(mgr.claimMexeBonus('ROOM', 0).ok).toBe(true);
    mgr.drawEndTurn('ROOM', 0, mgr.getRoom('ROOM')!.rev);
    // The view flag resets with the turn, same as the underlying grant.
    expect(mgr.getView('ROOM', 1)!.mexeBonusClaimed).toBe(false);
    expect(mgr.claimMexeBonus('ROOM', 1).ok).toBe(true);
  });

  it('an Off room grants no bonus at all', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.off);
    expect(mgr.claimMexeBonus('ROOM', 0)).toEqual({ ok: false, msLeft: null });
  });

  it('a finished match has no clock left running behind the results screen', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, TIMER_PRESETS.fast);
    // Drain the draw pile, then run past the consecutive-empty-draw threshold: the cheapest way
    // to reach `phase: 'finished'` through the public API only.
    let room = mgr.getRoom('ROOM')!;
    let rev = room.rev;
    let gameOver = false;
    for (let i = 0; i < 200 && !gameOver; i++) {
      const result = mgr.drawEndTurn('ROOM', room.state!.activePlayerIndex, rev);
      expect(result.ok).toBe(true);
      if (result.ok) gameOver = result.gameOver;
      rev++;
      room = mgr.getRoom('ROOM')!;
    }
    expect(gameOver).toBe(true);
    expect(mgr.getView('ROOM', 0)!.turnMsLeft).toBeNull();
    // And nothing ticks after it: no expiry on a match that is already over.
    clock.t += 10 * 60_000;
    expect(mgr.advanceStalledTurns()).toEqual([]);
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

  it('ONLINE-14: the public view carries each seat\'s missed-turn count, for every viewer', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(clock, normalizeRoomSettings({ ...TIMER_PRESETS.fast, timerMode: 'custom', missedTurnLimit: 2 }));
    expect(mgr.getView('ROOM', 0)!.missedTurns).toEqual([0, 0]);
    clock.t += 45_000;
    mgr.advanceStalledTurns(); // seat 0 misses once
    // Both seats' views agree, and it is seat 0 that ticked up — the data a client needs to warn
    // "N more and the match ends" without guessing who is at risk.
    expect(mgr.getView('ROOM', 0)!.missedTurns).toEqual([1, 0]);
    expect(mgr.getView('ROOM', 1)!.missedTurns).toEqual([1, 0]);
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

describe('a timeout that both finishes the match and crosses the missed-turn limit', () => {
  it('reports the finish, not a closed room — the match has a winner to render', () => {
    const clock = { t: 1000 };
    const mgr = startedRoom(
      clock,
      normalizeRoomSettings({ ...TIMER_PRESETS.fast, timerMode: 'custom', missedTurnLimit: 1 }),
    );
    // Drain the pile with real draws, so both streaks are 0 and the next timeout is each seat's
    // first miss. Draw-pile exhaustion is what ends the match on that timeout.
    for (let seat = 0; mgr.getRoom('ROOM')!.state!.drawPile.length > 0; seat ^= 1) {
      const result = mgr.drawEndTurn('ROOM', seat, mgr.getRoom('ROOM')!.rev);
      if (!result.ok) throw new Error(`drain: ${result.reasons.join(',')}`);
    }
    clock.t += 45_000;
    const advanced = mgr.advanceStalledTurns();
    expect(advanced).toEqual([{ code: 'ROOM', gameOver: true, timedOut: 0 }]);
    // The room survives the finish exactly as any other match's does, so game_over can be
    // broadcast and the lobby recycled for a rematch.
    expect(mgr.getRoomInfo('ROOM')).not.toBeNull();
  });
});

describe('a gapped match on the clock', () => {
  it('times out the chair whose turn it is, not the player index that shares its number', () => {
    const clock = { t: 1000 };
    const mgr = testManager({ clock, code: 'ROOM', seed: 7 });
    mgr.createRoom('Alice'); // chair 0
    mgr.joinRoom('ROOM', 'Bob'); // chair 1
    mgr.joinRoom('ROOM', 'Carol'); // chair 2
    mgr.leaveRoom('ROOM', 1); // chairs 0 and 2 remain: player index 1 is chair 2
    mgr.setRoomSettings('ROOM', 0, TIMER_PRESETS.fast);
    mgr.setReady('ROOM', 0, true);
    mgr.setReady('ROOM', 2, true);
    mgr.startGame('ROOM', 0);
    mgr.drawEndTurn('ROOM', 0, mgr.getRoom('ROOM')!.rev); // chair 2 is now on the clock
    clock.t += 45_000;
    // The room seat on the wire is chair 2, and the streak lands on player index 1 in the view.
    expect(mgr.advanceStalledTurns()).toEqual([{ code: 'ROOM', gameOver: false, timedOut: 2 }]);
    expect(mgr.getView('ROOM', 0)!.missedTurns).toEqual([0, 1]);
  });
});
