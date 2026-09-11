import { t } from '../localization/i18n';
import { debugApi } from '../verification/debug-api';

/** True when the browser reports no network. `navigator` doesn't exist under the vitest node
 * environment, so guard it — importing this module in a unit test must never throw. */
export function isOffline(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}

interface ConnectivityTarget {
  addEventListener(type: 'online' | 'offline', fn: () => void): void;
  removeEventListener(type: 'online' | 'offline', fn: () => void): void;
}

/** Subscribes to browser online/offline events; returns an unsubscribe. `target` defaults to
 * `window` but is injectable so a unit test (node env, no real `window`) can stub it. */
export function onConnectivityChange(
  fn: (offline: boolean) => void,
  target: ConnectivityTarget = window,
): () => void {
  const onOnline = (): void => fn(false);
  const onOffline = (): void => fn(true);
  target.addEventListener('online', onOnline);
  target.addEventListener('offline', onOffline);
  return () => {
    target.removeEventListener('online', onOnline);
    target.removeEventListener('offline', onOffline);
  };
}

// ---------- offline / update banners ----------
// Same inline-cssText recipe as the portrait hint / error toast in src/main.ts (no stylesheet in
// this project), same palette, z-index kept below the error toast's 9999.
function makeBanner(bottom: number, pointerEvents: 'none' | 'auto'): HTMLDivElement {
  const el = document.createElement('div');
  // e2e-pwa selects the banners by this; they are otherwise unmarked inline-styled divs.
  el.dataset.mexeBanner = 'update';
  el.style.cssText =
    `position:fixed;left:50%;bottom:calc(${bottom}px + env(safe-area-inset-bottom));transform:translateX(-50%);display:none;` +
    `background:#1a1410;color:#f7d23e;border:1px solid #f7d23e;padding:6px 12px;` +
    `font:12px monospace;border-radius:4px;z-index:9990;opacity:0.95;pointer-events:${pointerEvents};`;
  document.body.appendChild(el);
  return el;
}

function setupOfflineBanner(): void {
  const el = document.createElement('div');
  el.dataset.mexeBanner = 'offline';
  el.style.cssText =
    // top:44px, not 12px — clears src/main.ts's portraitHint box (top:12px, ~28px tall) so the
    // two don't stack during the hint's first 6s in portrait.
    // Both offsets add the safe-area inset — see the portrait hint in src/main.ts.
    'position:fixed;left:50%;top:calc(44px + env(safe-area-inset-top));transform:translateX(-50%);display:none;' +
    'background:#1a1410;color:#f7d23e;border:1px solid #f7d23e;padding:6px 12px;' +
    'font:12px monospace;border-radius:4px;z-index:9990;opacity:0.95;pointer-events:none;';
  document.body.appendChild(el);
  const render = (offline: boolean): void => {
    debugApi.offline = offline;
    el.textContent = t('offline.banner');
    el.style.display = offline ? 'block' : 'none';
  };
  render(isOffline());
  onConnectivityChange(render);
}

/** One banner per page: 'updatefound' can fire more than once (a third worker installs while
 * the second is still waiting), and a second stacked banner would sit on top of the first. */
let updateBannerShown = false;

/** Set the moment the player asks the waiting worker to take over. The controllerchange
 * reload below keys off this so it can only ever fire for an update the player chose. */
let updateRequested = false;

function showUpdateBanner(reg: ServiceWorkerRegistration): void {
  if (updateBannerShown) return;
  updateBannerShown = true;
  const el = makeBanner(100, 'auto');
  el.textContent = `${t('update.available')} [${t('update.now')}]`;
  el.style.cursor = 'pointer';
  // It's a tap target, not a notice — clear the 44px floor (6px padding + 12px text is ~30px).
  el.style.minHeight = '44px';
  el.style.boxSizing = 'border-box';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.addEventListener('click', () => {
    updateRequested = true;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });
}

function registerServiceWorker(): void {
  // Vite build uses base:'./' — resolve relative to the current page, not the site root.
  navigator.serviceWorker
    .register(new URL('sw.js', location.href))
    .then((reg) => {
      // Reload once the new worker takes control — guarded so a second controllerchange (some
      // browsers fire it more than once) can't reload twice.
      //
      // updateRequested is the important half: sw.js's activate handler calls
      // clients.claim(), so the *first ever* install also fires controllerchange, on a page
      // that is still booting. Reloading there threw away a cold boot's worth of asset
      // loading for nothing. Only an update the player tapped needs the page swapped.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!updateRequested || reloaded) return;
        reloaded = true;
        location.reload();
      });
      // A worker that finished installing during an earlier visit is already waiting when we
      // get here, and 'updatefound' will never fire again for it. Without this check that
      // build sits unused and the stale one keeps being served until the browser happens to
      // find yet another update. Requiring a controller keeps the first install quiet.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
      // An installed PWA can stay open for days, and browsers only check for a new worker on
      // navigation — so re-check whenever the app comes back to the foreground. Cheap (a 304
      // on the unchanged sw.js) and it never reloads on its own: it can at most surface the
      // update banner, which the player still has to tap.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update().catch(() => { /* offline or blocked — try again next resume */ });
      });
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // installed + an existing controller means an update, not the first install — the
          // first install has nothing to "update available" about.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });
    })
    .catch(() => {
      // registration refused (insecure origin, policy, etc) — never break boot over this
    });
}

/** Called once from main.ts. Registers the service worker in prod, keeps dev clean of any
 * stale worker, and mounts the offline/update banners. Never allowed to throw: a browser with
 * no/blocked service worker support must still boot normally. */
export function initPwa(): void {
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      if (import.meta.env.PROD) {
        registerServiceWorker();
      } else {
        // DEV: a worker registered during an earlier production visit to this origin would
        // otherwise serve cached files over the Vite dev server and break hot reload.
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((r) => void r.unregister()))
          .catch(() => { /* nothing to clean up, or blocked — fine either way */ });
      }
    }
  } catch {
    // service workers unsupported/blocked — never break boot
  }
  try {
    setupOfflineBanner();
  } catch {
    // no DOM (shouldn't happen outside tests, which don't call initPwa) — never break boot
  }
}
