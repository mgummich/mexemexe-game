import type { DraftState, GameState, Meld } from '../rules/types';

export type StepActionType = 'next' | 'playHandCard' | 'moveTableCard' | 'feito' | 'comprar';

/** One allowed interaction for a step. `cardId` narrows drag actions to a single card. */
export interface StepAction {
  type: StepActionType;
  cardId?: string;
}

export interface TutorialStepCtx {
  state: GameState;
  draft: DraftState | null;
}

export interface TutorialStep {
  id: string;
  textKey: string;
  allowed: StepAction[];
  /** Card ids to draw attention to (glow) while this step is active. */
  highlightCardIds?: string[];
  /** HUD buttons to draw attention to while this step is active. */
  highlightButtons?: ('feito' | 'comprar')[];
  /** Auto-advance once true. Steps gated only by the NEXT button return false here. */
  isComplete: (ctx: TutorialStepCtx) => boolean;
}

function meldHas(melds: readonly Meld[], ids: string[]): boolean {
  return melds.some((m) => ids.every((id) => m.cards.some((c) => c.id === id)));
}

const NINE_IDS = ['hearts-9-d0', 'spades-9-d0', 'clubs-9-d0'];
/**
 * Corrective move, allowed on every step that puts cards on the table. Without it a learner who
 * drops the nines into three separate groups is stuck: they can neither drag them together nor
 * pull them back to hand, because only hand-to-table moves were permitted. Progress is still
 * driven by each step's `isComplete`, so allowing corrections cannot skip a lesson.
 */
const CORRECT: StepAction = { type: 'moveTableCard' };
const RUN_IDS = ['diamonds-3-d0', 'diamonds-4-d0', 'diamonds-5-d0'];

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'goal',
    textKey: 'tutorial.step1',
    allowed: [{ type: 'next' }],
    isComplete: () => false,
  },
  {
    id: 'set',
    textKey: 'tutorial.step2',
    allowed: [...NINE_IDS.map((cardId) => ({ type: 'playHandCard' as const, cardId })), CORRECT],
    highlightCardIds: NINE_IDS,
    isComplete: ({ draft }) => !!draft && meldHas(draft.melds, NINE_IDS),
  },
  {
    id: 'run',
    textKey: 'tutorial.step3',
    allowed: [...RUN_IDS.map((cardId) => ({ type: 'playHandCard' as const, cardId })), CORRECT],
    highlightCardIds: RUN_IDS,
    isComplete: ({ draft }) => !!draft && meldHas(draft.melds, RUN_IDS),
  },
  {
    id: 'extend',
    textKey: 'tutorial.step4',
    allowed: [{ type: 'playHandCard', cardId: 'diamonds-6-d0' }, CORRECT],
    highlightCardIds: ['diamonds-6-d0'],
    isComplete: ({ draft }) => !!draft && meldHas(draft.melds, [...RUN_IDS, 'diamonds-6-d0']),
  },
  {
    id: 'mexe-explain',
    textKey: 'tutorial.step5',
    allowed: [{ type: 'next' }],
    isComplete: () => false,
  },
  {
    id: 'rebuild',
    textKey: 'tutorial.step6',
    allowed: [CORRECT],
    highlightCardIds: ['clubs-9-d0'],
    isComplete: ({ draft }) => !!draft && !meldHas(draft.melds, NINE_IDS),
  },
  {
    id: 'invalid',
    textKey: 'tutorial.step7',
    allowed: [{ type: 'next' }],
    isComplete: () => false,
  },
  {
    id: 'feito',
    textKey: 'tutorial.step8',
    allowed: [CORRECT, { type: 'feito' }],
    highlightButtons: ['feito'],
    isComplete: ({ state }) => state.turn >= 2,
  },
  {
    id: 'comprar',
    textKey: 'tutorial.step9',
    allowed: [{ type: 'comprar' }],
    highlightButtons: ['comprar'],
    // turn 2 (feito) -> 3 (ai draw) -> 4 (this draw)
    isComplete: ({ state }) => state.turn >= 4,
  },
  {
    id: 'win',
    textKey: 'tutorial.step10',
    allowed: [
      { type: 'playHandCard', cardId: 'diamonds-9-d0' },
      { type: 'playHandCard', cardId: 'diamonds-7-d0' },
      CORRECT,
      { type: 'feito' },
    ],
    highlightCardIds: ['diamonds-9-d0', 'diamonds-7-d0'],
    highlightButtons: ['feito'],
    isComplete: ({ state }) => state.winnerId !== null,
  },
];
