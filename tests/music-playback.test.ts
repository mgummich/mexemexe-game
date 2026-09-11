import { describe, expect, it, beforeAll, beforeEach } from 'vitest';

/** Minimal in-memory Storage stand-in — the settings singleton reads localStorage at import time. */
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

/** Stand-in for HTMLAudioElement: enough surface for music.ts (src/volume/play/pause/listeners). */
class FakeAudio {
  src: string;
  volume = 1;
  currentTime = 0;
  paused = true;
  constructor(src = '') {
    this.src = src;
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

const g = globalThis as Record<string, unknown>;
g.localStorage = memoryStorage();
g.Audio = FakeAudio;
g.window = { addEventListener: () => {}, removeEventListener: () => {} };
g.document = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' };

let settings: typeof import('../src/core/settings').settings;
let setMusicContext: typeof import('../src/audio/music').setMusicContext;
let startMusic: typeof import('../src/audio/music').startMusic;
let debugApi: typeof import('../src/verification/debug-api').debugApi;

const track = (): string => debugApi.music?.().track ?? '';

beforeAll(async () => {
  ({ settings } = await import('../src/core/settings'));
  ({ setMusicContext, startMusic } = await import('../src/audio/music'));
  ({ debugApi } = await import('../src/verification/debug-api'));
  // reducedMotion makes fades instant, so a track swap lands synchronously.
  settings.update({ reducedMotion: true, musicEnabled: true, muted: false, musicVolume: 50, musicContextAware: true });
  startMusic();
});

beforeEach(() => {
  setMusicContext('menu');
});

describe('music track changes', () => {
  it('keeps playing the same track across turn flips between game and mexe', () => {
    setMusicContext('game');
    const playing = track();
    // Every turn hand-off flips mexe <-> game; the player hears one swap per draw if these swap.
    for (let i = 0; i < 4; i++) {
      setMusicContext('mexe');
      expect(track()).toBe(playing);
      setMusicContext('game');
      expect(track()).toBe(playing);
    }
  });

  it('still swaps tracks when leaving or entering the menu', () => {
    const menuTrack = track();
    setMusicContext('game');
    expect(track()).not.toBe(menuTrack);
    const gameTrack = track();
    setMusicContext('menu');
    expect(track()).not.toBe(gameTrack);
  });
});
