import { canConfirmTurn, getInvalidMeldReasons } from '../rules/rules';
import type { Card, ConfirmResult, DraftState, GameState, Meld, MeldReason } from '../rules/types';

interface Snapshot {
  melds: Meld[];
  handCardsPlayed: string[];
}

function cloneMelds(melds: readonly Meld[]): Meld[] {
  return melds.map((m) => ({ id: m.id, cards: m.cards.map((c) => ({ ...c })) }));
}

const HISTORY_CAP = 100;

/**
 * Mexe Mode editor. Holds a draft of the table that may be temporarily invalid.
 * Undo/redo/reset over draft snapshots. Committed state untouched until FEITO.
 */
export class DraftEditor {
  private melds: Meld[];
  private handCardsPlayed: string[] = [];
  private history: Snapshot[] = [];
  private historyIndex = 0;
  private meldCounter = 0;

  /** The turn's starting position, kept outside `history` — that ring buffer drops its oldest
   * entries past HISTORY_CAP, so history[0] stops being the start after enough edits. */
  private readonly initial: Snapshot;

  constructor(private readonly committed: GameState) {
    this.melds = cloneMelds(committed.table);
    this.initial = this.snapshot();
    this.history = [this.snapshot()];
  }

  private snapshot(): Snapshot {
    return { melds: cloneMelds(this.melds), handCardsPlayed: [...this.handCardsPlayed] };
  }

  private restore(s: Snapshot): void {
    this.melds = cloneMelds(s.melds);
    this.handCardsPlayed = [...s.handCardsPlayed];
  }

  private push(): void {
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(this.snapshot());
    if (this.history.length > HISTORY_CAP) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  getDraft(): DraftState {
    return { melds: cloneMelds(this.melds), handCardsPlayed: [...this.handCardsPlayed] };
  }

  /** Active player's hand minus cards already placed on the draft table. */
  getRemainingHand(): Card[] {
    const placed = new Set(this.handCardsPlayed);
    return this.committed.players[this.committed.activePlayerIndex]!.hand.filter(
      (c) => !placed.has(c.id),
    );
  }

  /** Turn-namespaced: committed melds come from earlier turns, so ids never collide. */
  newMeldId(): string {
    return `m${this.committed.turn}-${this.meldCounter++}`;
  }

  /** Place a hand card into a meld (existing id) or a new meld (null). */
  playHandCard(cardId: string, meldId: string | null, position = Infinity): boolean {
    const card = this.getRemainingHand().find((c) => c.id === cardId);
    if (!card) return false;
    this.insert(card, meldId, position);
    this.handCardsPlayed.push(cardId);
    this.push();
    return true;
  }

  /** Move a card already on the draft table to another meld / new meld. */
  moveTableCard(cardId: string, targetMeldId: string | null, position = Infinity): boolean {
    let card: Card | undefined;
    for (const m of this.melds) {
      const i = m.cards.findIndex((c) => c.id === cardId);
      if (i >= 0) {
        card = m.cards[i];
        m.cards.splice(i, 1);
        break;
      }
    }
    if (!card) return false;
    this.insert(card, targetMeldId, position);
    this.melds = this.melds.filter((m) => m.cards.length > 0);
    this.push();
    return true;
  }

  /** Return a hand card from the draft table back to hand — allowed (it never left the turn). */
  returnHandCard(cardId: string): boolean {
    if (!this.handCardsPlayed.includes(cardId)) return false;
    for (const m of this.melds) {
      const i = m.cards.findIndex((c) => c.id === cardId);
      if (i >= 0) m.cards.splice(i, 1);
    }
    this.melds = this.melds.filter((m) => m.cards.length > 0);
    this.handCardsPlayed = this.handCardsPlayed.filter((id) => id !== cardId);
    this.push();
    return true;
  }

  /** Split a meld at index: cards[0..index) stay, cards[index..] become a new meld. */
  splitMeld(meldId: string, index: number): boolean {
    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld || index <= 0 || index >= meld.cards.length) return false;
    const moved = meld.cards.splice(index);
    this.melds.push({ id: this.newMeldId(), cards: moved });
    this.push();
    return true;
  }

  /** Merge source meld's cards onto the end of target meld. */
  mergeMelds(sourceId: string, targetId: string): boolean {
    const source = this.melds.find((m) => m.id === sourceId);
    const target = this.melds.find((m) => m.id === targetId);
    if (!source || !target || source === target) return false;
    target.cards.push(...source.cards);
    this.melds = this.melds.filter((m) => m !== source);
    this.push();
    return true;
  }

  private insert(card: Card, meldId: string | null, position: number): void {
    if (meldId === null) {
      this.melds.push({ id: this.newMeldId(), cards: [card] });
      return;
    }
    const meld = this.melds.find((m) => m.id === meldId);
    if (!meld) {
      this.melds.push({ id: this.newMeldId(), cards: [card] });
      return;
    }
    const pos = Math.max(0, Math.min(meld.cards.length, position));
    meld.cards.splice(pos, 0, card);
  }

  undo(): boolean {
    if (this.historyIndex === 0) return false;
    this.historyIndex--;
    this.restore(this.history[this.historyIndex]!);
    return true;
  }

  redo(): boolean {
    if (this.historyIndex >= this.history.length - 1) return false;
    this.historyIndex++;
    this.restore(this.history[this.historyIndex]!);
    return true;
  }

  reset(): void {
    this.restore(this.initial);
    this.push();
  }

  canConfirm(): ConfirmResult {
    return canConfirmTurn(this.committed, this.getDraft());
  }

  invalidMelds(): MeldReason[] {
    return getInvalidMeldReasons(this.melds, this.committed.config);
  }

  /** invalidMelds() + canConfirm() in one meld-analysis pass — each analyzes every meld
   * separately, so a caller needing both (e.g. a render that shows invalid badges AND gates
   * FEITO) should call this instead of both, to avoid analyzing every meld twice. */
  analyze(): { invalidMelds: MeldReason[]; check: ConfirmResult } {
    const invalidMelds = this.invalidMelds();
    return { invalidMelds, check: canConfirmTurn(this.committed, this.getDraft(), invalidMelds) };
  }

  /** Snapshot count — test hook to assert an op didn't push undo history. */
  historyLength(): number {
    return this.history.length;
  }
}
