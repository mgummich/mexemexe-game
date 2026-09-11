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
 * The warm wooden backdrop every menu-family screen puts its control stack on. A near-transparent
 * rectangle with a hairline stroke (what this replaced) read as a debug overlay in playtests:
 * opaque fill, rounded corners, a tan edge and a darker inner line give it a real frame.
 */
export function woodPanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(0x2a1a10, 0.93);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 5);
  g.lineStyle(2, 0xc0a878, 0.95);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 5);
  g.lineStyle(1, 0x6b4a2f, 0.9);
  g.strokeRoundedRect(x - w / 2 + 2, y - h / 2 + 2, w - 4, h - 4, 4);
  return g;
}

const LANDSCAPE_BG_W = 480;
const LANDSCAPE_BG_H = 270;
const PORTRAIT_BG_W = 224;
const PORTRAIT_BG_H = 400;

/**
 * Picks which background texture to use for a given base key (`bg-boteco`, `bg-menu`, ...):
 * the dedicated `${key}-portrait` art in portrait, the landscape key otherwise. Falls back to
 * the landscape key when the portrait texture failed to load — never a blank screen. Pure
 * function so it's testable without a Phaser scene.
 */
export function backgroundKeyFor(baseKey: string, portrait: boolean, hasPortraitTexture: boolean): string {
  if (!portrait) return baseKey;
  return hasPortraitTexture ? `${baseKey}-portrait` : baseKey;
}

/**
 * Adds the menu/lobby background image centred on the world and scaled to COVER it (crop, don't
 * stretch). Landscape art is authored 480x270; portrait art is dedicated 224x400 (9:16, matching
 * the 270x480 portrait world) so cover-scaling it never crops away most of the art the way
 * stretching the landscape art would. Same idea as CSS `background-size: cover`.
 */
export function coverBackground(scene: Phaser.Scene, key: string): Phaser.GameObjects.Image {
  const portraitKey = `${key}-portrait`;
  const useKey = backgroundKeyFor(key, view().portrait, scene.textures.exists(portraitKey));
  const [srcW, srcH] = useKey === portraitKey ? [PORTRAIT_BG_W, PORTRAIT_BG_H] : [LANDSCAPE_BG_W, LANDSCAPE_BG_H];
  const scale = Math.max(view().w / srcW, view().h / srcH);
  return scene.add.image(cx(), cy(), useKey).setDisplaySize(srcW * scale, srcH * scale);
}
