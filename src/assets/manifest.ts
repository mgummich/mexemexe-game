import { SUITS } from '../rules/types';

export interface AssetDef {
  key: string;
  path: string;
  w: number; // logical display size
  h: number;
}

export const CARD_W = 24;
export const CARD_H = 32;

function def(key: string, path: string, w: number, h: number): AssetDef {
  return { key, path, w, h };
}

export function buildManifest(): AssetDef[] {
  const out: AssetDef[] = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      out.push(def(`card-${suit}-${rank}`, `assets/cards/${suit}-${rank}.png`, CARD_W, CARD_H));
    }
  }
  out.push(def('card-blank', 'assets/cards/blank.png', CARD_W, CARD_H));
  out.push(def('card-back-0', 'assets/cards/back-0.png', CARD_W, CARD_H));
  out.push(def('card-back-1', 'assets/cards/back-1.png', CARD_W, CARD_H));
  out.push(def('card-back-2', 'assets/cards/back-2.png', CARD_W, CARD_H));
  out.push(def('card-back-3', 'assets/cards/back-3.png', CARD_W, CARD_H));
  out.push(def('bg-boteco', 'assets/tables/boteco.png', 480, 270));
  out.push(def('bg-kitchen', 'assets/tables/kitchen.png', 480, 270));
  out.push(def('bg-menu', 'assets/tables/menu.png', 480, 270));
  out.push(def('logo', 'assets/ui/logo.png', 200, 80));
  for (const name of ['cida', 'juninho', 'bia', 'ze']) {
    out.push(def(`avatar-${name}`, `assets/characters/avatar-${name}.png`, 24, 24));
  }
  out.push(def('avatar-player', 'assets/characters/avatar-player.png', 24, 24));
  // hover/pressed/disabled derive from -normal via runtime tint (PixelButton)
  out.push(def('btn-feito-normal', 'assets/ui/feito-normal.png', 56, 20));
  out.push(def('btn-comprar-normal', 'assets/ui/comprar-normal.png', 56, 20));
  out.push(def('btn-small-normal', 'assets/ui/btn-small-normal.png', 18, 18));
  out.push(def('panel', 'assets/ui/panel.png', 48, 48));
  out.push(def('banner-victory', 'assets/ui/banner-victory.png', 160, 48));
  out.push(def('emote-bubble', 'assets/ui/emote-bubble.png', 20, 18));
  for (const name of ['excited', 'thinking', 'annoyed', 'happy']) {
    out.push(def(`emote-${name}`, `assets/ui/emote-${name}.png`, 12, 12));
  }
  out.push(def('prop-dominoes', 'assets/tables/prop-dominoes.png', 32, 24));
  out.push(def('sparkle', 'assets/effects/sparkle.png', 8, 8));
  for (const suit of SUITS) {
    out.push(def(`suit-${suit}`, `assets/ui/suit-${suit}.png`, 8, 8));
  }
  for (const icon of ['drag', 'meld', 'draw', 'win']) {
    out.push(def(`tut-${icon}`, `assets/ui/tut-${icon}.png`, 16, 16));
  }
  return out;
}

export const AUDIO_ASSETS: { key: string; path: string }[] = [
  { key: 'sfx-pickup', path: 'assets/audio/pickup.wav' },
  { key: 'sfx-drop', path: 'assets/audio/drop.wav' },
  { key: 'sfx-snap', path: 'assets/audio/snap.wav' },
  { key: 'sfx-deal', path: 'assets/audio/deal.wav' },
  { key: 'sfx-feito', path: 'assets/audio/feito.wav' },
  { key: 'sfx-draw', path: 'assets/audio/draw.wav' },
  { key: 'sfx-win', path: 'assets/audio/win.wav' },
  { key: 'sfx-invalid', path: 'assets/audio/invalid.wav' },
  { key: 'sfx-click', path: 'assets/audio/click.wav' },
  { key: 'ambience', path: 'assets/audio/ambience.wav' },
];
