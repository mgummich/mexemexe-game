# UI/UX Usability Design Audit

**Date:** 2026-09-11 · **Version audited:** 1.7.0 · **Status:** audit + first implementation pass done.

Legend: ✅ fixed in this pass · ⏸ deferred (reason given).

## 1. Where the UI lives

| Area | Source |
|------|--------|
| Main menu | `src/scenes/MenuScene.ts` |
| Seat/AI picker | `src/scenes/SetupScene.ts` |
| Online lobby | `src/scenes/OnlineScene.ts` |
| Board, HUD, toolbar, Mexe editor | `src/scenes/GameScene.ts` |
| Screen geometry (landscape/portrait/touch) | `src/ui/regions.ts` |
| Menu-family geometry + wood panel | `src/ui/menu-layout.ts` |
| Settings overlay | `src/ui/settings-panel.ts`, row geometry in `src/ui/settings-layout.ts` |
| Pause overlay | `src/ui/pause-menu.ts` |
| Buttons, labels, tooltips | `src/ui/widgets.ts` |
| Helper-mode display flags | `src/ui/helpers.ts` |
| "What should I do now" phases | `src/core/objective.ts` |
| Meld packing on the table | `src/table/layout.ts` |
| All copy, pt + en | `src/localization/i18n.ts` |
| Rotate hint, error toast | `src/main.ts` |

Helper modes, invalid-meld badges, legal-target glow, ghost preview, meld focus, table zoom,
the mobile Mexe editor and the tap-then-place flow already existed before this pass. What was
missing was clarity, not capability.

## 2. Findings

### Blocking clarity
1. ✅ **A greyed DONE never said why on desktop or in expert mode.** `helperFlags().feitoReason`
   blanked the reason line outside beginner/standard. Now the blocking reason is live in every
   mode, and expert only loses the checklist.
2. ✅ **`✕ FEITO` mixed a cancel glyph into a confirm button.** Playtesters read it as "press to
   cancel". The label is now always plain FEITO/DONE; the reason line beside it is the
   non-colour cue.
3. ✅ **No DONE checklist.** Beginner mode now lists the three conditions with ✓/✕ (played a hand
   card / all melds valid / nothing returned to hand), derived from `canConfirmTurn`'s own result.
4. ✅ **Objective copy was generic.** Phases are now state-aware: start, card-selected,
   played-tap-DONE, table-invalid, ready-to-confirm.

### Table and board
5. ✅ **Melds packed to the top-left of a mostly empty table.** `computeMeldLayout` now centres
   each row horizontally and centres the block vertically when it fits.
6. ✅ **The meld magnifier was a ~7-unit tap target** — a click one pixel off selected the card
   underneath. It now carries an enlarged hit rect, like the invalid badge already did.
7. ⏸ **Meld trays / slot art.** Deferred: centring removed most of the "empty table" feel; trays
   are decoration on top of a layout that now reads correctly.

### Menu and setup
8. ✅ **The menu's backdrop was a near-transparent rectangle with a hairline stroke** — it read as
   a debug overlay. Both menu and setup now use one shared opaque wooden panel (`woodPanel`).
9. ✅ **`ONLINE (ALFA)`** shouted a warning. Now `SALA ONLINE` / `ONLINE ROOM` with a small
   "Teste alpha" / "Alpha test" line under it.
10. ✅ **Replay-seed button sat in the player's path.** Now behind an ADVANCED toggle.
11. ✅ **No match summary before starting.** Setup shows "2 jogadores · Você vs Juninho · Partida
    local".
12. ✅ **"toque para trocar" repeated once per AI row.** One shared line under the seat list.

### Settings
13. ✅ **One flat 14-row list mixing audio sliders, accessibility toggles, a language switch and
    COPY TEST LOG** read as a debug screen. Now a 7-row section menu (Mute / Game / Audio /
    Accessibility / Cosmetics / Advanced / Close) over one sub-panel each.
14. ✅ **COPY TEST LOG and RESET DATA are behind Advanced**, together with the build version.

### Mobile
15. ✅ **"Rotate your phone for more space" greeted every phone player at boot** — wrong, portrait
    has a hand-authored layout. Softened to "Retrato funciona. Paisagem dá mais espaço." and shown
    only during a match.
16. ✅ **Pause menu had no reassurance and inconsistent capitalisation.** Added "Jogo pausado. Seu
    progresso está seguro." and made every button caption uppercase.
17. ⏸ **Toolbar is icon-only** (↶ ↷ ⟲ ▦ ⚙ + −). Tooltips work on tap as well as hover, so it is
    not hover-only, but the glyphs are still ambiguous on first sight. Collapsing the portrait row
    to Undo / Reset / Sort / More needs a new overflow panel and moves controls the e2e suite
    targets by coordinate — deferred as its own change.

### Mexe mode
18. ✅ **"Editor focado" and "Toque numa combinação acima."** said nothing about what happens.
    Now "Editor de mesa em tela cheia" and "…para mexer nela."
19. ⏸ **Per-meld mini-reason inside the mobile editor.** The badge + tap-for-reason path already
    works there; deferred as polish.

### Online (alpha)
20. ⏸ **Connection dot is 6 units**, no waiting timeout UI, no host marker, no room summary.
    Deferred with the timer work below — the online surface deserves one coherent pass, not
    piecemeal labels.

### Not attempted, and why
- **Server-owned turn timers, presets, reconnect grace, timeout behaviour.** `docs/STATUS.json`
  records the turn timer as an unwired hook; this is a server feature plus a protocol change, not
  a UI pass. Building it half-way would ship a client-side timer, which the rules forbid.
- **AI difficulty / personality / speed / explanation settings.** `src/ai/ai.ts` has personalities
  but no difficulty model; exposing settings that don't change play would be a lie in the UI.
- **The wider quick-move helper set** (split handles, merge melds, Tidy Table, "return my new
  cards"). Tap-then-place, quick-add and smart sort already exist; the rest is new game-feel
  surface, each piece needing its own "cannot duplicate or lose a card" proof.

## 3. Verification

`npm run test` 564/564 · `npm run lint` clean · `npm run build` clean · `npm run screenshot`
84 browser tests + 3 perf, `verify: OK` · `npm run verify:multiplayer` 10/10 ·
`npm run verify:pwa` 13/13. Screenshots regenerated under `docs/screenshots/`.
