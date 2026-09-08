# MEXE! 1.0.0 — Release notes

*Arruma. Desarruma. Bate.* A pixel-art digital card game based on Brazilian
**Mexe-Mexe**, for 2–4 players (you + AI opponents).

## What's included

- Full Mexe-Mexe rules: 7-card deal, runs and sets, free table rearranging
  on your turn (**Mexe Mode**) with undo/redo/reset, FEITO confirm gating,
  COMPRAR draw-and-pass, win on empty hand ("bateu!"), stalemate rule.
- 2–4 players against four AI personalities (Dona Cida, Juninho, Bia,
  Seu Zé) across two skill levels; deterministic, explainable AI that can
  never confirm an illegal table.
- 10-step interactive tutorial (teach-by-doing).
- Portuguese (pt-BR) and English (en-US), switchable at any time.
- Settings: mute, SFX/ambience volume, reduced motion, +25% large text,
  language, reset data — persisted locally.
- Accessibility: colorblind-safe validity indicators (badges + strokes, not
  color-only), full keyboard shortcuts, no flashing effects.
- Verified performance: 57–60fps at 1280×720 and 1920×1080, including an
  80-card stress table.

## Controls

Mouse/touch: drag cards between hand and table. Keyboard (your turn):
Esc pause · Z undo · Shift+Z/Y redo · R reset draft · C comprar · F feito ·
S sort hand · H help.

## Known issues

- Boteco felt smudge partly covered by the dominoes prop (cosmetic, 2p).
- E2e drag coverage uses the editor debug API, not raw synthetic pointer
  drags.
- Ambience is a procedural loop, not a composed music track.
- Pixel font renders PT accents slightly rough at the smallest sizes.

## Credits & license notes

- Design/code: built with Vite, TypeScript and Phaser 3 (MIT-licensed
  framework).
- All art generated with PixelLab (see `docs/PIXELLAB_ASSETS.md` for the
  full prompt/asset table); no copyrighted third-party assets.
- All audio synthesized by `scripts/gen-sfx.mjs` (procedural; no recorded
  samples).

## Asset generation notes

Every sprite lives under `public/assets/` and is hot-swappable: replace the
file at the same path/size and the game picks it up. Missing files fall back
to safe procedural placeholders; missing audio is a silent no-op.

## Build instructions

```bash
npm install
npm run dev        # dev server
npm run build      # production build (tsc + vite)
npm run preview    # serve the build on :4173
npm run verify     # tests + lint + build + screenshot/fps/console gates
```

Useful URL params: `?seed=123` (deterministic deal), `?lang=en|pt`,
`?showcase=…` (jump to a scene; used by the screenshot suite).
