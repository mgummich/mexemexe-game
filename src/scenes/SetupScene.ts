import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { playSfx } from '../audio/sfx';
import { settings } from '../core/settings';
import { bus } from '../core/events';
import { t } from '../localization/i18n';
import { coverBackground, cx, cy, panelW, vy, woodPanel } from '../ui/menu-layout';
import { openSettingsPanel } from '../ui/settings-panel';
import { view } from '../ui/viewport';
import { gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi, urlSeed } from '../verification/debug-api';
import type { GameSceneConfig } from './GameScene';

type Personality = 'cida' | 'juninho' | 'bia' | 'ze';

const AI_LINEUP: { name: string; personality: Personality }[] = [
  { name: 'Dona Cida', personality: 'cida' },
  { name: 'Juninho', personality: 'juninho' },
  { name: 'Bia', personality: 'bia' },
  { name: 'Seu Zé', personality: 'ze' },
];
const CYCLE: Personality[] = ['cida', 'juninho', 'bia', 'ze'];

/**
 * Next/previous personality that no other seat already holds, so two seats can never show the
 * same named opponent (SETUP-09). With 4 characters and at most 3 AI seats a free one always
 * exists; the loop falls back to `current` rather than spinning if that ever stops being true.
 */
function stepPersonality(current: Personality, taken: readonly Personality[], dir: 1 | -1): Personality {
  const start = CYCLE.indexOf(current);
  for (let step = 1; step < CYCLE.length; step++) {
    const next = CYCLE[((start + dir * step) % CYCLE.length + CYCLE.length) % CYCLE.length]!;
    if (!taken.includes(next)) return next;
  }
  return current;
}

/**
 * Which style line is true for a personality *at the current difficulty*. Difficulty rewrites
 * behaviour (see createAi in ai.ts): `beginner` makes everyone play one minimal action with no
 * rearranging and no patience, `casual` drops rearranging, `expert` gives everyone the
 * rearrange search. Only joker policy is the same at every tier, so the tier-dependent claims
 * (Bia remexe / Zé espera) fall back to a joker-only line where they would be a lie.
 */
function styleKey(personality: Personality): string {
  const tier = settings.get().aiDifficulty;
  if (personality === 'bia' && tier !== 'smart' && tier !== 'expert') return 'setup.style.bia.simple';
  if (personality === 'ze' && tier === 'beginner') return 'setup.style.ze.simple';
  return `setup.style.${personality}`;
}

/** Angle (radians) of each seat around the table oval — the human at the bottom, AIs clockwise. */
function seatAngles(count: number): number[] {
  return Array.from({ length: count }, (_, i) => Math.PI / 2 + (i * 2 * Math.PI) / count);
}

/** Seat/personality picker: seat 0 is always the human, seats 1..count-1 pick an AI character. */
export class SetupScene extends Phaser.Scene {
  private seatCount = 2;
  private aiPersonalities: Personality[] = ['juninho', 'bia', 'ze'];
  /** Replay-seed row is a testing affordance, not a player-facing one — collapsed behind ADVANCED. */
  private advancedOpen = false;
  /** Set while the deal animation runs, so a second PLAY tap can't start two games. */
  private dealing = false;

  constructor() {
    super('setup');
  }

  create(): void {
    setMusicContext('menu');
    debugApi.scene = 'setup';
    this.dealing = false;
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

    label(this, cx(), vy(50), t('setup.title'), 12, '#f7d23e');

    [2, 3, 4].forEach((n, i) => {
      const btn = new PixelButton(this, cx() + (190 + i * 50 - 240), vy(70), String(n), () => {
        this.seatCount = n;
        this.rebuild();
      }, { textureBase: 'btn-small', w: 30, h: 20, size: 9 });
      btn.setSelected(n === this.seatCount);
    });
    // What the seat count actually changes about the match, instead of a bare numeral (SETUP-06).
    label(this, cx(), vy(89), t(`setup.players.${this.seatCount}`), 8, '#c9bda6');

    const rowY0 = 102;
    const rowGap = 24;
    // Everything below the seat list hangs off where that list actually ends, so a 4-player
    // lineup doesn't push the summary under the Back/Play row (2 players left a dead gap instead).
    const belowSeats = rowY0 + this.seatCount * rowGap;
    for (let seat = 0; seat < this.seatCount; seat++) {
      const y = vy(rowY0 + seat * rowGap);
      const avatarX = cx() + (150 - 240);
      const textX = cx() + (168 - 240);
      if (seat === 0) {
        this.add.image(avatarX, y, 'avatar-player').setDisplaySize(20, 20);
        label(this, textX, y, t('menu.you'), 8, '#f7d23e').setOrigin(0, 0.5);
      } else {
        const p = this.aiPersonalities[seat - 1]!;
        const entry = AI_LINEUP.find((a) => a.personality === p)!;
        this.add.image(avatarX, y, `avatar-${p}`).setName(`avatar-seat-${seat}`).setDisplaySize(20, 20);
        label(this, textX, y - 5, entry.name, 8, '#f7f2e7').setOrigin(0, 0.5);
        label(this, textX, y + 6, t(styleKey(p)), 8, '#b8ab94').setName(`style-seat-${seat}`).setOrigin(0, 0.5);
        // Visible prev/next per seat (SETUP-03) — the old affordance was an undiscoverable
        // one-way tap on the avatar.
        new PixelButton(this, cx() + (126 - 240), y, '◀', () => this.changeSeat(seat, -1), {
          textureBase: 'btn-small', w: 14, h: 16, size: 8, color: 0x9a8d74,
        });
        new PixelButton(this, cx() + (354 - 240), y, '▶', () => this.changeSeat(seat, 1), {
          textureBase: 'btn-small', w: 14, h: 16, size: 8, color: 0x9a8d74,
        });
      }
    }

    // Who to pick when you're new. Cida plays the smallest legal move and holds her jokers at
    // every tier except Craque, where the engine rearranges for everyone — so the tip is hidden
    // there rather than claiming something the AI stops doing (SETUP-08).
    if (settings.get().aiDifficulty !== 'expert') {
      label(this, cx(), vy(belowSeats + 6), t('setup.beginnerTip'), 8, '#c9bda6');
    }

    // Match summary — the settings that actually shape the match, which are otherwise invisible
    // here, instead of repeating the seat count and names already listed above (SETUP-07).
    label(
      this,
      cx(),
      vy(belowSeats + 18),
      t('setup.summary', {
        difficulty: t(`settings.aiDifficulty.${settings.get().aiDifficulty}`),
        pace: t(`settings.aiSpeed.${settings.get().aiSpeed}`),
      }),
      8,
      '#f0e8d8',
    );

    // Where the panel's free space starts — the seating preview fills whatever is left below.
    let freeY = belowSeats + 26;
    const lastSeed = settings.progress().lastSeed;
    if (lastSeed !== null) {
      freeY = belowSeats + 40;
      const advY = vy(belowSeats + 32);
      // Open state keeps both buttons on one row — a second row would collide with PLAY at 4 seats.
      new PixelButton(this, this.advancedOpen ? cx() - 80 : cx(), advY, this.advancedOpen ? t('setup.advancedHide') : t('setup.advanced'), () => {
        this.advancedOpen = !this.advancedOpen;
        this.rebuild();
      }, { textureBase: 'btn-comprar', w: 90, h: 13, size: 6, color: 0x8a7f68 });
      if (this.advancedOpen) {
        new PixelButton(this, cx() + 40, advY, t('setup.lastSeed', { seed: lastSeed }), () => this.startGame(lastSeed), {
          textureBase: 'btn-comprar', w: 140, h: 13, size: 6, color: 0x8a7f68,
        });
      }
    }

    this.seatingPreview(freeY);

    new PixelButton(this, cx() + (170 - 240), vy(248), t('setup.back'), () => gotoScene(this, 'menu'), {
      textureBase: 'btn-comprar', w: 80, h: 20, size: 9,
    });
    new PixelButton(this, cx() + (300 - 240), vy(248), t('menu.play'), () => this.startGame(), {
      textureBase: 'btn-feito', w: 100, h: 24, size: 9, primary: true,
    });

    // Same corner MenuScene uses — language/settings are reachable here too, without backing
    // out to the menu and losing the seat/personality picks made on this screen.
    new PixelButton(this, view().w - 18, 10, '⚙', () => openSettingsPanel(this, () => this.rebuild()), {
      textureBase: 'btn-small', w: 16, h: 14, size: 8, color: 0x5e5646, tooltip: t('tooltip.settings'),
    });
  }

  /**
   * Draws the table everyone is about to sit at, in whatever room is left between the summary
   * and the PLAY row (SETUP-10). Skipped when that gap is too small to hold it — a 4-player
   * lineup fills the panel and has no spare space to fill.
   */
  private seatingPreview(topY: number): void {
    const bottomY = 234;
    if (bottomY - topY < 52) return;
    const y = vy(topY + 26);
    const [rx, ry] = [40, vy(12)];
    const g = this.add.graphics();
    g.fillStyle(0x4a3a26, 0.95);
    g.fillEllipse(cx(), y, rx * 2, ry * 2);
    g.lineStyle(1, 0xc0a878, 0.9);
    g.strokeEllipse(cx(), y, rx * 2, ry * 2);
    this.add.image(cx(), y, 'card-back-0').setDisplaySize(10, 14).setAngle(-8);
    seatAngles(this.seatCount).forEach((a, i) => {
      const key = i === 0 ? 'avatar-player' : `avatar-${this.aiPersonalities[i - 1]!}`;
      this.add.image(cx() + Math.cos(a) * (rx + 7), y + Math.sin(a) * (ry + 8), key).setDisplaySize(12, 12);
    });
  }

  /** Swap one AI seat's character and answer in that character's own voice (SETUP-02/04). */
  private changeSeat(seat: number, dir: 1 | -1): void {
    const taken = this.aiPersonalities.slice(0, this.seatCount - 1).filter((_, i) => i !== seat - 1);
    const next = stepPersonality(this.aiPersonalities[seat - 1]!, taken, dir);
    this.aiPersonalities[seat - 1] = next;
    this.rebuild();
    playSfx(this, 'sfx-click');

    // Rebuild already redrew the avatar at its normal (setDisplaySize) scale — grab it and pop
    // it in from smaller, so a change doesn't happen silently. Instant under reduced motion
    // (motionScale() floors the duration at 1ms, same pattern as every other tween here).
    const fresh = this.children.getByName(`avatar-seat-${seat}`) as Phaser.GameObjects.Image | null;
    if (fresh) {
      const [toX, toY] = [fresh.scaleX, fresh.scaleY];
      fresh.setScale(toX * 0.6, toY * 0.6);
      this.tweens.add({ targets: fresh, scaleX: toX, scaleY: toY, duration: Math.max(1, 180 * settings.motionScale()), ease: 'Back.out' });
    }
    // The new character greets you in their own line, then the row goes back to describing how
    // they play. Text swap rather than a tween, so reduced motion keeps the whole message.
    const style = this.children.getByName(`style-seat-${seat}`) as Phaser.GameObjects.Text | null;
    if (style) {
      style.setText(`"${t(`ai.line.${next}.bigPlay`)}"`).setColor('#f7d23e');
      this.time.delayedCall(1600, () => {
        if (style.active) style.setText(t(styleKey(next))).setColor('#b8ab94');
      });
    }
  }

  private startGame(seed = urlSeed()): void {
    if (this.dealing) return;
    const ais = this.aiPersonalities.slice(0, this.seatCount - 1);
    const config: GameSceneConfig = {
      seed,
      players: [
        { name: t('menu.you'), isAi: false },
        ...ais.map((p) => ({ name: AI_LINEUP.find((a) => a.personality === p)!.name, isAi: true, personality: p })),
      ],
    };
    this.dealing = true;
    this.dealOut(() => gotoScene(this, 'game', config));
  }

  /**
   * Quick deal out of the middle of the table before the scene changes (SETUP-12), so PLAY reads
   * as the game starting rather than a generic fade. Skipped entirely under reduced motion.
   */
  private dealOut(done: () => void): void {
    const motion = settings.motionScale();
    if (motion <= 0) {
      done();
      return;
    }
    playSfx(this, 'sfx-deal');
    const y = vy(150);
    const angles = seatAngles(this.seatCount);
    angles.forEach((a, i) => {
      const card = this.add.image(cx(), y, 'card-back-0').setDisplaySize(14, 20).setDepth(50);
      this.tweens.add({
        targets: card,
        x: cx() + Math.cos(a) * 120,
        y: y + Math.sin(a) * vy(70),
        angle: dir(a) * 20,
        delay: i * 70 * motion,
        duration: 200 * motion,
        ease: 'Quad.out',
        onComplete: i === angles.length - 1 ? done : undefined,
      });
    });
  }
}

/** Sign of the horizontal travel, so a dealt card tilts the way it flies. */
function dir(angle: number): number {
  return Math.cos(angle) >= 0 ? 1 : -1;
}
