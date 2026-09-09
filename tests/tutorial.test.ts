import { describe, expect, it } from 'vitest';
import { TutorialDirector } from '../src/tutorial/director';
import { TUTORIAL_STEPS } from '../src/tutorial/script';
import { buildTutorialState } from '../src/tutorial/fixture';
import { DraftEditor } from '../src/mexe-mode/draft';
import { analyzeMeld, applyConfirmedTurn, drawAndEndTurn, getInvalidMeldReasons } from '../src/rules/rules';
import { DEFAULT_RULES } from '../src/rules/types';
import type { GameState } from '../src/rules/types';
import { getLocale, setLocale, t } from '../src/localization/i18n';

/**
 * Drives the whole scripted tutorial (fixture + step gate + completion
 * predicates) headlessly — no Phaser — the same way GameScene does, and
 * asserts it actually reaches a win. Catches fixture/script drift (e.g. a
 * card conservation bug, or a step whose goal the fixture can't satisfy)
 * without needing a browser.
 */
describe('interactive tutorial script', () => {
  it('completes all 12 steps and ends in a win, respecting the allow-list at every step', () => {
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
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'diamonds-3-d0' })).toBe(false);
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'hearts-9-d0' })).toBe(true);
    editor.playHandCard('hearts-9-d0', null);
    advance();
    const setMeldId = editor.getDraft().melds[0]!.id;
    editor.playHandCard('spades-9-d0', setMeldId);
    editor.playHandCard('clubs-9-d0', setMeldId);
    advance();
    expect(dir.stepIndex).toBe(2);

    // step 3: trinca-limit — dragging in a second-deck duplicate suit hits the real validator's
    // reason.groupDuplicateSuit, same as a live rejected meld would; then it's pulled back out
    // and parked in a valid second set built from the other two duplicate 9s.
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'hearts-9-d1' })).toBe(true);
    editor.playHandCard('hearts-9-d1', setMeldId);
    const dupMeld = editor.getDraft().melds.find((m) => m.id === setMeldId)!;
    expect(analyzeMeld(dupMeld.cards, DEFAULT_RULES)).toMatchObject({ valid: false, reason: 'reason.groupDuplicateSuit' });
    const invalid = getInvalidMeldReasons(editor.getDraft().melds, DEFAULT_RULES);
    expect(invalid.some((r) => r.meldId === setMeldId && r.reason === 'reason.groupDuplicateSuit')).toBe(true);
    editor.moveTableCard('hearts-9-d1', null);
    const secondSetMeldId = editor.getDraft().melds.find((m) => m.id !== setMeldId)!.id;
    editor.playHandCard('spades-9-d1', secondSetMeldId);
    editor.playHandCard('clubs-9-d1', secondSetMeldId);
    advance();
    expect(dir.stepIndex).toBe(3);
    expect(editor.invalidMelds().length).toBe(0);

    // step 4: run
    editor.playHandCard('diamonds-3-d0', null);
    advance();
    const runMeldId = editor.getDraft().melds.find((m) => m.id !== setMeldId && m.id !== secondSetMeldId)!.id;
    editor.playHandCard('diamonds-4-d0', runMeldId);
    editor.playHandCard('diamonds-5-d0', runMeldId);
    advance();
    expect(dir.stepIndex).toBe(4);

    // step 5: extend the run
    editor.playHandCard('diamonds-6-d0', runMeldId);
    advance();
    expect(dir.stepIndex).toBe(5);

    // step 6: joker — a wildcard extends the run and validates once assigned a concrete slot
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'joker-d0-1' })).toBe(true);
    editor.playHandCard('joker-d0-1', runMeldId);
    advance();
    expect(dir.stepIndex).toBe(6);
    const jokerRun = editor.getDraft().melds.find((m) => m.id === runMeldId)!;
    const jokerAnalysis = analyzeMeld(jokerRun.cards, DEFAULT_RULES);
    expect(jokerAnalysis.valid).toBe(true);
    expect(jokerAnalysis.valid && jokerAnalysis.assignments.some((a) => a.cardId === 'joker-d0-1')).toBe(true);

    // step 7: mexe explanation
    dir.next();
    expect(dir.stepIndex).toBe(7);

    // step 8: rebuild — pull clubs-9 out of the set (temporarily invalid)
    expect(dir.isAllowed({ type: 'moveTableCard', cardId: 'clubs-9-d0' })).toBe(true);
    editor.moveTableCard('clubs-9-d0', null);
    advance();
    expect(dir.stepIndex).toBe(8);
    expect(editor.invalidMelds().length).toBeGreaterThan(0);

    // step 9: invalid explanation
    dir.next();
    expect(dir.stepIndex).toBe(9);

    // step 10: put it back and FEITO
    editor.moveTableCard('clubs-9-d0', setMeldId);
    expect(editor.canConfirm().ok).toBe(true);
    expect(dir.isAllowed({ type: 'feito' })).toBe(true);
    state = applyConfirmedTurn(state, editor.getDraft());
    editor = null;
    dir.checkComplete(state, null);
    expect(dir.stepIndex).toBe(10);
    expect(state.players[0]!.hand.map((c) => c.id)).toEqual(['diamonds-9-d0']);

    // tutorial "AI" turn: dummy auto-draw
    expect(state.activePlayerIndex).toBe(1);
    state = drawAndEndTurn(state);
    expect(state.activePlayerIndex).toBe(0); // back to human (2p alternation)

    // step 11: COMPRAR
    expect(dir.isAllowed({ type: 'comprar' })).toBe(true);
    expect(dir.isAllowed({ type: 'feito' })).toBe(false);
    state = drawAndEndTurn(state);
    dir.checkComplete(state, null);
    expect(dir.stepIndex).toBe(11);

    // second AI dummy turn
    state = drawAndEndTurn(state);

    // step 12: win — play both remaining cards and confirm
    editor = new DraftEditor(state);
    expect(editor.getRemainingHand().map((c) => c.id).sort()).toEqual(['diamonds-7-d0', 'diamonds-9-d0']);
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'diamonds-9-d0' })).toBe(true);
    expect(dir.isAllowed({ type: 'playHandCard', cardId: 'diamonds-7-d0' })).toBe(true);
    editor.playHandCard('diamonds-9-d0', setMeldId);
    editor.playHandCard('diamonds-7-d0', runMeldId);
    expect(editor.canConfirm().ok).toBe(true);
    state = applyConfirmedTurn(state, editor.getDraft());
    dir.checkComplete(state, null);

    expect(state.winnerId).toBe('p0');
    expect(dir.finished).toBe(true);
  });
});

describe('tutorial corrections', () => {
  it('allows regrouping table cards, and rewinds the step when an undo takes back its goal', () => {
    const state: GameState = buildTutorialState();
    const dir = new TutorialDirector();
    const editor = new DraftEditor(state);
    dir.next(); // step 1: 'set' — build the three nines

    // A learner who dropped the nines into separate groups must be able to drag them together.
    expect(dir.isAllowed({ type: 'moveTableCard', cardId: 'clubs-9-d0' })).toBe(true);
    editor.playHandCard('hearts-9-d0', null);
    const first = editor.getDraft().melds[0]!.id;
    editor.playHandCard('spades-9-d0', null);
    editor.playHandCard('clubs-9-d0', null);
    dir.checkComplete(state, editor.getDraft());
    expect(dir.stepIndex).toBe(1); // three separate groups: goal not met yet

    const stray = editor.getDraft().melds.filter((m) => m.id !== first);
    for (const m of stray) editor.moveTableCard(m.cards[0]!.id, first);
    dir.checkComplete(state, editor.getDraft());
    expect(dir.stepIndex).toBe(2); // regrouped by hand — goal met, step advances

    // Undoing back below the goal must take the lesson back with it, not leave the script ahead.
    editor.undo();
    dir.checkComplete(state, editor.getDraft());
    expect(dir.stepIndex).toBe(1);

    // ...and reset likewise, from an even later point.
    editor.redo();
    dir.checkComplete(state, editor.getDraft());
    expect(dir.stepIndex).toBe(2);
    editor.reset();
    dir.checkComplete(state, editor.getDraft());
    expect(dir.stepIndex).toBe(1);
  });
});

describe('tutorial skip and replay', () => {
  it('allows skipping from any step, and replay restarts at step 0', () => {
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
      const dir = new TutorialDirector();
      for (let n = 0; n < i; n++) dir.next();
      expect(dir.stepIndex).toBe(i); // skip is just leaving the scene — always legal, no gate to check
    }

    const dir = new TutorialDirector();
    for (let n = 0; n < TUTORIAL_STEPS.length - 1; n++) dir.next();
    expect(dir.stepIndex).toBe(TUTORIAL_STEPS.length - 1);
    dir.restart();
    expect(dir.stepIndex).toBe(0);
    expect(dir.finished).toBe(false);
  });
});

describe('tutorial localization coverage', () => {
  it('every tutorial.* key referenced by the script exists in both PT and EN', () => {
    const original = getLocale();
    try {
      for (const step of TUTORIAL_STEPS) {
        setLocale('pt');
        expect(t(step.textKey), `pt missing ${step.textKey}`).not.toBe(step.textKey);
        setLocale('en');
        expect(t(step.textKey), `en missing ${step.textKey}`).not.toBe(step.textKey);
      }
    } finally {
      setLocale(original);
    }
  });
});
