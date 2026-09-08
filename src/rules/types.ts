export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  id: string; // `${suit}-${rank}` — unique in a single 52-card deck
  suit: Suit;
  rank: Rank;
}

export interface Meld {
  id: string;
  cards: Card[];
}

export interface PlayerState {
  id: string;
  name: string;
  isAi: boolean;
  aiType?: 'simple' | 'rearranger';
  hand: Card[];
}

export interface GameState {
  seed: number;
  players: PlayerState[];
  activePlayerIndex: number;
  table: Meld[]; // committed — always valid
  drawPile: Card[];
  turn: number;
  winnerId: string | null;
  phase: 'playing' | 'finished';
  /** Consecutive draw-with-empty-pile turns; full round => stalemate, fewest cards wins. */
  consecutiveDraws: number;
}

/** Mexe Mode draft — may be temporarily invalid while editing. */
export interface DraftState {
  melds: Meld[];
  handCardsPlayed: string[]; // ids moved from active player's hand
}

export type ReasonCode =
  | 'reason.meldTooSmall'
  | 'reason.notAMeld'
  | 'reason.noHandCard'
  | 'reason.cardMissing'
  | 'reason.duplicateCard'
  | 'reason.foreignCard';

export interface MeldReason {
  meldId: string;
  reason: ReasonCode;
}

export type ConfirmResult = { ok: true } | { ok: false; reasons: ReasonCode[] };

export class RulesError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'RulesError';
  }
}
