# PHASE 2 AUDIT

*Audited by: Fable (audit/critique role — no code edits). Implementation: Sonnet.*

## Current state

Phase 1 shipped a playable 2–4 player Mexe-Mexe: pure tested rules engine
(50 unit tests), Mexe Mode draft editor with undo/redo/reset, 4 deterministic
AI personalities, PT/EN i18n, PixelLab art fully integrated (0 missing
assets), 7 Playwright captures, `npm run verify` green, 0 console errors,
58–60fps.

## Broken / risky

1. **Table overflow silently hides melds** — `GameScene.layoutMelds` does
   `if (cy > TABLE_BOTTOM - CARD_H) break;`. Late game with many melds, cards
   become invisible and undraggable while still counted by the validator.
   Correctness-adjacent; worst latent bug in the game.
2. **Pointer-drag path has zero e2e coverage** — editor ops are tested, but the
   drop-zone hit logic (`onCardDropped`) is not.
3. **fps reads 0 outside GameScene** in verify logs (update loop only there) —
   log noise, weakens the perf gate.

## Missing vs Phase 2 spec

- **Mexe Mode feel**: no hand-added-card marker, no drop-zone highlight during
  drag, no lift shadow, no confirm animation, no accidental-confirm guard,
  no invalid-meld badge (only glow), no enter/exit transition.
- **AI**: Rearranger only steals meld-edge cards to form new melds with exactly
  2 hand cards; never splits runs, never moves cards between existing melds,
  no "reduce hand most" preference, no hard timeout enforcement. No AI
  showcase screenshot.
- **Tutorial**: static 4-card text slideshow; spec demands teach-by-doing with
  10 steps, highlights, action blocking, skip/replay.
- **Menus/UX**: no seat setup (human/AI per seat), no personality select, no
  settings/pause, no replay-same-seed / new-seed, no rules summary, no
  tooltips, no card sort toggle.
- **Audio**: no hover sfx, no mute or volume sliders, no ambience/music, no
  reduced-motion setting.
- **Localization gaps**: `'Você'` hardcoded ×3 in MenuScene; emote glyphs and
  undo/redo/reset button glyphs bypass i18n (acceptable); everything else
  routed through `t()`.
- **Verification**: missing captures for setup, AI showcase, PT vs EN, Mexe
  valid state, 1920×1080 viewport.

## Programmer-art areas

- Menu player-count buttons + backdrops = tinted rects (PixelButton color
  fallback). Undo/redo/reset use text glyphs `↶↷⟲` on wood.
- Emote bubble content is text glyphs. Everything else is PixelLab art.

## UX confusion

- Which table cards are "mine this turn" is invisible → players fear breaking
  the no-return rule.
- Drop targets invisible until drop fails.
- FEITO disabled reason is small, far from the table.
- No feedback distinguishing "meld too small" group vs "wrong cards" group at
  the meld itself (only red glow).

## Perf

60fps steady; AI decisions <20ms in practice. No issues. Full re-render per
draft op is O(cards) and fine at this scale.

## Top 10 tasks (ranked)

1. Fix meld overflow: shrink card gap / add second column scaling so all melds
   always visible (correctness).
2. Hand-added card marker + drop-zone highlight during drag (core Mexe feel).
3. FEITO confirm animation + guard (brief hold or double-tap prevention) and
   bigger reason display near table.
4. Puzzle AI: run splitting + inter-meld moves + reduce-hand-most preference +
   hard timeout; keep determinism; tests.
5. Interactive tutorial (10 steps, teach-by-doing, highlight + block, skip).
6. Setup screen: seats, personalities, seed replay/new; localize 'Você'.
7. Settings: mute, SFX/music volume, reduced motion; pause menu.
8. Audio polish: hover/turn sfx, procedural ambience loop.
9. Verification expansion: setup/AI/PT/EN/1080p captures, fps fix, drag e2e.
10. Art nits: menu count buttons via btn-small texture, emote faces, boteco
    smudge cleanup (PixelLab inpaint or overlay prop).
