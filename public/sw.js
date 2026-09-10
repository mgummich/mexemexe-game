// MEXE! service worker. Runtime cache-first for the app shell/assets, with
// a network-first navigation fallback so updates roll out reliably.
//
// Bump VERSION on every release that should evict the previous cache — the
// activate handler deletes every cache whose name isn't the current one.
// Keep this release cache key in lockstep with package.json. Activation removes prior keys.
const VERSION = 'mexe-v1.6.0';
const CACHE_NAME = VERSION;

const APP_SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  // No self.skipWaiting() here: the waiting worker only takes over when the
  // client explicitly asks for it (see the message handler below), so an
  // update never yanks the app out from under an active game.
  //
  // We only precache the app shell entry. Everything else (JS bundle, art,
  // sfx) gets cached on first use by the fetch handler below. The first
  // load is online by definition, and BootScene fetches every runtime asset
  // during that load, so a runtime cache-first policy ends up with the full
  // offline set anyway — without a build-time asset manifest to keep in sync.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Pure classification, factored out so tests can exercise the policy
// without a browser. Never cache cross-origin, WebSocket, or API traffic —
// private multiplayer state must not land in the cache.
function cacheMode(url, method, mode) {
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin) return 'passthrough';
  // BootScene probes assets with GET (not HEAD), so plain cache-first covers probes too —
  // no HEAD special-casing needed here anymore.
  if (method !== 'GET') return 'passthrough';
  if (mode === 'navigate') return 'navigate';
  if (url.pathname.includes('/assets/audio/music/')) return 'passthrough'; // ~11MB streamed mp3, never cached
  return 'cache-first';
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const mode = cacheMode(url, request.method, request.mode);

  if (mode === 'passthrough') return; // let the browser handle it untouched

  if (mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // An error/captive-portal/CDN-error page must never overwrite the cached shell.
          if (res.ok && res.status === 200 && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (res.ok && res.status === 200 && res.type !== 'opaque') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => new Response(null, { status: 504 }));
    }),
  );
});

// Exposed so tests/pwa.test.ts can exercise the policy without a browser.
self.__swInternals = { cacheMode, CACHE_NAME, VERSION };
