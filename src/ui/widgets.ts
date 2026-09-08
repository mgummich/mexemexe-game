import Phaser from 'phaser';
import { playSfx } from '../audio/sfx';
import { PIXEL_FONT } from '../assets/compose-cards';
import { settings } from '../core/settings';

/** Nothing user-facing renders below this (logical px, pre large-text scale) — small pixel-font glyphs turn to mush once upscaled to 720p/1080p. */
const MIN_FONT_SIZE = 8;

/** Single choke point for text sizing — every label/button/panel routes through this, so the "large text" setting scales the whole UI at once. */
export function fontStyle(size: number, color = '#f7f2e7'): Phaser.Types.GameObjects.Text.TextStyle {
  const px = Math.max(size, MIN_FONT_SIZE) * settings.fontScale();
  return { fontFamily: `"${PIXEL_FONT}", monospace`, fontSize: `${Math.round(px)}px`, color, resolution: 4 };
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
    this.base = opts.textureBase;
    this.paletteColor = opts.color ?? 0xffffff;
    if (this.base && scene.textures.exists(`${this.base}-normal`)) {
      this.bgImage = scene.add.image(0, 0, `${this.base}-normal`).setDisplaySize(w, h);
      this.add(this.bgImage);
    } else {
      this.bgRect = scene.add.rectangle(0, 0, w, h, opts.color ?? 0x2e9e50).setStrokeStyle(1, 0x1a1a22);
      this.add(this.bgRect);
    }
    this.txt = label(scene, 0, 0, text, opts.size ?? 8);
    this.add(this.txt);
    this.setSize(w, h);
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
    }
    this.on('pointerdown', () => {
      if (!this.enabledState) return;
      this.setBtnTexture('pressed');
      this.setScale(0.94);
    });
    this.on('pointerup', () => {
      if (!this.enabledState) return;
      this.setBtnTexture('hover');
      this.setScale(1);
      playSfx(scene, 'sfx-click', 0.4);
      onClick();
    });
    scene.add.existing(this);
  }

  private setBtnTexture(state: 'normal' | 'hover' | 'pressed' | 'disabled'): void {
    if (this.bgImage && this.base && this.scene.textures.exists(`${this.base}-${state}`)) {
      this.bgImage.setTexture(`${this.base}-${state}`);
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
