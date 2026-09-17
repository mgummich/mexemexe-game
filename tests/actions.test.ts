import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../src/core/events';
import { applyGameAction } from '../src/game-state/actions';
import { GameStore } from '../src/game-state/store';
import { DraftEditor } from '../src/mexe-mode/draft';
import type { GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { n } from './helpers/cards';

/** Seat 0 can extend the table run with hearts-2; seat 1 is an AI seat holding one card. */
function state(): GameState {
  return {
    seed: 1,
    players: [
      { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2), n('spades', 9), n('clubs', 9)] },
      { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4), n('clubs', 5)] },
    ],
    activePlayerIndex: 0,
    table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
    drawPile: [n('spades', 7), n('spades', 8)],
    turn: 1,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
  };
}

/** The legal "play hearts-2 onto the run" draft the UI would build for the given state. */
function legalDraft(s: GameState) {
  const ed = new DraftEditor(s);
  ed.playHandCard('hearts-2-d0', 't1', 0);
  return ed.getDraft();
}

describe('applyGameAction', () => {
  it('accepts a legal confirm and reports what it did', () => {
    const s = state();
    const out = applyGameAction(s, { type: 'confirmTurn', actorIndex: 0, draft: legalDraft(s) });
    expect(out).toMatchObject({ ok: true, actorId: 'p0', cardsPlayed: 1, finished: false });
    expect(out.ok && out.state.activePlayerIndex).toBe(1);
    expect(s.players[0]!.hand).toHaveLength(3); // the input state is never mutated
  });

  it('rejects an illegal confirm with the rules reasons and no state', () => {
    const s = state();
    const ed = new DraftEditor(s);
    ed.playHandCard('spades-9-d0', null); // a lone 9 is not a meld
    const out = applyGameAction(s, { type: 'confirmTurn', actorIndex: 0, draft: ed.getDraft() });
    expect(out).toEqual({ ok: false, reasons: ['reason.meldTooSmall'] });
  });

  it('rejects any action once the match is finished', () => {
    const s: GameState = { ...state(), phase: 'finished', winnerId: 'p0' };
    expect(applyGameAction(s, { type: 'drawAndEndTurn', actorIndex: 0 })).toEqual({
      ok: false,
      reasons: ['reason.notYourTurn'],
    });
    expect(applyGameAction(s, { type: 'confirmTurn', actorIndex: 0, draft: legalDraft(s) })).toEqual({
      ok: false,
      reasons: ['reason.notYourTurn'],
    });
  });

  it('rejects an action from a seat that is not the active player', () => {
    const s = state();
    expect(applyGameAction(s, { type: 'drawAndEndTurn', actorIndex: 1 })).toEqual({
      ok: false,
      reasons: ['reason.notYourTurn'],
    });
  });

  it('draws and passes, and ends the match when the pile is empty', () => {
    const empty: GameState = { ...state(), drawPile: [] };
    const out = applyGameAction(empty, { type: 'drawAndEndTurn', actorIndex: 0 });
    expect(out).toMatchObject({ ok: true, cardsPlayed: 0, finished: true });
    expect(out.ok && out.state.winnerId).toBe('p1'); // fewest cards... both have 2/3 -> p1 has 2
  });

  it('is the same transition whoever issued it — human seat and AI seat agree', () => {
    // Seat 1 is the AI seat. Put it on the clock with the same board and the same move.
    const human = state();
    const ai: GameState = {
      ...human,
      activePlayerIndex: 1,
      players: [
        { ...human.players[0]!, hand: [n('clubs', 4), n('clubs', 5)] },
        { ...human.players[1]!, hand: [n('hearts', 2), n('spades', 9), n('clubs', 9)] },
      ],
    };
    const a = applyGameAction(human, { type: 'confirmTurn', actorIndex: 0, draft: legalDraft(human) });
    const b = applyGameAction(ai, { type: 'confirmTurn', actorIndex: 1, draft: legalDraft(ai) });
    expect(a.ok && b.ok).toBe(true);
    expect(a.ok && a.state.table).toEqual(b.ok && b.state.table);
    expect(a.ok && a.cardsPlayed).toBe(b.ok && b.cardsPlayed);
  });
});

describe('GameStore.dispatch', () => {
  let seen: string[];

  beforeEach(() => {
    bus.clear();
    seen = [];
    for (const e of ['turn:confirmed', 'turn:drawn', 'turn:start', 'game:won'] as const) {
      bus.on(e, () => seen.push(e));
    }
  });

  it('commits an accepted action and announces it as a fact', () => {
    const store = new GameStore(state());
    const out = store.dispatch({ type: 'confirmTurn', actorIndex: 0, draft: legalDraft(store.get()) });
    expect(out.ok).toBe(true);
    expect(store.get().activePlayerIndex).toBe(1);
    expect(seen).toEqual(['turn:confirmed', 'turn:start']);
  });

  it('announces the finish instead of the next turn', () => {
    const store = new GameStore({ ...state(), drawPile: [] });
    store.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(seen).toEqual(['turn:drawn', 'game:won']);
  });

  it('leaves the state untouched and emits nothing when the action is refused', () => {
    const store = new GameStore(state());
    const before = store.get();
    const out = store.dispatch({ type: 'drawAndEndTurn', actorIndex: 1 });
    expect(out).toEqual({ ok: false, reasons: ['reason.notYourTurn'] });
    expect(store.get()).toBe(before);
    expect(seen).toEqual([]);
  });

  it('a stale subscriber from a finished match cannot touch the next one', () => {
    // The bus is process-global: a scene that forgot to unsubscribe would still be called. What
    // must hold is that subscribers only observe — they are never part of committing a turn.
    const dead = new GameStore(state());
    let stale = 0;
    const unsub = bus.on('turn:start', () => stale++);
    dead.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(stale).toBe(1);
    unsub();
    const fresh = new GameStore(state());
    fresh.dispatch({ type: 'drawAndEndTurn', actorIndex: 0 });
    expect(stale).toBe(1);
    expect(fresh.get().turn).toBe(2); // the turn advanced regardless of who was listening
  });
});
