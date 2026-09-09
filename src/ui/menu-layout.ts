import Phaser from 'phaser';
import { view } from './viewport';

/**
 * Every non-board scene (menu, setup, online, win, tutorial, and the overlay panels) is a
 * centred vertical stack authored on the 480x270 landscape grid. Portrait doesn't need a
 * hand-authored layout like GameScene's board (see regions.ts) — it just needs the same stack
 * re-centred and re-spaced on the taller 270x480 world. These helpers do that remapping so each
 * scene keeps its original literals and only wraps them.
 */

/** Horizontal centre of the current world. */
export function cx(): number {
  return view().w / 2;
}

/** Vertical centre of the current world. */
export function cy(): number {
  return view().h / 2;
}

/** Maps a y authored on the 480x270 grid onto the current world's height. Identity in landscape. */
export function vy(y: number): number {
  return (y / 270) * view().h;
}

/** Maps an x authored on the 480x270 grid onto the current world's width. Identity in landscape.
 * Only for elements genuinely anchored to a screen edge — a pair of elements that must stay a
 * fixed distance apart belongs at `cx() + offset` instead, see menu-layout.ts's own docs above. */
export function vx(x: number): number {
  return (x / 480) * view().w;
}

/** Clamps a backdrop panel width so it still fits the narrower portrait world with a margin. */
export function panelW(w: number): number {
  return Math.min(w, view().w - 12);
}

/**
 * Adds the menu/lobby background image centred on the world and scaled to COVER it (crop, don't
 * stretch) — the art is authored 480x270, so stretching it to a 270x480 portrait world would
 * smear it. Same idea as CSS `background-size: cover`.
 */
export function coverBackground(scene: Phaser.Scene, key: string): Phaser.GameObjects.Image {
  const scale = Math.max(view().w / 480, view().h / 270);
  return scene.add.image(cx(), cy(), key).setDisplaySize(480 * scale, 270 * scale);
}
