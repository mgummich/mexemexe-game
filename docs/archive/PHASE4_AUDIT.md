# PHASE 4 AUDIT — Launch readiness

*Auditor: Fable (prose only). Implementation: Sonnet. Baseline: Phase 3 PASS —
110/110 unit, 19/19 e2e, lint, build, verify all green; 57–60fps; 0 console
errors; 0 missing assets (re-verified 2026-09-08).*

## Launch readiness

The game is a genuine release candidate: full flow works, rules and AI are
hardened and tested, accessibility and localization are in place, perf is
verified. What stands between RC and a *polished launch build* is almost
entirely visual/readability polish and release packaging — not stability.

## Blocker bugs

None found by tests or verify. Candidate functional risks to re-check in the
UX pass rather than true blockers:

1. **Prop/UI occlusion (4p gingham table)**: the mug prop overlaps Dona
   Cida's avatar/deck area in the top bar, and the cookie-plate prop sits
   directly *under* the FEITO/COMPRAR buttons with the FEITO tooltip
   rendered over the cookies — the disabled-reason text is unreadable there
   (`docs/screenshots/final/game4.png`).
2. **Prop/meld-zone collision at crowded tables**: napkin and bottle-cap
   props sit inside the meld grid area; drop zones and cards render over
   them but the zone dashes visually tangle with the props
   (`stress-table.png`, `mexe-invalid.png`).
3. **Clipped icon bottom-left** in game scenes (sort toggle?) — partially
   cut by the table frame (`game.png`, `game4.png`).

## Stuck states

None known. Pause/quit-confirm, error toast → menu fallback, rematch (MESMA
PARTIDA), new match, and menu return all exist and are captured. Rematch and
"apagar dados" deserve one explicit e2e each (currently only reachable, not
asserted end-to-end).

## UX friction

- **Micro-text illegibility is the #1 launch problem.** At 1280×720 the
  top-bar status ("Sua vez"), deck count, FEITO disabled-reason tooltip,
  invalid-meld badge text, settings slider labels ("efeitos", "ambiente"),
  setup subtitle, and WinScene "Você venceu!" all render at 6–8px pixel-font
  sizes that are borderline unreadable in every screenshot. This undermines
  first-click clarity, FEITO-reason clarity, and turn prompts — three
  explicit Phase 4 goals — at once.
- Turn indicator is text-only and tiny; the active player has no strong
  visual state (highlight/pulse on avatar).
- FEITO disabled reason lives in a small tooltip pinned above the button;
  in 4p it collides with the cookie plate (above).

## Rules/AI risks

Low. Engine pure + deterministic, 44 rules tests + 12 draft + 25 AI + soak;
win only via confirm; AI confirm gated by `canConfirmTurn`. Remaining:
- No per-personality *showcase screenshots* (only mid/after pair on one
  seed) — Phase 4 asks for one per personality.
- Pointer-drag path still verified via editor hooks, not synthetic pointer
  drags (carried issue; acceptable if stated in RELEASE_NOTES).

## Art/audio weak spots

- **Flat-rect secondary buttons read as programmer art**: menu TUTORIAL /
  REGRAS / ENGLISH, win NOVA PARTIDA / MENU, setup VOLTAR + player-count
  chips, settings Silenciar / reduced-motion / large-text / English /
  APAGAR DADOS / FECHAR are plain solid-color rectangles next to the
  polished wooden JOGAR button. This is the closest thing to a "no
  programmer art" gate violation left. One PixelLab 9-slice button set
  (primary/secondary/danger states) fixes all screens.
- 4p red gingham tablecloth is loud; acceptable, but the mug/cookie plate
  prop scale is the real issue (occlusion, above).
- Boteco felt smudge (carried, cosmetic).
- Audio balanced in Phase 3; verify sliders/mute once more in final pass, no
  known weak spots.

## Accessibility gaps

Good baseline (colorblind-safe validity, keyboard map, large-text toggle,
reduced motion, no flashing). Gaps:
- Small default text sizes are themselves an accessibility issue (above);
  large-text toggle exists but default must be readable.
- Keyboard map documented in README; not shown in-game help? confirm the
  help panel lists shortcuts.

## Perf/build issues

None blocking. 57–60fps everywhere incl. stress table; soak test green;
build gated. Notes: single 1.55MB chunk (Phaser, documented); package.json
`version` is `0.1.0` while CHANGELOG says 0.3.0 — bump to 1.0.0 at launch.

## Docs/store gaps

- `docs/RELEASE_NOTES.md` missing (required deliverable).
- No per-personality showcase screenshots; no store-style screenshot set.
- package.json version mismatch (above).
- CHANGELOG needs a 1.0.0 Phase 4 entry at the end.

## Top 10 launch tasks (ranked)

1. **Readability pass**: raise minimum UI text sizes (top bar, tooltips,
   labels, win subtitle) so nothing critical renders below a legible size at
   1280×720; keep large-text toggle as a bonus, not a crutch.
2. **Fix 4p prop occlusion**: mug must not overlap the top bar/avatars;
   FEITO/COMPRAR button panel and its tooltip must render on a clear
   backdrop above the cookie plate; keep props out of the meld grid area
   (or under a reserved-layout exclusion).
3. **PixelLab button set**: wooden/9-slice primary + secondary + danger
   button frames replacing every flat rectangle (menu, win, setup,
   settings); consistent hover/disabled states.
4. **Active-player clarity**: highlight/pulse the active avatar; bolder turn
   prompt.
5. Fix clipped bottom-left icon; sweep all HUD elements for frame clipping
   at both resolutions.
6. E2e for rematch (MESMA PARTIDA → same seed new game) and reset-data;
   4 per-personality showcase captures.
7. Confirm in-game help lists keyboard shortcuts; add if missing.
8. `docs/RELEASE_NOTES.md` + CHANGELOG 1.0.0 entry + package.json version
   1.0.0 + README refresh (Phase 2 header says "Features (Phase 2)").
9. Final screenshot set per Phase 4 list (incl. per-personality, PT+EN,
   both resolutions) regenerated after visual fixes.
10. Final critic scoring loop + STATUS.json launch gate.
