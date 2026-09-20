# Threat model — MEXEMEXE!

**Canonical for:** what is worth protecting here, where the trust boundaries are,
which threats are real for *this* product, and who owns each mitigation.

Not canonical for the mitigations themselves — each row points at the document
that owns it ([MULTIPLAYER.md](MULTIPLAYER.md) §9 for protocol and anti-cheat,
[OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md) for logs and metrics,
[OPERATIONS.md](OPERATIONS.md) for deployment, [DEVELOPMENT.md](DEVELOPMENT.md)
§Dependencies for supply chain). This file is the map, not a second copy.

## What this product actually has to protect

Short, because the product is deliberately small. There are **no accounts, no
passwords, no payments, no personal profiles and no database.**

| Asset | Why it matters | Where it lives |
|---|---|---|
| Hidden game state (opponent hands, the draw pile, the shuffle seed) | knowing them is cheating, and there is no way to un-know them | server memory only; clients hold a redacted projection |
| Seat ownership (the reconnect token) | it is the only credential in the system; holding it *is* being that player | `sessionStorage` in one tab, paired with the endpoint that issued it |
| Match integrity (legality, turn order, revision) | a game that can be cheated is not the game | `src/rules` on the server; the client never decides legality |
| Room availability | a room farm denies play to everyone else | server admission and per-source budgets |
| Player-typed text (display name) and network address | the only personal data that exists at all | name: memory + one `localStorage` key; address: a `Map` key while the socket is open |
| The delivered build | a tampered client is a tampered game | static hosting, service-worker cache keyed by version |

## Trust boundaries

```text
[ player's browser ]  UNTRUSTED to the server
      │  WebSocket JSON frames ───────────► parseClientMessage  (shape, size, version)
      │                                     RoomManager         (membership, seat, turn)
      │                                     src/rules           (legality)
      │  HTTP asset/shell fetch ──────────► nginx (static files only, no app logic)
      │
      ├─ localStorage / sessionStorage  UNTRUSTED to the client itself → parseSave, token/endpoint pairing
      ├─ URL parameters                 UNTRUSTED input          → owned in installDebugApi, ?ws= documented
      └─ window.__MEXE__                bounded by what the client already knows

[ server process ]    TRUSTED: it is the authority
      ├─ /health   open, five aggregate numbers
      ├─ /metrics  token-gated in production, 404 without
      └─ stdout/stderr  redacted inside the logger, never written to disk by the app

[ supply chain ]      3 runtime dependencies, lockfile committed, advisories audited nightly
```

## Threats

Priorities use the repo's own scale ([ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md)
§11): **P0** correctness/privacy/authority · **P1** blocks or breaks a lifecycle ·
**P2** structural risk · **P3** debt.

| ID | Threat | Boundary | P | Status | Mitigation and owner |
|---|---|---|---|---|---|
| TM-01 | A client sends a malformed, oversized or hostile frame | wire | P0 | mitigated | `parseClientMessage` validates shape, size and version before anything else; handlers are wrapped so a throw becomes a rejection. `tests/net/parse-client-message.test.ts`, `tests/server/*` |
| TM-02 | A client plays out of turn, plays a card it does not hold, or forges a card id | wire → rules | P0 | mitigated | seat and turn checks in `RoomManager`; card **ids** are rehydrated against server state; legality is `src/rules` and only there |
| TM-03 | A client learns an opponent's hand | server → client | P0 | mitigated | the server sends a redacted `GameView` (placeholder cards); `tests/property/protocol.property.test.ts` proves it over generated states; `verify:multiplayer` asserts hand privacy on real clients |
| TM-04 | Someone steals a seat | token | P0 | mitigated | the token is `randomUUID` from `node:crypto`, lives in `sessionStorage` paired with its endpoint, is never in `localStorage`, and exactly one transport may hold a seat — a reconnect evicts the previous one |
| TM-05 | A crafted link (`?ws=`) makes a player's client hand its token to a hostile server | URL | P1 | mitigated | the token is replayed only when the endpoint matches the one that issued it; a token from an older build has no endpoint beside it and is discarded |
| TM-06 | Room-code guessing | wire | P1 | bounded | ten failed lookups close the connection; codes are `randomInt` over 28 symbols. A large connection farm is explicitly *not* mitigated |
| TM-07 | Resource abuse: socket floods, room farms, resync spam, half-open sockets | admission | P1 | bounded | per-connection message rate (close `1008`), per-source room-create budget, resync cap, global and per-IP connection caps, 15 s heartbeat. Windowed counters, pruned by the existing sweep |
| TM-08 | `X-Forwarded-For` spoofing defeats every per-source budget | proxy | P1 | mitigated by config | `MEXE_TRUSTED_PROXY_HOPS` — XFF is ignored at the default 0 and read only that many entries from the right. Misconfiguration is the residual risk, documented in OPERATIONS.md |
| TM-09 | Load information leaks through `/metrics` | HTTP | P2 | mitigated | production 404s without `MEXE_METRICS_TOKEN`, bearer-compared in constant time; a short token is a fatal config error |
| TM-10 | Player data leaks into logs | logging | P0 | mitigated | redaction is inside the logger, not at call sites; exceptions log their *class*, never their text; arrays and objects collapse to a size. `tests/server/log.test.ts` privacy canaries |
| TM-11 | The shipped debug surface exposes something | client | P2 | mitigated | `window.__MEXE__` is bounded by the client's own knowledge — redacted projection, no token, no online replay ([OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md)) |
| TM-12 | Tampered `localStorage` changes gameplay | storage | P1 | mitigated | nothing persisted decides a legality question; `parseSave` falls back per field; a snapshot is validated by the same invariants the server asserts |
| TM-13 | A stale cached client talks to a newer server | version | P2 | mitigated | `unsupported_version` on the first frame, with copy that tells the player to reload ([ARCHITECTURE.md](ARCHITECTURE.md) §Compatibility policy) |
| TM-14 | Compromised or vulnerable dependency | supply chain | P2 | monitored | 3 runtime deps, lockfile committed, `npm ci` everywhere, advisories audited nightly, CodeQL on push |
| TM-15 | No security headers on the static host | deployment | P2 | mitigated | `nginx.conf` sends a CSP with no script escape hatch (`'unsafe-inline'` for style only, no `'unsafe-eval'`), plus `nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: DENY`. Exercised against the built app in a browser; regression-guarded by `tests/deployment.test.ts` |
| TM-16 | The server container runs as root | deployment | P2 | mitigated | the `server` image drops to the built-in `node` user and runs the local `tsx` bin rather than `npx`, so it needs no writable `$HOME`. CI builds the stage, boots it, reads `/health` and asserts the process user |
| TM-21 | The `web` image's nginx master still runs as root | deployment | P3 | accepted | nginx's workers already drop to the `nginx` user; running the master unprivileged means a different base image and a port change through every compose file, for a process that serves static files and logs nothing |
| TM-17 | A transpiler (`tsx` + `esbuild`) sits in the production server image | deployment | P2 | accepted | deliberate trade with named revisit conditions ([DEVELOPMENT.md](DEVELOPMENT.md) §Dependencies) |
| TM-18 | Denial of service at volume | network | P2 | **not mitigated, by design** | this is an alpha for friends on a single process with no CDN or scrubbing in front. Stated, not pretended away ([MULTIPLAYER.md](MULTIPLAYER.md) §9) |
| TM-19 | Timing or behavioural inference about an opponent (how long they thought) | client | P3 | not mitigated | inherent to a turn-based game played by humans; no hidden state is derivable from it |
| TM-20 | A hostile *player* rather than a hostile client: stalling, rage-quitting, abusive display names | product | P3 | partially bounded | the turn timer ends a stalled turn; names are length-capped and sanitized server-side. There is no report/ban system and no chat to abuse |

## What this model deliberately does not include

- **Account security, password handling, payment flows.** None exist.
- **Multi-tenant isolation.** One process, one deployment, rooms in memory.
- **Compliance certification.** [OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md)
  states what is and is not collected; that is the honest artefact, not a badge.
- **Anti-cheat against a modified client.** The server is the authority, so a
  modified client can only ask; TM-02 is the whole answer.

## Keeping it true

A change that adds a trust boundary — a new endpoint, a new stored key, a new
message type, a new dependency that runs in production — adds or updates a row
here in the same change. The threats are ordered by priority, not by discovery,
so a new P0 goes at the top and does not ship open.
