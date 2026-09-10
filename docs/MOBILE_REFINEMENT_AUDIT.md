# Mobile Refinement + Portrait/Landscape Asset Pass

Audit and fix log for the mobile refinement pass. Baseline before this pass: 430/430 unit tests,
fps 56-60, Phase 15 (PWA) complete.

## Method

Two read-only discovery agents (mobile interaction/layout/perf, asset pipeline) produced the issue
map below. Three implementation agents patched disjoint file sets. Every finding was re-verified
against the source before being acted on — one reported finding turned out to be false (see
"Disproven" below).

## Mobile blockers found

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| 1 | Portrait world is 270x480 but all 5 table backgrounds are 480x270; portrait cover-scale crops ~69% of the art width | `public/assets/tables/*.png`, `src/ui/menu-layout.ts:45` | high |
| 2 | Coarse-pointer hit-box floor was 32x26 world units = 46x37.6 CSS px on a 390-tall phone — under the 44px minimum | `src/ui/widgets.ts:169` | high |
| 3 | Portrait zoomIn/zoomOut sat 14 world units apart with 26-unit hit boxes — **overlapping hit areas**, topmost sprite ate the other's taps | `src/ui/regions.ts:198-199` | high |
| 4 | Landscape controls were 14-19 world units tall = 20-27 CSS px | `src/ui/regions.ts:131-141` | high |
| 5 | Mexe editor force-closed on landscape flip; landscape Mexe Mode did not exist | `src/scenes/GameScene.ts:1322` | high |
| 6 | Joker-reason and meld-focus tooltips were `pointerover`/`pointerout` only — invisible on touch | `src/scenes/GameScene.ts:1761,1781` | medium |
| 7 | No `pointercancel` handling; only `pointerupoutside`. A browser-stolen pointer stranded the dragged card with `dragging=true` | `src/scenes/GameScene.ts` drag path | medium |
| 8 | `mobile.mexeModeHint` copy missing in both locales | `src/localization/i18n.ts` | low |

### Scale math

The world is height-fit in both orientations, so on a 390px-tall phone world→CSS scale is
`390/270 = 1.444`. A control needs **≥31 world units** to clear 44 CSS px, **≥34** for 48 CSS px.
This is the number every touch-target fix below is derived from.

## Already correct before this pass

- `viewport.ts` already authors two real worlds (landscape 480x270 growing to 630 on wide phones,
  portrait 270x480) — no stretched single layout.
- `viewport-fit=cover` + `env(safe-area-inset-*)` padding already handled notches (`index.html:7,37`).
- Tap-first move already existed (`GameScene.ts:2168-2196`, `dragged` flag gates `onCardTapped`).
- `mobile.tapHint` and `mobile.warnHint` already matched the required copy exactly.
- e2e already covered PHONE_PORTRAIT 390x844 and PHONE_LANDSCAPE 844x390 with `hasTouch`.

## Disproven

One discovery agent reported that `renderAll()` (`GameScene.ts:1250-1328`) runs on every pan
`pointermove` tick. Grepping every call site disproved it: both the table pan (`panBg`, ~1626) and
the Mexe-list pan (`listBg`, ~1965) reposition targets directly on `pointermove` and only call
`renderAll()` on `pointerup`/`pointerupoutside`. **No throttle was added.** Sprite pooling for
`renderAll` stays deferred by existing project policy while fps ≥ 50 (currently 56-60).

## Fixes applied

1. **Portrait table art** — 5 new 224x400 portrait backgrounds generated with the PixelLab MCP.
   `backgroundKeyFor()` in `menu-layout.ts` selects `${key}-portrait` in portrait and falls back to
   the landscape key when the portrait texture is missing. See `PIXELLAB_ASSETS.md` for prompts.
2. **Touch hit-box floor** raised to 34x31 world units (`widgets.ts:169`). Art size unchanged; the
   desktop (fine-pointer) branch is untouched.
3. **Portrait control row** — all 8 secondary controls moved to one row at y412, centres 34 units
   apart, so hit boxes touch but never overlap.
4. **Landscape touch column** — geometry now branches on the existing `t` (touch) flag: gear y18,
   zoom pair y56, reset y94, feito y176, comprar y214, undo/redo pair y250. The desktop branch is
   asserted byte-identical by a regression-lock test.
5. **Landscape Mexe editor** — `editorZones()` split into `portraitZones()` (unchanged) and a new
   `landscapeZones()`: full-height 150-wide meld-list column on the left, workspace top-right, 52-tall
   hand strip bottom-right, all derived from `r` so a wider phone world grows the workspace. The
   force-close was dropped and `mexeToggle` is now built in both orientations.
6. **Tap paths for hover tooltips** — `pointerdown` show + 2500ms auto-hide on touch, mirroring the
   existing `widgets.ts:180-190` pattern. Hover unchanged on desktop.
7. **`cancelActiveDrag()`** wired to a DOM `pointercancel` listener on the canvas, removed and
   re-invoked on scene shutdown.
8. **`mobile.mexeModeHint`** added in pt-BR and en-US.

## Rules preserved

Orientation flip re-lays-out but never confirms, submits, or resets the draft — `this.editor` is not
touched by `relayout()`. The Mexe draft stays local until FEITO. An invalid draft is still allowed
mid-edit; only the final confirm is blocked. No `Math.random` in logic. Server stays authoritative.

## Verification

| Run | Result |
|-----|--------|
| `npm run test` | 447/447 pass (32 files; baseline 430 + 17 new) |
| `npm run lint` | exit 0 (eslint + `tsc --noEmit`) |
| `npm run build` | exit 0 |
| `npm run verify:multiplayer` | 9/9, 18 screenshots, incl. portrait locked non-active seat and portrait unreachable-server |
| `npm run verify:pwa` | 10/10, incl. offline menu on a mobile viewport |
| `npm run verify` (screenshots) | exit 0, 51+ captures, `missingAssets=0` on every capture, fps 52-57 |

## Asset review history

The portrait backgrounds took three passes, because the first two were accepted by the generating
agent but rejected on visual review:

1. **Pass 1** produced 3/4-perspective room scenes (a table with chairs in a room, a market stall
   elevation, a backyard with a door) instead of flat overhead tabletops. `feira` also had readable
   signage text baked in. Only `menu-portrait` was correct — `menu.png` is genuinely a street scene,
   not a tabletop, so its portrait sibling should be one too. **Do not "fix" `menu-portrait` into a
   tabletop.**
2. **Pass 2** fixed the framing on all four but drifted off-palette on three.
3. **Pass 3** used img2img over the pass-2 images to hold composition and shift only colour. That
   worked for `feira` but could not move `kitchen` or `quintal` — the init image anchored the wrong
   palette. Both were then regenerated fresh (no init image), which cleared it: `kitchen` came back
   as vivid red/cream gingham with proper cross-hatch, `quintal` with the bold yellow/orange
   checkered border and green diamond corner accents.

Lesson for future asset work: img2img is the wrong tool for a large palette shift — it preserves
what you are trying to change. Regenerate fresh instead, and always review the image, not the
agent's description of it.

## Remaining, by priority

1. **Landscape touch controls above the action panel** (gear y18, zoom y56, reset y94, mexeToggle
   y126) sit directly on the table art rather than on an opaque panel, so they read as busy over
   prop art like the boteco mug. Legible, and consistent with how the desktop free strip already
   worked. Extending `actionPanel` upward would fix it but collides with `tutorialPanel`
   (`{398+dx, 2, 80, 176}`) — needs a real layout decision, not a number tweak. Cosmetic.
2. **`renderAll` sprite pooling** — still deferred by policy. Revisit if fps drops below 50.
3. **Crowded-table 80+ card readability** — not separately re-measured in this pass; the existing
   zoom/focus controls now meet touch-target size, but the dense-table layout itself is unchanged.
4. **Portrait rotate nag** — portrait still shows "Vire o celular na horizontal pra jogar melhor."
   Landscape is genuinely more spacious so the hint is not false, but now that portrait has real art
   and 44px+ targets it may be worth softening. Product decision, not a bug.
