import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { buildOverlay } from './overlay';
import { openRulesPanel } from './rules-panel';
import { openSettingsPanel } from './settings-panel';
import { DANGER_TINT, fontStyle, label, PixelButton } from './widgets';

export interface PauseMenuOpts {
  onQuit: () => void;
}

/** Pause overlay: Continue / Settings / Help / Quit (with an "abandon match?" confirm step). Returns a close() fn. */
export function openPauseMenu(scene: Phaser.Scene, opts: PauseMenuOpts, onClosed: () => void): () => void {
  let objs: Phaser.GameObjects.GameObject[] = [];
  const close = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    onClosed();
  };

  const showMain = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    const w = 170;
    const h = 148;
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    objs.push(label(scene, cx, top + 14, t('pause.title'), 10, '#f7d23e').setDepth(510));

    // hide this menu (without resuming the AI timer) while a nested panel is open, then redraw it on close
    const openNested = (openFn: (s: Phaser.Scene, onClosed: () => void) => void): void => {
      for (const o of objs) o.destroy();
      objs = [];
      openFn(scene, showMain);
    };

    let y = top + 34;
    objs.push(new PixelButton(scene, cx, y, t('pause.continue'), close, {
      textureBase: 'btn-comprar', w: 130, h: 18, size: 8, color: 0x2e9e50,
    }).setDepth(510));
    y += 24;
    objs.push(
      new PixelButton(scene, cx, y, t('menu.settings'), () => openNested(openSettingsPanel), {
        textureBase: 'btn-comprar', w: 130, h: 18, size: 8, color: 0x6b6b73,
      }).setDepth(510),
    );
    y += 24;
    objs.push(
      new PixelButton(scene, cx, y, t('menu.rules'), () => openNested(openRulesPanel), {
        textureBase: 'btn-comprar', w: 130, h: 18, size: 8, color: 0x6b6b73,
      }).setDepth(510),
    );
    y += 24;
    objs.push(new PixelButton(scene, cx, y, t('pause.quit'), showQuitConfirm, {
      textureBase: 'btn-comprar', w: 130, h: 18, size: 8, color: DANGER_TINT,
    }).setDepth(510));
  };

  const showQuitConfirm = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    const w = 170;
    const h = 96;
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    const txt = scene.add
      .text(cx, top + 16, t('pause.confirmQuit'), {
        ...fontStyle(7, '#f0e8d8'), align: 'center', wordWrap: { width: w - 20 },
      })
      .setOrigin(0.5, 0)
      .setDepth(510);
    objs.push(txt);

    objs.push(
      new PixelButton(scene, cx - 40, top + h - 20, t('common.yes'), () => { close(); opts.onQuit(); }, {
        textureBase: 'btn-comprar', w: 68, h: 18, size: 7, color: DANGER_TINT,
      }).setDepth(510),
    );
    objs.push(new PixelButton(scene, cx + 40, top + h - 20, t('common.no'), showMain, {
      textureBase: 'btn-comprar', w: 68, h: 18, size: 7, color: 0x6b6b73,
    }).setDepth(510));
  };

  showMain();
  return close;
}
