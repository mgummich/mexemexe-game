import { DraftEditor } from '../mexe-mode/draft';
import { isValidMeld, isValidRun } from '../rules/rules';
import type { Card, DraftState, GameState } from '../rules/types';

export type AiDecision =
  | { kind: 'confirm'; draft: DraftState; explanation: string }
  | { kind: 'draw'; explanation: string };

export interface AiPlayer {
  decide(state: GameState): AiDecision;
}

/** All personalities are deterministic: sorted iteration, first hit wins. */
export type Personality = 'cida' | 'juninho' | 'bia' | 'ze';

function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Find all melds of exactly 3+ cards formable from hand: sets by rank, runs by suit. */
function findHandMelds(hand: readonly Card[]): Card[][] {
  const out: Card[][] = [];
  // Sets
  const byRank = new Map<number, Card[]>();
  for (const c of sortCards(hand)) {
    const arr = byRank.get(c.rank) ?? [];
    arr.push(c);
    byRank.set(c.rank, arr);
  }
  for (const [, cards] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    if (cards.length >= 3) out.push(cards);
  }
  // Runs: longest maximal run per suit segment
  const bySuit = new Map<string, Card[]>();
  for (const c of sortCards(hand)) {
    const arr = bySuit.get(c.suit) ?? [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }
  for (const [, cards] of [...bySuit.entries()].sort()) {
    const sorted = [...cards].sort((a, b) => a.rank - b.rank);
    let seg: Card[] = [];
    for (const c of sorted) {
      if (seg.length === 0 || c.rank === seg[seg.length - 1]!.rank + 1) {
        seg.push(c);
      } else if (c.rank !== seg[seg.length - 1]!.rank) {
        if (seg.length >= 3) out.push(seg);
        seg = [c];
      }
    }
    if (seg.length >= 3) out.push(seg);
  }
  return out;
}

/** Try appending/prepending a single hand card to any existing draft meld. */
function tryExtend(ed: DraftEditor): string[] {
  const played: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const card of sortCards(ed.getRemainingHand())) {
      for (const meld of ed.getDraft().melds) {
        const front = [card, ...meld.cards];
        const back = [...meld.cards, card];
        if (isValidMeld(back)) {
          ed.playHandCard(card.id, meld.id);
          played.push(card.id);
          progress = true;
          break;
        }
        if (isValidMeld(front)) {
          ed.playHandCard(card.id, meld.id, 0);
          played.push(card.id);
          progress = true;
          break;
        }
      }
      if (progress) break;
    }
  }
  return played;
}

/**
 * SimpleAi: lay down all hand melds + extend table melds with single cards.
 * `minimal` personality plays only one meld/extension per turn (conservative).
 */
export class SimpleAi implements AiPlayer {
  constructor(private readonly minimal = false) {}

  decide(state: GameState): AiDecision {
    const ed = new DraftEditor(state);
    const notes: string[] = [];
    const hand = state.players[state.activePlayerIndex]!.hand;

    for (const meld of findHandMelds(hand)) {
      const remaining = new Set(ed.getRemainingHand().map((c) => c.id));
      const cards = meld.filter((c) => remaining.has(c.id));
      if (cards.length < 3 || !isValidMeld(cards)) continue;
      const meldId = null;
      let target: string | null = meldId;
      for (const c of cards) {
        if (target === null) {
          ed.playHandCard(c.id, null);
          target = ed.getDraft().melds.at(-1)!.id;
        } else {
          ed.playHandCard(c.id, target);
        }
      }
      notes.push(`laid ${cards.map((c) => c.id).join('+')}`);
      if (this.minimal) break;
    }

    if (!this.minimal || notes.length === 0) {
      const ext = tryExtend(ed);
      if (ext.length) notes.push(`extended table with ${ext.join(',')}`);
      if (this.minimal && notes.length > 1) {
        // conservative: keep only first action — rebuild with single extension
        return this.decideMinimalExtendOnly(state);
      }
    }

    const check = ed.canConfirm();
    if (check.ok) {
      return { kind: 'confirm', draft: ed.getDraft(), explanation: notes.join('; ') };
    }
    return { kind: 'draw', explanation: 'no legal play — drawing' };
  }

  private decideMinimalExtendOnly(state: GameState): AiDecision {
    const ed = new DraftEditor(state);
    for (const card of sortCards(state.players[state.activePlayerIndex]!.hand)) {
      for (const meld of ed.getDraft().melds) {
        if (isValidMeld([...meld.cards, card])) {
          ed.playHandCard(card.id, meld.id);
          const check = ed.canConfirm();
          if (check.ok) {
            return { kind: 'confirm', draft: ed.getDraft(), explanation: `extended with ${card.id}` };
          }
        }
      }
    }
    return { kind: 'draw', explanation: 'no legal play — drawing' };
  }
}

interface Candidate {
  draft: DraftState;
  explanation: string;
  played: string[];
}

const MAX_CANDIDATES = 20;
const INTER_MELD_TRIPLE_CAP = 300;

function timeUp(deadline: number): boolean {
  return performance.now() >= deadline;
}

function sortedPlayed(draft: DraftState): string[] {
  return [...draft.handCardsPlayed].sort();
}

function addCandidate(candidates: Candidate[], draft: DraftState, explanation: string): void {
  candidates.push({ draft, explanation, played: sortedPlayed(draft) });
}

/** Steal an edge card (first/last) from a 4+ meld and form a brand-new meld with 2 or 3 hand cards. */
function tryStealForm(
  state: GameState,
  steal: Card,
  sourceLabel: string,
  handCards: Card[],
  candidates: Candidate[],
): void {
  const combo = [steal, ...handCards];
  if (!isValidMeld(combo)) return;
  const ed = new DraftEditor(state);
  ed.moveTableCard(steal.id, null);
  const newMeldId =
    ed.getDraft().melds.find((m) => m.cards.length === 1 && m.cards[0]!.id === steal.id)?.id ?? null;
  for (const hc of handCards) ed.playHandCard(hc.id, newMeldId);
  const check = ed.canConfirm();
  if (check.ok) {
    addCandidate(
      candidates,
      ed.getDraft(),
      `rearranged: took ${steal.id} from ${sourceLabel}, formed meld with ${handCards.map((c) => c.id).join('+')}`,
    );
  }
}

/** 1a. Steal an edge card from any 4+ meld, forming a new meld with 2 or 3 hand cards. */
function searchEdgeSteal(state: GameState, hand: Card[], candidates: Candidate[], deadline: number): void {
  for (const meld of state.table) {
    if (candidates.length >= MAX_CANDIDATES || timeUp(deadline)) return;
    if (meld.cards.length < 4) continue;
    for (const steal of [meld.cards[0]!, meld.cards.at(-1)!]) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          tryStealForm(state, steal, meld.id, [hand[i]!, hand[j]!], candidates);
          if (candidates.length >= MAX_CANDIDATES) return;
        }
      }
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          for (let k = j + 1; k < hand.length; k++) {
            tryStealForm(state, steal, meld.id, [hand[i]!, hand[j]!, hand[k]!], candidates);
            if (candidates.length >= MAX_CANDIDATES) return;
          }
        }
      }
      if (timeUp(deadline)) return;
    }
  }
}

/** 1b. Split a 6+ run at each valid midpoint, then either extend a part directly or
 *  steal the newly-exposed interior boundary card (if its side stays 3+) to form a
 *  new meld with 2 hand cards. */
function searchRunSplit(state: GameState, hand: Card[], candidates: Candidate[], deadline: number): void {
  for (const meld of state.table) {
    if (candidates.length >= MAX_CANDIDATES || timeUp(deadline)) return;
    if (meld.cards.length < 6 || !isValidRun(meld.cards)) continue;
    for (let splitIdx = 3; splitIdx <= meld.cards.length - 3; splitIdx++) {
      if (candidates.length >= MAX_CANDIDATES || timeUp(deadline)) return;
      const partA = meld.cards.slice(0, splitIdx);
      const partB = meld.cards.slice(splitIdx);

      const ed = new DraftEditor(state);
      if (ed.splitMeld(meld.id, splitIdx)) {
        const played = tryExtend(ed);
        if (played.length && ed.canConfirm().ok) {
          addCandidate(candidates, ed.getDraft(), `split ${meld.id} at ${splitIdx}, extended with ${played.join(',')}`);
        }
      }
      if (candidates.length >= MAX_CANDIDATES || timeUp(deadline)) return;

      const boundarySteals: Card[] = [];
      if (partA.length >= 4) boundarySteals.push(partA[partA.length - 1]!);
      if (partB.length >= 4) boundarySteals.push(partB[0]!);
      for (const steal of boundarySteals) {
        for (let i = 0; i < hand.length; i++) {
          for (let j = i + 1; j < hand.length; j++) {
            const combo = [steal, hand[i]!, hand[j]!];
            if (!isValidMeld(combo)) continue;
            const ed2 = new DraftEditor(state);
            if (!ed2.splitMeld(meld.id, splitIdx)) continue;
            ed2.moveTableCard(steal.id, null);
            const newMeldId =
              ed2.getDraft().melds.find((m) => m.cards.length === 1 && m.cards[0]!.id === steal.id)?.id ?? null;
            ed2.playHandCard(hand[i]!.id, newMeldId);
            ed2.playHandCard(hand[j]!.id, newMeldId);
            if (ed2.canConfirm().ok) {
              addCandidate(
                candidates,
                ed2.getDraft(),
                `split ${meld.id} at ${splitIdx}, took ${steal.id}, formed meld with ${hand[i]!.id}+${hand[j]!.id}`,
              );
            }
            if (candidates.length >= MAX_CANDIDATES) return;
          }
        }
      }
    }
  }
}

/** 1c. Move one edge card from a 4+ meld onto another meld (run extension or 4th set card),
 *  then try to play a hand card into whatever the move opened up. */
function searchInterMeldMove(state: GameState, hand: Card[], candidates: Candidate[], deadline: number): void {
  const melds = state.table;
  let tripleCount = 0;
  for (const source of melds) {
    if (candidates.length >= MAX_CANDIDATES || timeUp(deadline)) return;
    if (source.cards.length < 4) continue;
    for (const steal of [source.cards[0]!, source.cards.at(-1)!]) {
      for (const target of melds) {
        if (target.id === source.id) continue;
        if (++tripleCount > INTER_MELD_TRIPLE_CAP || candidates.length >= MAX_CANDIDATES || timeUp(deadline)) return;

        const back = [...target.cards, steal];
        const front = [steal, ...target.cards];
        let pos: number | null = null;
        if (isValidMeld(back)) pos = Infinity;
        else if (isValidMeld(front)) pos = 0;
        if (pos === null) continue;

        const ed = new DraftEditor(state);
        if (!ed.moveTableCard(steal.id, target.id, pos)) continue;
        const played = tryExtend(ed);
        if (played.length && ed.canConfirm().ok) {
          addCandidate(
            candidates,
            ed.getDraft(),
            `moved ${steal.id} from ${source.id} to ${target.id}, then played ${played.join(',')}`,
          );
        }
      }
    }
  }
}

function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.played.length !== b.played.length) return b.played.length - a.played.length;
  for (let i = 0; i < a.played.length; i++) {
    const x = a.played[i]!;
    const y = b.played[i]!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * RearrangerAi: broader deterministic rearrangement search. Collects up to
 * MAX_CANDIDATES confirmable drafts — SimpleAi's own play, edge-steal-to-new-meld
 * (2 or 3 hand cards), run splits (direct extend or interior-card steal), and
 * single-card inter-meld moves — then picks the one that plays the most hand
 * cards (ties broken lexicographically by sorted played-card ids). Bounded by a
 * wall-clock deadline; returns the best candidate found so far if it runs out.
 */
export class RearrangerAi implements AiPlayer {
  private simple = new SimpleAi(false);

  decide(state: GameState): AiDecision {
    const deadline = performance.now() + 400;
    const candidates: Candidate[] = [];
    const hand = sortCards(state.players[state.activePlayerIndex]!.hand);

    const simple = this.simple.decide(state);
    if (simple.kind === 'confirm') {
      addCandidate(candidates, simple.draft, simple.explanation);
    }

    if (candidates.length < MAX_CANDIDATES && !timeUp(deadline)) {
      searchEdgeSteal(state, hand, candidates, deadline);
    }
    if (candidates.length < MAX_CANDIDATES && !timeUp(deadline)) {
      searchRunSplit(state, hand, candidates, deadline);
    }
    if (candidates.length < MAX_CANDIDATES && !timeUp(deadline)) {
      searchInterMeldMove(state, hand, candidates, deadline);
    }

    if (candidates.length === 0) {
      return { kind: 'draw', explanation: 'no play even with rearrange — drawing' };
    }

    candidates.sort(compareCandidates);
    const best = candidates[0]!;
    return { kind: 'confirm', draft: best.draft, explanation: best.explanation };
  }
}

/**
 * Personality wrapper.
 * cida (conservative): minimal SimpleAi. juninho (aggressive): full SimpleAi.
 * bia (puzzle-minded): RearrangerAi. ze (patient): RearrangerAi but draws
 * while hand > 5 early game unless it can dump 3+ cards.
 */
export function createAi(personality: Personality): AiPlayer {
  switch (personality) {
    case 'cida':
      return new SimpleAi(true);
    case 'juninho':
      return new SimpleAi(false);
    case 'bia':
      return new RearrangerAi();
    case 'ze':
      return new PatientAi();
  }
}

class PatientAi implements AiPlayer {
  private inner = new RearrangerAi();
  decide(state: GameState): AiDecision {
    const d = this.inner.decide(state);
    if (d.kind === 'confirm') {
      const played = d.draft.handCardsPlayed.length;
      const hand = state.players[state.activePlayerIndex]!.hand.length;
      if (state.turn <= state.players.length * 2 && hand > 5 && played < 3) {
        return { kind: 'draw', explanation: `patient: holding ${played}-card play for later` };
      }
    }
    return d;
  }
}
