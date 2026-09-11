# Phase 23 — PWA offline reliability audit

Entry state re-measured, not assumed: 533/533 unit green, `verify:pwa` 11/11 green,
`verify` OK, `verify:multiplayer` 10/10 green at `97459e0`.

Phase 16 built most of this pass's scope already (versioned cache stamped from
`package.json`, tolerant app-shell install, runtime cache-first proven to hold the whole
offline asset set, offline reload / local / AI / tutorial e2e coverage), and Phase 18/20
built the offline online-room gating. This audit therefore covers what those passes left
unexercised, which turned out to be the **service worker lifecycle**: first install and
update handover had no test and no observable behaviour asserted anywhere.

## Current status

| Area | State on entry |
| --- | --- |
| Manifest | `public/manifest.webmanifest`, name/short_name/start_url/scope/display/theme/background all set, `lang: pt-BR`. OK. |
| Icons | 192, 512, maskable-512, all present on disk, all asserted by `tests/pwa.test.ts` and fetched by `e2e-pwa/offline.spec.ts`. `apple-touch-icon` + `mobile-web-app-capable` in `index.html`. OK. |
| SW registration | `src/core/pwa.ts:initPwa`, prod-only, wrapped in `try`, `.catch()` on register, unregisters stale dev workers. Registration failure cannot break boot. OK. |
| Cache version | `mexe-v<pkg.version>`, substituted into `dist/sw.js` by the `mexe-sw-version` Vite plugin, which throws rather than no-op'ing. OK. |
| Cache cleanup | `activate` deletes every cache name `!== CACHE_NAME`. OK. |
| Precache | App shell only (`./`, `./index.html`), per-URL via `Promise.allSettled` so one 404 cannot abort install. Everything else is runtime cache-first. OK — see Phase 16 on why the eager precache list was reverted. |
| Offline asset set | BootScene preloads the full manifest on the (by definition online) first load, so cache-first ends up holding it. Asserted: tables + cards present, `assets/audio/music/` absent, `missingAssets === 0` on offline boot. OK. |
| Private state | `cacheMode()` passes through cross-origin, non-GET and `assets/audio/music/`. Multiplayer runs entirely over WebSocket; the server's only HTTP route is `/health`, which the client never fetches. Nothing private is cacheable. OK. |
| Offline UX | Top banner (`offline.banner`), ONLINE tap reason on the menu (`offline.online`), OnlineScene skips `connect()` while offline and re-enables on `online`. Both locales. OK. |
| Save/settings | `parseSave` is pure and falls back to defaults on corrupt/wrong-version JSON; `safeStorage()` reads `localStorage` inside a `try` (the property access itself throws in some privacy modes) and degrades to a no-op store. Covered by `tests/persistence.test.ts`. OK. |

## Defects found

1. **First install reloaded the page mid-boot.** `sw.js`'s `activate` calls
   `clients.claim()`, so the very first visit fires `controllerchange` — and the handler
   reloaded unconditionally. Measured: 2 main-frame navigations on a first load against a
   fresh context, i.e. a cold boot's asset loading thrown away and repeated. Priority 1.
2. **A worker that finished installing in an earlier visit never surfaced the update
   banner.** The banner was only wired from `updatefound`, which does not fire again for a
   worker that is already `waiting` when the page loads. That build sat unused and the
   stale one kept being served until the browser happened to find *yet another* update —
   the "no stale build forever" rule. Priority 2.
3. **The update banner had no action affordance.** It showed only the notice
   ("Atualize quando terminar a partida"), while the whole div was the tap target. Nothing
   told the player it was tappable. Priority 3.
4. **Duplicate banners were possible.** `updatefound` can fire more than once (a third
   worker installs while the second waits); each fire appended another stacked banner.
   Priority 4.
5. **A long-lived installed PWA never checked for updates.** Browsers check on navigation;
   a standalone app that is only ever backgrounded and resumed never navigates. Priority 5.

## Fixes

All in `src/core/pwa.ts`, plus one i18n key:

- `controllerchange` reloads only when `updateRequested` is set — which happens only in the
  update banner's click handler. First install is silent.
- `reg.waiting && navigator.serviceWorker.controller` at registration time surfaces the
  banner for an already-waiting worker.
- Banner text is now `${t('update.available')} [${t('update.now')}]`; new key
  `update.now` = "Atualizar agora" / "Update now".
- `updateBannerShown` module flag, one banner per page.
- `visibilitychange` → `reg.update()` when the app comes back to the foreground. It can
  only surface the banner; it never reloads on its own.
- `data-mexe-banner="offline" | "update"` on both banners so e2e can select them (they are
  otherwise unmarked inline-styled divs).

## Evidence

`e2e-pwa/update.spec.ts` (new, 2 tests, own fresh context per test — the only way to
observe a *first* install):

- `first install does not reload the page` — 1 main-frame navigation, scene `menu`.
  Reverting the `updateRequested` guard and rebuilding fails it with `Received: 2`, so the
  test does catch the defect it was written for.
- `a waiting update shows the banner and only reloads when tapped` — rewrites `dist/sw.js`'s
  cache key to stand in for a deploy, calls `reg.update()`, then asserts: banner visible
  with both PT strings, still 1 navigation, old cache still present, scene still `menu`.
  After the tap: exactly 2 navigations, and `caches.keys()` is exactly the new name — the
  old cache was evicted.

Suites run: `npm run test` 533/533, `npm run lint` clean, `npm run verify` OK (86 captures,
`missingAssets=0`), `npm run verify:pwa` 13/13, `npm run verify:multiplayer` 10/10.
Screenshots in `docs/screenshots/pwa/` (`pwa-log.json`) and `docs/screenshots/`.

## Remaining risks

1. **Unhashed assets are stale until the version bumps** (low, documented). Cache-first on a
   fixed URL means a redeploy that changes `public/assets/**` without bumping
   `package.json` keeps serving the old copy. Now called out in `docs/SELF_HOSTING.md`
   ("Service worker cache and deploys"). Not worth a per-build cache key: that would evict
   the whole offline set on every deploy, and the release flow bumps the version anyway.
2. **Post-update offline window** (low, inherent). Between `activate` (old caches deleted)
   and the reloaded page refetching the JS bundle, the app needs network. The handover is
   player-initiated from a banner, so they are online by construction.
3. **The offline banner's text does not follow a locale switch made while it is showing**
   (very low). It re-renders on connectivity change only. The text stays correct, just in
   the previous language, until the next transition.
4. **Real standalone-install behaviour is untested** (medium, tooling limit). Playwright
   drives a browser tab, not an installed PWA — `display: standalone`, the launch-from-icon
   path, and OS-level background/resume were not exercised. The manifest, icons, safe-area
   insets and orientation flips are covered; installability itself is asserted only
   field-by-field, not by a real install.
