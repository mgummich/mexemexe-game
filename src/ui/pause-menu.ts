import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { panelW } from './menu-layout';
import { buildOverlay, onEscape } from './overlay';
import { openRulesPanel } from './rules-panel';
import { openSettingsPanel } from './settings-panel';
import { view } from './viewport';
import { DANGER_TINT, fontStyle, label, PixelButton } from './widgets';

interface PauseMenuOpts {
  onQuit: () => void;
  /** Online match: the server clock keeps running, so this overlay must not claim the game is paused. */
  online?: boolean;
}

/**
 * "Your progress is safe" answers a first-time worry — the Quit button sits right there and
 * playtesters hesitated over whether pausing itself cost them the match. After a couple of pauses
 * it is just noise, so it fades out of the panel.
 * ponytail: per-session counter, not persisted — a save-backed one belongs in core/persistence.ts.
 */
const REASSURE_PAUSES = 3;
let pausesThisSession = 0;

/** Pause overlay: Continue / Settings / Help / Quit (with an "abandon match?" confirm step). Returns a close() fn. */
export function openPauseMenu(scene: Phaser.Scene, opts: PauseMenuOpts, onClosed: () => void): () => void {
  let objs: Phaser.GameObjects.GameObject[] = [];
  let escBack: () => void = () => close();
  const offEsc = onEscape(scene, () => escBack());
  const close = (): void => {
    for (const o of objs) o.destroy();
    objs = [];
    offEsc();
    onClosed();
  };

  pausesThisSession++;
  // Online never drops the note: "the match keeps going" is a fact about this pause, not reassurance.
  const showNote = opts.online === true || pausesThisSession <= REASSURE_PAUSES;

  const showMain = (): void => {
    escBack = close;
    for (const o of objs) o.destroy();
    objs = [];
    const w = panelW(180);
    // Continue doubles as this panel's close control — grow it (and its siblings, so the stack
    // stays evenly pitched) to a real 24-unit tap target on a coarse pointer.
    const btnH = view().touch ? 24 : 18;
    const pitch = btnH + 6;
    const noteH = showNote ? 20 : 4; // the note under the title takes two lines
    const h = 38 + noteH + pitch * 3 + btnH + 12;
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    objs.push(label(scene, cx, top + 14, t(opts.online === true ? 'pause.titleOnline' : 'pause.title'), 10, '#f7d23e').setDepth(510));
    if (showNote) {
      objs.push(
        scene.add
          .text(cx, top + 26, t(opts.online === true ? 'pause.subtitleOnline' : 'pause.subtitle'), {
            ...fontStyle(7, '#c0b8a8'), align: 'center', wordWrap: { width: w - 20 },
          })
          .setOrigin(0.5, 0)
          .setDepth(510),
      );
    }

    // hide this menu (without resuming the AI timer) while a nested panel is open, then redraw it on close
    const openNested = (openFn: (s: Phaser.Scene, onClosed: () => void) => void): void => {
      for (const o of objs) o.destroy();
      objs = [];
      // the nested panel owns Esc while it is up (see onEscape's stack), and rebuilding this menu
      // on its close restores ours.
      openFn(scene, showMain);
    };

    let y = top + 38 + noteH;
    objs.push(new PixelButton(scene, cx, y, t('pause.continue'), close, {
      textureBase: 'btn-comprar', w: 130, h: btnH, size: 8, color: 0x2e9e50, primary: true,
    }).setDepth(510));
    y += pitch;
    objs.push(
      // settings.title, not menu.settings: every other button in this stack is uppercase, and
      // menu.settings is the sentence-case string the gear tooltip needs.
      new PixelButton(scene, cx, y, t('settings.title'), () => openNested(openSettingsPanel), {
        textureBase: 'btn-comprar', w: 130, h: btnH, size: 8, color: 0x6b6b73,
      }).setDepth(510),
    );
    y += pitch;
    objs.push(
      new PixelButton(scene, cx, y, t('menu.rules'), () => openNested(openRulesPanel), {
        textureBase: 'btn-comprar', w: 130, h: btnH, size: 8, color: 0x6b6b73,
      }).setDepth(510),
    );
    y += pitch;
    objs.push(new PixelButton(scene, cx, y, t('pause.quit'), showQuitConfirm, {
      textureBase: 'btn-comprar', w: 130, h: btnH, size: 8, color: DANGER_TINT,
    }).setDepth(510));
  };

  const showQuitConfirm = (): void => {
    escBack = showMain; // Esc cancels the confirm instead of the whole overlay
    for (const o of objs) o.destroy();
    objs = [];
    const w = panelW(170);
    const btnH = view().touch ? 24 : 18;
    // Two stacked full-width buttons: "keep playing" / "leave match" are sentences, not YES/NO,
    // and they do not fit side by side in the portrait world.
    const h = 66 + btnH * 2 + 6;
    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);
    const { cx, top } = base;

    const txt = scene.add
      .text(cx, top + 16, t(opts.online === true ? 'pause.confirmQuitOnline' : 'pause.confirmQuit'), {
        ...fontStyle(7, '#f0e8d8'), align: 'center', wordWrap: { width: w - 20 },
      })
      .setOrigin(0.5, 0)
      .setDepth(510);
    objs.push(txt);

    objs.push(
      new PixelButton(scene, cx, top + h - btnH * 2 - 12, t('pause.keepPlaying'), showMain, {
        textureBase: 'btn-comprar', w: Math.min(150, w - 20), h: btnH, size: 7, color: 0x2e9e50, primary: true,
      }).setDepth(510),
    );
    objs.push(
      new PixelButton(scene, cx, top + h - btnH / 2 - 8, t('pause.leaveMatch'), () => { close(); opts.onQuit(); }, {
        textureBase: 'btn-comprar', w: Math.min(150, w - 20), h: btnH, size: 7, color: DANGER_TINT,
      }).setDepth(510),
    );
  };

  showMain();
  return close;
}
