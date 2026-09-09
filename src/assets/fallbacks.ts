import Phaser from 'phaser';
import { SUITS, type Suit } from '../rules/types';

/**
 * Procedural fallback textures, used only when a PixelLab asset fails to load.
 * Tracked in verification so final builds must ship real art.
 */

export const SUIT_COLOR: Record<Suit, number> = {
  hearts: 0xd82e2e,
  diamonds: 0xe07b28,
  clubs: 0x2b2b33,
  spades: 0x2b2b33,
};

export const SUIT_CHAR: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

export const RANK_LABEL: Record<number, string> = {
  1: 'A', 11: 'J', 12: 'Q', 13: 'K',
};

export function rankLabel(rank: number | null): string {
  if (rank === null) return '';
  return RANK_LABEL[rank] ?? String(rank);
}

function canvasFor(scene: Phaser.Scene, key: string, w: number, h: number): CanvasRenderingContext2D {
  const tex = scene.textures.createCanvas(key, w, h)!;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function refresh(scene: Phaser.Scene, key: string): void {
  (scene.textures.get(key) as Phaser.Textures.CanvasTexture).refresh();
}

export function makeFallback(scene: Phaser.Scene, key: string, w: number, h: number): void {
  if (key.startsWith('card-back')) return makeCardBack(scene, key, w, h);
  if (key === 'card-joker') return makeJokerFace(scene, key, w, h);
  if (key.startsWith('card-')) {
    const [, suit, rank] = key.split('-');
    return makeCardFace(scene, key, suit as Suit, Number(rank), w, h);
  }
  if (key.startsWith('bg-')) return makeBackground(scene, key, w, h);
  if (key.startsWith('avatar-')) return makeAvatar(scene, key, w, h);
  if (key.startsWith('btn-feito') || key.startsWith('btn-comprar')) return makeButton(scene, key, w, h);
  if (key.startsWith('suit-')) return makeSuitIcon(scene, key, key.split('-')[1] as Suit, w, h);
  return makeGeneric(scene, key, w, h);
}

function makeCardFace(scene: Phaser.Scene, key: string, suit: Suit, rank: number, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  ctx.fillStyle = '#f7f2e7';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#8a7a5e';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const color = suit === 'hearts' ? '#d82e2e' : suit === 'diamonds' ? '#e07b28' : '#2b2b33';
  ctx.fillStyle = color;
  ctx.font = 'bold 9px monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(rankLabel(rank), 2, 2);
  ctx.font = '10px monospace';
  ctx.fillText(SUIT_CHAR[suit], 2, 11);
  ctx.font = '12px monospace';
  ctx.fillText(SUIT_CHAR[suit], w - 12, h - 14);
  refresh(scene, key);
}

function makeJokerFace(scene: Phaser.Scene, key: string, w: number, h: number): void {
  // Purple body + gold star, not the cream rank-card look — reads as "wildcard" without text.
  const ctx = canvasFor(scene, key, w, h);
  ctx.fillStyle = '#3a1a5c';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#f7d23e';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = '#f7d23e';
  ctx.font = `bold ${Math.round(w * 0.4)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', w / 2, h * 0.4);
  ctx.font = `bold ${Math.max(5, Math.round(w * 0.22))}px monospace`;
  ctx.fillText('JOKER', w / 2, h * 0.82);
  refresh(scene, key);
}

function makeCardBack(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  const colors = ['#3a6ea5', '#a53a5e', '#3aa56e', '#a5823a'];
  const idx = Number(key.split('-')[2] ?? 0);
  ctx.fillStyle = colors[idx % colors.length]!;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#f7f2e7';
  ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let y = 4; y < h - 4; y += 4) {
    for (let x = 4 + (y % 8 === 0 ? 0 : 2); x < w - 4; x += 4) {
      ctx.fillRect(x, y, 2, 2);
    }
  }
  refresh(scene, key);
}

function makeBackground(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  ctx.fillStyle = key === 'bg-kitchen' ? '#5e4632' : '#4a3526';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 2, h);
  // center felt
  ctx.fillStyle = key === 'bg-kitchen' ? '#7a4a3a' : '#2e6b45';
  ctx.fillRect(16, 16, w - 32, h - 32);
  refresh(scene, key);
}

function makeAvatar(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  const palette: Record<string, string> = {
    'avatar-cida': '#b06ab0', 'avatar-juninho': '#d8622e', 'avatar-bia': '#2e9ed8',
    'avatar-ze': '#6b8e4e', 'avatar-player': '#d8b32e',
  };
  ctx.fillStyle = palette[key] ?? '#888888';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.floor(h * 0.6)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((key.split('-')[1] ?? '?')[0]!.toUpperCase(), w / 2, h / 2 + 1);
  refresh(scene, key);
}

function makeButton(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  const state = key.split('-')[2]!;
  const isFeito = key.includes('feito');
  const base = isFeito ? '#2e9e50' : '#d8892e';
  const map: Record<string, string> = {
    normal: base, hover: isFeito ? '#3ec06a' : '#f0a040',
    pressed: isFeito ? '#207038' : '#a86a20', disabled: '#6b6b6b',
  };
  ctx.fillStyle = map[state] ?? base;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  refresh(scene, key);
}

function makeSuitIcon(scene: Phaser.Scene, key: string, suit: Suit, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  ctx.fillStyle = suit === 'hearts' ? '#d82e2e' : suit === 'diamonds' ? '#e07b28' : '#2b2b33';
  ctx.font = `${h}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(SUIT_CHAR[suit], w / 2, h / 2);
  refresh(scene, key);
}

function makeGeneric(scene: Phaser.Scene, key: string, w: number, h: number): void {
  const ctx = canvasFor(scene, key, w, h);
  ctx.fillStyle = 'rgba(60,50,40,0.9)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c0a878';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  refresh(scene, key);
}

export { SUITS };
