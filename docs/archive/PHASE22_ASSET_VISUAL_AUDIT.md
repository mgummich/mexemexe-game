# Phase 22 — Asset Optimization + Crisp Visual Consistency

Audit and fix pass over MEXE!'s asset pipeline, file sizes, and visual readability
across desktop, mobile portrait, mobile landscape, and PWA.

## Asset inventory

| Folder | Files | Size | Notes |
|---|---|---|---|
| `public/assets/cards` | 6 | 40K | `blank.png` + 5 backs. The 52 faces and the joker are **composed at runtime** (`src/assets/compose-cards.ts`), never files. |
| `public/assets/tables` | 11 | 196K | 5 landscape (480x270) + 5 portrait (224x400) + `prop-dominoes` |
| `public/assets/ui` | 15 | 104K | buttons, suit pips, emotes, logo, banner, `font.ttf` |
| `public/assets/characters` | 9 | 36K | avatars, 24x24 logical |
| `public/assets/effects` | 1 | 4K | `sparkle.png` |
| `public/assets/audio` | 15 | 9.8M | 10 wav sfx (~400K) + 5 streamed mp3 tracks (9.4M) |
| `public/` (PWA) | 5 | 8K | 3 icons, `manifest.webmanifest`, `sw.js` |

Loader map: `BootScene.loadAll()` GET-probes every non-composed manifest path,
`this.load.image/audio`s the hits, then `makeFallback()` sweeps anything still
missing. Music is *not* in the Phaser manifest — `src/audio/music.ts` streams it
through a plain `HTMLAudioElement`, and `sw.js:cacheMode` passes
`/assets/audio/music/` straight through so it never enters the cache.

## Findings and fixes

### 1. 53 guaranteed-miss asset probes on every cold boot — FIXED

`buildManifest()` listed `assets/cards/{suit}-{rank}.png` (52) and
`assets/cards/joker.png`, which have no file on disk by design. BootScene probed
each one on every cold boot; the dev/preview server answers with the SPA
`index.html` fallback (`HTTP/1.1 200 · Content-Type: text/html`), so each was a
full round-trip that could only ever fail.

Fix: `AssetDef.composed` marks runtime-drawn textures. BootScene filters them out
of the probe/load list but still passes the full manifest to the `makeFallback`
sweep, so a failed composition is still covered.

Measured on `vite preview`, cold load to `__MEXE__.scene === 'menu'`:

| | before | after |
|---|---|---|
| total boot requests | 217 | **159** |
| `/assets/cards/` requests | 65 | **12** |
| `/assets/ui/` requests | 39 | **34** |

### 2. Zoom / gear / Mexe controls unreadable on the baked-in table props — FIXED

Desktop landscape drew its top-right cluster (gear, Mexe toggle, zoom `+`/`−`)
directly onto table art. The boteco mug sits right under it — and a window wider
than 16:9 cover-scales the art further right, pushing the mug straight beneath
the buttons — leaving dark glyphs on dark coffee. The touch layout already solved
this with `GameRegions.controlPanel`; desktop reported `null`.

Fix: desktop landscape now returns `{ x: 400 + dx, y: 0, w: 78, h: 70 }`, reusing
the same backdrop the touch layout draws. **No control moves** — the authored
480x270 grid is byte-identical, and `tests/regions.test.ts` still asserts that.
Evidence: `docs/screenshots/game.png`, `docs/screenshots/mobile-landscape-game.png`.

### 3. Unused assets — REMOVED

Referenced only by `buildManifest()`, drawn by nothing in `src/`:

- `public/assets/ui/panel.png`
- `public/assets/ui/tut-drag.png`, `tut-meld.png`, `tut-draw.png`, `tut-win.png`

Checked and **kept** (all genuinely used, despite looking orphaned):
`btn-small-normal` (used via `PixelButton`'s `textureBase: 'btn-small'` +
`-normal` suffix), `prop-dominoes` (`GameScene.ts:317`), `sparkle`
(`WinScene.ts:87`), `banner-victory` (`WinScene.ts:69`), `card-back-1..4`
(`src/cosmetics/index.ts:23`), every `emote-*`, every `avatar-*`, every `suit-*`
(consumed by `compose-cards.ts` as card pips).

### 4. Music bitrate inconsistency — FIXED

`boteco-table.mp3` (202 kbps) and `cafe-pixelado.mp3` (196 kbps) were encoded far
above the three `full-song-*.mp3` tracks (128 kbps). Re-encoded to 128 kbps /
44.1 kHz, matching the rest of the catalog. Durations are unchanged to the
millisecond, so the loop points are intact.

| file | before | after |
|---|---|---|
| `boteco-table.mp3` | 1768K | 1188K |
| `cafe-pixelado.mp3` | 1716K | 1208K |
| **`public/assets/audio` total** | **11M** | **9.8M** |

The three 128 kbps tracks were left alone: re-encoding lossy→lossy again would
cost quality for no meaningful saving.

## Verified as already correct — no change made

- **Pixel-art crispness.** `pixelArt: true` + `roundPixels: true` (`src/main.ts:34-48`),
  `image-rendering: pixelated` on the canvas (`index.html`), `imageSmoothingEnabled = false`
  in every composed/fallback canvas. `RENDER_SCALE = 3` renders the world at 3x so
  textures hit native resolution; composed card faces are authored at 72x96 to match.
- **Card / suit / joker readability.** Ranks are drawn from `font.ttf` at 24px into a
  72x96 texture, never AI-generated — glyphs cannot scramble. Hearts (`#c22a2a`) vs
  diamonds (`#d8701e`) are distinct without relying on red-vs-red. The joker is a purple
  body + gold star, deliberately unlike the cream rank cards, readable at hand scale.
- **Missing-asset fallbacks.** Every manifest key has a `makeFallback` branch; verify
  reports `missingAssets=0` across all 86 captures.
- **PWA.** `manifest.webmanifest` icons all exist (192, 512, maskable 512). `sw.js`
  keeps no hardcoded asset list, so deleting assets cannot strand a cache entry; the
  cache key is substituted from `package.json` at build time. `verify:pwa` 11/11 pass.
- **No duplicate assets** (checked by size and by purpose).
- **No broken asset references** beyond the composed faces above.

## Deferred, with reasons

1. **Portrait card size.** Cards are a fixed 24x32 world units in both orientations;
   on a 390pt phone that is ~35pt wide. Bigger would read better, but card size is
   wired into drag hit areas, snap targets, the Mexe editor and the ghost preview —
   a portrait-only card scale is a layout change, not an asset change. Priority: medium.
2. **Portrait bottom icon row.** Eight glyph-only buttons (`▦ ↶ ↷ ⟲ ⇅ ⚙ + −`); `▦`
   for the Mexe editor in particular does not communicate its purpose. Fixing one with
   a text label would make the row inconsistent — this needs a proper small-icon set,
   not a one-off swap. Priority: medium.
3. **Portrait table art scales at 1.205x.** 224x400 art cover-scaled into the 270x480
   portrait world lands on a non-integer factor, so nearest-neighbour gives slightly
   uneven pixel sizes. Only affects decorative background, never a gameplay read.
   The clean fix is regenerating portrait art at an integer multiple of the world.
   Priority: low.
4. **`ambience.wav` is 304K uncompressed** and preloaded through Phaser. Compressing it
   would save ~260K of boot payload but mp3/ogg encoder padding introduces an audible
   gap in a looping ambience bed. Priority: low.

## Verification

| command | result |
|---|---|
| `npm test` | 533 passed, 38 files |
| `npm run lint` | clean (eslint + `tsc --noEmit`) |
| `npm run verify` | 86 captures, `verify: OK`, 0 console errors, `missingAssets=0` everywhere, min fps 47 |
| `npm run verify:pwa` | 11 passed |
