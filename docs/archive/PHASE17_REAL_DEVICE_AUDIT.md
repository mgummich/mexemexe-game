# Phase 17 — Real-Device Mobile Hardening Audit

Entry state measured, not assumed: `npm run test` 454/454 green at 08a82a1 (Phase 16 head).

## Method and its limit

**No real Android or iOS hardware was available for this pass.** Every device claim below
comes from Chromium/WebKit/Firefox emulation via the existing Playwright suites
(`e2e`, `e2e-cross`, `e2e-pwa`, `e2e-multiplayer`) at the phone, landscape and tablet
viewports those suites already cover. Emulation exercises layout, touch-event plumbing,
orientation and service-worker behaviour; it does **not** exercise real iOS audio session
suspension, real Android WebView memory pressure, or real home-screen PWA launch. Those
stay open, listed under "Remaining, device-only" at the bottom.

## Phase 16 carryover

Carried forward from `docs/PHASE16_RESPONSIVE_PWA_AUDIT.md` and `docs/STATUS.json`:

- `verify:cross` flakes under back-to-back local runs (47/48, 47/48, 48/48 on clean main,
  failing project rotating between firefox and the two webkit ones). Pre-existing, not a
  regression, not root-caused.
- `renderAll` sprite pooling deferred. 49 fps at 107 visible cards (floor 45), 52–58 fps
  elsewhere. Nothing under its floor.
- Tablet reuses the phone landscape/portrait worlds rather than a bespoke tablet layout.
- Carried UX item: tap path for the joker "stands for" tooltip.

## What was already in place (confirmed, not rebuilt)

The mobile and responsive passes of Phases 13–16 had already landed most of the structural
work this phase would otherwise have had to build:

| Area | State on entry |
|---|---|
| Safe-area insets | `index.html:35-38` padding from `env(safe-area-inset-*)`; portrait hint and error toast (`src/main.ts:92,121`) and offline/update banners (`src/core/pwa.ts:38,51`) all inset-aware |
| Viewport | `index.html:7` `viewport-fit=cover`, `initial-scale=1.0`, `maximum-scale=1.0`, `user-scalable=no` |
| Orientation | `src/main.ts:58-74` debounced (150 ms) resize → `refreshProfile()` + aspect-ratio update; `src/scenes/GameScene.ts:324,974-985` `viewport:changed` → single `relayout()` |
| Card drag cleanup | `src/scenes/GameScene.ts:327-332` canvas `pointercancel` listener + shutdown cleanup; `:2226-2229` `cancelActiveDrag()` on both `pointercancel` and `dragend` |
| Connectivity | `src/core/pwa.ts:18-27` `navigator.onLine` + `online`/`offline` events; `src/scenes/OnlineScene.ts:69-75` reconnect on offline→online; `src/scenes/MenuScene.ts:34` online button gated |
| PWA | `public/manifest.webmanifest` display `standalone`; `public/sw.js:9` build-stamped `VERSION`; `src/core/pwa.ts:61-73` update banner + `SKIP_WAITING` |
| Localization | `src/localization/i18n.ts` tap hint, rotate hint and "Reconectando…"/"Reconnecting…" all present in both locales |

## Genuine gaps found

1. **No app sleep/resume handling at all.** No `visibilitychange`, `pagehide`, `pageshow`,
   `blur` or `focus` handler exists anywhere in `src/`. Backgrounding mid-drag or mid-turn
   left drag and tap-selection state untouched; nothing re-laid-out or re-synced on return.
   Highest-impact gap in the phase — it is the one that produces a stuck match on a real
   phone, where backgrounding is routine rather than exceptional.
2. **Audio unlock listeners leak for the page lifetime.** `src/audio/music.ts:135-138` adds
   `window` `pointerdown` and `keydown` unlock listeners and never removes them, even after
   playback succeeds. Music also had no pause-on-hidden / resume-on-visible path, so a
   backgrounded app on iOS could return with a suspended audio element.
3. **`pointercancel` gaps in the UI panels.** The card layer handles `pointercancel`
   correctly; the panels do not. `src/ui/settings-panel.ts:359-376` (volume slider) resets
   its `dragging` flag on `pointerup`/`pointerupoutside` only, and
   `src/ui/rules-panel.ts:102-114` (scroll drag) likewise — a system gesture interrupt on a
   touch device could strand either.
4. **No battery/quality setting.** `reducedMotion` + `motionScale()` exist
   (`src/core/settings.ts:68`), but there is no Battery Saver affordance and no copy for it
   in either locale.

## Disproven

- *"No inactive-player lockout — an offline player can still send moves to the server."*
  Not supported by the code. `src/scenes/GameScene.ts:152-167,398-441` carries `localSeat`,
  a single-point `onlinePending` input lock with a timeout, revision-ordered view
  reconciliation (`view.rev < lastRev` → ignore) and a resync path. The server stays
  authoritative. `OnlineScene.canAct()` gates the lobby buttons separately. No change made.

## Fixes selected, by impact

1. App hidden/visible lifecycle module, wired into GameScene (cancel drag + clear selection
   on hide, one relayout on show), the online resync path, and music.
2. Audio unlock listener removal once playback succeeds; pause/resume across background.
3. `pointercancel` reset on the settings slider and the rules-panel scroll drag.
4. Battery Saver setting on the existing `reducedMotion`/persistence plumbing, decorative
   effects only — rules, validation and card readability untouched.
5. PT-BR/EN-US copy for Battery Saver.
6. Targeted tests: lifecycle, setting persistence and fallback, locale key parity.

Items 7–10 of a longer list (bespoke tablet layout, sprite pooling, `verify:cross` flake
root-cause, joker tooltip tap path) were considered and deliberately not taken: none is a
real-device play blocker, and Phase 16 already measured the two performance ones as being
above their floors.

## Remaining, device-only

Cannot be closed without hardware, listed highest priority first:

1. iOS Safari and iOS home-screen PWA: audio session behaviour after a real background /
   phone-call interruption. Emulation cannot reproduce it.
2. Android installed PWA: launch-from-icon and app-shell load from a cold start.
3. Real low-end Android: sustained fps under memory pressure with a crowded table.
4. Real notch/home-indicator geometry: insets are emulated as zero in headless runs.
