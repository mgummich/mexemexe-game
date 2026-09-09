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
  feito: ButtonSpec;
  comprar: ButtonSpec;
  undo: ButtonSpec;
  redo: ButtonSpec;
  reset: ButtonSpec;
  sort: ButtonSpec;
  gear: ButtonSpec;

  reason: { x: number; y: number; wrap: number; originY: number; size: number };
  selectHint: { x: number; y: number };

  /** Meld-reason tooltip clamp bounds (centre x is clamped into [minX, maxX]). */
  tooltip: { maxW: number; minX: number; maxX: number; maxY: number };

  /** Tutorial speech panel. Landscape parks it in the unused right column, portrait has no such
   * column, so it becomes a band across the top of the table area with its buttons side by side. */
  tutorialPanel: Rect;
}

/** Landscape button boxes grow a little on a touch screen; the cluster has the slack for it. */
function landscape(p: ViewProfile): GameRegions {
  const t = p.touch;
  return {
    w: 480,
    h: 270,
    portrait: false,
    touch: t,

    barH: 30,
    deckImg: { x: 22, y: 14 },
    deckText: { x: 34, y: 8 },
    opponentX0: 60,
    opponentStep: 105,
    opponentY: 14,

    banner: { x: 240, y: 41 },
    lastMove: { x: 240, y: 70, wrap: 300 },
    onlineNotice: { x: 240, y: 58, wrap: 300 },
    onlineDot: { x: 6, y: 264 },

    tableTop: 80,
    tableBottom: 188,
    tableLeft: 14,
    tableAreaW: 480 - 96 - 14,
    tableAreaH: 188 - 80 - 6,
    tableRightBound: 480 - 84,

    handY: 240,
    handCenterX: 200,
    handSpan: 330,
    handZone: { x: 20, y: 240 - 24, w: 360, h: 48 },

    actionPanel: { x: 398, y: 140, w: 78, h: 130 },
    feito: { x: 440, y: t ? 208 : 210, w: 64, h: t ? 28 : 22, size: 9 },
    comprar: { x: 440, y: t ? 239 : 237, w: 64, h: t ? 24 : 20, size: 8 },
    undo: { x: 414, y: t ? 261 : 260, w: t ? 20 : 16, h: t ? 17 : 14, size: 8 },
    redo: { x: 436, y: t ? 261 : 260, w: t ? 20 : 16, h: t ? 17 : 14, size: 8 },
    reset: { x: 460, y: t ? 261 : 260, w: t ? 24 : 22, h: t ? 17 : 14, size: 8 },
    sort: { x: 30, y: 246, w: t ? 20 : 16, h: t ? 17 : 14, size: 8 },
    gear: { x: 462, y: 10, w: t ? 20 : 16, h: t ? 17 : 14, size: 8 },

    reason: { x: 440, y: 191, wrap: 72, originY: 1, size: 9 },
    selectHint: { x: 190, y: 265 },

    tooltip: { maxW: 96, minX: 0, maxX: 480 - 92, maxY: 270 - 30 },

    tutorialPanel: { x: 398, y: 2, w: 80, h: 176 },
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
    feito: { x: 192, y: 452, w: 140, h: 40, size: 12 },
    comprar: { x: 66, y: 452, w: 104, h: 36, size: 9 },
    undo: { x: 55, y: 412, w: 32, h: 26, size: 9 },
    redo: { x: 95, y: 412, w: 32, h: 26, size: 9 },
    reset: { x: 135, y: 412, w: 32, h: 26, size: 9 },
    sort: { x: 175, y: 412, w: 32, h: 26, size: 9 },
    gear: { x: 215, y: 412, w: 32, h: 26, size: 9 },

    reason: { x: 135, y: 374, wrap: 250, originY: 0, size: 9 },
    selectHint: { x: 135, y: 366 },

    tooltip: { maxW: 150, minX: 0, maxX: 270 - 6, maxY: 480 - 170 },

    tutorialPanel: { x: 8, y: 88, w: 254, h: 74 },
  };
}

export function gameRegions(p: ViewProfile): GameRegions {
  return p.portrait ? portrait(p) : landscape(p);
}
