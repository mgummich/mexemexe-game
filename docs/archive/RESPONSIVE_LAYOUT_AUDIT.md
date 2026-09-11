# Responsive Layout + Mobile/PWA UX Audit

Audit and fix log for the responsive/PWA pass. Baseline before this pass: 447/447 unit tests,
30/30 cross-browser layout gate, fps 55-60, PWA (Phase 15) and the mobile refinement pass
(`MOBILE_REFINEMENT_AUDIT.md`) already shipped.

## Current state, per surface

| Surface | Status before this pass |
|---------|-------------------------|
| Desktop browser | Good. `landscape()` in `src/ui/regions.ts` is byte-identical to the pre-`regions` constants and locked by a `toEqual` regression test. 1280x720 and 1920x1080 both captured. |
| Tablet | Untested — no tablet viewport existed in any suite. |
| Mobile landscape | Good geometry (touch column, 44px+ hit boxes), but **no test ever set `hasTouch`**, so the whole `touch: true` branch was uncaptured and unscreenshotted. |
| Mobile portrait | Real authored 270x480 world with dedicated 224x400 art. Portrait was never run through the cross-browser fit/centre gate. |
| PWA standalone | `index.html` handles `viewport-fit=cover` + `env(safe-area-inset-*)` on `#game`. The three DOM overlays (portrait hint, offline banner, update banner) were positioned in bare pixels and ignored the insets. |

## Findings

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | Touch-landscape reason text (`x438, y135, wrap 72, originY 1`) drew a 3-4 line block straight over the RESET and Mexe-toggle buttons — both were invisible and untappable whenever a reason was showing | `src/ui/regions.ts` `landscape()` | high |
| 2 | Touch-landscape gear/zoom/reset/Mexe-toggle sat on bare table art (carried over as "remaining #1" from the mobile pass) | `src/ui/regions.ts`, `src/scenes/GameScene.ts:buildStaticUi` | medium |
| 3 | In tutorial mode the Mexe toggle was still built at `r.mexeToggle`, which `r.tutorialPanel` (y2-178) covers in both orientations — the gear and zoom buttons were already excluded for exactly this reason, the toggle was not | `src/scenes/GameScene.ts:buildStaticUi` | medium |
| 4 | Portrait hint / offline banner / update banner / error toast used bare `top:12px`, `top:44px`, `bottom:100px`, `bottom:24px` — under a notch or home indicator in PWA standalone (`apple-mobile-web-app-status-bar-style: black-translucent`) | `src/main.ts`, `src/core/pwa.ts` | medium |
| 5 | The update banner is a tap target (it posts `SKIP_WAITING`) but was ~30px tall — below the 44px floor every in-canvas control already clears | `src/core/pwa.ts` | medium |
| 6 | Landscape **tutorial** mode hit finding 1's twin on desktop too: the reason line is bottom-anchored at y191, so its upper lines drew through `r.tutorialPanel` (y2-178). Visible as garbled text behind the PULAR button | `src/scenes/GameScene.ts:regionsForMode` | medium |
| 7 | `a11y.rotateHint` copy did not match the required strings | `src/localization/i18n.ts` | low |
| 8 | The cross-browser fit/centre/aspect gate had no portrait phone and no tablet project | `playwright.cross.config.ts` | low |
| 9 | `e2e-cross/layout.spec.ts` hardcoded the SFX slider row at `y46`, a landscape-only number — it fails on any portrait or tablet world | `e2e-cross/layout.spec.ts` | low (test-only) |

## Checked and found already correct

- **Layout mode detection** is centralized: `pickProfile`/`landscapeWidth`/`refreshProfile` in
  `src/ui/viewport.ts`, consumed by `gameRegions()` and the `menu-layout.ts` helpers. No scattered
  breakpoints.
- **Orientation change** re-states Phaser's FIT aspect and re-lays-out (`src/main.ts` resize
  handler, `e2e-cross/rotate.spec.ts` gates both directions on 5 engines).
- **Tap-first controls** exist and are not drag-only: `selectCard`/`placeSelected`/`onCardTapped`
  in `GameScene.ts`, with `pointercancel` wired to `cancelActiveDrag()`.
- **No hover-only critical UX.** Every `pointerover` tooltip (meld reason badge, meld focus, joker
  stands-for, `PixelButton`) has a `pointerdown` + auto-hide twin on a coarse pointer.
- **Orientation-specific assets** already ship: 224x400 portrait table art selected by
  `backgroundKeyFor()`, cover-scaled by `coverBackground()`, with a landscape fallback when the
  portrait texture is missing. Nothing is stretched — both worlds are cover-scaled, never fitted.
- **No per-frame relayout.** Table pan, Mexe list pan and hand-strip pan all reposition their own
  target arrays on `pointermove` and only call `renderAll()` on release.

## Fixes applied

1. **Reason text relocated on touch landscape** (finding 1) — moved to the full-width strip
   between the table bottom (188) and the hand zone (216), where the same copy fits on one line.
   Desktop keeps its in-column position (locked by the byte-identical desktop test).
2. **`controlPanel` region + backdrop** (finding 2) — a second opaque rounded panel behind the
   touch-landscape top cluster, drawn in `buildStaticUi` next to the existing `actionPanel`.
   `null` on desktop and in portrait, so neither look changes. Skipped in tutorial mode.
3. **Mexe toggle excluded in tutorial mode** (finding 3), same gate the gear and zoom buttons
   already used. `mexeToggleBtn` is now optional and cleared at the top of `buildStaticUi` so a
   relayout can't leave a destroyed handle behind.
4. **Landscape tutorial reuses the same wide reason strip** (finding 6) via `wideReason()`, the
   one place those coordinates now live — `regionsForMode()` swaps it in whenever a tutorial is
   running in landscape. Desktop outside tutorial mode is untouched.
5. **Safe-area insets** on all four DOM overlays (finding 4): `calc(Npx + env(safe-area-inset-top))`
   / `-bottom`.
6. **Update banner grown to a 44px tap target** (finding 5).
7. **`a11y.rotateHint`** now reads "Gire o celular para ter mais espaço." / "Rotate your phone for
   more space." (finding 7) — also softer than the previous "you should rotate" nag.
8. **Cross-browser gate extended** (findings 8, 9): `Pixel 7` portrait, `iPhone 14` portrait and
   `iPad (gen 7)` projects added; the slider spec now derives the row y from the live world with
   the same formula `settings-layout.ts` uses.
9. **New `landscape touch` screenshot test** — 844x390 with `hasTouch`, the first capture of the
   touch layout branch at all.

## Rules preserved

No game rule changed. The Mexe draft still stays local until FEITO, an invalid draft is still
allowed mid-edit and blocked only at confirm, the server stays authoritative online, and no
`Math.random` entered logic. The desktop landscape regions are still asserted byte-identical.

## Verification

| Run | Result |
|-----|--------|
| `npm run test` | 449/449 pass (32 files; baseline 447 + 2 new region tests) |
| `npm run lint` | exit 0 (eslint + `tsc --noEmit`) |
| `npm run build` | exit 0 |
| `npm run verify` | exit 0, 82 captures, `missingAssets=0` on every capture, fps 55-60 |
| `npx playwright test -c playwright.cross.config.ts` | 48/48 across 8 projects (3 desktop engines, 2 phone landscape, 2 phone portrait, 1 tablet) |
| `npm run verify:pwa` | 10/10 |
| `npm run verify:multiplayer` | 9/9, 18 screenshots |

## Remaining, by priority

1. **Service worker precaches the app shell only** (`public/sw.js` `APP_SHELL`). Runtime
   cache-first fills the rest during the first (online by definition) load, so offline play works
   after one session — but a user who installs and goes offline *before* playing gets missing art.
   Fixing it properly needs a build-time asset manifest; not worth the sync burden yet.
2. **Crowded table at 80+ cards** still not separately measured. `table-zoomed` covers a crowded
   table with zoom + pan at 56 fps; the 80+ ceiling is unverified.
3. **`renderAll` sprite pooling** — still deferred by project policy while fps ≥ 50 (currently
   55-60).
4. **One flake seen once**: `[ios safari portrait] settings fits the viewport` failed on a single
   cross run and passed on re-run and on every run since (48/48 twice after). Not reproduced; if it
   recurs, suspect the WebKit viewport settling later than the spec's 700ms tween wait.
5. **Tablet layout is the landscape world**, only wider. It passes the fit/centre/aspect gate but
   has no tablet-specific spacing; controls are sized for a phone's coarse pointer.
