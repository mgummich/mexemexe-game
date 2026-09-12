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

/** The subset of a results row that the match story is derived from (see WinScene.PlayerResult). */
export interface MatchStoryPlayer {
  isWinner: boolean;
  cardsLeft: number;
  cardsPlayed?: number;
  draws?: number;
  turnsPlayed?: number;
}

/**
 * The single `win.story.*` label that describes how the match actually went (RESULT-03), or null
 * when nothing stands out — one label or none, never a pile of badges. Checked in order of how
 * strongly the shape is felt: the pile running out, a winner who had to keep drawing and still
 * won, a finish decided by a card or two, an efficient run of big plays, and finally a win the
 * loser never got close to. Counters are optional because an online match's local playlog never
 * observes server-driven turns, so they all read 0 there.
 */
export function matchStoryKey(players: readonly MatchStoryPlayer[], stalemate: boolean): string | null {
  if (stalemate) return 'win.story.pileOut';
  const winner = players.find((p) => p.isWinner);
  const rivals = players.filter((p) => !p.isWinner);
  if (!winner || rivals.length === 0) return null;
  const closest = Math.min(...rivals.map((r) => r.cardsLeft));
  const rivalDraws = Math.max(...rivals.map((r) => r.draws ?? 0));
  const draws = winner.draws ?? 0;
  const played = winner.cardsPlayed ?? 0;
  const turns = winner.turnsPlayed ?? 0;
  if (draws >= 3 && draws >= rivalDraws + 2) return 'win.story.comeback';
  if (closest <= 2) return 'win.story.close';
  if (played >= 4 && turns > 0 && played >= turns * 2) return 'win.story.stylish';
  if (closest >= 4) return 'win.story.runaway';
  return null;
}
