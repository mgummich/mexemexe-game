import { describe, expect, it } from 'vitest';
import { LocalMatch, type MatchEvent } from '../src/game-state/match';
import type { GameState } from '../src/rules/types';
import { gameState as state, legalDraft, oneCardFromWinning } from './helpers/scenarios';

/**
 * The local match orchestration, exercised with no Phaser anywhere in the process (ARCH-001).
 * This is the seam a long-lived gameplay test should be written against: an action goes in, an
 * outcome and a set of announced facts come out.
 */

function newMatch(patch: Partial<GameState> = {}) {
  const match = new LocalMatch(state(patch), { localSeat: 0, personalities: [null, 'cida'] });
  const seen: MatchEvent[] = [];
  match.on((e) => seen.push(e));
  return { match, seen, types: () => seen.map((e) => e.type) };
}

describe('LocalMatch', () => {
  it('confirms a legal turn, advances the cycle and announces both facts', () => {
    const { match, types } = newMatch();
    const out = match.dispatch({ type: 'confirmTurn', actorIndex: 0, draft: legalDraft(match.state()) });
    expect(out).toMatchObject({ ok: true, actorId: 'p0', cardsPlayed: 1, finished: false });
    expect(match.state().activePlayerIndex).toBe(1);
    expect(types()).toEqual(['turn:confirmed', 'turn:start']);
  });

  it('draws and passes the turn', () => {
    const { match, types } = newMatch();
    expect(match.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 }).ok).toBe(true);
    expect(match.state().players[0]!.hand).toHaveLength(4);
    expect(types()).toEqual(['turn:drawn', 'turn:start']);
  });

  it('announces the finish instead of the next turn', () => {
    const { match, seen, types } = newMatch({ drawPile: [] });
    expect(match.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 }).ok).toBe(true);
    expect(types()).toEqual(['turn:drawn', 'game:won']);
    expect(seen.at(-1)).toMatchObject({ type: 'game:won' });
  });

  it('announces the win when the last hand card is played out, not another turn', () => {
    const match = new LocalMatch(oneCardFromWinning(), { localSeat: 0, personalities: [null, 'cida'] });
    const seen: MatchEvent[] = [];
    match.on((e) => seen.push(e));
    const out = match.dispatch({ type: 'confirmTurn', actorIndex: 0, draft: legalDraft(match.state()) });
    expect(out).toMatchObject({ ok: true, finished: true });
    expect(match.state()).toMatchObject({ phase: 'finished', winnerId: 'p0' });
    expect(seen.map((e) => e.type)).toEqual(['turn:confirmed', 'game:won']);
  });

  it('refuses an out-of-turn action, changes nothing and announces nothing', () => {
    const { match, types } = newMatch();
    const before = match.state();
    expect(match.dispatch({ type: 'drawAndEndTurn', actorIndex: 1 })).toEqual({
      ok: false, reasons: ['reason.notYourTurn'],
    });
    expect(match.state()).toBe(before);
    expect(types()).toEqual([]);
  });

  it('routes an AI decision through the same action path a person takes', async () => {
    const { match, types } = newMatch({ activePlayerIndex: 1 });
    const result = await match.runAiTurn('cida', 'smart');
    expect(result.kind).toBe('acted');
    expect(result.kind === 'acted' && result.outcome.ok).toBe(true);
    // Whatever the engine chose, the match moved on by exactly one turn and said so once.
    expect(match.state().activePlayerIndex).toBe(0);
    expect(types()).toHaveLength(2);
    expect(types()[1]).toBe('turn:start');
  });

  it('a disposed match accepts no further action and announces nothing', () => {
    const { match, types } = newMatch();
    match.dispose();
    expect(match.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 }).ok).toBe(false);
    expect(match.state().turn).toBe(1);
    expect(types()).toEqual([]);
  });

  it('drops an AI decision that finished after the match was disposed', async () => {
    const { match } = newMatch({ activePlayerIndex: 1 });
    const pending = match.runAiTurn('bia', 'expert');
    match.dispose();
    expect((await pending).kind).toBe('stale');
    expect(match.state().activePlayerIndex).toBe(1);
  });

  it('a listener on a finished match never hears the next one', () => {
    const first = new LocalMatch(state(), { localSeat: 0, personalities: [null, 'cida'] });
    let heard = 0;
    first.on(() => heard++);
    first.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(heard).toBe(2);
    first.dispose();
    const second = new LocalMatch(state(), { localSeat: 0, personalities: [null, 'cida'] });
    second.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(heard).toBe(2); // the notifications are per-match, not per-process (ARCH-007)
    expect(second.state().turn).toBe(2);
  });

  it('detaching stops delivery without affecting the match', () => {
    const { match } = newMatch();
    let heard = 0;
    const off = match.on(() => heard++);
    off();
    expect(match.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 }).ok).toBe(true);
    expect(heard).toBe(0);
  });

  it('records the actions it accepted as a replay', () => {
    const { match } = newMatch();
    match.dispatch({ type: 'drawAndEndTurn', actorIndex: 1 }); // refused
    match.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(match.replay().actions).toHaveLength(1);
  });
});
