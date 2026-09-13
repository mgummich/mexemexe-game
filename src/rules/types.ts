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

/**
 * What a game is dealt from. Meld legality is NOT configurable — Classic's run and group rules
 * are fixed in `analyzeMeld`, which is why nothing here reaches the validator.
 */
export interface RulesConfig {
  deckCount: number;
  jokersPerDeck: number;
  handSize: number;
}

export const DEFAULT_RULES: RulesConfig = {
  deckCount: 2,
  jokersPerDeck: 2,
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
  | 'reason.runSuitMismatch'
  | 'reason.runGap'
  | 'reason.noHandCard'
  | 'reason.cardMissing'
  | 'reason.duplicateCard'
  | 'reason.foreignCard'
  | 'reason.groupTooLarge'
  | 'reason.groupDuplicateSuit'
  | 'reason.groupAllJokers'
  | 'reason.jokerUnassignable'
  | 'reason.tooManyJokers'
  | 'reason.runWrap'
  // Network-only reasons (server validation path, see docs/MULTIPLAYER.md §5)
  | 'reason.notYourTurn'
  | 'reason.staleRevision'
  | 'reason.alreadySubmitted'
  | 'reason.unknownCard';

export interface MeldReason {
  meldId: string;
  reason: ReasonCode;
}

export type ConfirmResult = { ok: true } | { ok: false; reasons: ReasonCode[] };

/** Where a joker lands within a valid meld. */
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
