import type { Meld } from '../rules/types';
import type { PlaylogSummary } from './playlog';

export interface PlayerRoundStats {
  turnsPlayed: number;
  cardsPlayed: number;
  draws: number;
}

/** Per-player turn/cards/draw breakdown, read out of the playlog's per-player counters. Never
 * throws on a player the log never saw (e.g. an online match, where the local playlog doesn't
 * observe server-driven turns) — just all zeros. */
export function playerStats(playerId: string, perPlayer: PlaylogSummary['perPlayer']): PlayerRoundStats {
  const p = perPlayer[playerId];
  return {
    turnsPlayed: (p?.confirms ?? 0) + (p?.draws ?? 0),
    cardsPlayed: p?.cardsPlayed ?? 0,
    draws: p?.draws ?? 0,
  };
}

/**
 * i18n key + params for the existing `game.lastMove.*` strings, describing a just-confirmed
 * move (winning or not) by diffing the table before the move against the finally-drafted melds.
 * Pure so it works both mid-game (opponent readback) and at game end (winning-move summary)
 * without needing a live GameState "after" snapshot.
 */
export function summarizeMoveKey(
  beforeTable: readonly Meld[],
  finalMelds: readonly Meld[],
  played: number,
): { key: string; params: { n: number; m: number } } {
  const prevMeldOf = new Map<string, string>();
  for (const m of beforeTable) for (const c of m.cards) prevMeldOf.set(c.id, m.id);
  let moved = 0;
  for (const m of finalMelds) {
    for (const c of m.cards) {
      if (prevMeldOf.has(c.id) && prevMeldOf.get(c.id) !== m.id) moved++;
    }
  }
  const key = played <= 0 ? 'game.lastMove.drew' : moved > 0 ? 'game.lastMove.mexeu' : 'game.lastMove.played';
  return { key, params: { n: Math.max(0, played), m: moved } };
}
