/**
 * App sleep/resume: a phone locking, backgrounding the tab, or switching apps fires
 * `visibilitychange` with no game-specific signal otherwise. `pagehide`/`pageshow` are added on
 * top since iOS Safari sometimes fires those instead (bfcache navigation, some backgrounding
 * paths) without a matching `visibilitychange`.
 */

type Fn = () => void;

interface LifecycleDoc {
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
  visibilityState: string;
}

interface LifecycleWin {
  addEventListener(type: 'pagehide' | 'pageshow', fn: () => void): void;
  removeEventListener(type: 'pagehide' | 'pageshow', fn: () => void): void;
}

/** Subscribes to the app going hidden (backgrounded, screen locked, tab switched away). Returns
 * an unsubscribe. `doc`/`win` default to `document`/`window`, injectable for tests (vitest runs
 * in a node env with neither). */
export function onAppHidden(fn: Fn, doc: LifecycleDoc = document, win: LifecycleWin = window): () => void {
  const onVis = (): void => {
    if (doc.visibilityState === 'hidden') fn();
  };
  doc.addEventListener('visibilitychange', onVis);
  win.addEventListener('pagehide', fn);
  return () => {
    doc.removeEventListener('visibilitychange', onVis);
    win.removeEventListener('pagehide', fn);
  };
}

/** Subscribes to the app becoming visible again. Returns an unsubscribe. */
export function onAppVisible(fn: Fn, doc: LifecycleDoc = document, win: LifecycleWin = window): () => void {
  const onVis = (): void => {
    if (doc.visibilityState === 'visible') fn();
  };
  doc.addEventListener('visibilitychange', onVis);
  win.addEventListener('pageshow', fn);
  return () => {
    doc.removeEventListener('visibilitychange', onVis);
    win.removeEventListener('pageshow', fn);
  };
}
