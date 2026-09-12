# 12 — Mobile Portrait / Landscape

Goal: make table manipulation feel intentional on touch rather than like a shrunken desktop editor.

- **MOBILE-01** Use mobile-specific layout logic rather than simple desktop scaling.
- **MOBILE-02** Portrait structure: opponent/status → shared table → hand/actions.
- **MOBILE-03** During Mexe, enter a focused workspace: table expands, nonessential opponent/HUD detail recedes, hand/actions remain reachable.
- **MOBILE-04** Treat tap-select/tap-place as a first-class interaction; keep drag for direct nearby moves.
- **MOBILE-05** Offset dragged cards above the finger so rank/suit and target remain visible.
- **MOBILE-06** Increase invisible hit areas without visually inflating controls.
- **MOBILE-07** Keep FEITO, COMPRAR and RESET physically separated enough to avoid costly thumb slips.
- **MOBILE-08** Put high-frequency controls in easy thumb-reach zones; rare controls toward corners.
- **MOBILE-09** Provide semantic table zoom/focus levels or equivalent obvious controls; remember zoom during the turn.
- **MOBILE-10** Consider double-tap meld focus for dense boards.
- **MOBILE-11** Add gentle edge-pan during long drags with a dead zone and gradual acceleration.
- **MOBILE-12** Let landscape be the richer full-table layout, but never force rotation.
- **MOBILE-13** If useful, give a non-modal landscape suggestion only on very dense portrait boards.
- **MOBILE-14** Preserve draft, undo history, selection where feasible, validation, focus and zoom across orientation changes.
- **MOBILE-15** Make hand spacing adaptive; for very long hands prefer readable overlap or horizontal hand scrolling over unreadable compression.
- **MOBILE-16** Define gesture rules so hand scrolling and card dragging do not conflict.
- **MOBILE-17** Audit every hover affordance and provide touch equivalents.
- **MOBILE-18** Position tooltips/reasons away from the finger; consider bottom-sheet details for complex requested explanations.
- **MOBILE-19** Add restrained optional haptics where the platform/browser supports them cleanly.
- **MOBILE-20** Use sound as a second confirmation channel for touch actions.
- **MOBILE-21** Prevent browser scroll, pull-to-refresh, selection/context menus and navigation gestures from interfering with gameplay where feasible.
- **MOBILE-22** Respect safe areas/home indicators.
- **MOBILE-23** Test worst-case 4-player, crowded table, long hand, joker, invalid draft, large text, portrait state.

Verification: small/typical/large phones, tablet portrait/landscape, orientation mid-draft, touch-only flows, browser/PWA behavior.
