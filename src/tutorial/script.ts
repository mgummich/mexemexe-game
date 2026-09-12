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

/** TUTORIAL-15: the four conceptual phases of a turn — BAIXAR (lay melds), MEXE (rearrange),
 * COMPRAR (draw) and BATER (go out) — surfaced next to the step counter so the lesson's 12
 * internal steps read as belonging to a turn's real shape, not just as an opaque "N/12". */
export type TutorialPhase = 'baixar' | 'mexer' | 'comprar' | 'bater';

export interface TutorialStep {
  id: string;
  textKey: string;
  phase: TutorialPhase;
  allowed: StepAction[];
  /** Card ids to draw attention to (glow) while this step is active. */
  highlightCardIds?: string[];
  /** HUD buttons to draw attention to while this step is active. */
  highlightButtons?: ('feito' | 'comprar' | 'undo')[];
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
/** Second-deck duplicate of an already-used set suit: dragging it into NINE_IDS's set hits
 * `reason.groupDuplicateSuit`. Its two companions (also second-deck 9s of the set's other two
 * suits) let the player park it in a valid second set instead of leaving it stuck mid-air. */
const DUP_NINE_ID = 'hearts-9-d1';
const DUP_TRIO_IDS = [DUP_NINE_ID, 'spades-9-d1', 'clubs-9-d1'];
const JOKER_ID = 'joker-d0-1';

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'goal',
    textKey: 'tutorial.step1',
    phase: 'baixar',
    allowed: [{ type: 'next' }],
    isComplete: () => false,
  },
  {
    id: 'set',
    textKey: 'tutorial.step2',
    phase: 'baixar',
    allowed: [...NINE_IDS.map((cardId) => ({ type: 'playHandCard' as const, cardId })), CORRECT],
    highlightCardIds: NINE_IDS,
    isComplete: ({ draft }) => !!draft && meldHas(draft.melds, NINE_IDS),
  },
  {
    id: 'trinca-limit',
    textKey: 'tutorial.step3',
    phase: 'baixar',
    // Single step covers the whole round-trip (trigger the duplicate-suit rejection, then fix
    // it) so its goal stays monotonic — a two-step split would have the fix un-do the trigger
    // step's own goal mid-turn, and TutorialDirector.rewindUndoneGoals would bounce back to it.
    allowed: [
      { type: 'playHandCard', cardId: DUP_NINE_ID },
      { type: 'playHandCard', cardId: 'spades-9-d1' },
      { type: 'playHandCard', cardId: 'clubs-9-d1' },
      CORRECT,
    ],
    highlightCardIds: DUP_TRIO_IDS,
    isComplete: ({ draft }) =>
      !!draft && !meldHas(draft.melds, [...NINE_IDS, DUP_NINE_ID]) && meldHas(draft.melds, DUP_TRIO_IDS),
  },
  {
    id: 'run',
    textKey: 'tutorial.step4',
    phase: 'baixar',
    allowed: [...RUN_IDS.map((cardId) => ({ type: 'playHandCard' as const, cardId })), CORRECT],
    highlightCardIds: RUN_IDS,
    isComplete: ({ draft }) => !!draft && meldHas(draft.melds, RUN_IDS),
  },
  {
    id: 'extend',
    textKey: 'tutorial.step5',
    phase: 'baixar',
    allowed: [{ type: 'playHandCard', cardId: 'diamonds-6-d0' }, CORRECT],
    highlightCardIds: ['diamonds-6-d0'],
    isComplete: ({ draft }) => !!draft && meldHas(draft.melds, [...RUN_IDS, 'diamonds-6-d0']),
  },
  {
    id: 'joker',
    textKey: 'tutorial.step6',
    phase: 'baixar',
    allowed: [{ type: 'playHandCard', cardId: JOKER_ID }, CORRECT],
    highlightCardIds: [JOKER_ID],
    isComplete: ({ draft }) =>
      !!draft && meldHas(draft.melds, [...RUN_IDS, 'diamonds-6-d0', JOKER_ID]),
  },
  {
    id: 'mexe-explain',
    textKey: 'tutorial.step7',
    phase: 'mexer',
    allowed: [{ type: 'next' }],
    isComplete: () => false,
  },
  {
    id: 'rebuild',
    textKey: 'tutorial.step8',
    phase: 'mexer',
    allowed: [CORRECT],
    highlightCardIds: ['clubs-9-d0'],
    isComplete: ({ draft }) => !!draft && !meldHas(draft.melds, NINE_IDS),
  },
  {
    id: 'invalid',
    textKey: 'tutorial.step9',
    phase: 'mexer',
    allowed: [{ type: 'next' }],
    // TUTORIAL-10: point at Undo here — the player has just seen a harmless invalid state, the
    // natural moment to learn that any single move is one tap away from reverting.
    highlightButtons: ['undo'],
    isComplete: () => false,
  },
  {
    id: 'feito',
    textKey: 'tutorial.step10',
    phase: 'mexer',
    allowed: [CORRECT, { type: 'feito' }],
    highlightButtons: ['feito'],
    isComplete: ({ state }) => state.turn >= 2,
  },
  {
    id: 'comprar',
    textKey: 'tutorial.step11',
    phase: 'comprar',
    allowed: [{ type: 'comprar' }],
    highlightButtons: ['comprar'],
    // turn 2 (feito) -> 3 (ai draw) -> 4 (this draw)
    isComplete: ({ state }) => state.turn >= 4,
  },
  {
    id: 'win',
    textKey: 'tutorial.step12',
    phase: 'bater',
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
