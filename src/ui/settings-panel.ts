import Phaser from 'phaser';
import { AVATARS, CARD_BACKS, cosmeticTextureKey, DEFAULT_AVATAR, DEFAULT_CARD_BACK, DEFAULT_TABLE_THEME, TABLE_THEMES, type CosmeticOption } from '../cosmetics';
import { AI_DIFFICULTIES, AI_EXPLAIN_MODES, AI_SPEEDS, type HelperMode } from '../core/persistence';
import { playlog } from '../core/playlog';
import { settings } from '../core/settings';
import { getLocale, setLocale, t } from '../localization/i18n';
import { debugApi } from '../verification/debug-api';
import { panelW } from './menu-layout';
import { buildOverlay } from './overlay';
import {
  AccessRow, ACCESS_ROWS, AdvancedRow, ADVANCED_ROWS, AiRow, AI_ROWS, AudioRow, AUDIO_ROWS,
  cosmeticsPanelH, cosmeticsRowOffset, GameRow, GAME_ROWS, MAIN_ROWS,
  panelHForRows, rowOffset, SettingsRow,
} from './settings-layout';
import { DANGER_TINT, fontStyle, label, PixelButton } from './widgets';

// Row y-coordinates (settingsRowY, cosmeticsRowY, SettingsRow, ...) live in ./settings-layout,
// a Phaser-free module — this file imports Phaser at the top, which crashes if pulled into a
// non-browser context (Node unit tests, the e2e spec's Node-side setup). Import from there.

/** Next id in a cosmetics catalog list, wrapping around — same tap-to-cycle pattern as SetupScene's AI avatar picker. */
function cycleCosmeticId(list: readonly CosmeticOption[], currentId: string): string {
  const idx = list.findIndex((o) => o.id === currentId);
  return list[(idx + 1) % list.length]!.id;
}

/** Next entry in a fixed option list, wrapping around. One helper for every tap-to-cycle
 * settings row, so a new row is a list plus a label key rather than another bespoke cycler. */
function cycleOption<T extends string>(list: readonly T[], current: T): T {
  return list[(list.indexOf(current) + 1) % list.length]!;
}

/** beginner -> standard -> expert -> beginner, same wrap-around cycling as cycleCosmeticId. */
const HELPER_MODES: readonly HelperMode[] = ['beginner', 'standard', 'expert'];
function cycleHelperMode(current: HelperMode): HelperMode {
  return HELPER_MODES[(HELPER_MODES.indexOf(current) + 1) % HELPER_MODES.length]!;
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

/** Opens the settings overlay: a section menu (Game / Audio / Accessibility / Cosmetics /
 * Advanced) over one sub-panel each. Returns a close() fn. */
export function openSettingsPanel(scene: Phaser.Scene, onClosed: () => void): () => void {
  let objs: Phaser.GameObjects.GameObject[] = [];
  const close = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    onClosed();
  };

  /** Shared chrome for every panel in this overlay: frame, title, and a row-y helper. */
  const openPanel = (rows: number, title: string): { cx: number; rowY: (i: number) => number } => {
    for (const o of objs) o.destroy();
    objs = [];
    const h = panelHForRows(rows);
    const base = buildOverlay(scene, panelW(200), h, close);
    objs.push(...base.objs);
    objs.push(label(scene, base.cx, base.top + 10, title, 9, '#f7d23e').setDepth(510));
    return { cx: base.cx, rowY: (i: number) => base.top + rowOffset(i) };
  };

  /** Wooden row button — every settings row is one of these, so sizes stay consistent. */
  const rowBtn = (
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: { w?: number; size?: number; color?: number; tooltip?: string } = {},
  ): PixelButton => {
    const btn = new PixelButton(scene, x, y, text, onClick, {
      textureBase: 'btn-comprar', w: opts.w ?? 170, h: 16, size: opts.size ?? 6,
      ...(opts.color === undefined ? {} : { color: opts.color }),
      ...(opts.tooltip === undefined ? {} : { tooltip: opts.tooltip }),
    }).setDepth(510);
    objs.push(btn);
    return btn;
  };

  /** "Label: On/Off" toggle bound to one boolean settings field. */
  const toggleBtn = (
    x: number,
    y: number,
    labelKey: string,
    get: () => boolean,
    set: (v: boolean) => void,
    opts: { tooltip?: string; rebuild?: () => void } = {},
  ): void => {
    const caption = (): string => `${t(labelKey)}: ${get() ? t('settings.on') : t('settings.off')}`;
    const btn = rowBtn(x, y, caption(), () => {
      set(!get());
      if (opts.rebuild) opts.rebuild();
      else btn.setLabel(caption());
    }, opts.tooltip === undefined ? {} : { tooltip: opts.tooltip });
  };

  /**
   * Main panel: a mute shortcut plus one row per section. Everything else lives one tap deeper,
   * so the first thing a player sees is five plain choices instead of the whole option surface.
   */
  const showMain = (): void => {
    const { cx, rowY } = openPanel(MAIN_ROWS, t('settings.title'));

    const muteCaption = (): string => (settings.get().muted ? t('settings.unmute') : t('settings.mute'));
    const muteBtn = rowBtn(cx, rowY(SettingsRow.Mute), muteCaption(), () => {
      settings.update({ muted: !settings.get().muted });
      muteBtn.setLabel(muteCaption());
    }, { w: 150, size: 7 });

    rowBtn(cx, rowY(SettingsRow.Game), t('settings.section.game'), showGame, { w: 150, size: 7 });
    rowBtn(cx, rowY(SettingsRow.Audio), t('settings.section.audio'), showAudio, { w: 150, size: 7 });
    rowBtn(cx, rowY(SettingsRow.Access), t('settings.section.access'), showAccess, { w: 150, size: 7 });
    rowBtn(cx, rowY(SettingsRow.Cosmetics), t('cosmetics.title'), showCosmetics, { w: 150, size: 7 });
    rowBtn(cx, rowY(SettingsRow.Ai), t('settings.section.ai'), showAi, { w: 150, size: 7 });
    // Replay seed, test-log export and the destructive reset all sit behind this one row: they
    // are testing affordances, and mixing them into the player-facing list made the whole screen
    // look like a debug menu.
    rowBtn(cx, rowY(SettingsRow.Advanced), t('settings.advanced'), showAdvanced, { w: 150, size: 7, color: 0x8a7f68 });
    rowBtn(cx, rowY(SettingsRow.Close), t('settings.close'), close, { w: 90, size: 7 });
  };

  const showGame = (): void => {
    const { cx, rowY } = openPanel(GAME_ROWS, t('settings.section.game'));

    const helperCaption = (): string => `${t('settings.helperMode')}: ${t(`settings.helperMode.${settings.helperMode()}`)}`;
    const helperBtn = rowBtn(cx, rowY(GameRow.HelperMode), helperCaption(), () => {
      settings.update({ helperMode: cycleHelperMode(settings.helperMode()) });
      helperBtn.setLabel(helperCaption());
    });

    rowBtn(cx, rowY(GameRow.Lang), t('menu.language'), () => {
      const next = getLocale() === 'pt' ? 'en' : 'pt';
      setLocale(next);
      settings.update({ locale: next });
      showGame();
    }, { w: 150, size: 7 });

    rowBtn(cx, rowY(GameRow.Back), t('settings.back'), showMain, { w: 90, size: 7 });
  };

  /**
   * AI sub-panel. Difficulty is a search-depth tier and speed is a presentation pause — neither
   * lets an opponent see a hidden hand or play an illegal meld (src/ai/ai.ts), and none of it
   * applies to an online match, where every seat is a person.
   */
  const showAi = (): void => {
    const { cx, rowY } = openPanel(AI_ROWS, t('settings.section.ai'));

    const diffCaption = (): string => `${t('settings.aiDifficulty')}: ${t(`settings.aiDifficulty.${settings.get().aiDifficulty}`)}`;
    const diffBtn = rowBtn(cx, rowY(AiRow.Difficulty), diffCaption(), () => {
      settings.update({ aiDifficulty: cycleOption(AI_DIFFICULTIES, settings.get().aiDifficulty) });
      diffBtn.setLabel(diffCaption());
    });

    const speedCaption = (): string => `${t('settings.aiSpeed')}: ${t(`settings.aiSpeed.${settings.get().aiSpeed}`)}`;
    const speedBtn = rowBtn(cx, rowY(AiRow.Speed), speedCaption(), () => {
      settings.update({ aiSpeed: cycleOption(AI_SPEEDS, settings.get().aiSpeed) });
      speedBtn.setLabel(speedCaption());
    });

    const explainCaption = (): string => `${t('settings.aiExplain')}: ${t(`settings.aiExplain.${settings.get().aiExplain}`)}`;
    const explainBtn = rowBtn(cx, rowY(AiRow.Explain), explainCaption(), () => {
      settings.update({ aiExplain: cycleOption(AI_EXPLAIN_MODES, settings.get().aiExplain) });
      explainBtn.setLabel(explainCaption());
    });

    rowBtn(cx, rowY(AiRow.Back), t('settings.back'), showMain, { w: 90, size: 7 });
  };

  const showAudio = (): void => {
    const { cx, rowY } = openPanel(AUDIO_ROWS, t('settings.section.audio'));

    let y = rowY(AudioRow.Sfx);
    objs.push(label(scene, cx - 84, y, t('settings.sfx'), 9, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
    objs.push(...makeSlider(scene, cx - 30, y, 100, settings.get().sfxVolume, (v) => settings.update({ sfxVolume: v })));

    y = rowY(AudioRow.Music);
    objs.push(label(scene, cx - 84, y, t('settings.music'), 9, '#c0b8a8').setOrigin(0, 0.5).setDepth(510));
    objs.push(...makeSlider(scene, cx - 30, y, 100, settings.get().musicVolume, (v) => settings.update({ musicVolume: v })));

    toggleBtn(cx, rowY(AudioRow.MusicEnabled), 'settings.music',
      () => settings.get().musicEnabled, (v) => settings.update({ musicEnabled: v }));
    toggleBtn(cx, rowY(AudioRow.MusicContext), 'settings.musicContext',
      () => settings.get().musicContextAware, (v) => settings.update({ musicContextAware: v }));
    toggleBtn(cx, rowY(AudioRow.TimerTick), 'settings.timerTick',
      () => settings.get().timerTickSound, (v) => settings.update({ timerTickSound: v }),
      { tooltip: t('settings.timerTickHint') });

    rowBtn(cx, rowY(AudioRow.Back), t('settings.back'), showMain, { w: 90, size: 7 });
  };

  const showAccess = (): void => {
    const { cx, rowY } = openPanel(ACCESS_ROWS, t('settings.section.access'));

    toggleBtn(cx, rowY(AccessRow.Motion), 'settings.reducedMotion',
      () => settings.get().reducedMotion, (v) => settings.update({ reducedMotion: v }));
    toggleBtn(cx, rowY(AccessRow.BatterySaver), 'settings.batterySaver',
      () => settings.get().batterySaver, (v) => settings.update({ batterySaver: v }),
      { tooltip: t('settings.batterySaverHint') });
    // Large text rescales every glyph in the overlay, so this one rebuilds the whole sub-panel
    // instead of just relabelling its own button.
    toggleBtn(cx, rowY(AccessRow.LargeText), 'settings.largeText',
      () => settings.get().largeText, (v) => settings.update({ largeText: v }), { rebuild: showAccess });

    rowBtn(cx, rowY(AccessRow.Back), t('settings.back'), showMain, { w: 90, size: 7 });
  };

  const showAdvanced = (): void => {
    const { cx, rowY } = openPanel(ADVANCED_ROWS, t('settings.advanced'));

    const exportBtn = rowBtn(cx, rowY(AdvancedRow.Export), t('settings.exportLog'), () => {
      copyPlaylog((ok) => {
        // Panel may have closed (or rebuilt for a settings change) before this callback runs —
        // never touch a destroyed button.
        if (!exportBtn.active) return;
        exportBtn.setLabel(ok ? t('settings.exportLogCopied') : t('settings.exportLogFailed'));
        scene.time.delayedCall(1500, () => exportBtn.active && exportBtn.setLabel(t('settings.exportLog')));
      });
    }, { size: 7 });

    rowBtn(cx, rowY(AdvancedRow.ResetData), t('settings.resetData'), showResetConfirm, {
      w: 150, size: 7, color: DANGER_TINT,
    });

    objs.push(label(scene, cx, rowY(AdvancedRow.Version), `v${__APP_VERSION__}`, 7, '#8a7f68').setDepth(510));

    rowBtn(cx, rowY(AdvancedRow.Back), t('settings.back'), showMain, { w: 90, size: 7 });
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
    const h = cosmeticsPanelH();
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

    let y = top + cosmeticsRowOffset(0);
    row(
      y,
      t('cosmetics.table'),
      TABLE_THEMES,
      DEFAULT_TABLE_THEME,
      { w: 40, h: 22 },
      () => settings.cosmetics().tableTheme,
      (id) => settings.updateCosmetics({ tableTheme: id }),
    );

    y = top + cosmeticsRowOffset(1);
    row(
      y,
      t('cosmetics.back'),
      CARD_BACKS,
      DEFAULT_CARD_BACK,
      { w: 14, h: 19 },
      () => settings.cosmetics().cardBack,
      (id) => settings.updateCosmetics({ cardBack: id }),
    );

    y = top + cosmeticsRowOffset(2);
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
  // OS/browser can steal a pointer mid-drag (system gesture, notification) — pointercancel fires
  // then instead of pointerup. Phaser has no pointercancel input event (same gap GameScene's card
  // drag hits), so listen on the raw canvas, same as GameScene's cancelDragOnPointerCancel.
  scene.game.canvas.addEventListener('pointercancel', endDrag);
  track.on('destroy', () => {
    scene.input.off('pointermove', moveHandler);
    scene.input.off('pointerup', endDrag);
    scene.input.off('pointerupoutside', endDrag);
    scene.game.canvas.removeEventListener('pointercancel', endDrag);
  });

  return [track, fill, handle];
}
