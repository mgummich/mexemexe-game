import type { Rng } from '../core/rng';
import {
  SUITS,
  type Card,
  type ConfirmResult,
  type DraftState,
  type GameState,
  type Meld,
  type MeldReason,
  type Rank,
  type ReasonCode,
} from './types';
import { RulesError } from './types';

export function cardId(suit: Card['suit'], rank: Rank): string {
  return `${suit}-${rank}`;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: cardId(suit, rank as Rank), suit, rank: rank as Rank });
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
  handSize = 7,
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

/** Run: 3+ cards, same suit, consecutive ranks. Ace low only — no wrap. */
export function isValidRun(cards: readonly Card[]): boolean {
  if (cards.length < 3) return false;
  const suit = cards[0]!.suit;
  if (!cards.every((c) => c.suit === suit)) return false;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! !== ranks[i - 1]! + 1) return false;
  }
  return true;
}

/** Set: 3+ cards, same rank. Single deck ⇒ suits necessarily distinct. */
export function isValidSet(cards: readonly Card[]): boolean {
  if (cards.length < 3) return false;
  const rank = cards[0]!.rank;
  return cards.every((c) => c.rank === rank);
}

export function isValidMeld(cards: readonly Card[]): boolean {
  return isValidRun(cards) || isValidSet(cards);
}

export function validateTable(melds: readonly Meld[]): boolean {
  return melds.every((m) => isValidMeld(m.cards));
}

export function getInvalidMeldReasons(melds: readonly Meld[]): MeldReason[] {
  const out: MeldReason[] = [];
  for (const m of melds) {
    if (isValidMeld(m.cards)) continue;
    out.push({
      meldId: m.id,
      reason: m.cards.length < 3 ? 'reason.meldTooSmall' : 'reason.notAMeld',
    });
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
 *  - all draft melds valid
 */
export function canConfirmTurn(state: GameState, draft: DraftState): ConfirmResult {
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

  for (const r of getInvalidMeldReasons(draft.melds)) {
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
    table: draft.melds.map((m) => ({ id: m.id, cards: sortMeldCards(m.cards) })),
    turn: state.turn + 1,
    activePlayerIndex: nextPlayerIndex(state),
    consecutiveDraws: 0,
  };
  const winnerId = checkWinner(next);
  if (winnerId !== null) {
    return { ...next, winnerId, phase: 'finished' };
  }
  return next;
}

/** Keep runs display-sorted by rank; sets sorted by suit for stable rendering. */
function sortMeldCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
}

export function drawAndEndTurn(state: GameState): GameState {
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const drawPile = [...state.drawPile];
  const card = drawPile.shift();
  if (card) players[state.activePlayerIndex]!.hand.push(card);
  // Empty draw pile: turn passes (no discard pile to recycle). A full round of
  // empty-pile passes with no confirm = stalemate; fewest cards wins, tie -> earliest seat.
  const consecutiveDraws = card ? 0 : state.consecutiveDraws + 1;
  const next: GameState = {
    ...state,
    players,
    drawPile,
    turn: state.turn + 1,
    activePlayerIndex: nextPlayerIndex(state),
    consecutiveDraws,
  };
  if (consecutiveDraws >= state.players.length) {
    const winner = [...next.players].sort((a, b) => a.hand.length - b.hand.length)[0]!;
    return { ...next, winnerId: winner.id, phase: 'finished' };
  }
  return next;
}

export function checkWinner(state: GameState): string | null {
  const winner = state.players.find((p) => p.hand.length === 0);
  return winner ? winner.id : null;
}

export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGameState(json: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new RulesError('corrupt save: not JSON', 'corruptSave');
  }
  const s = parsed as GameState;
  if (
    !s ||
    !Array.isArray(s.players) ||
    !Array.isArray(s.table) ||
    !Array.isArray(s.drawPile) ||
    typeof s.activePlayerIndex !== 'number' ||
    typeof s.seed !== 'number'
  ) {
    throw new RulesError('corrupt save: bad shape', 'corruptSave');
  }
  // Card conservation: exactly one 52-card deck, no dupes, no gaps.
  const all = [
    ...s.players.flatMap((p) => p.hand),
    ...s.table.flatMap((m) => m.cards),
    ...s.drawPile,
  ];
  const ids = new Set(all.map((c) => c.id));
  if (all.length !== 52 || ids.size !== 52) {
    throw new RulesError('corrupt save: card conservation violated', 'corruptSave');
  }
  if (!validateTable(s.table)) {
    throw new RulesError('corrupt save: invalid table', 'corruptSave');
  }
  return { ...s, consecutiveDraws: s.consecutiveDraws ?? 0 };
}
