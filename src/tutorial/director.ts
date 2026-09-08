import type { DraftState, GameState } from '../rules/types';
import { TUTORIAL_STEPS, type StepAction, type TutorialStep } from './script';

export type TutorialAction =
  | { type: 'playHandCard'; cardId: string }
  | { type: 'moveTableCard'; cardId: string }
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
  }

  /** Call after any state/draft mutation; advances the step if its goal is met. */
  checkComplete(state: GameState, draft: DraftState | null): boolean {
    if (!this.step.isComplete({ state, draft })) return false;
    if (this.index < TUTORIAL_STEPS.length - 1) {
      this.index++;
      return true;
    }
    this.finishedFlag = true;
    return false;
  }

  restart(): void {
    this.index = 0;
    this.finishedFlag = false;
  }
}
