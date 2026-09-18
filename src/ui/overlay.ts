import Phaser from 'phaser';
import { cx, cy, panelW } from './menu-layout';
import { LAYER, SCRIM_ALPHA, SURFACE } from './tokens';
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
  const dim = scene.add.rectangle(px, py, vw, vh, SURFACE.scrim, SCRIM_ALPHA).setDepth(LAYER.scrim).setInteractive();
  dim.on('pointerdown', (p: Phaser.Input.Pointer) => {
    // worldX/worldY: pointer.x is in canvas pixels, the panel in world units.
    const inPanel = Math.abs(p.worldX - px) < pw / 2 && Math.abs(p.worldY - py) < h / 2;
    if (!inPanel) onClose();
  });
  const g = scene.add.graphics().setDepth(LAYER.panel);
  g.fillStyle(SURFACE.overlay, 0.96);
  g.fillRoundedRect(px - pw / 2, py - h / 2, pw, h, 4);
  g.lineStyle(1, SURFACE.accent, 0.8);
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

/**
 * Ties an open panel's `close()` to the scene's own shutdown, and returns a dispose fn to call
 * from that same `close()`.
 *
 * Every overlay in the game owns listeners that outlive its Phaser objects — the Esc stack entry
 * above, a raw `pointercancel` listener on the canvas, a `debugApi` "panel is open" flag. Phaser
 * destroys the *objects* when a scene shuts down but never calls the panel's close path, so a
 * scene that restarts under an open panel (MenuScene, SetupScene and OnlineScene all restart on
 * `viewport:changed`, i.e. on every orientation flip) left those behind: the Esc stack grew an
 * entry per flip, and a "rules open" flag stayed true with no rules panel on screen.
 *
 * `close` must be safe to call twice — it is, for every panel here: destroying an empty object
 * list, splicing an absent Esc entry and clearing an already-clear flag are all no-ops.
 */
export function closeOnShutdown(scene: Phaser.Scene, close: () => void): () => void {
  scene.events.once('shutdown', close);
  return () => scene.events.off('shutdown', close);
}
