# Phase 18 — Multiplayer Stability + Abuse Hardening Audit

Scope: `server/` (index, rooms, connections, config, log), `src/net/` (protocol, client, errors,
viewToState), `src/scenes/OnlineScene.ts`, the online paths in `src/scenes/GameScene.ts`,
`tests/server/`, `e2e-multiplayer/`, CI and the Docker/env config.

## Current multiplayer status (entering Phase 18)

Phases 5–7 already delivered most of the trust boundary and most of the abuse surface, and
Phase 16/17 added the mobile/PWA sleep-resume path. Specifically, already in place before this
phase:

- Server is authoritative. Clients send intents only (`submit_turn` carries meld ids + card ids,
  never card identities). `RoomManager.submitTurn` rehydrates every card from server state by id
  from the active seat's own hand plus the committed table, so a forged or opponent-owned id is
  rejected as `reason.unknownCard`.
- Per-seat redaction in `buildView`: only the viewing seat gets a `hand`, opponents get
  `handCount`, the draw pile is a count, and the shuffle seed never crosses the wire.
- Revision check (`rev !== room.rev` → `reason.staleRevision`) is the real double-submit and
  stale-submit guard; `room.processing` is a defensive re-entrancy flag only.
- Boundary validator `parseClientMessage` never throws: bad JSON, non-objects, wrong protocol
  version, unknown type, missing/oversized fields and over-long arrays are all rejected, and
  every socket message is additionally wrapped in a try/catch in `server/index.ts`.
- Socket/seat bookkeeping in `server/connections.ts`: `evictSeat` (one live socket per seat),
  `moveSocket` (detach from the old room before attaching), `closeRoomSockets` (notify + clear
  every `ConnState` on a dead room), `hitFlood` (30 msg/s per connection), `hitJoinLimit` (10
  failed room-code lookups per connection).
- Caps and lifecycle: `maxPayload` 16 KiB, global + per-IP connection caps, room cap, 15 s
  ws-level heartbeat with terminate-on-miss, 30 s room sweep, stalled-turn advance after the
  disconnect grace, per-room crash isolation, graceful SIGTERM/SIGINT shutdown with a hard-exit
  deadline, and a privacy-enforcing logger that redacts by key name and collapses arrays/objects.
- Log privacy: room codes and names are never logged (only `codeLength`), and hands can't be
  logged at all because arrays collapse to a length.

## Protocol / server authority map

| Client intent | Server handler | Authority check |
|---|---|---|
| `create_room` | `rooms.createRoom` | `conn.code === null`; room cap |
| `join_room` | `rooms.joinRoom` | code must exist; not started; free seat; failed-lookup throttle |
| `leave_room` | `rooms.leaveRoom` | seat taken from `ConnState`, never from the payload |
| `ready` | `rooms.setReady` | must be in a room; game not started |
| `start_game` | `rooms.startGame` | seat 0 only; all occupied seats ready **and** connected; no seat gap |
| `submit_turn` | `rooms.submitTurn` | phase, active seat, revision, id rehydration, `canConfirmTurn`, card conservation |
| `draw_end_turn` | `rooms.drawEndTurn` | phase, active seat, revision |
| `reconnect` | `rooms.reconnect` | session token (v4 UUID) is the only credential |
| `resync` | `rooms.getView` | one-way re-send; the server never reads client state |
| `ping` | — | `pong` |

## Socket / session / seat ownership map

- `connections: Map<WebSocket, ConnState>` — per-socket `{ code, seat, msgCount, windowStart, failedJoins }`.
- `sockets: Map<code, Map<seat, WebSocket>>` — the only broadcast path.
- `connectionsByIp: Map<ip, count>` — per-IP cap, incremented on accept, decremented on close.
- `Seat.token` (v4 UUID) is the session credential; seat index is derived server-side and never
  read from a client payload.

## Privacy / redaction map

`buildView` (own hand only) → `state_sync` / `game_started` / `game_over` / reconnect's
`state_sync`. `RoomPlayerSummary` carries `{ seat, name, ready, connected }` — no cards.
`server/log.ts` redacts by key substring and collapses every array/object to a size.

## Findings

Ten fixes, highest risk first. All ten were selected and implemented in this phase.

| # | Risk | Finding |
|---|---|---|
| 1 | **P1 — room leak + permanent softlock** | `server/index.ts` `reconnect` called `moveSocket`, which detaches the socket from its previous room, but never told `RoomManager` that the previous seat was gone. That seat stayed `connected: true` with no socket attached, so `advanceStalledTurns` skipped the room (active seat "connected"), `sweep` skipped it (`anyConnected`), and the idle backstop skipped it (`!anyConnected` required). A member of a live room could hop away with an unrelated token and leave the room stuck forever with its remaining player stranded and no `player_disconnected` notice. |
| 2 | **P1 — legal move rejected late-game** | `parseClientMessage` capped a `submit_turn` at `MAX_TOTAL_CARDS = 60`, but the deck is `2 × (52 + 2) = 108` cards and a proposal carries the whole table plus the hand cards being played. A late-game rearrangement of a large table exceeded 60 ids and came back as a generic `bad_message` error instead of a proposal result, so FEITO appeared to do nothing. |
| 3 | **P1 — silent drop of a submit** | `NetClient.sendRaw` returned silently when the socket was not `OPEN`, so a FEITO/COMPRAR pressed during `reconnecting` set `onlinePending` and locked the board until the 12 s pending timeout, with no statement that the move never left the device. |
| 4 | **P2 — unrecoverable lobby after an expired session** | A dead reconnect token stayed in `sessionStorage`, so every subsequent entry into the online lobby re-sent it, got `invalid_token`, and landed on the "session expired" error screen — including the retry. |
| 5 | **P2 — corrupt process kept serving** | `uncaughtException` was logged and the process continued with unknown in-memory room state. |
| 6 | **P2 — stale lobby presence** | Disconnect and reconnect broadcast only `player_disconnected` / `player_reconnected`; `OnlineScene` renders presence from `room_state`, which was not re-broadcast, so a lobby kept showing a stale "(Desconectado)" marker. |
| 7 | **P2 — lobby does not survive app sleep** | `GameScene` reconnects/resyncs on `onAppVisible`; `OnlineScene` had no equivalent, so a lobby backgrounded on a phone came back with a dead socket and a stale status line. |
| 8 | **P3 — close code** | The flood guard closed with no status code, so the client could not distinguish it from a network drop. |
| 9 | **P3 — no integration coverage of `server/index.ts`** | Everything in `server/index.ts` (the message wiring, the caps, the room-hop path, malformed/oversized frames) was covered only indirectly through Playwright; the unit suite tested `rooms.ts`/`connections.ts` in isolation. |
| 10 | **P3 — CI** | `verify:multiplayer` was not wired into CI. |

## Known risks from prior audits, re-checked

- PHASE5_SERVER_REVIEW S1–S6 — all still enforced; unit tests for each still pass.
- PHASE7_AUDIT #1 (half-open sockets), #2 (payload cap), #3 (state digest), #4 (stalled turns),
  #6 (finished-room teardown) — all still enforced.

## Remaining risks (not fixed here, with priority)

1. **P2 — per-IP cap behind a reverse proxy.** `connectionsByIp` keys on
   `req.socket.remoteAddress`. Behind a proxy every client shares the proxy's address, so
   `MEXE_MAX_CONNECTIONS_PER_IP` becomes a global cap. Deliberately not "fixed" by trusting
   `X-Forwarded-For` — that header is client-settable and trusting it by default would turn the
   cap into a no-op. Operators must either terminate WebSockets without a proxy hop or raise the
   cap; documented in `docs/OPERATIONS.md`.
2. **P2 — room codes are 5 chars from a 28-symbol alphabet** (17.2M combinations). Per-connection
   throttling (10 failed lookups, then close) plus the per-IP connection cap bound the guess rate
   to roughly 200 attempts per IP per connection cycle. Lengthening the code was considered and
   rejected for this phase: it would change every printed/spoken code in the docs and e2e suite
   for a brute-force cost that is already impractical, and a reasonable next step is a
   per-IP failed-join counter rather than a longer code.
3. **P3 — no cross-process room state.** A server restart loses every room; clients get
   `server_shutdown` and return to the menu. Horizontal scaling and restart survival are out of
   scope for the online alpha.
4. **P3 — `unhandledRejection` is still log-only.** There is no `await` on any room-mutating path,
   so a stray rejection cannot leave room state half-applied the way an uncaught throw can.
5. **P2 — pre-existing flake outside this phase's scope.** `e2e/screenshot.spec.ts`
   "mobile-tap-move-invalid" intermittently loses one of its two taps inside the full run and
   reports `reason.meldTooSmall` instead of `reason.groupDuplicateSuit`, which fails
   `npm run verify`. It passes 3/3 in isolation and reproduces on the pre-Phase-18 tree (verified
   by stashing `src/`, `server/` and `tests/` and re-running the suite: same single failure). It is
   a local-play timing issue with no online path involved, so it was left alone rather than folded
   into a multiplayer phase.
6. **P3 — Playwright multiplayer spec is device/browser-bound.** Raw-socket abuse cases now live
   in the vitest integration suite instead, which is what CI runs.
