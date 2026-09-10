import { describe, expect, it } from 'vitest';
import { gameRegions, type ButtonSpec, type GameRegions } from '../src/ui/regions';

/** Mirrors PixelButton's coarse-pointer hit-box floor (src/ui/widgets.ts): the art stays w x h,
 * only the tappable area grows. Desktop (touch=false) is untouched. */
function hitBox(b: ButtonSpec, touch: boolean): { x: number; y: number; w: number; h: number } {
  return { x: b.x, y: b.y, w: touch ? Math.max(b.w, 34) : b.w, h: touch ? Math.max(b.h, 31) : b.h };
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  const ax0 = a.x - a.w / 2, ax1 = a.x + a.w / 2, ay0 = a.y - a.h / 2, ay1 = a.y + a.h / 2;
  const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2, by0 = b.y - b.h / 2, by1 = b.y + b.h / 2;
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}

/** Controls GameScene actually builds as buttons in this orientation — mexeToggle is built in
 * both since landscape Mexe Mode shipped. */
function controls(r: GameRegions): [string, ButtonSpec][] {
  return [
    ['feito', r.feito], ['comprar', r.comprar], ['undo', r.undo], ['redo', r.redo],
    ['reset', r.reset], ['sort', r.sort], ['gear', r.gear], ['mexeToggle', r.mexeToggle],
    ['zoomIn', r.zoomIn], ['zoomOut', r.zoomOut],
  ];
}

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
      mexeToggle: { x: 438, y: 30, w: 64, h: 14, size: 8 },
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
  const r = gameRegions({ w: 480, h: 270, portrait: false, touch: true });

  it('grows every control to at least a 34x31 hit box, all inside the world', () => {
    for (const [, b] of controls(r)) {
      const hb = hitBox(b, true);
      expect(hb.h).toBeGreaterThanOrEqual(31);
      expect(hb.w).toBeGreaterThanOrEqual(34);
      expect(hb.y - hb.h / 2).toBeGreaterThanOrEqual(0);
      expect(hb.y + hb.h / 2).toBeLessThanOrEqual(r.h);
    }
  });

  it('reset moved above feito/comprar, out of the cramped bottom row', () => {
    expect(r.reset.y + r.reset.h / 2).toBeLessThanOrEqual(r.feito.y - r.feito.h / 2);
  });

  it('no two control hit boxes overlap', () => {
    const list = controls(r);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        expect(overlaps(hitBox(list[i]![1], true), hitBox(list[j]![1], true))).toBe(false);
      }
    }
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

  it('zoom buttons sit right of gear in the control row, without overlapping it or each other', () => {
    expect(r.zoomIn.x - r.zoomIn.w / 2).toBeGreaterThanOrEqual(r.gear.x + r.gear.w / 2);
    expect(r.zoomOut.x - r.zoomOut.w / 2).toBeGreaterThanOrEqual(r.zoomIn.x + r.zoomIn.w / 2);
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

describe('touch hit boxes: every orientation, no overlaps, desktop unchanged', () => {
  const profiles = [
    { name: 'landscape', p: { w: 480, h: 270, portrait: false, touch: true } },
    { name: 'portrait', p: { w: 270, h: 480, portrait: true, touch: true } },
  ] as const;

  for (const { name, p } of profiles) {
    it(`${name}: every control hit box is >=31 world units tall and none overlap`, () => {
      const r = gameRegions(p);
      const list = controls(r);
      for (const [, b] of list) {
        expect(hitBox(b, true).h).toBeGreaterThanOrEqual(31);
      }
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          expect(overlaps(hitBox(list[i]![1], true), hitBox(list[j]![1], true))).toBe(false);
        }
      }
    });
  }

  it('landscape desktop (touch=false) values are byte-identical to the pre-fix constants', () => {
    const r = gameRegions(LANDSCAPE);
    expect(r.actionPanel).toEqual({ x: 398, y: 140, w: 78, h: 130 });
    expect(r.feito).toEqual({ x: 440, y: 210, w: 64, h: 22, size: 9 });
    expect(r.comprar).toEqual({ x: 440, y: 237, w: 64, h: 20, size: 8 });
    expect(r.undo).toEqual({ x: 414, y: 260, w: 16, h: 14, size: 8 });
    expect(r.redo).toEqual({ x: 436, y: 260, w: 16, h: 14, size: 8 });
    expect(r.reset).toEqual({ x: 460, y: 260, w: 22, h: 14, size: 8 });
    expect(r.sort).toEqual({ x: 30, y: 246, w: 16, h: 14, size: 8 });
    expect(r.gear).toEqual({ x: 462, y: 10, w: 16, h: 14, size: 8 });
    expect(r.zoomIn).toEqual({ x: 418, y: 55, w: 20, h: 17, size: 9 });
    expect(r.zoomOut).toEqual({ x: 442, y: 55, w: 20, h: 17, size: 9 });
    expect(r.reason).toEqual({ x: 440, y: 191, wrap: 72, originY: 1, size: 9 });
  });
});
