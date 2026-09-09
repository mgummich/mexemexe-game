export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

export interface Card {
  /** `${suit}-${rank}-d${deckId}` for naturals, `joker-d${deckId}-${n}` (n = 1-based) for jokers. */
  id: string;
  /** 0-based deck index. */
  deckId: number;
  suit: Suit | null; // null iff isJoker
  rank: Rank | null; // null iff isJoker
  isJoker: boolean;
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

/** House-rule configuration for one game. `DEFAULT_RULES` is the only enabled variant today. */
export interface RulesConfig {
  deckCount: number; // default 2
  jokersPerDeck: number; // default 2
  maxGroupSize: number; // default 4 — TOTAL cards in a group, jokers included
  groupUniqueSuits: boolean; // default false
  firstMeldMinPoints: number; // default 0 = off (hook only, not enforced by the validator)
  turnTimerSeconds: number; // default 0 = off
  handSize: number; // default 7
}

export const DEFAULT_RULES: RulesConfig = {
  deckCount: 2,
  jokersPerDeck: 2,
  maxGroupSize: 4,
  groupUniqueSuits: false,
  firstMeldMinPoints: 0,
  turnTimerSeconds: 0,
  handSize: 7,
};

export interface GameState {
  seed: number;
  players: PlayerState[];
  activePlayerIndex: number;
  table: Meld[]; // committed — always valid
  drawPile: Card[];
  turn: number;
  winnerId: string | null;
  phase: 'playing' | 'finished';
  config: RulesConfig;
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
  | 'reason.foreignCard'
  | 'reason.groupTooLarge'
  | 'reason.jokerUnassignable'
  | 'reason.runWrap'
  // Network-only reasons (server validation path, see docs/MULTIPLAYER_ARCHITECTURE.md §5)
  | 'reason.notYourTurn'
  | 'reason.staleRevision'
  | 'reason.alreadySubmitted'
  | 'reason.unknownCard';

export interface MeldReason {
  meldId: string;
  reason: ReasonCode;
}

export type ConfirmResult = { ok: true } | { ok: false; reasons: ReasonCode[] };

/** Where a joker lands within a valid meld. `suit` is null for group jokers. */
export interface JokerAssignment {
  cardId: string;
  suit: Suit | null;
  rank: Rank;
}

export type MeldAnalysis =
  | { valid: true; kind: 'run' | 'group'; assignments: JokerAssignment[] }
  | { valid: false; reason: ReasonCode };

export class RulesError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'RulesError';
  }
}
