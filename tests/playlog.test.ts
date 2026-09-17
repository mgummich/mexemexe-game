import { beforeEach, describe, expect, it } from 'vitest';
import { EventBus, type GameEvents } from '../src/core/events';
import type { MatchEvent } from '../src/game-state/match';
import { playlog } from '../src/core/playlog';
import { setProfileForTest } from '../src/ui/viewport';

/**
 * Stands in for a `LocalMatch`: the same `on` contract, driven by hand. The play log subscribes to
 * one match instance rather than to a global bus (ARCH-007), so this is also the shape of the
 * lifecycle the detach tests exercise.
 */
function fakeMatch() {
  const fns = new Set<(e: MatchEvent) => void>();
  return {
    on(fn: (e: MatchEvent) => void) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    emit(event: MatchEvent) {
      for (const fn of [...fns]) fn(event);
    },
  };
}

beforeEach(() => {
  playlog.setEnabled(true);
  playlog.clear();
  playlog.setHumanPlayer(null);
  setProfileForTest({ w: 480, h: 270, portrait: false, touch: false });
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

  it('attachMatch records turn:start/confirmed/drawn/won from real match events', () => {
    const match = fakeMatch();
    playlog.attachMatch(match);
    match.emit({ type: 'turn:start', playerId: 'p1', turn: 1 });
    match.emit({ type: 'turn:confirmed', playerId: 'p1', cardsPlayed: 2 });
    match.emit({ type: 'turn:drawn', playerId: 'p2' });
    match.emit({ type: 'game:won', winnerId: 'p1' });
    // 'mexe:first' rides along with the session's first confirmed turn (TELEMETRY-11).
    expect(playlog.entries().map((e) => e.type)).toEqual(['turn:start', 'turn:confirmed', 'mexe:first', 'turn:drawn', 'game:won']);
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
    const match = fakeMatch();
    playlog.attachMatch(match);
    match.emit({ type: 'turn:confirmed', playerId: 'p0', cardsPlayed: 2 });
    match.emit({ type: 'turn:drawn', playerId: 'p1' });
    match.emit({ type: 'turn:confirmed', playerId: 'p0', cardsPlayed: 1 });
    const { perPlayer } = playlog.summary();
    expect(perPlayer.p0).toEqual({ cardsPlayed: 3, draws: 0, confirms: 2 });
    expect(perPlayer.p1).toEqual({ cardsPlayed: 0, draws: 1, confirms: 0 });
  });

  it('records how long the table stayed invalid, and against which reasons', async () => {
    playlog.noteTableValidity(false, ['reason.groupSize', 'reason.runGap']);
    playlog.noteTableValidity(false, ['reason.groupSize']); // still the same span — no new entry
    await new Promise((r) => setTimeout(r, 20));
    playlog.noteTableValidity(true, []);
    const spans = playlog.entries().filter((e) => e.type === 'table:invalid');
    expect(spans.length).toBe(1);
    expect(spans[0]!.data!.reasons).toBe('reason.groupSize,reason.runGap');
    const summary = playlog.summary();
    expect(summary.tableInvalidTotalMs).toBeGreaterThanOrEqual(15);
    // The whole span is charged to each reason it started with.
    expect(summary.tableInvalidByReason['reason.groupSize']).toBe(summary.tableInvalidTotalMs);
    expect(summary.tableInvalidByReason['reason.runGap']).toBe(summary.tableInvalidTotalMs);
  });

  it('closes an open invalid span at the turn boundary, so an abandoned table still counts', () => {
    const match = fakeMatch();
    playlog.attachMatch(match);
    playlog.noteTableValidity(false, ['reason.groupSize']);
    match.emit({ type: 'turn:drawn', playerId: 'p0' });
    expect(playlog.entries().map((e) => e.type)).toEqual(['table:invalid', 'turn:drawn']);
    expect(playlog.summary().tableInvalidByReason['reason.groupSize']).toBeGreaterThanOrEqual(0);
  });

  it('records drops by outcome and pointer kind, and counts undo-after-drop', () => {
    // The pointer kind is the caller's to know: the log no longer reads the viewport itself.
    playlog.recordDrop('played', 'hand', 'coarse');
    playlog.record('undo'); // regretted that one
    playlog.recordDrop('rejected', 'table', 'coarse');
    playlog.recordDrop('played', 'hand', 'fine');
    const summary = playlog.summary();
    expect(summary.dropsByOutcome).toEqual({ played: 2, rejected: 1 });
    expect(summary.dropsByPointer).toEqual({ coarse: 2, fine: 1 });
    expect(summary.undoAfterDropCount).toBe(1);
  });

  it('counts a late undo as its own action, not as a mis-drop', () => {
    playlog.recordDrop('played', 'hand', 'fine');
    const dropped = playlog.entries()[0]!;
    // Backdate the drop past the mis-drop window instead of waiting three real seconds.
    dropped.t -= 5000;
    playlog.record('undo');
    expect(playlog.summary().undoAfterDropCount).toBe(0);
  });

  it('counts hesitation gaps inside the human turn only, and splits turn duration human vs AI', () => {
    playlog.setHumanPlayer('p0');
    playlog.record('turn:start', { playerId: 'p0', turn: 1 });
    playlog.record('drop', { outcome: 'played' });
    playlog.record('drop', { outcome: 'played' });
    playlog.record('turn:start', { playerId: 'p1', turn: 2, durationMs: 9000 });
    playlog.record('turn:confirmed', { playerId: 'p1' });
    playlog.record('turn:start', { playerId: 'p0', turn: 3, durationMs: 1000 });
    const e = playlog.entries();
    e[2]!.t = e[1]!.t + 4000; // 4s of staring mid-turn (human)
    e[4]!.t = e[3]!.t + 7000; // 7s of AI thinking — not hesitation
    const summary = playlog.summary();
    expect(summary.hesitations).toBe(1);
    expect(summary.hesitationMaxMs).toBe(4000);
    expect(summary.humanTurnDurationMeanMs).toBe(9000);
    expect(summary.aiTurnDurationMeanMs).toBe(1000);
  });

  it('leaves the human/AI split at zero until the human seat is known', () => {
    playlog.setHumanPlayer(null);
    playlog.record('turn:start', { playerId: 'p0', turn: 1 });
    playlog.record('turn:start', { playerId: 'p1', turn: 2, durationMs: 500 });
    const summary = playlog.summary();
    expect(summary.humanTurnDurationMeanMs).toBe(0);
    expect(summary.aiTurnDurationMeanMs).toBe(0);
    expect(summary.hesitations).toBe(0);
    expect(summary.turnDurationMeanMs).toBe(500); // the flat metric still covers everything
  });

  it('marks the first confirmed turn and times the tutorial-to-first-Mexe gap', () => {
    const match = fakeMatch();
    playlog.attachMatch(match);
    playlog.record('tutorial:step', { step: 0 });
    match.emit({ type: 'turn:confirmed', playerId: 'p0', cardsPlayed: 3 });
    match.emit({ type: 'turn:confirmed', playerId: 'p0', cardsPlayed: 1 });
    expect(playlog.entries().filter((e) => e.type === 'mexe:first').length).toBe(1);
    const entries = playlog.entries();
    const tutorial = entries.find((e) => e.type === 'tutorial:step')!;
    const first = entries.find((e) => e.type === 'mexe:first')!;
    expect(playlog.summary().timeToFirstMexeMs).toBe(Math.round(first.t - tutorial.t));
  });

  it('reports no time-to-first-Mexe until a turn is confirmed', () => {
    playlog.record('turn:start', { playerId: 'p0', turn: 1 });
    expect(playlog.summary().timeToFirstMexeMs).toBeNull();
  });

  it('tracks the longest per-player draw streak, broken by a confirmed turn', () => {
    for (const playerId of ['p0', 'p1', 'p0', 'p1', 'p0']) playlog.record('turn:drawn', { playerId });
    playlog.record('turn:confirmed', { playerId: 'p0' });
    playlog.record('turn:drawn', { playerId: 'p0' });
    expect(playlog.summary().drawStreakMax).toBe(3); // p0 drew 3 times before confirming
  });

  it('summarises board samples: hand size, deck remaining and table complexity', () => {
    playlog.recordBoard({ deckRemaining: 40, handSize: 7, tableMelds: 2, tableCards: 7 });
    playlog.recordBoard({ deckRemaining: 31, handSize: 9, tableMelds: 5, tableCards: 18 });
    const summary = playlog.summary();
    expect(summary.boardSamples).toBe(2);
    expect(summary.handSizeMean).toBe(8);
    expect(summary.deckRemainingMin).toBe(31);
    expect(summary.tableMeldsMax).toBe(5);
    expect(summary.tableCardsMax).toBe(18);
    expect(playlog.summary().deckRemainingMin).toBe(31);
  });

  it('reports empty board/table metrics on an untouched log', () => {
    const summary = playlog.summary();
    expect(summary.boardSamples).toBe(0);
    expect(summary.deckRemainingMin).toBeNull();
    expect(summary.tableMeldsMax).toBe(0);
    expect(summary.tableInvalidTotalMs).toBe(0);
    expect(summary.drawStreakMax).toBe(0);
  });

  it('counts zoom steps and orientation flips', () => {
    const bus = new EventBus<GameEvents>();
    playlog.attachAppEvents(bus);
    playlog.record('zoom', { level: 1 });
    playlog.record('zoom', { level: 2 });
    bus.emit('viewport:changed', { portrait: true });
    const summary = playlog.summary();
    expect(summary.zoomChanges).toBe(2);
    expect(summary.orientationFlips).toBe(1);
  });

  it('exports the new fields without leaking a player name', () => {
    playlog.setHumanPlayer('p0');
    playlog.recordDrop('played', 'hand', 'fine');
    playlog.recordBoard({ deckRemaining: 5, handSize: 2, tableMelds: 1, tableCards: 3 });
    playlog.record('turn:confirmed', { playerId: 'p0', name: 'Secret Player' });
    const exported = playlog.exportJson();
    expect(exported).not.toContain('Secret Player');
    expect(JSON.parse(exported).summary.dropsByOutcome).toEqual({ played: 1 });
  });

  it('carries the browser\'s saved game count into the summary and the export', () => {
    expect(playlog.summary().session).toBeNull();
    playlog.setSessionContext({ gamesStarted: 2, tutorialCompleted: true });
    expect(playlog.summary().session).toEqual({ gamesStarted: 2, tutorialCompleted: true });
    // This is the second match on this browser and the tutorial came first — that pair is what
    // tutorial -> first game and first game -> second game are read from.
    expect(JSON.parse(playlog.exportJson()).summary.session).toEqual({ gamesStarted: 2, tutorialCompleted: true });
  });

  it('keeps only the two counts, and forgets them on clear()', () => {
    playlog.setSessionContext({ gamesStarted: 1, tutorialCompleted: false, name: 'Secret Player' } as never);
    expect(playlog.summary().session).toEqual({ gamesStarted: 1, tutorialCompleted: false });
    expect(playlog.exportJson()).not.toContain('Secret Player');
    playlog.clear();
    expect(playlog.summary().session).toBeNull();
  });

  it('exportJson emits nothing once the log is disabled, matching entries()', () => {
    playlog.record('undo');
    playlog.setEnabled(false);
    expect(playlog.entries()).toEqual([]);
    expect(JSON.parse(playlog.exportJson()).entries).toEqual([]);
  });
});
