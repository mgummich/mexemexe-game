# Art Direction

## Phase 9 note — procedural cosmetics route

PixelLab account ran out of credits. New cosmetics (2 tables, 1 card back,
2 emotes) were generated procedurally instead — deterministic geometric
patterns (tile grids, stripes, wood grain, lattice, star/glyph masks) via
`scripts/gen-cosmetics.mjs`, following the same procedural-fallback pattern
already used for SFX (`scripts/gen-sfx.mjs`) and texture fallbacks
(`src/assets/fallbacks.ts`). Palette sampled from existing PixelLab assets
to stay in the same colour world. See `docs/PIXELLAB_ASSETS.md` Phase 9
section for the full asset list.
