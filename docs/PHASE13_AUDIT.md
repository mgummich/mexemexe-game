# Phase 13 Audit — Mobile Layout and Tap-First Controls

Entry state re-measured, not assumed: `npm run test` → 330/330 green on `feat/joker-one-per-meld`,
lint and build clean, 51 screenshot captures in the last `verify` run, zero console errors.

## Current mobile behaviour

The game is a Phaser canvas authored into a single fixed world of 480x270 units, rendered at
`RENDER_SCALE = 3` (1440x810 canvas) and fitted to the window with `Phaser.Scale.FIT`. Every scene
positions its content with literal coordinates on that grid, and almost every screen except the
board is a stack centred on (240, 135).

That makes the desktop experience uniform and the phone experience secondary by construction:

- **Portrait is letterboxed, not laid out.** On a 390x844 phone, FIT scales the 16:9 world to
  390x219 and leaves roughly three quarters of the screen empty. A hand card, 24x32 world units,
  renders at about 19x26 CSS px — under half a comfortable touch target.
- **Landscape is the only real mobile mode.** `src/main.ts` acknowledges this with a permanent DOM
  banner (`a11y.rotateHint`, "turn your phone sideways") pinned to the top of the screen. The hint
  is honest about the limitation rather than fixing it, and it never goes away.
- **Touch input already works.** Phase 12 landed a full select-then-place path (`selectCard`,
  `onCardTapped`, `placeSelected`, `renderSelectionLayer`) shared with the keyboard ring, a tappable
  invalid-meld ✗ badge with a latching tooltip, drag hit areas padded past the card art
  (`makeCardSprite`, ±12% x / ±30% y in frame coordinates), and `touch-action: none` plus
  `overscroll-behavior: none` on the page so a drag is never stolen by the browser.

So the gap is not the input model. It is that the board has one shape and phones have two.

## Touch and input issues

1. **Touch target sizes.** At a phone-landscape FIT scale of ~1.44, FEITO (64x22 units) renders
   about 92x32 CSS px, COMPRAR about 92x29, and the undo/redo/reset/sort/settings icons about
   23x20. The 44px guideline is missed by every control except the width of the two main buttons.
2. **A disabled FEITO says nothing when pressed.** `PixelButton`'s `pointerup` returns early when
   disabled. The blocking reason is on screen in `reasonText`, but nothing connects the press to
   the explanation, which is exactly the moment a player asks the question.
3. **Hover-gated affordances.** All `PixelButton` tooltips (`tooltip.feito`, `tooltip.comprar`,
   `tooltip.undo`, `tooltip.redo`, `tooltip.reset`, `tooltip.sort`, `tooltip.settings`) open on
   `pointerover` after 400 ms and are unreachable on a touch screen. The joker "stands for" hint on
   a table card (`GameScene.layoutMelds`) is also hover-only. Neither is the sole source of critical
   information — the ✗ badge path is already tap-latched, and the objective line carries the same
   guidance in words — but they are information a touch player simply cannot get to.
4. **No touch-specific guidance.** Nothing tells a first-time phone player that tapping a card and
   then tapping a destination is a supported way to play; the only on-screen hint,
   `game.selectHint`, describes arrow keys and Enter.
5. **Sub-threshold control.** The settings-panel slider handle is a radius-4 circle (8 units).

## Desktop-only assumptions

- `src/main.ts`: world size, canvas size and camera centring are three module constants.
- `src/scenes/GameScene.ts`: `W`, `H`, `TABLE_TOP`, `TABLE_BOTTOM`, `TABLE_LEFT`, `TABLE_AREA_W`,
  `TABLE_AREA_H`, `HAND_Y`, `BAR_H` plus per-button literals in `buildStaticUi`, the opponent strip
  step of 105, the hand span of 330 centred on x=200, the `inTableArea` right bound of `W - 84`, and
  the tooltip clamp bounds `W - 92` / `H - 30`. A right-hand column 96 units wide is reserved for
  the action cluster on every screen, which is a landscape-only trade.
- Every other scene and panel: centred on (240, 135), backgrounds drawn with
  `setDisplaySize(480, 270)`, and a settings gear anchored at x=462.
- `e2e/screenshot.spec.ts`: 1280x720 default viewport with one 1920x1080 case; the click helper
  hardcodes `SCALE = 1280 / 480`. No mobile viewport is captured anywhere.

## Crowded layout issues

The meld grid is already overlap-proof at any density (`computeMeldLayout` compresses card gap, then
card scale, then row gap, and always spaces rows by at least a full row height), and the crowded
capture holds 58 fps. The constraint is not the packer — it is that the packer is handed a
370x102-unit box, because the right column is reserved for buttons. Portrait can hand it far more.

## Affected files

`src/main.ts`, `index.html`, `src/scenes/GameScene.ts`, `src/ui/widgets.ts`, `src/scenes/MenuScene.ts`,
`src/scenes/SetupScene.ts`, `src/scenes/OnlineScene.ts`, `src/scenes/WinScene.ts`,
`src/scenes/TutorialScene.ts`, `src/ui/settings-panel.ts`, `src/ui/pause-menu.ts`,
`src/ui/rules-panel.ts`, `src/ui/overlay.ts`, `src/localization/i18n.ts`, `src/core/events.ts`,
`e2e/screenshot.spec.ts`, `scripts/check-verify.mjs`, `docs/STATUS.json`.

New: `src/ui/viewport.ts`, `src/ui/regions.ts`, `src/ui/menu-layout.ts`, and their tests.

## Top 10 tasks

1. Pick one of two authored worlds from window orientation — 480x270 landscape (unchanged) or
   270x480 portrait — instead of assuming the first. Orientation alone decides the world, so a
   desktop browser window that is taller than it is wide does get the portrait board; what a
   desktop never gets is the touch branch, which is keyed to a coarse pointer and only ever grows
   hit areas and a few button boxes.
2. Move every GameScene layout literal into a `GameRegions` table whose landscape values are the
   existing constants byte for byte, and assert that in a unit test. That is the no-regression gate.
3. Author the portrait board: full-width table on top, hand below it, pinned action bar at the
   bottom with FEITO and COMPRAR side by side at 40 and 36 units tall.
4. Re-lay-out on an orientation flip without restarting GameScene, which owns the live match state
   and the online socket. A `viewport:changed` bus event; scenes with no live state may restart.
5. Grow `PixelButton` hit areas (not artwork) on a coarse pointer, and open tooltips on tap.
6. Make a disabled FEITO explain itself when pressed, from the same reason string the objective
   line already renders, so the two can never diverge.
7. Safe-area padding via `viewport-fit=cover` plus `env(safe-area-inset-*)` on the canvas container,
   so notches and home indicators cost canvas area rather than covering the board.
8. Portrait-proof the centred screens generically (`cx`/`cy`/`vy`/`panelW`/`coverBackground`) rather
   than hand-authoring five more layouts.
9. Localized touch copy in pt-BR and en-US, and a portrait hint that auto-hides now that portrait is
   a real layout rather than a warning.
10. Capture mobile portrait and landscape screenshots in `verify`, and add them to the required-shot
    list in `scripts/check-verify.mjs` so the coverage cannot silently disappear.

## Out of scope (unchanged this phase)

Full mobile Mexe editor, helper/hint modes, auto-solver, PWA/offline, native packaging, tutorial
rewrite, new art, new rules, ranked/accounts/chat.
