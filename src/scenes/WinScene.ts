import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { PERSONALITY_STYLE, type Personality } from '../ai/ai';
import { bus } from '../core/events';
import { matchStoryKey } from '../core/results-summary';
import { settings } from '../core/settings';
import { t } from '../localization/i18n';
import type { NetClient } from '../net/client';
import { FEEL, feelMs } from '../ui/feel';
import { coverBackground, cx, cy, panelW, vy } from '../ui/menu-layout';
import { view } from '../ui/viewport';
import { fontStyle, gotoScene, label, PixelButton } from '../ui/widgets';
import { debugApi } from '../verification/debug-api';
import type { GameSceneConfig } from './GameScene';

interface PlayerResult {
  name: string;
  cardsLeft: number;
  isWinner: boolean;
  avatarKey: string;
  /** Missing for the local human seat and for online opponents — no avatar reaction shown then. */
  personality?: Personality;
  /** Rematch-summary counters, from the playlog's per-player stats. All 0 for an online match
   * (the local playlog never observes server-driven turns). */
  turnsPlayed?: number;
  cardsPlayed?: number;
  draws?: number;
}

interface WinData {
  winnerName: string;
  stalemate: boolean;
  config: GameSceneConfig;
  results?: PlayerResult[];
  /** Localized readback of the winning play (e.g. "X played 2 card(s)") — empty/undefined on a
   * stalemate or an online match, where no local draft is available. */
  winningMoveText?: string;
  /** Present only after an online match — rematch is out of MVP scope, so this replaces it with a menu path. */
  online?: { client: NetClient };
}

/** Vertical cost of the per-player comparison line inside the results block. */
const STATS_H = 12;

export class WinScene extends Phaser.Scene {
  constructor() {
    super('win');
  }

  create(data: WinData): void {
    setMusicContext('menu');
    debugApi.scene = 'win';
    const results = data.results ?? [];
    // per-player card/draw breakdown — only meaningful locally; the playlog never observes
    // server-driven turns in an online match, so every counter there would just read 0.
    // ...and pointless when every counter reads 0 (an online match, or a showcase state with no
    // playlog behind it): "0 cards played" for everyone is a comparison of nothing.
    const showStats = !data.online && results.some((r) => (r.cardsPlayed ?? 0) > 0);
    const storyKey = results.length > 0 ? matchStoryKey(results, data.stalemate) : null;
    const reaction = this.reactionLine(results);
    debugApi.results = {
      winnerName: data.winnerName,
      stalemate: data.stalemate,
      winningMoveText: data.winningMoveText ?? '',
      storyKey,
      reactionText: reaction,
      results: results.map((r) => ({
        name: r.name,
        cardsLeft: r.cardsLeft,
        isWinner: r.isWinner,
        turnsPlayed: r.turnsPlayed ?? 0,
        cardsPlayed: r.cardsPlayed ?? 0,
        draws: r.draws ?? 0,
      })),
    };
    // No live connection held by this scene beyond `data.online.client`, which `scene.restart`
    // passes straight back through — a full restart on orientation flip is simplest and correct.
    const unsub = bus.on('viewport:changed', () => this.scene.restart(data));
    this.events.once('shutdown', unsub);

    // The portrait world is 210px taller than the landscape one once both are mapped through
    // vy(), which left the whole stack hugging the top with a third of the screen empty below it.
    // One offset pushes the celebration down so the result sits in the middle of the phone.
    const off = view().portrait ? 40 : 0;
    coverBackground(this, 'bg-boteco');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.55);
    // banner ships at 3x (480x144); logical size is 160x48, so scale 1/3 is "full size"
    const bannerScale = 1 / 3;
    const banner = this.add.image(cx(), vy(50) + off, 'banner-victory').setScale(bannerScale);
    this.tweens.add({
      targets: banner,
      scale: { from: bannerScale * 0.6, to: bannerScale },
      duration: Math.max(1, feelMs('major')),
      ease: FEEL.major.ease,
    });
    label(this, cx(), vy(48) + off, t(data.stalemate ? 'win.titleStalemate' : 'win.title'), 24, '#f7d23e');
    label(
      this,
      cx(),
      vy(84) + off,
      data.stalemate ? t('win.stalemate', { name: data.winnerName }) : t('win.wins', { name: data.winnerName }),
      11,
    );

    // sparkle burst — skipped entirely under reduced motion (the banner and title carry the
    // celebration on their own there; no information lives in the sparkles).
    if (settings.motionScale() > 0) {
      for (let i = 0; i < 14; i++) {
        const s = this.add.image(cx(), vy(50) + off, 'sparkle').setDisplaySize(8, 8);
        const angle = (i / 14) * Math.PI * 2;
        this.tweens.add({
          targets: s,
          x: cx() + Math.cos(angle) * (60 + (i % 3) * 25),
          y: vy(50) + off + Math.sin(angle) * (40 + (i % 3) * 18),
          alpha: 0,
          duration: 700 + (i % 4) * 150,
          onComplete: () => s.destroy(),
        });
      }
    }

    // Buttons are anchored to the bottom of their own stack (1 button for an online match's
    // dead-end MENU, 3 otherwise) instead of a fixed offset from the top content — a fixed offset
    // let the last button run past the world's bottom edge on any short landscape viewport (an
    // iPhone in landscape), since nothing accounted for how tall the stack itself is.
    const stackExtent = data.online ? 10 : 53; // bottom-most button's edge, relative to buttonY0
    const buttonY0Max = view().h - 4 - stackExtent;
    // buttonY0 is the FIRST button's centre, so its own top edge sits FIRST_BTN_HALF above it —
    // a content/button gap smaller than that (the original bug) puts the button's top edge
    // *above* the content bottom it was supposedly clamped past, i.e. still overlapping it.
    const FIRST_BTN_HALF = 11; // REVANCHE is h=22; the online-only MENU button is h=20
    const GAP = 6;

    const headline = data.stalemate ? '' : (data.winningMoveText ?? '');
    const measure = (text: string, size: number, width: number): number => {
      const probe = this.add.text(0, 0, text, { ...fontStyle(size), align: 'center', wordWrap: { width } });
      const h = probe.height;
      probe.destroy();
      return h;
    };
    const storyH = storyKey ? measure(t(storyKey), 9, panelW(360)) + 3 : 0;
    const headlineH = headline ? measure(headline, 9, panelW(360)) + 4 : 0;
    const reactionH = reaction ? measure(reaction, 7, panelW(380)) + 4 : 0;
    const top = vy(95) + off;
    const contentBottom = (withHeadline: boolean, withStats: boolean, withReaction: boolean) =>
      top + storyH + (withHeadline ? headlineH : 0)
      + 36 /* renderResults' fixed offset */ + (withStats ? STATS_H : 0)
      + (withReaction ? reactionH : 0);
    // Fit-priority ladder, cheapest drop first: the results block (avatars + winner) is the one
    // thing that always stays, and the story label is one short line that never costs enough to
    // drop. A short landscape viewport (an iPhone in landscape, or 125% text) sheds the per-player
    // comparison first, then the character reaction, and only as a last resort the winning-move
    // headline — guaranteeing content never renders under the button stack.
    const fits = (bottom: number) => bottom + GAP + FIRST_BTN_HALF <= buttonY0Max;
    const includeStats = showStats && fits(contentBottom(true, true, !!reaction));
    const includeReaction = !!reaction && fits(contentBottom(true, includeStats, true));
    const includeHeadline = !!headline && fits(contentBottom(true, includeStats, includeReaction));

    let y = top;
    const story: Phaser.GameObjects.GameObject[] = [];
    if (storyKey) {
      // RESULT-03: exactly one label for how the match went, above the move that decided it.
      const chip = this.add.text(cx(), y, t(storyKey), { ...fontStyle(9, '#1a0f0a'), align: 'center' }).setOrigin(0.5, 0);
      const plate = this.add
        .rectangle(cx(), y + chip.height / 2, chip.width + 12, chip.height + 2, 0xf7d23e, 0.92)
        .setStrokeStyle(1, 0x8a6b1f, 1);
      this.children.moveBelow(plate, chip);
      story.push(chip, plate);
      y += storyH;
    }
    // Biggest gap this screen used to have: the winner is named, but not what they actually did.
    // On a loss this line is the whole framing — what the winner pulled off, never "you lost".
    if (includeHeadline) {
      const moveTxt = this.add
        .text(cx(), y, headline, { ...fontStyle(9, '#f2e6c0'), align: 'center', wordWrap: { width: panelW(360) } })
        .setOrigin(0.5, 0);
      story.push(moveTxt);
      y += headlineH;
    }
    const board = this.renderResults(results, y + 8, includeStats);
    y = board.y;
    const tail: Phaser.GameObjects.GameObject[] = [];
    if (includeReaction) {
      // RESULT-05/13: the opponent stays a character across the rematch, not an anonymous seat.
      tail.push(this.add
        .text(cx(), y, reaction, { ...fontStyle(7, '#d8c890'), align: 'center', wordWrap: { width: panelW(380) } })
        .setOrigin(0.5, 0));
      y += reactionH;
    }
    const buttonY0 = Math.max(vy(190) + off, Math.min(buttonY0Max, y + GAP + FIRST_BTN_HALF));

    debugApi.winButtonY = buttonY0;

    if (data.online) {
      // online rematch is out of MVP scope (docs/archive/PHASE5_CLIENT_PLAN.md §A) — never strand the
      // player on a dead room, just leave it and go back to the local menu.
      const client = data.online.client;
      tail.push(new PixelButton(this, cx(), buttonY0, t('win.menu'), () => {
        client.leaveRoom();
        debugApi.online = null;
        gotoScene(this, 'menu');
      }, { textureBase: 'btn-feito', w: 130, h: 20, size: 8 }));
    } else {
      // RESULT-04/11/12: one dominant CTA that deals the next hand with the same lineup and
      // settings, a secondary path to change who is playing, menu last. The same-seed replay
      // this screen used to lead with is a testing affordance and lives in SETUP > AVANÇADO.
      tail.push(new PixelButton(this, cx(), buttonY0, t('win.rematch'), () => {
        gotoScene(this, 'game', { ...data.config, seed: Date.now() % 2147483647 });
      }, { textureBase: 'btn-feito', w: 140, h: 22, size: 9, primary: true }));
      tail.push(new PixelButton(this, cx(), buttonY0 + 24, t('win.changePlayers'), () => gotoScene(this, 'setup'), {
        textureBase: 'btn-comprar', w: 130, h: 18, size: 7,
      }));
      tail.push(new PixelButton(this, cx(), buttonY0 + 44, t('win.menu'), () => gotoScene(this, 'menu'), {
        textureBase: 'btn-comprar', w: 130, h: 18, size: 7,
      }));
    }

    // RESULT-01: celebration alone first, then the story, then the numbers and the controls.
    this.stage(story, feelMs('expressive'));
    this.stage(board.objects, feelMs('major'));
    this.stage(tail, feelMs('major') + feelMs('normal'));
  }

  /**
   * Fades a group in after `delay` ms. Alpha starts at 0.01 and never 0: Phaser skips input
   * hit-testing on fully transparent objects, which would leave the action buttons dead for the
   * whole reveal. With reduced motion on, feelMs() is 0, so the caller's delay is 0 and every
   * group is simply on screen from the first frame — same information, no staging.
   */
  private stage(objects: Phaser.GameObjects.GameObject[], delay: number): void {
    if (delay <= 0 || objects.length === 0) return;
    for (const o of objects) (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0.01);
    this.tweens.add({ targets: objects, alpha: 1, delay, duration: Math.max(1, feelMs('fast')), ease: FEEL.fast.ease });
  }

  /** One short character reaction to the result (RESULT-05/13): the winning AI reacts to its win,
   * otherwise the lead AI opponent reacts to its loss. Empty when no seat has a personality
   * (an online match, or an all-human table). */
  private reactionLine(results: PlayerResult[]): string {
    const reactor = results.find((r) => r.personality && r.isWinner) ?? results.find((r) => r.personality);
    if (!reactor?.personality) return '';
    const line = t(`ai.line.${reactor.personality}.${reactor.isWinner ? 'wonMatch' : 'lostMatch'}`);
    return t('win.reaction', { name: reactor.name, line });
  }

  /** Compact per-player results column: avatar, name, cards remaining, and — for an AI opponent —
   * a fitting reaction emote from its personality's own style table (see ai/ai.ts). Winner picked
   * out with a gold highlight AND a plate, never colour alone. With `withStats`, each column also
   * carries that player's cards-played/draws, so the seats line up and can actually be compared
   * (RESULT-08) instead of being dumped into one run-on line. Returns the y below the block and
   * everything drawn, for the staged reveal. */
  private renderResults(
    results: PlayerResult[],
    y: number,
    withStats: boolean,
  ): { y: number; objects: Phaser.GameObjects.GameObject[] } {
    const objects: Phaser.GameObjects.GameObject[] = [];
    if (results.length === 0) return { y, objects };
    const rowY = y + 8;
    const slotW = Math.min(96, (view().w - 40) / results.length);
    const startX = cx() - ((results.length - 1) * slotW) / 2;
    results.forEach((r, i) => {
      const x = startX + i * slotW;
      if (r.isWinner) {
        const h = withStats ? 32 + STATS_H : 32;
        objects.push(this.add
          .rectangle(x, rowY + (withStats ? STATS_H / 2 : 0), slotW - 6, h, 0xf7d23e, 0.16)
          .setStrokeStyle(1, 0xf7d23e, 0.9));
      }
      if (this.textures.exists(r.avatarKey)) objects.push(this.add.image(x, rowY - 8, r.avatarKey).setDisplaySize(16, 16));
      if (r.personality) {
        const emote = r.isWinner ? PERSONALITY_STYLE[r.personality].emoteBig : PERSONALITY_STYLE[r.personality].emoteDraw;
        const key = `emote-${emote}`;
        if (this.textures.exists(key)) objects.push(this.add.image(x + 9, rowY - 15, key).setDisplaySize(9, 9));
      }
      objects.push(label(this, x, rowY + 5, r.name, 8, r.isWinner ? '#f7d23e' : '#d8d0c0'));
      objects.push(label(this, x, rowY + 14, `x${r.cardsLeft}`, 8, r.isWinner ? '#f7d23e' : '#c0b8a8'));
      if (withStats) {
        objects.push(label(this, x, rowY + 24, t('win.statCards', { n: r.cardsPlayed ?? 0 }), 6, '#b8ac98'));
      }
    });
    return { y: rowY + 20 + (withStats ? STATS_H : 0), objects };
  }
}
