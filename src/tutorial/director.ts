import type { DraftState, GameState } from '../rules/types';
import { TUTORIAL_STEPS, type StepAction, type TutorialStep } from './script';

export type TutorialAction =
  | { type: 'playHandCard'; cardId: string }
  | { type: 'moveTableCard'; cardId: string }
  /** Dragging a card played this turn back to hand — never scripted, so always blocked in tutorial. */
  | { type: 'returnToHand' }
  | { type: 'feito' }
  | { type: 'comprar' };

/**
 * Drives the interactive tutorial: tracks the current step, gates which
 * player actions are allowed, and advances when a step's fixture-specific
 * goal is reached. GameScene queries this instead of hand-rolling tutorial
 * logic inline.
 */
export class TutorialDirector {
  private index = 0;
  private finishedFlag = false;
  /**
   * Steps advanced by reaching their goal (not by NEXT), with the turn they completed on.
   * Undo/reset can take a draft back below an earlier step's goal; without rewinding, the
   * script would keep asking for something the player has already been sent past. The turn is
   * recorded because a goal met on an earlier turn (e.g. "confirm the turn") stays met even
   * though the fresh draft no longer satisfies the draft-based steps before it.
   */
  private autoAdvanced: { index: number; turn: number }[] = [];

  get step(): TutorialStep {
    return TUTORIAL_STEPS[this.index]!;
  }

  get stepIndex(): number {
    return this.index;
  }

  get total(): number {
    return TUTORIAL_STEPS.length;
  }

  get isLastStep(): boolean {
    return this.index === TUTORIAL_STEPS.length - 1;
  }

  get finished(): boolean {
    return this.finishedFlag;
  }

  /** Is this player action allowed by the current step's script? */
  isAllowed(action: TutorialAction): boolean {
    return this.step.allowed.some((a: StepAction) => {
      if (a.type !== action.type) return false;
      if (a.cardId !== undefined) return 'cardId' in action && a.cardId === action.cardId;
      return true;
    });
  }

  /** Manual advance for pure-explanation steps (NEXT button). */
  next(): void {
    if (this.index < TUTORIAL_STEPS.length - 1) this.index++;
    // An explicit NEXT locks in everything before it: some later steps deliberately ask the
    // player to undo an earlier step's goal (put the 9♣ back), which must not rewind the script.
    this.autoAdvanced = [];
  }

  /** Call after any state/draft mutation; rewinds past goals the player has undone, then
   * advances the step if the current goal is met. */
  checkComplete(state: GameState, draft: DraftState | null): boolean {
    this.rewindUndoneGoals(state, draft);
    if (!this.step.isComplete({ state, draft })) return false;
    if (this.index < TUTORIAL_STEPS.length - 1) {
      this.autoAdvanced.push({ index: this.index, turn: state.turn });
      this.index++;
      return true;
    }
    this.finishedFlag = true;
    return false;
  }

  private rewindUndoneGoals(state: GameState, draft: DraftState | null): void {
    for (let last = this.autoAdvanced.at(-1); last; last = this.autoAdvanced.at(-1)) {
      // Only same-turn goals can be undone — an earlier turn's goal is permanent history.
      if (last.turn !== state.turn) return;
      if (TUTORIAL_STEPS[last.index]!.isComplete({ state, draft })) return;
      this.autoAdvanced.pop();
      this.index = last.index;
      this.finishedFlag = false;
    }
  }

  restart(): void {
    this.index = 0;
    this.finishedFlag = false;
    this.autoAdvanced = [];
  }
}
