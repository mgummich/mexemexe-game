import { t } from '../localization/i18n';
import { createDeck } from '../rules/rules';
import { DEFAULT_RULES } from '../rules/types';
import type { Card, GameState, PlayerState } from '../rules/types';

const P0_HAND_IDS = [
  'hearts-9-d0', 'spades-9-d0', 'clubs-9-d0',
  'hearts-9-d1', 'spades-9-d1', 'clubs-9-d1',
  'diamonds-3-d0', 'diamonds-4-d0', 'diamonds-5-d0', 'diamonds-6-d0', 'joker-d0-1',
  'diamonds-9-d0',
];
// drawPile[0] is drawn by the AI's scripted turn; drawPile[1] is drawn by the
// player's own COMPRAR step (step 9) and finishes the hand for the win step.
const DRAW_TOP_IDS = ['clubs-2-d0', 'diamonds-7-d0'];

/**
 * Hand-crafted deterministic state for the interactive tutorial: same full-deck
 * conservation as a real deal (every card lives in exactly one hand or the
 * draw pile), just dealt by hand instead of shuffled so every step has a
 * known card to point at. 2 players: the human and one dummy AI that always
 * auto-draws in tutorial mode (see GameScene).
 */
export function buildTutorialState(): GameState {
  const deck = createDeck(DEFAULT_RULES);
  const byId = new Map(deck.map((c) => [c.id, c]));
  const take = (ids: string[]): Card[] => ids.map((id) => byId.get(id)!);

  const p0Hand = take(P0_HAND_IDS);
  const drawTop = take(DRAW_TOP_IDS);
  const used = new Set([...P0_HAND_IDS, ...DRAW_TOP_IDS]);
  const rest = deck.filter((c) => !used.has(c.id));
  const p1Hand = rest.splice(0, 5);
  const drawPile = [...drawTop, ...rest];

  const players: PlayerState[] = [
    { id: 'p0', name: t('menu.you'), isAi: false, hand: p0Hand },
    { id: 'p1', name: 'Juninho', isAi: true, aiType: 'simple', hand: p1Hand },
  ];

  return {
    seed: 0,
    players,
    activePlayerIndex: 0,
    table: [],
    drawPile,
    turn: 1,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
  };
}
