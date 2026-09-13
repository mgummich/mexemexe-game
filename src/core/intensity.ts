import type { GameState } from '../rules/types';

/**
 * How loud the match currently is, derived from the board rather than from the clock.
 *
 * A twenty-minute match played at one fixed presentation level reads as the same turn repeating.
 * This is the single value the scene uses to decide how much energy a moment gets: it comes
 * entirely from state a player can see (how full the table is, how close anyone is to going out,
 * how much draw pile is left), so it can never disagree with what is on screen, and it never
 * touches legality — nothing here can change what is or is not a legal move.
 */
type Intensity = 'calm' | 'active' | 'hot';

/** How close a hand is to going out, as a presentation state. */
type Threat = 'none' | 'watch' | 'threat' | 'last';

/** Deck sizes at or below which the pile reads as running out. */
const DECK_LOW = 12;
const DECK_CRITICAL = 5;

/**
 * The threat a hand size represents. Three cards is worth noticing, two is worth worrying about,
 * one is the moment before someone goes out.
 */
export function threatOf(handSize: number): Threat {
  if (handSize <= 0) return 'last'; // an emptied hand is still the tensest state until BATER lands
  if (handSize === 1) return 'last';
  if (handSize === 2) return 'threat';
  if (handSize === 3) return 'watch';
  return 'none';
}

interface MatchIntensity {
  level: Intensity;
  /** The smallest hand anyone holds — the thing the whole table is racing against. */
  lowestHand: number;
  /** Threat state of that smallest hand. */
  threat: Threat;
  /** True once the draw pile is short enough that exhaustion is a real ending, not a theory. */
  deckLow: boolean;
  /** True when the pile is nearly gone and the deck-exhaustion ending is imminent. */
  deckCritical: boolean;
}

/**
 * Reads the match's current intensity.
 *
 * Two separate pressures can raise it, matching the two ways a match actually ends: someone
 * getting close to going out, and the draw pile running out. Table size contributes as well,
 * because a big shared table is what makes the middle of a match feel busy.
 */
export function matchIntensity(state: GameState): MatchIntensity {
  const hands = state.players.map((p) => p.hand.length);
  const lowestHand = hands.length > 0 ? Math.min(...hands) : 0;
  const threat = threatOf(lowestHand);
  const deckLow = state.drawPile.length <= DECK_LOW;
  const deckCritical = state.drawPile.length <= DECK_CRITICAL;
  const tableCards = state.table.reduce((n, m) => n + m.cards.length, 0);

  let level: Intensity = 'calm';
  if (tableCards >= 12 || state.table.length >= 4 || threat === 'watch' || deckLow) level = 'active';
  if (threat === 'threat' || threat === 'last' || deckCritical) level = 'hot';
  return { level, lowestHand, threat, deckLow, deckCritical };
}

/** Cards a hand must trail the table leader by, before catching up counts as a comeback rather
 * than routine play. */
const COMEBACK_GAP = 3;

/**
 * PACE-14: whether `seat` was meaningfully behind (the largest hand at the table, by at least
 * `COMEBACK_GAP` over the current leader) right before making the move being presented. Purely a
 * presentation flag read from board state at one instant — it stores nothing between turns and
 * feeds no score, so it can never disagree with a match a player joins mid-way.
 */
export function isComeback(before: GameState, seat: number): boolean {
  const mine = before.players[seat]?.hand.length ?? 0;
  const others = before.players.filter((_, i) => i !== seat).map((p) => p.hand.length);
  if (others.length === 0 || mine === 0) return false;
  const leader = Math.min(...others);
  return mine >= Math.max(...others) && mine - leader >= COMEBACK_GAP;
}
