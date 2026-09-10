import { describe, expect, it } from 'vitest';

// The `settings` singleton reads `localStorage` at import time; the plain node test environment
// has none, so stub one in before any of these modules load (same pattern as audio.test.ts).
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage;
}
(globalThis as { localStorage?: Storage }).localStorage = memoryStorage();

describe('motionScale (reduced motion)', () => {
  it('is 1 normally and 0 once reducedMotion is on — every cosmetic tween duration collapses to 0', async () => {
    const { settings } = await import('../src/core/settings');
    settings.update({ reducedMotion: false });
    expect(settings.motionScale()).toBe(1);
    expect(1400 * settings.motionScale()).toBe(1400);

    settings.update({ reducedMotion: true });
    expect(settings.motionScale()).toBe(0);
    expect(1400 * settings.motionScale()).toBe(0);

    settings.update({ reducedMotion: false }); // leave the singleton as other test files expect it
  });

  it('is also 0 once batterySaver is on, independent of reducedMotion', async () => {
    const { settings } = await import('../src/core/settings');
    settings.update({ reducedMotion: false, batterySaver: true });
    expect(settings.motionScale()).toBe(0);

    settings.update({ batterySaver: false }); // leave the singleton as other test files expect it
    expect(settings.motionScale()).toBe(1);
  });
});
