import { describe, expect, it } from 'vitest';
import { gameRegions } from '../src/ui/regions';

const LANDSCAPE = { w: 480, h: 270, portrait: false, touch: false } as const;
const PORTRAIT = { w: 270, h: 480, portrait: true, touch: false } as const;

describe('gameRegions landscape desktop regression', () => {
  it('matches the pre-existing GameScene constants exactly', () => {
    expect(gameRegions(LANDSCAPE)).toEqual({
      w: 480,
      h: 270,
      portrait: false,
      touch: false,

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
      tableAreaW: 370,
      tableAreaH: 102,
      tableRightBound: 396,

      handY: 240,
      handCenterX: 200,
      handSpan: 330,
      handZone: { x: 20, y: 216, w: 360, h: 48 },

      actionPanel: { x: 398, y: 140, w: 78, h: 130 },
      feito: { x: 440, y: 210, w: 64, h: 22, size: 9 },
      comprar: { x: 440, y: 237, w: 64, h: 20, size: 8 },
      undo: { x: 414, y: 260, w: 16, h: 14, size: 8 },
      redo: { x: 436, y: 260, w: 16, h: 14, size: 8 },
      reset: { x: 460, y: 260, w: 22, h: 14, size: 8 },
      sort: { x: 30, y: 246, w: 16, h: 14, size: 8 },
      gear: { x: 462, y: 10, w: 16, h: 14, size: 8 },
      mexeToggle: { x: 462, y: 10, w: 16, h: 14, size: 8 },
      zoomIn: { x: 418, y: 55, w: 20, h: 17, size: 9 },
      zoomOut: { x: 442, y: 55, w: 20, h: 17, size: 9 },

      reason: { x: 440, y: 191, wrap: 72, originY: 1, size: 9 },
      selectHint: { x: 190, y: 265 },

      tooltip: { maxW: 96, minX: 0, maxX: 388, maxY: 240 },
      tutorialPanel: { x: 398, y: 2, w: 80, h: 176 },
    });
  });
});

describe('gameRegions landscape touch', () => {
  it('grows FEITO/COMPRAR and keeps the action column non-overlapping', () => {
    const r = gameRegions({ w: 480, h: 270, portrait: false, touch: true });
    expect(r.feito.h).toBeGreaterThanOrEqual(26);
    expect(r.comprar.h).toBeGreaterThanOrEqual(24);

    const feitoBottom = r.feito.y + r.feito.h / 2;
    const comprarTop = r.comprar.y - r.comprar.h / 2;
    const comprarBottom = r.comprar.y + r.comprar.h / 2;
    const rowTop = r.undo.y - r.undo.h / 2;

    expect(comprarTop).toBeGreaterThanOrEqual(feitoBottom);
    expect(rowTop).toBeGreaterThanOrEqual(comprarBottom);
    // ...and the whole grown cluster still fits inside the world and its backdrop panel.
    const rowBottom = r.undo.y + r.undo.h / 2;
    expect(rowBottom).toBeLessThanOrEqual(r.h);
    expect(r.feito.y - r.feito.h / 2).toBeGreaterThanOrEqual(r.actionPanel.y);
  });
});

describe('gameRegions landscape zoom buttons', () => {
  const r = gameRegions(LANDSCAPE);

  it('sit in the free strip above the table, right of the table area, clear of the gear button', () => {
    for (const b of [r.zoomIn, r.zoomOut]) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(r.tableLeft + r.tableAreaW);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(r.barH);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(r.tableTop);
    }
    expect(r.zoomIn.x + r.zoomIn.w / 2).toBeLessThanOrEqual(r.zoomOut.x - r.zoomOut.w / 2);
  });
});

describe('gameRegions portrait', () => {
  const r = gameRegions(PORTRAIT);

  it('world is 270x480', () => {
    expect(r.w).toBe(270);
    expect(r.h).toBe(480);
  });

  it('every button lies fully inside the world', () => {
    for (const b of [r.feito, r.comprar, r.undo, r.redo, r.reset, r.sort, r.gear, r.mexeToggle, r.zoomIn, r.zoomOut]) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(270);
      expect(b.y - b.h / 2).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(480);
    }
  });

  it('FEITO and COMPRAR do not overlap horizontally', () => {
    const feitoLeft = r.feito.x - r.feito.w / 2;
    const comprarRight = r.comprar.x + r.comprar.w / 2;
    expect(comprarRight).toBeLessThanOrEqual(feitoLeft);
  });

  it('the table area fits inside the world', () => {
    expect(r.tableLeft).toBeGreaterThanOrEqual(0);
    expect(r.tableLeft + r.tableAreaW).toBeLessThanOrEqual(270);
  });

  it('hand sits above the action panel, table sits above the hand', () => {
    expect(r.handY + 16).toBeLessThanOrEqual(r.actionPanel.y);
    expect(r.tableBottom).toBeLessThan(r.handY - 16);
  });

  it('mexeToggle sits left of undo without overlapping it', () => {
    expect(r.mexeToggle.x + r.mexeToggle.w / 2).toBeLessThanOrEqual(r.undo.x - r.undo.w / 2);
  });

  it('zoom buttons sit right of gear, stacked, without overlapping it or each other', () => {
    expect(r.zoomIn.x - r.zoomIn.w / 2).toBeGreaterThanOrEqual(r.gear.x + r.gear.w / 2);
    expect(r.zoomOut.x - r.zoomOut.w / 2).toBeGreaterThanOrEqual(r.gear.x + r.gear.w / 2);
    expect(r.zoomIn.y + r.zoomIn.h / 2).toBeLessThanOrEqual(r.zoomOut.y - r.zoomOut.h / 2);
  });
});

describe('gameRegions landscape on a wider-than-16:9 world', () => {
  // 582x270 is what a 19.5:9 phone in landscape asks for (see viewport.landscapeWidth).
  const r = gameRegions({ w: 582, h: 270, portrait: false, touch: true });

  it('reports the wider world', () => {
    expect(r.w).toBe(582);
    expect(r.h).toBe(270);
  });

  it('every button still lies fully inside the world', () => {
    for (const b of [r.feito, r.comprar, r.undo, r.redo, r.reset, r.sort, r.gear, r.zoomIn, r.zoomOut]) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w / 2).toBeLessThanOrEqual(r.w);
    }
  });

  it('the action cluster stays inside its backdrop panel', () => {
    expect(r.actionPanel.x + r.actionPanel.w).toBeLessThanOrEqual(r.w);
    for (const b of [r.feito, r.comprar, r.undo, r.redo, r.reset]) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(r.actionPanel.x - 2);
    }
  });

  it('the table grows into the extra width and still clears the action panel', () => {
    expect(r.tableAreaW).toBe(582 - 96 - 14);
    expect(r.tableLeft + r.tableAreaW).toBeLessThanOrEqual(r.actionPanel.x);
    expect(r.tableRightBound).toBeLessThanOrEqual(r.actionPanel.x);
  });

  it('the hand re-centres over the widened table area', () => {
    expect(r.handCenterX).toBe(251);
    expect(r.handZone.x + r.handZone.w).toBeLessThanOrEqual(r.actionPanel.x);
  });

  it('centred text follows the new centre', () => {
    expect(r.banner.x).toBe(291);
    expect(r.lastMove.x).toBe(291);
  });
});
