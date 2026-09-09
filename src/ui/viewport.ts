/**
 * Which world the game is authored into for this window.
 *
 * The board is a fixed-aspect pixel world, so there is no continuous responsive layout — there
 * are two authored worlds and one rule for picking between them:
 *
 *   landscape (default, desktop): 480x270 — every coordinate in the game is unchanged from
 *   before this module existed, so a desktop window can never regress.
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
export const PORTRAIT_W = 270;
export const PORTRAIT_H = 480;

/**
 * Portrait needs a margin over square (1.05) so a window sitting at almost exactly 1:1 can't
 * flap between the two worlds on every stray resize event.
 */
export function pickProfile(winW: number, winH: number, coarsePointer: boolean): ViewProfile {
  const portrait = winH > winW * 1.05;
  return {
    w: portrait ? PORTRAIT_W : LANDSCAPE_W,
    h: portrait ? PORTRAIT_H : LANDSCAPE_H,
    portrait,
    touch: coarsePointer,
  };
}

/** True when two profiles differ in a way that requires scenes to re-lay-out. */
export function profileChanged(a: ViewProfile, b: ViewProfile): boolean {
  return a.portrait !== b.portrait || a.touch !== b.touch;
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
