# MEXE! Online Alpha — Multiplayer Architecture

*Design: Opus (reasoning/prose). Implementation + final review: Sonnet.
Scope: 2-player private rooms, alpha quality. No accounts, matchmaking,
ranking, chat, or cosmetics sync.*

*This document was drafted before implementation began. It has been
reconciled against the shipped code (§4 protocol table and §7 reconnect
section in particular) — see §12 "As built" for the file list and any point
where the built system differs from the original design.*

## 1. Responsibilities

**Server owns truth.** It holds the only real `GameState` for a room: both
hands, the ordered draw pile, the committed table, whose turn it is, and a
monotonically increasing `rev`. It deals (from a server-chosen seed), validates
every proposal with the shared rules module, applies accepted proposals,
computes wins and stalemates, and broadcasts redacted views.

**Clients own presentation and drafting.** A client renders the view it is
given, lets the active player rearrange the table locally (undo/redo/reset all
local, never networked), and sends *intents*: "I propose this final table",
"I draw and end my turn", "I am ready". A client never decides that a turn was
legal, never decides a winner, and never advances `rev` on its own.

Consequence: the client's `DraftEditor` stays exactly as it is — a local
scratchpad — and the server never sees a draft until FEITO.

## 2. Hidden information

The server never sends a full `GameState` to a client. It sends a per-player
**view**:

- `you`: your seat index, your full hand.
- `players[]`: id, name, `handCount`, connection status.
- `table`: committed melds (public).
- `drawCount`: cards left in the pile (count only, never order).
- `activeSeat`, `turn`, `rev`, `phase`, `winnerId`.
- `config`: the room's `RulesConfig` (deck count, jokers per deck, max group
  size, etc.), so the client validates drafts with the exact same house rules
  the server will enforce — `DEFAULT_RULES` is the only value in play today,
  but the client never hardcodes it.

This is both an anti-cheat measure and the reason `window.__MEXE__.state()`
cannot leak an opponent's hand in an online match.

## 3. Room lifecycle

1. **create_room** — server generates a room code (short, unambiguous
   alphabet, no vowels so no accidental words), creates the room with the
   caller as seat 0, issues a session token, replies `room_joined`.
2. **join_room** — second player joins as seat 1; both get `room_state`. A
   third join is rejected (`room_full`).
3. **ready** — each seat toggles ready. When both are ready the server picks
   the seed, deals, sets `rev = 1`, and broadcasts `game_started` plus each
   player's first `state_sync`.
4. **playing** — alternating turns; every accepted action increments `rev`.
5. **game_over** — server broadcasts winner (or stalemate result); room stays
   alive briefly so both clients can read the result, then is reaped.
6. **empty/abandoned** — room is destroyed when both sockets are gone past the
   grace window, or after an absolute idle timeout.

## 4. Protocol

JSON text frames. Every message: `{ v, type, ... }` where `v` is the protocol
version (`PROTOCOL_VERSION = 2` — bumped from 1 for the rules adaptation:
`GameView` gained `config`, and card ids changed shape with the two-deck/joker
model); a mismatch is refused at connect with a clear reason rather than
producing subtle desyncs. Client-to-server messages carry a client-chosen
`reqId`; every rejection echoes it, so a client can tie a rejection to the
submission that caused it.

**Client → server**

| type | payload | notes |
|---|---|---|
| `create_room` | `name` | replies `room_joined` |
| `join_room` | `code`, `name` | replies `room_joined` or `error` |
| `leave_room` | — | explicit, distinct from a dropped socket |
| `ready` | `ready: boolean` | idempotent |
| `submit_turn` | `rev`, `melds: [{ id, cardIds[] }]` | card **ids only** |
| `draw_end_turn` | `rev` | |
| `reconnect` | `token` | resumes a seat in a live room |
| `ping` | — | |

**Server → client**

| type | payload | notes |
|---|---|---|
| `room_joined` | `code`, `seat`, `token`, `players` | token is the reconnect key |
| `room_state` | `players` (each entry carries its own `ready`/`connected`) | lobby updates |
| `game_started` | `seed`, `view` | broadcast to both seats when `ready` makes both seats ready; there is no separate `start_game` message — `game_started` is both the "match has begun" notice and the first view, and `rev` lives inside `view.rev` rather than as a top-level field |
| `state_sync` | `view` (redacted, `rev` inside it) | the only source of truth on the client |
| `proposal_rejected` | `reqId`, `reasons: ReasonCode[]` | codes, not prose |
| `player_disconnected` | `seat` | opponent notice |
| `player_reconnected` | `seat` | |
| `game_over` | `winnerId`, `stalemate`, `view` | `view` carries the final redacted state so both clients render the same closing board |
| `error` | `code`, `message` | protocol-level problems, including `room_closed` (S1/S2: a reaped or abandoned room notifies every attached socket before dropping it) |
| `pong` | — | |

`ReasonCode` values are the existing localized keys (`reason.duplicateCard`,
`reason.cardMissing`, `reason.noHandCard`, `reason.notAMeld`,
`reason.meldTooSmall`, `reason.foreignCard`, plus the rules-adaptation
additions `reason.groupTooLarge`, `reason.jokerUnassignable`,
`reason.runWrap`) plus network-only codes (`reason.notYourTurn`,
`reason.staleRevision`, `reason.alreadySubmitted`, `reason.unknownCard` —
returned when a submitted card id does not resolve against the active
player's hand or the committed table), so the client renders every rejection
through its existing `t()` table in PT and EN with no server-side copy.

## 5. Validation path

`submit_turn` arrives → boundary validator checks the message *shape* (types,
array bounds, string lengths, meld/card counts) → room checks seat is the
active seat → room checks `rev` matches current `rev` → room checks no
proposal is already in flight for this turn → **card ids are rehydrated from
the server's own state** (any unknown id is a rejection; client-supplied suit,
rank and joker interpretation are all discarded — a submission carries card
ids only, so a joker's identity cannot be forged by a client and is preserved
exactly as the server's own state assigned it) → the rehydrated melds are
passed to the shared `canConfirmTurn(state, draft)` → on `ok`,
`applyConfirmedTurn` runs, the card-conservation invariant (config-derived:
`deckCount * (52 + jokersPerDeck)`, not a hardcoded 52) is re-asserted, `rev`
increments, and the new view is broadcast to both seats. On failure the
server replies `proposal_rejected` with the reason codes and **does not**
mutate state.

`draw_end_turn` follows the same path with the same seat/rev checks and
`drawAndEndTurn`. If the draw pile is already empty, `drawAndEndTurn` does not
draw — it ends the game immediately (`phase: 'finished'`, winner = fewest
hand cards, tie to earliest seat) and that terminal state is what gets
`assertConservation`-checked, saved as `room.state`, and synced to both
clients via the normal broadcast path — there is no separate "stalemate"
message type; it rides `game_over` like any other win.

The point of this ordering is that cheap, adversary-controlled checks happen
before any game logic, and the shared rules function is the last word.

## 6. Client reconciliation

The client keeps its rendered state derived from the last `state_sync` only.
On FEITO it snapshots the draft, sends `submit_turn`, and enters a *pending*
state: input disabled, submit button locked, so double-submit is impossible at
the UI layer as well as the server layer. On `state_sync` it discards the draft
and re-renders from the server view. On `proposal_rejected` it shows the
localized reason and restores the last synced state — never a half-applied
draft. A `state_sync` with a `rev` lower than the one already rendered is
ignored (late/out-of-order delivery).

## 7. Reconnect plan (as built)

At join, the server issues a `token` (opaque random string) bound to
`room + seat`; the client stores it in `sessionStorage`. On socket close the
server marks the seat disconnected and notifies the opponent
(`player_disconnected`); it does **not** start a per-token expiry timer.
Instead, `RoomManager.reconnect(token)` accepts the token for as long as the
room object exists in memory — there is no separate check against the
disconnect timestamp or the grace window inside `reconnect` itself. The grace
window (`DEFAULT_DISCONNECT_GRACE_MS`, 30s) only governs when the periodic
`sweep()` is allowed to delete a room whose seats are *all* disconnected past
that window (S1/S3 in `docs/PHASE5_SERVER_REVIEW.md`); once a room is swept,
its token stops working because the room itself is gone, not because the
token was individually invalidated. A reconnect that lands before the sweep
runs succeeds even if it arrives after the nominal 30s, and reconnecting
while the opponent is still connected and the game is mid-match works too —
`reconnect` doesn't require anyone else to be disconnected. On a successful
reconnect the server also evicts whatever socket previously held that seat
(S4: exactly one connection can act for a seat at a time), attaches the new
socket, and replies with `state_sync` if a game is in progress or
`room_joined` if the room is still in its lobby; the opponent gets
`player_reconnected`. After a room is swept, any socket still attached to it
receives an `error` with `code: 'room_closed'` and must return to the lobby.

Any proposal that was in flight when the socket dropped is treated as never
submitted: the server only mutates state on a fully validated message it has
already processed, so there is no half-committed turn to recover.

On the client, reconnect is **not** a persistent retry loop. `NetClient`
attempts exactly one bounded reconnect (`RECONNECT_DELAY_MS` after an
unexpected close) if a stored token exists; if that attempt also fails to
stay open, the client falls back to the documented safe path — return to the
local menu with an explicit message — rather than retrying indefinitely. This
was scoped down from the original "grace window with an explicit countdown"
idea in the initial design; the single-retry version is what's implemented
and verified (`e2e-multiplayer/multiplayer.spec.ts` forces a socket drop and
asserts the client reaches `'reconnecting'` then `'open'` with a resynced
revision).

## 8. Error handling

Every inbound frame is parsed inside a try/catch; a parse failure or a failed
shape check replies `error` and, on repeated abuse, closes the socket. No
inbound value is ever used as an object key, array index, or loop bound before
being range-checked. Handlers are wrapped so a thrown `RulesError` becomes a
rejection message, never an unhandled exception. The process installs
`uncaughtException`/`unhandledRejection` handlers that log and keep serving —
a crash would take every room down, which is the worst possible alpha failure.

## 9. Security assumptions and anti-cheat

Assumed: no accounts, no authentication beyond the room code and session
token; anyone with a code can attempt to join an open room; the alpha is for
friends, not for hostile scale. Mitigated: hidden-information leaks (redacted
views), forged cards (id rehydration), out-of-turn play (seat check), replay
and double-submit (revision + in-flight lock), malformed input (boundary
validation), seed manipulation (server-chosen seed). Explicitly *not*
mitigated in the alpha: denial of service, room-code brute force at scale,
timing/behavioural collusion. Rate limiting is a per-connection message
counter — enough to stop an accidental loop, not a determined attacker.

## 10. Deployment notes

Two processes: the existing static site and the WebSocket server. The client
resolves the WS URL from build-time configuration with a same-host default;
a page served over HTTPS must use `wss://`, which is the most common
first-deployment failure and is called out in the README. The server takes its
port from the environment, exposes a trivial health check, caps concurrent
rooms, and reaps idle rooms on a timer. Local development runs both with two
commands; a single `docker compose` service pair is the deployment shape.

## 11. Test plan

**Unit (node, existing vitest runner)** — room creation and join, join codes,
third-player rejection, ready/start, a full legal turn, rejection cases (wrong
seat, stale rev, duplicate card, missing table card, zero hand cards, returned
table card, forged card attributes, double submit), draw/end including the
empty-pile stalemate, disconnect marking, room cleanup, and a malformed-message
battery (non-JSON, wrong types, missing fields, oversized payloads, unknown
types) asserting the server stays alive.

**Redaction** — a test asserting that no message the server sends to seat 0
contains any card id from seat 1's hand or from the draw pile.

**End-to-end (Playwright, two contexts)** — launch server, create room, join by
code, both ready, start, play a legal turn on one client and observe it on the
other, attempt an illegal proposal and observe the rejection reason, draw/end,
run to a win, capture screenshots and a log containing room code, seed, every
revision, the message trace, validation results, and screenshot paths. The gate
fails on any client console error or any server error.

**Local regression** — the existing `npm run verify` must stay green
unchanged; that is the phase's primary success condition.

## 12. As built

Files:

- `src/net/protocol.ts` — shared wire protocol (pure module, no browser/Node
  APIs): message types, `buildView` (redaction), `parseClientMessage`
  (boundary validator).
- `src/net/client.ts` — `NetClient`, the browser WebSocket wrapper: connect/
  reconnect (single bounded retry), status events, message trace, ping.
- `src/net/viewToState.ts` — projects a `GameView` back into a local-shaped
  `GameState` (placeholder cards for hidden hands/draw pile) so the existing
  offline renderer can draw it unchanged.
- `src/scenes/OnlineScene.ts` — the lobby scene (idle/lobby/error), including
  `window.prompt()`-based join-code entry.
- `server/index.ts` — the WebSocket server process: message dispatch,
  broadcast helpers, health check, sweep interval, crash guards.
- `server/rooms.ts` — `RoomManager`: room lifecycle, seat/ready state, seed
  generation, turn validation and application, reconnect, sweep.
- `server/connections.ts` — per-connection state, socket attach/detach/evict,
  the flood guard, and closing every socket attached to a reaped room.

Run commands: `npm run server` (start the WS server, `PORT` env var, default
8787), `npm run test:server` (server unit suite), `npm run verify:multiplayer`
(build + two-client Playwright flow + log-based gate). Deployment is two
processes — the existing static site and this server — with the client
resolving the WS URL as described in the README's Online Alpha section
(`?ws=` override → `VITE_WS_URL` build-time env → same-host default), and a
`wss://` endpoint required for any HTTPS-served deployment.
