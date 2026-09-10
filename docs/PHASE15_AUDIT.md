# Phase 15 Audit: PWA & Offline Local Play

## Current PWA Status

No PWA support exists. Missing: `manifest.webmanifest`, service worker, `navigator.onLine` checks. `index.html` has no manifest link, theme-color meta, or apple-touch-icon. App is installable-capable only once service worker exists.

## Build Output Assumptions

Vite 6, `base: './'`, output `dist/`. Phaser lives in own chunk. `npm run build` runs `tsc --noEmit && vite build`. Single entry `index.html`. Static assets in `public/assets/{cards,characters,effects,tables,ui,audio}` fetched at runtime, not bundled. Music (`public/assets/audio/music/`) ~11 MB mp3 only; all other assets ~300 KB.

## Asset Loading Risks

`BootScene.ts` HEAD-probes every asset path before loading. Service worker must answer HEAD requests from Cache API (standard GET matching will fail offline). Music assets stream via bare `Audio` element, never preloaded—must stay out of precache. Fallback textures exist for missing assets but require network HEAD to detect misses.

## Offline Local Play Gaps

- No offline indicator UI or banner.
- Game assumes network available for asset discovery (HEAD probes). Offline path must skip probes or pre-declare static manifest.
- No update-available notification.
- Menu only disables Online button; no offline-mode toggle visible.

## Online/Offline Boundary Gaps

`MenuScene` sets `debugApi.online = null`, blocking server dependency. `OnlineScene` owns multiplayer. `PixelButton` supports `setEnabled(false)` with `onDisabledClick` reason—reuse for offline-unavailable actions. No banner precedent for offline state (DOM precedent exists for portrait/error but not connectivity state).

## Save/Settings Risks

`persistence.ts` already resilient: versioned `mexe-save` v1 envelope, `parseSave` never throws, `safeGet` catches storage throwing, `NULL_STORAGE` fallback when localStorage unreachable, migration from old `mexe-settings`. Low risk; tests needed only. Offline save already works.

## Update/Cache Risks

Service worker must implement stale-while-revalidate for JS/CSS/music. Vite hash-busts assets; cache busting must not block app startup. Phaser chunk and main bundle are tiny (<50 KB); CSS minimal. `public/` assets are static. Network-first for music; cache-first for cards/UI/effects. No strategy defined for detecting updates without HEAD probes.

## Affected Files

- `index.html` — add manifest link, theme-color, apple-touch-icon.
- `public/manifest.webmanifest` — new file.
- `src/main.ts` — offline banner, update banner.
- `src/scenes/BootScene.ts` — offline asset discovery path (skip HEAD or use manifest).
- `src/scenes/MenuScene.ts` — offline indicator, show online unavailable state.
- `src/localization/i18n.ts` — add offline/update keys.
- `public/sw.ts` — new service worker (TypeScript, build-compiled).
- `vite.config.ts` — output service worker, generate manifest icon.
- Scripts to generate app icons deterministically (pattern: `scripts/gen-cosmetics.mjs`).

## Top 10 Tasks

1. Generate and commit app icons (any format 192×192, 512×512) via deterministic script.
2. Write `public/manifest.webmanifest` (short_name, start_url, display, icons, theme_color).
3. Add manifest link, theme-color, apple-touch-icon to `index.html`.
4. Build service worker (`public/sw.ts`): cache-first for static assets, network-first for music, stale-while-revalidate for JS/CSS, offline fallback page.
5. Modify `BootScene.ts` to skip HEAD probes offline or use static manifest of guaranteed assets.
6. Add offline/update keys to `i18n.ts` (pt/en).
7. Add fixed-position offline banner to `src/main.ts` (DOM, no new UI machine).
8. Add offline indicator to `MenuScene` (badge or disabled Online button reason).
9. Implement update-available banner when service worker detects new version.
10. Write `tests/offline.test.ts` and update verify scripts (add offline/pwa checks to CI).
