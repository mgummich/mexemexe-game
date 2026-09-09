import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../src/core/events';
import { playlog } from '../src/core/playlog';

beforeEach(() => {
  playlog.setEnabled(true);
  playlog.clear();
});

describe('playlog', () => {
  it('records events in order', () => {
    playlog.record('undo');
    playlog.record('redo');
    playlog.record('reset');
    expect(playlog.entries().map((e) => e.type)).toEqual(['undo', 'redo', 'reset']);
  });

  it('does nothing and never throws while disabled', () => {
    playlog.setEnabled(false);
    expect(() => playlog.record('undo', { name: 'x' })).not.toThrow();
    expect(playlog.entries()).toEqual([]);
  });

  it('caps the ring buffer and drops the oldest', () => {
    for (let i = 0; i < 2005; i++) playlog.record('turn:drawn', { i });
    const all = playlog.entries();
    expect(all.length).toBe(2000);
    expect(all[0]!.data!.i).toBe(5); // first 5 dropped
    expect(all[all.length - 1]!.data!.i).toBe(2004);
  });

  it('strips name/token-shaped keys from recorded data', () => {
    playlog.record('undo', { name: 'Secret Player', playerName: 'x', token: 'abc', sessionToken: 'xyz', turn: 3 });
    expect(playlog.entries()[0]!.data).toEqual({ turn: 3 });
  });

  it('never includes those keys in the export either', () => {
    playlog.record('undo', { name: 'Secret Player' });
    const exported = playlog.exportJson();
    expect(exported).not.toContain('Secret Player');
  });

  it('groups invalid FEITO attempts and proposal rejects by reason', () => {
    playlog.record('feito:blocked', { reasons: 'reason.groupDuplicateSuit' });
    playlog.record('feito:blocked', { reasons: 'reason.groupDuplicateSuit' });
    playlog.record('feito:blocked', { reasons: 'reason.groupSize' });
    playlog.record('net:reject', { reason: 'notYourTurn' });
    const summary = playlog.summary();
    expect(summary.invalidFeitoByReason).toEqual({ 'reason.groupDuplicateSuit': 2, 'reason.groupSize': 1 });
    expect(summary.proposalRejectsByReason).toEqual({ notYourTurn: 1 });
  });

  it('attachToBus records turn:start/confirmed/drawn/won from real bus events', () => {
    const bus = new EventBus<GameEvents>();
    playlog.attachToBus(bus);
    bus.emit('turn:start', { playerId: 'p1', turn: 1 });
    bus.emit('turn:confirmed', { playerId: 'p1', cardsPlayed: 2 });
    bus.emit('turn:drawn', { playerId: 'p2' });
    bus.emit('game:won', { winnerId: 'p1' });
    expect(playlog.entries().map((e) => e.type)).toEqual(['turn:start', 'turn:confirmed', 'turn:drawn', 'game:won']);
  });

  it('computes turn duration mean/max from turn:start durationMs fields', () => {
    playlog.record('turn:start', { turn: 1 });
    playlog.record('turn:start', { turn: 2, durationMs: 100 });
    playlog.record('turn:start', { turn: 3, durationMs: 300 });
    const summary = playlog.summary();
    expect(summary.totalTurns).toBe(3);
    expect(summary.turnDurationMeanMs).toBe(200);
    expect(summary.turnDurationMaxMs).toBe(300);
  });

  it('exportJson returns parseable JSON and never throws, even on unserializable data', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    playlog.record('undo', { bad: circular as unknown as string });
    expect(() => playlog.exportJson()).not.toThrow();
    const parsed = JSON.parse(playlog.exportJson());
    expect(parsed.version).toBe(1);
    expect(parsed.startedAt).toBeNull();
  });

  it('summary().perPlayer groups cardsPlayed/draws/confirms by playerId from real bus events', () => {
    const bus = new EventBus<GameEvents>();
    playlog.attachToBus(bus);
    bus.emit('turn:confirmed', { playerId: 'p0', cardsPlayed: 2 });
    bus.emit('turn:drawn', { playerId: 'p1' });
    bus.emit('turn:confirmed', { playerId: 'p0', cardsPlayed: 1 });
    const { perPlayer } = playlog.summary();
    expect(perPlayer.p0).toEqual({ cardsPlayed: 3, draws: 0, confirms: 2 });
    expect(perPlayer.p1).toEqual({ cardsPlayed: 0, draws: 1, confirms: 0 });
  });

  it('exportJson emits nothing once the log is disabled, matching entries()', () => {
    playlog.record('undo');
    playlog.setEnabled(false);
    expect(playlog.entries()).toEqual([]);
    expect(JSON.parse(playlog.exportJson()).entries).toEqual([]);
  });
});
