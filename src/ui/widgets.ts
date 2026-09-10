import Phaser from 'phaser';
import { playSfx } from '../audio/sfx';
import { PIXEL_FONT } from '../assets/compose-cards';
import { settings } from '../core/settings';
import { view } from './viewport';

/** Nothing user-facing renders below this (logical px, pre large-text scale) — small pixel-font glyphs turn to mush once upscaled to 720p/1080p. */
const MIN_FONT_SIZE = 8;

/**
 * Cap-height of the pixel font as a fraction of its font size (measured from font.ttf:
 * uppercase ink spans 16px above the baseline at 32px).
 */
const CAP_RATIO = 0.5;

/** Single choke point for text sizing — every label/button/panel routes through this, so the "large text" setting scales the whole UI at once. */
export function fontStyle(size: number, color = '#f7f2e7'): Phaser.Types.GameObjects.Text.TextStyle {
  const px = Math.round(Math.max(size, MIN_FONT_SIZE) * settings.fontScale());
  // Explicit metrics instead of Phaser's browser measurement: Chrome, Firefox and Safari each
  // report different ascent/descent for the same font, which shifted every centred label by a
  // pixel or two and pushed button captions off their plates. Ascent is set so the cap-height
  // box lands exactly in the middle of the box, identically everywhere. Padding keeps
  // descenders (and a fallback font's taller glyphs) from being clipped without moving the centre.
  return {
    fontFamily: `"${PIXEL_FONT}", monospace`,
    fontSize: `${px}px`,
    color,
    resolution: 4,
    padding: { y: Math.ceil(px * 0.25) },
    metrics: { fontSize: px, ascent: (px * (1 + CAP_RATIO)) / 2, descent: 0 },
  };
}

export function label(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size = 8,
  color = '#f7f2e7',
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, fontStyle(size, color)).setOrigin(0.5);
}

/** Menu/lobby scene switch with a short fade instead of a hard cut — instant (no fade) when
 * reduced motion is on, same motionScale() gate as every other cosmetic tween. */
export function gotoScene(scene: Phaser.Scene, key: string, data?: object): void {
  const dur = Math.round(140 * settings.motionScale());
  if (dur <= 0) {
    scene.scene.start(key, data);
    return;
  }
  scene.cameras.main.fadeOut(dur, 15, 10, 8);
  scene.cameras.main.once('camerafadeoutcomplete', () => scene.scene.start(key, data));
}

export interface PixelButtonOpts {
  textureBase?: string; // e.g. 'btn-feito' → uses -normal/-hover/-pressed/-disabled
  w?: number;
  h?: number;
  size?: number;
  /**
   * Palette color. For the texture-missing rect fallback this is the fill color (default green
   * wood 0x2e9e50). For a real wooden button texture this is a multiply-tint applied on top of
   * the art (default 0xffffff = the texture's native color, e.g. feito/comprar's green wood) —
   * pass a tan tone for secondary buttons or a red tone for danger buttons.
   */
  color?: number;
  /** Small dark label shown above the button 400ms after hover starts. */
  tooltip?: string;
  /** Fires when the button is tapped/clicked while disabled — no sfx, no onClick, just this. */
  onBlocked?: () => void;
}

/** Multiplies an RGB color by a brightness factor, clamped — used to derive hover/pressed/disabled shades from one base palette color. */
function shade(hex: number, factor: number): number {
  const c = Phaser.Display.Color.ValueToColor(hex);
  const clamp = (v: number) => Phaser.Math.Clamp(Math.round(v * factor), 0, 255);
  return Phaser.Display.Color.GetColor(clamp(c.red), clamp(c.green), clamp(c.blue));
}

/** Red multiply-tint for danger buttons (e.g. APAGAR DADOS / reset) applied over the neutral wood texture. */
export const DANGER_TINT = 0xff7a68;

const STATE_SHADE: Record<'normal' | 'hover' | 'pressed' | 'disabled', number> = {
  normal: 1,
  hover: 1.18,
  pressed: 0.78,
  disabled: 0.5,
};

const INK_FRAME = 'ink';

/**
 * Adds (once per texture) a frame cropped to the texture's opaque pixels and returns its name.
 * The PixelLab plates ship with transparent padding — feito-normal is 168x60 with the wood only
 * in rows 0..45 — so stretching the raw frame to the button box put the plate's visible centre
 * above the box centre and left every caption sitting low. Cropping first maps the wood itself
 * onto the button box, which is what the label is centred on.
 */
function inkFrame(scene: Phaser.Scene, key: string): string | undefined {
  const tex = scene.textures.get(key);
  if (tex.has(INK_FRAME)) return INK_FRAME;
  const src = tex.getSourceImage() as CanvasImageSource & { width: number; height: number };
  const canvas = Phaser.Display.Canvas.CanvasPool.create2D(null, src.width, src.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(src, 0, 0);
  const data = ctx.getImageData(0, 0, src.width, src.height).data;
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if ((data[(y * src.width + x) * 4 + 3] ?? 0) <= 16) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  Phaser.Display.Canvas.CanvasPool.remove(canvas);
  if (x1 < x0 || y1 < y0) return undefined;
  tex.add(INK_FRAME, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  return INK_FRAME;
}

/** Tactile button: texture-swap states or tinted rect fallback, with press squash. */
export class PixelButton extends Phaser.GameObjects.Container {
  private bgImage?: Phaser.GameObjects.Image;
  private bgRect?: Phaser.GameObjects.Rectangle;
  private txt: Phaser.GameObjects.Text;
  private enabledState = true;
  private readonly base?: string;
  private readonly paletteColor: number;
  private tooltipTimer: Phaser.Time.TimerEvent | null = null;
  private tooltipGfx: Phaser.GameObjects.GameObject[] = [];
  private selectedRing?: Phaser.GameObjects.Rectangle;
  /** Visual (art) size — distinct from the container's hit-box size, which a coarse pointer grows past this. */
  private readonly visualW: number;
  private readonly visualH: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: PixelButtonOpts = {},
  ) {
    super(scene, x, y);
    const w = opts.w ?? 56;
    const h = opts.h ?? 20;
    this.visualW = w;
    this.visualH = h;
    this.base = opts.textureBase;
    this.paletteColor = opts.color ?? 0xffffff;
    if (this.base && scene.textures.exists(`${this.base}-normal`)) {
      const key = `${this.base}-normal`;
      this.bgImage = scene.add.image(0, 0, key, inkFrame(scene, key)).setDisplaySize(w, h);
      this.add(this.bgImage);
    } else {
      this.bgRect = scene.add.rectangle(0, 0, w, h, opts.color ?? 0x2e9e50).setStrokeStyle(1, 0x1a1a22);
      this.add(this.bgRect);
    }
    this.txt = label(scene, 0, 0, text, opts.size ?? 8);
    this.add(this.txt);
    // Coarse pointer: grow the hit box past the artwork so a touch target never shrinks below a
    // usable size — the art itself (visualW/visualH) stays exactly w x h either way.
    const touch = view().touch;
    this.setSize(touch ? Math.max(w, 34) : w, touch ? Math.max(h, 31) : h);
    this.setInteractive({ useHandCursor: true });
    this.setBtnTexture('normal'); // apply palette tint immediately, not just on first hover

    this.on('pointerover', () => this.enabledState && this.setBtnTexture('hover'));
    this.on('pointerout', () => this.enabledState && this.setBtnTexture('normal'));
    if (opts.tooltip) {
      this.on('pointerover', () => {
        this.tooltipTimer = scene.time.delayedCall(400, () => this.showTooltip(opts.tooltip!, h));
      });
      this.on('pointerout', () => this.hideTooltip());
      this.on('destroy', () => this.hideTooltip());
      if (touch) {
        // no hover on touch — show on tap instead, and auto-hide since there's no pointerout to close it.
        // Skipped while disabled: a disabled button's tap already answers with its blocking reason
        // (see onBlocked), and "Confirm your move" next to "you can't confirm yet" reads as a lie.
        this.on('pointerdown', () => {
          if (!this.enabledState) return;
          this.showTooltip(opts.tooltip!, h);
          this.tooltipTimer = scene.time.delayedCall(2500, () => this.hideTooltip());
        });
      }
    }
    this.on('pointerdown', () => {
      if (!this.enabledState) return;
      this.setBtnTexture('pressed');
      this.setScale(0.94);
    });
    this.on('pointerup', () => {
      if (!this.enabledState) {
        opts.onBlocked?.();
        return;
      }
      this.setBtnTexture('hover');
      this.setScale(1);
      playSfx(scene, 'sfx-click', 0.4);
      onClick();
    });
    scene.add.existing(this);
  }

  private setBtnTexture(state: 'normal' | 'hover' | 'pressed' | 'disabled'): void {
    if (this.bgImage && this.base && this.scene.textures.exists(`${this.base}-${state}`)) {
      const key = `${this.base}-${state}`;
      this.bgImage.setTexture(key, inkFrame(this.scene, key));
      this.bgImage.setDisplaySize(this.visualW, this.visualH);
      this.bgImage.setTint(this.paletteColor);
    } else if (this.bgImage) {
      // only a -normal texture shipped: derive hover/pressed/disabled by shading the palette color
      this.bgImage.setTint(shade(this.paletteColor, STATE_SHADE[state]));
    } else if (this.bgRect) {
      const alpha = state === 'disabled' ? 0.4 : state === 'hover' ? 1 : 0.9;
      this.bgRect.setAlpha(alpha);
    }
  }

  setEnabled(on: boolean): this {
    this.enabledState = on;
    this.setBtnTexture(on ? 'normal' : 'disabled');
    this.setAlpha(on ? 1 : 0.75);
    if (this.bgRect) this.bgRect.setAlpha(on ? 0.9 : 0.35);
    return this;
  }

  setLabel(text: string): this {
    this.txt.setText(text);
    return this;
  }

  /** Gold ring overlay marking a "chosen" state (e.g. the active player-count chip) — independent of hover/pressed/disabled. */
  setSelected(on: boolean): this {
    if (on && !this.selectedRing) {
      this.selectedRing = this.scene.add
        .rectangle(0, 0, this.width + 6, this.height + 6)
        .setStrokeStyle(2, 0xf7d23e, 1);
      this.addAt(this.selectedRing, 0);
    } else if (!on && this.selectedRing) {
      this.selectedRing.destroy();
      this.selectedRing = undefined;
    }
    return this;
  }

  private showTooltip(text: string, h: number): void {
    this.hideTooltip();
    const scene = this.scene;
    const ty = this.y - h / 2 - 8;
    const txt = label(scene, this.x, ty, text, 6, '#f7f2e7').setDepth(1000);
    const w = txt.width + 6;
    const bg = scene.add.rectangle(this.x, ty, w, txt.height + 3, 0x1a1410, 0.9).setDepth(999);
    this.tooltipGfx = [bg, txt];
  }

  private hideTooltip(): void {
    this.tooltipTimer?.remove();
    this.tooltipTimer = null;
    for (const g of this.tooltipGfx) g.destroy();
    this.tooltipGfx = [];
  }
}
