import type Phaser from 'phaser';
import { settings } from '../core/settings';

// Same-key retrigger guard (docs/AUDIO_DIRECTION.md mix rule: "no rapid repeats
// <80ms apart") — a burst of the same cue (e.g. rapid card drags) would
// otherwise stack into a harsh spike instead of the intended single hit.
const RETRIGGER_MS = 80;
const lastPlayedAt = new Map<string, number>();

/** Fire-and-forget SFX. Missing/failed audio is a silent no-op, never a crash. Retriggering the
 * same key within RETRIGGER_MS is dropped instead of stacking into a louder spike. */
export function playSfx(scene: Phaser.Scene, key: string, volume = 0.6): void {
  try {
    const vol = volume * settings.sfxVolume();
    if (vol <= 0) return;
    const now = Date.now();
    if (now - (lastPlayedAt.get(key) ?? -Infinity) < RETRIGGER_MS) return;
    if (scene.cache.audio.exists(key)) {
      lastPlayedAt.set(key, now);
      scene.sound.play(key, { volume: vol });
    }
  } catch {
    // audio blocked or missing — ignore
  }
}
