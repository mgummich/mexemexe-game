import { settings } from '../core/settings';
import { debugApi } from '../verification/debug-api';

/**
 * Ambient background music: a shuffled playlist streamed through a plain
 * HTMLAudioElement rather than the Phaser loader, so nothing is preloaded
 * (~11MB of mp3) and playback survives scene changes on its own.
 */
const TRACKS = [
  'assets/audio/music/boteco-table.mp3',
  'assets/audio/music/cafe-pixelado.mp3',
  'assets/audio/music/full-song-1.mp3',
  'assets/audio/music/full-song-2.mp3',
  'assets/audio/music/full-song-3.mp3',
];

let audio: HTMLAudioElement | null = null;
let queue: string[] = [];

/** Next track in the shuffled queue; reshuffles once the queue runs dry. */
function nextTrack(): string {
  if (queue.length === 0) {
    queue = [...TRACKS];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j]!, queue[i]!];
    }
  }
  return queue.pop()!;
}

function play(): void {
  audio?.play().catch(() => {
    // autoplay blocked (or music turned off mid-load) — resumed on the next gesture/settings change
  });
}

/** Applies the current music volume; volume 0 (muted or music off) pauses instead of playing silence. */
function applyVolume(): void {
  if (!audio) return;
  const vol = settings.musicVolume();
  audio.volume = vol;
  if (vol <= 0) audio.pause();
  else if (audio.paused) play();
}

/** Starts the playlist. Safe to call more than once — only the first call takes effect. */
export function startMusic(): void {
  if (audio) return;
  audio = new Audio(nextTrack());
  audio.volume = settings.musicVolume();
  audio.addEventListener('ended', () => {
    if (!audio) return;
    audio.src = nextTrack();
    play();
  });
  settings.onChange(applyVolume);

  // Browsers block autoplay until the player interacts with the page.
  const unlock = (): void => {
    if (audio && audio.paused && settings.musicVolume() > 0) play();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  debugApi.music = () => ({
    track: audio?.src.split('/').pop() ?? '',
    playing: !!audio && !audio.paused,
    volume: audio?.volume ?? 0,
  });

  if (settings.musicVolume() > 0) play();
}
