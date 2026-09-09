# Phase 12 Audit — Smart Drag / Snap Helpers

Scope: make card movement easier to read and harder to get wrong — legal snap targets,
drag feedback, ghost previews, invalid-drop feedback, clearer FEITO reasons — without
touching a single game rule. Out of scope: mobile redesign, tap-first controls, hint or
best-move buttons, helper-mode systems, new rules, new content.

## 1. Entry state

Measured, not assumed, at the start of the phase:

- `npm run test`: 320/320 pass, 21 files, 2.4 s.
- Branch `feat/joker-one-per-meld`, clean tree, on top of the 1-joker-per-meld rule change.
- `docs/STATUS.json` carries Phase 11's metrics; there is no separate issue register.

## 2. Current drag behaviour

All of it lives in `src/scenes/GameScene.ts`.

| Concern | Where | What it does today |
| --- | --- | --- |
| Draggable sprites | `makeCardSprite` (`:1341`) | Every card gets a padded hit rect; `setDraggable` + `wireDrag` only when `interactive` (local seat's own turn, no pending online submit). |
| Lift feedback | `wireDrag` dragstart (`:1397`) | Depth 300, alpha 0.95, 1.15× scale, ellipse shadow, `sfx-pickup`. |
| Drop-zone hints | `showDropZoneHighlights` (`:1424`) | A gold 1 px stroke over **every** meld zone plus a dashed outline round the whole table area. |
| Hover emphasis | `updateDropZoneHover` (`:1438`) | Hovered meld's stroke goes 2 px / 0.95 alpha. |
| Drop resolution | `onCardDropped` (`:1470`) | Meld zone → `playHandCard` / `moveTableCard`; table area with no zone → new meld; hand strip → `returnHandCard`. Snap-back tween when the editor refuses. |
| Tap alternative | `renderSelectionLayer` (`:1533`) | Select-then-place ring; mirrors `onCardDropped`'s rules exactly. |

**The gap is legality.** The highlights are legality-blind: every meld glows the same gold
whether the dragged card would extend it, wreck it, or is a second joker it can never
accept. The player only learns the difference *after* dropping, from the meld turning red.

## 3. Current validation feedback

- `DraftEditor.analyze()` (`src/mexe-mode/draft.ts:175`) returns invalid melds and the
  confirm check in one pass; `renderAll` (`:1044`) already uses it for both.
- Invalid melds get a red dashed border + `✗` badge; valid ones green solid + `✓`
  (`layoutMelds`, `:1240`). Colour is never the only channel — good, keep it.
- The reason text is **hover-only**: `badge.on('pointerover', …)` at `:1285`. On a
  touch device there is no hover, so the reason is unreachable. `objective.invalidEdit`
  even says "passe o mouse no ✗" / "hover the ✗", which is wrong advice on a phone.
- The FEITO strip shows a *phase* message (`objectivePhase`, `src/core/objective.ts`),
  so any invalid meld collapses to the generic "conserte o jogo inválido" — the exact
  reason (too many jokers / repeated suit) exists but is not surfaced there.

Reason strings already exist for every `ReasonCode` in both locales
(`src/localization/i18n.ts:105` pt, `:298` en), including the two the brief calls out:
`reason.tooManyJokers` and `reason.groupDuplicateSuit`. The brief's preferred copy
capitalises "Coringas"; the repo spells it "curinga" lowercase everywhere, so the existing
strings stay as they are — matching the rest of the game beats matching the brief's
capitalisation.

## 4. Affected files

- `src/table/snap.ts` — **new**, pure snap-target model.
- `src/scenes/GameScene.ts` — drag feedback, ghost preview, tappable reasons, FEITO reason.
- `src/localization/i18n.ts` — preview/status strings, reworded `objective.invalidEdit`.
- `src/verification/debug-api.ts` — card/meld logical positions + snap-target readback for e2e.
- `tests/snap.test.ts` — **new**.
- `e2e/screenshot.spec.ts`, `scripts/check-verify.mjs` — new captures + gate entries.

## 5. Risks

**Rule risk.** A snap model that re-derives legality would be a second rules engine that
can drift from `analyzeMeld`. The model must *call* `analyzeMeld` and report what it says,
never reimplement it. Joker previews likewise come from `analyzeMeld`'s `assignments` —
`layoutMelds` already sets that precedent (`:1233`).

**UX / rules tension.** The brief asks for "bounce/restore on invalid drop", but Mexe Mode
is *built* on temporarily invalid drafts: rearranging the table means passing through
states the validator rejects, and FEITO is what gates them. Bouncing every rule-invalid
drop would remove the ability to rearrange at all.

*Decision:* a drop that lands on a meld is still accepted; the meld is drawn invalid, as
today. What changes is that the player sees red **before** letting go, not after. Bounce
stays reserved for drops the editor genuinely refuses (tutorial gate, table card that may
not return to hand) — behaviour that already exists. Illegality is therefore communicated,
never enforced by the helper: no helper may allow an illegal *confirm*, and the FEITO gate
is untouched.

**Online risk.** Drag is wired only when `interactive` is true, which is already false for
an inactive seat and during a pending submit (`:1004`). The snap model reads the local
draft only, so it cannot desync anything; the server stays authoritative.

**Performance risk.** Targets must be computed on `dragstart`, not per `drag` event. One
`analyzeMeld` per meld per pickup is a handful of microseconds; running it per pointer
move at a crowded table would not be.

**Preview mutation risk.** The preview must build its card array from copies and never
call a `DraftEditor` mutator. A test asserts `getDraft()` is byte-identical across a
preview.

## 6. Top 10 tasks

1. `src/table/snap.ts`: `computeSnapTargets(draft, card, config)` → per-meld
   `{ meldId, status, reason, preview }` with `status: 'legal' | 'incomplete' | 'illegal'`.
2. Unit tests for the model: sequence extension, trinca, repeated suit, second joker,
   joker-only-if-legal, new-meld target, refresh after draft edits.
3. GameScene: compute targets once on `dragstart`, colour highlights by status.
4. GameScene: ghost preview panel on drag-over — resulting meld, joker assignment, status.
5. GameScene: clear preview on drag leave / cancel / drop; assert preview is non-mutating.
6. Make the invalid-meld reason tappable, not hover-only; reword `objective.invalidEdit`.
7. FEITO strip: show the exact top reason when a meld is invalid, not the generic phase.
8. Debug API: `cardPos` / `meldPos` / `snapTargets` so e2e can drive a real mouse drag.
9. Screenshots: legal target, illegal target, valid preview, invalid preview, joker preview,
   tapped reason, both locales.
10. Update `docs/STATUS.json` and the verify gate's expected-shot list.
