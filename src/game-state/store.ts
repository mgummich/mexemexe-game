import { createRng } from '../core/rng';
import { bus } from '../core/events';
import {
  applyConfirmedTurn,
  createDeck,
  dealInitialHands,
  drawAndEndTurn,
  shuffleDeck,
} from '../rules/rules';
import type { DraftState, GameState, PlayerState } from '../rules/types';

export interface PlayerConfig {
  name: string;
  isAi: boolean;
  aiType?: 'simple' | 'rearranger';
}

export function createNewGame(seed: number, playerConfigs: PlayerConfig[], handSize = 7): GameState {
  const rng = createRng(seed);
  const deck = shuffleDeck(createDeck(), rng);
  const { hands, drawPile } = dealInitialHands(deck, playerConfigs.length, handSize);
  const players: PlayerState[] = playerConfigs.map((cfg, i) => ({
    id: `p${i}`,
    name: cfg.name,
    isAi: cfg.isAi,
    aiType: cfg.aiType,
    hand: hands[i]!,
  }));
  return {
    seed,
    players,
    activePlayerIndex: 0,
    table: [],
    drawPile,
    turn: 1,
    winnerId: null,
    phase: 'playing',
    consecutiveDraws: 0,
  };
}

/** Authoritative store. Committed state only; drafts live in mexe-mode. */
export class GameStore {
  private state: GameState;

  constructor(initial: GameState) {
    this.state = initial;
  }

  get(): GameState {
    return this.state;
  }

  get activePlayer(): PlayerState {
    return this.state.players[this.state.activePlayerIndex]!;
  }

  confirmTurn(draft: DraftState): GameState {
    const prev = this.activePlayer;
    const before = prev.hand.length;
    this.state = applyConfirmedTurn(this.state, draft);
    const after = this.state.players.find((p) => p.id === prev.id)!.hand.length;
    bus.emit('turn:confirmed', { playerId: prev.id, cardsPlayed: before - after });
    this.postTurn();
    return this.state;
  }

  drawEndTurn(): GameState {
    const playerId = this.activePlayer.id;
    this.state = drawAndEndTurn(this.state);
    bus.emit('turn:drawn', { playerId });
    this.postTurn();
    return this.state;
  }

  private postTurn(): void {
    if (this.state.winnerId) {
      bus.emit('game:won', { winnerId: this.state.winnerId });
    } else {
      bus.emit('turn:start', { playerId: this.activePlayer.id, turn: this.state.turn });
    }
  }
}
