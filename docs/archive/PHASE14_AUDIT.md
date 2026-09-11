# Phase 14 Audit — Mexe Mode Hints, Crowded-Table Scaling, and Mobile Exceptions

Entry state: `npm run test` → 330/330 pass on `feat/joker-one-per-meld`, lint and build clean.

## Current helper behavior

Phase 12 added snap-target legality feedback. All of it lives in `computeSnapTargets()` (called once per `dragstart`), which returns `SnapTarget[]` — each target holds a `status` (legal / incomplete / illegal), a reason when illegal, a display-sorted preview, and joker assignments. The model calls `analyzeMeld()` for every potential drop, so it mirrors the rules engine exactly.

Desktop drag shows visual feedback:
- **Legal targets:** gold 1 px stroke over the meld.
- **Illegal targets:** no visual distinction from legal (same gold stripe).
- **Hover hinting:** the invalid-meld ✗ badge is tappable (not just hover-only after Phase 12 §6), opening a latched tooltip with the reason text.
- **FEITO gate:** the reason text appears in `reasonText` on-screen and in the disabled FEITO button's tap feedback (`blockingReasonText()`).

All helpers are **draggable-only** (not tap-first). The tap-select-then-place path (`selectCard`, `onCardTapped`, `placeSelected`, `renderSelectionLayer`) exists and is keyboard-bound; it mirrors drag rules exactly but receives no visual feedback — no preview, no illegal-target colouring, no tappable badge details for selections.

## Current mobile Mexe behavior

Phase 13 re-authored the portrait world (270x480), authored full portrait layout in `gameRegions()`, and wired orientation-flip re-layout. The mobile board is now a real layout, not a warning.

**Portrait:** table full-width at top (88–320 world units), hand below (y=344), pinned action bar at bottom with FEITO (140 units wide, 40 tall) and COMPRAR (104 wide, 36 tall) side by side. Undo/redo/reset/sort clustered above COMPRAR. Touch hit areas grow for coarse pointers.

**Tap controls:** `onCardTapped()` selects a hand/table card; a second tap on a destination executes the move (same rules as drag). The touch path works end-to-end but has **zero visual feedback**: no preview meld, no invalid-target colouring, no reason tooltips, no "tappable invalid-badge".

**Landscape:** unchanged from before (480x270, right column reserved for buttons).

**Orientation flip:** wired via `viewport:changed` bus event; GameScene re-lays out live state without restart.

## Current ghost-preview behavior

A non-mutating ghost preview panel is built on `dragover` (line 1558 in GameScene), populated from snap-target data, and destroyed on drag leave/cancel/drop. It renders:
- The previewed meld (display-sorted cards).
- Joker assignments when the target is legal.
- Status colour (gold for legal, grey for incomplete, red for illegal).

**The preview exists only for drag.** It is not shown for tap-select-then-place at all. No ghost or preview is rendered while a card is selected; the player sees the drafted board with no hint of what would happen if they tap a destination.

## Crowded-table issues

The meld packer (`computeMeldLayout()`) compresses card gap, then card scale, then row gap, always spacing rows by at least one full row height. At 58 cards it holds 58 fps; the constraint is not CPU but space: the packer gets a 254–370-unit box (portrait-wide or landscape with right column reserved). Portrait's full-width table can hold 30% more melds at the same scale.

**No per-density scaling of text, buttons, or UI elements exists yet.** A crowded table does not resize opponent strips, deck counter, or reason text to free space for melds.

## Tutorial/help gaps

The only on-screen hint (`game.selectHint`) describes arrow keys and Enter — the keyboard path. Touch players see no hint that tap-select-then-place is supported. The invalid-meld badge reason is now tappable (Phase 12), but a drag-only feature; tap-select cannot reach it.

The `objective.invalidEdit` string (shown in the objective line) still says "passe o mouse no ✗" (pt) / "hover the ✗" (en), which is wrong advice on a phone. No equivalent hint for touch exists.

The joker "stands for" hint (`joker.standsFor`) is **hover-only** — a tapped card shows nothing on a touch screen.

## Accessibility risks

- **Sub-44px touch targets:** Settings slider, undo/redo icons, small buttons on tight screens.
- **Non-tappable affordances:** Tooltips (badge reason, joker hint) are hover-only.
- **Colour-only status:** Invalid targets have no indicator beyond red color in the preview; a 1 px stripe change is easy to miss.
- **No alt text for visual feedback:** The preview meld, status stripes, and badge badges carry no narration.
- **Reduced-motion:** Ghost preview tweens are instant (scale 0), but no reduced-motion guard exists on re-render loops.

## Affected files

| File | Blocks needing changes |
|---|---|
| `src/scenes/GameScene.ts` | `renderAll()` (:1072–1160), `selectCard()` (:901–905), `onCardTapped()` (:947–957), `placeSelected()` (:909–945), `onCardDropped()` (:1729+), `layoutMelds()` (:1338–1480), `renderSelectionLayer()` (:1533–1650), `makeCardSprite()` (:1484–1520), `wireDrag()` (:1527–1570), `showDropZoneHighlights()` (:1581–1620), `updateDropZoneHover()` (:1620–1728), `showMeldReasonTooltip()` (:1305–1330), `blockingReasonText()` (:1165–1195) |
| `src/table/snap.ts` | Full module; already built but no tap-preview integration yet. |
| `src/mexe-mode/draft.ts` | `DraftEditor` class — already complete; no changes needed. |
| `src/ui/regions.ts` | Layout tables (landscape, portrait) — already complete for Phase 13; button hit-area expansion for touch already in place. |
| `src/ui/viewport.ts` | `view()`, `refreshProfile()` — already wired; no changes needed. |
| `src/localization/i18n.ts` | Add keys for: preview status labels, tap-select hints, joker tooltip copy. |
| `src/core/settings.ts`, `src/core/persistence.ts` | Settings store already has `touch` flag via viewport; no changes needed. |
| `src/ui/settings-panel.ts` | Slider handle radius; safe-area padding on canvas. |
| `src/ui/rules-panel.ts`, `src/ui/pause-menu.ts` | Portrait-proof centering (already generic via `cx`/`cy`). |
| `tests/snap.test.ts` | Already complete; tests the model. |

## Key API surface

### snap.ts
```typescript
export type SnapStatus = 'legal' | 'incomplete' | 'illegal';

export interface SnapTarget {
  meldId: string | null;
  status: SnapStatus;
  reason: ReasonCode | null;
  preview: Card[];
  jokerAssignments: JokerAssignment[];
}

export function computeSnapTargets(
  draft: DraftState,
  card: Card,
  config?: RulesConfig
): SnapTarget[];

export function snapTargetFor(targets: readonly SnapTarget[], meldId: string | null): SnapTarget | null;
```

### rules.ts
```typescript
export function analyzeMeld(cards: readonly Card[], config?: RulesConfig): MeldAnalysis;
export function canConfirmTurn(state: GameState, draft: DraftState, invalidMeldReasons?: MeldReason[]): ConfirmResult;
export function getInvalidMeldReasons(melds: readonly Meld[], config?: RulesConfig): MeldReason[];
```

### draft.ts
```typescript
export class DraftEditor {
  constructor(committed: GameState);
  getDraft(): DraftState;
  getRemainingHand(): Card[];
  newMeldId(): string;
  playHandCard(cardId: string, meldId: string | null, position?: number): boolean;
  moveTableCard(cardId: string, targetMeldId: string | null, position?: number): boolean;
  returnHandCard(cardId: string): boolean;
  splitMeld(meldId: string, index: number): boolean;
  mergeMelds(sourceId: string, targetId: string): boolean;
  undo(): boolean;
  redo(): boolean;
  reset(): void;
  canConfirm(): ConfirmResult;
  invalidMelds(): MeldReason[];
  analyze(): { invalidMelds: MeldReason[]; check: ConfirmResult };
  historyLength(): number;
}
```

### viewport.ts
```typescript
export interface ViewProfile {
  w: number;
  h: number;
  portrait: boolean;
  touch: boolean;
}

export function view(): ViewProfile;
export function refreshProfile(): boolean;
export function pickProfile(winW: number, winH: number, coarsePointer: boolean): ViewProfile;
```

### regions.ts
```typescript
export interface GameRegions {
  w: number;
  h: number;
  portrait: boolean;
  touch: boolean;
  // ... 20+ positional fields (barH, deckImg, opponentX0, tableTop, handY, feito, comprar, etc.)
}

export function gameRegions(p: ViewProfile): GameRegions;
```

### settings.ts
```typescript
export const settings = {
  get(): Settings;
  update(patch: Partial<Settings>): void;
  progress(): Progress;
  cosmetics(): Cosmetics;
  updateCosmetics(patch: Partial<Cosmetics>): void;
  setLastSeed(seed: number): void;
  setTutorialCompleted(): void;
  resetData(): void;
  onChange(fn: () => void): () => void;
  sfxVolume(): number;
  musicVolume(): number;
  motionScale(): number;
  fontScale(): number;
};
```

### i18n.ts
```typescript
export function t(key: string, params?: Record<string, string | number>): string;
export function setLocale(l: Locale): void;
export function getLocale(): Locale;
export function localeKeys(l: Locale): string[];
```

## Existing invalid-reason codes

The validator returns these ReasonCodes when a meld fails:

```typescript
'reason.meldTooSmall'           // fewer than 3 cards
'reason.notAMeld'               // not a valid run or group
'reason.noHandCard'             // FEITO without playing ≥1 hand card
'reason.cardMissing'            // table card missing from draft (cannot return to hand)
'reason.duplicateCard'          // same card id appears twice
'reason.foreignCard'            // card not in committed table or active hand
'reason.groupTooLarge'          // group exceeds rank limit (4 suits → max 4 cards)
'reason.groupDuplicateSuit'     // trinca repeats a natural suit
'reason.groupAllJokers'         // group is all jokers
'reason.jokerUnassignable'      // joker cannot stand for any legal card
'reason.tooManyJokers'          // meld has 2+ jokers
'reason.runWrap'                // Ace wraps (K-A-2 invalid)
```

**Missing from Phase 14 scope (not yet in validator):**
- Sequence invalid gap (e.g., 3-4-6 with no 5 and no joker)
- Sequence suit mismatch (mixed suits in run)
- All-joker sequence (joker-only run)
- Player must add 1 hand card (gate check, not meld-level)
- Table card cannot return to hand (gate check, not meld-level — already exists as `reason.cardMissing`)

## Top 10 tasks for Phase 14

1. **Ghost preview for tap-select:** compute snap targets once per `selectCard()`, show a preview panel (layout, status, joker assignments) while holding a selection. Clear on deselect. Assert preview does not mutate the draft.

2. **Tap-select visual feedback:** colour invalid targets red (matching drag illegal zones), incomplete yellow (matching drag incomplete), legal green in the preview and in the selection-layer rendering.

3. **Tappable badge for tap-select:** when a card is selected, highlight the invalid-meld ✗ badges and wire them to show the reason tooltip (same latching behaviour as drag). Deselect hides tooltips.

4. **Joker hint for tap-select:** the joker "stands for" tooltip on a table card is tappable when a card is selected; showing it without a gesture. Wire joker-hover logic to `pointerover` only when the destination card is in the current selection's snap-targets.

5. **Reword objective line:** change `objective.invalidEdit` from "hover the ✗" to "tap the ✗ for details" (pt/en), so it's accurate for touch.

6. **Touch-select hint:** add a key like `game.selectHint.touch` describing the tap-select-then-place flow (pt/en), and show it when `view().touch` is true.

7. **Preview ghost for both paths:** ensure the ghost preview (currently drag-only) is also shown for tap-select, styled identically. Clear both on final placement or deselect.

8. **Crowded-table scaling (layout-only):** no text/button resize in Phase 14; measure existing meld-zone density and verify the packer never regresses below 45 fps even at 80 cards.

9. **Settings slider touch target:** grow the slider handle radius from 4 to at least 6 units; test that the hit area is ≥44 CSS px on a coarse pointer.

10. **Safe-area inset:** apply `viewport-fit=cover` plus `env(safe-area-inset-*)` CSS to the canvas container in `index.html`, so notches and home indicators don't cover the board. Test on a notched device or emulator.

## Out of scope (Phase 14)

Full helper-mode auto-solver, best-move hints, per-density UI scaling (text/buttons), reduced-motion guard on ghost preview tweens, alt text for visual feedback, new art, new rules, ranked/accounts/chat, PWA/offline, native packaging.

## What shipped

All ten items above landed except #9 (settings slider touch target) and #10
(safe-area inset), which were already covered by Phase 13, and item #4 (the
joker "stands for" tooltip staying `pointerover`-only), which is still open —
see Priority issues below.

- **Wave A** — three helper modes (`src/ui/helpers.ts`): Beginner, Standard,
  Expert. Persisted via `settings.helperMode()` with a sanitized fallback for
  a corrupt/invalid stored value. A settings-panel row switches between them.
  The mode only ever changes what is displayed; legality is unaffected.
- **Wave B** — the tap/keyboard select-then-place path got the same
  legality feedback drag already had: legal-destination highlights on
  selection, a non-mutating ghost preview, and multi-reason tappable invalid
  badges. `reason.notAMeld` was too broad for runs, so it was split into
  `reason.runSuitMismatch` (mixed suits) and `reason.runGap` (a jokerless
  hole); the FEITO reason shows live or only on attempt depending on mode.
- **Wave C** — a focused mobile Mexe editor (`src/table/editor-layout.ts`):
  a full-screen, scrollable meld-list view for portrait phones, toggled by an
  icon left of Undo, with a larger workspace and the existing sticky action
  bar underneath.
- **Wave D** — table zoom (`src/table/zoom.ts`): +/- buttons step through
  `ZOOM_FLOORS` (no pinch gesture), panning is clamped to content height, and
  a magnifier icon opens a read-only, large meld-focus view in landscape.
  `debugApi.mexe.zoomLevel/panOffset/focusedMeldId` back all of it for e2e.
- **Wave E** (this pass):
  - **Bug fix**: a card sprite kept the zoomed-table geometry mask through a
    drag, so dragging it out of the masked table area (e.g. toward the hand)
    visually clipped it mid-drag — drop logic was unaffected, this was purely
    cosmetic. Fixed by clearing the mask on `dragstart` and restoring it on
    `dragend` in `GameScene.wireDrag()`, guarded by a
    `debugApi.mexe.cardMasked()` e2e assertion in the existing
    `zoom-card-drag-precedence` test.
  - **Tutorial/help**: the tutorial's invalid-meld step and the
    `objective.invalidEdit` line no longer say "hover the ✗" (the latter was
    already fixed pre-Wave-E); the step now says to tap it. The rules/help
    panel (`src/ui/rules-panel.ts`) gained a third, scrollable content block
    (`rules.uiHelp`) covering helper modes, selection highlights, the ghost
    preview, the mobile editor, zoom/focus, and the online locked
    (not-your-turn) state — scrolling reuses `clampScroll` from
    `src/table/editor-layout.ts` rather than growing the panel past the
    viewport, which the first draft of this content did (caught by
    screenshotting `help`/`help-en` before shipping it).
  - **Localization**: `tests/i18n.test.ts`'s `NEW_KEYS` smoke list was
    extended with every Phase 14 key group (helper mode, mobile editor,
    zoom/focus tooltips, `rules.uiHelp`) so a future locale gap fails loud,
    not just the generic key-parity check.
  - **Screenshots**: `zoom-buttons`, `zoom-buttons-reachable`,
    `zoom-card-drag-precedence`, `meld-focus-dismissed` and `settings`
    already existed as captures but weren't in `EXPECTED_SHOTS`; they're now
    registered so the gate enforces them. The existing
    `mp-mobile-waiting-waiting` multiplayer capture already covers "online
    locked mobile" — no new capture was needed.

## Still open after Phase 14

- The joker "stands for" tooltip on a table card (`GameScene`, the
  `pointerover`/`pointerout` pair near the meld-rendering loop) remains
  hover-only; a touch user selecting a card never sees it. This was
  item #4 in the top-10 list above and wasn't the bug this phase was asked to
  fix, so it's carried forward rather than folded in as scope creep.
