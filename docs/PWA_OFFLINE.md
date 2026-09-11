# PWA and offline behaviour

MEXEMEXE! is an installable progressive web app that plays fully offline after
one online load. This documents what is actually implemented
(`public/sw.js`, `src/core/pwa.ts`, `public/manifest.webmanifest`).

## What works offline

| Works offline | Needs a connection |
|---|---|
| Local hot-seat and AI matches | `ONLINE (ALPHA)` rooms |
| The tutorial | Background music (streamed, deliberately never cached) |
| Rules/help panel, settings, cosmetics | The first load of the game itself |
| Saved settings and cosmetics (`localStorage`) | Fetching a new version |

The menu shows a banner while the browser reports no network, and online rooms
are disabled rather than failing mid-connect.

## Installability

`public/manifest.webmanifest` declares name `MEXE!`, `display: standalone`,
`orientation: any`, `start_url`/`scope` `./` (the build uses a relative base, so
the app works under a subpath such as GitHub Pages), and three icons: 192, 512
and a 512 maskable. Icons are regenerated deterministically with
`npm run gen:icons`.

## Service worker

Registered from `src/core/pwa.ts`, **production builds only** — in dev it
actively unregisters any worker left behind by an earlier production visit, so
a stale cache can never shadow the Vite dev server.

Caching policy (`cacheMode` in `public/sw.js`, unit-tested in `tests/pwa.test.ts`):

- **Cross-origin, non-GET, and WebSocket traffic**: passthrough, never cached —
  private multiplayer state must not land in a cache.
- **`/assets/audio/music/`**: passthrough. ~11 MB of streamed mp3, excluded on
  purpose, which is why music is silent offline.
- **Navigations**: network-first with the cached `index.html` as fallback. A
  non-200 or opaque response never overwrites the cached shell, so a captive
  portal cannot poison it.
- **Everything else same-origin**: cache-first, filling the cache on first use.

Only the app shell (`./`, `./index.html`) is precached at install. The rest
lands in the cache during the first load anyway, because `BootScene` preloads
every card, table, portrait, UI and avatar asset. An eager precache list was
tried and reverted: it starved first-load boot fetches without improving offline
coverage.

## Cache versioning

`sw.js` uses a single cache named `mexe-v<version>`, where the version is
substituted at build time from `package.json` by the `vite.config.ts` plugin
(the literal `__BUILD_VERSION__` placeholder is the unbuilt dev default). On
activation the worker deletes every cache whose name is not the current one.

So the release version is the cache key: bumping `package.json` — which
`npm run release` does — is what makes a deploy reach players who already have
the game cached. There is no separate cache constant to keep in sync.

## Update handover

The worker never calls `skipWaiting()` on its own — an update must not yank the
app out from under an active match.

1. A new worker installs and waits.
2. The client shows a dismissible **update available** banner (a real 44px tap
   target) — only when there is already a controller, so a first install stays
   quiet.
3. Tapping it posts `SKIP_WAITING` to the waiting worker.
4. `controllerchange` then reloads the page — guarded so it can only fire for an
   update the player asked for, and only once.

An installed PWA can stay open for days and browsers only check for a new worker
on navigation, so the registration is re-checked whenever the app returns to the
foreground. That check can at most surface the banner; it never reloads by
itself.

## Known limitations

- Music is unavailable offline by design (see above).
- Online rooms obviously require connectivity; the offline banner and the
  disabled menu entry are the only affordances.
- Registration failures (insecure origin, blocked by policy) are swallowed: the
  game boots normally without offline support rather than erroring.
- Offline behaviour is verified on Chromium only (`npm run verify:pwa`); other
  engines are covered for layout but not for the service-worker lifecycle.

## Verifying a change

`npm run verify:pwa` builds and runs `e2e-pwa/` against the production build:
service worker registration, offline reload booting to the menu, offline
local/AI/tutorial play, online-disabled-offline, first install, and the update
handover. `tests/pwa.test.ts` exercises the caching policy without a browser.
Both run in CI on every push.
