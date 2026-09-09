import { describe, expect, it, beforeAll, vi } from 'vitest';
import type { Settings } from '../src/core/settings';
import type { MusicContext } from '../src/audio/music';

/** Minimal in-memory Storage stand-in — avoids pulling jsdom into the node test env (same pattern as persistence.test.ts). */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
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

// The `settings` singleton reads `localStorage` at import time; the plain node test
// environment has none, so stub one in before any of these modules load.
(globalThis as { localStorage?: Storage }).localStorage = memoryStorage();

let settings: typeof import('../src/core/settings').settings;
let tracksForContext: typeof import('../src/audio/music').tracksForContext;
let nextTrackFor: typeof import('../src/audio/music').nextTrackFor;
let setMusicContext: typeof import('../src/audio/music').setMusicContext;
let playSfx: typeof import('../src/audio/sfx').playSfx;

beforeAll(async () => {
  ({ settings } = await import('../src/core/settings'));
  ({ tracksForContext, nextTrackFor, setMusicContext } = await import('../src/audio/music'));
  ({ playSfx } = await import('../src/audio/sfx'));
});

describe('settings persistence (mute/volume/context toggle)', () => {
  it('persists mute, volumes and musicContextAware across an update', () => {
    settings.update({ muted: true, sfxVolume: 12, musicVolume: 34, musicContextAware: false });
    expect(settings.get()).toMatchObject({ muted: true, sfxVolume: 12, musicVolume: 34, musicContextAware: false });
    settings.update({ muted: false, sfxVolume: 80, musicVolume: 55, musicContextAware: true });
  });

  it('mute forces both effective volumes to 0 without touching the sliders', () => {
    settings.update({ muted: true, sfxVolume: 80, musicVolume: 80 });
    expect(settings.sfxVolume()).toBe(0);
    expect(settings.musicVolume()).toBe(0);
    expect(settings.get().sfxVolume).toBe(80); // slider value itself untouched
    settings.update({ muted: false });
  });

  it('musicEnabled off silences music independent of the mute flag', () => {
    settings.update({ musicEnabled: false, musicVolume: 90 });
    expect(settings.musicVolume()).toBe(0);
    settings.update({ musicEnabled: true });
  });

  it('never throws for out-of-range volume values', () => {
    expect(() => settings.update({ sfxVolume: -5 } as Partial<Settings>)).not.toThrow();
    expect(() => settings.update({ musicVolume: 999 } as Partial<Settings>)).not.toThrow();
    settings.update({ sfxVolume: 80, musicVolume: 55 });
  });
});

describe('music context selection', () => {
  it('menu and mexe draw only from their assigned tracks', () => {
    for (const ctx of ['menu', 'mexe'] as const) {
      for (const src of tracksForContext(ctx)) expect(src).not.toMatch(/full-song/);
    }
  });

  it('game draws only from its assigned tracks', () => {
    for (const src of tracksForContext('game')) expect(src).toMatch(/full-song/);
  });

  it('cycles deterministically through a context (fixed rotation, no RNG)', () => {
    settings.update({ musicContextAware: true });
    const list = tracksForContext('menu');
    const picks = list.map(() => nextTrackFor('menu'));
    expect(new Set(picks).size).toBe(list.length); // one full lap touches every track once
    expect(nextTrackFor('menu')).toBe(picks[0]); // then wraps around
  });

  it('falls back to the full catalog and never throws for an unrecognized context', () => {
    const bogus = 'nonexistent' as MusicContext;
    expect(() => tracksForContext(bogus)).not.toThrow();
    expect(tracksForContext(bogus).length).toBeGreaterThan(0);
    expect(() => nextTrackFor(bogus)).not.toThrow();
  });

  it('setMusicContext is safe to call before music has started (no audio element yet)', () => {
    expect(() => setMusicContext('game')).not.toThrow();
    expect(() => setMusicContext('mexe')).not.toThrow();
    expect(() => setMusicContext('menu')).not.toThrow();
  });
});

describe('SFX playback safety', () => {
  function fakeScene(hasAudio: boolean, playImpl: () => void = () => {}) {
    return {
      cache: { audio: { exists: () => hasAudio } },
      sound: { play: vi.fn(playImpl) },
    } as unknown as Parameters<typeof playSfx>[0];
  }

  it('missing audio file is a silent no-op, never a crash', () => {
    const scene = fakeScene(false);
    expect(() => playSfx(scene, 'sfx-does-not-exist')).not.toThrow();
    expect((scene.sound.play as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('a throwing sound engine is swallowed, never a crash', () => {
    const scene = fakeScene(true, () => {
      throw new Error('boom');
    });
    expect(() => playSfx(scene, 'sfx-click')).not.toThrow();
  });

  it('muted settings play nothing', () => {
    settings.update({ muted: true });
    const scene = fakeScene(true);
    playSfx(scene, 'sfx-click');
    expect((scene.sound.play as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    settings.update({ muted: false });
  });

  it('retrigger limiter drops a same-key replay inside the debounce window, allows it after', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    const scene = fakeScene(true);
    nowSpy.mockReturnValue(1000);
    playSfx(scene, 'sfx-pickup');
    nowSpy.mockReturnValue(1010); // 10ms later — inside the 80ms window
    playSfx(scene, 'sfx-pickup');
    expect((scene.sound.play as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(1200); // well past the window
    playSfx(scene, 'sfx-pickup');
    expect((scene.sound.play as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('the debounce is per-key: a different cue plays immediately alongside a debounced one', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5000);
    const scene = fakeScene(true);
    playSfx(scene, 'sfx-drop');
    playSfx(scene, 'sfx-snap');
    expect((scene.sound.play as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });
});
