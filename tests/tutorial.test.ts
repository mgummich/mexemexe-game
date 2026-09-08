import { describe, expect, it } from 'vitest';
import { TutorialDirector } from '../src/tutorial/director';
import { buildTutorialState } from '../src/tutorial/fixture';
import { DraftEditor } from '../src/mexe-mode/draft';
import { applyConfirmedTurn, drawAndEndTurn } from '../src/rules/rules';
import type { GameState } from '../src/rules/types';

/**
 * Drives the whole scripted tutorial (fixture + step gate + completion
 * predicates) headlessly — no Phaser — the same way GameScene does, and
 * asserts it actually reaches a win. Catches fixture/script drift (e.g. a
 * card conservation bug, or a step whose goal the fixture can't satisfy)
 * without needing a browser.
 */
describe('interactive tutorial script', () => {
  it('completes all 10 steps and ends in a win, respecting the allow-list at every step', () => {
    let state: GameState = buildTutorialState();
    const dir = new TutorialDirector();
    let editor: DraftEditor | null = new DraftEditor(state);

    const advance = () => {
      dir.checkComplete(state, editor?.getDraft() ?? null);
    };

    expect(dir.stepIndex).toBe(0);

    // step 1: goal — explanation only
    dir.next();
    expect(dir.stepIndex).toBe(1);

    // step 2: set — disallowed card is rejected, allowed cards form the meld
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'diamonds-3' })).toBe(false);
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'hearts-9' })).toBe(true);
    editor.playHandCard('hearts-9', null);
    advance();
    const setMeldId = editor.getDraft().melds[0]!.id;
    editor.playHandCard('spades-9', setMeldId);
    editor.playHandCard('clubs-9', setMeldId);
    advance();
    expect(dir.stepIndex).toBe(2);

    // step 3: run
    editor.playHandCard('diamonds-3', null);
    advance();
    const runMeldId = editor.getDraft().melds.find((m) => m.id !== setMeldId)!.id;
    editor.playHandCard('diamonds-4', runMeldId);
    editor.playHandCard('diamonds-5', runMeldId);
    advance();
    expect(dir.stepIndex).toBe(3);

    // step 4: extend the run
    editor.playHandCard('diamonds-6', runMeldId);
    advance();
    expect(dir.stepIndex).toBe(4);

    // step 5: mexe explanation
    dir.next();
    expect(dir.stepIndex).toBe(5);

    // step 6: rebuild — pull clubs-9 out of the set (temporarily invalid)
    expect(dir.isAllowed({ type: 'moveTableCard', cardId: 'clubs-9' })).toBe(true);
    editor.moveTableCard('clubs-9', null);
    advance();
    expect(dir.stepIndex).toBe(6);
    expect(editor.invalidMelds().length).toBeGreaterThan(0);

    // step 7: invalid explanation
    dir.next();
    expect(dir.stepIndex).toBe(7);

    // step 8: put it back and FEITO
    editor.moveTableCard('clubs-9', setMeldId);
    expect(editor.canConfirm().ok).toBe(true);
    expect(dir.isAllowed({ type: 'feito' })).toBe(true);
    state = applyConfirmedTurn(state, editor.getDraft());
    editor = null;
    dir.checkComplete(state, null);
    expect(dir.stepIndex).toBe(8);
    expect(state.players[0]!.hand.map((c) => c.id)).toEqual(['diamonds-9']);

    // tutorial "AI" turn: dummy auto-draw
    expect(state.activePlayerIndex).toBe(1);
    state = drawAndEndTurn(state);
    expect(state.activePlayerIndex).toBe(0); // back to human (2p alternation)

    // step 9: COMPRAR
    expect(dir.isAllowed({ type: 'comprar' })).toBe(true);
    expect(dir.isAllowed({ type: 'feito' })).toBe(false);
    state = drawAndEndTurn(state);
    dir.checkComplete(state, null);
    expect(dir.stepIndex).toBe(9);

    // second AI dummy turn
    state = drawAndEndTurn(state);

    // step 10: win — play both remaining cards and confirm
    editor = new DraftEditor(state);
    expect(editor.getRemainingHand().map((c) => c.id).sort()).toEqual(['diamonds-7', 'diamonds-9']);
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'diamonds-9' })).toBe(true);
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'diamonds-7' })).toBe(true);
    editor.playHandCard('diamonds-9', setMeldId);
    editor.playHandCard('diamonds-7', runMeldId);
    expect(editor.canConfirm().ok).toBe(true);
    state = applyConfirmedTurn(state, editor.getDraft());
    dir.checkComplete(state, null);

    expect(state.winnerId).toBe('p0');
    expect(dir.finished).toBe(true);
  });
});
