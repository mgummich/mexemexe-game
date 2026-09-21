import type { AiSpeed, Difficulty } from '../ai/ai';
import type { Locale } from '../localization/i18n';
import { AVATARS, CARD_BACKS, DEFAULT_AVATAR, DEFAULT_CARD_BACK, DEFAULT_TABLE_THEME, resolveCosmeticId, TABLE_THEMES } from '../cosmetics';
import { BLITZ_TURN_BOUNDS, type BlitzDifficulty } from '../game-state/timing';

/** Display-only helper aggressiveness. See `src/ui/helpers.ts` — never gates rules. */
export type HelperMode = 'beginner' | 'standard' | 'expert';

/** How much an AI move explains itself in the last-move line. */
type AiExplain = 'off' | 'simple' | 'detailed';

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
  /** Trims non-essential decorative effects (on top of reducedMotion) for weaker/battery-limited devices. */
  batterySaver: boolean;
  /** How deeply the AI opponents search. Fairness-neutral: it is a local-play setting and the
   * AI never sees a hidden hand at any tier (see src/ai/ai.ts). */
  aiDifficulty: Difficulty;
  /** Presentation only — scales the pre-move "thinking" pause. */
  aiSpeed: AiSpeed;
  /** Whether an AI move is described in the last-move line, and how fully. */
  aiExplain: AiExplain;
  /**
   * Short vibration on touch actions, where the browser supports it (Android Chrome does; iOS
   * Safari has no Vibration API at all, so this is simply inert there). On by default and easy to
   * turn off — it is a third confirmation channel alongside the visual and the sound, not a
   * replacement for either.
   */
  haptics: boolean;
  /** Ticking cue over the last seconds of an online turn timer. Mixed through the SFX volume. */
  timerTickSound: boolean;
  /**
   * Local MexeMexe Blitz: the same game with a fixed per-turn clock, picked on the setup screen.
   * 'off' by default — a clock a player did not ask for is a different game, not a nicer one.
   * A difficulty is a set of defaults (turn length + assist strengths), never a lock.
   */
  speedMode: 'off' | BlitzDifficulty | 'tempo';
  /** Turn length for the `custom` difficulty only, clamped to `BLITZ_TURN_BOUNDS`. */
  blitzTurnMs: number;
  /** Blitz assistance, each independently disableable (never bundled into one "assists" switch):
   * the Panic Button's emergency extension, and the Last Breath window a turn gets when its clock
   * runs out. */
  blitzPanic: boolean;
  blitzLastBreath: boolean;
  /**
   * Commit play: no undo, no redo, no reset while a turn is being built. Exploration is still
   * free — a card already on the table can be moved, split or merged — but the history is gone,
   * so a placement is a decision rather than a draft. Off by default, and local play only until
   * a matchmade room can advertise it.
   */
  commitPlay: boolean;
}

export interface Progress {
  lastSeed: number | null;
  tutorialCompleted: boolean;
  /**
   * How many real (non-tutorial) games this browser has started. A count, never an identifier:
   * it lets the local playtest log say "this was the player's second game" without knowing who
   * the player is. Storing a session id or timestamp here would trip tests/no-telemetry.test.ts,
   * and rightly so.
   */
  gamesStarted: number;
  /**
   * Wins and losses against each of the four built-in characters, for local matches. A plain
   * tally so the results screen can say "you are 3-1 against Dona Cida" — never a score, a streak
   * bonus, an unlock or a currency (see RESULT-14). Keyed by personality id, so it holds nothing
   * about any person.
   */
  headToHead: Record<string, { wins: number; losses: number }>;
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

export const DEFAULT_SETTINGS: Settings = { muted: false, sfxVolume: 80, musicVolume: 55, musicEnabled: false, musicContextAware: true, reducedMotion: false, locale: 'pt', largeText: false, helperMode: 'standard', batterySaver: false, aiDifficulty: 'smart', aiSpeed: 'normal', aiExplain: 'simple', timerTickSound: true, haptics: false, speedMode: 'off', blitzTurnMs: 9_000, blitzPanic: true, blitzLastBreath: true, commitPlay: false };
const HELPER_MODES: readonly HelperMode[] = ['beginner', 'standard', 'expert'];
const SPEED_MODES: readonly Settings['speedMode'][] = ['off', 'easy', 'medium', 'hard', 'expert', 'custom', 'tempo'];

/** A stored number outside its bounds is clamped, like every other untrusted stored value here. */
function clampMs(value: unknown, [lo, hi]: readonly [number, number], fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}
export const AI_DIFFICULTIES: readonly Difficulty[] = ['beginner', 'casual', 'smart', 'expert'];
export const AI_SPEEDS: readonly AiSpeed[] = ['instant', 'fast', 'normal', 'slow'];
export const AI_EXPLAIN_MODES: readonly AiExplain[] = ['off', 'simple', 'detailed'];

/** An unknown stored value (older save, hand-edited storage) falls back to its default instead
 * of surviving as garbage that later indexes a lookup table with `undefined`. */
function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
export const DEFAULT_PROGRESS: Progress = { lastSeed: null, tutorialCompleted: false, gamesStarted: 0, headToHead: {} };
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
  return {
    ...merged,
    helperMode: HELPER_MODES.includes(merged.helperMode) ? merged.helperMode : 'standard',
    batterySaver: typeof merged.batterySaver === 'boolean' ? merged.batterySaver : DEFAULT_SETTINGS.batterySaver,
    aiDifficulty: oneOf(AI_DIFFICULTIES, merged.aiDifficulty, DEFAULT_SETTINGS.aiDifficulty),
    aiSpeed: oneOf(AI_SPEEDS, merged.aiSpeed, DEFAULT_SETTINGS.aiSpeed),
    aiExplain: oneOf(AI_EXPLAIN_MODES, merged.aiExplain, DEFAULT_SETTINGS.aiExplain),
    timerTickSound: typeof merged.timerTickSound === 'boolean' ? merged.timerTickSound : DEFAULT_SETTINGS.timerTickSound,
    haptics: typeof merged.haptics === 'boolean' ? merged.haptics : DEFAULT_SETTINGS.haptics,
    speedMode: oneOf(SPEED_MODES, merged.speedMode, DEFAULT_SETTINGS.speedMode),
    blitzTurnMs: clampMs(merged.blitzTurnMs, BLITZ_TURN_BOUNDS, DEFAULT_SETTINGS.blitzTurnMs),
    blitzPanic: typeof merged.blitzPanic === 'boolean' ? merged.blitzPanic : DEFAULT_SETTINGS.blitzPanic,
    blitzLastBreath: typeof merged.blitzLastBreath === 'boolean' ? merged.blitzLastBreath : DEFAULT_SETTINGS.blitzLastBreath,
    commitPlay: typeof merged.commitPlay === 'boolean' ? merged.commitPlay : DEFAULT_SETTINGS.commitPlay,
  };
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

/** The platform preferences first-run settings are allowed to follow. Injectable so tests (and
 * the node environment, which has no `matchMedia`) can be explicit. */
export type PlatformPrefs = { reducedMotion?: boolean };

/**
 * Pure: the first-run settings that should follow the platform rather than a hardcoded default.
 * Applied only when there is no save at all — once a player has touched Settings, their choice
 * owns the value and the platform never overrides it again.
 *
 * Only reduced motion. A player who already asked their system for less motion should not have to
 * find the same switch in a game menu. The *language* deliberately stays pt-BR regardless of what
 * the browser reports: it is the product's default, not a preference to be guessed at, and the
 * language button is one tap from the menu.
 */
export function systemSettings(env: PlatformPrefs): Partial<Settings> {
  return { reducedMotion: env.reducedMotion === true };
}

/** Reads the preference above. Guarded: `matchMedia` is absent in the node test environment and
 * throws in some webviews. */
function readPlatformPrefs(): PlatformPrefs {
  try {
    return { reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches };
  } catch {
    return {};
  }
}

/**
 * Reads the versioned save, migrating the old unversioned `mexe-settings`
 * key (settings-only, no envelope) into a v1 save on first read and
 * removing the old key. `storage` is injectable for tests; defaults to
 * `localStorage`, or to a no-op storage when that is unreachable.
 */
export function loadSave(storage: StorageLike = defaultStorage(), prefs: PlatformPrefs = readPlatformPrefs()): Save {
  const freshSave = (): Save => ({ ...DEFAULT_SAVE, settings: { ...DEFAULT_SETTINGS, ...systemSettings(prefs) } });
  const raw = safeGet(storage, SAVE_KEY);
  if (raw !== null) return parseSave(raw);

  const old = safeGet(storage, OLD_SETTINGS_KEY);
  if (old === null) return freshSave();

  let oldSettings: Partial<Settings> = {};
  try {
    oldSettings = JSON.parse(old) as Partial<Settings>;
  } catch {
    // corrupt old data — migrate to defaults anyway
  }
  // A migrated save already carries the player's own settings — only the keys it never had
  // fall back, and those fall back to the platform's answer like a first run would.
  const fresh = freshSave();
  const migrated: Save = { ...fresh, settings: { ...fresh.settings, ...oldSettings } };
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(migrated));
    storage.removeItem(OLD_SETTINGS_KEY);
  } catch {
    // storage blocked/full — migrated save just won't persist
  }
  return migrated;
}

/** Writes the save. Storage being blocked or full is not fatal — the state just won't survive a reload. */
export function storeSave(save: Save, storage: StorageLike = defaultStorage()): void {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // storage blocked/full — state just won't survive reload
  }
}

/** Removes both the versioned save and the pre-v1 key, so a reset can't be undone by the migration in `loadSave`. */
export function clearSave(storage: StorageLike = defaultStorage()): void {
  try {
    storage.removeItem(SAVE_KEY);
    storage.removeItem(OLD_SETTINGS_KEY);
  } catch {
    // storage blocked — there was nothing persisted to clear
  }
}
