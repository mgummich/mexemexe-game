import { describe, expect, it } from 'vitest';
import { SCALE_STEPS } from '../src/table/layout';
import { ZOOM_FLOORS, zoomStepIn, zoomStepOut } from '../src/table/zoom';

describe('table zoom stepping', () => {
  it('index 0 is auto (no floor) — the default, unzoomed behaviour', () => {
    expect(ZOOM_FLOORS[0]).toBeUndefined();
    // Pinned, not just monotonic: an index swap in zoom.ts would otherwise still pass.
    expect(ZOOM_FLOORS[1]).toBe(SCALE_STEPS[2]);
    expect(ZOOM_FLOORS[2]).toBe(SCALE_STEPS[0]);
  });

  it('every floor beyond auto actually zooms in (each bigger than the last)', () => {
    const floors = ZOOM_FLOORS.slice(1) as number[];
    expect(floors.length).toBeGreaterThan(0);
    for (let i = 1; i < floors.length; i++) expect(floors[i]!).toBeGreaterThan(floors[i - 1]!);
  });

  it('steps in and stops at the top floor, never past it', () => {
    let level = 0;
    for (let i = 0; i < ZOOM_FLOORS.length + 5; i++) level = zoomStepIn(level);
    expect(level).toBe(ZOOM_FLOORS.length - 1);
  });

  it('steps out and stops at auto (0), never negative', () => {
    let level = ZOOM_FLOORS.length - 1;
    for (let i = 0; i < ZOOM_FLOORS.length + 5; i++) level = zoomStepOut(level);
    expect(level).toBe(0);
  });
});
