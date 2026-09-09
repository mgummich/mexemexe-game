import type { Rng } from '../core/rng';
import {
  DEFAULT_RULES,
  SUITS,
  type Card,
  type ConfirmResult,
  type DraftState,
  type GameState,
  type JokerAssignment,
  type Meld,
  type MeldAnalysis,
  type MeldReason,
  type Rank,
  type ReasonCode,
  type RulesConfig,
  type Suit,
} from './types';
import { RulesError } from './types';

export function cardId(suit: Suit, rank: Rank, deckId: number): string {
  return `${suit}-${rank}-d${deckId}`;
}

export function jokerId(deckId: number, n: number): string {
  return `joker-d${deckId}-${n}`;
}

export function createDeck(config: RulesConfig = DEFAULT_RULES): Card[] {
  const deck: Card[] = [];
  for (let deckId = 0; deckId < config.deckCount; deckId++) {
    for (const suit of SUITS) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ id: cardId(suit, rank as Rank, deckId), deckId, suit, rank: rank as Rank, isJoker: false });
      }
    }
    for (let n = 1; n <= config.jokersPerDeck; n++) {
      deck.push({ id: jokerId(deckId, n), deckId, suit: null, rank: null, isJoker: true });
    }
  }
  return deck;
}

/** Fisher-Yates with seeded rng. Pure: returns a new array. */
export function shuffleDeck(deck: readonly Card[], rng: Rng): Card[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function dealInitialHands(
  deck: readonly Card[],
  playerCount: number,
  handSize = DEFAULT_RULES.handSize,
): { hands: Card[][]; drawPile: Card[] } {
  if (playerCount < 2 || playerCount > 4) {
    throw new RulesError(`playerCount must be 2-4, got ${playerCount}`, 'badPlayerCount');
  }
  if (deck.length < playerCount * handSize) {
    throw new RulesError('deck too small to deal', 'deckTooSmall');
  }
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  let i = 0;
  for (let c = 0; c < handSize; c++) {
    for (let p = 0; p < playerCount; p++) {
      hands[p]!.push(deck[i++]!);
    }
  }
  return { hands, drawPile: deck.slice(i) };
}

interface AceMode {
  high: boolean;
  boundsLow: number;
  boundsHigh: number;
}
const ACE_MODES: AceMode[] = [
  { high: false, boundsLow: 1, boundsHigh: 13 },
  { high: true, boundsLow: 2, boundsHigh: 14 },
];

/**
 * Run analysis: 3+ cards, same suit, consecutive values in exactly one ace mode (low: A=1,
 * high: A=14 — never both in the same run, so Q-K-A-2-3 always fails). At most 1 joker per meld;
 * it fills whatever window slot the naturals don't cover.
 */
function hasDuplicateIds(cards: readonly Card[]): boolean {
  return new Set(cards.map((c) => c.id)).size !== cards.length;
}

function analyzeRun(cards: readonly Card[], _config: RulesConfig): MeldAnalysis {
  if (hasDuplicateIds(cards)) return { valid: false, reason: 'reason.duplicateCard' };
  if (cards.length < 3) return { valid: false, reason: 'reason.meldTooSmall' };
  const naturals = cards.filter((c) => !c.isJoker);
  const jokers = cards.filter((c) => c.isJoker);
  if (naturals.length === 0) return { valid: false, reason: 'reason.jokerUnassignable' };
  if (jokers.length > 1) return { valid: false, reason: 'reason.tooManyJokers' };
  const suit = naturals[0]!.suit!;
  if (!naturals.every((c) => c.suit === suit)) return { valid: false, reason: 'reason.runSuitMismatch' };

  const n = cards.length;
  // card order on the table is player-meaningful (e.g. 5H 6H + joker dropped after -> 7H,
  // not 4H). naturalIndex[i] is naturals[i]'s position in the full cards array.
  const naturalIndex = cards.reduce<number[]>((acc, c, i) => {
    if (!c.isJoker) acc.push(i);
    return acc;
  }, []);
  for (const mode of ACE_MODES) {
    const values = naturals.map((c) => (c.rank === 1 && mode.high ? 14 : c.rank!));
    if (values.some((v) => v < mode.boundsLow || v > mode.boundsHigh)) continue;
    if (new Set(values).size !== values.length) continue; // duplicate value in this mode
    const min = Math.min(...values);
    const max = Math.max(...values);
    const lowStart = Math.max(mode.boundsLow, max - n + 1);
    const highStart = Math.min(min, mode.boundsHigh - n + 1);
    if (lowStart > highStart) continue; // no window of length n contains [min,max] within bounds

    let start = lowStart; // fallback: first fitting window wins
    for (let candidate = lowStart; candidate <= highStart; candidate++) {
      const positional = values.every((v, i) => v === candidate + naturalIndex[i]!);
      if (positional) {
        start = candidate;
        break;
      }
    }

    const naturalByValue = new Map(naturals.map((c, i) => [values[i]!, c]));
    const slots: number[] = [];
    for (let v = start; v <= start + n - 1; v++) {
      if (!naturalByValue.has(v)) slots.push(v);
    }
    if (slots.length !== jokers.length) continue; // guard; window size already guarantees this

    const assignments: JokerAssignment[] = jokers.map((j, idx) => ({
      cardId: j.id,
      suit,
      rank: (slots[idx] === 14 ? 1 : slots[idx]!) as Rank,
    }));
    return { valid: true, kind: 'run', assignments };
  }

  const hasNaturalAce = naturals.some((c) => c.rank === 1);
  const reason: ReasonCode = hasNaturalAce
    ? 'reason.runWrap'
    : jokers.length === 0
      ? 'reason.runGap'
      : 'reason.jokerUnassignable';
  return { valid: false, reason };
}

/** Group analysis: exactly 3-4 cards, same rank, unique natural suits, at most 1 joker filling an unused suit. */
function analyzeGroup(cards: readonly Card[], _config: RulesConfig): MeldAnalysis {
  if (hasDuplicateIds(cards)) return { valid: false, reason: 'reason.duplicateCard' };
  if (cards.length < 3) return { valid: false, reason: 'reason.meldTooSmall' };
  if (cards.length > 4) return { valid: false, reason: 'reason.groupTooLarge' };
  const naturals = cards.filter((c) => !c.isJoker);
  const jokers = cards.filter((c) => c.isJoker);
  if (naturals.length === 0) return { valid: false, reason: 'reason.groupAllJokers' };
  if (jokers.length > 1) return { valid: false, reason: 'reason.tooManyJokers' };
  const rank = naturals[0]!.rank!;
  if (!naturals.every((c) => c.rank === rank)) return { valid: false, reason: 'reason.notAMeld' };
  const naturalSuits = naturals.map((c) => c.suit!);
  if (new Set(naturalSuits).size !== naturalSuits.length) return { valid: false, reason: 'reason.groupDuplicateSuit' };
  const unusedSuits = SUITS.filter((suit) => !naturalSuits.includes(suit));
  if (jokers.length > unusedSuits.length) return { valid: false, reason: 'reason.jokerUnassignable' };
  const assignments: JokerAssignment[] = jokers.map((j, index) => ({ cardId: j.id, suit: unusedSuits[index]!, rank }));
  return {
    valid: true,
    kind: 'group',
    assignments,
    rank,
    naturalSuits,
    jokerCount: jokers.length,
    assignedJokers: assignments,
    isValid: true,
    reasons: [],
  };
}

/** Single source of truth for meld validity: tries run, then group. */
export function analyzeMeld(cards: readonly Card[], config: RulesConfig = DEFAULT_RULES): MeldAnalysis {
  const run = analyzeRun(cards, config);
  if (run.valid) return run;
  const group = analyzeGroup(cards, config);
  if (group.valid) return group;
  const naturals = cards.filter((c) => !c.isJoker);
  const allShareRank = naturals.length > 0 && naturals.every((c) => c.rank === naturals[0]!.rank);
  return allShareRank || naturals.length === 0 ? group : run;
}

export function isValidRun(cards: readonly Card[], config: RulesConfig = DEFAULT_RULES): boolean {
  return analyzeRun(cards, config).valid;
}

export function isValidGroup(cards: readonly Card[], config: RulesConfig = DEFAULT_RULES): boolean {
  return analyzeGroup(cards, config).valid;
}

export function isValidMeld(cards: readonly Card[], config: RulesConfig = DEFAULT_RULES): boolean {
  return analyzeMeld(cards, config).valid;
}

export function validateTable(melds: readonly Meld[], config: RulesConfig = DEFAULT_RULES): boolean {
  return getInvalidMeldReasons(melds, config).length === 0;
}

export function getInvalidMeldReasons(melds: readonly Meld[], config: RulesConfig = DEFAULT_RULES): MeldReason[] {
  const out: MeldReason[] = [];
  const seenCardIds = new Set<string>();
  for (const m of melds) {
    const result = analyzeMeld(m.cards, config);
    if (!result.valid) out.push({ meldId: m.id, reason: result.reason });
    if (m.cards.some((card) => seenCardIds.has(card.id))) {
      if (!out.some((entry) => entry.meldId === m.id && entry.reason === 'reason.duplicateCard')) {
        out.push({ meldId: m.id, reason: 'reason.duplicateCard' });
      }
    }
    for (const card of m.cards) seenCardIds.add(card.id);
  }
  return out;
}

function countIds(cards: readonly Card[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of cards) map.set(c.id, (map.get(c.id) ?? 0) + 1);
  return map;
}

/**
 * Gate for FEITO. Checks, in order:
 *  - no duplicate card ids in draft
 *  - every draft card comes from committed table or active player's hand (no foreign cards)
 *  - every committed table card is still on the draft table (no return to hand)
 *  - at least one card added from hand
 *  - all draft melds valid (per state.config)
 *
 * `invalidMeldReasons`, when given, is reused instead of recomputed — pass the caller's own
 * `getInvalidMeldReasons(draft.melds, state.config)` result to avoid analyzing every meld twice.
 */
export function canConfirmTurn(state: GameState, draft: DraftState, invalidMeldReasons?: MeldReason[]): ConfirmResult {
  const reasons: ReasonCode[] = [];
  const draftCards = draft.melds.flatMap((m) => m.cards);
  const draftCount = countIds(draftCards);

  for (const [, n] of draftCount) {
    if (n > 1) {
      reasons.push('reason.duplicateCard');
      break;
    }
  }

  const tableIds = new Set(state.table.flatMap((m) => m.cards.map((c) => c.id)));
  const hand = state.players[state.activePlayerIndex]!.hand;
  const handIds = new Set(hand.map((c) => c.id));

  for (const c of draftCards) {
    if (!tableIds.has(c.id) && !handIds.has(c.id)) {
      reasons.push('reason.foreignCard');
      break;
    }
  }

  for (const id of tableIds) {
    if (!draftCount.has(id)) {
      reasons.push('reason.cardMissing');
      break;
    }
  }

  const playedFromHand = draftCards.filter((c) => handIds.has(c.id));
  if (playedFromHand.length === 0) reasons.push('reason.noHandCard');

  for (const r of invalidMeldReasons ?? getInvalidMeldReasons(draft.melds, state.config)) {
    if (!reasons.includes(r.reason)) reasons.push(r.reason);
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function nextPlayerIndex(state: GameState): number {
  return (state.activePlayerIndex + 1) % state.players.length;
}

/** Apply a confirmed draft. Throws RulesError if illegal — caller must gate via canConfirmTurn. */
export function applyConfirmedTurn(state: GameState, draft: DraftState): GameState {
  const check = canConfirmTurn(state, draft);
  if (!check.ok) {
    throw new RulesError(`illegal confirm: ${check.reasons.join(',')}`, 'illegalConfirm');
  }
  const draftIds = new Set(draft.melds.flatMap((m) => m.cards.map((c) => c.id)));
  const players = state.players.map((p, i) =>
    i === state.activePlayerIndex ? { ...p, hand: p.hand.filter((c) => !draftIds.has(c.id)) } : p,
  );
  const next: GameState = {
    ...state,
    players,
    table: draft.melds.map((m) => ({ id: m.id, cards: sortMeldCards(m.cards, state.config) })),
    turn: state.turn + 1,
    activePlayerIndex: nextPlayerIndex(state),
  };
  const winnerId = checkWinner(next);
  if (winnerId !== null) {
    return { ...next, winnerId, phase: 'finished' };
  }
  return next;
}

/** Fallback display sort: by rank then suit, jokers always last. Never throws. */
function fallbackSort(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    if (a.isJoker || b.isJoker) {
      if (a.isJoker && b.isJoker) return a.id.localeCompare(b.id);
      return a.isJoker ? 1 : -1;
    }
    return a.rank! - b.rank! || a.suit!.localeCompare(b.suit!);
  });
}

/**
 * Same ace-mode selection as analyzeRun's window loop (bounds/duplicate/window-exists checks
 * only, no positional tie-break) — deterministic given naturals, so it always agrees with
 * whichever mode analyzeRun picked for this meld.
 */
function runAceMode(naturals: readonly Card[], n: number): AceMode | null {
  for (const mode of ACE_MODES) {
    const values = naturals.map((c) => (c.rank === 1 && mode.high ? 14 : c.rank!));
    if (values.some((v) => v < mode.boundsLow || v > mode.boundsHigh)) continue;
    if (new Set(values).size !== values.length) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const lowStart = Math.max(mode.boundsLow, max - n + 1);
    const highStart = Math.min(min, mode.boundsHigh - n + 1);
    if (lowStart > highStart) continue;
    return mode;
  }
  return null;
}

/**
 * Display-sort a committed meld by its ANALYZED interpretation, so a joker sits in its slot
 * (`10 JOKER Q`, not `10 Q JOKER`). Valid run: order by effective value (natural rank in the
 * run's ace mode, joker by its assigned rank/mode). Valid group: naturals by suit, jokers last
 * (unchanged — group jokers have no ordering to reveal). Invalid/unanalyzable: fallback sort;
 * must never throw.
 */
export function sortMeldCards(cards: readonly Card[], config: RulesConfig): Card[] {
  const analysis = analyzeMeld(cards, config);
  if (!analysis.valid || analysis.kind === 'group') return fallbackSort(cards);

  const naturals = cards.filter((c) => !c.isJoker);
  const mode = runAceMode(naturals, cards.length);
  if (!mode) return fallbackSort(cards); // defensive: analysis.valid already guarantees a mode

  const jokerRank = new Map(analysis.assignments.map((a) => [a.cardId, a.rank]));
  const valueOf = (c: Card): number => {
    const rank = c.isJoker ? jokerRank.get(c.id)! : c.rank!;
    return rank === 1 && mode.high ? 14 : rank;
  };
  return [...cards].sort((a, b) => valueOf(a) - valueOf(b));
}

/**
 * Draw one card and pass the turn. If the draw pile is already empty, the game ends
 * immediately instead: no card is drawn, winner = fewest hand cards (tie -> earliest seat).
 */
export function drawAndEndTurn(state: GameState): GameState {
  if (state.drawPile.length === 0) {
    return { ...state, winnerId: fewestCardsWinner(state), phase: 'finished' };
  }
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const drawPile = [...state.drawPile];
  const card = drawPile.shift()!;
  players[state.activePlayerIndex]!.hand.push(card);
  return {
    ...state,
    players,
    drawPile,
    turn: state.turn + 1,
    activePlayerIndex: nextPlayerIndex(state),
  };
}

/**
 * Turn-timer entry point: caller discards whatever draft was in progress (turn-start state is
 * `state` itself), so expiry is just the draw-and-pass path.
 */
export function timerExpireTurn(state: GameState): GameState {
  return drawAndEndTurn(state);
}

export function checkWinner(state: GameState): string | null {
  const winner = state.players.find((p) => p.hand.length === 0);
  return winner ? winner.id : null;
}

/** Fewest hand cards wins; ties broken by earliest seat index (players array order). */
export function fewestCardsWinner(state: GameState): string {
  return [...state.players].sort((a, b) => a.hand.length - b.hand.length)[0]!.id;
}

/** Wire/save envelope version. Bump when GameState's shape changes incompatibly. */
export const GAME_STATE_VERSION = 2;

interface GameStateEnvelopeV2 {
  version: 2;
  state: GameState;
}

export function serializeGameState(state: GameState): string {
  const envelope: GameStateEnvelopeV2 = { version: GAME_STATE_VERSION, state };
  return JSON.stringify(envelope);
}

export function deserializeGameState(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RulesError('corrupt save: not JSON', 'corruptSave');
  }
  if (parsed && typeof parsed === 'object' && 'version' in parsed) {
    if ((parsed as { version: unknown }).version !== GAME_STATE_VERSION) {
      throw new RulesError('corrupt save: unsupported version', 'corruptSave');
    }
  }
  // Accept both the versioned envelope and the old bare-state shape (tests).
  const unwrapped =
    parsed && typeof parsed === 'object' && 'version' in parsed && 'state' in parsed
      ? (parsed as GameStateEnvelopeV2).state
      : parsed;
  const s = unwrapped as GameState;
  if (
    !s ||
    !Array.isArray(s.players) ||
    !Array.isArray(s.table) ||
    !Array.isArray(s.drawPile) ||
    typeof s.activePlayerIndex !== 'number' ||
    typeof s.seed !== 'number' ||
    !s.config
  ) {
    throw new RulesError('corrupt save: bad shape', 'corruptSave');
  }
  const all = [
    ...s.players.flatMap((p) => p.hand),
    ...s.table.flatMap((m) => m.cards),
    ...s.drawPile,
  ];
  const ids = new Set(all.map((c) => c.id));
  const expectedTotal = s.config.deckCount * (52 + s.config.jokersPerDeck);
  if (all.length !== expectedTotal || ids.size !== expectedTotal) {
    throw new RulesError('corrupt save: card conservation violated', 'corruptSave');
  }
  if (!validateTable(s.table, s.config)) {
    throw new RulesError('corrupt save: invalid table', 'corruptSave');
  }
  return s;
}
