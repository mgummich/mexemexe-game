import { describe, expect, it } from 'vitest';
import { DEFAULT_COSMETICS, DEFAULT_PROGRESS, DEFAULT_SETTINGS, loadSave, OLD_SETTINGS_KEY, parseSave, SAVE_KEY, type Save } from '../src/core/persistence';

/** Minimal in-memory Storage stand-in — avoids pulling jsdom into the node test env. */
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

describe('parseSave', () => {
  it('defaults on null', () => {
    expect(parseSave(null)).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
  });

  it('defaults on unparseable JSON', () => {
    expect(parseSave('not json{{{')).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
  });

  it('defaults on wrong shape (no version)', () => {
    expect(parseSave(JSON.stringify({ muted: true }))).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
  });

  it('defaults on an array or primitive', () => {
    expect(parseSave('[1,2,3]')).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
    expect(parseSave('42')).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
  });

  it('round-trips a valid v1 save', () => {
    const save: Save = {
      version: 1,
      settings: { muted: true, sfxVolume: 10, musicVolume: 20, musicEnabled: false, musicContextAware: false, reducedMotion: true, locale: 'en', largeText: true },
      progress: { lastSeed: 1234, tutorialCompleted: true },
      cosmetics: { tableTheme: 'quintal', cardBack: 'back-4', avatar: 'bia' },
    };
    expect(parseSave(JSON.stringify(save))).toEqual(save);
  });

  it('fills in missing fields from a partial v1 save', () => {
    const partial = { version: 1, settings: { muted: true }, progress: { lastSeed: 7 } };
    const result = parseSave(JSON.stringify(partial));
    expect(result.settings).toEqual({ ...DEFAULT_SETTINGS, muted: true });
    expect(result.progress).toEqual({ ...DEFAULT_PROGRESS, lastSeed: 7 });
    expect(result.cosmetics).toEqual(DEFAULT_COSMETICS);
  });

  it('an old save with no cosmetics block migrates to defaults', () => {
    const partial = { version: 1, settings: { muted: true }, progress: {} };
    expect(parseSave(JSON.stringify(partial)).cosmetics).toEqual(DEFAULT_COSMETICS);
  });

  it('falls back to the default id for an unknown/removed cosmetic id instead of crashing', () => {
    const partial = { version: 1, cosmetics: { tableTheme: 'nonexistent', cardBack: 'back-99', avatar: 'not-a-real-avatar' } };
    const result = parseSave(JSON.stringify(partial));
    expect(result.cosmetics).toEqual(DEFAULT_COSMETICS);
  });

  it('keeps known cosmetic ids while defaulting only the unknown ones', () => {
    const partial = { version: 1, cosmetics: { tableTheme: 'quintal', cardBack: 'not-a-back' } };
    const result = parseSave(JSON.stringify(partial));
    expect(result.cosmetics).toEqual({ ...DEFAULT_COSMETICS, tableTheme: 'quintal' });
  });
});

describe('loadSave', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadSave(memoryStorage())).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
  });

  it('reads an existing v1 save directly', () => {
    const save: Save = { version: 1, settings: { ...DEFAULT_SETTINGS, muted: true }, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS };
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify(save) });
    expect(loadSave(storage)).toEqual(save);
  });

  it('round-trips a chosen cosmetics selection through save/load', () => {
    const save: Save = {
      version: 1,
      settings: DEFAULT_SETTINGS,
      progress: DEFAULT_PROGRESS,
      cosmetics: { tableTheme: 'feira', cardBack: 'back-2', avatar: 'ze' },
    };
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify(save) });
    expect(loadSave(storage)).toEqual(save);
  });

  it('migrates the old unversioned settings key and removes it', () => {
    const oldSettings = { muted: true, sfxVolume: 33, musicVolume: 44, reducedMotion: true, locale: 'en' };
    const storage = memoryStorage({ [OLD_SETTINGS_KEY]: JSON.stringify(oldSettings) });
    const result = loadSave(storage);
    expect(result).toEqual({ version: 1, settings: { ...oldSettings, musicEnabled: true, musicContextAware: true, largeText: false }, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
    expect(storage.getItem(SAVE_KEY)).toBe(JSON.stringify(result));
    expect(storage.getItem(OLD_SETTINGS_KEY)).toBeNull();
  });

  it('migrates to defaults when the old key is corrupt', () => {
    const storage = memoryStorage({ [OLD_SETTINGS_KEY]: 'not json' });
    const result = loadSave(storage);
    expect(result).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
    expect(storage.getItem(OLD_SETTINGS_KEY)).toBeNull();
  });

  it('ignores the old key once a v1 save exists', () => {
    const save: Save = { version: 1, settings: DEFAULT_SETTINGS, progress: { lastSeed: 5, tutorialCompleted: true }, cosmetics: DEFAULT_COSMETICS };
    const storage = memoryStorage({ [SAVE_KEY]: JSON.stringify(save), [OLD_SETTINGS_KEY]: JSON.stringify({ muted: true }) });
    expect(loadSave(storage)).toEqual(save);
    expect(storage.getItem(OLD_SETTINGS_KEY)).not.toBeNull(); // untouched — no migration needed
  });

  it('falls back to defaults when the new key is corrupt (no crash)', () => {
    const storage = memoryStorage({ [SAVE_KEY]: '{{{not json' });
    expect(loadSave(storage)).toEqual({ version: 1, settings: DEFAULT_SETTINGS, progress: DEFAULT_PROGRESS, cosmetics: DEFAULT_COSMETICS });
  });
});
