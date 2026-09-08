import { CARD_H, CARD_W } from '../assets/manifest';

export interface MeldLayoutInput {
  id: string;
  cardCount: number;
}

export interface MeldPosition {
  meldId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cardGap: number;
  /** Uniform card scale (1 = full CARD_W/CARD_H) chosen so all rows fit without overlapping. Caller must apply it to sprite size + padding. */
  cardScale: number;
}

interface RowItem {
  meldId: string;
  x: number;
  width: number;
}

const MELD_PAD = 4;
const MELD_GAP = 10; // horizontal gap between melds, at scale 1
const GAP_STEPS = [17, 14, 12, 10]; // CARD_GAP candidates at scale 1, most spacious first
// Card shrink candidates, tried only after gap compression fails to fit the height budget.
// Rows are always spaced by at least their (scaled) card height — never less — so melds can
// never visually overlap; when even the smallest scale can't fit, rows are still spaced by
// full row height and simply run past areaH rather than overlapping.
const SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.45];
const ROW_GAP_STEPS = [8, 6, 4, 2, 0];

function packRows(melds: MeldLayoutInput[], areaW: number, gap: number, cw: number, pad: number, meldGap: number): RowItem[][] {
  const rows: RowItem[][] = [];
  let row: RowItem[] = [];
  let x = 0;
  for (const meld of melds) {
    const width = cw + Math.max(0, meld.cardCount - 1) * gap + pad * 2;
    if (row.length > 0 && x + width > areaW) {
      rows.push(row);
      row = [];
      x = 0;
    }
    row.push({ meldId: meld.id, x, width });
    x += width + meldGap;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

interface Candidate {
  rows: RowItem[][];
  scale: number;
  gap: number;
  cw: number;
  ch: number;
  pad: number;
  rowGap: number;
}

/**
 * Pure layout: given melds and an available area, always returns one position per meld with
 * ROWS THAT NEVER OVERLAP. Prefers full card size + spacious gaps; compresses the horizontal
 * card gap first, then (only if still too tall) shrinks card size in steps, then compresses the
 * vertical row gap — picking the first combination whose total height fits areaH. Row pitch is
 * always >= the (possibly scaled) row height, so rows are never pushed into each other.
 */
export function computeMeldLayout(melds: MeldLayoutInput[], areaW: number, areaH: number): MeldPosition[] {
  if (melds.length === 0) return [];

  let best: Candidate | null = null;
  outer: for (const scale of SCALE_STEPS) {
    const cw = CARD_W * scale;
    const ch = CARD_H * scale;
    const pad = MELD_PAD * scale;
    const meldGap = MELD_GAP * scale;
    const rowH = ch + pad * 2;
    for (const gapBase of GAP_STEPS) {
      const gap = gapBase * scale;
      const rows = packRows(melds, areaW, gap, cw, pad, meldGap);
      for (const rowGap of ROW_GAP_STEPS) {
        const totalH = rows.length * rowH + Math.max(0, rows.length - 1) * rowGap;
        if (totalH <= areaH) {
          best = { rows, scale, gap, cw, ch, pad, rowGap };
          break outer;
        }
      }
    }
  }
  if (!best) {
    // Extreme fallback (far more melds than the table can ever realistically hold): smallest
    // scale, tightest gap, zero row gap. May run past areaH, but rows still never overlap.
    const scale = SCALE_STEPS[SCALE_STEPS.length - 1]!;
    const cw = CARD_W * scale;
    const ch = CARD_H * scale;
    const pad = MELD_PAD * scale;
    const meldGap = MELD_GAP * scale;
    const gap = GAP_STEPS[GAP_STEPS.length - 1]! * scale;
    const rows = packRows(melds, areaW, gap, cw, pad, meldGap);
    best = { rows, scale, gap, cw, ch, pad, rowGap: 0 };
  }

  const { rows, scale, gap, ch, pad } = best;
  const rowH = ch + pad * 2;
  const pitch = rowH + best.rowGap;

  const positions: MeldPosition[] = [];
  rows.forEach((row, rowIndex) => {
    const y = rowIndex * pitch;
    for (const item of row) {
      const x = Math.min(item.x, Math.max(0, areaW - item.width));
      positions.push({ meldId: item.meldId, x, y, width: item.width, height: rowH, cardGap: gap, cardScale: scale });
    }
  });
  return positions;
}
