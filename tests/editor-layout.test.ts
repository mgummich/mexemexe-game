import { describe, expect, it } from 'vitest';
import { gameRegions } from '../src/ui/regions';
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
});
