# iOS Simulator Baseline — UI/UX Audit

Evidence-gathering pass only. No source files were edited. All screenshots live in
`docs/screenshots/ios-baseline/`.

## Corrections (post-baseline re-test)

A follow-up pass re-tested every claimed blocker on the real Simulator before touching code.
Two of the five confirmed blockers below turned out to be **not reproducible** — harness/coordinate
errors by the original pass, not product bugs. They are struck through in place rather than
deleted, so the history stays intact:

- ~~Finding 1: ONLINE (ALFA) never responds to touch.~~ **Not reproducible.** Retested: the
  button opens the online scene on the first tap (device point 200,742 in portrait), showing
  "Connection error / Can't reach the game server. Is it running?" — see
  `docs/screenshots/ios-fixed/portrait-online-alfa-works.png`.
- ~~Finding 5: FEITO gives no feedback at all when disabled.~~ **Not reproducible.** Tapping the
  disabled DONE button prints "Cannot confirm yet: <reason>" to the status line —
  `GameScene.ts:923` already wires `onBlocked: () => this.onFeitoBlocked()` (impl at
  `GameScene.ts:1453`) — see `docs/screenshots/ios-fixed/portrait-done-disabled-reason.png`.

Findings 2, 3, and 4 held up. Findings 3 and 4 are now fixed — see "Fixes applied" below.

## Fixes applied

1. **Finding 4 root cause (hand-to-hand tap switch), `src/scenes/GameScene.ts` `onCardTapped`
   (was lines 1167-1177).** With a hand card selected, tapping a *different* hand card fell
   through to `placeSelected('hand', null)`, which calls `returnHandCard` on a card never played
   this turn — fails silently (selection cleared, invalid sfx, nothing selected). Fix: when the
   held card and the tapped card are both still in the remaining hand, treat the tap as switching
   the selection (`selectCard`) instead of a hand-drop. The decision was pulled into
   `src/table/tap-destination.ts` (`resolveCardTapDestination`, pure, no Phaser import) so it has
   a real unit test (`tests/tap-destination.test.ts`) — `GameScene.ts` can't be imported under
   vitest's node environment (Phaser's device-detection module throws `ReferenceError: window is
   not defined` at import time). Verified on-device: `docs/screenshots/ios-fixed/portrait-hand-first-card-selected.png` →
   `portrait-hand-switch-selects-second.png` (second tap selects the second card, first
   deselects); landscape spot-check: `landscape-hand-switch-selects-second.png`.

2. **Finding 3 root cause (badge hit-pad swallows card taps/drags), `src/scenes/GameScene.ts`
   ~line 1772.** The ✗/✓ meld badge's touch/portrait hit pad (`pad = strong ? 9 : 5`) covered
   roughly the top half of a small (1-2 card) invalid meld's card art, and the badge sits above
   the card in depth, so it won the hit test — explaining both "tap near the top of a bad card
   does nothing" and "drag from there never starts (only hand→table drag works)." Fix: shrink the
   touch/portrait pad to 2 (desktop's `5` is untouched — a mouse is precise and shouldn't
   regress). The badge is still tappable for its reason tooltip. Verified on-device: tapping
   device point (37,226) — inside the *old* 9px pad, over the card — now selects the card
   (`portrait-1card-invalid-meld.png` → `portrait-card-tap-below-badge-now-selects.png`); a
   table→hand drag starting near that same corner now returns the card
   (`portrait-drag-table-card-to-hand-success.png`); the badge itself still opens its tooltip on
   tap (`portrait-badge-tap-tooltip-still-works.png`). Landscape spot-check:
   `landscape-card-tap-below-badge-selects.png`, `landscape-drag-table-card-to-hand-success.png`.

New screenshots for both fixes live in `docs/screenshots/ios-fixed/`. Simulator: iPhone 17 Pro,
iOS 26.4, same Mobile Safari (non-standalone) setup as the baseline pass.

**Note on the drag re-test:** the table→hand drag needed ~40 synthetic CGEvent move steps to
register reliably in this harness (25 steps intermittently dropped the gesture entirely, with no
game-side effect either way). That looks like a synthetic-input timing quirk of `simctl`/CGEvent
replay, not a product bug — hand→table drag with the same tool and step count worked first try
throughout. Real touch input on this interaction was not tested.

## Method and its limits

- Real **iOS 26.4 Simulator**, device **iPhone 17 Pro**, driven via `xcrun simctl` taps/drags
  (synthetic CGEvent touch input) against **Mobile Safari** in a normal browser tab (not
  home-screen / standalone PWA mode).
- No small-iPhone runtime (SE / mini) was installed on this machine — narrow-screen coverage is
  a gap, not confirmed here.
- No real hardware — Simulator touch synthesis and rendering can differ subtly from a physical
  device (notably: `xcrun simctl io booted screenshot` always returns the **portrait-native**
  pixel buffer, 1206x2622, even while the device is rotated to landscape; landscape screenshots
  in this report were re-rotated with `sips -r 90` after capture — see
  `landscape-calib-raw3.png` for the raw, unrotated artifact this produces).
- No Web Inspector / remote console was available, so JavaScript console errors could not be
  read directly. `vite.log` and a fresh `server.log` (multiplayer server started for the online
  test) were checked instead and show no request failures or server-side errors during the
  whole session.
- A local match was played by tap only, in both orientations, including reset/undo, draw,
  Mexe Mode, and a rotate-mid-match round trip. Online lobby was tested both with the
  multiplayer server down (the default state at the start of this task) and running
  (`npm run server`, port 8787).

## Simulator targets available

Booted and used: **iPhone 17 Pro, iOS 26.4** (only device driven this pass).
Also available but not exercised: iPhone 17 Pro Max, iPhone 17e, iPhone Air, iPhone 17,
iPad Pro 13/11, iPad mini, iPad Air 13/11, iPad (A16) — all iOS 26.4. No SE/mini runtime.

## Viewport measurements

Read from the `:5199` calibration page (`iw`/`ih` = `window.innerWidth/Height`,
`vv` = `visualViewport` size), Safari as a normal browser tab (not standalone):

| Orientation | Device screen (pt) | Reported viewport (`iw`x`ih`) | Notes |
|---|---|---|---|
| Portrait | 402 x 874 | 402 x 714 | ~67pt status bar above, ~93pt bottom URL-bar toolbar below |
| Landscape | 874 x 402 | 874 x 292 | ~110pt consumed by the top address+tab bar in landscape Safari |

## Baseline screenshot index

All paths relative to `docs/screenshots/ios-baseline/`.

**Portrait**
- `portrait-menu.png` — main menu, first paint. Clear, legible, "Gire o celular" rotate hint visible, no safe-area/toolbar overlap.
- `portrait-match-start.png` — player-count picker ("ESCOLHA OS JOGADORES").
- `portrait-match-board.png` — match in progress, hand of 7, FEITO/COMPRAR row, icon toolbar.
- `portrait-card-selected.png` — single card tap selection (yellow outline), clear feedback.
- `portrait-three-selected.png` / `portrait-tap-check1.png` / `portrait-tap-check2.png` — multi-card selection probing (see Finding 4).
- `portrait-illegal-dest.png` — card dropped on empty table with <3 cards: red ✗ badge + dashed border + bottom reason text.
- `portrait-illegal-badge-tapped.png` — the ✗ badge tapped directly: reason text reproduced, confirms tap fallback (not hover-only).
- `portrait-feito-tap.png` — disabled FEITO tapped: no visible response (Finding 5).
- `portrait-after-reset.png` / `portrait-after-reset2.png` — Reset icon restores hand cleanly.
- `portrait-drag-to-table.png` — drag-to-illegal-table-spot, same reason UI as tap path.
- `portrait-drag-back-to-hand.png` — drag-back-to-hand attempt starting near the card's corner badge; **did not move the card** (Finding 3).
- `portrait-mexe-mode-on.png` / `portrait-mexe-mode-off.png` — Mexe Mode enter/exit, clean, no freeze.
- `portrait-after-comprar2.png` — COMPRAR draw, clear feedback text ("Juninho comprou uma carta.").
- `portrait-after-rotate-back.png` — mid-match rotate landscape→portrait, state and selection preserved.
- `portrait-online-alfa.png`, `portrait-online-lobby.png` … `portrait-online-lobby6-retry.png` — six independent attempts (different coordinates, then a 21-point grid, then with the multiplayer server started) to tap **ONLINE (ALFA)**; zero visible response every time (Finding 1).
- `portrait-english-menu.png` — English locale, menu fully translated (PLAY / RULES / TUTORIAL / Português / ONLINE (ALPHA)).

**Landscape**
- `landscape-calib-raw3.png` — raw (unrotated) `simctl` screenshot, kept as evidence of the capture-orientation quirk described in Method.
- `landscape-match-raw.png` — same quirk, captured immediately after the first `sim.sh rotate right` while a match was live.
- `landscape-menu.png` — menu in landscape, correctly re-rotated. Note the physical screen's curved/pill-camera edge on the right with no game control near it.
- `landscape-settings.png` — settings panel in landscape, fully readable, all rows fit without scrolling.
- `landscape-match-board.png` — match board in landscape: right-hand control column (gear/zoom/reset/undo/redo/FEITO/COMPRAR), none of it crowds the rounded screen edge or the home-indicator area at the bottom.
- `landscape-card-selected.png` — card tap-selection works identically to portrait.

## Confirmed blockers, worst first

### 1. ~~ONLINE (ALFA) button on the main menu never responds to touch — worst finding~~ NOT REPRODUCIBLE — see "Corrections" at top
**Retested 2026-09-10:** tapping device point (200,742) on the portrait menu opens the online
scene first try, showing "Connection error / Can't reach the game server. Is it running?" —
`docs/screenshots/ios-fixed/portrait-online-alfa-works.png`. The six failed attempts below were a
harness/coordinate error by this pass, not a product bug. Original evidence kept for the record.
**Evidence:** `portrait-online-alfa.png`, `portrait-online-lobby.png` through
`portrait-online-lobby6-retry.png`. Six attempts across this session: three coordinate guesses,
a 21-point tap grid (7 y-values x 3 x-values) covering the button's full visual footprint, all
with the offline multiplayer server stopped; then repeated with the server started
(`server.log` confirms `server_listening` on port 8787) and again in English locale. In every
case the screenshot after the tap(s) is pixel-identical to before — no scene transition, no
dimming, and no sign of the button's own "why blocked" toast
(`MenuScene.ts:136-140`, `flashOnlineBlocked`, a 2s red label) ever firing.
**Likely owner:** `src/scenes/MenuScene.ts:126-131` (button construction,
`onBlocked: () => this.flashOnlineBlocked()`) and `src/core/pwa.ts:6-8` (`isOffline()`, driven
by `navigator.onLine`). Two candidate root causes, either explains "never any feedback at all":
(a) `isOffline()` reports `true` inside this Simulator/WKWebView regardless of real
connectivity, permanently disabling the button, while the disabled-tap reason toast is easy to
miss between rapid taps; or (b) the button's interactive hit area genuinely isn't reachable by
touch here (unlike every other `PixelButton` tested, which all worked first-try).
**Score cap triggered:** online play is not reachable at all on iOS in this build — this alone
does not cap "gameplay cannot complete" (local play completes fine) but is the single worst
discovered defect.

### 2. Screenshot/rotation capture mismatch confused the whole landscape pass
**Evidence:** `landscape-calib-raw3.png`, `landscape-match-raw.png`. Not a game bug — `xcrun
simctl io booted screenshot` keeps returning portrait-native pixel dimensions regardless of
device orientation, so raw landscape captures render content sideways. Recorded here because it
cost significant time to diagnose and will bite the next person driving this Simulator the same
way; the fix is mechanical (`sips -r 90` after every landscape screenshot), not a product bug.

### 3. FIXED — Dragging a misplaced card back to hand can silently fail to start
**Root cause confirmed and fixed:** `src/scenes/GameScene.ts` ~line 1772, the meld-reason ✗ badge's
touch/portrait hit pad (`pad = strong ? 9 : 5`) covered roughly the top half of a small invalid
meld's card art at depth above the card, winning the hit test over both tap and drag-start. Fixed
by shrinking the touch/portrait pad to 2 (desktop's 5 unchanged). See "Fixes applied" at top for
full detail and `docs/screenshots/ios-fixed/portrait-drag-table-card-to-hand-success.png` /
`landscape-drag-table-card-to-hand-success.png` for proof.
**Original evidence:** `portrait-drag-to-table.png` (illegal placement succeeds) →
`portrait-drag-back-to-hand.png` (return-drag starting near the card's top-left corner does
nothing; only the reason tooltip reappears). Reset (icon 4 in the toolbar) reliably fixes the
hand instead (`portrait-after-reset2.png`), so this is a workaround-available issue, not a hard
stop.

### 4. FIXED — Tap-based multi-card meld selection is unclear / possibly single-select only
**Root cause confirmed and fixed:** `src/scenes/GameScene.ts` `onCardTapped` (was lines
1167-1177). With a hand card selected, tapping a different hand card fell through to
`placeSelected('hand', null)` → `returnHandCard` on a card never played this turn, which fails
silently (selection cleared, nothing selected). This was not a multi-select design question —
it was a straight bug: the second tap was supposed to switch the selection. Fixed by detecting
"held card and tapped card are both still in the remaining hand" and calling `selectCard` in that
case; logic extracted to `src/table/tap-destination.ts` for a real unit test. See "Fixes applied"
at top and `docs/screenshots/ios-fixed/portrait-hand-switch-selects-second.png` /
`landscape-hand-switch-selects-second.png` for proof. (3+ card meld selection is unaffected —
each hand card still selects/switches one at a time, then is placed onto a meld/new-pile
destination; that flow was always intact once the switch bug above is fixed.)
**Original evidence:** `portrait-card-selected.png` (single card selects fine) →
`portrait-three-selected.png` / `portrait-tap-check1.png` / `portrait-tap-check2.png` (a second
tap on a different card did not add to the selection — it deselected the first card).

### 5. ~~FEITO gives no feedback at all when disabled~~ NOT REPRODUCIBLE — see "Corrections" at top
**Retested 2026-09-10:** tapping the disabled DONE button prints "Cannot confirm yet: <reason>"
to the status line — `GameScene.ts:923` wires `onBlocked: () => this.onFeitoBlocked()` (impl at
`GameScene.ts:1453`) — `docs/screenshots/ios-fixed/portrait-done-disabled-reason.png`. Original
evidence kept for the record.
**Evidence:** `portrait-feito-tap.png` — tapping the crossed-out ("X FEITO") button while a
meld is invalid produces no shake, sound, or new text; the reason is only visible because it was
already sitting in the persistent status line above the toolbar from the prior illegal-drop tap.
If a player reaches a disabled FEITO without first having tapped a bad meld (e.g. hand simply
isn't organized yet), tapping it currently teaches nothing new by itself — it relies entirely on
the always-on status line already being correct and current.
**Likely owner:** FEITO's `onBlocked` path (or lack of one) versus `PixelButton`'s existing
`opts.onBlocked` hook (`src/ui/widgets.ts:127-207`), which the ONLINE button *does* use
(`MenuScene.ts:129`) but FEITO's construction should be checked for parity in `GameScene.ts`.

## Game-dev UX scores (1–10)

**Re-scored 2026-09-10** after the correction pass and the two real fixes (hand-to-hand tap
switch, badge hit-pad). ONLINE and FEITO-blocked-feedback were never actually broken (see
Corrections); the corner-badge drag/tap steal and the tap-switch bug were real and are now fixed
and re-verified on-device, portrait and landscape. No score-cap condition applies: local play
completes end-to-end by tap, card movement is reliable via tap and drag in both directions
(table→hand included), FEITO's blocked reason is visible and re-announced on tap, ONLINE opens
the (offline) online scene on tap, and no safe-area insets hide any control in either orientation.

| Axis | Score | Why |
|---|---|---|
| Usability | 9 | Menu and match flow are self-explanatory; the two real frictions (dead-drag corner, tap-switch bug) are fixed. Small-iPhone coverage still unconfirmed. |
| Readability | 8 | Cards, hand, status line, and toolbar are all crisp and legible in both orientations at native iPhone scale. |
| Input reliability | 8.5 | Tap/drag both directions (hand↔table) now solid in portrait and landscape; badge still tappable for its tooltip without stealing the card underneath. |
| Visual polish | 8 | Consistent pixel-art style, clean safe-area handling, settings panel scales well to landscape. |
| Performance feel | 8 | No stutter, jank, or dropped frames observed across ~60 interactions; rotation transitions are smooth. |
| Game-feel / tactility | 8 | Selection highlight, snap sounds implied by code, reset/undo, and the now-correct blocked-FEITO status text are all satisfying. |

## Top 10 fixes ranked by impact

1. **Fix or diagnose ONLINE (ALFA) unresponsiveness.** `src/core/pwa.ts:6-8` /
   `src/scenes/MenuScene.ts:126-131`. Patch idea: log/expose `isOffline()`'s actual value on this
   button's tap (or temporarily force `setEnabled(true)`) to isolate whether it's a false-offline
   read or a genuine hit-area miss; on iOS WKWebView, prefer a `fetch`-based reachability probe
   over trusting `navigator.onLine` alone for gating this button.
2. **Give FEITO a `pointerup`-time blocked reason**, matching the pattern `PixelButton` already
   supports via `opts.onBlocked` (`src/ui/widgets.ts:127-207`) and that ONLINE already uses
   (`MenuScene.ts:129`). One-line patch: pass `onBlocked: () => this.flashFeitoBlocked()` (new,
   mirroring `flashOnlineBlocked`) when constructing the FEITO button in `GameScene.ts`.
3. **Shrink or reposition the meld-reason ✗ badge's hit rectangle** so it doesn't compete with a
   misplaced card's own drag-start zone. `src/scenes/GameScene.ts:1770-1791`: reduce `pad` or
   move the badge origin to the card's true corner pixel with the card sprite anchored beneath it
   given priority for the first ~4px.
4. **Clarify or extend the multi-card meld selection UX.** Confirm from source whether the
   current design is intentionally single-select-plus-drag for melds, and if so make the
   in-game hint say so explicitly (current PT copy "Toque em uma carta e depois no lugar para
   mover" reads like single-card move-only, not "select several, then play").
5. **Add a `sips`/rotation note to the harness docs** (not a product bug, but wasted real time
   this pass) so future Simulator-driven audits don't re-diagnose the same portrait-native
   screenshot quirk.
6. Small: verify `onlineBtn.setEnabled(!isOffline())` re-runs on `connectivitychange`
   (`MenuScene.ts:32-34` claims it does) actually fires inside the Simulator's network stack —
   if `online`/`offline` browser events never fire in the Simulator, the button could be stuck
   in whatever state it read at scene `create()`.
7. Consider a very brief non-blocking toast/haptic-style flash the *first* time a player taps a
   card corner near a badge and nothing drags, to teach "grab the middle of the card" rather than
   silently doing nothing.
8. Verify `flashOnlineBlocked`'s 2-second red text (`MenuScene.ts:136-140`) is positioned somewhere
   a rapid string of taps (as a confused real player would do) can't outrun/miss it — consider a
   persistent line instead of a timed flash for this specific button, mirroring the reliable
   always-on status line pattern already used for meld/FEITO reasons.
9. Nice-to-have: the landscape control column in `src/ui/regions.ts:145-169` sits comfortably
   clear of the rounded screen edge/Dynamic Island cutout on iPhone 17 Pro — worth re-confirming
   on iPhone 17 Pro Max/Air where the safe-area geometry differs, once that runtime is used.
10. Nice-to-have: re-run this whole pass on a small-iPhone runtime (SE/mini) once installed —
    the crowded 7-card hand row already looks close to full-width on the 402pt-wide iPhone 17 Pro;
    a narrower screen is the likely place card-hand crowding first becomes a real problem.

## Independent re-verification on an erased device (final pass)

Everything below was re-run by the lead session on the iPhone 17 Pro (iOS 26.4) **after
`xcrun simctl erase`**, so it is a first-launch device with no saved settings, no leftover Safari
tabs and no accumulated rotation state — the earlier passes had polluted all three.

| Check | Coordinate (device pt) | Result | Screenshot |
|---|---|---|---|
| First launch, pt-BR default | — | Menu renders, rotate hint in pt-BR matching a pt-BR UI | `docs/screenshots/ios-fixed/portrait-clean-device-pt-hint.png` |
| Select a hand card | 84,572 | Yellow ring on card 1 | `verify-hand-first-card-selected.png` |
| Tap a **second** hand card (Bug 1) | 238,572 | Ring moves to card 2 — previously cleared the selection | `verify-hand-switch-selects-second.png` |
| Tap the middle of a 1-card invalid meld (Bug 2) | 37,226 | Card selects. This exact point was dead before the badge-pad fix | `verify-badge-band-tap-selects-card.png` |
| Drag that table card back to the hand | 37,226 → 200,565 | Card returns to the hand; table empties | `verify-drag-table-card-back-to-hand.png` |
| en-US rotate hint | — | "Rotate your phone for more space." on an en-US UI | `portrait-en-locale-rotate-hint.png` |

The "table→hand drag needs ~40 synthetic steps" note recorded during the fix pass was a symptom,
not a cause: with the badge pad corrected the same drag succeeds from the card's centre, which is
where a player would actually grab it.

### Bug 3 (found during this re-verification) — DOM overlays render in the wrong locale

`src/main.ts` built the portrait/rotate hint at module scope with `t('a11y.rotateHint')`, and
`setLocale(settings.get().locale)` only ran later, inside `MenuScene.create()`. So every DOM
overlay outside Phaser rendered in the default locale: an en-US player saw an en-US menu with a
pt-BR hint above it ("Gire o celular para ter mais espaço.") on every launch.

Fix, `src/main.ts`:
- apply the saved locale once at startup, right after `installDebugApi()`, before anything reads copy;
- read `t('a11y.rotateHint')` inside `updatePortraitHint()` on every show instead of capturing it
  once, so a locale switch mid-session is picked up the next time the hint appears.

Evidence: `portrait-en-locale-rotate-hint.png` (en-US UI, en-US hint) and
`portrait-clean-device-pt-hint.png` (pt-BR default on a first-launch device).

### Harness note — a wedged Safari looks exactly like a broken app

Late in the fix pass the app stopped responding to every tap and kept re-rendering an identical
frame (same replay seed) across `openurl` and even across a Safari relaunch, while the iOS status
bar clock kept ticking. Erasing the device cleared it completely. Treat "the whole scene ignores
input and the canvas never repaints" as a suspect simulator state, not a product finding, and
re-test on a fresh device before writing it down — the first baseline pass filed two blockers
(ONLINE, FEITO) that were the same class of artefact.

## Deferred items

- Small-iPhone (SE/mini) coverage — no runtime installed this session.
- Real hardware pass — Simulator only.
- Web Inspector / console error capture — not available from this harness; relied on
  `vite.log` and `server.log`, both clean.
- Full multi-card meld flow to a completed FEITO — not reached, since single-card selection
  behavior (Finding 4) needs a source read to test correctly rather than guessed coordinates.
- PWA installed/standalone-mode testing — this pass used Mobile Safari tabs only, per task scope.
- iPad and other iPhone models — not driven this pass (see Simulator targets available).
