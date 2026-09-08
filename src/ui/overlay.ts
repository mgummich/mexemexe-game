import Phaser from 'phaser';

/** Dimmed full-screen backdrop + a centered rounded dark panel. Click the backdrop to close. */
export function buildOverlay(
  scene: Phaser.Scene,
  w: number,
  h: number,
  onClose: () => void,
): { objs: Phaser.GameObjects.GameObject[]; cx: number; cy: number; top: number } {
  const cx = 240;
  const cy = 135;
  const dim = scene.add.rectangle(240, 135, 480, 270, 0x000000, 0.6).setDepth(500).setInteractive();
  dim.on('pointerdown', (p: Phaser.Input.Pointer) => {
    const inPanel = Math.abs(p.x - cx) < w / 2 && Math.abs(p.y - cy) < h / 2;
    if (!inPanel) onClose();
  });
  const g = scene.add.graphics().setDepth(501);
  g.fillStyle(0x1a1410, 0.96);
  g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 4);
  g.lineStyle(1, 0xf7d23e, 0.8);
  g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 4);
  return { objs: [dim, g], cx, cy, top: cy - h / 2 };
}
