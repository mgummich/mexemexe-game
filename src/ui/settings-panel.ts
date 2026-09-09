import Phaser from 'phaser';
import { playlog } from '../core/playlog';
import { settings } from '../core/settings';
import { getLocale, setLocale, t } from '../localization/i18n';
import { buildOverlay } from './overlay';
import { DANGER_TINT, fontStyle, label, PixelButton } from './widgets';

/** Copies the play-log export to the clipboard for a tester who won't open a console. Falls
 * back to `console.log` if the Clipboard API is unavailable or the write is rejected (denied
 * permission, insecure context, etc.) — never throws into the caller either way. */
function copyPlaylog(onDone: (ok: boolean) => void): void {
  const json = playlog.exportJson();
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard API');
    navigator.clipboard
      .writeText(json)
      .then(() => onDone(true))
      .catch(() => {
        console.log(json);
        onDone(false);
      });
  } catch {
    console.log(json);
    onDone(false);
  }
}

/** Opens the settings overlay (mute, sfx/music volume, reduced motion, language, reset data). Returns a close() fn. */
export function openSettingsPanel(scene: Phaser.Scene, onClosed: () => void): () => void {
  let objs: Phaser.GameObjects.GameObject[] = [];
  const close = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    onClosed();
  };

  const showMain = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    const w = 200;
    // grows with the large-text setting itself so its own extra row/taller buttons still fit at 125%.
    const h = Math.round(254 * settings.fontScale());
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    objs.push(label(scene, cx, top + 12, t('settings.title'), 9, '#f7d23e').setDepth(510));

    let y = top + 28;
    const muteBtn = new PixelButton(
      scene,
      cx,
      y,
      settings.get().muted ? t('settings.unmute') : t('settings.mute'),
      () => {
        settings.update({ muted: !settings.get().muted });
        muteBtn.setLabel(settings.get().muted ? t('settings.unmute') : t('settings.mute'));
      },
      { textureBase: 'btn-comprar', w: 150, h: 16, size: 7 },
    ).setDepth(510);
    objs.push(muteBtn);

    y += 24;
    objs.push(label(scene, cx - 84, y, t('settings.sfx'), 9, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
    objs.push(...makeSlider(scene, cx - 30, y, 100, settings.get().sfxVolume, (v) => settings.update({ sfxVolume: v })));

    y += 22;
    objs.push(label(scene, cx - 84, y, t('settings.music'), 9, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
    objs.push(...makeSlider(scene, cx - 30, y, 100, settings.get().musicVolume, (v) => settings.update({ musicVolume: v })));

    y += 22;
    const musicBtn = new PixelButton(
      scene,
      cx,
      y,
      `${t('settings.music')}: ${settings.get().musicEnabled ? t('settings.on') : t('settings.off')}`,
      () => {
        settings.update({ musicEnabled: !settings.get().musicEnabled });
        musicBtn.setLabel(`${t('settings.music')}: ${settings.get().musicEnabled ? t('settings.on') : t('settings.off')}`);
      },
      { textureBase: 'btn-comprar', w: 170, h: 16, size: 6 },
    ).setDepth(510);
    objs.push(musicBtn);

    y += 24;
    const motionBtn = new PixelButton(
      scene,
      cx,
      y,
      `${t('settings.reducedMotion')}: ${settings.get().reducedMotion ? t('settings.on') : t('settings.off')}`,
      () => {
        settings.update({ reducedMotion: !settings.get().reducedMotion });
        motionBtn.setLabel(`${t('settings.reducedMotion')}: ${settings.get().reducedMotion ? t('settings.on') : t('settings.off')}`);
      },
      { textureBase: 'btn-comprar', w: 170, h: 16, size: 6 },
    ).setDepth(510);
    objs.push(motionBtn);

    y += 22;
    const largeTextBtn = new PixelButton(
      scene,
      cx,
      y,
      `${t('settings.largeText')}: ${settings.get().largeText ? t('settings.on') : t('settings.off')}`,
      () => {
        settings.update({ largeText: !settings.get().largeText });
        showMain(); // font scale changed — full rebuild picks up new sizes/panel height
      },
      { textureBase: 'btn-comprar', w: 170, h: 16, size: 6 },
    ).setDepth(510);
    objs.push(largeTextBtn);

    y += 22;
    const langBtn = new PixelButton(scene, cx, y, t('menu.language'), () => {
      const next = getLocale() === 'pt' ? 'en' : 'pt';
      setLocale(next);
      settings.update({ locale: next });
      showMain();
    }, { textureBase: 'btn-comprar', w: 150, h: 16, size: 7 }).setDepth(510);
    objs.push(langBtn);

    y += 22;
    const exportBtn = new PixelButton(scene, cx, y, t('settings.exportLog'), () => {
      copyPlaylog((ok) => {
        // Panel may have closed (or rebuilt for a settings change) before this callback runs —
        // never touch a destroyed button.
        if (!exportBtn.active) return;
        exportBtn.setLabel(ok ? t('settings.exportLogCopied') : t('settings.exportLogFailed'));
        scene.time.delayedCall(1500, () => exportBtn.active && exportBtn.setLabel(t('settings.exportLog')));
      });
    }, { textureBase: 'btn-comprar', w: 170, h: 16, size: 7 }).setDepth(510);
    objs.push(exportBtn);

    y += 22;
    objs.push(
      new PixelButton(scene, cx, y, t('settings.resetData'), showResetConfirm, {
        textureBase: 'btn-comprar', w: 150, h: 16, size: 7, color: DANGER_TINT,
      }).setDepth(510),
    );

    y += 22;
    objs.push(
      new PixelButton(scene, cx, y, t('settings.close'), close, {
        textureBase: 'btn-comprar', w: 90, h: 16, size: 7,
      }).setDepth(510),
    );
  };

  /** Replaces the main panel content with a Yes/No confirm — Yes wipes the save and reloads, No returns to the main panel. */
  const showResetConfirm = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    const w = 170;
    const h = 90;
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    const txt = scene.add
      .text(cx, top + 14, t('settings.resetConfirm'), {
        ...fontStyle(7, '#f0e8d8'), align: 'center', wordWrap: { width: w - 20 },
      })
      .setOrigin(0.5, 0)
      .setDepth(510);
    objs.push(txt);

    objs.push(
      new PixelButton(scene, cx - 40, top + h - 20, t('common.yes'), () => settings.resetData(), {
        textureBase: 'btn-comprar', w: 68, h: 18, size: 7, color: DANGER_TINT,
      }).setDepth(510),
    );
    objs.push(
      new PixelButton(scene, cx + 40, top + h - 20, t('common.no'), showMain, {
        textureBase: 'btn-comprar', w: 68, h: 18, size: 7,
      }).setDepth(510),
    );
  };

  showMain();
  return close;
}

/** Minimal clickable/draggable slider bar (0-100), no dependency beyond Phaser primitives. */
function makeSlider(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  value: number,
  onChange: (v: number) => void,
): Phaser.GameObjects.GameObject[] {
  const h = 6;
  const track = scene.add
    .rectangle(x, y, w, h, 0x4a4438)
    .setStrokeStyle(1, 0x8a7f68)
    .setOrigin(0, 0.5)
    .setDepth(502)
    .setInteractive({ useHandCursor: true });
  const fill = scene.add
    .rectangle(x, y, Math.max(2, (value / 100) * w), h, 0xf7d23e)
    .setOrigin(0, 0.5)
    .setDepth(503);
  const handle = scene.add.circle(x + (value / 100) * w, y, 4, 0xf7f2e7).setDepth(504);

  const update = (px: number): void => {
    const local = Phaser.Math.Clamp((px - x) / w, 0, 1);
    fill.width = Math.max(2, local * w);
    handle.x = x + local * w;
    onChange(Math.round(local * 100));
  };
  const moveHandler = (p: Phaser.Input.Pointer): void => {
    if (p.isDown) update(p.x);
  };
  track.on('pointerdown', (p: Phaser.Input.Pointer) => update(p.x));
  scene.input.on('pointermove', moveHandler);
  track.on('destroy', () => scene.input.off('pointermove', moveHandler));

  return [track, fill, handle];
}
