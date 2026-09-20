import { describe, expect, it } from 'vitest';
import { LocalMatch, type MatchEvent } from '../src/game-state/match';
import { DraftEditor } from '../src/mexe-mode/draft';
import { validateTable } from '../src/rules/rules';
import type { GameState } from '../src/rules/types';
import { n } from './helpers/cards';
import { allCards, expectCardConservation } from './helpers/invariants';
import { gameState as state, legalDraft, oneCardFromWinning, tableRearrangement } from './helpers/scenarios';

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

    // The match is over for everyone, including the seat the turn passed to (INV-S4).
    const finished = match.state();
    expect(match.dispatch({ type: 'drawAndEndTurn', actorIndex: 1 })).toEqual({
      ok: false, reasons: ['reason.notYourTurn'],
    });
    expect(match.state()).toBe(finished);
    expect(seen).toHaveLength(2);
  });

  /**
   * SCN-09/SCN-12 at the application level: a real `DraftEditor` sequence — the same calls the
   * table makes when a player drags cards — goes through the ordinary dispatch path. The rule
   * cases live in `rules`/`draft`; what this proves is that the editor, the kernel and the match
   * agree about one non-trivial turn, and that nothing is lost between them.
   */
  it('commits a Mexe rearrangement built by the real editor, conserving every card', () => {
    const start = tableRearrangement();
    const match = new LocalMatch(start, { localSeat: 0, personalities: [null, 'cida'] });
    const before = allCards(start).map((c) => c.id);

    const editor = new DraftEditor(start);
    editor.playHandCard('hearts-2-d0', 't1', 0); // extend the committed run downwards
    editor.playHandCard('spades-9-d0', null); // ...and build a second meld from scratch
    const group = editor.getDraft().melds.find((m) => m.id !== 't1')!.id;
    editor.playHandCard('clubs-9-d0', group);
    editor.playHandCard('diamonds-9-d0', group);

    const out = match.dispatch({ type: 'confirmTurn', actorIndex: 0, draft: editor.getDraft() });
    expect(out).toMatchObject({ ok: true, cardsPlayed: 4, finished: false });
    expect(validateTable(match.state().table)).toBe(true);
    expectCardConservation(match.state(), before);
    expect(match.state().players[0]!.hand.map((c) => c.id)).toEqual(['hearts-6-d0']);
    expect(match.state().activePlayerIndex).toBe(1);
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

  it('draws instead of keeping the turn when the rules refuse an AI confirm', async () => {
    // A refusal cannot be produced from a legal board — every candidate the engine offers has
    // already passed `DraftEditor.canConfirm` — so the disagreement is staged. What must hold is
    // that the seat does not keep the turn: an engine/rules bug costs a card, not the match.
    const { match, types } = newMatch({
      activePlayerIndex: 1,
      players: [
        { id: 'p0', name: 'A', isAi: false, hand: [n('spades', 9)] },
        { id: 'p1', name: 'B', isAi: true, hand: [n('hearts', 2), n('hearts', 6)] },
      ],
    });
    const real = match.dispatch.bind(match);
    let refused = false;
    match.dispatch = (action) => {
      if (action.type === 'confirmTurn' && !refused) {
        refused = true;
        return { ok: false, reasons: ['reason.notAMeld'] };
      }
      return real(action);
    };
    const result = await match.runAiTurn('cida', 'smart');
    expect(refused).toBe(true); // the engine did propose a confirm, so the guard was the path taken
    expect(result.kind).toBe('fallback');
    expect(result.kind === 'fallback' && result.outcome.ok).toBe(true);
    expect(match.state().activePlayerIndex).toBe(0);
    expect(types()).toEqual(['turn:drawn', 'turn:start']);
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
