import Phaser from 'phaser';
import { setMusicContext } from '../audio/music';
import { PERSONALITY_STYLE, type Personality } from '../ai/ai';
import { bus } from '../core/events';
import { t } from '../localization/i18n';
import type { NetClient } from '../net/client';
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

export class WinScene extends Phaser.Scene {
  constructor() {
    super('win');
  }

  create(data: WinData): void {
    setMusicContext('menu');
    debugApi.scene = 'win';
    debugApi.results = {
      winnerName: data.winnerName,
      stalemate: data.stalemate,
      winningMoveText: data.winningMoveText ?? '',
      results: (data.results ?? []).map((r) => ({
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

    coverBackground(this, 'bg-boteco');
    this.add.rectangle(cx(), cy(), view().w, view().h, 0x1a0f0a, 0.55);
    // banner ships at 3x (480x144); logical size is 160x48, so scale 1/3 is "full size"
    const bannerScale = 1 / 3;
    const banner = this.add.image(cx(), vy(90), 'banner-victory').setScale(bannerScale);
    this.tweens.add({
      targets: banner,
      scale: { from: bannerScale * 0.6, to: bannerScale },
      duration: 300,
      ease: 'Back.out',
    });
    label(this, cx(), vy(88), t(data.stalemate ? 'win.titleStalemate' : 'win.title'), 24, '#f7d23e');
    label(
      this,
      cx(),
      vy(148),
      data.stalemate ? t('win.stalemate', { name: data.winnerName }) : t('win.wins', { name: data.winnerName }),
      11,
    );

    // sparkle burst
    for (let i = 0; i < 14; i++) {
      const s = this.add.image(cx(), vy(90), 'sparkle').setDisplaySize(8, 8);
      const angle = (i / 14) * Math.PI * 2;
      this.tweens.add({
        targets: s,
        x: cx() + Math.cos(angle) * (60 + (i % 3) * 25),
        y: vy(90) + Math.sin(angle) * (40 + (i % 3) * 18),
        alpha: 0,
        duration: 700 + (i % 4) * 150,
        onComplete: () => s.destroy(),
      });
    }

    const results = data.results ?? [];
    // per-player turn/cards/draw breakdown — only meaningful locally; the playlog never observes
    // server-driven turns in an online match, so every counter there would just read 0.
    const showStats = !data.online && results.length > 0;
    const statsLine = showStats
      ? results.map((r) => t('win.statLine', { name: r.name, turns: r.turnsPlayed ?? 0, cards: r.cardsPlayed ?? 0, draws: r.draws ?? 0 })).join('    ')
      : '';

    // Buttons are anchored to the bottom of their own stack (1 button for an online match's
    // dead-end MENU, 3 otherwise) instead of a fixed offset from the top content — a fixed offset
    // let the last button run past the world's bottom edge on any short landscape viewport (an
    // iPhone in landscape), since nothing accounted for how tall the stack itself is.
    const stackExtent = data.online ? 10 : 51; // bottom-most button's edge, relative to buttonY0
    const buttonY0Max = view().h - 4 - stackExtent;
    // buttonY0 is the FIRST button's centre, so its own top edge sits FIRST_BTN_HALF above it —
    // a content/button gap smaller than that (the original bug) puts the button's top edge
    // *above* the content bottom it was supposedly clamped past, i.e. still overlapping it.
    const FIRST_BTN_HALF = 10; // MESMA PARTIDA / the online-only MENU button are both h=20
    const GAP = 6;

    const pitchApplicable = !data.stalemate && !!data.winningMoveText;
    const measure = (text: string, size: number, color: string, width: number): number => {
      const probe = this.add.text(0, 0, text, { ...fontStyle(size, color), align: 'center', wordWrap: { width } });
      const h = probe.height;
      probe.destroy();
      return h;
    };
    const pitchH = pitchApplicable ? measure(data.winningMoveText!, 7, '#d8c890', panelW(380)) : 0;
    const statsH = showStats ? measure(statsLine, 6, '#b8ac98', panelW(400)) : 0;
    const contentBottom = (withPitch: boolean, withStats: boolean) =>
      vy(160) + (withPitch ? pitchH + 4 : 0) + 36 /* renderResults' fixed offset */ + (withStats ? statsH + 6 : 0);
    // Fit-priority ladder, cheapest drop first: the results block (avatars + winner) is the one
    // thing that always stays. A short landscape viewport (an iPhone in landscape, or even
    // desktop with Safari's tab bar eating vertical space) sheds the pitch line, then the stats
    // line, until what's left actually fits above the buttons — guaranteeing content never
    // renders past buttonY0Max, instead of letting it silently run under the button stack.
    const fits = (bottom: number) => bottom + GAP + FIRST_BTN_HALF <= buttonY0Max;
    const includePitch = pitchApplicable && fits(contentBottom(true, showStats));
    const includeStats = showStats && fits(contentBottom(includePitch, true));

    let y = vy(160);
    // biggest gap this screen used to have: the winner is named, but not what they actually did.
    if (includePitch) {
      const moveTxt = this.add
        .text(cx(), y, data.winningMoveText!, { ...fontStyle(7, '#d8c890'), align: 'center', wordWrap: { width: panelW(380) } })
        .setOrigin(0.5, 0);
      y += moveTxt.height + 4;
    }
    y = this.renderResults(results, y + 8);
    if (includeStats) {
      const statsTxt = this.add
        .text(cx(), y, statsLine, { ...fontStyle(6, '#b8ac98'), align: 'center', wordWrap: { width: panelW(400) } })
        .setOrigin(0.5, 0);
      y += statsTxt.height + 6;
    }
    const buttonY0 = Math.max(vy(190), Math.min(buttonY0Max, y + GAP + FIRST_BTN_HALF));

    debugApi.winButtonY = buttonY0;

    if (data.online) {
      // online rematch is out of MVP scope (docs/archive/PHASE5_CLIENT_PLAN.md §A) — never strand the
      // player on a dead room, just leave it and go back to the local menu.
      const client = data.online.client;
      new PixelButton(this, cx(), buttonY0, t('win.menu'), () => {
        client.leaveRoom();
        debugApi.online = null;
        gotoScene(this, 'menu');
      }, { textureBase: 'btn-feito', w: 130, h: 20, size: 8 });
      return;
    }

    new PixelButton(this, cx(), buttonY0, t('win.replaySame'), () => gotoScene(this, 'game', data.config), {
      textureBase: 'btn-feito', w: 130, h: 20, size: 8,
    });
    new PixelButton(this, cx(), buttonY0 + 22, t('win.newSeed'), () => {
      const newConfig = { ...data.config, seed: Date.now() % 2147483647 };
      gotoScene(this, 'game', newConfig);
    }, { textureBase: 'btn-comprar', w: 130, h: 18, size: 7 });
    new PixelButton(this, cx(), buttonY0 + 42, t('win.menu'), () => gotoScene(this, 'menu'), {
      textureBase: 'btn-comprar', w: 130, h: 18, size: 7,
    });
  }

  /** Compact per-player results row: avatar, name, cards remaining, and — for an AI opponent — a
   * fitting reaction emote from its personality's own style table (see ai/ai.ts). Winner picked
   * out with a gold highlight. Returns the y just below the row. */
  private renderResults(results: PlayerResult[], y: number): number {
    if (results.length === 0) return y;
    const rowY = y + 8;
    const slotW = Math.min(96, (view().w - 40) / results.length);
    const startX = cx() - ((results.length - 1) * slotW) / 2;
    results.forEach((r, i) => {
      const x = startX + i * slotW;
      if (r.isWinner) {
        this.add.rectangle(x, rowY, slotW - 6, 32, 0xf7d23e, 0.16).setStrokeStyle(1, 0xf7d23e, 0.9);
      }
      if (this.textures.exists(r.avatarKey)) this.add.image(x, rowY - 8, r.avatarKey).setDisplaySize(16, 16);
      if (r.personality) {
        const emote = r.isWinner ? PERSONALITY_STYLE[r.personality].emoteBig : PERSONALITY_STYLE[r.personality].emoteDraw;
        const key = `emote-${emote}`;
        if (this.textures.exists(key)) this.add.image(x + 9, rowY - 15, key).setDisplaySize(9, 9);
      }
      label(this, x, rowY + 5, r.name, 8, r.isWinner ? '#f7d23e' : '#d8d0c0');
      label(this, x, rowY + 14, `x${r.cardsLeft}`, 8, r.isWinner ? '#f7d23e' : '#c0b8a8');
    });
    return rowY + 20;
  }
}
