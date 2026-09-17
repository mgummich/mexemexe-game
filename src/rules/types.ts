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
  readonly id: string;
  readonly cards: readonly Card[];
}

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly isAi: boolean;
  readonly aiType?: 'simple' | 'rearranger';
  readonly hand: readonly Card[];
}

/** A seat to deal in: everything a `PlayerState` needs that the deal itself does not provide. */
export interface PlayerConfig {
  name: string;
  isAi: boolean;
  aiType?: 'simple' | 'rearranger';
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
  readonly seed: number;
  readonly players: readonly PlayerState[];
  readonly activePlayerIndex: number;
  readonly table: readonly Meld[]; // committed — always valid
  readonly drawPile: readonly Card[];
  readonly turn: number;
  readonly winnerId: string | null;
  readonly phase: 'playing' | 'finished';
  readonly config: RulesConfig;
}

/** Mexe Mode draft — may be temporarily invalid while editing. */
export interface DraftState {
  readonly melds: readonly Meld[];
  readonly handCardsPlayed: readonly string[]; // ids moved from active player's hand
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

/**
 * Refusals of *untrusted input*. Expected: the data came from storage, a file or a hand edit, the
 * caller is supposed to recover (start fresh) and the player is told something neutral. Never a
 * bug in itself.
 */
export type RulesInputErrorCode =
  | 'corruptSave'
  | 'unsupportedSaveVersion'
  | 'corruptReplay'
  | 'unsupportedReplayVersion'
  | 'replayDiverged';

/**
 * Violated invariants. Unexpected: trusted code built or passed something that cannot be, so the
 * throw is the diagnostic. Callers must not convert these into a silent no-op — the client's
 * `window.onerror` boundary and the server's room-crash log exist to keep them visible.
 */
export type RulesInvariantErrorCode = 'badPlayerCount' | 'deckTooSmall' | 'illegalConfirm' | 'corruptState';

export type RulesErrorCode = RulesInputErrorCode | RulesInvariantErrorCode;

/** The domain's one error class. `code` says which of the two families above the failure is in. */
export class RulesError extends Error {
  constructor(
    message: string,
    public readonly code: RulesErrorCode,
  ) {
    super(message);
    this.name = 'RulesError';
  }
}

