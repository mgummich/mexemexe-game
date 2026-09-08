import type { Locale } from '../localization/i18n';

export interface Settings {
  muted: boolean;
  sfxVolume: number; // 0-100
  musicVolume: number; // 0-100
  reducedMotion: boolean;
  locale: Locale;
  /** +25% UI text size, for readability. */
  largeText: boolean;
}

export interface Progress {
  lastSeed: number | null;
  tutorialCompleted: boolean;
}

export interface Save {
  version: 1;
  settings: Settings;
  progress: Progress;
}

export const DEFAULT_SETTINGS: Settings = { muted: false, sfxVolume: 80, musicVolume: 55, reducedMotion: false, locale: 'pt', largeText: false };
export const DEFAULT_PROGRESS: Progress = { lastSeed: null, tutorialCompleted: false };
const DEFAULT_SAVE: Save = { version: 1, settings: { ...DEFAULT_SETTINGS }, progress: { ...DEFAULT_PROGRESS } };

export const SAVE_KEY = 'mexe-save';
export const OLD_SETTINGS_KEY = 'mexe-settings';

/** Pure: parse a `mexe-save` localStorage value into a valid v1 Save. Corrupt/unparseable/wrong-shape input falls back to defaults, never throws. */
export function parseSave(raw: string | null): Save {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Save> | null;
      if (parsed && typeof parsed === 'object' && parsed.version === 1) {
        return {
          version: 1,
          settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
          progress: { ...DEFAULT_PROGRESS, ...(parsed.progress ?? {}) },
        };
      }
    } catch {
      // corrupt JSON — fall through to defaults
    }
  }
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, progress: { ...DEFAULT_PROGRESS } };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Reads the versioned save, migrating the old unversioned `mexe-settings`
 * key (settings-only, no envelope) into a v1 save on first read and
 * removing the old key. `storage` is injectable for tests; defaults to
 * `localStorage`.
 */
export function loadSave(storage: StorageLike = localStorage): Save {
  const raw = storage.getItem(SAVE_KEY);
  if (raw !== null) return parseSave(raw);

  const old = storage.getItem(OLD_SETTINGS_KEY);
  if (old === null) return { ...DEFAULT_SAVE };

  let oldSettings: Partial<Settings> = {};
  try {
    oldSettings = JSON.parse(old) as Partial<Settings>;
  } catch {
    // corrupt old data — migrate to defaults anyway
  }
  const migrated: Save = { version: 1, settings: { ...DEFAULT_SETTINGS, ...oldSettings }, progress: { ...DEFAULT_PROGRESS } };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(migrated));
    storage.removeItem(OLD_SETTINGS_KEY);
  } catch {
    // storage blocked/full — migrated save just won't persist
  }
  return migrated;
}
