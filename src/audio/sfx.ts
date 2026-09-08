import type Phaser from 'phaser';
import { settings } from '../core/settings';

/** Fire-and-forget SFX. Missing/failed audio is a silent no-op, never a crash. */
export function playSfx(scene: Phaser.Scene, key: string, volume = 0.6): void {
  try {
    const vol = volume * settings.sfxVolume();
    if (vol <= 0) return;
    if (scene.cache.audio.exists(key)) {
      scene.sound.play(key, { volume: vol });
    }
  } catch {
    // audio blocked or missing — ignore
  }
}
