import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { t } from '../localization/i18n';
import { coverBackground, cx, cy, panelW, vy, woodPanel } from '../ui/menu-layout';
import { openSettingsPanel } from '../ui/settings-panel';
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
  /** Replay-seed row is a testing affordance, not a player-facing one — collapsed behind ADVANCED. */
  private advancedOpen = false;

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
    this.tweens.killAll();
    this.children.removeAll(true);
    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.4);
    woodPanel(this, cx(), vy(154), panelW(260), vy(220));

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
    // Everything below the seat list hangs off where that list actually ends, so a 4-player
    // lineup doesn't push the summary under the Back/Play row (2 players left a dead gap instead).
    const belowSeats = rowY0 + this.seatCount * rowGap;
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
        const av = this.add.image(avatarX, y, avatarKey).setName(`avatar-seat-${seat}`).setDisplaySize(20, 20).setInteractive({ useHandCursor: true });
        const nameLabel = label(this, nameX, y, entry.name, 8, '#f7f2e7').setOrigin(0, 0.5);
        const cycle = (): void => {
          const idx = CYCLE.indexOf(this.aiPersonalities[seat - 1]!);
          this.aiPersonalities[seat - 1] = CYCLE[(idx + 1) % CYCLE.length]!;
          this.rebuild();
          // Rebuild already redrew the avatar at its normal (setDisplaySize) scale — grab it and
          // pop it in from smaller, so a cycle doesn't happen silently. Instant under reduced
          // motion (motionScale() floors the duration at 1ms, same pattern as every other tween
          // in this codebase).
          const fresh = this.children.getByName(`avatar-seat-${seat}`) as Phaser.GameObjects.Image | undefined;
          if (fresh) {
            const [toX, toY] = [fresh.scaleX, fresh.scaleY];
            fresh.setScale(toX * 0.6, toY * 0.6);
            this.tweens.add({ targets: fresh, scaleX: toX, scaleY: toY, duration: Math.max(1, 180 * settings.motionScale()), ease: 'Back.out' });
          }
        };
        av.on('pointerup', cycle);
        nameLabel.setInteractive({ useHandCursor: true }).on('pointerup', cycle);
      }
    }

    // One shared "tap to change" hint under the whole seat list instead of one per AI row: the
    // repeated per-row copy was the busiest text on the screen and said the same thing 3x.
    if (this.seatCount > 1) {
      label(this, cx(), vy(belowSeats - 12), t('setup.tapToChange'), 8, '#a89e8c');
    }

    // Match summary — what pressing PLAY will actually start, in one line.
    const names = this.aiPersonalities
      .slice(0, this.seatCount - 1)
      .map((p) => AI_LINEUP.find((a) => a.personality === p)!.name)
      .join(', ');
    label(
      this,
      cx(),
      vy(belowSeats + 6),
      t('setup.summary', { n: this.seatCount, names: `${t('menu.you')} vs ${names}` }),
      8,
      '#f0e8d8',
    );

    const lastSeed = settings.progress().lastSeed;
    if (lastSeed !== null) {
      new PixelButton(this, cx(), vy(belowSeats + 22), this.advancedOpen ? t('setup.advancedHide') : t('setup.advanced'), () => {
        this.advancedOpen = !this.advancedOpen;
        this.rebuild();
      }, { textureBase: 'btn-comprar', w: 90, h: 13, size: 6, color: 0x8a7f68 });
      if (this.advancedOpen) {
        new PixelButton(this, cx(), vy(belowSeats + 36), t('setup.lastSeed', { seed: lastSeed }), () => this.startGame(lastSeed), {
          textureBase: 'btn-comprar', w: 220, h: 13, size: 6, color: 0x8a7f68,
        });
      }
    }

    new PixelButton(this, cx() + (170 - 240), vy(248), t('setup.back'), () => gotoScene(this, 'menu'), {
      textureBase: 'btn-comprar', w: 80, h: 20, size: 9,
    });
    new PixelButton(this, cx() + (300 - 240), vy(248), t('menu.play'), () => this.startGame(), {
      textureBase: 'btn-feito', w: 100, h: 24, size: 9,
    });

    // Same corner MenuScene uses — language/settings are reachable here too, without backing
    // out to the menu and losing the seat/personality picks made on this screen.
    new PixelButton(this, view().w - 18, 10, '⚙', () => openSettingsPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.settings'),
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
