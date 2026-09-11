# Phase 5 — Opus review of the server MVP (prose only)

*Reviewed: `server/rooms.ts`, `server/index.ts`, `src/net/protocol.ts` as
implemented. Verdict: the validation core is correct; the gaps are all in
**lifecycle and liveness**, and two of them are "stuck online flow" gate
violations.*

## What is right

The validation order in `submitTurn` matches the design exactly: room/state
existence, phase, seat, revision, then id rehydration from the server's own
state, then the *shared* `canConfirmTurn`, then `applyConfirmedTurn`, then a
52-card conservation assertion, then `rev++`. The wire protocol carries card
ids only, so forged suit/rank cannot exist by construction rather than by
check — the strongest form of this defence. `GameStore` is correctly avoided,
so no global event bus cross-talks between rooms. Room codes use an
unambiguous vowel-free alphabet. Seed generation is server-side and injectable.
`buildView` redacts opponent hands and the draw pile.

## Findings, ranked

**S1 — Reaped rooms leave clients stuck (high, gate violation).**
`sweep()` deletes rooms and returns the codes, but `index.ts` ignores the
return value. Sockets attached to a reaped room are never told, never
detached, and their `ConnState` still points at a dead code. Everything they
send afterwards returns `room_not_found` or `reason.notYourTurn` forever, with
no path out. Sweep must notify every attached socket (an `error` with a
`room_closed` code is enough), drop the `sockets` entry, and clear
`conn.code`/`conn.seat`.

**S2 — A game that loses a player never ends (high, gate violation).**
`leave_room` mid-game nulls the seat and broadcasts `room_state`; the
remaining player sits on a board that will never advance. The same happens
when a disconnect's grace window expires — the room is swept silently (S1).
Both paths need a terminal message to the survivor: either a `game_over`
attributed to the abandonment, or a `room_closed` error that returns them to
the lobby with a clear reason. "Opponent left, match ended" is a perfectly
good alpha outcome; silence is not.

**S3 — Idle timeout can reap a live lobby (medium).**
`lastActivityAt` only advances on join, ready and turns. Two connected players
sitting in a lobby for eleven minutes get their room deleted underneath them.
Reap on "all seats disconnected past grace" as the primary condition; treat
the absolute idle timeout as a backstop that only applies when nobody is
connected, or refresh activity on any inbound message from an attached socket.

**S4 — Reconnect can leave a zombie holding a seat (medium).**
`attachSocket` overwrites the seat's socket entry, but the *old* socket keeps
its `ConnState` with the same code and seat, so it can still submit turns for
that seat. On a successful reconnect the previous socket for that seat should
be explicitly closed and its `ConnState` cleared, so exactly one connection can
ever act for a seat.

**S5 — No resource ceilings (medium).**
Nothing caps the number of rooms, and nothing limits message rate per
connection. A single looping client can allocate rooms until the process dies.
An alpha needs only a hard `MAX_ROOMS` (reject `create_room` past it with a
clear error) and a crude per-connection message counter — not a real rate
limiter.

**S6 — Rehydration map is wider than it needs to be (low).**
`byId` is built from every hand, the whole table *and* the draw pile. Draw-pile
and opponent-hand ids are correctly rejected downstream by `canConfirmTurn`'s
`foreignCard` check, so this is safe today, but building the map from only the
committed table plus the active player's hand would make the rejection reason
precise (`unknownCard`) and remove the reliance on a downstream check.

**S7 — No socket liveness detection (low).**
`ping`/`pong` exist as client-driven messages, but the server never probes a
silent peer, so a half-open TCP connection holds a seat until the grace timer
happens to fire. Acceptable for an alpha; worth a line in the known issues.

**S8 — `processing` guard is unreachable (informational).**
The room manager is fully synchronous between check and mutation, so the
re-entrancy flag can never be observed as true. Keeping it as defensive code
is fine; it should carry a comment saying so, and double-submit protection
should be understood as coming from the revision check, not from this flag.

## Recommendation

S1, S2 and S3 are the weakest blockers in the phase right now and must be
fixed before the multiplayer verification run — they are exactly the failures
a two-client e2e will expose, and they are gate items ("no stuck online flow"),
not polish. S4 and S5 are cheap and should ride along. S6–S8 are documentation
or comment-level items.

---

# Opus review of the client online flow

*Reviewed: `src/scenes/GameScene.ts` online paths, `src/net/client.ts`,
`src/net/viewToState.ts`, `src/scenes/OnlineScene.ts`, `src/scenes/WinScene.ts`.*

## What is right

`localSeat` is threaded correctly and defaults to 0, so the offline renderer is
byte-identical. Read-only on the opponent's turn is enforced structurally — the
editor is null and `interactive` is false, so drag handlers are never wired,
which is the correct implementation rather than a guard inside a handler. The
online branch in `onTurnStart` returns *after* `renderAll`, so an observer does
see the opponent's committed move. FEITO and COMPRAR both go through
submit-and-wait with an in-flight flag and never mutate the store locally.
Rejections discard the draft and rebuild from the last synced state. `game_over`
is the only path to `WinScene` online, and `checkWinner` is never called
client-side. Stale `state_sync` (lower `rev`) is dropped.

## Findings

**C1 — Reconnect is server-side only; the client never retries (medium, affects
a phase deliverable).** `NetClient` will send `reconnect` with its stored token
*if something calls `connect()` again*, but nothing does: on `closed`/`error`
the match shows "connection lost" and returns to the menu after 2.5s. The
server's grace window, token issuance and `player_reconnected` broadcast are
therefore all dead code in practice, and a one-second network blip ends a match
that the server was perfectly willing to resume. The cheap fix is a single
bounded retry: on an unexpected close, attempt one reconnect after a short
delay, and fall back to the existing return-to-menu path if it fails. That
turns "documented safe fallback" into "basic reconnect with a documented
fallback", which is what the phase asks for, without a retry-loop state
machine.

**C2 — Join code entry uses `window.prompt()` (low, cosmetic).** A native
browser dialog over a pixel-art canvas is jarring and cannot be styled or
localized consistently. It is a defensible alpha shortcut (a pixel-font text
input is real work) but it must be listed honestly in the known issues, not
left to surprise a playtester.

**C3 — Opponent avatar is always the generic player icon online (low).**
Expected for an alpha with no accounts; worth one line in the release notes.

**C4 — `viewToState` placeholder cards are load-bearing (low, needs a test).**
Opponent hands and the draw pile become placeholder card objects so the
existing renderer works unchanged. This is a good trade, but it means a future
edit that reads opponent card *identities* from client state would silently get
fiction instead of an error. A unit test asserting the placeholders carry no
real card ids — and that `canConfirmTurn` against a `viewToState` result still
behaves — would lock the assumption down.
