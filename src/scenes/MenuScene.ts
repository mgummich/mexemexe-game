import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { getLocale, plural, setLocale, t } from '../localization/i18n';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { isOffline, onConnectivityChange } from '../core/pwa';
import { openRulesPanel } from '../ui/rules-panel';
import { openSettingsPanel } from '../ui/settings-panel';
import { coverBackground, cx, cy, panelW, vy, woodPanel } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi, urlSeed } from '../verification/debug-api';
import { ACTION, SURFACE, TEXT } from '../ui/tokens';

/** The boteco's string lights, as a screen-wide additive wash. Scene art (it belongs to the menu
 * painting behind it), not a chrome token a UI pass would re-point. */
const BULB_WASH = 0xffb35c;

export class MenuScene extends Phaser.Scene {
  private onlineBtn?: PixelButton;
  /** The ONLINE caption line — flashOnlineBlocked borrows its place for the refusal reason. */
  private onlineTag?: Phaser.GameObjects.Text;
  private ambience?: Phaser.Sound.BaseSound & { volume: number };

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
    this.startAmbience();
    this.events.once('shutdown', () => this.ambience?.stop());
    this.rebuild();
    this.markReady();
    const showcase = debugApi.showcase;
    if (showcase === 'win') {
      this.scene.start('win', {
        winnerName: t('menu.you'),
        stalemate: false,
        config: { seed: urlSeed(), players: [{ name: t('menu.you'), isAi: false }, { name: 'Juninho', isAi: true, personality: 'juninho' as const }] },
        winningMoveText: plural('game.lastMove.played', 2, { name: t('menu.you') }),
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

  /** The same boteco room tone GameScene runs, so the menu isn't a silent waiting room. */
  private startAmbience(): void {
    if (!this.cache.audio.exists('ambience')) return;
    try {
      this.ambience = this.sound.add('ambience', { loop: true, volume: settings.musicVolume() * 0.6 }) as Phaser.Sound.BaseSound & { volume: number };
      this.ambience.play();
    } catch {
      // audio blocked — silent no-op
    }
  }

  private rebuild(): void {
    this.tweens.killAll();
    // Idle/teaser/flicker timers from the previous build. The language button rebuilds in place,
    // so without this each toggle would stack another copy of every repeating timer.
    this.time.removeAllEvents();
    this.children.removeAll(true);
    // "First run" means nothing has been played yet, not just that the tutorial was skipped:
    // someone who went straight into a match and finished it already knows the big button is
    // JOGAR, and demoting it back to the lesson every visit reads as the menu forgetting them.
    const progress = settings.progress();
    const firstRun = !progress.tutorialCompleted && progress.gamesStarted === 0;

    coverBackground(this, 'bg-menu');
    this.add.rectangle(cx(), cy(), view().w, view().h, SURFACE.base, 0.35);
    this.addBulbFlicker();
    // Backdrop so controls read against the busy boteco scene. A near-transparent rectangle with
    // a hairline stroke (what this replaced) read as a debug overlay in playtests — this is a real warm wooden panel:
    // opaque fill, rounded corners, a tan edge plus a darker inner line for depth.
    // Wide enough to contain the rules/language row (x 146..334) and the online button.
    woodPanel(this, cx(), vy(200), panelW(212), vy(142));

    const brand: Phaser.GameObjects.GameObject[] = [];
    const tagline: Phaser.GameObjects.GameObject[] = [];
    if (this.textures.exists('logo') && !debugApi.missingAssets.includes('logo')) {
      // logo.png ships at 3x (600x240) like every other sprite — pin it to its logical size
      const logo = this.add.image(cx(), vy(62), 'logo').setDisplaySize(200, 80);
      brand.push(logo);
      this.idleBob(logo);
      // The tagline is the brand line, not a stand-in for a missing logo, so it belongs under the
      // real logo too — which is where the fallback branch always put it.
      tagline.push(label(this, cx(), vy(106), t('menu.tagline'), 8, TEXT.primary));
    } else {
      const title = label(this, cx(), vy(52), t('menu.title'), 32, TEXT.accent);
      brand.push(title);
      this.idleBob(title);
      tagline.push(label(this, cx(), vy(84), t('menu.tagline'), 8, TEXT.primary));
    }
    this.scheduleCardTeaser();

    // First run leads with the tutorial: a new player who presses the big green button should
    // land in the 3-minute lesson, not in a match whose rules they have not met. Once the
    // tutorial is done the pair swaps back, so a returning player's big button is JOGAR again.
    const primary: Phaser.GameObjects.GameObject[] = [];
    const secondary: Phaser.GameObjects.GameObject[] = [];
    const playDirect = (): void => gotoScene(this, 'setup');
    const learn = (): void => gotoScene(this, 'tutorial');
    primary.push(new PixelButton(
      this,
      cx(),
      vy(168),
      firstRun ? t('menu.learn') : t('menu.play'),
      firstRun ? learn : playDirect,
      { textureBase: 'btn-feito', w: firstRun ? 128 : 90, h: 24, size: firstRun ? 9 : 10, primary: true },
    ));
    if (firstRun) primary.push(label(this, cx(), vy(186), t('menu.learnTime'), 6, TEXT.muted));
    // kept at its original logical coords (240, 207) in landscape — e2e clicks this position directly
    secondary.push(new PixelButton(
      this,
      cx(),
      vy(207),
      firstRun ? t('menu.playDirect') : t('menu.tutorial'),
      firstRun ? playDirect : learn,
      { textureBase: 'btn-comprar', w: 90, h: 20, size: 9 },
    ));

    const utilities: Phaser.GameObjects.GameObject[] = [];
    utilities.push(new PixelButton(this, cx() + (182 - 240), vy(234), t('menu.rules'), () => openRulesPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-comprar', w: 72, h: 18, size: 6,
    }));
    utilities.push(new PixelButton(this, cx() + (298 - 240), vy(234), t('menu.language'), () => {
      const next = getLocale() === 'pt' ? 'en' : 'pt';
      setLocale(next);
      settings.update({ locale: next });
      this.rebuild();
    }, { textureBase: 'btn-comprar', w: 72, h: 18, size: 6 }));

    // anchored to the top-right corner, not the 480-wide landscape grid
    utilities.push(new PixelButton(this, view().w - 18, 10, '⚙', () => openSettingsPanel(this, () => { /* noop */ }), {
      textureBase: 'btn-small', w: 16, h: 14, size: 8, color: ACTION.icon, tooltip: t('tooltip.settings'),
    }));

    // Visually subordinate to JOGAR: smaller, muted, tucked below the rules/language row. The
    // alpha caveat rides as a small badge beside the button plus the caption line — "(ALPHA)"
    // shouted inside the label read as a warning not to press it.
    this.onlineBtn = new PixelButton(this, cx(), vy(254), t('menu.online'), () => gotoScene(this, 'online'), {
      textureBase: 'btn-comprar', w: 104, h: 14, size: 6, color: ACTION.secondary,
      onBlocked: () => this.flashOnlineBlocked(),
    });
    this.onlineBtn.setEnabled(!isOffline());
    utilities.push(this.onlineBtn, ...this.alphaBadge(cx() + 66, vy(254)));
    this.onlineTag = label(this, cx(), vy(264), t('menu.onlineTag'), 6, TEXT.muted);
    utilities.push(this.onlineTag);

    this.playEntrance([brand, tagline, primary, secondary, utilities]);
  }

  /**
   * Staggered arrival for the menu stack: logo, then tagline, then the main CTA, then everything
   * else — about 600 ms end to end, so the eye lands on the brand before the buttons exist.
   * Instant under reduced motion.
   *
   * Two things the entrance must not do, both of which cost a player their first press:
   * the background is present from the first frame rather than camera-faded, because a running
   * camera fade makes Phaser ignore the fadeOut `gotoScene` starts; and arriving objects start
   * at ALMOST zero alpha rather than zero, because Phaser skips input hit-testing on fully
   * transparent objects. Both left every button dead for the length of the entrance.
   */
  private playEntrance(groups: Phaser.GameObjects.GameObject[][]): void {
    const step = this.motion(110);
    if (step <= 0) return;
    groups.forEach((group, i) => {
      for (const obj of group) {
        const o = obj as Phaser.GameObjects.Image; // every member carries alpha and y
        const restY = o.y;
        o.setAlpha(0.01);
        this.tweens.add({
          targets: o,
          alpha: 1,
          y: { from: restY + 6, to: restY },
          delay: Math.round(i * step),
          duration: Math.round(this.motion(200)),
          ease: 'Quad.out',
        });
      }
    });
  }

  /**
   * An occasional nudge rather than a permanent one. The endless yoyo this replaced made the logo
   * read as a loading spinner; a short dip every few seconds reads as the sign swinging.
   */
  private idleBob(target: Phaser.GameObjects.Image | Phaser.GameObjects.Text): void {
    const dur = this.motion(420);
    if (dur <= 0) return; // reduced motion: dead still, and no timer left running
    this.time.addEvent({
      delay: 5200,
      loop: true,
      callback: () => this.tweens.add({ targets: target, y: '+=4', duration: dur, yoyo: true, repeat: 1, ease: 'Sine.inOut' }),
    });
  }

  /**
   * The boteco's string lights, as a warm wash that dips for a moment now and then. A screen-wide
   * tint rather than per-bulb sprites because the landscape and portrait paintings put their
   * lights in completely different places — hand-placed glows would miss on one of them.
   */
  private addBulbFlicker(): void {
    if (this.motion(1) <= 0) return;
    const wash = this.add.rectangle(cx(), cy(), view().w, view().h, BULB_WASH, 0.06)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.time.addEvent({
      delay: 3400,
      loop: true,
      callback: () => {
        if (Phaser.Math.Between(0, 2) !== 0) return; // most ticks pass quietly
        this.tweens.add({ targets: wash, alpha: 0.015, duration: 70, yoyo: true, repeat: 1 });
      },
    });
  }

  /** Small gold plate marking ONLINE as work in progress, beside the button rather than inside its label. */
  private alphaBadge(x: number, y: number): Phaser.GameObjects.GameObject[] {
    const txt = label(this, x, y, t('menu.alpha'), 6, TEXT.onAccent);
    const plate = this.add.rectangle(x, y, txt.width + 6, txt.height, SURFACE.accent, 0.92);
    txt.setDepth(plate.depth + 1);
    return [plate, txt];
  }

  /**
   * A silent look at what the game is about: three cards sitting as a run regroup into a set and
   * back. No game state and no input — it plays occasionally in the empty margin beside the
   * control panel and fades out. Landscape only: portrait has no margin to spare.
   */
  private scheduleCardTeaser(): void {
    const run = ['card-diamonds-5', 'card-diamonds-6', 'card-diamonds-7'];
    const set = ['card-clubs-7', 'card-hearts-7', 'card-diamonds-7'];
    if (this.motion(1) <= 0 || view().portrait || !run.every((k) => this.textures.exists(k))) return;
    this.time.addEvent({ delay: 11_000, loop: true, startAt: 8_000, callback: () => this.playCardTeaser(run, set) });
  }

  private playCardTeaser(run: string[], set: string[]): void {
    const originX = (cx() - panelW(212) / 2) / 2; // centre of the free margin left of the panel
    const cards = run.map((key, i) => this.add.image(originX + (i - 1) * 15, vy(196), key).setDisplaySize(17, 23).setAlpha(0));
    const flip = (to: string[]): void => {
      cards.forEach((c, i) => {
        if (c.texture.key === to[i]) return;
        this.tweens.add({
          targets: c, scaleX: 0, duration: this.motion(130), yoyo: true, ease: 'Quad.in',
          onYoyo: () => c.setTexture(to[i]!).setDisplaySize(17, 23),
        });
      });
    };
    this.tweens.add({ targets: cards, alpha: 1, duration: this.motion(220) });
    this.time.delayedCall(1400, () => flip(set));
    this.time.delayedCall(3000, () => flip(run));
    this.time.delayedCall(4400, () => this.tweens.add({
      targets: cards, alpha: 0, duration: this.motion(300), onComplete: () => cards.forEach((c) => c.destroy()),
    }));
  }

  /** Transient reason line under ONLINE when it's tapped while offline — same "always say why"
   * pattern as GameScene's onFeitoBlocked, just local to this button since MenuScene has no
   * persistent reason-text widget.
   *
   * The reason takes the ONLINE caption's place rather than being drawn at a fixed y of its own:
   * it used to land at vy(205), which is on top of the secondary button at vy(207) and two thirds
   * of a screen away from the button it explains. Same "both are explanation, only one is news"
   * swap the lobby's queue notice uses. */
  private flashOnlineBlocked(): void {
    const tag = this.onlineTag;
    if (!tag?.active) return;
    const caption = tag.text;
    tag.setText(t('offline.online')).setColor(TEXT.error);
    this.time.delayedCall(2000, () => {
      if (tag.active) tag.setText(caption).setColor(TEXT.muted);
    });
  }
}
