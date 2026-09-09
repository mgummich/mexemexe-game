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

## Rules

Full ruleset (authoritative): [`docs/RULES.md`](docs/RULES.md). Summary:

- 2–4 players, 7 cards each, **two 54-card decks = 108 cards** (52 standard +
  2 jokers per deck, so 4 jokers total). No discard pile — nothing is ever
  thrown away.
- Melds: **runs** (3+ same suit, consecutive ranks, ace low *or* high, never
  both in the same run — no K-A-2 wrap) and **groups** (3+ same rank; suits
  may repeat since there are two decks, capped at 4 cards by default).
- **Jokers** are wildcards in a run or group. Every joker in a valid meld must
  resolve to a concrete card; a meld needs at least one natural card to anchor
  it.
- **MEXE MODE**: on your turn, freely break, move, split, merge and rebuild the
  shared table melds — every meld on the table is shared. Temporary invalid
  states are fine while editing.
- **FEITO** (confirm) only enables when: every table meld is valid, you played
  at least 1 card from your hand, and no table card left the table.
- No play? **COMPRAR**: draw 1 card and pass. Drawing only happens when you
  pass or can't/won't play — never at the start of a turn.
- First player to empty their hand wins ("bateu!"). If the draw pile runs out
  before that, the game ends immediately and whoever holds the fewest cards
  wins (ties go to the earliest seat).

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

## Online Alpha

2-player private rooms over WebSocket, added in 1.1.0. This is an **alpha**:
see Known issues below before you invite anyone to try it.

### Run the server

```bash
npm run server      # tsx server/index.ts, listens on :8787 by default
PORT=9000 npm run server   # override the port
```

Or run the game and the server together with Docker:

```bash
docker compose up -d --build   # game on :8080, server on :8787
```

See `SELF_HOSTING.md` for HTTPS/`wss://` deployments.

The server is a plain Node + `ws` process, separate from the Vite dev
server/static build. It exposes a health check at `GET /health` (`{"ok":true}`)
and has no other HTTP routes. Local play (menu → JOGAR) never touches this
process — the game works fully offline with the server down or not running at
all; only the `ONLINE (ALFA)` menu path needs it.

### Play online

1. Main menu → **ONLINE (ALFA)**.
2. One player taps **CRIAR SALA** (create room) and gets a 5-character room
   code (vowel-free alphabet, unambiguous to read aloud); **COPIAR** copies it.
3. The other player taps **ENTRAR** (join) and types the code into the
   browser's `window.prompt()` dialog (see Known issues).
4. Both players toggle **PRONTO** (ready); the match starts automatically the
   moment both seats are ready — there is no separate "start" step.
5. **VOLTAR** always works, in every lobby state, and leaves the room.

Play itself is the same Mexe Mode flow as local play, with two differences:
FEITO and COMPRAR become submit-and-wait (the button locks until the server
answers), and the opponent's turn is strictly read-only with no drag handlers
wired — you watch, you don't touch. Illegal proposals come back with the same
localized rejection reasons local play already uses. The win screen only
offers **MENU** online — no rematch (see Known issues).

### WebSocket URL resolution

The client resolves the server URL in this order:

1. `?ws=` query param override (e.g. `?ws=wss://example.com:8787`) — highest
   priority, mainly for testing against a non-default server.
2. `VITE_WS_URL` build-time environment variable.
3. Same-host default: `ws://<current hostname>:8787`.

**HTTPS caveat**: a page served over `https://` cannot open a plain `ws://`
connection — the browser will block it. Any deployment serving the game over
HTTPS must set `VITE_WS_URL` to a `wss://` URL pointing at a TLS-terminated
WebSocket endpoint. This is the most common first-deployment surprise.

### Local vs online

Local (offline) play is unaffected by any of this: no network code runs
unless you enter the online menu, and the local renderer path is untouched.
Online play is a different "driver" feeding the same Phaser scenes — the
server holds the only authoritative game state (both hands, the draw pile,
whose turn it is), and clients only ever see a redacted per-seat view (their
own hand, the opponent as a card count).

### Alpha limitations and known issues

- **Join code entry uses a native `window.prompt()` dialog** — not a styled,
  localized in-canvas text input. A deliberate alpha shortcut.
- **Opponent avatar is the generic player icon online** — there are no
  accounts, so there's no avatar to show.
- **No accounts, no matchmaking, no ranked play, no chat.**
- **2 players only** — no 3/4-player online rooms.
- **No online rematch** — the win screen online only offers MENU, never
  "MESMA PARTIDA"; starting another game means returning to the lobby and
  creating/joining a new room.
- **No socket liveness probe** — the server never actively pings a silent
  peer, so a half-open (not cleanly closed) connection can hold a seat until
  the disconnect grace timer eventually notices, rather than immediately.
- **Reconnect is a single bounded retry, not a persistent retry loop** — on
  an unexpected disconnect the client attempts one reconnect shortly after;
  if that fails, it falls back to returning you to the local menu with a
  message. It does not keep retrying indefinitely.

### Scripts

| Script | Does |
|---|---|
| `npm run server` | Runs the WebSocket server (`server/index.ts` via `tsx`) |
| `npm run test:server` | Runs the server unit suite (`tests/server`) only |
| `npm run verify:multiplayer` | Builds, runs the two-client Playwright multiplayer flow (including a forced disconnect/reconnect), and gates on client console errors, server stderr, and illegal-proposal rejection |

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
