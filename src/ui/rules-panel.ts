import Phaser from 'phaser';
import { CARD_H, CARD_W } from '../assets/manifest';
import { t } from '../localization/i18n';
import { clampScroll } from '../table/editor-layout';
import { cx as centreX, panelW } from './menu-layout';
import { buildOverlay, onEscape } from './overlay';
import { rulesBox, rulesBtnH, RULES_TAB_DX } from './settings-layout';
import { fontStyle, label, PixelButton } from './widgets';
import { debugApi } from '../verification/debug-api';

/**
 * BASICS is a one-screen visual quick reference (what is legal, shown in cards), CONTROLS is how
 * to perform it, and the wall of prose that used to be the whole panel now lives one tap deeper
 * behind "see full rules".
 */
type RulesView = 'basics' | 'controls' | 'full';

/** Quick-reference rows: the rule is shown as a real meld, the caption only names it. */
const EXAMPLES: { captionKey: string; cards: string[] }[] = [
  { captionKey: 'rules.ex.run', cards: ['card-diamonds-4', 'card-diamonds-5', 'card-diamonds-6'] },
  { captionKey: 'rules.ex.set', cards: ['card-hearts-9', 'card-spades-9', 'card-clubs-9'] },
  { captionKey: 'rules.ex.ace', cards: ['card-spades-1', 'card-spades-2', 'card-spades-3'] },
  { captionKey: 'rules.ex.joker', cards: ['card-clubs-7', 'card-joker', 'card-clubs-9'] },
];

/** Example cards render at 3/4 of a real board card — big enough to read a rank and suit. */
const EX_W = Math.round(CARD_W * 0.75);
const EX_H = Math.round(CARD_H * 0.75);
const EX_GAP = 2;

/**
 * What the board is waiting on right now, supplied by the scene that opens the panel. The panel
 * knows the rules; only the scene knows why FEITO is greyed out or which meld is invalid, so the
 * sentence arrives already written and already localized.
 */
interface RulesContext {
  /** One line naming the current blocker, e.g. "FEITO is off: the trinca has two jokers." */
  hint: string;
}

/** Opens the rules overlay (quick reference / controls / full text). Returns a close() fn. */
export function openRulesPanel(scene: Phaser.Scene, onClosed: () => void, context?: RulesContext): () => void {
  debugApi.rulesOpen = true;
  let objs: Phaser.GameObjects.GameObject[] = [];
  let teardown: (() => void)[] = [];
  let current: RulesView = 'basics';
  const w = panelW(260);
  const cx = centreX(); // matches buildOverlay's panel center — needed before buildOverlay runs

  const clear = (): void => {
    for (const fn of teardown) fn();
    teardown = [];
    for (const o of objs) o.destroy();
    objs = [];
  };
  const offEsc = onEscape(scene, () => (current === 'basics' ? close() : show('basics')));
  const close = (): void => {
    clear();
    offEsc();
    debugApi.rulesOpen = false;
    onClosed();
  };

  /** Lays the quick reference into `c` (local coords, origin = content top centre). Returns its height. */
  const buildBasics = (c: Phaser.GameObjects.Container): number => {
    const left = -w / 2 + 10;
    let y = 0;
    if (context) {
      // The answer to "what do I do now" goes above the evergreen rules, in gold so it reads as
      // this-moment information rather than another rule line.
      const hint = scene.add
        .text(left, 0, context.hint, { ...fontStyle(7, '#f7d23e'), wordWrap: { width: w - 20 } })
        .setOrigin(0, 0);
      c.add(hint);
      y = hint.height + 6;
    }
    const goal = scene.add
      .text(left, y, t('rules.goal'), { ...fontStyle(7, '#f0e8d8'), wordWrap: { width: w - 20 } })
      .setOrigin(0, 0);
    c.add(goal);
    y += goal.height + 5;
    for (const ex of EXAMPLES) {
      const capX = left + ex.cards.length * (EX_W + EX_GAP) + 6;
      const caption = scene.add
        .text(capX, 0, t(ex.captionKey), { ...fontStyle(7, '#f0e8d8'), wordWrap: { width: w / 2 - 10 - capX } })
        .setOrigin(0, 0.5);
      const rowH = Math.max(EX_H, caption.height);
      caption.setY(y + rowH / 2);
      c.add(caption);
      let x = left;
      for (const key of ex.cards) {
        // Card art is composed at boot; a missing file must leave a gap, never a broken image.
        if (scene.textures.exists(key)) {
          c.add(scene.add.image(x + EX_W / 2, y + rowH / 2, key).setDisplaySize(EX_W, EX_H));
        }
        x += EX_W + EX_GAP;
      }
      y += rowH + 5;
    }
    return y;
  };

  /** Lays plain text blocks into `c`. Returns their total height. */
  const buildText = (c: Phaser.GameObjects.Container, blocks: string[]): number => {
    const left = -w / 2 + 10;
    let y = 0;
    for (const text of blocks) {
      const block = scene.add
        .text(left, y, text, { ...fontStyle(7, '#f0e8d8'), align: 'left', wordWrap: { width: w - 20 } })
        .setOrigin(0, 0);
      c.add(block);
      y += block.height + 6;
    }
    return y;
  };

  const show = (next: RulesView): void => {
    current = next;
    clear();

    // Content is measured (locale + large-text scaled) instead of assumed, so the panel never
    // guesses wrong about how tall the real copy is.
    const content = scene.add.container(0, 0).setDepth(510);
    const contentH = next === 'basics'
      ? buildBasics(content)
      : buildText(content, next === 'controls' ? [t('rules.shortcuts'), t('rules.uiHelp')] : [t('rules.body')]);

    // basics offers the drill-down to the full text, full offers the way back — controls has neither.
    const secondaryKey = next === 'basics' ? 'rules.full' : next === 'full' ? 'settings.back' : null;
    const btnH = rulesBtnH();
    const box = rulesBox(secondaryKey !== null);
    const { h, top, contentTop, contentAreaH } = box;
    // A few units of slack: every block adds trailing padding, so "overflows by 1" is not worth
    // clipping and scrolling for.
    const canScroll = contentH > contentAreaH + 4;

    const base = buildOverlay(scene, w, h, close);
    objs.push(...base.objs);

    objs.push(label(scene, cx, top + 11, t('rules.title'), 9, '#f7d23e').setDepth(510));

    const tab = (dx: number, key: string, target: RulesView): void => {
      const btn = new PixelButton(scene, cx + dx, box.tabY, t(key), () => show(target), {
        textureBase: 'btn-comprar', w: Math.min(86, w / 2 - 8), h: btnH, size: 7,
        color: next === target ? 0xffffff : 0x6b6b73,
      }).setDepth(510);
      // Gold ring, not just a lighter wood: the active tab must not be signalled by colour alone.
      btn.setSelected(next === target);
      objs.push(btn);
    };
    tab(-RULES_TAB_DX, 'rules.tab.basics', 'basics');
    tab(RULES_TAB_DX, 'rules.tab.controls', 'controls');

    let scroll = 0;
    content.setPosition(cx, contentTop);
    objs.push(content);

    if (canScroll) {
      const gfx = scene.make.graphics(undefined, false);
      gfx.fillStyle(0xffffff);
      gfx.fillRect(cx - w / 2, contentTop, w, contentAreaH);
      // Phaser 4 ignores setMask() under WebGL ("use a Mask filter instead"), so the geometry
      // mask this panel used to build did nothing and the full-rules text spilled out over the
      // buttons. A Mask filter on the container is the supported form.
      content.enableFilters();
      content.filters?.internal.addMask(gfx, false, undefined, 'world');
      teardown.push(() => gfx.destroy());

      // Now that the clip actually clips, a sentence cut in half needs to read as "there is more
      // below", not as a rendering bug. The arrow disappears once the content is scrolled out.
      const more = scene.add
        .text(cx + w / 2 - 7, contentTop + contentAreaH, '▼', fontStyle(7, '#f7d23e'))
        .setOrigin(0.5, 1)
        .setDepth(511);
      objs.push(more);

      // Drag-to-scroll over the content area — same gesture (and same clamp) the mobile editor's
      // meld list already uses (src/table/editor-layout.ts).
      const dragSurface = scene.add
        .rectangle(cx, contentTop + contentAreaH / 2, w, contentAreaH, 0x000000, 0)
        .setDepth(509)
        .setInteractive({ useHandCursor: false });
      objs.push(dragSurface);
      let dragStartY = 0;
      let dragStartScroll = 0;
      let dragging = false;
      dragSurface.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragging = true;
        dragStartY = p.worldY;
        dragStartScroll = scroll;
      });
      const move = (p: Phaser.Input.Pointer): void => {
        if (!dragging || !p.isDown) return;
        const nextScroll = clampScroll(dragStartScroll - (p.worldY - dragStartY), contentH, contentAreaH);
        if (nextScroll !== scroll) {
          scroll = nextScroll;
          content.setY(contentTop - scroll);
          more.setVisible(scroll < contentH - contentAreaH - 0.5);
        }
      };
      const endDrag = (): void => {
        dragging = false;
      };
      scene.input.on('pointermove', move);
      scene.input.on('pointerup', endDrag);
      scene.input.on('pointerupoutside', endDrag);
      // Same OS-steals-the-pointer gap as the settings slider — Phaser has no pointercancel input
      // event, so reset the drag flag off the raw canvas event instead.
      scene.game.canvas.addEventListener('pointercancel', endDrag);
      teardown.push(() => {
        scene.input.off('pointermove', move);
        scene.input.off('pointerup', endDrag);
        scene.input.off('pointerupoutside', endDrag);
        scene.game.canvas.removeEventListener('pointercancel', endDrag);
      });
    }

    if (secondaryKey !== null) {
      objs.push(
        new PixelButton(scene, cx, box.secondaryY, t(secondaryKey),
          () => show(next === 'basics' ? 'full' : 'basics'), {
            textureBase: 'btn-comprar', w: Math.min(170, w - 20), h: btnH, size: 7, color: 0x8a7f68,
          }).setDepth(510),
      );
    }
    objs.push(new PixelButton(scene, cx, box.closeY, t('settings.close'), close, {
      textureBase: 'btn-comprar', w: 90, h: btnH, size: 7, color: 0x6b6b73,
    }).setDepth(510));
  };

  show('basics');
  return close;
}
