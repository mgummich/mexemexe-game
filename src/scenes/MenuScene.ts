import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { getLocale, setLocale, t } from '../localization/i18n';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { isOffline, onConnectivityChange } from '../core/pwa';
import { openRulesPanel } from '../ui/rules-panel';
import { openSettingsPanel } from '../ui/settings-panel';
import { coverBackground, cx, cy, panelW, vy } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi, urlSeed } from '../verification/debug-api';

export class MenuScene extends Phaser.Scene {
  private onlineBtn?: PixelButton;

  constructor() {
    super('menu');
  }

  create(): void {
    setMusicContext('menu');
    debugApi.scene = 'menu';
    debugApi.online = null; // local menu/game must work with the online server down or absent
    debugApi.results = null;
    debugApi.winButtonY = null;
    setLocale(settings.get().locale);
    // No live connection here (unlike OnlineScene) — a full restart on orientation flip is
    // simplest and correct.
    const unsub = bus.on('viewport:changed', () => this.scene.restart());
    this.events.once('shutdown', unsub);
    // Connectivity only affects the ONLINE button, so just flip its enabled state — no need for
    // a full rebuild/restart the way an orientation flip needs.
    const unsubConn = onConnectivityChange(() => this.onlineBtn?.setEnabled(!isOffline()));
    this.events.once('shutdown', unsubConn);
    this.rebuild();
    this.markReady();
    const showcase = debugApi.showcase;
    if (showcase === 'win') {
      this.scene.start('win', {
        winnerName: t('menu.you'),
        stalemate: false,
        config: { seed: urlSeed(), players: [{ name: t('menu.you'), isAi: false }, { name: 'Juninho', isAi: true, personality: 'juninho' as const }] },
        winningMoveText: t('game.lastMove.played', { name: t('menu.you'), n: 2 }),
        results: [
          { name: t('menu.you'), cardsLeft: 0, isWinner: true, avatarKey: 'avatar-player' },
          { name: 'Juninho', cardsLeft: 4, isWinner: false, avatarKey: 'avatar-juninho', personality: 'juninho' as const },
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

  /** Multiplies cosmetic tween durations; 0 (instant) when reduced motion is on. */
  private motion(ms: number): number {
    return ms * settings.motionScale();
  }

  private rebuild(): void {
    this.children.removeAll();
    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.35);
    // backdrop so controls read against the busy boteco scene
    // wide enough to actually contain the rules/language row (x 146..334) and the online button
    this.add.rectangle(cx(), vy(184), panelW(204), vy(168), 0x1a0f0a, 0.62).setStrokeStyle(1, 0xc0a878, 0.6);
    if (this.textures.exists('logo') && !debugApi.missingAssets.includes('logo')) {
      // logo.png ships at 3x (600x240) like every other sprite — pin it to its logical size
      const logo = this.add.image(cx(), vy(62), 'logo').setDisplaySize(200, 80);
      // idle bob so the title screen doesn't sit dead still — instant (no tween) under reduced motion
      this.tweens.add({ targets: logo, y: '+=3', duration: Math.max(1, this.motion(1400)), yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    } else {
      const title = label(this, cx(), vy(52), t('menu.title'), 32, '#f7d23e');
      this.tweens.add({ targets: title, y: '+=3', duration: Math.max(1, this.motion(1400)), yoyo: true, repeat: -1, ease: 'Sine.inOut' });
      label(this, cx(), vy(84), t('menu.tagline'), 8, '#f7f2e7');
    }

    new PixelButton(this, cx(), vy(145), t('menu.play'), () => gotoScene(this, 'setup'), {
      textureBase: 'btn-feito', w: 90, h: 24, size: 10,
    });
    // kept at its original logical coords (240, 207) in landscape — e2e clicks this position directly
    new PixelButton(this, cx(), vy(207), t('menu.tutorial'), () => gotoScene(this, 'tutorial'), {
      textureBase: 'btn-comprar', w: 90, h: 20, size: 9,
    });

    new PixelButton(this, cx() + (182 - 240), vy(237), t('menu.rules'), () => openRulesPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-comprar', w: 72, h: 18, size: 6,
    });
    new PixelButton(this, cx() + (298 - 240), vy(237), t('menu.language'), () => {
      const next = getLocale() === 'pt' ? 'en' : 'pt';
      setLocale(next);
      settings.update({ locale: next });
      this.rebuild();
    }, { textureBase: 'btn-comprar', w: 72, h: 18, size: 6 });

    // anchored to the top-right corner, not the 480-wide landscape grid
    new PixelButton(this, view().w - 18, 10, '⚙', () => openSettingsPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.settings'),
    });

    // visually subordinate to JOGAR: smaller, muted, tucked below the rules/language row
    this.onlineBtn = new PixelButton(this, cx(), vy(258), t('menu.online'), () => gotoScene(this, 'online'), {
      textureBase: 'btn-comprar', w: 100, h: 13, size: 6, color: 0x8a7f68,
      onBlocked: () => this.flashOnlineBlocked(),
    });
    this.onlineBtn.setEnabled(!isOffline());
  }

  /** Transient reason line under ONLINE when it's tapped while offline — same "always say why"
   * pattern as GameScene's onFeitoBlocked, just local to this button since MenuScene has no
   * persistent reason-text widget. */
  private flashOnlineBlocked(): void {
    const el = label(this, cx(), vy(226), t('offline.online'), 6, '#ff6b5e');
    this.time.delayedCall(2000, () => el.destroy());
  }
}
