import Phaser from 'phaser';
import { SUITS } from '../rules/types';
import { rankLabel } from './fallbacks';

/**
 * Composes the 52 card faces from PixelLab-generated parts: blank card face +
 * suit pips + pixel font ranks. Guarantees readable, consistent ranks —
 * AI-generating 52 full faces would scramble glyphs.
 * Canvas is 48x64 (2x logical 24x32) for crisp downscale-free display.
 */
export function composeCardFaces(scene: Phaser.Scene, fontFamily: string): void {
  if (!scene.textures.exists('card-blank')) return;
  const blank = scene.textures.get('card-blank').getSourceImage() as HTMLImageElement;

  for (const suit of SUITS) {
    const pipKey = `suit-${suit}`;
    if (!scene.textures.exists(pipKey)) return;
    const pip = scene.textures.get(pipKey).getSourceImage() as HTMLImageElement;
    const dark = suit === 'clubs' || suit === 'spades';
    const color = suit === 'hearts' ? '#c22a2a' : suit === 'diamonds' ? '#d8701e' : '#2b2b33';

    for (let rank = 1; rank <= 13; rank++) {
      const key = `card-${suit}-${rank}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, 48, 64)!;
      const ctx = tex.getContext();
      ctx.imageSmoothingEnabled = false;
      // opaque cream body first — the PixelLab blank may have transparent fill
      ctx.fillStyle = '#f7f2e7';
      ctx.beginPath();
      ctx.roundRect(1, 1, 46, 62, 4);
      ctx.fill();
      ctx.drawImage(blank, 0, 0, blank.width, blank.height, 0, 0, 48, 64);
      ctx.strokeStyle = '#8a7a5e';
      ctx.beginPath();
      ctx.roundRect(1.5, 1.5, 45, 61, 4);
      ctx.stroke();
      // rank, top-left, large for 1080p readability
      ctx.fillStyle = color;
      ctx.font = `24px "${fontFamily}", monospace`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const lbl = rankLabel(rank);
      ctx.fillText(lbl, 4, 4, rank === 10 ? 24 : 20);
      // small pip top-right
      ctx.drawImage(pip, 0, 0, pip.width, pip.height, 32, 5, 12, 12);
      // big pip bottom-center
      ctx.drawImage(pip, 0, 0, pip.width, pip.height, 13, 34, 22, 22);
      // court cards get a subtle crown/frame band to distinguish at a glance
      if (rank > 10) {
        ctx.strokeStyle = dark ? '#2b2b3355' : `${color}55`;
        ctx.strokeRect(3.5, 3.5, 41, 57);
      }
      tex.refresh();
    }
  }
}

/** Loads the PixelLab TTF if present; resolves with the family name to use. */
export async function loadPixelFont(): Promise<string> {
  const FALLBACK = 'monospace';
  try {
    const res = await fetch('assets/ui/font.ttf', { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || type.includes('html')) return FALLBACK;
    const face = new FontFace('MexePixel', 'url(assets/ui/font.ttf)');
    await face.load();
    document.fonts.add(face);
    return 'MexePixel';
  } catch {
    return FALLBACK;
  }
}

export let PIXEL_FONT = 'monospace';
export function setPixelFont(f: string): void {
  PIXEL_FONT = f;
}
