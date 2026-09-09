import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { t } from '../localization/i18n';
import { coverBackground, cx, cy, panelW, vy } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi, urlSeed } from '../verification/debug-api';
import type { GameSceneConfig } from './GameScene';

const AI_LINEUP: { name: string; personality: 'cida' | 'juninho' | 'bia' | 'ze' }[] = [
  { name: 'Dona Cida', personality: 'cida' },
  { name: 'Juninho', personality: 'juninho' },
  { name: 'Bia', personality: 'bia' },
  { name: 'Seu Zé', personality: 'ze' },
];
const CYCLE: (typeof AI_LINEUP[number]['personality'])[] = ['cida', 'juninho', 'bia', 'ze'];

/** Seat/personality picker: seat 0 is always the human, seats 1..count-1 cycle AI personalities on tap. */
export class SetupScene extends Phaser.Scene {
  private seatCount = 2;
  private aiPersonalities: (typeof AI_LINEUP[number]['personality'])[] = ['juninho', 'bia', 'ze'];

  constructor() {
    super('setup');
  }

  create(): void {
    setMusicContext('menu');
    debugApi.scene = 'setup';
    // No live connection here (unlike OnlineScene) — a full restart on orientation flip is
    // simplest and correct.
    const unsub = bus.on('viewport:changed', () => this.scene.restart());
    this.events.once('shutdown', unsub);
    this.rebuild();
    debugApi.ready = true;
  }

  private rebuild(): void {
    this.children.removeAll();
    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.4);
    this.add.rectangle(cx(), vy(145), panelW(260), vy(210), 0x1a0f0a, 0.68).setStrokeStyle(1, 0xc0a878, 0.6);

    label(this, cx(), vy(54), t('setup.title'), 12, '#f7d23e');

    [2, 3, 4].forEach((n, i) => {
      const btn = new PixelButton(this, cx() + (190 + i * 50 - 240), vy(74), String(n), () => {
        this.seatCount = n;
        this.rebuild();
      }, { textureBase: 'btn-small', w: 30, h: 20, size: 9 });
      btn.setSelected(n === this.seatCount);
    });

    const rowY0 = 98;
    const rowGap = 30;
    for (let seat = 0; seat < this.seatCount; seat++) {
      const y = vy(rowY0 + seat * rowGap);
      const avatarX = cx() + (150 - 240);
      const nameX = cx() + (190 - 240);
      if (seat === 0) {
        this.add.image(avatarX, y, 'avatar-player').setDisplaySize(20, 20);
        label(this, nameX, y, t('menu.you'), 8, '#f7d23e').setOrigin(0, 0.5);
      } else {
        const p = this.aiPersonalities[seat - 1]!;
        const entry = AI_LINEUP.find((a) => a.personality === p)!;
        const avatarKey = `avatar-${p}`;
        const av = this.add.image(avatarX, y, avatarKey).setDisplaySize(20, 20).setInteractive({ useHandCursor: true });
        const nameLabel = label(this, nameX, y, entry.name, 8, '#f7f2e7').setOrigin(0, 0.5);
        label(this, nameX, y + 10, t('setup.tapToChange'), 8, '#a89e8c').setOrigin(0, 0.5);
        const cycle = (): void => {
          const idx = CYCLE.indexOf(this.aiPersonalities[seat - 1]!);
          this.aiPersonalities[seat - 1] = CYCLE[(idx + 1) % CYCLE.length]!;
          this.rebuild();
        };
        av.on('pointerup', cycle);
        nameLabel.setInteractive({ useHandCursor: true }).on('pointerup', cycle);
      }
    }

    const lastSeed = settings.progress().lastSeed;
    if (lastSeed !== null) {
      new PixelButton(this, cx(), vy(222), t('setup.lastSeed', { seed: lastSeed }), () => this.startGame(lastSeed), {
        textureBase: 'btn-comprar', w: 220, h: 14, size: 6,
      });
    }

    new PixelButton(this, cx() + (170 - 240), vy(240), t('setup.back'), () => gotoScene(this, 'menu'), {
      textureBase: 'btn-comprar', w: 80, h: 20, size: 9,
    });
    new PixelButton(this, cx() + (300 - 240), vy(240), t('menu.play'), () => this.startGame(), {
      textureBase: 'btn-feito', w: 100, h: 24, size: 9,
    });
  }

  private startGame(seed = urlSeed()): void {
    const ais = this.aiPersonalities.slice(0, this.seatCount - 1);
    const config: GameSceneConfig = {
      seed,
      players: [
        { name: t('menu.you'), isAi: false },
        ...ais.map((p) => ({ name: AI_LINEUP.find((a) => a.personality === p)!.name, isAi: true, personality: p })),
      ],
    };
    gotoScene(this, 'game', config);
  }
}
