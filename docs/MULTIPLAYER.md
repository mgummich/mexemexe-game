# Multiplayer (online alpha)

How online rooms work: server authority, the wire protocol, room lifecycle,
reconnect, and what the alpha does **not** do. The rules themselves are in
[GAME_RULES.md](GAME_RULES.md); the client/server split in
[ARCHITECTURE.md](ARCHITECTURE.md).

Scope: 2–4-player private rooms, alpha quality. No accounts, matchmaking,
ranking, chat, or cosmetics sync. The game labels the entry point
`ONLINE (ALPHA)`.

## 0. Limitations

- **No accounts, matchmaking, ranked play, chat or spectators.** Private rooms
  by 5-character code only.
- **No online rematch** — the win screen offers MENU only; play again by
  creating or joining another room.
- **No rematch stats or winning-move text online** — the client never observes
  per-turn state locally, so there is no play log to summarize. The stats line
  is hidden rather than showing zeros. Fixing it needs a protocol change.
- **Opponent avatars are the generic player icon** — there are no accounts, so
  there is no avatar to show.
- **Rate limiting is per connection, not per IP** — enough to stop a looping
  client, not a determined attacker opening many sockets.
- **A seat disconnected past the room's reconnect grace is played for you**:
  the server draws and ends that seat's turn so the match keeps moving. It never
  melds on your behalf. Losing `missedTurnLimit` turns in a row ends the match.
- **The turn timer has three lobby presets** (Casual / Fast / Off). `custom` is a
  protocol capability with validated bounds, not a lobby control — there is no
  screen for six number pickers.
- **Reconnect is a single bounded retry**, not a persistent loop; if it fails
  the client returns you to the local menu with a message.

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
2. **join_room** — players fill stable clockwise seats 1–3; a fifth join is
   rejected (`room_full`) and joins after start are rejected (`game_started`).
3. **ready/start** — each occupied seat toggles ready. Seat 0 sends
   `start_game`; server requires 2–4 occupied ready seats, picks seed, deals,
   sets `rev = 1`, and broadcasts per-seat `game_started` views.
4. **playing** — alternating turns; every accepted action increments `rev`.
5. **game_over** — server broadcasts winner (or stalemate result), then closes
   the room immediately: the slot is freed and every socket is detached with a
   `room_closed` notice. Clients render the result from the `game_over` payload.
6. **empty/abandoned** — room is destroyed when both sockets are gone past the
   grace window, or after an absolute idle timeout.

## 4. Protocol

JSON text frames. Every message: `{ v, type, ... }` where `v` is the protocol
version (`PROTOCOL_VERSION = 4` — bumped from 3 for room settings and the
server turn timer: `GameView` gained `settings` and `turnMsLeft`, `room_joined`
and `room_state` gained `settings`/`hostSeat`, and the client gained
`set_room_settings` and `mexe_started`; v3 bumped from 2 in 1.2.0, when
`GameView` gained a `hash` digest and the client gained `resync`; v2 bumped from 1 for the rules
adaptation, when `GameView` gained `config` and card ids changed shape with the
two-deck/joker model); a mismatch is refused at connect with a clear reason rather than
producing subtle desyncs. Client-to-server messages carry a client-chosen
`reqId`; every rejection echoes it, so a client can tie a rejection to the
submission that caused it.

**Client → server**

| type | payload | notes |
|---|---|---|
| `create_room` | `name` | replies `room_joined` |
| `join_room` | `code`, `name` | replies `room_joined` or `error`; codes over 16 chars are rejected at parse, and 10 nonexistent-code guesses close the connection |
| `leave_room` | — | explicit, distinct from a dropped socket |
| `ready` | `ready: boolean` | idempotent |
| `set_room_settings` | `settings` | seat-0 host only, lobby only; normalized at the parser *and* again in the room manager, so an out-of-range value is clamped rather than applied |
| `mexe_started` | — | claims this turn's one-off Mexe extension; active seat only, granted at most once per turn |
| `start_game` | — | seat-0 host only; requires every occupied 2–4P seat ready |
| `submit_turn` | `rev`, `melds: [{ id, cardIds[] }]` | card **ids only** |
| `draw_end_turn` | `rev` | |
| `reconnect` | `token` | resumes a seat in a live room |
| `resync` | — | "resend authoritative state"; never carries client state |
| `ping` | — | |

**Server → client**

| type | payload | notes |
|---|---|---|
| `room_joined` | `code`, `seat`, `token`, `players`, `settings`, `hostSeat` | token is the reconnect key |
| `room_state` | `players` (each entry carries its own `ready`/`connected`), `settings`, `hostSeat`, `locked` | lobby updates; `locked` is true once the match started and the settings are frozen |
| `game_started` | `view` | broadcast per seat after host `start_game`; the server never sends shuffle seed, and `rev` lives inside `view.rev` |
| `state_sync` | `view` (redacted, `rev` and `hash` inside it) | the only source of truth on the client |
| `proposal_rejected` | `reqId`, `reasons: ReasonCode[]` | codes, not prose |
| `turn_timeout` | `seat` | the server ended that seat's turn (clock expired, or absent past the reconnect grace); the authoritative result already arrived as a `state_sync` |
| `player_disconnected` | `seat` | opponent notice |
| `player_reconnected` | `seat` | |
| `game_over` | `winnerId`, `stalemate`, `view` | `view` carries the final redacted state so both clients render the same closing board |
| `error` | `code`, `message`, `reqId?` | protocol-level problems; `reqId` echoes the request that failed, absent for server-initiated errors including `room_closed` (S1/S2: a reaped or abandoned room notifies every attached socket before dropping it) |
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
increments, and the new per-seat view is broadcast to every connected room
seat. On failure the
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
that window (S1/S3 in `archive/PHASE5_SERVER_REVIEW.md`); once a room is swept,
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
already processed, so there is no half-committed turn to recover. The same
applies to a Mexe draft: it stays entirely on the client until FEITO, so a
disconnect mid-draft loses the draft and nothing else — the reconnected view is
the last committed state, byte-identical to the one before the drop
(`tests/server/rooms.test.ts`, "a disconnect mid-turn discards only the
client-side draft").

A `reconnect` may arrive on a socket that is *already* holding a seat in another
room (a different token, a second room joined on the same socket). That seat is
released as part of the hop: the server marks it disconnected in the room
manager, tells that room's remaining sockets (`player_disconnected` plus a
refreshed `room_state`), and only then attaches the socket to its new seat.
Detaching the socket alone is not enough — a seat left `connected` with no
socket attached makes its room invisible to the stalled-turn advance (the active
seat looks present), to the sweep (`anyConnected`) and to the idle backstop, so
the room would sit stuck forever with its remaining players stranded
(Phase 18 finding 1, regression-tested in
`tests/server/index.integration.test.ts`).

Seat presence changes — a disconnect, a reconnect, a hop — always re-broadcast
`room_state` alongside the `player_disconnected`/`player_reconnected` event,
because the lobby renders presence from `room_state` and would otherwise keep
showing a stale marker.

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

### 4a. Desync detection

`GameView.hash` is an FNV-1a digest (`stateHash`) over the parts of the state
every seat can see: revision, active seat, turn number, phase, per-seat hand
*counts*, draw-pile *count*, and the table's meld ids and card ids. Hidden card
identities are deliberately excluded, so all seats at one revision produce the
same digest and each client can recompute it from its own reconstruction.

After applying a `state_sync`, the client recomputes the digest from its local
`GameState` and compares. A mismatch means the client can no longer be trusted
to render or propose: it locks input, shows a resyncing notice, and sends
`resync`. The server answers with a fresh `room_state` + `state_sync` — it never
reads or reconciles towards any client value. A stale-revision rejection
triggers the same request, since it means the client acted on a state the server
had already moved past. A second consecutive mismatch is accepted rather than
looping: the authoritative snapshot is the best state available either way.

### 4b. Liveness and stalled matches

The server pings every socket every 15s and terminates one that has not ponged
by the next probe, so a half-open connection releases its seat instead of
holding it until TCP gives up. Inbound frames are capped at 16 KiB
(`maxPayload`) so an oversized payload is dropped before `JSON.parse`.

If the seat whose turn it is has been disconnected past the grace window and at
least one other seat is still connected, the server plays that seat's only
always-legal move — draw and end turn — so the remaining players are not stuck
on a board that can never advance. It never melds on a player's behalf. A room
with nobody connected is left to the sweep instead.

## 7b. Room settings and the turn timer

**What is configurable.** `RoomSettings` (`src/net/protocol.ts`) is the whole
fairness surface: `timerMode`, `turnMs`, `mexeBonusMs`, `warnMs`,
`reconnectGraceMs`, `missedTurnLimit`. Presets:

| preset | turn | Mexe bonus | warning | reconnect grace | missed-turn limit |
|---|---|---|---|---|---|
| Off | — | — | — | 60s | 2 |
| Casual (default) | 90s | +45s | 10s | 60s | 2 |
| Fast | 45s | +20s | 10s | 30s | 2 |

A brand-new room starts on Casual, except that its reconnect grace comes from
the deployment's `MEXE_DISCONNECT_GRACE_MS` until a preset is picked.

**Who owns them.** The seat-0 host proposes, in the lobby only. The server
normalizes (`normalizeRoomSettings` — a named preset ignores every other field;
`custom` is clamped field by field; anything unrecognizable becomes the default
preset) and broadcasts. Nothing is ever applied client-side. `startGame` freezes
them: `set_room_settings` after that returns `game_started`.

**Who owns the clock.** The server, entirely. A room stores `turnStartedAt` and
`turnBudgetMs` as plain numbers, and `advanceStalledTurns()` — already the
per-tick stalled-match check, now running every second — compares them against
its own clock. There is no per-room `setTimeout`, so a deleted room leaves
nothing to leak. The client receives `turnMsLeft` inside each `GameView`,
re-anchors a local countdown from it, and renders. A client countdown reaching
zero does nothing at all.

**What a timeout does.** Exactly `timerExpireTurn(state)`: draw one card, pass.
It cannot confirm an illegal table, and this is structural rather than a check —
a Mexe draft never leaves the client until FEITO, so the server's turn-start
state *is* the table it falls back to. There is no half-finished rearrangement
for a timeout to commit. The same path serves an expired clock and a seat absent
past the grace; both increment that seat's `missedTurns`, and any turn the seat
actually takes resets it to zero.

**The Mexe bonus.** Opening the Mexe editor sends `mexe_started`. The server
grants `mexeBonusMs` once per turn, to the active seat only, and only while a
clock is running — so re-opening the editor cannot hold a turn open. A
reconnecting seat is sent the *current* remaining time, never a fresh budget,
which is what stops a reconnect loop from extending a turn indefinitely.

`turnMsLeft` is deliberately outside the state digest: a ticking clock is not a
divergence, and hashing it would make every second look like a desync.

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
counter — enough to stop an accidental loop, not a determined attacker opening
many sockets. Frame size (16 KiB) and socket liveness are enforced at the
server; a client-supplied state hash is never accepted, only ever sent.

## 10. Deployment notes

Two processes: the existing static site and the WebSocket server. The client
resolves the WS URL from build-time configuration with a same-host default;
a page served over HTTPS must use `wss://`, which is the most common
first-deployment failure and is called out in [SELF_HOSTING.md](SELF_HOSTING.md). The server takes its
port from the environment, exposes a trivial health check, caps concurrent
rooms, and reaps idle rooms on a timer. Local development runs both with two
commands; a single `docker compose` service pair is the deployment shape.

## 11. Tests

Server unit suites (`tests/server/`) cover room lifecycle, legal and rejected
turns, redaction, reconnect and a malformed-message battery; the integration
suite spawns the real process and drives raw `ws` clients. `npm run
verify:multiplayer` runs two-plus real browser clients against the real server
and gates on client console errors, server stderr, accepted illegal proposals,
hand privacy and state-hash agreement. Details in [TESTING.md](TESTING.md).

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
- `src/scenes/OnlineScene.ts` — the lobby scene (idle/join/lobby/error),
  including the in-canvas keyboard join-code entry.
- `server/index.ts` — the WebSocket server process: message dispatch,
  broadcast helpers, health check, sweep interval, crash guards.
- `server/rooms.ts` — `RoomManager`: room lifecycle, seat/ready state, seed
  generation, turn validation and application, reconnect, sweep.
- `server/connections.ts` — per-connection state, socket attach/detach/evict,
  the flood guard, and closing every socket attached to a reaped room.

Payload bounds in `parseClientMessage`: a `submit_turn` carries the whole draft
table plus the hand cards being played, so it is bounded by the deck
(`2 x (52 + 2) = 108` cards under `DEFAULT_RULES`), not by a hand.
`MAX_TOTAL_CARDS` is 120 for that reason — a lower cap rejected a legal
late-game rearrangement of a large table as a generic `bad_message` instead of a
proposal result, which made FEITO look dead (Phase 18 finding 2).

Tests: `tests/server/rooms.test.ts` and `tests/server/connections.test.ts` cover
the manager and the socket registry in isolation; `tests/server/index.integration.test.ts`
covers `server/index.ts` itself by spawning the real process and driving raw
`ws` clients — malformed/oversized/out-of-room frames, the failed-join and flood
closes, the connection cap, seat ownership and the room-hop path, hand privacy in
a real frame, and that a clean session writes nothing to stderr.

Run commands: `npm run server` (start the WS server, `PORT` env var, default
8787), `npm run test:server` (server unit suite), `npm run verify:multiplayer`
(build + two-client Playwright flow + log-based gate). Deployment is two
processes — the existing static site and this server — with the client
resolving the WS URL as described in [DEVELOPMENT.md](DEVELOPMENT.md) and [OPERATIONS.md](OPERATIONS.md)
(`?ws=` override → `VITE_WS_URL` build-time env → same-host default), and a
`wss://` endpoint required for any HTTPS-served deployment.
