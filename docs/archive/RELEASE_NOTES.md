# MEXEMEXE! 1.4.0 — Release notes (production hardening)

## Phase 10 update

This build makes MEXEMEXE! deployable. **Nothing about the game changed** — same
rules, same wire protocol (v3), same content as 1.3.0. What changed is
everything around it: how it is configured, how it starts and stops, what it
writes to a log, and how a release is proven before it ships.

**HTTPS deployments now work without configuration.** The one real bug this
phase fixed: a page served over `https://` is forbidden by the browser from
opening a plain `ws://` connection, and the client's fallback URL was exactly
that. Any TLS deployment that forgot to set `VITE_WS_URL` at build time got an
ONLINE menu that silently never connected — documented as "the most common
first-deployment surprise", which is really an admission that the default was
wrong. The fallback now follows the page's protocol: `wss://<host>/ws` over
https, matching the reverse-proxy layout in `docs/SELF_HOSTING.md`, so following that
guide is enough. `?ws=` and `VITE_WS_URL` still override, in that order.

**The server can no longer be misconfigured quietly.** All of its settings —
port, bind address, mode, log level, room capacity, disconnect grace, idle
timeout — are read once at startup and validated. A malformed value fails
startup naming the variable, instead of falling back to a default nobody chose.
`MEXE_TEST_SEED` is the sharp one: it forces a deterministic deal for the test
suite, and setting it in production mode is now a fatal error rather than a
silently identical deal for every match.

**It shuts down like a service.** On `SIGTERM`/`SIGINT` — a `docker compose
down`, a rollout, a Ctrl-C — the server tells every connected client the server
is shutting down before closing, so players see a real message instead of an
unexplained drop. Rooms live in memory and still end on restart; that is by
design and now documented, but the players get told.

**Logs are structured and private by construction.** One JSON line per event.
Player names, session tokens, addresses and user-agents are redacted, card and
hand data can never be serialized (any array or object collapses to its size),
and room codes — which are shared secrets that grant entry to a room — are
logged only as a length. The redaction lives in the logger, so it holds no
matter what a future call site passes. Still no telemetry, no analytics, no
persistence, nothing written to disk, and the in-browser play log remains
memory-only and never leaves the machine.

**`/health` says something useful**: uptime, live room count, connection count
and protocol version, and deliberately no room codes or player names. It used to
answer `{"ok":true}`, which told an operator only that a process was listening —
a crash-looping server looked identical to a healthy one.

**Returning players re-download less.** Phaser is now its own cached chunk, so a
game-code release stops invalidating the ~1.5 MB engine in the browser cache —
121 kB of game code instead of 1.6 MB, for anyone who has played before.

**The build itself is now tested.** A new gate (`npm run verify:preview`) serves
the production build and fails if any asset fails to resolve, a boot-time asset
is missing, or anything credential-shaped appears in the emitted JavaScript.
Nothing previously exercised `dist/` at all, so a production-only regression
could have shipped through a green suite.

**Operators get a manual.** `docs/OPERATIONS.md` covers the environment
reference, building and running, reading the health check, the log format and
its privacy guarantees, troubleshooting, rollback and the known limits.

### Verification

`npm run verify` (22 captures, 53–60 fps, zero console errors),
`npm run verify:preview`, and `npm run verify:multiplayer` (7/7, empty server
stderr) all pass, alongside 297 unit tests and a clean lint and build.

### Still true, still not fixed

Rooms are in-memory and single-process, so there is no horizontal scaling and a
restart ends matches in progress. The flood guard is per connection, not per IP.
There is no online rematch, no online results summary, no matchmaking, no
accounts, and no chat.

---

# MEXEMEXE! 1.3.0 — Release notes (content-rich beta)

## Phase 9 beta update

This build turns the playtest demo into a **content-rich beta**. Rules and wire
protocol are unchanged; what's new is choice and character.

**Pick your table.** Settings → **COSMETICS** now lets you choose a table
theme (4: boteco, kitchen, quintal, feira), a card back (5), and an avatar
(9: player, cida, juninho, bia, ze, rosa, tuca, nina, ivo), with a live
preview. The choice saves instantly and is entirely
client-side — it never touches the network protocol, game state, or the
rules, and an old save without a cosmetics choice just gets the defaults.

**The table sounds different depending on what you're doing.** Music now
follows context: calmer tracks while you're heads-down rearranging the shared
table (Mexe Mode), fuller songs the rest of the time. Rapid-fire sound
effects (fast drag-and-drop) no longer stack into a spike.

**The AI opponents finally feel different from each other**, not just play
differently. Dona Cida thinks slow and calm, Juninho snaps back fast and
confident, Bia paces with how much she's rearranging, Seu Zé holds back
looking sleepy until he plays. Watching a match, you can now tell who's who
without checking the name.

**The win screen tells you how you won** — a rematch summary (turns, cards
played, draws per player) plus a winning-move line and an avatar reaction, in
local games. Online games don't get this yet: the client only ever sees its
own hand and the current table state, never the other seats' full turn
history, so there is no data to summarize. Fixing that needs a protocol
change and is out of scope for this beta — the win screen simply omits the
stats line online instead of showing zeros.

**4 new avatars shipped**: rosa, tuca, nina, and ivo join the avatar picker,
style-matched to the existing PixelLab set (the PixelLab account ran out of
credits mid-phase and was renewed shortly after; the new table/card
back/emote art was generated procedurally in the meantime — deterministic, no
dependencies, `npm run gen:cosmetics` — which works well for geometric
patterns but was deliberately not attempted for character portraits).

**We still have zero real playtest sessions logged.** Every friction fix in
this build came from reading the code, not from tester feedback — because
none exists yet. If you're reading this and about to play: please run
`docs/PLAYTEST_GUIDE.md` end to end and send back the session log. That's the
single most useful thing anyone can do for the next phase.

See `docs/PLAYTEST_GUIDE.md` for how to run a session, `docs/ASSETS.md`
for the full asset/license table (all art original, no third-party or
copyrighted sources), and `docs/AUDIO_DIRECTION.md` for the music-context design.

---

# MEXEMEXE! 1.2.0 — Release notes (playtest demo)

## Phase 8 playtest update

This build is the **public playtest demo**. Nothing about the rules or the wire
protocol changed; what changed is everything a first-time player runs into.

The tutorial now teaches the ruleset the game actually enforces — it explains
that a trinca is exactly three or four cards with no repeated suit, then hands
you a card that breaks that rule so you meet the rejection with a coach next to
you, and it finally introduces the jokers that have been in the deck since the
rules adaptation. Online errors are written for players instead of developers:
where a tester used to read `cannot join room: room_full`, they now read "That
room is full." A server that was never reachable says so, rather than looking
like a dropped connection. Lobby buttons no longer fire twice when double-
clicked.

Underneath, the build keeps a session-only play log of turn durations, rejected-
play reasons, undo/reset counts and tutorial progress, so "it felt confusing"
becomes something countable. It stays in memory, it strips names and tokens, and
it goes nowhere unless a tester exports it and attaches it themselves —
`?playlog=0` turns it off entirely. See `docs/PLAYTEST_GUIDE.md`.

## Phase 7 beta update

Online play is now a **beta** on wire protocol **v3**. What changed for
players: you type the room code on a proper in-canvas screen instead of a
browser dialog, the lobby tells you why START is greyed out, a dropped
connection no longer freezes everyone else's match (after 30s the server draws
and ends the missing player's turn for them), and a client that ever falls out
of step with the server now notices and pulls a fresh authoritative state
instead of drawing a stale board.

Under the hood: server-side socket liveness probes, a 16 KiB inbound frame
cap, per-revision state digests with client-side mismatch detection, a
client-initiated `resync` message, and `reqId` echoed on errors. Still no
accounts, matchmaking, chat, or online rematch.

## Phase 6 alpha update

Private rooms now support **2–4 players**. Share room code, wait for every
occupied seat to ready, then seat 0 presses START. Seats, IDs and reconnect
tokens remain stable; server still owns deal, turns, validation and winner.
The alpha still has no matchmaking/accounts/chat/rematch and falls safely back
to local menu after its single bounded reconnect retry fails.

*Arruma. Desarruma. Bate.* This release adds an **ALPHA** online multiplayer
mode on top of the 1.0.0 launch build. Everything in the 1.0.0 notes below
still applies unchanged to local play.

## What's new: online alpha

- **2–4-player private rooms** over WebSocket: create a room, share the
  5-character code, join, ready, then host-start.
- **Authoritative server**: the server (`npm run server`, plain Node + `ws`,
  port 8787 by default, `GET /health`) holds the only real game state and
  validates every move against the same rules engine (`canConfirmTurn`) local
  play uses — client and server can never disagree about what's legal.
- **Deterministic, hidden-information-safe sync**: each client sees its own
  hand in full and the opponent as a card count only; a revision number
  rejects stale or duplicate submissions.
- **Mexe Mode online**: FEITO/COMPRAR submit-and-wait; the opponent's turn is
  read-only; rejected proposals show the same localized reasons as offline
  (e.g. "Carta inválida").
- **Draw/end/win/stalemate** are server-decided and synced to both clients.
- **Disconnect notice and reconnect**: the opponent is told when you drop; a
  single bounded reconnect attempt resyncs you to the server's current state.

### Known alpha limitations

- Join code entry uses a native `window.prompt()` dialog, not a styled
  in-canvas input.
- Opponent avatar is the generic player icon (no accounts to show one).
- No accounts, matchmaking, ranked play, or chat.
- No online rematch — the win screen online only offers MENU.
- No socket liveness probe — a half-open connection can hold a seat until the
  disconnect grace timer notices.
- Reconnect is a single bounded retry, not a persistent retry loop.

### Deployment note

A page served over HTTPS must point the client at a `wss://` server
(`VITE_WS_URL` build-time env var, or `?ws=` at runtime for testing) — a
plain `ws://` connection is blocked from an HTTPS page. See the README
"Online Alpha" section for the full setup.

---

# MEXEMEXE! 1.0.0 — Release notes

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
- All art generated with PixelLab (see `docs/ASSETS.md` for the
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
