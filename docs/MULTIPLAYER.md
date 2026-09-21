# Multiplayer (online alpha)

How online rooms work: server authority, the wire protocol, room lifecycle,
reconnect, and what the alpha does **not** do. The rules themselves are in
[GAME_RULES.md](GAME_RULES.md); the client/server split in
[ARCHITECTURE.md](ARCHITECTURE.md).

Scope: 2–4-player rooms, alpha quality — private by code or link, optionally
listed in a room browser, or formed for you by the casual matchmaking queue. No
accounts, ranking, chat, or cosmetics sync. The game labels the entry point
`ONLINE (ALPHA)`.

## 0. Limitations

- **No accounts, ranked play, chat or spectators.** Rooms are private by
  default and joined by invite link or 5-character code. A host may opt one room
  into a listed room browser (§3d), and Quick Match will form a table out of
  whoever is queued (§3e). There is no public directory, no rating, no skill
  matching, and no way to find a room whose host did not list it.
- **Matchmaking is casual only.** One FIFO queue, one compatibility dimension
  (how many players you want), server-defined casual terms, no backfill of a
  match in progress and no bots. See §3e for the policy and what it refuses to
  become.
- **Online rematch keeps the room *and* the room's score** — a finished match hands
  its room back to the lobby on the same code (`recycleForRematch`), with every seat
  kept and every ready bit cleared. Session wins, the match history and the activity
  feed survive; the deal, the clocks and the votes do not. See §3c.
- **No best-of / series mode.** Session win counters plus an explicit rematch vote
  cover what a room of friends actually asks for ("are we 2-1?", "again?"), and a
  series would add a second lifecycle — a series score to reset, a completion state
  that has to refuse an accidental extra match, and a join policy for a series in
  progress — on top of one that already works. Deferred deliberately, not forgotten.
- **No per-turn stats online** — the client never observes
  per-turn state locally, so there is no play log to summarize. The stats line
  is hidden rather than showing zeros. Fixing it needs a protocol change.
- **Opponent avatars are the generic player icon** — there are no accounts, so
  there is no avatar to show.
- **Abuse controls are budgets, not protection from a determined attacker** —
  message rate, failed joins and `resync` are budgeted per connection; sockets
  and room creation are budgeted per client address (and behind a proxy that
  address is only trustworthy once `MEXE_TRUSTED_PROXY_HOPS` says so). Enough to
  stop a looping client or a create-and-drop loop, not a connection farm. See §9.
- **A seat disconnected past the room's reconnect grace is played for you**:
  the server draws and ends that seat's turn so the match keeps moving. It never
  melds on your behalf. Losing `missedTurnLimit` turns in a row ends the match.
- **The turn timer has five lobby presets** (Casual / Fast / Blitz / Time Attack / Off), one tap
  apart, plus a host-only CUSTOM screen behind them for a room that wants its
  own numbers. The custom screen's buttons stop at `CUSTOM_BOUNDS`, the same
  bounds the server clamps to, and send one proposal on APPLY rather than one
  per field.
- **Reconnect is a bounded retry loop**, not a persistent one: seven jittered
  attempts spanning roughly the 60s seat-hold window of the presets, then the
  client returns you to the local menu with a message. It never retries forever.
  A room on a longer custom grace (up to 300s, §7b) outlives the loop; the seat is
  not lost with it, because exhausting the attempts does not drop the token —
  only `invalid_token` or `room_closed` does — so re-entering the online screen
  still reclaims the seat while the room holds it.

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

**Where the client's half lives.** The presentation layer does not decide any of
it:

```
presentation        GameScene (match) / OnlineScene (lobby): Phaser, input, notices
   ↓ intents
online application  OnlineSession (per match) · LobbyMachine (lobby screen)
   ↓ messages
transport/protocol  NetClient over src/net/protocol
   ↓
server authority    server/rooms.ts
```

`OnlineSession` (`src/net/online-session.ts`) owns the projection of a server
frame and every policy over it: is this revision stale, does the local
reconstruction still hash to the server's digest, did this frame drop a draft,
was the Mexe bonus just granted, which dense index a room seat maps to, and
whether a `turn_timeout` is the one that ends the match. `LobbyMachine`
(`src/net/lobby.ts`) owns which screen is showing and what each server refusal
costs. Both are Phaser-free and clock-free and are driven directly by
`tests/online-session.test.ts` and `tests/lobby.test.ts`.

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
3. **ready/start** — each occupied seat toggles ready. A host settings change
   clears every ready bit (`setRoomSettings` returns `changed`), because a ready
   bit is agreement to the terms that were on screen when it was pressed; an
   idempotent re-send of the same settings changes nothing. Seat 0 sends
   `start_game`; server requires 2–4 occupied ready seats, picks seed, deals,
   sets `rev = 1`, and broadcasts per-seat `game_started` views.
4. **playing** — alternating turns; every accepted action increments `rev`.
5. **game_over** — server broadcasts winner (or stalemate result), then
   *recycles* the room instead of destroying it: match state, revision, clocks,
   missed-turn streaks and every ready bit are cleared, seats and host authority
   stay, and a fresh `room_state` goes out with `locked: false`. Clients render
   the result from the `game_over` payload and can rematch on the same code. The
   winner's session win, the match's history entry and the closing feed line are
   recorded once, when the match finishes, not when it is broadcast (§3c). An
   abandoned recycled room is reaped by the normal sweep like any other.
6. **empty/abandoned** — room is destroyed when both sockets are gone past the
   grace window, or after an absolute idle timeout.

Orthogonal to all of it: **visibility** (§3d), which decides who can *find* a
room and never who may join one. Lifecycle, capacity and seat ownership are the
only things that decide a join, for a discovered room exactly as for a typed
code.

## 3b. Identity, names and invite links

There are no accounts. Three things carry identity, and only one of them is
trusted:

- **`sessionToken`** — issued per seat at join, stored in `sessionStorage`, and
  the *only* thing that proves seat ownership. Reconnect and seat reclaim check
  it and nothing else.
- **seat index** — stable and clockwise for the life of the room; it never moves
  once assigned, so turn order and the socket map stay in step.
- **display name** — cosmetic. Stored in `localStorage` (`mexe.online.name`) so
  it survives a reload, sanitized client-side to letters/digits/spaces, 2–12
  visible characters (`MIN_NAME_LENGTH`/`MAX_NAME_LENGTH`), trimmed again
  server-side with a `Player N` fallback. **Duplicate names are allowed and are
  never disambiguated with a suffix** — the seat colour, the seat row, and the
  spelled-out `YOU`/`HOST` badges are what tell two Anas apart. A name never
  authenticates, authorizes, or reclaims anything.

**Invite links** are `<current url>?room=CODE` and carry nothing else: no
session token, no player id, no state. `OnlineScene` reads `?room=` on entry,
sanitizes it to the code alphabet, and sends an ordinary `join_room` once the
socket opens — the server validates it exactly as it does a typed code. Sharing
uses the Web Share API where the browser has one, with clipboard copy as the
universal fallback.

**Recent rooms** are local display history: `mexe.online.recent` in
`localStorage`, at most `MAX_RECENT_ROOMS` entries of `{ code, host, at }`, aged
out after six hours and read back through a validating parser (a corrupt or
tampered entry is dropped, never repaired). They are what the online home's
CONTINUE and RECENT shortcuts are built from. Deliberately a different key, a
different storage area and a different shape from the session token: this list
is meant to be shown, and nothing in it can reclaim a seat. An entry is dropped
the moment the server answers `room_not_found`/`room_closed` for it.

## 3f. Seats and player indices

Two numbering schemes meet here, and they are equal only by accident.

- A **room seat** (0–3) is a chair. It is assigned at join, never moves, and survives its
  occupant leaving — reconnect, host authority, the session score and the lobby's own rows are
  all keyed on it.
- A **player index** is a position in `GameState.players`, which is dense and turn-ordered
  because the rules engine advances a turn by rotating an index.

They coincide only when the occupied seats happen to be 0..n-1. A lobby that lost a middle seat
between matches (seats 0, 2 and 3 after seat 1 walked out) has three players and four chairs, and
the two schemes diverge. `RoomInternal.matchSeats` is the one place they are related: the room
seat of each player index, frozen at `startGame` and cleared on recycle. Every seat-taking entry
point in the room manager translates through it, and it rides the wire as `GameView.seats` so a
client can do the same for the room seats that arrive on `turn_timeout`, `player_disconnected`,
`player_reconnected` and `winningMove`. On the client that translation is
`OnlineSession.playerIndexOf`, re-read from every frame — one place, not one per handler.

Everything else inside a `GameView` — `seat`, `activeSeat`, `players[].seat`, `missedTurns` — is
a player index, the state hash included, so both sides digest the same numbers.

Before this existed the equality was assumed and a gap was refused outright: `startGame` answered
`seat_gap`, so a four-player table that lost one player between matches could never play again
until somebody filled the empty chair. That refusal is gone, along with the `seat_gap` error
code, and seats still never compact.

## 3d. Room visibility and discovery

Every room is born `private` and there is no create-time option that says
otherwise. `private` means reachable by invite link or code and invisible to
everything else. A host may set `listed`, which adds the room to the room
browser and changes nothing else.

Visibility is server-owned. `set_room_visibility` is **host-only and
lobby-only** (refused with `not_host` / `game_started`), and the answer is an
authoritative `room_state` broadcast, never an echo of the request. Unlike a
settings change it does **not** clear ready bits: visibility is not one of the
terms a seat agreed to play under, so ON-09's re-agreement rule does not apply.

Discovery reads through a separate, tiny projection — `RoomListing` in
`protocol.ts`: `code`, `hostName`, `players`, `capacity`, `status`,
`timerMode`. Not a trimmed room snapshot, a different type, so there is no
token, seat, revision, hand count, activity feed or party history to leak by
accident. Eligibility is recomputed from the live rooms on every `list_rooms`
— there is no listing index to go stale, which is why a room that expires, goes
private or starts a match disappears immediately:

- `private` rooms: never listed.
- rooms with a match in progress: omitted, not shown as non-joinable. They
  cannot seat anyone until the match ends, and a card offering a seat that does
  not exist is worse than no card. (A room recycled back to a lobby between
  matches becomes listable again, and can accept a newcomer under §3c's rules.)
- full lobbies: listed, marked `full`, with the join action disabled — "it just
  filled up" is more useful as a fact on screen than as a rejection after a tap.

Answers are bounded at `MAX_ROOM_LISTINGS` (20) and the per-connection budget is
`hitListLimit` (12 per 10s, refused rather than answered — building the answer
is the expensive half). The room code is published in a listing on purpose: it
is a locator, not a credential, and what makes that safe is the existing
guess-rate protection (§9), not its obscurity.

A card is a snapshot of a moment, so a room that changed since the answer was
built is ordinary traffic, not an error. When the server refuses a tapped card
(`room_not_found`, `room_closed`, `room_full`, `game_started`) the browser keeps
the screen, drops that one card and says why in a sentence — "essa sala não está
mais disponível" for a room that is gone, the room's own copy for one that filled
or started. The full-screen error phase is reserved for refusals that are about
the player rather than about a card, because throwing away the list would cost
them every other room over one that moved on. ATUALIZAR is the fix, and it is
the button the notice sits above.

Discovery is **additive**. If listing fails or is refused, the room browser says
so on its own screen and creating a room, joining by code and joining by link
keep working — none of them consults discovery at all.

Every screen in `OnlineScene` is keyboard-operable: Tab/Shift+Tab and the up/down
arrows walk a gold focus ring through the screen's buttons in reading order, and
Enter/Space presses the one it is on (`PixelButton.press()` re-emits `pointerup`,
so a keyboard press gets the same sound, the same animation and the same
`onBlocked` refusal a click does). The ring appears only once the keyboard is
used, is skipped on the code and name screens where Enter already means
"submit", and starts at the top button of each new screen. Disabled buttons stay
focusable on purpose — their refusal is the explanation the player is after.

A redraw moves the ring with its *button*, not with its slot: the browser's list arriving pushes
room cards in above ATUALIZAR, and a ring that kept index 0 through that would hand the next Enter
to whichever card moved into the slot the player was actually pointing at. `collectFocusables`
restores the ring by label, and only a genuinely new screen sends it back to the top button.

## 3e. Casual matchmaking (Quick Match)

Quick Match chooses *who plays together*. It is not a second game authority: the
moment a group is formed the queue hands it to `createMatchRoom` and everything
from §3 onward — seats, turn order, the clock, reconnect, missed turns, the
rematch lobby — is the room lifecycle that already existed.

**Identity.** A queue entry is keyed by a server-issued session token, exactly
like a seat, and it is the *same* token the seat is later created with. That one
decision is why matchmaking needs no recovery path of its own: `reconnect(token)`
finds a seat if the match was committed and the queue entry if it was not, and a
player can therefore never be put back in the queue after being seated, or
duplicated into a second entry by a reload. Nothing is keyed by display name,
socket or IP.

**One player, one entry.** A duplicate `join_queue` is answered with the entry
the session already has (never a second one), and a session already holding a
seat is refused with `already_in_match`. The rule holds from the other side too:
a session that is searching and then creates or joins a room by code leaves the
queue at that moment and is told so with `queue_state: idle` — the seat it
actually took wins over the one it was hoping for, the same precedence
`reconnect` applies. Without that, the next group would form *around* a session
already sitting somewhere else, leaving the room it left behind holding a seat
marked connected with no transport on it. Exactly one connection speaks for an
entry: a second tab that reconnects with the token takes it over and the old
socket's authority is cleared, so a stale transport cannot cancel a search that
has moved on.

**Preferences.** One dimension, four values: `2`, `3`, `4`, or `any` (the
default). Skill, region, language and device are not representable on the wire,
so none of them can quietly become a matching dimension.

**The policy**, in full, run event-driven on every join rather than on a poll:

1. For each explicit size 2, then 3, then 4: while at least one waiting entry
   *asks* for that size and enough compatible entries exist (that size plus
   `any`), take the N oldest of them.
2. Then, from the `any` entries left over: while two or more remain, seat
   everyone waiting up to the capacity of four.

Oldest-first throughout, no scoring, and never a group larger than a table.
`any` means "play now": it never waits for a bigger table, and it never delays a
match that could already start.

**Allocation is one operation.** `takeGroups` removes a group from the queue as
it forms it, so two passes cannot select the same entry; `createMatchRoom` then
builds the room, seats every player with the token they queued with, freezes the
canonical casual settings and deals the match — or deletes the half-built room
and reports failure, in which case the group goes back into the queue in its
original wait order and is told it is still searching. Nobody is dropped
silently.

**Matchmade rooms are not negotiable rooms.** Their terms are `TIMER_PRESETS.casual`,
chosen by the server; `room.matchmade` refuses `set_room_settings` and
`set_room_visibility` from every seat, host included, so a table of strangers has
no fairness lever to pull on each other and can never be pushed into the room
browser. There is no ready step either — being matched *is* the agreement, and
the deal happens at allocation.

**Missing players.** A player whose socket dropped between queueing and being
matched is still seated, marked absent, and the room's ordinary reconnect grace
and missed-turn policy decide what happens next. Deliberately the same policy a
mid-match drop gets: matchmaking does not get a second abandonment system, and
there is no backfill of a match in progress.

**Bounds.** The queue is capped (`MAX_QUEUE_ENTRIES`, 200 — over it, joins are
refused with `queue_busy`), entries expire after `QUEUE_TIMEOUT_MS` (2 minutes)
and are swept by the existing interval, and join/cancel share one per-connection
budget (`hitQueueLimit`) so a join/cancel loop cannot make the matcher run flat
out.

**What a client is told.** `queue_state` carries the caller's own status, their
preference, their token while queued, and the table size on `matched` — and
nothing else. No queue size, no position, no ETA and no roster: the queue is not
a lobby, and another waiting stranger is not the caller's business until a room
exists. The searching screen shows a cosmetic elapsed counter for the same
reason it shows no estimate — there is no data behind an estimate, and an honest
sentence beats an invented number.

## 3c. The party session

A room outlives its matches. What survives a rematch, and what does not:

| Survives | Reset per match |
|---|---|
| room code, `roomId`, seats, session tokens | `matchId`, deck, hands, table, turn |
| display names, host authority | clock state, Mexe bonus, missed-turn streaks |
| session wins (`Seat.wins`) | ready/rematch votes |
| match history, activity feed | winning-move summary |

**Session wins.** One per finished match, awarded by `recordResult` to the seat
holding the winning player id. `RoomInternal.resultRecorded` is the whole
duplicate guard: a second `game_over` broadcast, a retried tick or a caller that
recycles twice all find it already set and change nothing. A win lives on the
*seat object*, so it leaves with the chair — a newcomer who takes a vacated seat
gets a brand-new `Seat` (see `newSeat`) with zero wins, no ready bit and no
reaction cooldown, never the departed player's. Room-session only: nothing here
is persisted, and there is no account to persist it to.

**The rematch vote is the ready bit.** There is no second flag. In a lobby a
ready bit means "I agree to these terms and this start"; in the lobby a finished
match recycled into, the same bit means "I want to play again" — the same
agreement, a different sentence, and the client renders it as `QUER REVANCHE`
once the room has a history. Consequences fall out rather than being coded
twice: one player cannot force a rematch (`startGame` still requires every
occupied seat ready), the votes are visible to the whole room (they ride
`room_state`), a departing player's vote retires with their seat, and no stale
vote can reach the next match (`startGame` clears every bit the moment the deal
it agreed to is made).

**Joining between matches.** A recycled room is an ordinary lobby
(`state === null`), so `join_room` works on it unchanged and a mid-match join is
still refused with `game_started`. The newcomer takes the lowest free seat.

**Match history** (`MAX_MATCH_HISTORY`, 10) is public summary only: match id,
sequence number, winning seat and name, whether it ended on the tiebreak, and
duration in seconds. No hands, no seed, no revision. Oldest entries are dropped,
so it does not grow with a long evening.

**The activity feed** (`MAX_ACTIVITY`, 25) is structured, never prose: the server
sends `{ seq, kind, seat?, name?, reaction? }` and the client localizes it. That
is what stops a client from authoring a feed line and stops a translation from
coming off the wire. The kinds are closed (`ACTIVITY_KINDS`): joined, left,
ready, settings, match_started, last_card, won, stalemate, reaction. Privacy is a
property of the *shape* — a card id, a token or a connection detail is not
representable in an `ActivityEvent` at all, so it cannot leak by a call site
forgetting to be careful. Per-turn play is deliberately not in the feed: the
in-match "Ana drew 1" line (`GameScene.noteOpponentMove`) already says it, live
and in public terms, and putting it here would push every room-level event out of
a 25-slot buffer within one match.

`last_card` fires on the *transition* into a one-card hand, once — a seat sitting
on one card does not re-announce every turn. Hand counts are already public in
every `GameView`, so this discloses nothing new; it makes the most consequential
count in the game impossible to miss. The in-match HUD carries the same fact as
size, wording and an icon, never colour alone.

**Reactions** stay exactly what §9's threat model allows: a fixed preset list
(`REACTIONS` — `nice`, `gg`, `oops`, `wow`), validated at the wire boundary, relayed as the server's own value,
room-scoped, and gated by a per-seat cooldown (`REACTION_COOLDOWN_MS`) enforced
server-side. A relayed reaction also appends to the feed, which is why the relay
is followed by one `room_state` — bounded by the same cooldown, so it needs no
budget of its own. A reaction never touches `rev`, the hash, the turn or a hand.

Party state rides the lobby payloads (`room_joined`, `room_state`), never the
per-turn `state_sync`: it changes at room granularity, and a match does not need
it. `NetClient.lastRoomState` latches the most recent one, because the
`room_state` carrying a new session score is broadcast in the same server tick as
`game_over` — a frame before `WinScene` exists.

## 4. Protocol

JSON text frames. Every message: `{ v, type, ... }` where `v` is the protocol
version (`PROTOCOL_VERSION = 12` — bumped from 11 for Freeze and Time Debt: `RoomSettings` gained
`freezeMs`/`freezeUses`/`maxDebtMs`, `GameView` gained `freezeLeft`/`debtMs`, and the client
gained `use_freeze`; v11 bumped from 10 for Speed assistance: `RoomSettings` gained
`panicMs`/`panicUses`/`lastBreathMs`, `GameView` gained `panicLeft`, and the client gained
`use_panic`, without which a room's Panic Button is unpressable; v10 bumped from 9 for MexeMexe Time Attack: `RoomSettings` gained
`startClockMs`/`incrementMs` and `GameView` gained `clocksMs`, the per-seat personal clocks,
without which a v9 client renders a Time Attack room as an untimed one; v9 bumped from 8 for the seat/player split: `GameView` gained
`seats`, the room seat of each player by turn-order index, without which a client cannot read a
room that is playing with a seat gap (§3f); v8 bumped from 7 for the casual matchmaking queue:
the client gained `join_queue`/`cancel_queue` and the server gained `queue_state`,
so a v7 client cannot queue at all and must not be left believing it can; v7 bumped
from 6 for the public-room reaction set:
`hurry` left `REACTIONS` and `gg` took its place, so a v6 client's reaction id is
no longer one this server relays; v6 bumped from 5 for room visibility and discovery:
`room_joined`/`room_state` gained `visibility`, and the client gained
`set_room_visibility` and `list_rooms` with a new `room_list` answer; v5 bumped from 4 for the party session: `GameView`
gained `matchId`, `RoomPlayerSummary` gained `wins`, and `room_joined`/`room_state`
gained `party` (match history + activity feed); v4 bumped from 3 for room settings and the
server turn timer: `GameView` gained `settings` and `turnMsLeft`, `room_joined`
and `room_state` gained `settings`/`hostSeat`, and the client gained
`set_room_settings` and `mexe_started`; v3 bumped from 2 in 1.2.0, when
`GameView` gained a `hash` digest and the client gained `resync`; v2 bumped from 1 for the rules
adaptation, when `GameView` gained `config` and card ids changed shape with the
two-deck/joker model); a mismatch is refused at the wire boundary rather than producing subtle
desyncs: the version is the first thing `parseClientMessage` checks, so the
refusal lands on the client's first frame, before any room state exists. It is
the one parse failure that carries its own error code (`unsupported_version`,
"reload the page to update") instead of the generic `bad_message` — a stale
service-worker cache is the realistic way a player ends up on the wrong
version, and that player needs an instruction, not an apology. Compatibility
across versions is deliberately none, in both directions: see the compatibility
policy in [ARCHITECTURE.md](ARCHITECTURE.md#compatibility-policy). Client-to-server messages carry a client-chosen
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
| `start_game` | — | host seat only; requires every occupied 2–4P seat ready and connected. A gap between occupied seats is dealt, not refused (§3f) |
| `submit_turn` | `rev`, `melds: [{ id, cardIds[] }]` | card **ids only** |
| `draw_end_turn` | `rev` | |
| `reconnect` | `token` | resumes a seat in a live room |
| `set_room_visibility` | `visibility: 'private' \| 'listed'` | host only, lobby only; answered with an authoritative `room_state`, never an echo. Does not clear ready bits (§3d) |
| `list_rooms` | — | no filters are representable on the wire; the answer is bounded and rate-limited (§3d) |
| `join_queue` | `target: 2 \| 3 \| 4 \| 'any'`, `name` | casual queue (§3e); idempotent per session, refused with `already_in_match` for a seated player and `queue_busy` at capacity |
| `cancel_queue` | — | idempotent; answered with authoritative queue state, so a cancel that raced a formed match is told `matched` |
| `reaction` | `reaction: ReactionId` | one of the four closed `REACTIONS` ids (§3c); anything else is dropped at the parser, and a seat inside `REACTION_COOLDOWN_MS` is dropped by the server |
| `resync` | — | "resend authoritative state"; never carries client state |
| `ping` | — | |

**Server → client**

| type | payload | notes |
|---|---|---|
| `room_joined` | `code`, `seat`, `token`, `players`, `settings`, `hostSeat`, `party`, `visibility` | token is the reconnect key; `players[].wins` is the session score; `visibility` is always `private` for a new room |
| `room_state` | `players` (each entry carries its own `ready`/`connected`/`wins`), `settings`, `hostSeat`, `locked`, `party`, `visibility` | lobby updates; `locked` is true once the match started and the settings are frozen. `ready` doubles as the rematch vote between matches (§3c). `visibility` is server-owned (§3d) |
| `game_started` | `view` | broadcast per seat after host `start_game`; the server never sends shuffle seed, and `rev` lives inside `view.rev` |
| `state_sync` | `view` (redacted, `rev` and `hash` inside it) | the only source of truth on the client; `view.seats` maps its player indices back to room seats (§3f) |
| `proposal_rejected` | `reqId`, `reasons: ReasonCode[]` | codes, not prose |
| `turn_timeout` | `seat` | the server ended that seat's turn (clock expired, or absent past the reconnect grace); the authoritative result already arrived as a `state_sync` |
| `player_disconnected` | `seat` | opponent notice |
| `player_reconnected` | `seat` | |
| `game_over` | `winnerId`, `stalemate`, `view` | `view` carries the final redacted state so both clients render the same closing board |
| `error` | `code`, `message`, `reqId?` | protocol-level problems; a refusal about the room's own state (`not_ready`, `not_host`, `game_started`, `room_full`, `rate_limited`) is answered on the lobby itself rather than replacing it with an error screen — the caller is still seated and every other control still works; `reqId` echoes the request that failed, absent for server-initiated errors including `room_closed` (S1/S2: a reaped or abandoned room notifies every attached socket before dropping it) |
| `queue_state` | `status`, `target`, `token?`, `players?` | the caller's own queue state and nothing else (§3e): `token` only while `queued`, `players` only on `matched`. Never a queue size, a position or another waiting player |
| `room_list` | `reqId`, `rooms: RoomListing[]` | the discovery projection only (§3d): `code`, `hostName`, `players`, `capacity`, `status`, `timerMode`. Never a room snapshot, never a room the caller has not joined |
| `player_reaction` | `seat`, `reaction: ReactionId` | relay of another seat's reaction (§3c). The id is the server's validated value, never the sender's payload echoed back, and the relay touches no `rev`, hash, turn or hand |
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

### 5a. The server-to-client direction

The server is trusted, but the wire is still a boundary, so the view a client
receives is checked before it becomes local state. `viewProjectionProblem`
(`src/net/viewToState.ts`) answers one question — can `activeSeat` be resolved
to a player in this view? — and `viewToState` refuses to project a view that
fails it rather than producing a `GameState` whose active player is
`undefined`. Every reader of `players[activePlayerIndex]` asserts that player
exists, so such a state is one no part of the game can represent.

This check exists because it is the one inconsistency the state digest cannot
see: `digestOfView` hashes `view.activeSeat` and `digestOfState` hashes the
`activePlayerIndex` copied straight out of it, so a seat pointing at no player
agrees with itself and passes §4a's desync comparison. Everything else a
malformed frame can get wrong — hand counts, the draw count, the table — is
re-derived on one side and taken from the view on the other, so the digest
already catches it. The check is deliberately not a schema validator for the
whole frame; a second one would be duplicated validation with no second
failure it can find.

It is not an anti-cheat measure and is not framed as one (§9): a hostile server
already decides the entire match. It protects against server regressions,
protocol changes landing on one side only, malformed fixtures and replay/debug
tooling.

## 6. Client reconciliation

The client keeps its rendered state derived from the last `state_sync` only.
On FEITO it snapshots the draft, sends `submit_turn`, and enters a *pending*
state: input disabled, submit button locked, so double-submit is impossible at
the UI layer as well as the server layer. On `state_sync` it discards the draft
and re-renders from the server view. On `proposal_rejected` it shows the
localized reason and restores the last synced state — never a half-applied
draft. A `state_sync` with a `rev` lower than the one already rendered is
ignored (late/out-of-order delivery).

The two ends compare revisions differently, on purpose. The server rejects a
*proposal* whose `rev` is not exactly the room's current one (`reason.staleRevision`):
a turn computed against any other board is a turn about a board that no longer
exists. The client only ignores a *frame* strictly older than the one it has
(`view.rev < lastRev`): an equal-`rev` frame is the same authoritative board
restated — a duplicate delivery or the answer to a `resync` — so applying it
again is idempotent and safer than second-guessing which copy was the real one.

A refusal is correlated the same way, one layer lower: `NetClient` remembers the
`reqId` of the proposal still in flight, clears it when any authoritative frame
arrives (`state_sync`, `game_started`, `game_over`) and drops a
`proposal_rejected` carrying any other `reqId`. A refusal that lands after the
board was already replaced answers nothing — delivering it would sound the error
over a correct board and rebuild the editor under a draft the player has since
started. Correlation lives in the transport because that is where the `reqId`
ledger is; the scene still handles every refusal it is given.

That comparison is only sound inside one match, because `rev` restarts at 1 on
every deal. So the client checks match identity first: a `state_sync` whose
`view.matchId` is not the session's is answered `invalid` — nothing applied,
`lastRev` untouched — rather than being ordered against a revision counter that
belongs to a different board. No delivery path is known to produce such a frame
(one socket per client, ordered; the server never re-sends a finished match's
frames, and it refuses to start the next match while a seat is disconnected),
so this refuses the frame rather than trying to repair anything.

All of those decisions are `OnlineSession.applySync`, which answers one of four
things — `stale` (ignored), `invalid` (the frame failed §5a's projection check;
**nothing was applied**, so the last good state and `lastRev` both stand),
`desync` (applied, but the local reconstruction does not hash to the server's
digest) or `applied` (with the acting seat, whether a draft was dropped, any
Mexe bonus granted and the remaining turn time). The scene turns that answer into
notices and a repaint, and anchors `turnMsLeft` to its own clock; it decides
none of it.

`invalid` and `desync` get the same remedy — lock input, show the resyncing
notice, send `resync` — for different causes: a frame that cannot be
represented at all, versus two honest peers that have diverged. The difference
matters on the `invalid` path, where the scene must not read a clock or a seat
off the frame it just rejected.

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
that window; once a room is swept,
its token stops working because the room itself is gone, not because the
token was individually invalidated. A reconnect that lands before the sweep
runs succeeds even if it arrives after the nominal 30s, and reconnecting
while the opponent is still connected and the game is mid-match works too —
`reconnect` doesn't require anyone else to be disconnected. On a successful
reconnect the server also evicts whatever socket previously held that seat
(S4: exactly one connection can act for a seat at a time), attaches the new
socket, and replies with `state_sync` if a game is in progress or
`room_joined` if the room is still in its lobby; the opponent gets
`player_reconnected`. The evicted socket is told `error: invalid_token` *before* it is closed:
its client still holds the same token, and an ordinary close would start its bounded reconnect
loop, so two tabs of one session would take the seat off each other in turn and flap it between
connected and disconnected for the whole room. `invalid_token` is one of the two codes the client
treats as definitive (§7's list), so it drops the token and stops instead. After a room is swept,
any socket still attached to it receives an `error` with `code: 'room_closed'` and must return to
the lobby.

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

A reconnect never moves the game. It re-sends authoritative state and nothing
else: the returning seat gets the same redacted view every other seat is looking
at (own hand identities, opponents as counts), the current turn and revision,
the room's settings, and the clock's *current* remaining time. An inactive seat
reconnecting leaves the turn where it was; a seat that reconnects after the turn
moved on receives the new turn, not the one it left. A reconnect into a lobby —
including the lobby a finished match was recycled into — returns `room_joined`
with no view at all, so no stale playing state can survive a rematch. Pinned in
`tests/server/reconnect.test.ts` (OR-01/02/06/07/08/09/16/25/26/27/28/29, at 2,
3 and 4 seats).

**A drop over the finish.** A seat can be disconnected at the moment the match
ends — the server draws and passes for it, the other seat's play finishes the
game, and the `game_over` broadcast goes out while that socket is down. Its
reconnect is therefore answered with a room, not a match, and no `game_over` is
ever re-sent. The client decides what that means in `OnlineSession.roomState`:
an unlocked room (`locked: false`, i.e. no match running) that this session
never saw finish is the finish it missed, so `GameScene` says so and hands back
to the lobby the room recycled into, on the live socket. Without that path the
board the drop froze stays on screen as if it were live, and the seat can never
cast the ready bit the room's next match needs — it is stuck in the match scene.
Reported once per session, because the reconnect answer broadcasts room state
more than once. Covered by LB-47 (`e2e-multiplayer/lobby.spec.ts`) end to end and
by `tests/online-session.test.ts` for the policy.

Seat presence changes — a disconnect, a reconnect, a hop — always re-broadcast
`room_state` alongside the `player_disconnected`/`player_reconnected` event,
because the lobby renders presence from `room_state` and would otherwise keep
showing a stale marker.

On the client, reconnect is a **bounded** retry loop, never a persistent one.
After an unexpected close with a stored token, `NetClient` works through
`RECONNECT_DELAYS_MS` — `800, 2000, 4000, 8000, 12000, 16000, 20000` ms, each
jittered upward by up to 25% so a server blip does not bring every client back
on the same millisecond. That spans ~63s, which is the longest reconnect grace
any preset offers, so the schedule runs out at about the moment the seat stops
being worth holding. Then the client falls back to the documented safe path —
return to the local menu with an explicit message. A successful open resets the
budget, so a later drop gets the whole schedule again.

Three things cut the loop short rather than letting it run out:

- **`leaveRoom()`/`disconnect()`** — a deliberate exit is never retried.
- **`invalid_token` or `room_closed`** — the session or the room is provably
  gone, so further attempts could only arrive at the same error screen.
- **the browser reporting no network** (`navigator.onLine === false`) — the loop
  *parks* rather than spending an attempt on a guaranteed failure, and the
  `online` event resumes it immediately. This is the Wi-Fi-to-cellular path: the
  socket usually dies with no event the page can act on, and `online` is the
  earliest reliable signal that a retry can succeed.

`NetClient.retryNow()` pulls the next attempt forward without waiting out the
current delay, for the two moments that are better evidence than a timer: the
`online` event above, and the app returning to the foreground (both scenes call
it from `onAppVisible` when the status is already `'reconnecting'`). It still
spends an attempt, so a player who backgrounds and resumes twenty times cannot
turn a bounded loop into an unbounded one, and it opens no socket beside the one
the loop already owns.

While the socket is down `GameScene` shows one line, repainted once a second:
*"Conexão caiu. Seu lugar está guardado — 30s"*. The number counts down the
room's `reconnectGraceMs` from the drop. It is an estimate the client
interpolates, not an authority — the server owns the real deadline, and the
countdown reaching zero decides nothing. Past zero the copy switches to *"Ainda
reconectando. O servidor compra por você."*, which is literally what §7b's
stalled-turn path does. The same gate that locks input on a dropped socket also
blanks the "play cards or draw one" objective line, so the board never tells a
player to act while it is refusing input.

Verified in `e2e-multiplayer/multiplayer.spec.ts` (a forced socket drop reaches
`'reconnecting'` then `'open'` with a resynced revision, and the same drop on a
portrait and a landscape phone renders the held-seat copy with its countdown),
and in `tests/net/reconnect.test.ts`, which drives the loop against a fake
socket and fake timers: bounded attempt count, one socket per attempt, offline
parking, `online` resumption, deliberate-leave cancellation and the two
definitive-failure cases.

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
| Blitz | 7s | — | 4s | 30s | 3 |
| Time Attack | personal clock | — | 15s | 30s | 1 |

Both Speed presets also carry assistance: Blitz +4s panic once and a 2s Last
Breath, Time Attack +6s once and 3s. A named preset ignores every other field a
payload carries **except** an explicit zero for either assist — Panic and Last
Breath are always individually disableable, and allowing only the off switch
means a payload can weaken a room's terms but never lengthen a turn or buy a
second press. `use_panic` spends one; the server refuses it for a non-active
seat, a spent budget or a room that grants none, and answers nothing either way
(the next `state_sync` carries the authoritative clock). Last Breath is granted
by the server's own tick at expiry, once per turn, to a connected seat only.

**Time Attack** is the second Speed Mode: there is no per-turn allowance at all
(`turnMs: 0`). Each seat is dealt a personal clock (`startClockMs`, 60s) that
persists across turns, is charged the authoritative time each of its turns
actually took, and earns `incrementMs` (3s) for taking it — `spendClock` in
`src/game-state/timing.ts`, floored at zero, with a flagged clock earning
nothing. A clock that reaches zero ends the match for that seat, which is why
the preset's `missedTurnLimit` is 1: a seat with no clock left has already lost.
The clocks ride on every view as `clocksMs` (per player index, empty in other
modes), so a reconnecting client is told them rather than reconstructing them,
and a rematch deals fresh ones with the match. `custom` never carries personal
clocks: they are the Time Attack preset's, so "which mode is this?" has one
answer.

**Ruleset availability.** One queue, one set of terms: the casual matchmaking
queue stays on `TIMER_PRESETS.casual` and is never widened to a Speed preset —
fragmenting a small queue by ruleset is how a queue stops matching anyone. Speed
rooms are **private/custom only**: a host picks Blitz or Time Attack in their own
lobby, and the experimental corners (Freeze, Time Debt, a non-default difficulty)
live in the CUSTOM screen behind them. There is no ranked ladder to keep stable
yet; when there is, it takes the named presets and not `custom`.

The lobby summary states a Speed room's own terms — personal clock, increment
and which assists it grants. Perfect Rhythm and Adrenaline are deliberately not
listed: they are native to every timed mode, and showing them among the
modifiers would read as if they could be switched off.

**Blitz** is the first Speed Mode (`docs/specs/speed-modes-timing.md`): the same
game with fixed per-turn pressure, not a different rule set. It grants no Mexe
bonus — a one-off extension worth three turns is not a bonus — and it allows one
more missed turn than the slower presets, because at 7s a single lapse of
attention is a normal event rather than a sign that a seat walked away. A
`custom` room may match its speed and go no faster: `CUSTOM_BOUNDS.turnMs`
floors at 5s.

A brand-new room starts on Casual, except that its reconnect grace comes from
the deployment's `MEXE_DISCONNECT_GRACE_MS` until a preset is picked.

**Who owns them.** The host proposes, in the lobby only — one tap on the summary
line cycles Casual/Fast/Blitz/Time Attack/Off, and the CUSTOM link opens a five-row screen
(`OnlineScene.renderCustom`) whose −/+ buttons go dead at `CUSTOM_BOUNDS`, so
the host never proposes a number the server would silently clamp. APPLY sends
one `set_room_settings`; a per-field send would clear everyone's ready bit five
times for one decision. The server
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
actually takes resets it to zero. A timeout that *finishes* the match — the draw
it plays was the one that emptied the pile — is a finish and nothing else, even
when the same miss crosses `missedTurnLimit`: the limit exists to stop a
walked-away seat holding the others on a board that only ever advances by draw,
and a board that just ended is not that board. Closing the room there would
replace a result screen with "a player missed too many turns" and throw away the
rematch lobby the match had already earned
(`tests/server/timer.test.ts`, "reports the finish, not a closed room").

**When there is no clock.** `startTurnClock` refuses to start one for an untimed
room *and* for a match that just finished, so a finished game reports
`turnMsLeft: null` rather than counting down to a red 0:00 behind the results
screen. A rematch (`recycleForRematch`) clears the clock, the bonus flag and
every missed-turn streak, so the next match starts on a fresh budget.

**The Mexe bonus.** Opening the Mexe editor sends `mexe_started`. The server
grants `mexeBonusMs` once per turn, to the active seat only, and only while a
clock is running — so re-opening the editor cannot hold a turn open. A
reconnecting seat is sent the *current* remaining time, never a fresh budget,
which is what stops a reconnect loop from extending a turn indefinitely.

`turnMsLeft` is deliberately outside the state digest: a ticking clock is not a
divergence, and hashing it would make every second look like a desync.

## 8. Error handling

Error **codes** are the contract, not error text. `SERVER_ERROR_CODES` in
`src/net/protocol.ts` is the single list both runtimes use: `sendError` takes
that union, so the server cannot emit a code the client has no copy for, and
`src/net/errors.ts` maps each entry to a translated sentence (its test walks
the list, so a new code without copy fails the test rather than shipping raw
English). `ErrorMsg.message` is developer detail for the trace and the log —
`OnlineScene` never reads it, and an unknown code falls back to generic copy
rather than being shown raw. The same rule applies to connection failures: the
client publishes a `ConnStatus` plus a stable `ConnReason` (`unreachable`,
`socket_failed`), never a browser exception string.

Every inbound frame is parsed inside a try/catch; a parse failure or a failed
shape check replies `error` (`unsupported_version` for a version mismatch,
`bad_message` for everything else — §4) and, on repeated abuse, closes the socket. No
inbound value is ever used as an object key, array index, or loop bound before
being range-checked. Handlers are wrapped so a thrown `RulesError` becomes a
rejection message, never an unhandled exception. Per-room work is isolated: a
room whose state can no longer advance legally is dropped and its sockets
notified, rather than throwing out of the tick that serves every other room —
and the thrown value travels out with that result so the host logs
`room_crashed` (the error *type*, never its text) instead of losing it.

Truly fatal failures are deliberate, not swallowed. `uncaughtException` logs
`uncaught_exception` (the error *type*, never its text) to stderr and exits
with status 1: every inbound message is already wrapped in its own try/catch,
so reaching that handler means process state is unknown, and serving rooms
from a half-applied state is worse than dropping them. The supervisor restarts
the process (`restart: unless-stopped` in the compose files). `unhandledRejection`
is logged without exiting — no room-mutating path is async. See
[OPERATIONS.md](OPERATIONS.md).

## 9. Security assumptions and anti-cheat

Assumed: no accounts, no authentication beyond the room code and session
token; anyone with a code can attempt to join an open room; the alpha is for
friends, not for hostile scale. Mitigated: hidden-information leaks (redacted
views), forged cards (id rehydration), out-of-turn play (seat check), replay
and double-submit (revision + in-flight lock), malformed input (boundary
validation), seed manipulation (server-chosen seed).

Resource abuse is bounded rather than solved. The controls, smallest first:
a per-connection message-rate guard closes a looping client (`1008`); ten
failed room-code lookups close the guessing connection; room creation is
budgeted per source per minute (`MEXE_MAX_ROOM_CREATES_PER_IP`, refused with
`room_create_limit`), which is what stops a create-then-drop loop parking rooms
against `MEXE_MAX_ROOMS`; full-state `resync` is capped per connection and
dropped, not answered, above the cap; global and per-IP connection caps refuse
sockets at the door; a 15s heartbeat terminates transports that missed a probe,
so a half-open socket cannot hold a seat `connected` until TCP gives up. Every
budget is windowed and its map pruned by the existing sweep, so no counter
collection grows with traffic.

Credentials use `node:crypto`, never the gameplay RNG: session tokens are
`randomUUID`, room codes are `randomInt` over the 28-symbol alphabet and
retried on collision. The gameplay deal stays seeded and deterministic, and its
seed is server-chosen and never sent. A room code is a public locator, not a
credential; the session token is the only thing that owns a seat, and exactly
one transport may hold a seat at a time (a reconnect evicts the previous one).

The token never leaves the tab for anyone but the server that issued it. It
lives in `sessionStorage` paired with that endpoint, and `NetClient` replays it
only when the endpoint it is about to connect to matches — which is what makes
the documented `?ws=` override (§10) unable to turn a crafted link on the real
origin into seat theft. A token stored by an older build has no endpoint beside
it and is simply discarded.

Every per-source budget keys on the client address, which behind a proxy means
`MEXE_TRUSTED_PROXY_HOPS` must state how many proxies are in front: `X-Forwarded-For`
is client-settable and is ignored at the default of 0, and read only that many
entries from the right once set. `Origin` is a stated policy — production must
name its allowed origins or say `*` — and never authentication; see
[OPERATIONS.md](OPERATIONS.md) for why a missing header is still accepted and
why the server refuses to start on silence. Explicitly *not* mitigated: denial of service at volume,
room-code brute force from a large connection farm, timing/behavioural
collusion. Frame size (16 KiB) is enforced at the server; a client-supplied
state hash is never accepted, only ever sent.

## 10. Deployment notes

Two processes: the existing static site and the WebSocket server. The client
resolves the WS URL from build-time configuration with a same-host default;
a page served over HTTPS must use `wss://`, which is the most common
first-deployment failure and is called out in [SELF_HOSTING.md](SELF_HOSTING.md). The server takes its
port from the environment, exposes a trivial health check, caps concurrent
rooms and connections, budgets room creation per source, optionally pins the
allowed browser origins, and reaps idle, empty and abandoned rooms on a timer. Local development runs both with two
commands; a single `docker compose` service pair is the deployment shape.

## 11. Tests

Server unit suites (`tests/server/`) cover room lifecycle, legal and rejected
turns, redaction, reconnect and a malformed-message battery; the integration
suite spawns the real process and drives raw `ws` clients (shared harness in
`tests/server/harness.ts`). A manager-level suite builds its `RoomManager`
through `tests/server/manager.ts`, which injects the clock, room code,
reconnect token and deal seed so every room test is reproducible. `tests/server/party.test.ts` and
`tests/server/party.integration.test.ts` carry the `OS-*` party-session
acceptance: session wins and their duplicate guard, rematch voting, between-match
leave/join, bounded history and feed, and the room-scoped, rate-limited,
ownership-checked reaction path over real sockets.
`tests/server/discovery.test.ts` carries the `OD-*` discovery acceptance in two
halves: a socket-free `RoomManager` block for what the projection *is* (private
by default, eligibility, the exact field set, the bound) and an integration
block for what a client can reach (visibility authority and its lifecycle rule,
listing privacy and cross-room isolation, seat reclaim versus a discovered join,
stale/full/in-match rooms, the list budget, and that create/join-by-code survive
an exhausted one). `tests/net/recent-rooms.test.ts` covers the local
display-history list, including that it stores no credential and that corrupt
storage is dropped rather than repaired.
`tests/server/public-rooms.test.ts` carries the `OP-*` public-readiness
acceptance, split the same way: a `RoomManager` block for what churn does to the
room model (one seat per join, a same-name newcomer who owns nothing, the last
seat going to exactly one caller, an idempotent second leave, host authority
following the lowest occupied seat, the in-match and recycled-lobby join rules,
the closed reaction enum, and a feed of public facts only) and a wire block for
what strangers can actually race (a socket hammering `join_room`, four clients
racing three seats, host transfer across a live churn, a double `leave_room`, a
reconnect that reclaims rather than duplicates, reaction spam and cross-room
isolation, a stale listing, and 2/3/4-seat rooms starting with per-seat hands).
`tests/server/matchmaking.test.ts` and `tests/server/queue.integration.test.ts`
carry the `OM-*` matchmaking acceptance, split the same way: a socket-free block
for the policy and the handoff (membership and expiry, 2/3/4 and `any` group
formation, oldest-first selection, unique assignment under a 400-entry load,
canonical casual settings, the refusal of settings/visibility in a matchmade
room, and an allocation failure that leaves no half-built room) and a wire block
for what a client can actually race (idempotent join and cancel, a seated player
refused, a cancel that lost to a committed match, reconnect into the queue versus
into the committed match, a superseded socket that cannot cancel, malformed
preferences, and the join/cancel budget).
`tests/server/hardening.test.ts` carries the
`OH-*` hardening acceptance: the room-creation budget, the Origin policy, the
resync bound, reconnect bursts, cross-room isolation under a malformed client,
room resurrection, and a concurrent-room load that has to return to baseline. `npm run
verify:multiplayer` runs two-plus real browser clients against the real server
and gates on client console errors, server stderr, accepted illegal proposals,
hand privacy and state-hash agreement.

`CH-01..CH-05` in `e2e-multiplayer/multiplayer.spec.ts` are the adverse-delivery
gate: one client's socket is intercepted with `page.routeWebSocket` and its
incoming frames are delayed, duplicated, re-delivered stale, dropped, or (for a
refusal) held until the board has moved past them. The host stays clean and is
the control — whatever the other seat went through, both end on the same
revision with `desyncs() === 0`. Withholding a frame the client is *waiting* on
is CH-04's case and is recovered by the pending timeout, not by a later frame.
They are tagged `@chaos` and run nightly rather than per PR — see
[TESTING.md](TESTING.md) for why the PR path keeps its concurrency where it was.

`e2e-multiplayer/lobby.spec.ts` carries the `LB-*` lobby acceptance and runs on
**Chromium, Firefox and WebKit** — a Chrome pass is not evidence for another
engine's socket lifecycle or storage. On a PR only the Chromium project runs
(`verify:multiplayer:chromium`); the Firefox/WebKit replay is a nightly job, so
engine parity is a within-a-day guarantee rather than a per-review one. See
[TESTING.md](TESTING.md). One browser context per player, so every
client has its own storage, its own session and its own socket. Its assertions
are on `lobbySeats()`, the rows the lobby actually *painted*: the internal
roster and the screen can disagree, and that disagreement is the bug class the
suite exists for. Covered: 2/3/4-client rooms agreeing on membership, seats,
YOU/HOST and the code; seat gaps (an occupant of seat 3 surviving seats 1 and 2
emptying out); a replacement taking the canonical lowest free seat with nothing
inherited; ready as server truth, simultaneous ready, a settings change clearing
it and a refused start; host transfer including across a gap and across a
temporary disconnect; real 2/3/4-player matches played to a server-decided
finish and rematched on the same code; a three-match endurance run across
departures, a replacement and a host transfer (tagged `@endurance`, nightly
rather than per PR — it was a third of the suite's wall clock on its own); lobby reload, between-match
reconnect, a second tab taking a seat over, and room-switch isolation.
`e2e-multiplayer/ios-lobby.spec.ts` is the WebKit iOS gate: the five
representative portrait/landscape viewports, an orientation change that must
change layout and nothing else, and a two-client match with a mid-match reload.
Both write their evidence to `docs/screenshots/verify-lobby*.json`, which
`scripts/check-verify-multiplayer.mjs` gates on per engine.

Details in [TESTING.md](TESTING.md).

## 12. As built

Files:

- `src/net/protocol.ts` — shared wire protocol (pure module, no browser/Node
  APIs): message types, `buildView` (redaction), `parseClientMessage`
  (boundary validator).
- `src/net/client.ts` — `NetClient`, the browser WebSocket wrapper: connect/
  reconnect (the bounded retry schedule in §0), status events, message trace,
  ping, and the session token in `sessionStorage` — stored beside the endpoint
  that issued it, and replayed only to that endpoint (§9).
- `src/net/viewToState.ts` — projects a `GameView` back into a local-shaped
  `GameState` (placeholder cards for hidden hands/draw pile) so the existing
  offline renderer can draw it unchanged.
- `src/scenes/OnlineScene.ts` — the lobby scene
  (idle/join/name/lobby/custom/party/browse/queue/matched/error), including the
  in-canvas keyboard join-code entry, the online home's Quick Match entry and
  CONTINUE/RECENT shortcuts, the searching and MATCH FOUND screens, the room
  browser, and the host's visibility badge.
- `e2e-multiplayer/harness.ts` — one real server per spec file and one browser
  context per player; shared by the lobby and iOS suites.
- `server/index.ts` — the WebSocket server process: message dispatch,
  broadcast helpers, health check, sweep interval, crash guards.
- `server/rooms.ts` — `RoomManager`: room lifecycle, seat/ready state, seed
  generation, turn validation and application, reconnect, sweep, and
  `createMatchRoom` (the queue's one allocation entry point).
- `server/matchmaking.ts` — `MatchQueue`: the casual queue and its grouping
  policy (§3e). No sockets and no timers of its own; the caller drives `expire`.
- `server/connections.ts` — per-connection state, socket attach/detach/evict,
  the windowed abuse budgets (flood, failed joins, room creation, resync, queue),
  the queue-entry ownership a connection holds, the
  Origin policy, the heartbeat liveness split, and closing every socket attached
  to a reaped room.
- `server/config.ts` — env-derived caps and limits, validated once at startup.
- `server/log.ts` — level-gated structured logging with redaction enforced at
  the logger, not at call sites.
- `server/metrics.ts` — aggregate Prometheus counters, no per-player series.

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
