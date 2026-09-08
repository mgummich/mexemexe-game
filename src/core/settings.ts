import { loadSave, SAVE_KEY, type Progress, type Save, type Settings } from './persistence';

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
    return save.settings.muted ? 0 : save.settings.musicVolume / 100;
  },
  /** 1 normally, 0 when reduced motion is on — multiply cosmetic tween durations by this to make them instant. */
  motionScale(): number {
    return save.settings.reducedMotion ? 0 : 1;
  },
  /** 1 normally, 1.25 when large text is on — multiply font sizes by this via fontStyle(). */
  fontScale(): number {
    return save.settings.largeText ? 1.25 : 1;
  },
};
