import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { clampScroll } from '../table/editor-layout';
import { cx as centreX, panelW } from './menu-layout';
import { buildOverlay } from './overlay';
import { view } from './viewport';
import { fontStyle, label, PixelButton } from './widgets';

/** Opens a compact rules-summary overlay. Returns a close() fn. */
export function openRulesPanel(scene: Phaser.Scene, onClosed: () => void): () => void {
  const objs: Phaser.GameObjects.GameObject[] = [];
  const w = panelW(260);
  const cx = centreX(); // matches buildOverlay's panel center — needed before buildOverlay runs
  let scrollMove: ((p: Phaser.Input.Pointer) => void) | null = null;
  let maskGfx: Phaser.GameObjects.Graphics | null = null;
  const close = (): void => {
    for (const o of objs) o.destroy();
    maskGfx?.destroy();
    if (scrollMove) scene.input.off('pointermove', scrollMove);
    onClosed();
  };

  // Body/shortcuts/uiHelp text is measured (locale + large-text scaled) instead of assumed, so
  // the panel never guesses wrong about how tall the real copy is.
  const body = scene.add
    .text(cx, 0, t('rules.body'), {
      ...fontStyle(7, '#f0e8d8'),
      align: 'left',
      wordWrap: { width: w - 24 },
    })
    .setOrigin(0.5, 0)
    .setDepth(510);
  const shortcuts = scene.add
    .text(cx, 0, t('rules.shortcuts'), {
      ...fontStyle(6, '#c0b8a8'),
      align: 'left',
      wordWrap: { width: w - 24 },
    })
    .setOrigin(0.5, 0)
    .setDepth(510);
  // Phase 14: helper modes, selection highlights, ghost preview, the mobile editor, zoom/focus
  // and the online locked state — separate from the game-rules copy above.
  const uiHelp = scene.add
    .text(cx, 0, t('rules.uiHelp'), {
      ...fontStyle(6, '#c0b8a8'),
      align: 'left',
      wordWrap: { width: w - 24 },
    })
    .setOrigin(0.5, 0)
    .setDepth(510);
  const contentH = body.height + 6 + shortcuts.height + 6 + uiHelp.height;

  // Coarse pointer: grow the close button to a real 24-unit tap target (it's the panel's only
  // way out other than tapping the dim backdrop).
  const closeH = view().touch ? 24 : 16;
  // Phase 14 added a third block (rules.uiHelp) that no longer always fits above the fold — the
  // panel now caps its own height to the viewport instead of growing past it, and the content
  // area (between title and close button) scrolls, reusing the same clamp the mobile Mexe editor's
  // meld list already uses (src/table/editor-layout.ts).
  const titleH = 24;
  const bottomH = closeH + 12;
  const maxH = view().h - 16;
  const h = Math.round(Math.min(maxH, titleH + contentH + bottomH));
  const contentAreaH = h - titleH - bottomH;
  const canScroll = contentH > contentAreaH + 0.5;

  const base = buildOverlay(scene, w, h, close);
  objs.push(...base.objs);
  const { top } = base;
  const contentTop = top + titleH;

  objs.push(label(scene, cx, top + 12, t('rules.title'), 9, '#f7d23e').setDepth(510));

  let scroll = 0;
  const layoutContent = (): void => {
    body.setPosition(cx, contentTop - scroll);
    shortcuts.setPosition(cx, contentTop - scroll + body.height + 6);
    uiHelp.setPosition(cx, contentTop - scroll + body.height + 6 + shortcuts.height + 6);
  };
  layoutContent();
  objs.push(body, shortcuts, uiHelp);

  if (canScroll) {
    const gfx = scene.make.graphics(undefined, false);
    gfx.fillStyle(0xffffff);
    gfx.fillRect(cx - w / 2, contentTop, w, contentAreaH);
    const mask = gfx.createGeometryMask();
    maskGfx = gfx;
    body.setMask(mask);
    shortcuts.setMask(mask);
    uiHelp.setMask(mask);

    // Drag-to-scroll over the content area — same gesture the mobile editor's meld list and the
    // zoomed table's pan surface already use.
    const dragSurface = scene.add
      .rectangle(cx, contentTop + contentAreaH / 2, w, contentAreaH, 0x000000, 0)
      .setDepth(509)
      .setInteractive({ useHandCursor: false });
    objs.push(dragSurface);
    let dragStartY = 0;
    let dragStartScroll = 0;
    dragSurface.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragStartY = p.worldY;
      dragStartScroll = scroll;
    });
    const move = (p: Phaser.Input.Pointer): void => {
      if (!p.isDown) return;
      const next = clampScroll(dragStartScroll - (p.worldY - dragStartY), contentH, contentAreaH);
      if (next !== scroll) {
        scroll = next;
        layoutContent();
      }
    };
    scene.input.on('pointermove', move);
    scrollMove = move;
  }

  objs.push(new PixelButton(scene, cx, top + h - closeH / 2 - 6, t('settings.close'), close, {
    textureBase: 'btn-comprar', w: 90, h: closeH, size: 7, color: 0x6b6b73,
  }).setDepth(510));
  return close;
}
