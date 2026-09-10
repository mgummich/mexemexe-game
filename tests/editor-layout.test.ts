import { describe, expect, it } from 'vitest';
import { gameRegions } from '../src/ui/regions';
import { DraftEditor } from '../src/mexe-mode/draft';
import type { GameState } from '../src/rules/types';
import { DEFAULT_RULES } from '../src/rules/types';
import { n } from './helpers/cards';
import {
  clampScroll,
  editorZones,
  hitTestMeldListRow,
  meldListContentHeight,
  meldListRows,
  meldListRowY,
  MELD_LIST_ROW_H,
} from '../src/table/editor-layout';

const PORTRAIT = gameRegions({ w: 270, h: 480, portrait: true, touch: false });
const LANDSCAPE = gameRegions({ w: 480, h: 270, portrait: false, touch: false });
const LANDSCAPE_WIDE = gameRegions({ w: 630, h: 270, portrait: false, touch: false });

describe('editorZones', () => {
  const zones = editorZones(PORTRAIT);

  it('every zone stays inside the portrait world', () => {
    for (const z of Object.values(zones)) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.x + z.w).toBeLessThanOrEqual(PORTRAIT.w);
      expect(z.y).toBeGreaterThanOrEqual(0);
      expect(z.y + z.h).toBeLessThanOrEqual(PORTRAIT.h);
    }
  });

  it('zones stack in order without overlapping each other', () => {
    expect(zones.meldList.y + zones.meldList.h).toBeLessThanOrEqual(zones.workspace.y);
    expect(zones.workspace.y + zones.workspace.h).toBeLessThanOrEqual(zones.handStrip.y);
  });

  it('never reaches into the action bar', () => {
    expect(zones.handStrip.y + zones.handStrip.h).toBeLessThanOrEqual(PORTRAIT.actionPanel.y);
  });
});

describe('editorZones landscape', () => {
  for (const [name, r] of [['480 world', LANDSCAPE], ['630 wide world', LANDSCAPE_WIDE]] as const) {
    describe(name, () => {
      const zones = editorZones(r);

      it('every zone stays inside the world', () => {
        for (const z of Object.values(zones)) {
          expect(z.x).toBeGreaterThanOrEqual(0);
          expect(z.x + z.w).toBeLessThanOrEqual(r.w);
          expect(z.y).toBeGreaterThanOrEqual(0);
          expect(z.y + z.h).toBeLessThanOrEqual(r.h);
        }
      });

      it('meld list, workspace and hand strip never overlap each other', () => {
        // meld list is a full-height left column; workspace/hand strip share the column to its right.
        expect(zones.meldList.x + zones.meldList.w).toBeLessThanOrEqual(zones.workspace.x);
        expect(zones.meldList.x + zones.meldList.w).toBeLessThanOrEqual(zones.handStrip.x);
        expect(zones.workspace.y + zones.workspace.h).toBeLessThanOrEqual(zones.handStrip.y);
      });

      it('never overlaps the right-hand action column', () => {
        for (const z of Object.values(zones)) expect(z.x + z.w).toBeLessThanOrEqual(r.tableRightBound);
      });
    });
  }

  it('a wider phone world grows the workspace, not the meld-list column', () => {
    expect(editorZones(LANDSCAPE_WIDE).meldList.w).toBe(editorZones(LANDSCAPE).meldList.w);
    expect(editorZones(LANDSCAPE_WIDE).workspace.w).toBeGreaterThan(editorZones(LANDSCAPE).workspace.w);
  });
});

describe('meldListRows', () => {
  it('one row per meld plus a trailing new-meld row', () => {
    const rows = meldListRows(['a', 'b', 'c']);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.meldId)).toEqual(['a', 'b', 'c', null]);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
  });

  it('just the new-meld row when there are no melds', () => {
    expect(meldListRows([])).toEqual([{ index: 0, meldId: null }]);
  });

  it('row rects never overlap: consecutive rows are exactly MELD_LIST_ROW_H apart', () => {
    const zone = editorZones(PORTRAIT).meldList;
    const rows = meldListRows(['a', 'b', 'c']);
    const ys = rows.map((r) => meldListRowY(r, zone, 0));
    for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBe(MELD_LIST_ROW_H);
  });
});

describe('clampScroll', () => {
  it('clamps at zero when content fits the viewport', () => {
    expect(clampScroll(50, 40, 112)).toBe(0);
    expect(clampScroll(-10, 40, 112)).toBe(0);
  });

  it('clamps at the bottom when content overflows', () => {
    const content = meldListContentHeight(10); // 10 rows, taller than the 112-high list zone
    expect(clampScroll(10000, content, 112)).toBe(content - 112);
    expect(clampScroll(-10000, content, 112)).toBe(0);
  });

  it('passes through an in-range offset unchanged', () => {
    const content = meldListContentHeight(10);
    expect(clampScroll(20, content, 112)).toBe(20);
  });
});

describe('hitTestMeldListRow', () => {
  const zone = editorZones(PORTRAIT).meldList;
  const rows = meldListRows(['a', 'b', 'c']); // 4 rows: a, b, c, new-meld

  it('returns the row under a point at zero scroll', () => {
    expect(hitTestMeldListRow(rows, zone, 0, zone.x + 5, zone.y + 1)?.meldId).toBe('a');
    expect(hitTestMeldListRow(rows, zone, 0, zone.x + 5, zone.y + MELD_LIST_ROW_H + 1)?.meldId).toBe('b');
  });

  it('shifts with scroll offset', () => {
    expect(hitTestMeldListRow(rows, zone, MELD_LIST_ROW_H, zone.x + 5, zone.y + 1)?.meldId).toBe('b');
  });

  it('a row spans the full zone width regardless of x — no per-card hit region exists', () => {
    const left = hitTestMeldListRow(rows, zone, 0, zone.x, zone.y + 1);
    const right = hitTestMeldListRow(rows, zone, 0, zone.x + zone.w, zone.y + 1);
    expect(left?.meldId).toBe('a');
    expect(right?.meldId).toBe('a');
  });

  it('returns null outside the zone', () => {
    expect(hitTestMeldListRow(rows, zone, 0, zone.x - 1, zone.y + 1)).toBeNull();
    expect(hitTestMeldListRow(rows, zone, 0, zone.x + 5, zone.y - 1)).toBeNull();
    expect(hitTestMeldListRow(rows, zone, 0, zone.x + 5, zone.y + zone.h + 1)).toBeNull();
  });

  it('the trailing row is the new-meld target', () => {
    const y = zone.y + 3 * MELD_LIST_ROW_H + 1;
    expect(hitTestMeldListRow(rows, zone, 0, zone.x + 5, y)?.meldId).toBeNull();
  });

  it('hit tests the same way against the landscape meld-list column', () => {
    const lZone = editorZones(LANDSCAPE).meldList;
    expect(hitTestMeldListRow(rows, lZone, 0, lZone.x + 5, lZone.y + 1)?.meldId).toBe('a');
    expect(hitTestMeldListRow(rows, lZone, 0, lZone.x + 5, lZone.y + MELD_LIST_ROW_H + 1)?.meldId).toBe('b');
    expect(hitTestMeldListRow(rows, lZone, 0, lZone.x - 1, lZone.y + 1)).toBeNull();
  });
});

function draftState(): GameState {
  return {
    seed: 1,
    players: [
      { id: 'p0', name: 'A', isAi: false, hand: [n('hearts', 2), n('spades', 9)] },
      { id: 'p1', name: 'B', isAi: true, hand: [n('clubs', 4)] },
    ],
    activePlayerIndex: 0,
    table: [{ id: 't1', cards: [n('hearts', 3), n('hearts', 4), n('hearts', 5)] }],
    drawPile: [],
    turn: 1,
    winnerId: null,
    phase: 'playing',
    config: DEFAULT_RULES,
  };
}

describe('orientation flip preserves the draft', () => {
  // DraftEditor (src/mexe-mode/draft.ts) never imports viewport/regions — nothing about it is
  // wired to the ViewProfile a rotation changes. editorZones() is a pure read of GameRegions.
  // Re-laying-out for a flip is therefore just recomputing zones; it cannot touch, confirm, or
  // reset the draft sitting in DraftEditor. This test guards that invariant directly.
  it('a mid-edit (invalid) draft survives recomputing zones for both orientations', () => {
    const ed = new DraftEditor(draftState());
    ed.playHandCard('spades-9-d0', 't1'); // breaks the run — invalid meld, draft not confirmable
    expect(ed.canConfirm().ok).toBe(false);
    const draftBefore = ed.getDraft();

    editorZones(PORTRAIT);
    editorZones(LANDSCAPE);
    editorZones(LANDSCAPE_WIDE);
    editorZones(PORTRAIT); // flip back

    expect(ed.getDraft()).toEqual(draftBefore);
    expect(ed.canConfirm().ok).toBe(false); // still not silently confirmed by the flip
  });
});
