import { describe, expect, it } from 'vitest';
import { computeMeldLayout, type MeldLayoutInput, type MeldPosition } from '../src/table/layout';
import { CARD_W } from '../src/assets/manifest';

// Matches GameScene's actual usable table area post p4-1 (TABLE_TOP raised 36->80 to clear props).
const AREA_W = 370;
const AREA_H = 102;

/** True if two meld rects (in the y-x-width-height sense computeMeldLayout returns) overlap. */
function rectsOverlap(a: MeldPosition, b: MeldPosition): boolean {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  return a.x < bx2 && ax2 > b.x && a.y < by2 && ay2 > b.y;
}

function assertNoOverlaps(positions: MeldPosition[]): void {
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      expect(rectsOverlap(positions[i]!, positions[j]!)).toBe(false);
    }
  }
}

describe('computeMeldLayout', () => {
  for (let n = 1; n <= 13; n++) {
    it(`places all ${n} meld(s) on-screen without overlap`, () => {
      const melds: MeldLayoutInput[] = Array.from({ length: n }, (_, i) => ({ id: `m${i}`, cardCount: 3 }));
      const positions = computeMeldLayout(melds, AREA_W, AREA_H);
      expect(positions).toHaveLength(n);
      for (const p of positions) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.width).toBeGreaterThanOrEqual(CARD_W * p.cardScale);
        expect(p.cardGap).toBeGreaterThan(0);
        expect(p.cardScale).toBeGreaterThan(0);
        expect(p.cardScale).toBeLessThanOrEqual(1);
      }
      assertNoOverlaps(positions);
      const ids = new Set(positions.map((p) => p.meldId));
      expect(ids.size).toBe(n);
    });
  }

  it('returns empty for no melds', () => {
    expect(computeMeldLayout([], AREA_W, AREA_H)).toEqual([]);
  });

  it('handles a very long single run without dropping it', () => {
    const positions = computeMeldLayout([{ id: 'run', cardCount: 13 }], AREA_W, AREA_H);
    expect(positions).toHaveLength(1);
    expect(positions[0]!.y).toBeGreaterThanOrEqual(0);
  });

  it('never overlaps rows at a crowded stress table (up to 80 visible cards)', () => {
    for (const cardCount of [80, 60, 40]) {
      const meldCount = Math.ceil(cardCount / 3);
      const melds: MeldLayoutInput[] = Array.from({ length: meldCount }, (_, i) => ({
        id: `m${i}`,
        cardCount: i % 4 === 0 ? 4 : 3, // mix of run/set sizes, matches real melds
      }));
      const positions = computeMeldLayout(melds, AREA_W, AREA_H);
      expect(positions).toHaveLength(meldCount);
      assertNoOverlaps(positions);
    }
  });

  it('shrinks card scale together across a row rather than per-meld (uniform row scale)', () => {
    // Many small melds forces row compression; every meld sharing the layout pass should agree
    // on the same scale so cards don't render at mismatched sizes within one table.
    const melds: MeldLayoutInput[] = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, cardCount: 3 }));
    const positions = computeMeldLayout(melds, AREA_W, AREA_H);
    const scales = new Set(positions.map((p) => p.cardScale));
    expect(scales.size).toBe(1);
  });
});
