<div align="center">

# MEXE!

### *Arruma. Desarruma. Bate.*

A polished pixel-art digital card game based on Brazilian **Mexe-Mexe**,
built with Vite + TypeScript + Phaser 3.

[![CI](https://github.com/mgummich/mexemexe-game/actions/workflows/ci.yml/badge.svg)](https://github.com/mgummich/mexemexe-game/actions/workflows/ci.yml)
[![Deploy](https://github.com/mgummich/mexemexe-game/actions/workflows/pages.yml/badge.svg)](https://github.com/mgummich/mexemexe-game/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**[▶ Play in your browser](https://mgummich.github.io/mexemexe-game/)** ·
**[📚 Documentation](https://mgummich.github.io/mexemexe-game/docs/)** ·
**[🤝 Contributing](CONTRIBUTING.md)**

![game](docs/screenshots/final/game.png)

</div>

All art generated with [PixelLab](https://pixellab.ai) (see
`docs/PIXELLAB_ASSETS.md`), design pillars in `ART_DIRECTION.md`, technical
design in `ARCHITECTURE.md`, self-hosting via Docker in `SELF_HOSTING.md`.

## Rules (MVP)

- 2–4 players, 7 cards each, standard 52-card deck, no discard pile.
- Melds: **runs** (3+ sequential, same suit, ace low, no wrap) and **sets** (3+ same rank).
- **MEXE MODE**: on your turn, freely break, move, split, merge and rebuild the
  shared table melds. Temporary invalid states are fine while editing.
- **FEITO** (confirm) only enables when: every table meld is valid, you played
  at least 1 card from your hand, and no table card left the table.
- No play? **COMPRAR**: draw 1 card and pass.
- First player to empty their hand wins ("bateu!").
- Stalemate rule: with an empty draw pile, a full round of passes ends the
  game — fewest cards in hand wins.

## Features

- **Setup screen**: pick 2–4 seats and tap an AI avatar to cycle its
  personality before starting.
- **Interactive tutorial**: a 10-step teach-by-doing walkthrough over a
  scripted table — drag real cards, gated to the step's goal, with
  skip/replay and full PT/EN localization.
- **Settings overlay**: mute, separate SFX/music volume sliders, reduced
  motion (disables cosmetic tweens), and language toggle — persisted to
  `localStorage`.
- **Ambience**: a looping background audio bed under the SFX, muted/volumed
  by the same settings.
- **Two AI skill levels × four personalities**: `SimpleAi` (finds a legal
  meld/extension in hand) and `RearrangerAi` (adds bounded table
  rearranging — moving or splitting melds to unlock a play). Dona Cida,
  Juninho, Bia and Seu Zé each wrap one of the two levels with a distinct
  play style (see Opponents below).

## Run

```bash
npm install
npm run dev        # dev server
npm run build      # production build
npm run preview    # serve the build on :4173
```

Portuguese UI by default; switch to English from the main menu, the ⚙
settings overlay, or the `?lang=en` URL param.
URL params: `?seed=123` (deterministic deal), `?lang=en|pt` (locale override),
`?showcase=menu|game|game4|mexe|setup|settings|win` (jump straight to a
scene/state — used by the screenshot suite), `?ai=cida|juninho|bia|ze`
(forces the single opponent's personality in a 2-player showcase game, for
per-personality e2e captures).

## Controls

Mouse/touch: drag cards between hand and table. Keyboard (human turn only):

| Key | Action |
|---|---|
| Esc | Pause menu (quit confirmation, settings, help) |
| Z | Undo |
| Shift+Z / Y | Redo |
| R | Reset the draft |
| C | Comprar (draw and pass) |
| F | Feito (confirm turn) |
| S | Toggle hand sort (suit/rank) |
| H | Open the rules/help panel |

Validity indicators are never color-only: an invalid meld also shows a ✗
badge and a dashed stroke; the FEITO button is prefixed with ✕ when disabled.
A +25% large-text option lives in the settings overlay.

## Asset replacement

All art is generated with PixelLab and lives under `public/assets/` (see
`docs/PIXELLAB_ASSETS.md` for the full prompt/path table). Drop in a
replacement at the same path/size and it's picked up automatically — no code
changes needed. `BootScene` HEAD-probes every path in `src/assets/manifest.ts`
before loading: a missing file never crashes the game, it silently falls back
to a procedural placeholder texture (`src/assets/fallbacks.ts`) instead.
Audio (`public/assets/audio/*.wav`) is synthesized by `scripts/gen-sfx.mjs`
(`node scripts/gen-sfx.mjs` to regenerate) since PixelLab doesn't produce
audio; a missing SFX file is a silent no-op.

## Known issues

- Boteco felt smudge only partly covered by the dominoes prop (cosmetic, 2p
  games only).
- Pointer-drag drop path is verified via editor hooks in e2e, not raw
  synthetic pointer drags.
- Ambience is a procedural cricket-bed loop, no composed music track.
- Pixel font renders PT accents slightly rough at small sizes.

## Test / verify

```bash
npm run test        # Vitest — rules engine, Mexe Mode editor, AI, perf soak (112 tests)
npm run lint        # eslint + tsc
npm run screenshot  # npm run build, then Playwright: boots the game, drives
                    # Mexe Mode via the window.__MEXE__ debug API, captures
                    # docs/screenshots/*.png and writes verify-log.json
npm run verify      # all of the above + gate on console errors/missing assets/low fps;
                    # also merges perf/test metrics into docs/STATUS.json
```

## Opponents

| Character | AI level | Style |
|---|---|---|
| Dona Cida | Simple | conservative — plays the minimum |
| Juninho | Simple | aggressive — dumps everything he can |
| Bia | Rearranger | puzzle-minded — rearranges the table to unlock plays |
| Seu Zé | Rearranger | patient — holds small plays early |

AI is deterministic, budgeted (<100ms simple, <500ms rearranging), can never
confirm an illegal table, and logs an explanation for every decision
(`ai:thought` event).

## Project layout

`src/rules` is a pure, fully-tested rules engine (no Phaser). `src/mexe-mode`
holds the draft editor with undo/redo/reset. Phaser scenes only render state
and forward intents. See `ARCHITECTURE.md`.

## Contributing & license

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). CI runs lint,
unit tests, build and the Playwright e2e suite on every push and PR; the
`main` branch auto-deploys the game and docs to GitHub Pages.

Licensed under the [MIT License](LICENSE).
