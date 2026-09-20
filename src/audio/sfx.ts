import type Phaser from 'phaser';
import { settings } from '../core/settings';

// Same-key retrigger guard (docs/AUDIO_DIRECTION.md mix rule: "no rapid repeats
// <80ms apart") — a burst of the same cue (e.g. rapid card drags) would
// otherwise stack into a harsh spike instead of the intended single hit.
const RETRIGGER_MS = 80;
const lastPlayedAt = new Map<string, number>();

/**
 * Cues that always play dry. These are the signature moments — confirming a turn, winning — and
 * they are rare enough that the sameness is the point: a wobbling victory sting sounds broken,
 * where a wobbling card-pickup sounds like a hand touching cards.
 */
const NO_VARIATION = new Set(['sfx-feito', 'sfx-win']);

/** Cents of pitch spread, and the fraction of volume spread, applied to the frequent card cues. */
const DETUNE_CENTS = 40;
const VOLUME_SPREAD = 0.08;

/** Fire-and-forget SFX. Missing/failed audio is a silent no-op, never a crash. Retriggering the
 * same key within RETRIGGER_MS is dropped instead of stacking into a louder spike.
 *
 * Frequent cues get a little pitch and volume spread per play. The card sounds fire dozens of
 * times a turn, and a bit-identical sample repeating that often stops reading as a card and
 * starts reading as a UI beep. */
export function playSfx(scene: Phaser.Scene, key: string, volume = 0.6): void {
  try {
    const vol = volume * settings.sfxVolume();
    if (vol <= 0) return;
    const now = Date.now();
    if (now - (lastPlayedAt.get(key) ?? -Infinity) < RETRIGGER_MS) return;
    if (scene.cache.audio.exists(key)) {
      lastPlayedAt.set(key, now);
      const vary = !NO_VARIATION.has(key);
      // Reuse the instance for this key instead of `sound.play(key, ...)`, which creates a new
      // one per call. Phaser only removes such an instance when it emits COMPLETE, and a sound
      // played while the audio context is still locked (or muted by the OS) never does — so a
      // long session accumulated one live sound object per cue played, measured at +8 per match
      // (docs/PERFORMANCE.md, Phase 77). The 80 ms retrigger guard above already means a single
      // instance per key is enough: the same cue never has to overlap itself.
      const sound = scene.sound.get(key) ?? scene.sound.add(key);
      sound.play({
        volume: vary ? vol * (1 + (Math.random() * 2 - 1) * VOLUME_SPREAD) : vol,
        detune: vary ? Math.round((Math.random() * 2 - 1) * DETUNE_CENTS) : 0,
      });
    }
  } catch {
    // audio blocked or missing — ignore
  }
}
