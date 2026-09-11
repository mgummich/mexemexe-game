# Observability and privacy — MEXEMEXE!

How the deployment is monitored, and what it deliberately refuses to collect. The rule behind
every decision here is: **monitor the game and the service, not the player.** Data that does
not exist cannot leak, cannot be subpoenaed and cannot be breached.

For environment variables, deployment and troubleshooting see [OPERATIONS.md](OPERATIONS.md);
for the container walkthrough see [SELF_HOSTING.md](SELF_HOSTING.md).

## What is collected

| Surface | What it holds | Where it lives |
| ------- | ------------- | -------------- |
| Server logs | One JSON line per event: `{ts, level, event, ...bounded fields}` | Container stdout/stderr only |
| `/metrics` | Aggregate process counters and gauges, no labels beyond a two-value `reason` | In memory, scraped |
| `/health` | `ok`, uptime, room count, connection count, protocol version | In memory |
| nginx | Errors only | Container stderr |
| Client play log | In-session gameplay counters | The player's own tab, in memory |

## What is never collected

Not redacted late — **never written in the first place**, or stripped centrally before any sink
sees it:

player names · email addresses · player or account IDs · room codes · reconnect tokens · auth
tokens · cookies · passwords or secrets · IP addresses · user-agent strings · location ·
device fingerprints · request or response bodies · raw WebSocket payloads · player-entered free
text · hidden game state · opponent hands · shuffle seeds · exception messages.

And no third-party tooling of any kind: no Google Analytics, no Meta pixel, no Hotjar, no
FullStory, no session replay, no fingerprinting, no behavioural analytics, no cross-session
identifier, no tracking pixel, no automatic gameplay-event upload. `tests/no-telemetry.test.ts`
fails the build if any of that appears in `src/`, `public/` or `index.html`.

## IP addresses — the honest version

The server **does** process network addresses, briefly and in memory. It has to: the per-IP
connection cap (`MEXE_MAX_CONNECTIONS_PER_IP`) cannot work without counting connections per
address. The address is held as a key in a `Map` for exactly as long as that socket is open,
decremented on close, and deleted when the count reaches zero. It is never logged, never
exported in a metric, never written to disk and never leaves the process.

This is why the wording throughout is "not persisted" rather than "no personal data is
processed" — the latter would not be true.

## Server logs

Structured, level-gated, one JSON object per line (`server/log.ts`). stdout carries `debug` and
`info`; stderr carries only genuine errors, so a non-empty stderr is always worth reading.
Nothing is written to disk by the application itself.

Privacy is enforced **inside the logger**, not at call sites, so a new call site cannot leak by
forgetting:

- **Sensitive-looking keys are redacted.** Any string under a key containing `name`, `token`,
  `ip`, `address`, `remote`, `agent`, `secret`, `password`, `auth`, `code`, `email`, `session`
  or `fingerprint` (case-insensitive substring) becomes `[redacted]`.
- **Free-form text keys are redacted outright.** A field named exactly `message`, `err`,
  `error`, `errors`, `stack`, `detail`, `details`, `payload`, `text` or `body` is dropped —
  matched exactly, so a bounded field like `messageType` still passes through.
- **Arrays and objects are collapsed to a size.** A hand, a meld list or a whole game view can
  never be serialized into a line; only `{length: n}` or `{keys: n}` survives.
- **Surviving strings are capped** at 200 characters.
- **Numbers always pass through**, which is why room codes appear only as `codeLength`.

### Exceptions are logged as a type, not as text

An exception message is attacker- and player-influenced free text: a name, a room code or an
entire payload can end up inside one. Every catch site therefore logs `errorFields(err)`, which
yields the error's *class* and nothing else:

```json
{"ts":"2026-01-01T00:00:00.000Z","level":"error","event":"message_handler_error","errorType":"TypeError"}
```

`errorType` is the error's class name, and it is validated as one: a source-code identifier,
letters and digits, at most 40 characters. `Error.prototype.name` is writable, so a name
carrying runtime data would otherwise smuggle free text straight back into the line; anything
not matching is reported as plain `Error`.

**In development the message is kept** (as `errorMessage`, still redacted and length-capped by
the logger), because there the operator is the developer. The mode comes from `config.mode`,
and `errorFields` defaults to production behaviour when no mode is passed — the safe direction
for a future call site to be wrong in.

So the debugging path for a production throw is: read the `errorType` and the rate, then
reproduce locally or in staging, where the message and the stack are in front of you.
Production keeps the *rate* and the *type* — which is what
`mexemexe_message_handler_errors_total` alerts on — and discards the text.

## Metrics

`GET /metrics` on the server port, Prometheus text format. Every series is a process-wide
aggregate; there is no per-room, per-player, per-socket or per-request series, because one time
series per player *is* a tracking system however it is labelled.

| Metric | Type | Meaning |
| ------ | ---- | ------- |
| `mexemexe_connections_current` | gauge | Open WebSocket connections |
| `mexemexe_rooms_current` | gauge | Rooms held in memory |
| `mexemexe_connections_capacity_ratio` | gauge | Connections ÷ `MEXE_MAX_CONNECTIONS` |
| `mexemexe_rooms_capacity_ratio` | gauge | Rooms ÷ `MEXE_MAX_ROOMS` |
| `mexemexe_uptime_seconds` | gauge | Seconds since this process started serving |
| `mexemexe_heap_used_bytes` | gauge | V8 heap in use |
| `mexemexe_resident_bytes` | gauge | Process RSS |
| `mexemexe_connections_total` | counter | Connections accepted |
| `mexemexe_connections_rejected_total` | counter | Refused by an admission cap — label `reason="global_cap"\|"ip_cap"` |
| `mexemexe_disconnects_total` | counter | Connections closed |
| `mexemexe_reconnects_total` | counter | Successful seat reconnects |
| `mexemexe_rooms_created_total` | counter | Rooms created |
| `mexemexe_games_started_total` | counter | Matches started |
| `mexemexe_games_finished_total` | counter | Matches that reached game over |
| `mexemexe_message_handler_errors_total` | counter | Throws caught by the inbound handler |
| `mexemexe_socket_errors_total` | counter | Socket-level errors from `ws` |

**Label policy.** `reason`, drawn from a fixed two-value set, is the only label in the whole
exposition — and `tests/server/index.integration.test.ts` asserts exactly that by matching every
label in the rendered output against that set. A label may never carry a player ID or name, a
room code, an IP, a token, a user agent, a request or session ID, a URL, or an exception
message.

### Access

`/metrics` says nothing about any individual, but it does reveal load, so it is **not open by
default in production**:

| Mode | `MEXE_METRICS_TOKEN` | `/metrics` |
| ---- | -------------------- | ---------- |
| development | unset | Open — `curl` it with no setup |
| production | unset | **404.** The endpoint does not exist |
| production | set (≥16 chars) | Requires `Authorization: Bearer <token>` |

A refusal is a 404, not a 401, so an unauthenticated caller learns nothing about whether the
endpoint is there. The comparison is constant-time. A token shorter than 16 characters is a
fatal config error — protection that can be guessed is worse than none, because it reads as
protection.

`/health` stays open regardless: load balancers and the Docker healthcheck depend on it, and it
is five aggregate numbers.

To run the monitoring profile, create both halves of the secret at once:

```bash
openssl rand -hex 32 | tee monitoring/metrics_token | sed 's/^/MEXE_METRICS_TOKEN=/' >> .env
openssl rand -hex 16 > monitoring/grafana_password
```

Prometheus reads `monitoring/metrics_token` (its config file cannot expand environment
variables, hence a file); the server reads `MEXE_METRICS_TOKEN` from `.env`. Both are
git-ignored.

## `/health`

```bash
curl http://localhost:8787/health
{"ok":true,"uptimeSec":142,"rooms":3,"connections":7,"protocol":4}
```

Five fields, all numbers or booleans, all aggregate. No identifiers, no config dump, no
diagnostics. Any other path is a 404. The Docker healthcheck polls it every 30s.

## nginx

The static-game container ships `nginx.conf` with **`access_log off;`**. A default access log
line persists the client IP, the user agent, the referrer and the full request URL for every
asset fetch — personal data the game has no use for, accumulating by default.

Error logging stays on, at **`crit`** rather than the stock `error`. This matters: nginx writes
the client IP *and* the full request line into every error entry, and at the default level a
missing favicon counts as one — so leaving the default would have quietly persisted an IP per
404 through the back door. `crit` keeps the failures an operator must act on (worker, socket
and upstream failures; `emerg` config errors sit above it and are always logged) and drops the
per-request 4xx noise. Startup notices come from the main `nginx.conf` and are unaffected.

Verified by building the `web` image and requesting a URL carrying a canary query string and
user agent, plus a 404: the container log contains the startup notices and nothing else.

## Client diagnostics

`src/core/playlog.ts` is a session-scoped, in-memory ring buffer (2000 entries) of gameplay
counters — turns, draws, undos, rejection reasons. It:

- **never leaves the browser.** It has no `fetch`, no `WebSocket`, no `sendBeacon`, no upload
  path of any kind, and a test asserts so.
- **uses no storage.** No `localStorage`, no cookie, no `indexedDB`, no generated UUID — so
  there is no persistent diagnostic identifier and nothing survives a reload.
- **timestamps relatively.** `performance.now()` since module load, never a wall clock.
- **strips player-typed keys** (`name`, `playerName`, `token`, `sessionToken`) from anything a
  caller passes.
- **is bounded** — the oldest entry is dropped past the cap.

It is on by default because the results screen reads its per-player counters; `?playlog=0`
turns it off. A player can export it themselves from Settings → Advanced (it goes to the
clipboard) and choose to attach it to a bug report. Nothing exports it for them.

Player saves and settings are `localStorage` only; clearing site data resets them.

## Retention

| Data | Retention | Set where |
| ---- | --------- | --------- |
| Container logs (app + nginx) | 10 MB × 3 files per container, rotated | `docker-compose.yml` `logging:` |
| nginx access logs | **Disabled** | `nginx.conf` |
| Debug-level logs | Off in production (`LOG_LEVEL=info`) | `server/config.ts` |
| Prometheus metrics | 30 days | `--storage.tsdb.retention.time=30d` |
| Client diagnostics | Session only, never uploaded | `src/core/playlog.ts` |
| Room and game state | Process lifetime — in memory, no database, no volume | `server/rooms.ts` |

There is no log shipping, no centralized log search and no Loki: with one service and bounded
container logs, `docker compose logs` answers every question a log index would, and a log index
would mean copying the same lines somewhere they live longer.

There is no tracing, no OpenTelemetry and no Tempo either. Nothing in this system is a
distributed call graph — it is one process holding rooms in a map.

## Monitoring stack

Optional and off by default:

```bash
docker compose --profile monitoring up -d     # Prometheus :9090, Grafana :3000
```

- `monitoring/prometheus.yml` — scrapes `mexe-server:8787/metrics` every 30s. Nothing else.
- `monitoring/alerts.yml` — the alerts below.
- `monitoring/dashboard.json` — one Grafana dashboard, auto-provisioned: up/uptime, capacity,
  memory, connections, rooms, connect/disconnect/reconnect rate, errors, matches, refusals.
  There is deliberately no player-level panel; the metrics carry no labels that would allow one.

Grafana reads its admin password from `monitoring/grafana_password` via
`GF_SECURITY_ADMIN_PASSWORD__FILE` — there is deliberately no `admin` default to forget about,
and it refuses to start if the file is missing. A single-host deployment can skip both
containers entirely and read `/health` and `/metrics` directly.

### Alerts

Each one means a human should look now.

| Alert | Fires when |
| ----- | ---------- |
| `ServerDown` | `/metrics` unscrapeable for 2 minutes |
| `ServerRestarting` | Uptime keeps resetting — crash loop; every restart ends every match |
| `MessageHandlerErrors` | Inbound handler throwing above a trickle for 10 minutes |
| `SocketErrors` | Socket-level errors elevated for 10 minutes |
| `DisconnectStorm` | Disconnect rate far above connect rate — sessions being dropped |
| `ConnectionsRejected` | An admission cap is refusing connections |
| `CapacityNearLimit` | Connection or room capacity above 80% |
| `MemoryGrowth` | Heap climbing steadily for hours — state is bounded, so this is a leak |

Nothing alerts on an individual player's behaviour.

## Debugging workflow

Deliberately, production logs will not tell you *what* an error said. The path is:

1. **Is it the service or a change?** `/health` — low `uptimeSec` means a restart, and rooms
   are in-memory, so a restart ends matches.
2. **What is the shape of the failure?** `/metrics`, or the Grafana dashboard: which counter is
   climbing, and since when. `errorType` in the stderr line names the error class.
3. **Reproduce it off production.** `LOG_LEVEL=debug` locally or in staging adds room lifecycle
   lines and gives you the real stack on the console.
4. **Ask the player for their play log** if it is client-side — Settings → Advanced copies it
   to the clipboard, and it contains no names or tokens.

If step 3 is repeatedly impossible for some class of failure, add a **bounded, predefined**
error code to the log line at the throw site. Do not widen the logger.
