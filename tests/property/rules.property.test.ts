/**
 * Rules properties — statements that must hold for *every* deck, deal and meld, not for the
 * enumerated cases in `tests/rules.test.ts`. Those examples pin the answers this game gives
 * (Q-K-A never wraps, a group is 3–4 cards); the properties below pin the shape of the answer:
 * the deal partitions the deck, a legal meld is accepted whatever it is made of, an illegal one
 * always names a reason, and the two validators never disagree.
 *
 * Fast budgets run in `npm run test`; `npm run test:property` raises them. Every failure prints
 * its seed — see [TESTING.md](../../docs/TESTING.md#property-and-fuzz-testing).
 */
import { describe, expect, it } from 'vitest';
import {
  analyzeMeld,
  createDeck,
  dealInitialHands,
  getInvalidMeldReasons,
  isValidMeld,
  shuffleDeck,
  sortMeldCards,
  validateTable,
} from '../../src/rules/rules';
import { createRng } from '../../src/rules/rng';
import { DEFAULT_RULES, type Card } from '../../src/rules/types';
import { arbitraryCards, shuffled, validMeld, type GeneratedMeld } from '../helpers/generators';
import { forAll, runs } from '../helpers/property';

const ids = (cards: readonly Card[]): string[] => cards.map((c) => c.id).sort();
const describeMeld = (m: GeneratedMeld): string => `${m.kind} ${m.cards.map((c) => c.id).join(' ')}`;

describe('deck, shuffle and deal', () => {
  it('a shuffle preserves the deck and is fixed by its seed', () => {
    forAll(
      'shuffle preserves the deck and is fixed by its seed',
      { runs: runs(30, 800), generate: (rng) => rng.int(1_000_000), describe: (seed) => `seed ${seed}` },
      (seed) => {
        const deck = createDeck();
        const once = shuffleDeck(deck, createRng(seed));
        expect(ids(once)).toEqual(ids(deck));
        // Determinism is the product requirement (INV-R1/R2); shuffle *quality* deliberately is
        // not asserted — there is no product claim about distribution to break.
        expect(ids(shuffleDeck(deck, createRng(seed)))).toEqual(ids(once));
        expect(shuffleDeck(deck, createRng(seed)).map((c) => c.id)).toEqual(once.map((c) => c.id));
      },
    );
  });

  it('a deal partitions the deck: every card lands in exactly one hand or the pile', () => {
    forAll(
      'a deal partitions the deck',
      {
        runs: runs(20, 500),
        generate: (rng) => ({ seed: rng.int(1_000_000), seats: 2 + rng.int(3) }),
        describe: ({ seed, seats }) => `seed ${seed}, ${seats} seats`,
      },
      ({ seed, seats }) => {
        const deck = shuffleDeck(createDeck(), createRng(seed));
        const { hands, drawPile } = dealInitialHands(deck, seats);
        expect(hands).toHaveLength(seats);
        for (const hand of hands) expect(hand).toHaveLength(DEFAULT_RULES.handSize);
        expect(ids([...hands.flat(), ...drawPile])).toEqual(ids(deck));
      },
    );
  });
});

describe('meld analysis', () => {
  it('a meld built to be legal is accepted, and a joker gets exactly one assignment', () => {
    forAll(
      'a meld built to be legal is accepted',
      { runs: runs(60, 3000), generate: (rng) => validMeld(rng), describe: describeMeld },
      (meld) => {
        const analysis = analyzeMeld(meld.cards);
        expect(analysis.valid, `rejected a constructed ${meld.kind}`).toBe(true);
        if (!analysis.valid) return;
        // INV-G4: the joker's role is derived, never written into the card.
        expect(analysis.assignments).toHaveLength(meld.jokerCount);
        for (const a of analysis.assignments) {
          expect(meld.cards.some((c) => c.id === a.cardId && c.isJoker)).toBe(true);
          expect(a.rank).toBeGreaterThanOrEqual(1);
          expect(a.rank).toBeLessThanOrEqual(13);
        }
        expect(meld.cards.every((c) => (c.isJoker ? c.rank === null && c.suit === null : true))).toBe(true);
      },
    );
  });

  it('legality does not depend on the order the cards sit in', () => {
    forAll(
      'legality does not depend on card order',
      {
        runs: runs(60, 3000),
        generate: (rng) => {
          const meld = validMeld(rng);
          return { meld, reordered: shuffled(rng, meld.cards) };
        },
        describe: ({ meld, reordered }) => `${describeMeld(meld)} → ${reordered.map((c) => c.id).join(' ')}`,
      },
      ({ reordered }) => {
        expect(isValidMeld(reordered)).toBe(true);
      },
    );
  });

  it('a second joker in a meld is always refused (INV-G5)', () => {
    forAll(
      'a second joker is always refused',
      {
        runs: runs(40, 2000),
        generate: (rng) => validMeld(rng),
        describe: describeMeld,
      },
      (meld) => {
        const jokers = createDeck().filter((c) => c.isJoker && !meld.cards.some((m) => m.id === c.id));
        // Two jokers standing in for naturals rather than appended: the meld keeps a legal
        // length and keeps at least one natural, so the refusal can only be about the jokers.
        const naturals = meld.cards.filter((c) => !c.isJoker);
        const withTwo = [jokers[0]!, jokers[1]!, ...naturals.slice(naturals.length >= 3 ? 2 : 1)];
        const analysis = analyzeMeld(withTwo);
        expect(analysis.valid).toBe(false);
        if (!analysis.valid) expect(analysis.reason).toBe('reason.tooManyJokers');
      },
    );
  });

  it('a rejected meld always names a reason, and the table validators agree with it', () => {
    forAll(
      'a rejected meld names a reason and the validators agree',
      {
        runs: runs(80, 5000),
        size: 6,
        generate: (rng, size) => arbitraryCards(rng, rng.int(size) + 1),
        describe: (cards) => cards.map((c) => c.id).join(' '),
      },
      (cards) => {
        const analysis = analyzeMeld(cards);
        const meld = { id: 'm', cards };
        // Three entry points, one authority: whatever `analyzeMeld` decides, the table-level
        // validators must say the same thing about a table holding only this meld.
        expect(isValidMeld(cards)).toBe(analysis.valid);
        expect(validateTable([meld])).toBe(analysis.valid);
        expect(getInvalidMeldReasons([meld]).length === 0).toBe(analysis.valid);
        if (!analysis.valid) {
          expect(analysis.reason).toMatch(/^reason\./);
          expect(getInvalidMeldReasons([meld])[0]).toEqual({ meldId: 'm', reason: analysis.reason });
        }
      },
    );
  });

  it('display sorting never loses a card and never throws, legal meld or not', () => {
    forAll(
      'display sorting never loses a card',
      {
        runs: runs(60, 3000),
        size: 6,
        generate: (rng, size) => (rng.int(2) === 0 ? validMeld(rng).cards : arbitraryCards(rng, rng.int(size) + 1)),
        describe: (cards) => cards.map((c) => c.id).join(' '),
      },
      (cards) => {
        const sorted = sortMeldCards(cards);
        expect(ids(sorted)).toEqual(ids(cards));
        // Sorting is presentation: it must not change the legality of what it displays.
        expect(isValidMeld(sorted)).toBe(isValidMeld(cards));
      },
    );
  });
});
