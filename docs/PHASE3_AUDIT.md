# PHASE 3 AUDIT

*Auditor: Fable (prose only). Implementation: Sonnet. Baseline: Phase 2 PASS — 75/75 unit, 14/14 e2e, 15 screenshots, 0 console errors, 0 missing assets.*

## Release-readiness

Core game is solid and verified. What separates it from a release candidate:
flow gaps around pause/quit/error recovery, persistence is settings-only and
unversioned, accessibility is partial (no keyboard, color-only validity),
no memory/perf regression evidence, no CHANGELOG/controls docs, build not
gated in verify.

## Remaining Phase 2 gaps (carried open issues)

- Boteco felt smudge only partly covered by dominoes prop (cosmetic).
- Pointer-drag path verified via editor hooks, not synthetic pointer drags.
- Ambience procedural only (acceptable; keep optional/muteable).
- PT accents slightly rough at 6–7px font sizes.

## Broken/missing flows

1. No pause menu with **quit confirmation** — leaving a match is an instant
   scene switch (gear overlay pauses AI but has no "abandon match?" guard).
2. No **soft error recovery**: window errors are logged to `__MEXE__.errors`
   but the player sees nothing; a thrown error mid-scene can dead-end.
3. No in-game **help/rules** access (rules panel exists in menu only).
4. First-boot language select absent (locale defaults pt; persisted after
   toggle — acceptable, but note in docs).

## Rules/AI risks

- Rules functions pure + well tested; spec cases NOT yet explicitly tested:
  empty-meld arrays in drafts, add-zero-card confirm on an empty table,
  reset-restores-exact-state equality, save/load round-trip mid-Mexe turn,
  3/4-player turn order cycling, win only via applyConfirmedTurn (vs draw).
- AI: no per-personality regression snapshots; no showcase screenshots per
  personality; deck-exhaustion behavior covered only implicitly by smoke test.
- `WinScene` new-seed uses `Date.now()` — fine (UI layer), but must never leak
  into rules.

## UX confusion

- Validity is color-only (green/red glow) — colorblind users can't
  distinguish; needs icon/badge channel (✓/✗ marker on meld zone).
- No keyboard shortcuts at all.
- Large tables: adaptive layout works but gap-compressed melds lack visual
  separators between adjacent melds at minimum gap.

## Art/audio gaps

- Felt smudge (above). Results screen is WinScene banner — adequate, could
  show per-player card counts ("results" feel). Audio: volumes unbalanced
  (win jingle louder than rest); no AUDIO_DIRECTION.md.

## Accessibility gaps

- Keyboard: undo/redo/reset/draw/confirm/sort/help unbound.
- Color-only validity indicators (critical).
- No font-scale option (feasible: +25% UI text toggle).
- No flashing effects today — keep it that way.

## Perf

- 58–60fps verified at 1280×720; no memory-growth evidence across simulated
  games; full re-render per draft op allocates text/images each call —
  acceptable at this scale but unmeasured at 80 cards.

## Packaging

- `npm run build` passes but is not part of `verify`; >500kB single chunk
  warning (Phaser — acceptable, note it); no CHANGELOG.md; README lacks
  controls/asset-replacement/known-issues sections.

## Top 10 Phase 3 tasks (ranked)

1. Pause menu + quit confirmation + in-game help; soft error recovery
   (error boundary → toast + safe return to menu).
2. Versioned persistence (`mexe-save-v1`): settings, locale, volumes,
   reduced motion, last seed, tutorial-completed; migration + corrupt-save
   fallback + "reset data" button; tests for corrupt localStorage.
3. Rules edge tests: empty melds, zero-card confirm, reset-exactness,
   serialize round-trip mid-draft, 3/4p turn order, win-only-via-confirm.
4. Colorblind-safe validity (✓/✗ badges + patterns) and text labels not
   color-only.
5. Keyboard shortcuts (Z undo, Y/Shift+Z redo, R reset, C draw, F confirm,
   S sort, H help, Esc pause).
6. AI regression: per-personality deterministic decision snapshots + 4
   showcase e2e captures; explicit deck-exhaustion + crowded-table tests.
7. Perf evidence: 20-game simulated soak (headless unit test, assert no
   unbounded growth via texture/object counts), 80-card render check,
   metrics recorded into STATUS.json.
8. Audio balance pass (normalize per-sfx volumes), optional font-scale.
9. Verify gains `npm run build`; screenshot set per Phase 3 list.
10. Release docs: CHANGELOG.md, README (controls/rules/asset replacement/
    known issues), AUDIO_DIRECTION.md; Sonnet reviews all.
