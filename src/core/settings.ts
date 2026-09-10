import { helperFlags as computeHelperFlags, type HelperFlags } from '../ui/helpers';
import { loadSave, SAVE_KEY, type Cosmetics, type HelperMode, type Progress, type Save, type Settings } from './persistence';

export type { Settings };

let save: Save = loadSave();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // storage blocked/full — state just won't survive reload
  }
}

/** Small persisted-state singleton: settings (mute, volumes, reduced motion, language) plus progress (last seed, tutorial completion), backed by the versioned `mexe-save` envelope. */
export const settings = {
  get(): Settings {
    return save.settings;
  },
  update(patch: Partial<Settings>): void {
    save = { ...save, settings: { ...save.settings, ...patch } };
    persist();
    listeners.forEach((fn) => fn());
  },
  progress(): Progress {
    return save.progress;
  },
  cosmetics(): Cosmetics {
    return save.cosmetics;
  },
  updateCosmetics(patch: Partial<Cosmetics>): void {
    save = { ...save, cosmetics: { ...save.cosmetics, ...patch } };
    persist();
    listeners.forEach((fn) => fn());
  },
  setLastSeed(seed: number): void {
    save = { ...save, progress: { ...save.progress, lastSeed: seed } };
    persist();
  },
  setTutorialCompleted(): void {
    if (save.progress.tutorialCompleted) return;
    save = { ...save, progress: { ...save.progress, tutorialCompleted: true } };
    persist();
  },
  /** Wipes the save (both keys) and reloads the page with defaults. */
  resetData(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // ignore — nothing to clear
    }
    location.reload();
  },
  onChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  sfxVolume(): number {
    return save.settings.muted ? 0 : save.settings.sfxVolume / 100;
  },
  musicVolume(): number {
    return save.settings.muted || !save.settings.musicEnabled ? 0 : save.settings.musicVolume / 100;
  },
  /** 1 normally, 0 when reduced motion or battery saver is on — multiply cosmetic tween durations by this to make them instant. Battery saver reuses the same knob: it's a decorative-effects cut, not a separate quality system. */
  motionScale(): number {
    return save.settings.reducedMotion || save.settings.batterySaver ? 0 : 1;
  },
  /** 1 normally, 1.25 when large text is on — multiply font sizes by this via fontStyle(). */
  fontScale(): number {
    return save.settings.largeText ? 1.25 : 1;
  },
  helperMode(): HelperMode {
    return save.settings.helperMode;
  },
  /** Display-only UI flags for the current helper mode — never gates rule legality. */
  helperFlags(): HelperFlags {
    return computeHelperFlags(save.settings.helperMode);
  },
};
