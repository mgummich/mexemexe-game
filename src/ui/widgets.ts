import Phaser from 'phaser';
import { playSfx } from '../audio/sfx';
import { PIXEL_FONT } from '../assets/compose-cards';
import { settings } from '../core/settings';
import { ACTION, CHROME_GOLD, fitTextScale, LAYER, SURFACE, TEXT, TOUCH_TARGET } from './tokens';
import { view } from './viewport';

/** Nothing user-facing renders below this (logical px, pre large-text scale) — small pixel-font glyphs turn to mush once upscaled to 720p/1080p. */
const MIN_FONT_SIZE = 8;

/** Edge of the flat rectangle a PixelButton falls back to when its wood texture is missing. Not a
 * token: nothing else draws this shape, and it only ever appears when art failed to load. */
const PLATE_EDGE = 0x1a1a22;

/**
 * Cap-height of the pixel font as a fraction of its font size (measured from font.ttf:
 * uppercase ink spans 16px above the baseline at 32px).
 */
const CAP_RATIO = 0.5;

/** Single choke point for text sizing — every label/button/panel routes through this, so the "large text" setting scales the whole UI at once. */
export function fontStyle(size: number, color: string = TEXT.primary): Phaser.Types.GameObjects.Text.TextStyle {
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
  color: string = TEXT.primary,
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

interface PixelButtonOpts {
  textureBase?: string; // e.g. 'btn-feito' → uses -normal/-hover/-pressed/-disabled
  w?: number;
  h?: number;
  size?: number;
  /**
   * Palette color. For the texture-missing rect fallback this is the fill color (default green
   * wood `ACTION.primary`). For a real wooden button texture this is a multiply-tint applied on
   * top of the art (default `ACTION.native` = the texture's own color, e.g. feito/comprar's
   * green wood) —
   * pass a tan tone for secondary buttons or a red tone for danger buttons.
   */
  color?: number;
  /** Small dark label shown above the button 400ms after hover starts. */
  tooltip?: string;
  /** N8: side the tooltip opens on. Default 'above' can occlude a control sitting right above the
   * button (e.g. reset sitting under DRAW/COMPRAR) — pass 'below' there. */
  tooltipSide?: 'above' | 'below';
  /**
   * Main call-to-action of its screen: lifts further on hover, presses deeper, and pops back on
   * release, so it outweighs the secondary buttons beside it. Purely a feel difference — the
   * click fires at exactly the same moment either way.
   */
  primary?: boolean;
  /** Fires when the button is tapped/clicked while disabled — no sfx, no onClick, just this. */
  onBlocked?: () => void;
}

/** Multiplies an RGB color by a brightness factor, clamped — used to derive hover/pressed/disabled shades from one base palette color. */
function shade(hex: number, factor: number): number {
  const c = Phaser.Display.Color.ValueToColor(hex);
  const clamp = (v: number) => Phaser.Math.Clamp(Math.round(v * factor), 0, 255);
  return Phaser.Display.Color.GetColor(clamp(c.red), clamp(c.green), clamp(c.blue));
}

const STATE_SHADE: Record<'normal' | 'hover' | 'pressed' | 'disabled', number> = {
  normal: 1,
  hover: 1.18,
  pressed: 0.78,
  disabled: 0.5,
};

const INK_FRAME = 'ink';

/** R9: every live PixelButton, so a tooltip can check whether its default side would sit on top of
 * another *enabled* control instead of that being a hardcoded per-button constant (N8's original
 * fix only covered the reset button — everything else still risked covering a neighbour). */
const liveButtons = new Set<PixelButton>();

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
    liveButtons.add(this);
    this.on('destroy', () => liveButtons.delete(this));
    const w = opts.w ?? 56;
    const h = opts.h ?? 20;
    this.visualW = w;
    this.visualH = h;
    this.base = opts.textureBase;
    this.paletteColor = opts.color ?? ACTION.native;
    if (this.base && scene.textures.exists(`${this.base}-normal`)) {
      const key = `${this.base}-normal`;
      this.bgImage = scene.add.image(0, 0, key, inkFrame(scene, key)).setDisplaySize(w, h);
      this.add(this.bgImage);
    } else {
      this.bgRect = scene.add.rectangle(0, 0, w, h, opts.color ?? ACTION.primary).setStrokeStyle(1, PLATE_EDGE);
      this.add(this.bgRect);
    }
    this.txt = label(scene, 0, 0, text, opts.size ?? 8);
    this.fitLabel();
    this.add(this.txt);
    // Coarse pointer: grow the hit box past the artwork so a touch target never shrinks below a
    // usable size — the art itself (visualW/visualH) stays exactly w x h either way.
    const touch = view().touch;
    this.setSize(touch ? Math.max(w, TOUCH_TARGET.w) : w, touch ? Math.max(h, TOUCH_TARGET.h) : h);
    this.setInteractive({ useHandCursor: true });
    this.setBtnTexture('normal'); // apply palette tint immediately, not just on first hover

    const hoverScale = opts.primary ? 1.05 : 1;
    const pressScale = opts.primary ? 0.9 : 0.94;
    this.on('pointerover', () => {
      if (!this.enabledState) return;
      this.setBtnTexture('hover');
      this.setScale(hoverScale);
    });
    this.on('pointerout', () => {
      if (!this.enabledState) return;
      this.setBtnTexture('normal');
      this.setScale(1);
    });
    if (opts.tooltip) {
      const side = opts.tooltipSide ?? 'above';
      this.on('pointerover', () => {
        // C1: a disabled button already answers hover-in with its blocking reason text elsewhere
        // on screen (see onBlocked/touch path above) — showing "Confirm your move" over that text
        // on hover reads as a lie and can visually cover the reason line itself.
        if (!this.enabledState) return;
        this.tooltipTimer = scene.time.delayedCall(400, () => this.showTooltip(opts.tooltip!, h, side));
      });
      this.on('pointerout', () => this.hideTooltip());
      this.on('destroy', () => this.hideTooltip());
      if (touch) {
        // no hover on touch — show on tap instead, and auto-hide since there's no pointerout to close it.
        // Skipped while disabled: a disabled button's tap already answers with its blocking reason
        // (see onBlocked), and "Confirm your move" next to "you can't confirm yet" reads as a lie.
        this.on('pointerdown', () => {
          if (!this.enabledState) return;
          this.showTooltip(opts.tooltip!, h, side);
          this.tooltipTimer = scene.time.delayedCall(2500, () => this.hideTooltip());
        });
      }
    }
    this.on('pointerdown', () => {
      if (!this.enabledState) return;
      this.setBtnTexture('pressed');
      this.setScale(pressScale);
    });
    this.on('pointerup', () => {
      if (!this.enabledState) {
        opts.onBlocked?.();
        return;
      }
      this.setBtnTexture('hover');
      this.setScale(hoverScale);
      // A primary button springs back instead of snapping, so the press reads as impact. The
      // click still fires on this same frame — the pop plays over whatever happens next.
      const pop = opts.primary ? Math.round(140 * settings.motionScale()) : 0;
      if (pop > 0) {
        this.setScale(pressScale);
        scene.tweens.add({ targets: this, scale: hoverScale, duration: pop, ease: 'Back.out' });
      }
      playSfx(scene, 'sfx-click', opts.primary ? 0.55 : 0.4);
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

  /**
   * Fire this button as if it had been tapped — the keyboard path (see OnlineScene's focus ring).
   * Deliberately re-emits `pointerup` instead of calling the click handler: a keyboard press then
   * gets the same sound, the same press-and-pop, and the same `onBlocked` refusal a pointer does,
   * because it goes through the one handler rather than a parallel copy of it.
   */
  press(): this {
    this.emit('pointerup');
    return this;
  }

  setLabel(text: string): this {
    this.txt.setText(text);
    this.fitLabel();
    return this;
  }

  /** Re-apply the fit rule after the caption changed — a label set later (FEITO becoming BATER,
   * a re-rendered lobby row) is just as translatable as the one passed to the constructor. */
  private fitLabel(): void {
    this.txt.setScale(fitTextScale(this.txt.width, this.visualW));
  }

  /** The text on the button, for a caller that needs to say *which* button it means — the
   * keyboard focus ring's verification surface, where an index is only meaningful until the
   * next layout change. */
  labelText(): string {
    return this.txt.text;
  }

  /** Gold ring overlay marking a "chosen" state (e.g. the active player-count chip) — independent of hover/pressed/disabled. */
  setSelected(on: boolean): this {
    if (on && !this.selectedRing) {
      this.selectedRing = this.scene.add
        .rectangle(0, 0, this.width + 6, this.height + 6)
        .setStrokeStyle(2, CHROME_GOLD, 1);
      this.addAt(this.selectedRing, 0);
    } else if (!on && this.selectedRing) {
      this.selectedRing.destroy();
      this.selectedRing = undefined;
    }
    return this;
  }

  /** R9: true if a box of this size centred at (cx, cy) would sit on top of another *enabled*
   * live button — "would cover an enabled control", not a hardcoded per-button side. */
  private overlapsEnabledControl(cx: number, cy: number, w: number, h: number): boolean {
    const box = new Phaser.Geom.Rectangle(cx - w / 2, cy - h / 2, w, h);
    for (const btn of liveButtons) {
      if (btn === this || !btn.enabledState || !btn.visible) continue;
      const other = new Phaser.Geom.Rectangle(btn.x - btn.width / 2, btn.y - btn.height / 2, btn.width, btn.height);
      if (Phaser.Geom.Rectangle.Overlaps(box, other)) return true;
    }
    return false;
  }

  private showTooltip(text: string, h: number, preferredSide: 'above' | 'below' = 'above'): void {
    this.hideTooltip();
    const scene = this.scene;
    const boxAt = (side: 'above' | 'below'): number => (side === 'below' ? this.y + h / 2 + 8 : this.y - h / 2 - 8);
    // Measure first (text width decides box width), same as GameScene.showGhostPreview's clamp.
    const probe = label(scene, this.x, 0, text, 6, TEXT.primary);
    const boxW = probe.width + 6;
    const boxH = probe.height + 3;
    probe.destroy();
    // R9: flip off the preferred side only when it would actually sit on top of another enabled
    // control (e.g. DRAW/COMPRAR sitting right above RESET) — a rule evaluated against every live
    // button's current position, not a per-button opt-in that only reset ever got.
    const other: 'above' | 'below' = preferredSide === 'below' ? 'above' : 'below';
    const side = this.overlapsEnabledControl(this.x, boxAt(preferredSide), boxW, boxH) && !this.overlapsEnabledControl(this.x, boxAt(other), boxW, boxH) ? other : preferredSide;
    const ty = boxAt(side);
    // Clamp inside the world bounds — a button near the right/bottom edge (e.g. the reset toggle)
    // would otherwise centre a long tooltip past the visible edge.
    const { w: worldW, h: worldH } = view();
    const tx = Phaser.Math.Clamp(this.x, boxW / 2 + 2, worldW - boxW / 2 - 2);
    const tyClamped = Phaser.Math.Clamp(ty, boxH / 2 + 2, worldH - boxH / 2 - 2);
    const txt = label(scene, tx, tyClamped, text, 6, TEXT.primary).setDepth(LAYER.tooltipText);
    const bg = scene.add.rectangle(tx, tyClamped, boxW, boxH, SURFACE.overlay, 0.9).setDepth(LAYER.tooltip);
    this.tooltipGfx = [bg, txt];
  }

  private hideTooltip(): void {
    this.tooltipTimer?.remove();
    this.tooltipTimer = null;
    for (const g of this.tooltipGfx) g.destroy();
    this.tooltipGfx = [];
  }
}
