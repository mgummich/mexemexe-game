import { SCALE_STEPS } from './layout';

/**
 * Table zoom floors GameScene's +/- buttons step through (Phase 14 Wave D). Index 0 is "auto" —
 * computeMeldLayout's normal shrink-to-fit, no floor passed, byte-for-byte today's behaviour. The
 * other two floors reuse SCALE_STEPS entries so a zoomed card is always a size the crowded-table
 * shrink path already knows how to render.
 */
export const ZOOM_FLOORS: readonly (number | undefined)[] = [undefined, SCALE_STEPS[2], SCALE_STEPS[0]];

export function zoomStepIn(level: number): number {
  return Math.min(level + 1, ZOOM_FLOORS.length - 1);
}

export function zoomStepOut(level: number): number {
  return Math.max(level - 1, 0);
}
