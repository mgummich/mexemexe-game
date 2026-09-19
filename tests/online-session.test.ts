import { describe, expect, it } from 'vitest';
import { OnlineSession } from '../src/net/online-session';
import { buildView, DEFAULT_ROOM_SETTINGS, type GameView, type RoomSettings } from '../src/net/protocol';
import type { GameState } from '../src/rules/types';
import { gameState as state } from './helpers/scenarios';

/**
 * The online client's application layer, driven by recorded server frames with no socket, no
 * Phaser and no clock (ARCH-002). Every question a scene used to answer inline — stale frame,
 * desync, dropped draft, seat gap, missed-turn limit — is asked of the session here.
 */

interface ViewOpts {
  seat?: number;
  rev?: number;
  settings?: RoomSettings;
  turnMsLeft?: number | null;
  missedTurns?: number[];
  mexeBonusClaimed?: boolean;
  seats?: number[];
}

function view(s: GameState, opts: ViewOpts = {}): GameView {
  return buildView(
    s, opts.seat ?? 0, opts.rev ?? 1, opts.settings ?? DEFAULT_ROOM_SETTINGS, opts.turnMsLeft ?? null,
    opts.missedTurns ?? [0, 0], opts.mexeBonusClaimed ?? false, 'm1', opts.seats ?? [0, 1],
  );
}

function session(opts: ViewOpts = {}): OnlineSession {
  return new OnlineSession({ view: view(state(), opts), seat: opts.seat ?? 0, code: 'ABCDE' });
}

describe('OnlineSession', () => {
  it('opens on the server view it was handed', () => {
    const s = session();
    expect(s.state().activePlayerIndex).toBe(0);
    expect(s.lastRev).toBe(1);
    expect(s.matchId).toBe('m1');
    expect(s.code).toBe('ABCDE');
  });

  it('accepts a fresh frame and reports who acted and whether play continues', () => {
    const s = session();
    const next = state({ activePlayerIndex: 1, turn: 4 });
    const result = s.applySync(view(next, { rev: 2, turnMsLeft: 30_000 }), false);
    expect(result).toMatchObject({ kind: 'applied', actingSeat: 0, draftDropped: false, playing: true, turnMsLeft: 30_000 });
    expect(s.state().activePlayerIndex).toBe(1);
    expect(s.lastRev).toBe(2);
  });

  it('ignores an out-of-order frame older than the one already applied', () => {
    const s = session({ rev: 5 });
    const stale = view(state({ activePlayerIndex: 1 }), { rev: 4 });
    expect(s.applySync(stale, false)).toEqual({ kind: 'stale' });
    expect(s.state().activePlayerIndex).toBe(0); // untouched
    expect(s.lastRev).toBe(5);
  });

  it('asks for a resync when the local reconstruction does not hash to the server digest', () => {
    const s = session();
    // A frame whose digest was computed for a different revision: exactly the shape of a client
    // that can no longer be trusted to render or propose.
    const bad = { ...view(state(), { rev: 2 }), hash: 'deadbeef' };
    const result = s.applySync(bad, false);
    expect(result.kind).toBe('desync');
    expect(s.desyncs).toBe(1);
    expect(s.resyncing).toBe(true);
  });

  // The state digest cannot see this class of fault: both sides hash the same `activeSeat` field,
  // so a seat pointing at no player agrees with itself and sails through the desync check. Without
  // the projection check the session would hold a state whose active player is `undefined`.
  it.each([
    ['negative', -1],
    ['one past the last seat', 2],
    ['far out of range', 99],
    ['not an integer', 0.5],
  ])('refuses a frame whose activeSeat is %s, leaving the last good state applied', (_label, activeSeat) => {
    const s = session();
    const result = s.applySync({ ...view(state({ turn: 4 }), { rev: 2 }), activeSeat }, false);

    expect(result).toEqual({ kind: 'invalid', rev: 2, problem: `activeSeat ${activeSeat} outside 0..1` });
    expect(s.state().activePlayerIndex).toBe(0);
    expect(s.state().turn).toBe(1); // the rejected frame's turn never landed
    expect(s.lastRev).toBe(1); // nothing applied, so the next honest frame at rev 2 is not stale
  });

  it('accepts every in-range activeSeat', () => {
    for (const activeSeat of [0, 1]) {
      const s = session();
      expect(s.applySync(view(state({ activePlayerIndex: activeSeat }), { rev: 2 }), false).kind).toBe('applied');
      expect(s.state().activePlayerIndex).toBe(activeSeat);
    }
  });

  it('takes the second mismatching snapshot rather than looping on resync requests', () => {
    const s = session();
    s.applySync({ ...view(state(), { rev: 2 }), hash: 'deadbeef' }, false);
    const second = s.applySync({ ...view(state({ turn: 4 }), { rev: 3 }), hash: 'deadbeef' }, false);
    expect(second.kind).toBe('applied');
    expect(s.desyncs).toBe(2);
    expect(s.resyncing).toBe(false);
  });

  it('reports a dropped draft, and gives it priority over the Mexe bonus notice', () => {
    const s = session();
    const result = s.applySync(view(state({ turn: 4 }), { rev: 2, mexeBonusClaimed: true }), true);
    expect(result).toMatchObject({ kind: 'applied', draftDropped: true, mexeBonusMs: null });
  });

  it('reports the Mexe bonus once, on the false->true edge only', () => {
    const s = session();
    const first = s.applySync(view(state({ turn: 4 }), { rev: 2, mexeBonusClaimed: true }), false);
    expect(first).toMatchObject({ mexeBonusMs: DEFAULT_ROOM_SETTINGS.mexeBonusMs });
    const second = s.applySync(view(state({ turn: 5 }), { rev: 3, mexeBonusClaimed: true }), false);
    expect(second).toMatchObject({ mexeBonusMs: null });
  });

  it('translates room seats to dense player indices across a seat gap', () => {
    const s = session({ seats: [1, 3] });
    expect(s.playerIndexOf(1)).toBe(0);
    expect(s.playerIndexOf(3)).toBe(1);
    // A seat the view does not know falls back to the identity mapping.
    expect(s.playerIndexOf(2)).toBe(2);
  });

  it('re-reads the seat map from every frame', () => {
    const s = session({ seats: [0, 1] });
    s.applySync(view(state({ turn: 4 }), { rev: 2, seats: [2, 3] }), false);
    expect(s.playerIndexOf(3)).toBe(1);
  });

  it('asks for a resync only when the refusal says this client is behind', () => {
    const s = session();
    expect(s.rejection(['reason.staleRevision']).requestResync).toBe(true);
    expect(s.rejection(['reason.notYourTurn']).requestResync).toBe(false);
  });

  it('calls a timeout on the still-active seat the one that ends the match', () => {
    const s = session({ missedTurns: [2, 0] });
    // Seat 0 is active and timed out: no state_sync will move play off it, so this is the miss
    // that closed the room (ONLINE-14).
    expect(s.timeout(0)).toEqual({ seat: 0, endsMatch: true, warning: null });
  });

  it('warns with the remaining allowance when the match continues', () => {
    const s = session({ missedTurns: [0, 2] });
    const limit = DEFAULT_ROOM_SETTINGS.missedTurnLimit;
    expect(s.timeout(1)).toEqual({ seat: 1, endsMatch: false, warning: { missed: 2, left: limit - 2 } });
  });

  it('adopts the final frame on game over', () => {
    const s = session();
    const finished = state({ phase: 'finished', winnerId: 'p1', turn: 9 });
    expect(s.applyGameOver(view(finished, { rev: 9 })).winnerId).toBe('p1');
  });
});
