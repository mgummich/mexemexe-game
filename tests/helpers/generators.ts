/**
 * Valid-by-construction generators for the property suites (`tests/property/`).
 *
 * The layering of `scenarios.ts` continues here: `cards.ts` builds cards, `scenarios.ts` builds
 * *named* states, and this file builds *families* of states — a random deal, a state reached by
 * playing legal turns, a meld built to be legal. Generating arbitrary JSON and throwing 99.9% of
 * it away proves nothing about a card game, so every generator below produces something the
 * domain would actually hand you, and the invalid ones are named mutations of a valid state
 * rather than noise.
 *
 * All randomness is the game's own seeded RNG (INV-R1): a generator is a pure function of
 * `(rng, size)`, which is what makes a failing property reproducible from its seed alone.
 */
import { SimpleAi } from '../../src/ai/ai';
import { applyGameAction, type GameAction } from '../../src/game-state/actions';
import { createDeck, createNewGame } from '../../src/rules/rules';
import type { Rng } from '../../src/rules/rng';
import { SUITS, type Card, type GameState, type PlayerConfig, type Rank, type Suit } from '../../src/rules/types';
import { n } from './cards';

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.int(items.length)]!;
}

/** Fisher-Yates on the seeded stream — `Array.sort` with a random comparator is not a shuffle. */
export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A real seeded deal, 2–4 seats. The seed is drawn from the property's own stream. */
export function randomDeal(rng: Rng): GameState {
  const seats = 2 + rng.int(3);
  const configs: PlayerConfig[] = Array.from({ length: seats }, (_, i) => ({
    name: String.fromCharCode(65 + i),
    isAi: true,
    aiType: 'simple' as const,
  }));
  return createNewGame(rng.int(100_000), configs);
}

/**
 * `SimpleAi` only, deliberately: `RearrangerAi` searches against a `performance.now()` deadline,
 * so a loaded machine can make it decide differently. That is fine for a player and fatal for a
 * generator whose whole value is that a seed reproduces the failure. Rearrangement is covered by
 * the golden replays, which record the resolved actions instead of recomputing them.
 */
const AI = new SimpleAi();

/**
 * The action the seated AI would take, expressed as the application-level `GameAction` every
 * local actor dispatches (INV-S7). Using the shipped AI as the action source keeps the generator
 * out of the business of deciding legality — that is `src/rules`' job, and a property that
 * re-derived it would only be testing itself.
 */
export function aiAction(state: GameState): GameAction {
  const actorIndex = state.activePlayerIndex;
  const decision = AI.decide(state);
  return decision.kind === 'confirm'
    ? { type: 'confirmTurn', actorIndex, draft: decision.draft }
    : { type: 'drawAndEndTurn', actorIndex };
}

export interface PlayedMatch {
  initial: GameState;
  /** Only accepted actions, in order — exactly what a replay records. */
  actions: GameAction[];
  /** State after the last accepted action. `initial` when `size` is 0. */
  state: GameState;
  /** Every state the match passed through, `initial` first. */
  states: GameState[];
}

/** `size` legal turns played from a random deal, or fewer if the match finishes first. */
export function playedMatch(rng: Rng, size: number): PlayedMatch {
  const initial = randomDeal(rng);
  const actions: GameAction[] = [];
  const states: GameState[] = [initial];
  let state = initial;
  for (let i = 0; i < size && state.phase === 'playing'; i++) {
    const action = aiAction(state);
    const outcome = applyGameAction(state, action);
    if (!outcome.ok) throw new Error(`generator produced an illegal action: ${outcome.reasons.join(',')}`);
    actions.push(action);
    state = outcome.state;
    states.push(state);
  }
  return { initial, actions, state, states };
}

/** A state reachable by legal play — the input most transition properties want. */
export function reachableState(rng: Rng, size: number): GameState {
  return playedMatch(rng, size).state;
}

/** Compact identification of a generated match, for a counterexample line. */
export function describeMatch(match: PlayedMatch): string {
  return (
    `seats=${match.initial.players.length} deal=${match.initial.seed} actions=${match.actions.length} ` +
    `turn=${match.state.turn} phase=${match.state.phase}`
  );
}

const JOKERS: Card[] = createDeck().filter((c) => c.isJoker);

/** A joker that is not already in `cards` — melds carry at most one, and ids must stay unique. */
function freeJoker(cards: readonly Card[], index = 0): Card {
  return JOKERS.filter((jk) => !cards.some((c) => c.id === jk.id))[index]!;
}

export interface GeneratedMeld {
  cards: Card[];
  kind: 'run' | 'group';
  jokerCount: number;
}

/**
 * A meld built to be legal: a same-suit run (ace low or ace high) or a same-rank group, with at
 * most one joker standing in for a slot the naturals leave open. Length and joker presence come
 * from the rng, never from the validator — so "the validator accepts it" is a real claim.
 */
export function validMeld(rng: Rng): GeneratedMeld {
  const withJoker = rng.int(3) === 0;
  if (rng.int(2) === 0) {
    const suit: Suit = pick(rng, SUITS);
    const length = 3 + rng.int(3); // 3–5
    const aceHigh = rng.int(4) === 0;
    // Ace-low windows start at 1; ace-high ones end at 14 (the ace), so they start at 15-length.
    const start = aceHigh ? 15 - length : 1 + rng.int(14 - length);
    const cards: Card[] = [];
    for (let i = 0; i < length; i++) {
      const value = start + i;
      cards.push(n(suit, value === 14 ? 1 : value, rng.int(2)));
    }
    if (withJoker) {
      // Never the only natural: a meld of jokers has nothing to anchor a suit or rank.
      cards[1 + rng.int(length - 2)] = freeJoker(cards);
    }
    return { cards, kind: 'run', jokerCount: withJoker ? 1 : 0 };
  }
  const rank = (1 + rng.int(13)) as Rank;
  const size = 3 + rng.int(2); // 3–4
  const suits = shuffled(rng, SUITS).slice(0, size);
  const cards: Card[] = suits.map((suit) => n(suit, rank, rng.int(2)));
  if (withJoker) cards[rng.int(size)] = freeJoker(cards);
  return { cards, kind: 'group', jokerCount: withJoker ? 1 : 0 };
}

/**
 * Cards with no claim to legality: a random subset of a real deck, so ids and shapes are real
 * even when the combination is nonsense. Used where the property is about the *answer* being
 * well-formed (a reason code, agreement between two validators) rather than about acceptance.
 */
export function arbitraryCards(rng: Rng, size: number): Card[] {
  const deck = createDeck();
  return Array.from({ length: size }, () => deck[rng.int(deck.length)]!);
}

/**
 * Named corruptions of a valid state. Each one breaks exactly one documented invariant, so a
 * rejection can be attributed — random garbage would only prove that garbage is refused.
 */
export const corrupt = {
  /** INV-G1 — seat 0 holds a second copy of a card that is already in play. */
  duplicateCard(state: GameState): GameState {
    const victim = state.drawPile[0] ?? state.table[0]?.cards[0] ?? state.players[1]!.hand[0]!;
    return {
      ...state,
      players: state.players.map((p, i) => (i === 0 ? { ...p, hand: [...p.hand, victim] } : p)),
    };
  },

  /** INV-G1 — a dealt card exists nowhere. */
  missingCard(state: GameState): GameState {
    if (state.drawPile.length > 0) return { ...state, drawPile: state.drawPile.slice(1) };
    return { ...state, players: state.players.map((p, i) => (i === 0 ? { ...p, hand: p.hand.slice(1) } : p)) };
  },

  /**
   * INV-G2 — a meld the committed table could never hold. Two cards taken off the pile: a pair is
   * `meldTooSmall` whatever the cards are, so the state is illegal for exactly one reason and
   * conservation still holds. Anything invented instead would also break INV-G1 and the rejection
   * could no longer be attributed.
   */
  illegalTable(state: GameState): GameState {
    if (state.drawPile.length < 2) throw new Error('corrupt.illegalTable needs two cards in the pile');
    return {
      ...state,
      table: [...state.table, { id: 'bad', cards: state.drawPile.slice(0, 2) }],
      drawPile: state.drawPile.slice(2),
    };
  },

  /** INV-S5 — nobody is on turn. */
  wrongActivePlayer(state: GameState): GameState {
    return { ...state, activePlayerIndex: state.players.length };
  },
} as const;
