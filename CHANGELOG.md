# Changelog

All notable changes to MEXE! by phase. See `docs/STATUS.json` for the full
wave-by-wave log this summarizes.

## 1.0.0 — Phase 4 (launch polish)

- Readability floor: no user-facing text renders below a legible size at
  1280×720 (top bar, tooltips, FEITO disabled-reason, labels, win subtitle);
  large-text toggle now a bonus on top of a readable default, not a crutch.
- Fixed 4-player prop/UI occlusion (mug over the top bar, cookie plate under
  the FEITO tooltip) and prop/meld-zone collisions at crowded tables.
- Overflow-proof scaled meld layout, with hover meld-reason tooltips
  explaining why a table meld is invalid.
- Wooden button unification: every UI button (pause menu, rules/help panel,
  quit-confirm, tutorial skip/replay, settings, win, setup) now renders the
  `PixelButton` wooden 9-slice style (primary/secondary/danger palette) —
  no remaining flat-rect "programmer art" buttons.
- E2e coverage for rematch (WinScene "MESMA PARTIDA" starts a new game on
  the same seed) and reset-data (settings "APAGAR DADOS" wipes the
  versioned save and the game reboots clean).
- Four deterministic per-personality AI showcase captures (Dona Cida,
  Juninho, Bia, Seu Zé), each with its `ai:thought` asserted.
- Release packaging: version bump to 1.0.0, `docs/RELEASE_NOTES.md`, README
  refresh.

## 0.3.0 — Phase 3 (flow, persistence, accessibility, perf, release)

- Pause menu with quit confirmation, Esc shortcut, in-game help (rules panel).
- Soft error recovery: window errors surface as a toast with a safe return to
  the menu instead of a dead scene.
- Versioned persistence (`mexe-save-v1`): settings, locale, volumes, reduced
  motion, last seed, tutorial-completed — with migration, corrupt-save
  fallback, and a "reset data" button.
- 34 rules-engine edge tests (empty melds, zero-card confirm, reset exactness,
  mid-draft round-trip, 3/4-player turn order, stalemate ties, win-only-via-
  confirm) plus deterministic per-personality AI regression snapshots.
- Accessibility: colorblind-safe validity (✗ badges + dashed strokes, not
  color-only), keyboard shortcuts (undo/redo/reset/draw/confirm/sort/help/
  pause), a +25% large-text toggle, meld separators at minimum layout gap.
- Performance evidence: a 20-game AI-vs-AI soak test and an 80-card stress
  render check (fps ≥ 50), both gated in `npm run verify`.
- Audio rebalanced to a consistent loudness order (win > feito > invalid >
  drop/draw > pickup/snap > click > ambience), all peaks ≤0.5 pre-volume.
- `npm run build` gated in `verify`; STATUS.json now carries a `metrics`
  block (per-shot fps, viewports, test counts) written on every verify run.

## 0.2.0 — Phase 2 (Mexe Mode polish, AI, tutorial, settings)

- Overflow-proof table layout, drag lift/shadow, FEITO confirm fx, invalid-
  meld badges.
- `RearrangerAi`: bounded table rearranging (edge steals, run splits, inter-
  meld moves) on top of `SimpleAi`'s direct-play search; four personalities
  (Dona Cida, Juninho, Bia, Seu Zé) wrapping the two skill levels.
- 10-step interactive tutorial (teach-by-doing over a scripted table), full
  PT/EN localization.
- Setup screen (seat/personality picker), settings overlay (mute, SFX/music
  volume, reduced motion, language), looping ambience.
- Expanded verification: AI showcase captures, fps gate, 1080p capture,
  viewport logging.

## 0.1.0 — Phase 1 (playable core)

- Pure rules engine (deck, deal, meld validation, confirm/draw turn cycle,
  win/stalemate detection) with no Phaser dependency.
- Mexe Mode draft editor: freely rearrange table melds during your turn, with
  undo/redo/reset, gated by `canConfirmTurn`.
- Phaser scenes rendering the rules-engine state; PixelLab-generated pixel
  art throughout (no programmer art).
- `window.__MEXE__` debug API and Playwright screenshot suite for
  deterministic, headless verification.
