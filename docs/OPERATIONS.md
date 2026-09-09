# Operations — MEXEMEXE!

How to build, run, observe and roll back a deployment. For the *why* behind the
architecture see `ARCHITECTURE.md` and `docs/MULTIPLAYER_ARCHITECTURE.md`; for the
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
| `MEXE_DISCONNECT_GRACE_MS` | `30000`     | How long a disconnected seat is held before the room closes. |
| `MEXE_IDLE_TIMEOUT_MS`     | `600000`    | Idle room lifetime before the sweep reaps it.                |
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
{"ok":true,"uptimeSec":142,"rooms":3,"connections":7,"protocol":3}
```

Any other path returns 404. The response deliberately contains **no room codes and no
player names** — room codes are shared secrets that grant entry to a room.

Read it as: `ok` means the process is listening; `uptimeSec` resetting repeatedly means the
process is crash-looping; `rooms`/`connections` are the live load; `protocol` must match
the client build's protocol version or clients will be rejected on connect.

The Docker healthcheck already polls this every 30s (`docker-compose.yml`).

## Logs and privacy

The server logs one JSON object per line: `{ts, level, event, ...fields}`. **stdout carries
`debug` and `info`; stderr carries only genuine errors** — so a non-empty stderr is always
worth looking at, and `verify:multiplayer` enforces exactly that by failing if the server
writes anything to stderr on a clean run.

Privacy is enforced inside the logger (`server/log.ts`), not left to call sites:

- Any string field whose key looks sensitive — it contains `name`, `token`, `ip`,
  `useragent`, `secret`, `password`, `auth` or `code`, case-insensitively — is replaced
  with `[redacted]`. Numbers pass through, which is why room codes are logged as
  `codeLength`. Surviving strings are length-capped so an unexpected payload cannot be
  dumped into a log line.
- Any array or object field is collapsed to its length/key-count. Hands, melds and card
  lists can therefore never be serialized into a log line, whatever a call site passes.
- Room codes are logged only as `codeLength`, never as the code itself.
- Room create/close are `debug`-level, so they are off by default in production.

What the server does **not** do: no persistent logs, no log shipping, no analytics, no
telemetry, no cookies, no personal-data storage of any kind. Nothing is written to disk.

Client-side, the in-session play log (`src/core/playlog.ts`) is memory-only, capped at 2000
entries, timestamped with `performance.now()` rather than a wall clock, and strips
name/token keys from anything it exports. It never leaves the browser. Player saves and
settings are `localStorage` only; clearing site data resets them.

Turn `LOG_LEVEL=debug` on to diagnose a live problem, and turn it back off — debug adds
per-room lifecycle lines.

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

**Players dropped mid-match, server still up.** Check whether the process restarted
(`uptimeSec` low). Rooms are in-memory, so a restart ends matches. If uptime is high, look
for `room_closed` at debug level — a disconnected seat past `MEXE_DISCONNECT_GRACE_MS`
closes the room for the survivor rather than stranding them on a dead board.

**Room creation refused.** `rooms` in `/health` is at `MEXE_MAX_ROOMS`. Raise the limit or
add capacity.

**Something desyncs.** The server is authoritative and the client can never apply an
unconfirmed move. A client that believes it is out of step sends `resync` and the server
re-sends its view; nothing client-side is ever trusted. If it persists, the protocol
version in `/health` and in the client build have most likely diverged.

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
- **The flood guard is per connection, not per IP.** It stops a looping client, not a
  distributed abuser. There is no IP-level rate limiting.
- **No online results summary.** The win screen's per-player stats are local-only; the
  client never observes the other seats' turn history online, so the line is hidden rather
  than faked. Fixing it needs a protocol change.
- **`turnTimerSeconds` is a declared, unimplemented, off-by-default hook.**
- **No persistence of any kind** — no accounts, no cloud saves, no server-side history.
