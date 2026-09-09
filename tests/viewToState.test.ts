import { describe, expect, it } from 'vitest';
import { buildView, PROTOCOL_VERSION } from '../src/net/protocol';
import { viewToState } from '../src/net/viewToState';
import { canConfirmTurn } from '../src/rules/rules';
import { DraftEditor } from '../src/mexe-mode/draft';
import type { GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { n } from './helpers/cards';

function state(): GameState {
  return {
    seed: 1,
    players: [
      {
        id: 'p0', name: 'A', isAi: false,
        hand: [n('hearts', 2), n('spades', 9), n('clubs', 9)],
      },
      { id: 'p1', name: 'B', isAi: false, hand: [n('clubs', 4), n('diamonds', 7)] },
    ],
    activePlayerIndex: 0,
    table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
    drawPile: [n('spades', 1), n('spades', 2)],
    turn: 3,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
  };
}

describe('protocol', () => {
  it('PROTOCOL_VERSION is 3', () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });

  it('buildView carries the rules config', () => {
    const s = state();
    const view = buildView(s, 0, 5);
    expect(view.config).toEqual(DEFAULT_RULES);
  });

  it('buildView never leaks opponent hands', () => {
    const s = state();
    const view = buildView(s, 0, 5);
    const opponent = view.players.find((p) => p.seat === 1)!;
    expect(opponent.hand).toBeUndefined();
    expect(opponent.handCount).toBe(2);
    const serialized = JSON.stringify(view);
    for (const c of s.players[1]!.hand) {
      expect(serialized.includes(`"${c.id}"`)).toBe(false);
    }
  });
});

describe('viewToState (C4: placeholder assumption)', () => {
  it('carries no real card ids for the opponent hand or the draw pile', () => {
    const s = state();
    const view = buildView(s, 0, 5);
    const result = viewToState(view);

    const opponent = result.players[1]!;
    expect(opponent.hand).toHaveLength(2);
    for (const card of opponent.hand) expect(card.id).toMatch(/^__placeholder-/);

    expect(result.drawPile).toHaveLength(2);
    for (const card of result.drawPile) expect(card.id).toMatch(/^__placeholder-/);

    // none of the real opponent/draw-pile ids leaked through
    const realHiddenIds = new Set([...s.players[1]!.hand, ...s.drawPile].map((card) => card.id));
    const resultIds = [...opponent.hand, ...result.drawPile].map((card) => card.id);
    for (const id of resultIds) expect(realHiddenIds.has(id)).toBe(false);
  });

  it('placeholders satisfy the Card shape and cannot collide with real card ids', () => {
    const s = state();
    const result = viewToState(buildView(s, 0, 5));
    const realIds = new Set([
      ...s.players.flatMap((p) => p.hand.map((c) => c.id)),
      ...s.table.flatMap((m) => m.cards.map((c) => c.id)),
      ...s.drawPile.map((c) => c.id),
    ]);
    for (const card of [...result.players[1]!.hand, ...result.drawPile]) {
      expect(typeof card.id).toBe('string');
      expect(typeof card.deckId).toBe('number');
      expect(typeof card.isJoker).toBe('boolean');
      expect(realIds.has(card.id)).toBe(false);
    }
  });

  it('is faithful for the own seat hand and the table', () => {
    const s = state();
    const view = buildView(s, 0, 5);
    const result = viewToState(view);

    expect(result.players[0]!.hand).toEqual(s.players[0]!.hand);
    expect(result.table).toEqual(s.table);
  });

  it('canConfirmTurn accepts a legal draft built from a viewToState result', () => {
    const s = state();
    const result = viewToState(buildView(s, 0, 5));
    const editor = new DraftEditor(result);
    editor.playHandCard('hearts-2-d0', 't1', 0); // extends the run legally
    expect(canConfirmTurn(result, editor.getDraft())).toEqual({ ok: true });
  });

  it('canConfirmTurn rejects a draft smuggling a placeholder (draw-pile) card as foreign', () => {
    const s = state();
    const result = viewToState(buildView(s, 0, 5));
    const placeholderCard = result.drawPile[0]!;
    const draft = {
      melds: [
        { id: 't1', cards: [...result.table[0]!.cards, placeholderCard] },
      ],
      handCardsPlayed: [],
    };
    const check = canConfirmTurn(result, draft);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reasons).toContain('reason.foreignCard');
  });
});
