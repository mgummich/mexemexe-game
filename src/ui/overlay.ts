import Phaser from 'phaser';
import { cx, cy, panelW } from './menu-layout';
import { view } from './viewport';

/** Dimmed full-screen backdrop + a centered rounded dark panel. Click the backdrop to close. */
export function buildOverlay(
  scene: Phaser.Scene,
  w: number,
  h: number,
  onClose: () => void,
): { objs: Phaser.GameObjects.GameObject[]; cx: number; cy: number; top: number } {
  const px = cx();
  const py = cy();
  const pw = panelW(w);
  const { w: vw, h: vh } = view();
  const dim = scene.add.rectangle(px, py, vw, vh, 0x000000, 0.6).setDepth(500).setInteractive();
  dim.on('pointerdown', (p: Phaser.Input.Pointer) => {
    // worldX/worldY: pointer.x is in canvas pixels, the panel in world units.
    const inPanel = Math.abs(p.worldX - px) < pw / 2 && Math.abs(p.worldY - py) < h / 2;
    if (!inPanel) onClose();
  });
  const g = scene.add.graphics().setDepth(501);
  g.fillStyle(0x1a1410, 0.96);
  g.fillRoundedRect(px - pw / 2, py - h / 2, pw, h, 4);
  g.lineStyle(1, 0xf7d23e, 0.8);
  g.strokeRoundedRect(px - pw / 2, py - h / 2, pw, h, 4);
  return { objs: [dim, g], cx: px, cy: py, top: py - h / 2 };
}

/**
 * Overlays currently listening for Esc, innermost last. Only the innermost one reacts, so Esc
 * backs out one level at a time (quit confirm -> pause menu -> board) instead of every open
 * overlay closing at once — GameScene's own Esc handler already no-ops while a panel is open.
 */
const escStack: { back: () => void }[] = [];

/** Registers `back` as this overlay's Esc action. Returns a dispose fn — call it on close. */
export function onEscape(scene: Phaser.Scene, back: () => void): () => void {
  const entry = { back };
  escStack.push(entry);
  const onKey = (): void => {
    if (escStack[escStack.length - 1] === entry) entry.back();
  };
  scene.input.keyboard?.on('keydown-ESC', onKey);
  return () => {
    scene.input.keyboard?.off('keydown-ESC', onKey);
    const i = escStack.indexOf(entry);
    if (i >= 0) escStack.splice(i, 1);
  };
}
