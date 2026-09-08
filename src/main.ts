import Phaser from 'phaser';
import { t } from './localization/i18n';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { SetupScene } from './scenes/SetupScene';
import { TutorialScene } from './scenes/TutorialScene';
import { WinScene } from './scenes/WinScene';
import { debugApi, installDebugApi } from './verification/debug-api';

installDebugApi();

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 480,
  height: 270,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#1a0f0a',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, MenuScene, SetupScene, GameScene, WinScene, TutorialScene],
});

// Scene-agnostic fps sample for the debug API — every scene, not just GameScene.
game.events.on('step', () => {
  debugApi.fps = Math.round(game.loop.actualFps);
});

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
