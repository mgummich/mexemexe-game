import Phaser from 'phaser';
import { startMusic } from './audio/music';
import { t } from './localization/i18n';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { OnlineScene } from './scenes/OnlineScene';
import { SetupScene } from './scenes/SetupScene';
import { TutorialScene } from './scenes/TutorialScene';
import { WinScene } from './scenes/WinScene';
import { debugApi, installDebugApi } from './verification/debug-api';

installDebugApi();
startMusic();

// The world is authored in 480x270 units, but the canvas renders at RENDER_SCALE times that so
// sprites hit their native texture resolution instead of being crushed (cards are 48x64 files
// drawn at 24x32 units). Every camera is zoomed by the same factor and re-centred on the world,
// so scene code keeps using plain 480x270 coordinates.
const WORLD_W = 480;
const WORLD_H = 270;
const RENDER_SCALE = 3;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: WORLD_W * RENDER_SCALE,
  height: WORLD_H * RENDER_SCALE,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#1a0f0a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, SetupScene, GameScene, WinScene, TutorialScene, OnlineScene],
});

game.events.once(Phaser.Core.Events.READY, () => {
  for (const scene of game.scene.scenes) {
    scene.events.on(Phaser.Scenes.Events.CREATE, () => {
      scene.cameras.main.setZoom(RENDER_SCALE).centerOn(WORLD_W / 2, WORLD_H / 2);
    });
  }
});

// Scene-agnostic fps sample for the debug API — every scene, not just GameScene.
game.events.on('step', () => {
  debugApi.fps = Math.round(game.loop.actualFps);
});

// ---------- portrait hint ----------
// The board is a fixed 16:9 world, so FIT letterboxes it to ~390x219 on a portrait phone and
// every card lands under a comfortable touch size. Tapping to select/place (GameScene) makes
// that playable; landscape makes it comfortable. ponytail: a hint, not a second layout — a real
// portrait board is a reflow of the whole scene, not a scale tweak.
const portraitHint = document.createElement('div');
portraitHint.textContent = t('a11y.rotateHint');
portraitHint.style.cssText =
  'position:fixed;left:50%;top:12px;transform:translateX(-50%);display:none;' +
  'background:#1a1410;color:#f7d23e;border:1px solid #f7d23e;padding:6px 12px;' +
  'font:12px monospace;border-radius:4px;z-index:9998;opacity:0.95;pointer-events:none;';
document.body.appendChild(portraitHint);

const portrait = window.matchMedia('(orientation: portrait) and (max-width: 820px)');
function updatePortraitHint(): void {
  portraitHint.style.display = portrait.matches ? 'block' : 'none';
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
