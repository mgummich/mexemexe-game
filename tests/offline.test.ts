import { describe, expect, it, vi } from 'vitest';
import { isOffline, onConnectivityChange } from '../src/core/pwa';
import { localeKeys, setLocale, t } from '../src/localization/i18n';

describe('isOffline', () => {
  it('is false when navigator is absent (node/vitest env)', () => {
    expect(isOffline()).toBe(false);
  });

  it('tracks a stubbed navigator.onLine', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOffline()).toBe(true);
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOffline()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('onConnectivityChange', () => {
  /** Minimal addEventListener/removeEventListener stub standing in for `window`. */
  function fakeTarget(): {
    target: { addEventListener: (t: string, fn: () => void) => void; removeEventListener: (t: string, fn: () => void) => void };
    fire: (type: 'online' | 'offline') => void;
  } {
    const handlers = new Map<string, Set<() => void>>();
    const target = {
      addEventListener: (type: string, fn: () => void) => {
        let set = handlers.get(type);
        if (!set) { set = new Set(); handlers.set(type, set); }
        set.add(fn);
      },
      removeEventListener: (type: string, fn: () => void) => {
        handlers.get(type)?.delete(fn);
      },
    };
    return { target, fire: (type) => handlers.get(type)?.forEach((fn) => fn()) };
  }

  it('fires true on offline and false on online', () => {
    const { target, fire } = fakeTarget();
    const seen: boolean[] = [];
    onConnectivityChange((offline) => seen.push(offline), target);
    fire('offline');
    fire('online');
    expect(seen).toEqual([true, false]);
  });

  it('unsubscribe stops further calls', () => {
    const { target, fire } = fakeTarget();
    const seen: boolean[] = [];
    const unsub = onConnectivityChange((offline) => seen.push(offline), target);
    fire('offline');
    unsub();
    fire('online');
    expect(seen).toEqual([true]);
  });
});

describe('offline/update i18n keys', () => {
  const KEYS = ['offline.banner', 'offline.online', 'update.available'];

  for (const locale of ['pt', 'en'] as const) {
    it(`${locale} defines all three keys, non-empty`, () => {
      setLocale(locale);
      const keys = new Set(localeKeys(locale));
      for (const k of KEYS) {
        expect(keys.has(k)).toBe(true);
        expect(t(k)).not.toBe('');
      }
    });
  }
});
