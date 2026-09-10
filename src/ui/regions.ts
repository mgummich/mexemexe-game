import type { ViewProfile } from './viewport';

/**
 * Every screen position GameScene needs, as data instead of literals, so the same scene code
 * draws a 480x270 landscape board and a 270x480 portrait one.
 *
 * The landscape numbers here are byte-for-byte the constants GameScene used before this module
 * existed — that is the "no desktop regression" guarantee, and tests assert it.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ButtonSpec extends Rect {
  /** Font size passed to PixelButton. */
  size: number;
}

export interface GameRegions {
  w: number;
  h: number;
  portrait: boolean;
  touch: boolean;

  /** Top status bar height (opponents + deck row). */
  barH: number;
  deckImg: { x: number; y: number };
  deckText: { x: number; y: number };
  /** Opponent avatar strip: seat i (excluding the local seat) sits at x0 + n * step. */
  opponentX0: number;
  opponentStep: number;
  opponentY: number;

  banner: { x: number; y: number };
  lastMove: { x: number; y: number; wrap: number };
  onlineNotice: { x: number; y: number; wrap: number };
  onlineDot: { x: number; y: number };

  tableTop: number;
  tableBottom: number;
  tableLeft: number;
  tableAreaW: number;
  tableAreaH: number;
  /** Rightmost x still counted as "the table" by a drop / tap on empty space. */
  tableRightBound: number;

  handY: number;
  handCenterX: number;
  handSpan: number;
  /** Tap target for "put this card back in my hand". */
  handZone: Rect;

  /** Opaque backdrop behind the action cluster, rounded-rect. */
  actionPanel: Rect;
  /**
   * Second opaque backdrop, behind the upper right-hand control column (gear / zoom / reset /
   * Mexe toggle). Only landscape-on-touch has one: that layout moves those four controls onto
   * bare table art, which bakes props (the boteco mug, the kitchen plate) right under them.
   * Desktop landscape and portrait keep their existing look, so both report `null`.
   */
  controlPanel: Rect | null;
  feito: ButtonSpec;
  comprar: ButtonSpec;
  undo: ButtonSpec;
  redo: ButtonSpec;
  reset: ButtonSpec;
  sort: ButtonSpec;
  gear: ButtonSpec;
  /** Toggles the focused Mexe editor (Phase 14 Wave C, landscape support added later). */
  mexeToggle: ButtonSpec;
  /** Table zoom in/out (Phase 14 Wave D) — a crowded table trades visible area for card size. */
  zoomIn: ButtonSpec;
  zoomOut: ButtonSpec;

  reason: { x: number; y: number; wrap: number; originY: number; size: number };
  selectHint: { x: number; y: number };

  /** Meld-reason tooltip clamp bounds (centre x is clamped into [minX, maxX]). */
  tooltip: { maxW: number; minX: number; maxX: number; maxY: number };

  /** Tutorial speech panel. Landscape parks it in the unused right column, portrait has no such
   * column, so it becomes a band across the top of the table area with its buttons side by side. */
  tutorialPanel: Rect;
}

/**
 * Landscape button boxes grow a little on a touch screen; the cluster has the slack for it.
 *
 * The grid is authored at 480 wide. A wider world (phones in landscape are 19.5:9, see
 * `landscapeWidth` in viewport.ts) is treated as "the same layout with more table": `dx` is the
 * extra width, right-anchored furniture (the action cluster, gear, zoom, tutorial panel) slides
 * right by all of it, the table and the hand grow into it, and centred text follows the new
 * centre. dx is 0 at 480, so the desktop grid is untouched.
 */
/**
 * The landscape reason line, laid out across the strip between the table bottom (188) and the
 * hand zone (216) instead of inside the right-hand column. Used whenever that column is spoken
 * for: on touch (gear/zoom/reset/mexeToggle fill it) and in tutorial mode (the step panel fills
 * it) — in both cases the in-column version drew straight over what was already there.
 */
export function wideReason(w: number): GameRegions['reason'] {
  return { x: (w - 82) / 2, y: 192, wrap: w - 110, originY: 0, size: 9 };
}

function landscape(p: ViewProfile): GameRegions {
  const t = p.touch;
  const w = Math.max(480, p.w);
  const dx = w - 480;
  const half = dx / 2;
  return {
    w,
    h: 270,
    portrait: false,
    touch: t,

    barH: 30,
    deckImg: { x: 22, y: 14 },
    deckText: { x: 34, y: 8 },
    opponentX0: 60,
    opponentStep: 105,
    opponentY: 14,

    banner: { x: w / 2, y: 41 },
    lastMove: { x: w / 2, y: 70, wrap: 300 + dx },
    onlineNotice: { x: w / 2, y: 58, wrap: 300 + dx },
    onlineDot: { x: 6, y: 264 },

    tableTop: 80,
    tableBottom: 188,
    tableLeft: 14,
    tableAreaW: w - 96 - 14,
    tableAreaH: 188 - 80 - 6,
    tableRightBound: w - 84,

    handY: 240,
    handCenterX: 200 + half,
    handSpan: 330 + dx,
    handZone: { x: 20, y: 240 - 24, w: 360 + dx, h: 48 },

    // Touch: right column (x>tableRightBound, free y0-270) re-laid-out top to bottom as gear,
    // zoomIn/zoomOut, reset, feito, comprar, undo/redo — every hit box >=31 tall, none overlap.
    // Desktop values below are untouched (same numbers as before this fix).
    actionPanel: t ? { x: 400 + dx, y: 155, w: 80, h: 113 } : { x: 398 + dx, y: 140, w: 78, h: 130 },
    // Spans the touch column's top cluster: gear (hit box 2.5-33.5), zoom pair (40.5-71.5),
    // reset (78.5-109.5) and mexeToggle (112-140). Stops short of actionPanel's y155.
    controlPanel: t ? { x: 400 + dx, y: 0, w: 80, h: 146 } : null,
    feito: t ? { x: 438 + dx, y: 176, w: 72, h: 34, size: 10 } : { x: 440 + dx, y: 210, w: 64, h: 22, size: 9 },
    comprar: t ? { x: 438 + dx, y: 214, w: 72, h: 32, size: 9 } : { x: 440 + dx, y: 237, w: 64, h: 20, size: 8 },
    undo: t ? { x: 419 + dx, y: 250, w: 36, h: 31, size: 8 } : { x: 414 + dx, y: 260, w: 16, h: 14, size: 8 },
    redo: t ? { x: 457 + dx, y: 250, w: 36, h: 31, size: 8 } : { x: 436 + dx, y: 260, w: 16, h: 14, size: 8 },
    reset: t ? { x: 438 + dx, y: 94, w: 72, h: 31, size: 8 } : { x: 460 + dx, y: 260, w: 22, h: 14, size: 8 },
    sort: t ? { x: 30, y: 246, w: 34, h: 31, size: 8 } : { x: 30, y: 246, w: 16, h: 14, size: 8 },
    gear: t ? { x: 438 + dx, y: 18, w: 34, h: 31, size: 8 } : { x: 462 + dx, y: 10, w: 16, h: 14, size: 8 },
    // Free strip between reset (ends y125/y24) and the next cluster (actionPanel y155 / zoomIn
    // y55) — sized to fit there without touching either neighbour.
    mexeToggle: t ? { x: 438 + dx, y: 126, w: 72, h: 28, size: 8 } : { x: 438 + dx, y: 30, w: 64, h: 14, size: 8 },
    zoomIn: t ? { x: 419 + dx, y: 56, w: 36, h: 31, size: 9 } : { x: 418 + dx, y: 55, w: 20, h: 17, size: 9 },
    zoomOut: t ? { x: 457 + dx, y: 56, w: 36, h: 31, size: 9 } : { x: 442 + dx, y: 55, w: 20, h: 17, size: 9 },

    // Desktop keeps the reason inside the action column (it has 50 free units above FEITO there).
    // The touch column does not: gear/zoom/reset/mexeToggle already fill y0-140 and the action
    // cluster starts at y155, so a 72-wide reason wrapped to 3-4 lines drew straight over reset
    // and the Mexe toggle. On touch it moves to the full-width strip between the table bottom
    // (188) and the hand zone (216), where the same copy fits on one line.
    reason: t ? wideReason(w) : { x: 440 + dx, y: 191, wrap: 72, originY: 1, size: 9 },
    selectHint: { x: 190 + half, y: 265 },

    tooltip: { maxW: 96, minX: 0, maxX: w - 92, maxY: 270 - 30 },

    tutorialPanel: { x: 398 + dx, y: 2, w: 80, h: 176 },
  };
}

/**
 * Portrait: table on top (it gets the whole width — no reserved right column), hand below it,
 * then a pinned action bar. FEITO and COMPRAR sit side by side at 40 and 36 units tall so they
 * clear a comfortable touch size once the 270-wide world is scaled up to a phone screen.
 */
function portrait(p: ViewProfile): GameRegions {
  return {
    w: 270,
    h: 480,
    portrait: true,
    touch: p.touch,

    barH: 44,
    deckImg: { x: 20, y: 20 },
    deckText: { x: 32, y: 14 },
    opponentX0: 62,
    opponentStep: 66,
    opponentY: 20,

    banner: { x: 135, y: 52 },
    lastMove: { x: 135, y: 66, wrap: 250 },
    onlineNotice: { x: 135, y: 78, wrap: 250 },
    onlineDot: { x: 8, y: 40 },

    tableTop: 88,
    tableBottom: 320,
    tableLeft: 8,
    tableAreaW: 254,
    tableAreaH: 320 - 88 - 6,
    tableRightBound: 270 - 4,

    handY: 344,
    handCenterX: 135,
    handSpan: 210,
    handZone: { x: 10, y: 344 - 24, w: 250, h: 48 },

    actionPanel: { x: 0, y: 360, w: 270, h: 120 },
    controlPanel: null,
    feito: { x: 192, y: 452, w: 140, h: 40, size: 12 },
    comprar: { x: 66, y: 452, w: 104, h: 36, size: 9 },
    // One row, 8 controls, centres exactly 34 apart — 8 * 34 = 272 barely exceeds the 270-wide
    // world, so the row is centred with a 1-unit hitbox spill off each edge (imperceptible)
    // rather than 8 controls squeezed to <34 (that reopens the overlap bug this fixes). y412, h31
    // hit box spans 396.5-427.5 — clear of reason/selectHint above and feito/comprar (y452, h40,
    // spans 432-472) below.
    mexeToggle: { x: 16, y: 412, w: 32, h: 28, size: 9 },
    undo: { x: 50, y: 412, w: 32, h: 28, size: 9 },
    redo: { x: 84, y: 412, w: 32, h: 28, size: 9 },
    reset: { x: 118, y: 412, w: 32, h: 28, size: 9 },
    sort: { x: 152, y: 412, w: 32, h: 28, size: 9 },
    gear: { x: 186, y: 412, w: 32, h: 28, size: 9 },
    zoomIn: { x: 220, y: 412, w: 32, h: 28, size: 7 },
    zoomOut: { x: 254, y: 412, w: 32, h: 28, size: 7 },

    reason: { x: 135, y: 374, wrap: 250, originY: 0, size: 9 },
    selectHint: { x: 135, y: 366 },

    tooltip: { maxW: 150, minX: 0, maxX: 270 - 6, maxY: 480 - 170 },

    tutorialPanel: { x: 8, y: 88, w: 254, h: 74 },
  };
}

export function gameRegions(p: ViewProfile): GameRegions {
  return p.portrait ? portrait(p) : landscape(p);
}
