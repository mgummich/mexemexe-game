/**
 * Which world the game is authored into for this window.
 *
 * The board is a fixed-aspect pixel world, so there is no continuous responsive layout — there
 * are two authored worlds and one rule for picking between them:
 *
 *   landscape (default, desktop): 480x270 at 16:9 — every coordinate in the game is unchanged
 *   from before this module existed, so a desktop window can never regress. On a wider window
 *   (a phone in landscape is 19.5:9) the world keeps its 270 height and grows sideways up to
 *   LANDSCAPE_MAX_W so Phaser's FIT scaling fills the screen instead of adding side bars;
 *   regions.ts slides the right-hand furniture out by that extra width.
 *   portrait (taller than wide): 270x480 — a re-stacked board with the table on top, the hand
 *   below it and a full-width action bar pinned to the bottom.
 *
 * `touch` is orthogonal: a coarse pointer only grows button hit areas and a few control sizes,
 * it never moves anything. Desktop reports a fine pointer, so it never sees those either.
 */
export interface ViewProfile {
  /** World width in game units. */
  w: number;
  /** World height in game units. */
  h: number;
  portrait: boolean;
  /** Coarse pointer (finger/stylus): grow hit areas and primary buttons. */
  touch: boolean;
}

export const LANDSCAPE_W = 480;
export const LANDSCAPE_H = 270;
/**
 * Widest landscape world we will author. Phones are 19.5:9-to-21:9 in landscape, so a fixed
 * 480x270 (16:9) world letterboxes them with fat side bars under Phaser's FIT. The world is
 * allowed to grow horizontally up to this cap instead; anything wider (32:9 monitors) gets bars.
 */
export const LANDSCAPE_MAX_W = 630;
export const PORTRAIT_W = 270;
export const PORTRAIT_H = 480;

/**
 * Portrait needs a margin over square (1.05) so a window sitting at almost exactly 1:1 can't
 * flap between the two worlds on every stray resize event.
 */
export function pickProfile(winW: number, winH: number, coarsePointer: boolean): ViewProfile {
  const portrait = winH > winW * 1.05;
  return {
    w: portrait ? PORTRAIT_W : landscapeWidth(winW, winH),
    h: portrait ? PORTRAIT_H : LANDSCAPE_H,
    portrait,
    touch: coarsePointer,
  };
}

/**
 * Landscape world width for a window: the height stays 270 and the width follows the window's
 * aspect ratio, so the FIT-scaled canvas fills the screen instead of being letterboxed.
 *
 * Never narrower than 480 (that is the authored grid — narrowing it would crop the desktop
 * layout), never wider than LANDSCAPE_MAX_W, and quantised to a multiple of 6 so a window
 * resized by a pixel doesn't churn a full re-layout (and so the +dx/2 offsets in regions.ts stay
 * whole units).
 */
function landscapeWidth(winW: number, winH: number): number {
  if (winH <= 0) return LANDSCAPE_W;
  const wanted = (winW / winH) * LANDSCAPE_H;
  const clamped = Math.min(LANDSCAPE_MAX_W, Math.max(LANDSCAPE_W, wanted));
  return Math.round(clamped / 6) * 6;
}

/** True when two profiles differ in a way that requires scenes to re-lay-out. */
export function profileChanged(a: ViewProfile, b: ViewProfile): boolean {
  return a.portrait !== b.portrait || a.touch !== b.touch || a.w !== b.w;
}

function detect(): ViewProfile {
  if (typeof window === 'undefined') return pickProfile(LANDSCAPE_W, LANDSCAPE_H, false);
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return pickProfile(window.innerWidth, window.innerHeight, coarse);
}

let current: ViewProfile = detect();

/** The profile every scene lays out against. Mutated only by `refreshProfile` (main.ts resize handler). */
export function view(): ViewProfile {
  return current;
}

/** Re-detects from the live window. Returns true when the new profile needs a re-layout. */
export function refreshProfile(): boolean {
  const next = detect();
  const changed = profileChanged(current, next);
  current = next;
  return changed;
}

/** Tests only: force a profile without touching the DOM. */
export function setProfileForTest(p: ViewProfile): void {
  current = p;
}
