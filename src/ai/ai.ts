import { DraftEditor } from '../mexe-mode/draft';
import { isValidMeld, isValidRun } from '../rules/rules';
import type { Card, DraftState, GameState } from '../rules/types';
import { compareByBaseEvaluation, evaluateDraft, type CandidateFeatures } from './evaluate';
import type { AiObservation } from './observation';

export type { AiObservation } from './observation';
export { observeForAi } from './observation';

export type AiDecision =
  | { kind: 'confirm'; draft: DraftState; explanation: string }
  | { kind: 'draw'; explanation: string };

/**
 * The AI boundary. The only inputs to a decision are the observation (the seat's player view —
 * see `observeForAi`), the engine's own configuration, fixed when the engine is constructed
 * (personality policy, search tier, trial budget), and nothing else: no clock, no settings read,
 * no scene, no unseeded randomness. Same observation + same engine ⇒ same decision (INV-A5).
 *
 * The result is gameplay intent, not presentation: `LocalMatch.runAiTurn` routes it to the same
 * `confirmTurn` / `drawAndEndTurn` action a person's FEITO or COMPRAR takes (INV-S7).
 */
export interface AiPlayer {
  decide(observation: AiObservation): AiDecision;
  /** Same decision, but computed in event-loop slices so a long search never blocks a whole
   * frame (see RearrangerAi). Absent on engines whose decide() is already cheap. */
  decideSliced?(observation: AiObservation): Promise<AiDecision>;
}

/** All personalities are deterministic: sorted iteration, first hit wins. */
export type Personality = 'cida' | 'juninho' | 'bia' | 'ze';

function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Find all melds of exactly 3+ cards formable from hand: sets by rank, runs by suit,
 * plus joker-assisted completions (two naturals + one joker) when a pure-natural meld
 * isn't there. Naturals-only melds are pushed first so callers that lay down melds in
 * order try natural plays before spending a joker. Group candidates select one natural
 * per suit; the run scanner below skips a same-rank duplicate rather than letting it
 * break the consecutive scan.
 */
function findHandMelds(hand: readonly Card[]): Card[][] {
  const naturals = hand.filter((c) => !c.isJoker);
  const jokers = sortCards(hand.filter((c) => c.isJoker));
  const out: Card[][] = [];
  // Sets
  const byRank = new Map<number, Card[]>();
  for (const c of sortCards(naturals)) {
    const arr = byRank.get(c.rank!) ?? [];
    arr.push(c);
    byRank.set(c.rank!, arr);
  }
  const rankEntries = [...byRank.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, cards] of rankEntries) {
    const onePerSuit = new Map<string, Card>();
    for (const card of cards) if (!onePerSuit.has(card.suit!)) onePerSuit.set(card.suit!, card);
    const group = [...onePerSuit.values()];
    if (group.length >= 3) out.push(group);
  }
  // Runs: longest maximal run per suit segment (a same-rank duplicate is skipped, not
  // reset into a new segment, so it never breaks an in-progress run).
  const bySuit = new Map<string, Card[]>();
  for (const c of sortCards(naturals)) {
    const arr = bySuit.get(c.suit!) ?? [];
    arr.push(c);
    bySuit.set(c.suit!, arr);
  }
  const suitEntries = [...bySuit.entries()].sort();
  for (const [, cards] of suitEntries) {
    const sorted = [...cards].sort((a, b) => a.rank! - b.rank!);
    let seg: Card[] = [];
    for (const c of sorted) {
      if (seg.length === 0 || c.rank === seg[seg.length - 1]!.rank! + 1) {
        seg.push(c);
      } else if (c.rank !== seg[seg.length - 1]!.rank) {
        if (seg.length >= 3) out.push(seg);
        seg = [c];
      }
    }
    if (seg.length >= 3) out.push(seg);
  }

  // Joker-assisted group: exactly two naturals of a rank + one joker.
  if (jokers.length > 0) {
    for (const [, cards] of rankEntries) {
      const onePerSuit = new Map<string, Card>();
      for (const card of cards) if (!onePerSuit.has(card.suit!)) onePerSuit.set(card.suit!, card);
      const uniqueSuits = [...onePerSuit.values()];
      for (let first = 0; first < uniqueSuits.length - 1; first++) {
        for (let second = first + 1; second < uniqueSuits.length; second++) {
          const combo = [uniqueSuits[first]!, uniqueSuits[second]!, jokers[0]!];
          if (isValidMeld(combo)) out.push(combo);
        }
      }
    }
  }

  // Joker-assisted run: two same-suit naturals at most 2 ranks apart (interior gap or
  // adjacent-for-an-end-fill) + one joker. Candidate generation only — analyzeMeld
  // (via isValidMeld) is what actually decides validity, including ace high/low bounds.
  if (jokers.length > 0) {
    for (const [, cards] of suitEntries) {
      const byRankUnique = new Map<number, Card>();
      for (const c of cards) if (!byRankUnique.has(c.rank!)) byRankUnique.set(c.rank!, c);
      const sorted = [...byRankUnique.entries()].sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < sorted.length - 1; i++) {
        const [r1, c1] = sorted[i]!;
        const [r2, c2] = sorted[i + 1]!;
        if (r2 - r1 > 2) continue;
        const combo = [c1, c2, jokers[0]!];
        if (isValidMeld(combo)) out.push(combo);
      }
    }
  }

  return out;
}

/**
 * Try appending/prepending a single hand card to any existing draft meld.
 * `holdJokers` keeps a joker back unless spending it empties the hand (the table is shared,
 * so an early joker mostly helps the other players) — strategy only, never legality.
 */
function tryExtend(ed: DraftEditor, holdJokers = false): string[] {
  const played: string[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    const remaining = sortCards(ed.getRemainingHand());
    for (const card of remaining) {
      if (holdJokers && card.isJoker && remaining.length > 1) continue;
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
 * `holdJokers` saves jokers for the play that goes out (see tryExtend).
 */
export class SimpleAi implements AiPlayer {
  constructor(
    private readonly minimal = false,
    private readonly holdJokers = false,
  ) {}

  decide(state: AiObservation): AiDecision {
    const ed = new DraftEditor(state);
    const notes: string[] = [];
    const hand = state.players[state.activePlayerIndex]!.hand;

    for (const meld of findHandMelds(hand)) {
      const remaining = new Set(ed.getRemainingHand().map((c) => c.id));
      const cards = meld.filter((c) => remaining.has(c.id));
      if (cards.length < 3 || !isValidMeld(cards)) continue;
      // hold the joker unless this meld empties the hand outright
      if (this.holdJokers && cards.some((c) => c.isJoker) && cards.length < remaining.size) continue;
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

    if (this.minimal) {
      // conservative: exactly one action per turn. `tryExtend` plays *every* available
      // extension, so the minimal path never calls it — a single extension only, and only
      // when no meld was laid down above.
      if (notes.length === 0) return this.decideMinimalExtendOnly(state);
    } else {
      const ext = tryExtend(ed, this.holdJokers);
      if (ext.length) notes.push(`extended table with ${ext.join(',')}`);
    }

    const check = ed.canConfirm();
    if (check.ok) {
      return { kind: 'confirm', draft: ed.getDraft(), explanation: notes.join('; ') };
    }
    return { kind: 'draw', explanation: 'no legal play — drawing' };
  }

  private decideMinimalExtendOnly(state: AiObservation): AiDecision {
    const ed = new DraftEditor(state);
    const hand = sortCards(state.players[state.activePlayerIndex]!.hand);
    for (const card of hand) {
      if (this.holdJokers && card.isJoker && hand.length > 1) continue;
      for (const meld of ed.getDraft().melds) {
        if (isValidMeld([...meld.cards, card])) {
          ed.playHandCard(card.id, meld.id);
          const check = ed.canConfirm();
          if (check.ok) {
            return { kind: 'confirm', draft: ed.getDraft(), explanation: `extended with ${card.id}` };
          }
          ed.undo(); // that extension doesn't stand on its own — don't carry it into the next try
        }
      }
    }
    return { kind: 'draw', explanation: 'no legal play — drawing' };
  }
}

interface Candidate {
  draft: DraftState;
  explanation: string;
  /** Base evaluation of this draft — the only thing `compareCandidates` looks at. */
  features: CandidateFeatures;
}

const MAX_CANDIDATES = 20;
/** Expert widens the same deterministic search: more candidates kept and weighed.
 * It never unlocks a move a lower tier could not also make legally — only how many it weighs. */
const EXPERT_MAX_CANDIDATES = 48;
/**
 * How many candidate trials a rearrange search may attempt before it stops and plays the best it
 * has found. One trial is one confirmable-draft attempt (a `DraftEditor` built and checked).
 *
 * This used to be a wall clock — `performance.now() + 400ms` (900ms for Expert) — checked inside
 * the search loops, which made the *chosen move* depend on how fast the machine happened to be: a
 * loaded machine cut the search short, kept fewer candidates and could return a different move for
 * the identical state. That is why replay, property tests and AI simulation could not reproduce an
 * AI decision. A trial count is the same bound expressed in work the search actually does, so the
 * move is a function of state and tier and nothing else.
 *
 * Sized as a genuine safety stop rather than a tuning knob: the densest table this game can ever
 * deal — a full two-deck shoe laid out as eight 13-card runs, the shape that maximises both split
 * points and edge steals, against a 20-card hand — runs the search to natural completion in 42.7k
 * trials (~136ms here). At 120k this never binds on a legal position, so every real decision is
 * the one the old deadline produced on a machine fast enough never to hit it; what remains is a
 * bound on pathological input. No wall clock is needed alongside it: a trial costs a bounded
 * amount of work over a bounded deck, so capping trials caps the runtime.
 *
 * One number for both tiers on purpose. The tiers only ever differed in how long they were allowed
 * to run, and that difference only had an effect when the clock bound — i.e. exactly in the
 * nondeterministic regime. What actually separates Expert is `EXPERT_MAX_CANDIDATES`.
 */
const SEARCH_BUDGET_TRIALS = 120_000;
const INTER_MELD_TRIPLE_CAP = 300;

/** Mutable trial counter threaded through one `decide` call. Shared by all phases of that call. */
class SearchBudget {
  constructor(public left: number) {}
  /** Charge one candidate trial. */
  charge(): void {
    this.left--;
  }
  get spent(): boolean {
    return this.left <= 0;
  }
}

function addCandidate(candidates: Candidate[], state: GameState, draft: DraftState, explanation: string): void {
  candidates.push({ draft, explanation, features: evaluateDraft(state, draft) });
}

/** Steal an edge card (first/last) from a 4+ meld and form a brand-new meld with 2 or 3 hand cards. */
function tryStealForm(
  state: GameState,
  steal: Card,
  sourceLabel: string,
  handCards: Card[],
  candidates: Candidate[],
  budget: SearchBudget,
): void {
  budget.charge();
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
      state,
      ed.getDraft(),
      `rearranged: took ${steal.id} from ${sourceLabel}, formed meld with ${handCards.map((c) => c.id).join('+')}`,
    );
  }
}

/** 1a. Steal an edge card from any 4+ meld, forming a new meld with 2 or 3 hand cards. */
function searchEdgeSteal(state: GameState, hand: Card[], candidates: Candidate[], budget: SearchBudget, cap: number): void {
  for (const meld of state.table) {
    if (candidates.length >= cap || budget.spent) return;
    if (meld.cards.length < 4) continue;
    for (const steal of [meld.cards[0]!, meld.cards.at(-1)!]) {
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          tryStealForm(state, steal, meld.id, [hand[i]!, hand[j]!], candidates, budget);
          if (candidates.length >= cap || budget.spent) return;
        }
      }
      for (let i = 0; i < hand.length; i++) {
        for (let j = i + 1; j < hand.length; j++) {
          for (let k = j + 1; k < hand.length; k++) {
            tryStealForm(state, steal, meld.id, [hand[i]!, hand[j]!, hand[k]!], candidates, budget);
            if (candidates.length >= cap || budget.spent) return;
          }
        }
      }
      if (budget.spent) return;
    }
  }
}

/** 1b. Split a 6+ run at each valid midpoint, then either extend a part directly or
 *  steal the newly-exposed interior boundary card (if its side stays 3+) to form a
 *  new meld with 2 hand cards. */
function searchRunSplit(state: GameState, hand: Card[], candidates: Candidate[], budget: SearchBudget, cap: number): void {
  for (const meld of state.table) {
    if (candidates.length >= cap || budget.spent) return;
    if (meld.cards.length < 6 || !isValidRun(meld.cards)) continue;
    for (let splitIdx = 3; splitIdx <= meld.cards.length - 3; splitIdx++) {
      if (candidates.length >= cap || budget.spent) return;
      budget.charge();
      const partA = meld.cards.slice(0, splitIdx);
      const partB = meld.cards.slice(splitIdx);

      const ed = new DraftEditor(state);
      if (ed.splitMeld(meld.id, splitIdx)) {
        const played = tryExtend(ed);
        if (played.length && ed.canConfirm().ok) {
          addCandidate(candidates, state, ed.getDraft(), `split ${meld.id} at ${splitIdx}, extended with ${played.join(',')}`);
        }
      }
      if (candidates.length >= cap || budget.spent) return;

      const boundarySteals: Card[] = [];
      if (partA.length >= 4) boundarySteals.push(partA[partA.length - 1]!);
      if (partB.length >= 4) boundarySteals.push(partB[0]!);
      for (const steal of boundarySteals) {
        for (let i = 0; i < hand.length; i++) {
          for (let j = i + 1; j < hand.length; j++) {
            if (candidates.length >= cap || budget.spent) return;
            budget.charge();
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
                state,
                ed2.getDraft(),
                `split ${meld.id} at ${splitIdx}, took ${steal.id}, formed meld with ${hand[i]!.id}+${hand[j]!.id}`,
              );
            }
            if (candidates.length >= cap) return;
          }
        }
      }
    }
  }
}

/** 1c. Move one edge card from a 4+ meld onto another meld (run extension or 4th set card),
 *  then try to play a hand card into whatever the move opened up. */
function searchInterMeldMove(state: GameState, hand: Card[], candidates: Candidate[], budget: SearchBudget, cap: number): void {
  const melds = state.table;
  let tripleCount = 0;
  for (const source of melds) {
    if (candidates.length >= cap || budget.spent) return;
    if (source.cards.length < 4) continue;
    for (const steal of [source.cards[0]!, source.cards.at(-1)!]) {
      for (const target of melds) {
        if (target.id === source.id) continue;
        if (++tripleCount > INTER_MELD_TRIPLE_CAP || candidates.length >= cap || budget.spent) return;
        budget.charge();

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
            state,
            ed.getDraft(),
            `moved ${steal.id} from ${source.id} to ${target.id}, then played ${played.join(',')}`,
          );
        }
      }
    }
  }
}

function compareCandidates(a: Candidate, b: Candidate): number {
  return compareByBaseEvaluation(a.features, b.features);
}

/**
 * RearrangerAi: broader deterministic rearrangement search. Collects up to
 * MAX_CANDIDATES confirmable drafts — SimpleAi's own play, edge-steal-to-new-meld
 * (2 or 3 hand cards), run splits (direct extend or interior-card steal), and
 * single-card inter-meld moves — then picks the one that plays the most hand
 * cards (ties broken lexicographically by sorted played-card ids). Bounded by a
 * deterministic trial budget (`SEARCH_BUDGET_TRIALS`); returns the best candidate found so far if
 * it runs out. The same state and tier always produce the same move — the search reads no clock.
 */
export class RearrangerAi implements AiPlayer {
  private simple: SimpleAi;
  private readonly cap: number;

  /** `wide` is the Expert tier: the same searches, more candidates kept. `budgetTrials` is the
   * deterministic work bound, an explicit decision input rather than a hidden constant — the
   * default is the shipped one and only tests ask for a smaller search. */
  constructor(
    private readonly holdJokers = false,
    wide = false,
    private readonly budgetTrials = SEARCH_BUDGET_TRIALS,
  ) {
    this.simple = new SimpleAi(false, holdJokers);
    this.cap = wide ? EXPERT_MAX_CANDIDATES : MAX_CANDIDATES;
  }

  /** Both search paths start from the same place: the plain play SimpleAi would have made (if
   * any) as the first candidate, plus the sorted hand every rearrange search works from. */
  private seedFromSimplePlay(state: AiObservation): { candidates: Candidate[]; hand: Card[] } {
    const candidates: Candidate[] = [];
    const simple = this.simple.decide(state);
    if (simple.kind === 'confirm') addCandidate(candidates, state, simple.draft, simple.explanation);
    return { candidates, hand: sortCards(state.players[state.activePlayerIndex]!.hand) };
  }

  decide(state: AiObservation): AiDecision {
    const cap = this.cap;
    const budget = new SearchBudget(this.budgetTrials);
    const { candidates, hand } = this.seedFromSimplePlay(state);

    for (const search of REARRANGE_SEARCHES) {
      if (candidates.length >= cap || budget.spent) break;
      search(state, hand, candidates, budget, cap);
    }
    return pickBest(candidates);
  }

  /** The same search, yielding: the event loop runs between phases, so frames render while the AI
   * "thinks" (#8). It spends the identical budget in the identical order as `decide`, so the two
   * paths do not merely tend to agree — they compute the same thing, and the frame yields are the
   * only difference. (They used to split the budget into per-phase wall-clock slices, which is
   * what made them two searches instead of one.) */
  async decideSliced(state: AiObservation): Promise<AiDecision> {
    const cap = this.cap;
    const budget = new SearchBudget(this.budgetTrials);
    const { candidates, hand } = this.seedFromSimplePlay(state);

    for (const search of REARRANGE_SEARCHES) {
      if (candidates.length >= cap || budget.spent) break;
      await new Promise<void>((r) => setTimeout(r, 0));
      search(state, hand, candidates, budget, cap);
    }
    return pickBest(candidates);
  }
}

const REARRANGE_SEARCHES = [searchEdgeSteal, searchRunSplit, searchInterMeldMove];

function pickBest(candidates: Candidate[]): AiDecision {
  if (candidates.length === 0) {
    return { kind: 'draw', explanation: 'no play even with rearrange — drawing' };
  }
  candidates.sort(compareCandidates);
  const best = candidates[0]!;
  return { kind: 'confirm', draft: best.draft, explanation: best.explanation };
}

export type EmoteKey = 'excited' | 'thinking' | 'annoyed' | 'happy' | 'sleepy' | 'confident';

/** Per-personality presentation constants — pace, emotes, characterful line keys (see i18n `ai.line.*`).
 * Data only; no behavioural branching lives here. `thinkMs` is a base for GameScene's turn delay
 * (presentation-only, capped, skipped under reducedMotion/headless — see GameScene.aiThinkDelay). */
export const PERSONALITY_STYLE: Record<
  Personality,
  { thinkMs: number; emoteBig: EmoteKey; emoteSmall: EmoteKey; emoteDraw: EmoteKey; thinkEmote: EmoteKey }
> = {
  // AI-02: `thinkEmote` is the pre-move "considering the table" tell (GameScene.onTurnStart),
  // distinct per personality instead of one generic pause — calm patience for Cida, eager fidget
  // for Juninho, quiet calculation for Bia, half-asleep for Zé, matching each one's `ai.line.*`.
  cida: { thinkMs: 900, emoteBig: 'happy', emoteSmall: 'thinking', emoteDraw: 'thinking', thinkEmote: 'thinking' },
  juninho: { thinkMs: 250, emoteBig: 'confident', emoteSmall: 'excited', emoteDraw: 'annoyed', thinkEmote: 'excited' },
  bia: { thinkMs: 600, emoteBig: 'happy', emoteSmall: 'excited', emoteDraw: 'thinking', thinkEmote: 'confident' },
  ze: { thinkMs: 700, emoteBig: 'confident', emoteSmall: 'happy', emoteDraw: 'sleepy', thinkEmote: 'sleepy' },
};

/** Presentation-only pace of an AI's "thinking" pause. Never changes what the AI decides. Declared
 * here rather than next to the setting that stores it: `settings` reads it, the AI owns it, and
 * the other direction was the type-only import cycle in ARCH-012. */
export type AiSpeed = 'instant' | 'fast' | 'normal' | 'slow';

/** Presentation-only multiplier on an AI's pre-move "thinking" pause. Never touches the search
 * budget: a faster pace shows the same decision sooner, it does not make the AI weaker. */
export const AI_SPEED_SCALE: Record<AiSpeed, number> = { instant: 0, fast: 0.5, normal: 1, slow: 1.8 };

/**
 * Strip the personality prefix off a tagged explanation (`bia:rearrange-extend: ...`) and return
 * just the reason class, which is the `ai.why.<suffix>` localization key. Returns `'draw'` for
 * anything unrecognized, so an untagged explanation degrades to the generic line rather than
 * rendering a raw key on screen.
 */
export function aiReasonKeySuffix(explanation: string): string {
  const tag = explanation.split(':', 2)[1];
  return tag !== undefined && AI_REASON_KEYS.includes(tag) ? tag : 'draw';
}

const AI_REASON_KEYS: readonly string[] = [
  'minimal-extend', 'minimal-meld', 'dump-all', 'dump',
  'rearrange-extend', 'simple-best', 'big-rearrange', 'big-play',
  'hold-for-bigger', 'draw',
];

/** Classify *why* a personality made this move, for debug/e2e (`ai:reason` tag prepended to
 * `explanation`) — not used for any behavioural decision. */
function classifyReason(personality: Personality, d: AiDecision): string {
  if (d.kind === 'draw') {
    if (personality === 'ze' && d.explanation.startsWith('patient:')) return 'ze:hold-for-bigger';
    return `${personality}:draw`;
  }
  const played = d.draft.handCardsPlayed.length;
  const rearranged = /rearranged|split|moved/.test(d.explanation);
  switch (personality) {
    case 'cida':
      return d.explanation.startsWith('extended') ? 'cida:minimal-extend' : 'cida:minimal-meld';
    case 'juninho':
      return played >= 3 ? 'juninho:dump-all' : 'juninho:dump';
    case 'bia':
      return rearranged ? 'bia:rearrange-extend' : 'bia:simple-best';
    case 'ze':
      return rearranged ? 'ze:big-rearrange' : 'ze:big-play';
  }
}

function tagReason(personality: Personality, d: AiDecision): AiDecision {
  return { ...d, explanation: `${classifyReason(personality, d)}: ${d.explanation}` } as AiDecision;
}

/** How hard the opponents play. Difficulty picks the *search tier*; personality picks the
 * *policy* (joker holding, minimal vs. full play, patience). Both are orthogonal, and neither
 * can produce an illegal meld: every candidate still goes through `DraftEditor.canConfirm`. */
export type Difficulty = 'beginner' | 'casual' | 'smart' | 'expert';

export const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'casual', 'smart', 'expert'];

/** Per-personality policy. `smart` (the default tier) reproduces exactly the engine each
 * personality had before difficulty existed, so existing behaviour and tests are unchanged. */
const PERSONALITY_TRAITS: Record<Personality, { holdJokers: boolean; minimal: boolean; rearrange: boolean; patient: boolean }> = {
  cida: { holdJokers: true, minimal: true, rearrange: false, patient: false },
  juninho: { holdJokers: false, minimal: false, rearrange: false, patient: false },
  bia: { holdJokers: true, minimal: false, rearrange: true, patient: false },
  ze: { holdJokers: true, minimal: false, rearrange: true, patient: true },
};

/**
 * Personality wrapper.
 * cida (conservative): minimal SimpleAi. juninho (aggressive): full SimpleAi.
 * bia (puzzle-minded): RearrangerAi. ze (patient): RearrangerAi but draws
 * while hand > 5 early game unless it can dump 3+ cards.
 *
 * `difficulty` scales the search only:
 * - beginner: one action per turn, jokers held — plays legally but misses combinations
 * - casual: full lay-down + extensions, never rearranges the shared table
 * - smart (default): the personality's own engine
 * - expert: the rearrangement search for every personality, widened
 * Patience (ze) applies at every tier above beginner.
 */
export function createAi(personality: Personality, difficulty: Difficulty = 'smart'): AiPlayer {
  const traits = PERSONALITY_TRAITS[personality];
  const base: AiPlayer = (() => {
    switch (difficulty) {
      case 'beginner':
        return new SimpleAi(true, traits.holdJokers);
      case 'casual':
        return new SimpleAi(traits.minimal, traits.holdJokers);
      case 'smart':
        return traits.rearrange ? new RearrangerAi(traits.holdJokers) : new SimpleAi(traits.minimal, traits.holdJokers);
      case 'expert':
        return new RearrangerAi(traits.holdJokers, true);
    }
  })();
  const engine = traits.patient && difficulty !== 'beginner' ? new PatientAi(base) : base;
  return {
    decide: (state) => tagReason(personality, engine.decide(state)),
    ...(engine.decideSliced
      ? { decideSliced: async (state: AiObservation) => tagReason(personality, await engine.decideSliced!(state)) }
      : {}),
  };
}

class PatientAi implements AiPlayer {
  constructor(private readonly inner: AiPlayer) {}
  decide(state: AiObservation): AiDecision {
    return this.applyPatience(state, this.inner.decide(state));
  }
  async decideSliced(state: AiObservation): Promise<AiDecision> {
    const d = this.inner.decideSliced ? await this.inner.decideSliced(state) : this.inner.decide(state);
    return this.applyPatience(state, d);
  }
  private applyPatience(state: AiObservation, d: AiDecision): AiDecision {
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
