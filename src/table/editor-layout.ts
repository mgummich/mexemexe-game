import type { GameRegions } from '../ui/regions';

/**
 * Pure layout math for the focused Mexe editor (Phase 14 Wave C, portrait only). No Phaser import
 * — GameScene draws whatever this returns; unit tests exercise this module directly.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditorZones {
  /** Meld list: one row per table meld + a trailing "new meld" row. Vertically scrollable. */
  meldList: Rect;
  /** The focused meld, drawn large. */
  workspace: Rect;
  /** Remaining hand, horizontally scrollable. */
  handStrip: Rect;
}

const GAP = 8;
const MELD_LIST_H = 112;
const WORKSPACE_H = 92;
const HAND_STRIP_H = 44;

export const MELD_LIST_ROW_H = 24;

/**
 * Three zones stacked below the top bar, anchored off `r.tableTop` so they always sit inside the
 * table band and never reach into the action bar (`r.actionPanel`, y >= 360 in portrait).
 */
export function editorZones(r: GameRegions): EditorZones {
  const x = r.tableLeft;
  const w = r.tableAreaW;
  const meldList: Rect = { x, y: r.tableTop, w, h: MELD_LIST_H };
  const workspace: Rect = { x, y: meldList.y + meldList.h + GAP, w, h: WORKSPACE_H };
  const handStrip: Rect = { x, y: workspace.y + workspace.h + GAP, w, h: HAND_STRIP_H };
  return { meldList, workspace, handStrip };
}

export interface MeldListRow {
  index: number;
  /** Existing meld id, or null for the trailing "start a new meld" row. */
  meldId: string | null;
}

/** One row per meld, in table order, plus a trailing "new meld" row. */
export function meldListRows(meldIds: readonly string[]): MeldListRow[] {
  return [...meldIds.map((meldId, index) => ({ index, meldId })), { index: meldIds.length, meldId: null }];
}

export function meldListContentHeight(rowCount: number): number {
  return rowCount * MELD_LIST_ROW_H;
}

/** Generic 1D scroll clamp — shared by the vertical meld list and the horizontal hand strip. */
export function clampScroll(offset: number, contentSize: number, viewportSize: number): number {
  const max = Math.max(0, contentSize - viewportSize);
  return Math.min(max, Math.max(0, offset));
}

/**
 * Which row (if any) sits under a point, given the current scroll offset. A row rect always spans
 * the list's full width and the whole row height — the list background IS the row's hit target,
 * so a drag gesture starting anywhere on a row pans the list; there is no per-card hit region to
 * pick up and drag a card with. That is the "list cards are not draggable" guarantee.
 */
export function hitTestMeldListRow(
  rows: readonly MeldListRow[],
  zone: Rect,
  scroll: number,
  px: number,
  py: number,
): MeldListRow | null {
  if (px < zone.x || px > zone.x + zone.w || py < zone.y || py > zone.y + zone.h) return null;
  const localY = py - zone.y + scroll;
  const idx = Math.floor(localY / MELD_LIST_ROW_H);
  return rows[idx] ?? null;
}

/** Screen y of a row's top edge for the current scroll offset. May fall outside `zone` (negative,
 * or past `zone.y + zone.h`) when the row is scrolled out of view — callers should skip drawing it. */
export function meldListRowY(row: MeldListRow, zone: Rect, scroll: number): number {
  return zone.y + row.index * MELD_LIST_ROW_H - scroll;
}
