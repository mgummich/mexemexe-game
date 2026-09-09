import Phaser from 'phaser';
import { startMusic } from './audio/music';
import { bus } from './core/events';
import { playlog } from './core/playlog';
import { t } from './localization/i18n';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { OnlineScene } from './scenes/OnlineScene';
import { SetupScene } from './scenes/SetupScene';
import { TutorialScene } from './scenes/TutorialScene';
import { WinScene } from './scenes/WinScene';
import { refreshProfile, view } from './ui/viewport';
import { debugApi, installDebugApi } from './verification/debug-api';

installDebugApi();
playlog.attachToBus(bus);
startMusic();

// The world is authored in view().w x view().h units (480x270 landscape, 270x480 portrait — see
// src/ui/viewport.ts), but the canvas renders at RENDER_SCALE times that so sprites hit their
// native texture resolution instead of being crushed (cards are 48x64 files drawn at 24x32
// units). Every camera is zoomed by the same factor and re-centred on the world, so scene code
// keeps using plain world-unit coordinates.
const RENDER_SCALE = 3;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: view().w * RENDER_SCALE,
  height: view().h * RENDER_SCALE,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#1a0f0a',
  scale: {
    mode: Phaser.Scale.FIT,
    // No autoCenter: #game already centres the canvas with flexbox, and Phaser's margin-based
    // centring stacks on top of that — off-centre by half the leftover space on phone viewports.
  },
  scene: [BootScene, MenuScene, SetupScene, GameScene, WinScene, TutorialScene, OnlineScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  for (const scene of game.scene.scenes) {
    scene.events.on(Phaser.Scenes.Events.CREATE, () => {
      scene.cameras.main.setZoom(RENDER_SCALE).centerOn(view().w / 2, view().h / 2);
    });
  }
});

// ---------- viewport resize / orientation flip ----------
// Debounced: window resize fires repeatedly mid-drag (and on iOS, mid-toolbar-animation), so
// only re-detect once it settles.
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!refreshProfile()) return;
    game.scale.resize(view().w * RENDER_SCALE, view().h * RENDER_SCALE);
    for (const scene of game.scene.scenes) {
      if (!scene.scene.isActive()) continue;
      scene.cameras.main.setZoom(RENDER_SCALE).centerOn(view().w / 2, view().h / 2);
    }
    bus.emit('viewport:changed', { portrait: view().portrait });
  }, 150);
});

// Scene-agnostic fps sample for the debug API — every scene, not just GameScene.
game.events.on('step', () => {
  debugApi.fps = Math.round(game.loop.actualFps);
});

// ---------- portrait hint ----------
// Portrait is now a real playable layout (src/ui/viewport.ts + regions.ts), so this hint must
// not sit on top of the board forever: show it briefly on load / on entering portrait, then
// auto-hide so it doesn't block the re-stacked board it used to warn people away from.
const portraitHint = document.createElement('div');
portraitHint.textContent = t('a11y.rotateHint');
portraitHint.style.cssText =
  'position:fixed;left:50%;top:12px;transform:translateX(-50%);display:none;' +
  'background:#1a1410;color:#f7d23e;border:1px solid #f7d23e;padding:6px 12px;' +
  'font:12px monospace;border-radius:4px;z-index:9998;opacity:0.95;pointer-events:none;';
document.body.appendChild(portraitHint);

const portrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
let hintTimer: ReturnType<typeof setTimeout> | undefined;
function updatePortraitHint(): void {
  clearTimeout(hintTimer);
  if (!portrait.matches) {
    portraitHint.style.display = 'none';
    return;
  }
  portraitHint.style.display = 'block';
  hintTimer = setTimeout(() => {
    portraitHint.style.display = 'none';
  }, 6000);
}
portrait.addEventListener('change', updatePortraitHint);
updatePortraitHint();

// ---------- soft error recovery ----------
// Uncaught errors are already captured into debugApi.errors (installDebugApi) for
// verification. This just adds a player-facing toast and, throttled to at most once
// per 5s to avoid a start->throw->start loop, falls back to the menu scene.
function showErrorToast(): void {
  const el = document.createElement('div');
  el.textContent = t('errors.recoverable');
  el.style.cssText =
    'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
    'background:#1a1410;color:#f7d23e;border:1px solid #f7d23e;padding:8px 14px;' +
    'font:12px monospace;border-radius:4px;z-index:9999;opacity:0.95;pointer-events:none;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

let lastRecovery = 0;
function recoverFromError(): void {
  showErrorToast();
  const now = Date.now();
  if (now - lastRecovery < 5000) return;
  lastRecovery = now;
  const active = game.scene.getScenes(true)[0];
  if (active && active.scene.key !== 'menu') game.scene.start('menu');
}

window.addEventListener('error', recoverFromError);
window.addEventListener('unhandledrejection', recoverFromError);
