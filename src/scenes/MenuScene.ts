import Phaser from 'phaser';
import { getLocale, setLocale, t } from '../localization/i18n';
import { settings } from '../core/settings';
import { openRulesPanel } from '../ui/rules-panel';
import { openSettingsPanel } from '../ui/settings-panel';
import { label, PixelButton } from '../ui/widgets';
import { debugApi, urlSeed } from '../verification/debug-api';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create(): void {
    debugApi.scene = 'menu';
    debugApi.online = null; // local menu/game must work with the online server down or absent
    setLocale(settings.get().locale);
    this.rebuild();
    this.markReady();
    const showcase = debugApi.showcase;
    if (showcase === 'win') {
      this.scene.start('win', {
        winnerName: t('menu.you'),
        stalemate: false,
        config: { seed: urlSeed(), players: [{ name: t('menu.you'), isAi: false }, { name: 'Juninho', isAi: true, personality: 'juninho' as const }] },
        results: [
          { name: t('menu.you'), cardsLeft: 0, isWinner: true, avatarKey: 'avatar-player' },
          { name: 'Juninho', cardsLeft: 4, isWinner: false, avatarKey: 'avatar-juninho' },
        ],
      });
    } else if (showcase === 'setup') {
      this.scene.start('setup');
    } else if (showcase === 'settings') {
      openSettingsPanel(this, () => { /* left open for the screenshot */ });
    } else if (showcase && showcase !== 'menu') {
      // 'game' / 'game4' / 'mexe' — launch straight into GameScene for e2e/showcase captures
      this.startGame(showcase === 'game4' ? 4 : 2);
    }
  }

  private startGame(count: number): void {
    const all = [
      { name: 'Dona Cida', personality: 'cida' as const },
      { name: 'Juninho', personality: 'juninho' as const },
      { name: 'Bia', personality: 'bia' as const },
      { name: 'Seu Zé', personality: 'ze' as const },
    ];
    // e2e/showcase hook: ?ai=<personality> forces the single opponent in a 2-player showcase
    // game, so per-personality captures don't all default to Dona Cida.
    const forced = count === 2 ? all.find((a) => a.personality === new URLSearchParams(location.search).get('ai')) : undefined;
    const ais = forced ? [forced] : all.slice(0, count - 1);
    this.scene.start('game', {
      seed: urlSeed(),
      players: [{ name: t('menu.you'), isAi: false }, ...ais.map((a) => ({ name: a.name, isAi: true, personality: a.personality }))],
    });
  }

  private markReady(): void {
    debugApi.ready = true;
  }

  private rebuild(): void {
    this.children.removeAll();
    this.add.image(240, 135, 'bg-menu').setDisplaySize(480, 270);
    this.add.rectangle(240, 135, 480, 270, 0x1a0f0a, 0.35);
    // backdrop so controls read against the busy boteco scene
    this.add.rectangle(240, 180, 150, 160, 0x1a0f0a, 0.62).setStrokeStyle(1, 0xc0a878, 0.6);
    if (this.textures.exists('logo') && !debugApi.missingAssets.includes('logo')) {
      // logo.png ships at 3x (600x240) like every other sprite — pin it to its logical size
      this.add.image(240, 62, 'logo').setDisplaySize(200, 80);
    } else {
      label(this, 240, 52, t('menu.title'), 32, '#f7d23e');
      label(this, 240, 84, t('menu.tagline'), 8, '#f7f2e7');
    }

    new PixelButton(this, 240, 145, t('menu.play'), () => this.scene.start('setup'), {
      textureBase: 'btn-feito', w: 90, h: 24, size: 10,
    });
    // kept at its original logical coords (240, 207) — e2e clicks this position directly
    new PixelButton(this, 240, 207, t('menu.tutorial'), () => this.scene.start('tutorial'), {
      textureBase: 'btn-comprar', w: 90, h: 20, size: 9,
    });

    new PixelButton(this, 182, 237, t('menu.rules'), () => openRulesPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-comprar', w: 72, h: 18, size: 6,
    });
    new PixelButton(this, 298, 237, t('menu.language'), () => {
      const next = getLocale() === 'pt' ? 'en' : 'pt';
      setLocale(next);
      settings.update({ locale: next });
      this.rebuild();
    }, { textureBase: 'btn-comprar', w: 72, h: 18, size: 6 });

    new PixelButton(this, 462, 10, '⚙', () => openSettingsPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.settings'),
    });

    // visually subordinate to JOGAR: smaller, muted, tucked below the rules/language row
    new PixelButton(this, 240, 258, t('menu.online'), () => this.scene.start('online'), {
      textureBase: 'btn-comprar', w: 100, h: 13, size: 6, color: 0x8a7f68,
    });
  }
}
