# Phase 10 Audit — Production Readiness

Scope: make MEXEMEXE! deployable. Environment/config hardening, build and preview
stability, server reliability, privacy-safe logging, asset/perf, release verification,
operations documentation. Out of scope: storefront prep (itch.io/Steam), matchmaking,
accounts, payments, chat, persistent telemetry, cosmetics economy, a mobile port.

## 1. Phase 9 status at entry

Green across the board, and the phase closed clean:

- 281/281 unit tests (18 files), lint clean (`eslint` + `tsc --noEmit`), build clean.
- 46/46 local e2e (`npm run verify`) + 7/7 multiplayer e2e (`npm run verify:multiplayer`).
- Zero console errors, zero server errors in the last gate.
- Post-close: the PixelLab avatar block resolved; the catalog is 9 avatars.

One item carried in from Phase 9 and **not** a production blocker: `WinScene`'s rematch
summary is local-only, because online play never observes per-turn state client-side.
The screen hides the stats line online rather than showing zeros. Fixing it needs a
protocol change; it stays deferred.

The codebase entered Phase 10 in unusually good shape for a hardening pass: no
`TODO`/`FIXME`/`HACK`/`XXX` anywhere in `src/`, `server/`, `scripts/` or `tests/`, and no
API keys, secrets or credentials in any bundled source. The only token-shaped strings are
the game's own reconnect session tokens, which the play log already strips.

## 2. Production blockers

**B1 — HTTPS deployments cannot connect (real, shipping bug).** The client's fallback
WebSocket URL is `ws://<hostname>:8787` (`src/net/client.ts:23`). A page served over
`https://` is forbidden by the browser from opening a plain `ws://` socket, so every TLS
deployment that forgets to set `VITE_WS_URL` at build time gets a silently dead ONLINE
menu. `SELF_HOSTING.md` documents this as "the most common first-deployment surprise" —
which is an admission that the default is wrong, not a mitigation. The fallback must be
protocol-aware.

**B2 — No graceful shutdown.** `server/index.ts` installs no `SIGTERM`/`SIGINT` handler.
Under Docker, `docker compose down` or any orchestrator rollout kills the process
outright: in-flight sockets are severed with no `room_closed`-style notice, and clients
see an unexplained drop instead of a clean message. Rooms are in-memory and lost either
way — that is by design — but the players deserve to be told.

**B3 — No production config validation.** `MEXE_TEST_SEED` forces a deterministic deal.
It exists only for `verify:multiplayer`, and `SELF_HOSTING.md` warns "never set it in a
real deployment" — but nothing enforces that. A stray environment variable ships a game
where every match deals identical hands, and nothing in the logs would say so.

## 3. Config / env gaps

Total environment surface today is three variables: `PORT` and `MEXE_TEST_SEED` on the
server, `VITE_WS_URL` in the client bundle. There is no configuration module on either
side — each variable is read inline at its point of use.

- No `HOST` binding control; the server takes whatever `listen(PORT)` defaults to.
- No environment mode at all (`NODE_ENV` is unread), so nothing can behave differently in
  production — including the validation B3 needs.
- Room tuning is hardcoded in `server/rooms.ts`: `DEFAULT_MAX_ROOMS` 500,
  `DEFAULT_DISCONNECT_GRACE_MS` 30 s, `DEFAULT_IDLE_TIMEOUT_MS` 10 min. The
  `RoomManagerDeps` seam to inject them exists and is used by tests, but production wires
  nothing into it, so an operator cannot tune capacity without editing source.
- No validation anywhere: a malformed `PORT=abc` becomes `NaN`, falls through the `||`
  default, and boots on 8787 as if nothing happened.

## 4. Hardcoded dev URLs

Only one in shipped code — the B1 fallback. The remaining matches are all in
`e2e-multiplayer/multiplayer.spec.ts` (`ws://localhost:${WS_PORT}`, the `/health` probe,
and a deliberately dead `ws://localhost:18799` used for the server-unreachable capture).
Those are correct where they are. No stray addresses in `src/`, `server/` or `scripts/`.

## 5. Server reliability gaps

Most of this surface is already covered, and Phases 5 and 7 did the hard part. Present
and working: a `/health` endpoint, a 15 s heartbeat that terminates half-open sockets, a
30 s room sweep that reaps idle and abandoned rooms, a 5 s stalled-turn tick, a
per-connection flood guard, a 16 KiB `maxPayload` cap, strict message parsing that
rejects malformed frames without throwing, a seat-eviction rule that guarantees exactly
one live connection per seat, and `uncaughtException`/`unhandledRejection` guards.

What is missing:

- Graceful shutdown (B2).
- `/health` answers `{"ok":true}` and nothing else. It proves the process is listening; it
  cannot tell an operator whether the process is *healthy* — no uptime, no room count, no
  connection count, no protocol version. A restart loop and a healthy server look
  identical from outside.
- Startup logs one line and never states the configuration it actually resolved, so a
  misconfigured deployment is invisible in the logs.

## 6. Logging / privacy risks

No privacy *leak* exists today — this is a robustness gap, not a breach. The client's play
log is in-memory only, capped at 2000 entries, timestamped with `performance.now()` rather
than a wall clock, and already strips `name`/`playerName`/`token`/`sessionToken` from
every exported entry. Nothing is persisted anywhere, and there is no telemetry.

The server has six `console.*` call sites (`server/index.ts`) and the client has three
(two clipboard fallbacks, one desync warning). The risk is structural:

- Logging is unstructured free text, so nothing is machine-readable in production and
  nothing enforces what may be logged. Every call site is individually responsible for not
  passing a player name, a room code or a hand — which holds today only because someone
  remembered each time.
- There is no log level, so a production deployment cannot turn verbosity down, and a
  debugging operator cannot turn it up without a code change.
- Room codes are effectively shared secrets — anyone holding one can join that room — and
  nothing currently marks them as unloggable.
- `console.error` on the send path fires per failed socket write, which a flapping network
  can turn into an unbounded error stream.

Constraint worth recording: `scripts/check-verify-multiplayer.mjs` fails the gate if the
server writes *any* non-empty line to stderr. Informational logging must therefore stay on
stdout, with stderr reserved for genuine errors.

## 7. Asset / perf issues

Total `dist/` is 16 MB, of which 14 MB is audio and 1.5 MB is the JS bundle
(376 kB gzipped).

- The five music tracks are 1.7–2.7 MB each, 11 MB in total. They are **not** in the
  Phaser preload — `src/audio/music.ts` streams them through a plain `HTMLAudioElement`
  on demand, so they never block first paint. This is already the right design and needs
  no change.
- Everything else is small: cards 40 kB, characters 36 kB, tables 88 kB, UI 132 kB,
  effects 4 kB, `ambience.wav` 302 kB.
- The build emits a **single** 1.6 MB chunk containing both Phaser (~1.2 MB, changes
  only on a dependency bump) and the game code (changes every release). Any one-line game
  fix therefore invalidates the whole download in every returning player's cache. This is
  a cache-efficiency defect, not a size defect, and splitting the vendor chunk fixes it.
- Repo-root `music/` holds 11 MB of source masters. They are not shipped (the `Dockerfile`
  copies only `public/`, `src/`, `server/` and config), so this costs clone time only.
- No source maps are emitted in production. That is the right default; it just is not
  written down anywhere as a decision.

## 8. Verify gaps

The two gates are strong. `check-verify.mjs` fails on any console/page error, any missing
screenshot, a `scene=game` FPS below 30, or any missing expected capture from a named
list. `check-verify-multiplayer.mjs` additionally fails on non-empty server stderr, an
accepted illegal proposal, a failed reconnect-revision match, a resync/state-hash
disagreement, missing 3P/4P seat evidence, or a hand-privacy violation.

What neither gate covers:

- Nothing exercises the **built** client. `verify` builds and then serves through
  Playwright's dev flow; `npm run preview` is never smoke-tested, so a
  production-only failure (base-path resolution, a dev-only import) would ship green.
- No `/health` assertion beyond the e2e spec's own readiness probe.
- Nothing asserts the absence of secrets in the emitted bundle.
- No graceful-shutdown or config-validation coverage — neither exists yet to cover.

## 9. Ops docs gaps

`README.md` (302 lines), `SELF_HOSTING.md`, `ARCHITECTURE.md`, `CHANGELOG.md` (270) and
`docs/RELEASE_NOTES.md` (203) are all current and accurate. `SELF_HOSTING.md` in
particular already covers Docker, reverse-proxy TLS and the `VITE_WS_URL` build argument.

There is no `docs/OPERATIONS.md`: nothing documents the environment-variable reference,
what the health endpoint means, what the server logs and what it deliberately does not,
how to roll back, or how to triage a failure in production. `docs/STATUS.json` also still
describes the project in Phase 9 terms.

## 10. Top 10 tasks

1. Protocol-aware WebSocket fallback so HTTPS deployments work by default (B1).
2. Centralized, validated server config module — port, host, mode, log level, room tuning
   — with a hard failure when `MEXE_TEST_SEED` is set in production (B3).
3. Centralized client config module, with the `?ws=` override preserved and an explicit
   note that no `VITE_`-prefixed variable may ever hold a secret.
4. Graceful shutdown on `SIGTERM`/`SIGINT`: notify sockets, close cleanly, bounded by a
   hard-exit timeout (B2).
5. Structured, level-gated, privacy-enforcing logger; redaction lives in the logger, not
   at the call sites. Informational output to stdout only.
6. Expand `/health` to report uptime, room count, connection count and protocol version —
   never room codes or player names.
7. Split the Phaser vendor chunk so game-code releases stop invalidating it in caches.
8. Add a built-client smoke check to release verification, covering `npm run preview`,
   asset loading, and the absence of secrets in the bundle.
9. Write `docs/OPERATIONS.md`: env reference, run/build/deploy, health, logging and
   privacy, troubleshooting, rollback, verify commands, known limits.
10. Update `README`, `CHANGELOG`, `RELEASE_NOTES` and `docs/STATUS.json` to the Phase 10
    state, including recorded performance metrics.

## Risk notes

The hardening is deliberately narrow. Local and offline play must not regress at all —
they never contact the server — and the online path must stay stable, so every change
above is additive or a defaults change, not a rework of a working system. The gameplay
core (rules, RNG determinism, server authority, the "no illegal move may sync" invariant)
is out of scope and untouched.
