import Phaser from 'phaser';
import { AVATARS, CARD_BACKS, cosmeticTextureKey, DEFAULT_AVATAR, DEFAULT_CARD_BACK, DEFAULT_TABLE_THEME, TABLE_THEMES, type CosmeticOption } from '../cosmetics';
import { playlog } from '../core/playlog';
import { settings } from '../core/settings';
import { getLocale, setLocale, t } from '../localization/i18n';
import { debugApi } from '../verification/debug-api';
import { panelW } from './menu-layout';
import { buildOverlay } from './overlay';
import { DANGER_TINT, fontStyle, label, PixelButton } from './widgets';

/** Vertical pitch between settings rows — 12 rows must fit the 262-unit panel. */
const ROW_PITCH = 20;

/** Next id in a cosmetics catalog list, wrapping around — same tap-to-cycle pattern as SetupScene's AI avatar picker. */
function cycleCosmeticId(list: readonly CosmeticOption[], currentId: string): string {
  const idx = list.findIndex((o) => o.id === currentId);
  return list[(idx + 1) % list.length]!.id;
}

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
    const w = panelW(200);
    // Fixed height: 12 rows at ROW_PITCH must fit inside the 270-unit world, so the panel frame
    // and its title stay on screen. Large text scales the glyphs inside the rows, not the panel.
    const h = 262;
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    objs.push(label(scene, cx, top + 10, t('settings.title'), 9, '#f7d23e').setDepth(510));

    let y = top + 22;
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

    y += ROW_PITCH;
    objs.push(label(scene, cx - 84, y, t('settings.sfx'), 9, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
    objs.push(...makeSlider(scene, cx - 30, y, 100, settings.get().sfxVolume, (v) => settings.update({ sfxVolume: v })));

    y += ROW_PITCH;
    objs.push(label(scene, cx - 84, y, t('settings.music'), 9, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
    objs.push(...makeSlider(scene, cx - 30, y, 100, settings.get().musicVolume, (v) => settings.update({ musicVolume: v })));

    y += ROW_PITCH;
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

    y += ROW_PITCH;
    const contextBtn = new PixelButton(
      scene,
      cx,
      y,
      `${t('settings.musicContext')}: ${settings.get().musicContextAware ? t('settings.on') : t('settings.off')}`,
      () => {
        settings.update({ musicContextAware: !settings.get().musicContextAware });
        contextBtn.setLabel(`${t('settings.musicContext')}: ${settings.get().musicContextAware ? t('settings.on') : t('settings.off')}`);
      },
      { textureBase: 'btn-comprar', w: 170, h: 16, size: 6 },
    ).setDepth(510);
    objs.push(contextBtn);

    y += ROW_PITCH;
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

    y += ROW_PITCH;
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

    y += ROW_PITCH;
    const langBtn = new PixelButton(scene, cx, y, t('menu.language'), () => {
      const next = getLocale() === 'pt' ? 'en' : 'pt';
      setLocale(next);
      settings.update({ locale: next });
      showMain();
    }, { textureBase: 'btn-comprar', w: 150, h: 16, size: 7 }).setDepth(510);
    objs.push(langBtn);

    y += ROW_PITCH;
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

    y += ROW_PITCH;
    objs.push(
      new PixelButton(scene, cx, y, t('cosmetics.title'), showCosmetics, {
        textureBase: 'btn-comprar', w: 150, h: 16, size: 7,
      }).setDepth(510),
    );

    y += ROW_PITCH;
    objs.push(
      new PixelButton(scene, cx, y, t('settings.resetData'), showResetConfirm, {
        textureBase: 'btn-comprar', w: 150, h: 16, size: 7, color: DANGER_TINT,
      }).setDepth(510),
    );

    y += ROW_PITCH;
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
    const w = panelW(170);
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

  /**
   * Table theme / card back / avatar picker — local-only cosmetics, persisted immediately on
   * each tap. Each preview degrades to the default option's art if the chosen one's file hasn't
   * shipped yet (see cosmeticTextureKey), so a missing asset never shows a broken image.
   */
  const showCosmetics = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    const w = panelW(210);
    const h = Math.round(150 * settings.fontScale());
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    objs.push(label(scene, cx, top + 12, t('cosmetics.title'), 9, '#f7d23e').setDepth(510));

    const row = (
      y: number,
      categoryLabel: string,
      list: CosmeticOption[],
      defaultId: string,
      previewSize: { w: number; h: number },
      getId: () => string,
      setId: (id: string) => void,
    ): void => {
      objs.push(label(scene, cx - 84, y, categoryLabel, 8, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
      const previewKey = cosmeticTextureKey(list, getId(), defaultId, debugApi.missingAssets);
      const preview = scene.add
        .image(cx + 4, y, previewKey)
        .setDisplaySize(previewSize.w, previewSize.h)
        .setDepth(510);
      objs.push(preview);
      const current = list.find((o) => o.id === getId()) ?? list.find((o) => o.id === defaultId)!;
      const btn = new PixelButton(
        scene,
        cx + 46,
        y,
        t(current.labelKey),
        () => {
          const nextId = cycleCosmeticId(list, getId());
          setId(nextId);
          showCosmetics(); // full rebuild — preview + label both need to change
        },
        { textureBase: 'btn-comprar', w: 80, h: 16, size: 6 },
      ).setDepth(510);
      objs.push(btn);
    };

    let y = top + 32;
    row(
      y,
      t('cosmetics.table'),
      TABLE_THEMES,
      DEFAULT_TABLE_THEME,
      { w: 40, h: 22 },
      () => settings.cosmetics().tableTheme,
      (id) => settings.updateCosmetics({ tableTheme: id }),
    );

    y += 30;
    row(
      y,
      t('cosmetics.back'),
      CARD_BACKS,
      DEFAULT_CARD_BACK,
      { w: 14, h: 19 },
      () => settings.cosmetics().cardBack,
      (id) => settings.updateCosmetics({ cardBack: id }),
    );

    y += 30;
    row(
      y,
      t('cosmetics.avatar'),
      AVATARS,
      DEFAULT_AVATAR,
      { w: 20, h: 20 },
      () => settings.cosmetics().avatar,
      (id) => settings.updateCosmetics({ avatar: id }),
    );

    y += 26;
    objs.push(
      new PixelButton(scene, cx, y, t('settings.close'), showMain, {
        textureBase: 'btn-comprar', w: 90, h: 16, size: 7,
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
    // Visual track is only 6 units tall — the handle is the smallest control in the game, so its
    // hit area (24 tall, full track width) is grown well past the art for a finger to grab it.
    .setInteractive(new Phaser.Geom.Rectangle(0, -12, w, 24), Phaser.Geom.Rectangle.Contains);
  if (track.input) track.input.cursor = 'pointer';
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
  // worldX, not x: the camera is zoomed RENDER_SCALE times, so pointer.x is in canvas pixels
  // while the slider lives in 480x270 world units.
  let dragging = false;
  const moveHandler = (p: Phaser.Input.Pointer): void => {
    if (dragging && p.isDown) update(p.worldX);
  };
  const endDrag = (): void => {
    dragging = false;
  };
  track.on('pointerdown', (p: Phaser.Input.Pointer) => {
    dragging = true;
    update(p.worldX);
  });
  scene.input.on('pointermove', moveHandler);
  scene.input.on('pointerup', endDrag);
  scene.input.on('pointerupoutside', endDrag);
  track.on('destroy', () => {
    scene.input.off('pointermove', moveHandler);
    scene.input.off('pointerup', endDrag);
    scene.input.off('pointerupoutside', endDrag);
  });

  return [track, fill, handle];
}
