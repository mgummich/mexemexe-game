import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { settings } from '../core/settings';
import { buildOverlay } from './overlay';
import { fontStyle, label, PixelButton } from './widgets';

/** Opens a compact rules-summary overlay. Returns a close() fn. */
export function openRulesPanel(scene: Phaser.Scene, onClosed: () => void): () => void {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const w = 260;
  // grows with the large-text setting so the shortcuts list doesn't overflow the panel at 125%.
  const h = Math.round(190 * settings.fontScale());
  const close = (): void => {
    for (const o of objs) o.destroy();
    onClosed();
  };
  const base = buildOverlay(scene, w, h, close);
  objs.push(...base.objs);
  const { cx, top } = base;

  objs.push(label(scene, cx, top + 12, t('rules.title'), 9, '#f7d23e').setDepth(510));
  const body = scene.add
    .text(cx, top + 24, t('rules.body'), {
      ...fontStyle(7, '#f0e8d8'),
      align: 'left',
      wordWrap: { width: w - 24 },
    })
    .setOrigin(0.5, 0)
    .setDepth(510);
  objs.push(body);

  const shortcuts = scene.add
    .text(cx, top + 24 + body.height + 6, t('rules.shortcuts'), {
      ...fontStyle(6, '#c0b8a8'),
      align: 'left',
      wordWrap: { width: w - 24 },
    })
    .setOrigin(0.5, 0)
    .setDepth(510);
  objs.push(shortcuts);

  objs.push(new PixelButton(scene, cx, top + h - 14, t('settings.close'), close, {
    textureBase: 'btn-comprar', w: 90, h: 16, size: 7, color: 0x6b6b73,
  }).setDepth(510));
  return close;
}
