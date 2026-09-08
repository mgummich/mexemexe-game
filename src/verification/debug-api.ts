import type { DraftState, GameState } from '../rules/types';
import { settings } from '../core/settings';

/** Exposed on window.__MEXE__ for Playwright verification. */
export interface MexeDebugApi {
  ready: boolean;
  seed: number;
  scene: string;
  fps: number;
  errors: string[];
  missingAssets: string[];
  validation: { ok: boolean; reasons: string[] } | null;
  state: (() => GameState | null) | null;
  showcase: string | null;
  /** Current interactive-tutorial step index (0-based), or null outside tutorial mode. */
  tutorialStep: number | null;
  /** Explanation text of the most recent AI decision (`ai:thought`), or null before any AI turn. */
  lastAiThought: string | null;
  /** Accessibility state for e2e: count of meld zones currently showing the invalid (✗) badge. */
  a11y: { invalidBadges: number };
  /** Live Mexe Mode hooks for e2e (bound to the active DraftEditor on human turns). */
  mexe: {
    playHandCard: (cardId: string, meldId: string | null) => boolean;
    moveTableCard: (cardId: string, meldId: string | null) => boolean;
    undo: () => boolean;
    feito: () => boolean;
    comprar: () => void;
    /** Current Mexe Mode draft (melds may be temporarily invalid), for e2e. */
    getDraft: () => DraftState | null;
  } | null;
}

declare global {
  interface Window {
    __MEXE__: MexeDebugApi;
  }
}

export const debugApi: MexeDebugApi = {
  ready: false,
  seed: 0,
  scene: 'boot',
  fps: 0,
  errors: [],
  missingAssets: [],
  validation: null,
  state: null,
  showcase: null,
  tutorialStep: null,
  lastAiThought: null,
  a11y: { invalidBadges: 0 },
  mexe: null,
};

export function installDebugApi(): void {
  window.__MEXE__ = debugApi;
  window.addEventListener('error', (e) => {
    debugApi.errors.push(String(e.message));
  });
  window.addEventListener('unhandledrejection', (e) => {
    debugApi.errors.push(`unhandledrejection: ${String(e.reason)}`);
  });
  const params = new URLSearchParams(location.search);
  debugApi.showcase = params.get('showcase');
  const lang = params.get('lang');
  if (lang === 'en' || lang === 'pt') settings.update({ locale: lang });
  // e2e hook mirroring ?lang= — ?textscale=125 flips the large-text setting on for a11y screenshot capture.
  if (params.get('textscale') === '125') settings.update({ largeText: true });
}

export function urlSeed(): number {
  const raw = new URLSearchParams(location.search).get('seed');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : Date.now() % 2147483647;
}
