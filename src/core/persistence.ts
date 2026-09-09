import type { Locale } from '../localization/i18n';
import { AVATARS, CARD_BACKS, DEFAULT_AVATAR, DEFAULT_CARD_BACK, DEFAULT_TABLE_THEME, resolveCosmeticId, TABLE_THEMES } from '../cosmetics';

/** Display-only helper aggressiveness. See `src/ui/helpers.ts` — never gates rules. */
export type HelperMode = 'beginner' | 'standard' | 'expert';

export interface Settings {
  muted: boolean;
  sfxVolume: number; // 0-100
  musicVolume: number; // 0-100
  /** Ambient background music on/off, independent of the volume slider. */
  musicEnabled: boolean;
  /** On: music tracks are picked by context (menu/game/mexe). Off: plain shuffle across all tracks. */
  musicContextAware: boolean;
  reducedMotion: boolean;
  locale: Locale;
  /** +25% UI text size, for readability. */
  largeText: boolean;
  helperMode: HelperMode;
}

export interface Progress {
  lastSeed: number | null;
  tutorialCompleted: boolean;
}

export interface Cosmetics {
  tableTheme: string;
  cardBack: string;
  avatar: string;
}

export interface Save {
  version: 1;
  settings: Settings;
  progress: Progress;
  cosmetics: Cosmetics;
}

export const DEFAULT_SETTINGS: Settings = { muted: false, sfxVolume: 80, musicVolume: 55, musicEnabled: true, musicContextAware: true, reducedMotion: false, locale: 'pt', largeText: false, helperMode: 'standard' };
const HELPER_MODES: readonly HelperMode[] = ['beginner', 'standard', 'expert'];
export const DEFAULT_PROGRESS: Progress = { lastSeed: null, tutorialCompleted: false };
export const DEFAULT_COSMETICS: Cosmetics = { tableTheme: DEFAULT_TABLE_THEME, cardBack: DEFAULT_CARD_BACK, avatar: DEFAULT_AVATAR };
const DEFAULT_SAVE: Save = { version: 1, settings: { ...DEFAULT_SETTINGS }, progress: { ...DEFAULT_PROGRESS }, cosmetics: { ...DEFAULT_COSMETICS } };

/** Unknown/removed ids (stale save, deleted catalog entry) fall back to defaults instead of crashing. */
function sanitizeCosmetics(partial: Partial<Cosmetics> | undefined): Cosmetics {
  const merged = { ...DEFAULT_COSMETICS, ...(partial ?? {}) };
  return {
    tableTheme: resolveCosmeticId(TABLE_THEMES, merged.tableTheme, DEFAULT_TABLE_THEME),
    cardBack: resolveCosmeticId(CARD_BACKS, merged.cardBack, DEFAULT_CARD_BACK),
    avatar: resolveCosmeticId(AVATARS, merged.avatar, DEFAULT_AVATAR),
  };
}

/** Unknown/corrupt stored value falls back to 'standard' instead of surviving as garbage. */
function sanitizeSettings(partial: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
  return { ...merged, helperMode: HELPER_MODES.includes(merged.helperMode) ? merged.helperMode : 'standard' };
}

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
          settings: sanitizeSettings(parsed.settings),
          progress: { ...DEFAULT_PROGRESS, ...(parsed.progress ?? {}) },
          cosmetics: sanitizeCosmetics(parsed.cosmetics),
        };
      }
    } catch {
      // corrupt JSON — fall through to defaults
    }
  }
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, progress: { ...DEFAULT_PROGRESS }, cosmetics: { ...DEFAULT_COSMETICS } };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** `getItem` throws in Safari with site data blocked, and in webviews with storage disabled — treat that like a `null` return. */
function safeGet(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** A storage that drops everything, for when the real one is unreachable. */
const NULL_STORAGE: StorageLike = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/**
 * Reading the `localStorage` property itself throws (not just its methods) in
 * Safari with site data blocked, so this has to be resolved lazily inside a
 * try — a `storage = localStorage` default parameter would throw before any
 * guard in the body could run, and `loadSave` is called at module scope.
 */
function defaultStorage(): StorageLike {
  try {
    return localStorage;
  } catch {
    return NULL_STORAGE;
  }
}

/**
 * Reads the versioned save, migrating the old unversioned `mexe-settings`
 * key (settings-only, no envelope) into a v1 save on first read and
 * removing the old key. `storage` is injectable for tests; defaults to
 * `localStorage`, or to a no-op storage when that is unreachable.
 */
export function loadSave(storage: StorageLike = defaultStorage()): Save {
  const raw = safeGet(storage, SAVE_KEY);
  if (raw !== null) return parseSave(raw);

  const old = safeGet(storage, OLD_SETTINGS_KEY);
  if (old === null) return { ...DEFAULT_SAVE };

  let oldSettings: Partial<Settings> = {};
  try {
    oldSettings = JSON.parse(old) as Partial<Settings>;
  } catch {
    // corrupt old data — migrate to defaults anyway
  }
  const migrated: Save = { version: 1, settings: { ...DEFAULT_SETTINGS, ...oldSettings }, progress: { ...DEFAULT_PROGRESS }, cosmetics: { ...DEFAULT_COSMETICS } };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(migrated));
    storage.removeItem(OLD_SETTINGS_KEY);
  } catch {
    // storage blocked/full — migrated save just won't persist
  }
  return migrated;
}
