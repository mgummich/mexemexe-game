# Operations — MEXEMEXE!

How to build, run, observe and roll back a deployment. For the *why* behind the
architecture see `ARCHITECTURE.md` and `MULTIPLAYER.md`; for the
container/reverse-proxy walkthrough see `SELF_HOSTING.md`. This document covers running it
in production.

The game is two independently deployable pieces:

| Piece            | What it is                          | Required?                             |
| ---------------- | ----------------------------------- | ------------------------------------- |
| Static client    | `dist/`, served by any web server    | Yes                                   |
| WebSocket server | `server/`, Node + `ws`, port 8787    | Only for the ONLINE (ALFA) menu path  |

Offline and local hot-seat play never contact the server. If the server is down, never
deployed, or unreachable, everything except online rooms still works.

## Environment variables

### Server (runtime)

All are read once at startup by `server/config.ts`. Every numeric variable must parse to a
finite positive number; anything else fails startup with a message naming the variable,
rather than silently falling back to a default.

| Variable                   | Default     | Meaning                                                     |
| -------------------------- | ----------- | ----------------------------------------------------------- |
| `PORT`                     | `8787`      | TCP port to listen on.                                       |
| `HOST`                     | `0.0.0.0`   | Bind address. `127.0.0.1` to accept only proxied traffic.    |
| `MEXE_ENV` / `NODE_ENV`    | development | `production` enables production checks. `MEXE_ENV` wins.     |
| `LOG_LEVEL`                | `info`      | `debug` \| `info` \| `error`. `debug` only when set explicitly. |
| `MEXE_MAX_ROOMS`           | `500`       | Room capacity. Beyond it, room creation is refused cleanly.  |
| `MEXE_MAX_CONNECTIONS`     | `2000`      | Global WebSocket admission cap. Beyond it, new sockets are closed with `capacity`. |
| `MEXE_MAX_CONNECTIONS_PER_IP` | `20`     | Per-IP admission cap, same refusal.                          |
| `MEXE_DISCONNECT_GRACE_MS` | `30000`     | Seeds a new room's reconnect grace and bounds the room sweep. A lobby timer preset replaces the room's own value (Casual/Off 60s, Fast 30s). |
| `MEXE_IDLE_TIMEOUT_MS`     | `600000`    | Idle room lifetime before the sweep reaps it.                |
| `MEXE_METRICS_TOKEN`       | unset       | Bearer token for `/metrics`. Minimum 16 characters. Unset in production means `/metrics` returns 404. |
| `MEXE_TEST_SEED`           | unset       | Forces a deterministic deal. **Test-only.**                  |

`MEXE_TEST_SEED` exists solely for `verify:multiplayer`. Setting it with
`MEXE_ENV`/`NODE_ENV=production` is a **fatal** config error and the process refuses to
start — a seeded deck in production would deal every player identical hands.

### Client (build time)

| Variable      | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `VITE_WS_URL` | WebSocket URL baked into the bundle. Optional; see below.       |

Only `VITE_`-prefixed variables reach the bundle at all, and **none of them may hold a
secret** — everything in `src/config.ts` ends up readable in the shipped JavaScript. The
game has no API keys, no credentials and no third-party services, so there is nothing to
leak today; keep it that way. `npm run verify:preview` scans the built bundle for
credential-shaped strings as a standing check.

The client resolves its WebSocket URL in this order:

1. `?ws=` query parameter — used by the e2e suites, and handy for one-off testing.
2. `VITE_WS_URL`, baked in at build time.
3. Same-origin default: `ws://<hostname>:8787` over http, `wss://<host>/ws` over https.

The https default matches the reverse-proxy shape documented in `SELF_HOSTING.md` (Caddy
proxying `/ws` to the server, root to the static game), so an HTTPS deployment that follows
that guide works without setting `VITE_WS_URL` at all. Set it explicitly if your proxy puts
the WebSocket endpoint anywhere else. `VITE_WS_URL` is a **build** argument: changing it
means rebuilding the client.

## Local development

```bash
npm ci
npm run dev          # client on :5173
npm run server       # optional, WebSocket server on :8787
```

The dev client's default resolves to `ws://localhost:8787`, so online play works locally
with no configuration.

## Production build

```bash
npm run build        # tsc --noEmit && vite build  ->  dist/
```

Output is two hashed chunks — the game code and a separate Phaser vendor chunk, so a
game-only release does not invalidate the ~1.5 MB Phaser chunk in returning players'
caches. `base: './'` means `dist/` can be served from any path, including a subdirectory.
No source maps are emitted in production; that is deliberate.

Serve `dist/` with anything: nginx, Caddy, S3, GitHub Pages, `npx serve dist`.
`npm run preview` serves the built output locally on `:4173` for a last look before
shipping.

## Running the server in production

```bash
MEXE_ENV=production PORT=8787 npm run server
```

Or via Docker, which is the supported path (`docker compose up -d --build`, see
`SELF_HOSTING.md`). Notes that matter in production:

- **State is in memory.** No database, no volumes. Restarting the server ends every match
  in progress. There is no way to preserve rooms across a restart, by design.
- **Deploy during quiet hours**, or accept that in-flight matches end.
- **Shutdown is graceful.** On `SIGTERM`/`SIGINT` the server stops accepting connections,
  sends every connected client a `server_shutdown` error so they see a real message instead
  of a silent drop, closes sockets and the HTTP listener, and exits 0. A shutdown that
  hangs past 5 seconds hard-exits rather than blocking the rollout. A second signal during
  shutdown is ignored.
- **Put it behind TLS.** The server speaks plain ws; terminate TLS at the proxy.

## Health check

```bash
curl http://localhost:8787/health
{"ok":true,"uptimeSec":142,"rooms":3,"connections":7,"protocol":4}
```

Any other path returns 404. The response deliberately contains **no room codes and no
player names** — room codes are shared secrets that grant entry to a room.

Read it as: `ok` means the process is listening; `uptimeSec` resetting repeatedly means the
process is crash-looping; `rooms`/`connections` are the live load; `protocol` must match
the client build's protocol version or clients will be rejected on connect.

The Docker healthcheck already polls this every 30s (`docker-compose.yml`).

## Metrics

```bash
curl http://localhost:8787/metrics
```

Prometheus text format, aggregate counters and gauges only — connections, rooms, capacity
ratios, uptime, memory, and lifecycle/error counters. No per-room, per-player or per-request
series exists, and the only label in the whole exposition is a fixed-set `reason` on the
rejection counter.

In production the endpoint is closed unless `MEXE_METRICS_TOKEN` is set, and then requires
`Authorization: Bearer <token>`; an unauthorized request gets a 404. Development is open. The
full metric list, the label policy and the optional
`docker compose --profile monitoring up -d` Prometheus/Grafana stack are in
[OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md).

## Logs and privacy

The server logs one JSON object per line: `{ts, level, event, ...fields}`. **stdout carries
`debug` and `info`; stderr carries only genuine errors** — so a non-empty stderr is always
worth looking at, and `verify:multiplayer` enforces exactly that by failing if the server
writes anything to stderr on a clean run.

Privacy is enforced inside the logger (`server/log.ts`), not left to call sites:

- Any string field whose key looks sensitive — it contains `name`, `token`, `ip`,
  `address`, `remote`, `agent`, `secret`, `password`, `auth`, `code`, `email`, `session`
  or `fingerprint`, case-insensitively — is replaced with `[redacted]`. So is any field
  named exactly `message`, `error`, `stack`, `payload` or similar free-form text (see
  `docs/OBSERVABILITY_PRIVACY.md`). Numbers pass through, which is why room codes are logged as
  `codeLength`. Surviving strings are length-capped so an unexpected payload cannot be
  dumped into a log line.
- Any array or object field is collapsed to its length/key-count. Hands, melds and card
  lists can therefore never be serialized into a log line, whatever a call site passes.
- Room codes are logged only as `codeLength`, never as the code itself.
- Room create/close are `debug`-level, so they are off by default in production.

- Caught exceptions are logged as `errorFields(err, config.mode)` — an `errorType` naming the
  error class (validated as a source identifier), and in production never the message. An exception message is player- and attacker-influenced free text, so it
  is not persisted; reproduce off production with `LOG_LEVEL=debug` to see the stack.

What the server does **not** do: no persistent logs, no log shipping, no analytics, no
telemetry, no cookies, no personal-data storage. Nothing is written to disk. It *does* hold
client IP addresses in memory while their sockets are open, because the per-IP connection cap
needs them — never logged, never exported, never stored. Container logs are bounded by
`docker-compose.yml` (10 MB × 3 per service) and nginx access logging is off entirely,
with error logging kept at `crit` so a 404 cannot persist a client IP (`nginx.conf`). Full detail: [OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md).

Client-side, the in-session play log (`src/core/playlog.ts`) is memory-only, capped at 2000
entries, timestamped with `performance.now()` rather than a wall clock, and strips
name/token keys from anything it exports. It never leaves the browser. Player saves and
settings are `localStorage` only; clearing site data resets them.

Turn `LOG_LEVEL=debug` on to diagnose a live problem, and turn it back off — debug adds
per-room lifecycle lines.

### Crash policy

Every inbound message is already wrapped in its own try/catch, so an `uncaughtException`
means the process state is unknown rather than that a client sent something hostile. The
server logs `uncaught_exception` to stderr and then **exits with status 1** — serving rooms
out of a half-applied state is worse than dropping them, and both `docker-compose.yml`
(`restart: unless-stopped`) and any normal supervisor restart it immediately. Clients get a
socket close and the usual single reconnect attempt; in-memory rooms are lost, as they are on
any restart. An `unhandledRejection` is logged but does not exit: no room-mutating path
awaits anything, so a stray rejection cannot leave room state half-applied.

A single corrupt room is handled one level down and never reaches this path: `advanceStalledTurns`
catches a throw per room, drops that room, and tells its sockets (`room_closed`), leaving every
other room running.

## Troubleshooting

**ONLINE menu never connects, page served over HTTPS.** The classic one. A page on
`https://` cannot open a plain `ws://` socket; the browser blocks it silently. Check that
your proxy exposes the WebSocket endpoint at `/ws` (the built-in default), or rebuild with
a matching `VITE_WS_URL=wss://your.host/path`. Confirm quickly by loading the game with
`?ws=wss://your.host/ws` — if that works, the build's baked-in URL is the problem.

**Connects locally, not from another machine.** Port 8787 is not reachable from the
browser's network. Either open it or proxy it; the client talks to the server directly, not
through the web server.

**`invalid PORT: "..." must be a finite positive number` on startup.** Exactly what it
says — the process refuses to start on a malformed value rather than booting on a default
you did not intend. Same for the other numeric variables.

**`MEXE_TEST_SEED must not be set when MEXE_ENV/NODE_ENV=production`.** A test variable
leaked into the production environment. Unset it; do not switch off production mode.

**`/metrics` returns 404 in production.** Expected unless `MEXE_METRICS_TOKEN` is set — and
then the request needs `Authorization: Bearer <token>`. A wrong token gets the same 404, on
purpose.

**Players dropped mid-match, server still up.** Check whether the process restarted
(`uptimeSec` low). Rooms are in-memory, so a restart ends matches. If uptime is high, look
for `room_closed` at debug level. A seat gone past the room's reconnect grace has its turn
played for it (draw and pass), and losing `missedTurnLimit` turns in a row closes the room
for the survivors rather than stranding them on a board that only advances by draw.

**Room creation refused.** `rooms` in `/health` is at `MEXE_MAX_ROOMS`. Raise the limit or
add capacity.

**Something desyncs.** The server is authoritative and the client can never apply an
unconfirmed move. A client that believes it is out of step sends `resync` and the server
re-sends its view; nothing client-side is ever trusted. If it persists, the protocol
version in `/health` and in the client build have most likely diverged.

## Releasing a new version / cache busting

The client is a PWA with a service worker (`public/sw.js`) that caches the app shell and
runtime assets. Bump the `VERSION` const in `public/sw.js` on every release — the
`activate` handler deletes any cache that isn't the current version, so a stale build
never lingers. Navigations are network-first, so a new `index.html` (and its new hashed
asset URLs) is always picked up on next load without a manual cache purge. Players see a
non-intrusive update banner and apply it themselves after their current match; a new
worker never takes over mid-match.

Known limitation: applying an update is registration-wide, not per-tab. If a player has
the game open in several tabs on the same origin and applies the update in one of them,
the `controllerchange` reload fires in all of them — including a tab that is mid-match.
Single-tab play, which is how the game is played on phones and how every verification run
exercises it, is unaffected.

## Rollback

The client is a static directory and the server is stateless. Rollback is therefore
just deploying the previous artefacts:

1. **Client** — re-deploy the previous `dist/` (or check out the previous tag and rebuild).
   Hashed filenames mean old and new assets can coexist; players get the new `index.html`
   on their next load.
2. **Server** — redeploy the previous image/commit. `docker compose up -d --build` after a
   `git checkout <previous-tag>`.
3. **Both together if the protocol version changed.** `PROTOCOL_VERSION` in
   `src/net/protocol.ts` is the coupling point: a client and server on different protocol
   versions refuse each other. Roll both, or neither.

There is no database and no migration to reverse. Matches in progress end on either
rollback; there is nothing else to restore.

## Verification commands

| Command                     | What it gates                                                        |
| --------------------------- | -------------------------------------------------------------------- |
| `npm run test`              | Unit tests (rules, AI, config, logging, server rooms/connections).    |
| `npm run lint`              | `eslint` + `tsc --noEmit`.                                            |
| `npm run build`             | Type-check and production build.                                      |
| `npm run preview`           | Serves the built client on `:4173`.                                   |
| `npm run verify`            | Tests, lint, screenshot e2e, plus the console-error/FPS gate.         |
| `npm run verify:preview`    | Built-client smoke: assets resolve, no secrets in the bundle.         |
| `npm run verify:multiplayer`| Online 2P/3P/4P, reconnect/resync, illegal-move rejection, hand privacy. |
| `npm run verify:cross`      | Cross-viewport layout checks.                                         |
| `npm run test:server`       | Server unit tests only (fast inner loop).                             |

Release gate: `verify`, `verify:preview` and `verify:multiplayer` must all pass, with zero
console errors and zero server stderr lines.

## Known limits

- **Rooms are in-memory and single-process.** No horizontal scaling: two server instances
  do not share rooms, so any load balancer in front of them must pin a room's players to
  one instance, and a restart ends every match.
- **Online alpha scope.** Private rooms by code only — no matchmaking, no accounts, no
  ranked play, no chat, no rematch online.
- **Rate limiting is admission caps plus per-connection guards, not per-IP throttling.**
  Global and per-IP connection caps refuse new sockets at the door, the flood guard closes
  a looping client (close code `1008`), and ten failed room-code guesses close the guessing
  connection (also `1008`) — but a distributed abuser that stays under the per-IP admission
  cap is not throttled further.
- **`MEXE_MAX_CONNECTIONS_PER_IP` counts `req.socket.remoteAddress`, so it collapses behind
  a reverse proxy.** Every client then shares the proxy's address and the per-IP cap becomes
  a second global cap. The server deliberately does **not** trust `X-Forwarded-For` — that
  header is client-settable, and trusting it by default would turn the cap into a no-op that
  any abuser can spoof. Either terminate the WebSocket without a proxy hop, or raise
  `MEXE_MAX_CONNECTIONS_PER_IP` to at least the global cap so it stops being the binding
  limit and rely on `MEXE_MAX_CONNECTIONS` plus the per-connection guards.
- **Room codes are 5 characters from a 28-symbol alphabet** (~17.2M combinations), throttled
  to ten failed lookups per connection. Practical to brute-force only with a large, throttle-
  resetting connection farm; a per-IP failed-join counter is the next step if that ever shows
  up in practice.
- **No online results summary.** The win screen's per-player stats are local-only; the
  client never observes the other seats' turn history online, so the line is hidden rather
  than faked. Fixing it needs a protocol change.
- **`turnTimerSeconds` (the rules config) is still a declared, unimplemented, off-by-default
  hook** — local play is never on a clock. The online turn timer is a separate, server-owned
  room setting (`MEXE_DISCONNECT_GRACE_MS` seeds a new room's reconnect grace; the host picks
  the preset in the lobby). See `docs/MULTIPLAYER.md` §7b.
- **No persistence of any kind** — no accounts, no cloud saves, no server-side history.
