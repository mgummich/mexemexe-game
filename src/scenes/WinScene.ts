import Phaser from 'phaser';
import { t } from '../localization/i18n';
import { label, PixelButton } from '../ui/widgets';
import { debugApi } from '../verification/debug-api';
import type { GameSceneConfig } from './GameScene';

interface PlayerResult {
  name: string;
  cardsLeft: number;
  isWinner: boolean;
  avatarKey: string;
}

interface WinData {
  winnerName: string;
  stalemate: boolean;
  config: GameSceneConfig;
  results?: PlayerResult[];
}

export class WinScene extends Phaser.Scene {
  constructor() {
    super('win');
  }

  create(data: WinData): void {
    debugApi.scene = 'win';
    this.add.image(240, 135, 'bg-boteco').setDisplaySize(480, 270);
    this.add.rectangle(240, 135, 480, 270, 0x1a0f0a, 0.55);
    const banner = this.add.image(240, 90, 'banner-victory');
    this.tweens.add({ targets: banner, scale: { from: 0.6, to: 1 }, duration: 300, ease: 'Back.out' });
    label(this, 240, 88, t('win.title'), 24, '#f7d23e');
    label(
      this,
      240,
      148,
      data.stalemate ? t('win.stalemate', { name: data.winnerName }) : t('win.wins', { name: data.winnerName }),
      11,
    );

    // sparkle burst
    for (let i = 0; i < 14; i++) {
      const s = this.add.image(240, 90, 'sparkle').setDisplaySize(8, 8);
      const angle = (i / 14) * Math.PI * 2;
      this.tweens.add({
        targets: s,
        x: 240 + Math.cos(angle) * (60 + (i % 3) * 25),
        y: 90 + Math.sin(angle) * (40 + (i % 3) * 18),
        alpha: 0,
        duration: 700 + (i % 4) * 150,
        onComplete: () => s.destroy(),
      });
    }

    this.renderResults(data.results ?? []);

    new PixelButton(this, 240, 195, t('win.replaySame'), () => this.scene.start('game', data.config), {
      textureBase: 'btn-feito', w: 130, h: 20, size: 8,
    });
    new PixelButton(this, 240, 220, t('win.newSeed'), () => {
      const newConfig = { ...data.config, seed: Date.now() % 2147483647 };
      this.scene.start('game', newConfig);
    }, { textureBase: 'btn-comprar', w: 130, h: 18, size: 7 });
    new PixelButton(this, 240, 245, t('win.menu'), () => this.scene.start('menu'), {
      textureBase: 'btn-comprar', w: 130, h: 18, size: 7,
    });
  }

  /** Compact per-player results row: avatar, name, cards remaining — winner picked out with a gold highlight. */
  private renderResults(results: PlayerResult[]): void {
    if (results.length === 0) return;
    const y = 168;
    const slotW = Math.min(96, 440 / results.length);
    const startX = 240 - ((results.length - 1) * slotW) / 2;
    results.forEach((r, i) => {
      const x = startX + i * slotW;
      if (r.isWinner) {
        this.add.rectangle(x, y, slotW - 6, 32, 0xf7d23e, 0.16).setStrokeStyle(1, 0xf7d23e, 0.9);
      }
      if (this.textures.exists(r.avatarKey)) this.add.image(x, y - 8, r.avatarKey).setDisplaySize(16, 16);
      label(this, x, y + 5, r.name, 8, r.isWinner ? '#f7d23e' : '#d8d0c0');
      label(this, x, y + 14, `x${r.cardsLeft}`, 8, r.isWinner ? '#f7d23e' : '#c0b8a8');
    });
  }
}
