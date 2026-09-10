<div align="center">

# MEXEMEXE!

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
  both in the same run — no K-A-2 wrap) and **groups** (exactly 3 or 4 cards
  of one rank, with no repeated natural suits, even across decks).
- **Jokers** are wildcards in a run or group, but **each meld can use at most
  1 joker** — a meld with 2 or more jokers is invalid. Every joker in a valid
  meld must resolve to a concrete card; a group joker fills a missing suit of
  its natural rank, and every group needs at least one natural card to anchor it.
  Strategy: the table is shared, so playing a joker early can help other
  players — it is often best to save it for your final move.
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
- **Interactive tutorial**: a 12-step teach-by-doing walkthrough over a
  scripted table — drag real cards, gated to the step's goal, with
  skip/replay and full PT/EN localization. It teaches sets and runs, the
  exact-size / unique-suit trinca constraints (by letting you hit them), and
  jokers.
- **Settings overlay**: mute, separate SFX/music volume sliders, reduced
  motion (disables cosmetic tweens), and language toggle — persisted to
  `localStorage`.
- **Ambience**: a looping background audio bed under the SFX, muted/volumed
  by the same settings.
- **Two AI skill levels × four personalities**: `SimpleAi` (finds a legal
  meld/extension in hand) and `RearrangerAi` (adds bounded table
  rearranging — moving or splitting melds to unlock a play). Dona Cida,
  Juninho, Bia and Seu Zé each wrap one of the two levels with a distinct
  play style, own think pace and own emotes (see Opponents below).
- **Cosmetics**: 4 table themes, 5 card backs, 9 avatars — menu → ⚙ settings →
  **COSMETICS**, live preview, saved immediately. Strictly client-side: never
  touches the network protocol, game state or rules.
- **Context-aware music** (menu / mexe-draft / game) and a rematch summary on
  the win screen (turns, cards played, draws, plus a winning-move line and a
  per-personality avatar reaction) — local play only, see Known issues.
- **Three helper modes** (Settings → VISUAL HELP: Beginner/Standard/Expert)
  control how much legality feedback is shown — selected-card destination
  highlights, invalid-meld reasons, a ghost preview — without ever changing
  what a move is allowed to do. On a portrait phone, an icon next to Undo
  opens a full-screen Mexe editor for rearranging a crowded table by tap;
  + / − buttons zoom the table and a magnifier opens a read-only focus view
  of one meld.

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

## PWA / offline

MEXEMEXE! is installable (Add to Home Screen / desktop install) and works fully offline
once loaded once. Offline: local hot-seat and AI matches, the tutorial, rules/help,
settings and cosmetics — all unaffected. Not offline: **ONLINE (ALFA)** rooms, which need
a live connection, and background music, which is a large streamed file deliberately never
cached, so it stays silent offline (SFX is unaffected). A service worker precaches the app
shell on first load and serves cached assets on repeat visits; when a new version is
available, a dismissible banner lets you update after your current match instead of
interrupting it.

## Online Beta

2–4-player private rooms over WebSocket. Beta since 1.2.0 (wire protocol v3):
see Known issues below before you invite anyone to try it.

### Run the server

```bash
npm run server      # tsx server/index.ts, listens on :8787 by default
PORT=9000 npm run server   # override the port
MEXE_ENV=production npm run server   # production mode (see docs/OPERATIONS.md)
```

Or run the game and the server together with Docker:

```bash
docker compose up -d --build   # game on :8080, server on :8787
```

See `SELF_HOSTING.md` for HTTPS/`wss://` deployments, and `docs/OPERATIONS.md`
for the environment-variable reference, log format, health-check reading,
troubleshooting and rollback.

The server is a plain Node + `ws` process, separate from the Vite dev
server/static build. It exposes a health check at `GET /health`
(`{"ok":true,"uptimeSec":142,"rooms":3,"connections":7,"protocol":3}` — never
room codes or player names) and has no other HTTP routes. It caps inbound frames
at 16 KiB, probes every socket with a WebSocket ping every 15s and terminates one
that misses a probe, and rate-limits each connection. It reads its configuration
from the environment once at startup and refuses to start on an invalid value,
logs one JSON line per event with player names, tokens, addresses and card data
redacted in the logger itself, and shuts down gracefully on `SIGTERM`/`SIGINT`,
telling connected clients why. Local play (menu → JOGAR) never touches this
process — the game works fully offline with the server down or not running at
all; only the `ONLINE (ALFA)` menu path needs it.

### Play online

1. Main menu → **ONLINE (ALFA)**.
2. One player taps **CRIAR SALA** (create room) and gets a 5-character room
   code (vowel-free alphabet, unambiguous to read aloud); **COPIAR** copies it.
3. The other player taps **ENTRAR** (join) and types the code on the in-canvas
   code screen (letters/digits, `Backspace` to correct, `Enter` to join,
   `Esc` to go back).
4. Invite 1–3 friends. Every occupied seat toggles **PRONTO**; seat 0 then
   taps **COMEÇAR**. Start is disabled until all occupied seats are ready.
5. **VOLTAR** always works, in every lobby state, and leaves the room. When
   START is greyed out the lobby states why (too few players, or someone is
   not ready yet).

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
3. Same-origin default, following the page's protocol:
   `ws://<current hostname>:8787` over HTTP, `wss://<current host>/ws` over HTTPS.

**HTTPS**: a page served over `https://` cannot open a plain `ws://` connection —
the browser blocks it. The default handles this by switching to `wss://<host>/ws`,
which matches the reverse-proxy layout in `SELF_HOSTING.md`, so a TLS deployment
that follows that guide works without any build configuration. Set `VITE_WS_URL`
to a `wss://` URL only if your WebSocket endpoint lives somewhere else.

### Local vs online

Local (offline) play is unaffected by any of this: no network code runs
unless you enter the online menu, and the local renderer path is untouched.
Online play is a different "driver" feeding the same Phaser scenes — the
server holds the only authoritative game state (both hands, the draw pile,
whose turn it is), and clients only ever see a redacted per-seat view (their
own hand, the opponent as a card count).

### Alpha limitations and known issues

- **Opponent avatar is the generic player icon online** — there are no
  accounts, so there's no avatar to show.
- **No accounts, no matchmaking, no ranked play, no chat.**
- **2–4 private seats only** — no spectators or public matchmaking. The host
  starts once every occupied seat is ready.
- **No online rematch** — the win screen online only offers MENU, never
  "MESMA PARTIDA"; starting another game means returning to the lobby and
  creating/joining a new room.
- **Rate limiting is per connection, not per IP** — enough to stop a looping
  client, not a determined attacker opening many sockets.
- **A seat that stays disconnected is played for you** — after the 30s grace
  the server draws and ends that seat's turn so the match keeps moving. It
  never plays melds on your behalf.
- **Reconnect is a single bounded retry, not a persistent retry loop** — on
  an unexpected disconnect the client attempts one reconnect shortly after;
  if that fails, it falls back to returning you to the local menu with a
  message. It does not keep retrying indefinitely.

### Scripts

| Script | Does |
|---|---|
| `npm run server` | Runs the WebSocket server (`server/index.ts` via `tsx`) |
| `npm run test:server` | Runs the server unit suite (`tests/server`) only |
| `npm run verify:multiplayer` | Builds, runs 2P legal/reconnect safety, 3P/4P turn rotation, and the in-canvas join / hand-privacy / resync flows, then gates on client console errors, server stderr, illegal-proposal rejection, hand privacy and state-hash agreement |
| `npm run verify:preview` | Builds, serves `dist/` on :4173 and gates on the built client: every asset reference resolves, boot-time assets load, no credential-shaped strings in the emitted bundle |

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
changes needed. `BootScene` GET-probes every path in `src/assets/manifest.ts`
before loading: a missing file never crashes the game, it silently falls back
to a procedural placeholder texture (`src/assets/fallbacks.ts`) instead.
Audio (`public/assets/audio/*.wav`) is synthesized by `scripts/gen-sfx.mjs`
(`node scripts/gen-sfx.mjs` to regenerate) since PixelLab doesn't produce
audio; a missing SFX file is a silent no-op.

Two new tables, one new card back and two new emotes (`docs/PIXELLAB_ASSETS.md`
Phase 9 section) are generated procedurally by `scripts/gen-cosmetics.mjs`
(`npm run gen:cosmetics` to regenerate) instead of PixelLab — the PixelLab
account is currently out of credits, and procedural generation covers
geometric assets well; it was deliberately not used for character art (see
Known issues). Regeneration is deterministic: re-running produces
byte-identical PNGs.

## Known issues

- **Online games show no rematch stats or winning-move text** on the win
  screen — the client never observes the server's per-turn state locally, so
  there's no play-log data to summarize for an online match. Fixing this
  needs a protocol change, out of scope for now. The stats line is hidden
  entirely online rather than showing fake zeros.
- Boteco felt smudge only partly covered by the dominoes prop (cosmetic, 2p
  games only).
- Pointer-drag drop path is verified via editor hooks in e2e, not raw
  synthetic pointer drags.
- Ambience is a procedural cricket-bed loop, no composed music track.
- Pixel font renders PT accents slightly rough at small sizes.

## Test / verify

```bash
npm run test        # Vitest — rules engine, Mexe Mode editor, AI, play log, perf soak,
                    # cosmetics, music contexts
npm run lint        # eslint + tsc
npm run screenshot  # npm run build, then Playwright: boots the game, drives
                    # Mexe Mode via the window.__MEXE__ debug API, captures
                    # docs/screenshots/*.png and writes verify-log.json
npm run verify      # all of the above + gate on console errors/missing assets/low fps;
                    # also merges perf/test metrics into docs/STATUS.json
npm run gen:cosmetics # regenerate the procedural table/card-back/emote PNGs (deterministic)
npm run gen:icons   # regenerate the PWA manifest icons (deterministic)
npm run verify:preview # production-build smoke: dist/ serves, assets resolve, no secrets
                       # in the bundle
npm run verify:pwa  # production build only: service worker registers, offline reload
                    # boots to the menu, offline local/AI/tutorial play, ONLINE disabled
                    # offline, zero app-level console errors offline
```

Release gate: `npm run verify`, `npm run verify:preview`, `npm run verify:multiplayer`
and `npm run verify:pwa` must all pass, with zero console errors and zero server stderr
lines.

## Opponents

| Character | AI level | Style | Think pace | Emotes |
|---|---|---|---|---|
| Dona Cida | Simple | conservative — plays the minimum | 900ms | happy / thinking |
| Juninho | Simple | aggressive — dumps everything he can | 250ms | confident / excited / annoyed |
| Bia | Rearranger | puzzle-minded — rearranges the table to unlock plays | 600ms + 60ms/meld, capped +400ms | happy / excited / thinking |
| Seu Zé | Rearranger | patient — holds small plays early | 700ms | confident / happy / sleepy |

Think pace is presentation only — scaled to zero under reduced motion, capped, and never
extends the 400ms search deadline; search legality/determinism is unchanged.

AI is deterministic, budgeted (<100ms simple, <500ms rearranging), can never
confirm an illegal table, and logs an explanation for every decision
(`ai:thought` event).

## Project layout

`src/rules` is a pure, fully-tested rules engine (no Phaser). `src/mexe-mode`
holds the draft editor with undo/redo/reset. Phaser scenes only render state
and forward intents. See `ARCHITECTURE.md`.

## Playtesting

Running a playtest session? See **[docs/PLAYTEST_GUIDE.md](docs/PLAYTEST_GUIDE.md)** — what to
test, how to report a bug, and what the session play log does and does not contain.

The build keeps a session-only, in-memory play log (turn durations, rejected-play reason codes,
undo/reset counts, tutorial progress, disconnect/reconnect/desync counts). It is never written to
disk and never sent anywhere; exporting it is an explicit action. Player names and reconnect
tokens are stripped from any export. `?playlog=0` turns it off.

Balance knobs live in one place — `DEFAULT_RULES` in `src/rules/types.ts`, documented in the
**Configuration defaults** table of [docs/RULES.md](docs/RULES.md). The turn timer
(`turnTimerSeconds`) is a declared hook and is **off**; it is not implemented.

## Contributing & license

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). CI runs lint,
unit tests, build and the Playwright e2e suite on every push and PR; the
`main` branch auto-deploys the game and docs to GitHub Pages.

Licensed under the [MIT License](LICENSE).
