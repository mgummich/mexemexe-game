import { settings } from '../core/settings';
import { onAppHidden, onAppVisible } from '../core/lifecycle';
import { debugApi } from '../verification/debug-api';

/**
 * Ambient background music: a plain HTMLAudioElement (not the Phaser
 * loader, so nothing is preloaded — ~11MB of mp3) streamed over 5 tracks,
 * picked by context so the player gets calmer music during Mexe (the
 * concentration-heavy draft) than during general play. Playback survives
 * scene changes on its own; scenes just call setMusicContext().
 */
export type MusicContext = 'menu' | 'game' | 'mexe';

interface Track {
  src: string;
  contexts: MusicContext[];
}

// Mapping (see AUDIO_DIRECTION.md): the two shorter "table/cafe" loops are
// calm enough for the menu AND for Mexe's heads-down draft moment; the three
// fuller songs carry general gameplay where a bit more energy is welcome.
const TRACKS: Track[] = [
  { src: 'assets/audio/music/boteco-table.mp3', contexts: ['menu', 'mexe'] },
  { src: 'assets/audio/music/cafe-pixelado.mp3', contexts: ['menu', 'mexe'] },
  { src: 'assets/audio/music/full-song-1.mp3', contexts: ['game'] },
  { src: 'assets/audio/music/full-song-2.mp3', contexts: ['game'] },
  { src: 'assets/audio/music/full-song-3.mp3', contexts: ['game'] },
];
const ALL_TRACKS = TRACKS.map((t) => t.src);

/** Tracks assigned to a context; falls back to the full catalog if a context ends up with none (never plays nothing). */
export function tracksForContext(ctx: MusicContext): string[] {
  const list = TRACKS.filter((t) => t.contexts.includes(ctx)).map((t) => t.src);
  return list.length > 0 ? list : ALL_TRACKS;
}

const rotation = new Map<string, number>();

/** Next track for a context: fixed round-robin per context (deterministic — no RNG). Plain-shuffle mode (settings.musicContextAware off) rotates the full catalog instead. */
export function nextTrackFor(ctx: MusicContext): string {
  const list = settings.get().musicContextAware ? tracksForContext(ctx) : ALL_TRACKS;
  const key = settings.get().musicContextAware ? ctx : '*';
  const i = (rotation.get(key) ?? 0) % list.length;
  rotation.set(key, i + 1);
  return list[i]!;
}

const FADE_MS = 900;

let audio: HTMLAudioElement | null = null;
let context: MusicContext = 'menu';
let fadeTimer: ReturnType<typeof setTimeout> | null = null;

function play(): void {
  audio?.play().catch(() => {
    // autoplay blocked (or music turned off mid-load) — resumed on the next gesture/settings change
  });
}

/** Ramps `audio.volume` from its current value to `target` over `ms` (0 = instant, used for reduced motion). Cancels any fade already in flight. */
function fadeTo(target: number, ms: number, onDone?: () => void): void {
  if (fadeTimer) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  if (!audio || ms <= 0) {
    if (audio) audio.volume = target;
    onDone?.();
    return;
  }
  const steps = 8;
  const stepMs = ms / steps;
  const start = audio.volume;
  let i = 0;
  const tick = (): void => {
    if (!audio) return;
    i++;
    audio.volume = i >= steps ? target : start + ((target - start) * i) / steps;
    if (i < steps) fadeTimer = setTimeout(tick, stepMs);
    else {
      fadeTimer = null;
      onDone?.();
    }
  };
  tick();
}

/** Fades out, swaps to the next track for the current context, fades back in (skipped/instant under reduced motion). */
function changeTrack(): void {
  if (!audio) return;
  const targetVol = settings.musicVolume();
  const fadeMs = FADE_MS * settings.motionScale();
  fadeTo(0, fadeMs, () => {
    if (!audio) return;
    audio.pause();
    audio.src = nextTrackFor(context);
    audio.currentTime = 0;
    audio.volume = 0;
    if (targetVol > 0) {
      play();
      fadeTo(targetVol, fadeMs);
    }
  });
}

/** Applies the current music volume; volume 0 (muted or music off) pauses instead of playing silence. Leaves an in-flight fade alone. */
function applyVolume(): void {
  if (!audio || fadeTimer) return;
  const vol = settings.musicVolume();
  audio.volume = vol;
  if (vol <= 0) audio.pause();
  else if (audio.paused) play();
}

/** Switches which track pool the playlist draws from. No-op if the context hasn't changed or music hasn't started yet (the next start picks it up). */
export function setMusicContext(ctx: MusicContext): void {
  if (ctx === context) return;
  context = ctx;
  if (audio) changeTrack();
}

/** Starts the playlist. Safe to call more than once — only the first call takes effect. */
export function startMusic(): void {
  if (audio) return;
  audio = new Audio(nextTrackFor(context));
  audio.volume = settings.musicVolume();
  audio.addEventListener('ended', () => {
    if (!audio) return;
    audio.src = nextTrackFor(context);
    play();
  });
  settings.onChange(applyVolume);

  // Browsers block autoplay until the player interacts with the page. Once playback actually
  // gets going, these listeners have done their job — remove them instead of leaving two
  // page-lifetime listeners firing on every pointerdown/keydown for nothing.
  const unlock = (): void => {
    if (!audio) return;
    if (audio.paused && settings.musicVolume() > 0) play();
    if (!audio.paused) {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  // App sleep/resume: pause while backgrounded so a locked phone doesn't keep decoding audio,
  // resume on return only if the player still wants music (muted/off must stay silent).
  onAppHidden(() => audio?.pause());
  onAppVisible(() => {
    if (audio && audio.paused && settings.musicVolume() > 0) play();
  });

  debugApi.music = () => ({
    track: audio?.src.split('/').pop() ?? '',
    playing: !!audio && !audio.paused,
    volume: audio?.volume ?? 0,
    context,
  });

  if (settings.musicVolume() > 0) play();
}
