import { settings } from './settings';

/**
 * A short buzz on a touch action, where the browser actually supports one.
 *
 * This is a third confirmation channel next to the visual and the sound, never the only one — a
 * device with no Vibration API (every iOS browser) must lose no information by not vibrating, so
 * nothing here is allowed to be the sole signal for anything.
 *
 * Durations are deliberately tiny. A long vibration on a card game reads as an error alert, and
 * the whole point is that placing a card should feel like placing a card.
 */
type HapticStrength = 'tick' | 'bump' | 'thud';

const MS: Record<HapticStrength, number> = { tick: 8, bump: 15, thud: 30 };

export function haptic(strength: HapticStrength): void {
  if (!settings.get().haptics) return;
  try {
    navigator.vibrate?.(MS[strength]);
  } catch {
    // some browsers throw when the page is not visible or the gesture requirement is unmet
  }
}
