# Architecture

MEXEMEXE! is a Vite + TypeScript + Phaser client with an optional Node +
`ws` server for online rooms. This document describes the code as it is
built; the ruleset it implements lives in [GAME_RULES.md](GAME_RULES.md).
The measured baseline behind the maps below — module-by-module evidence, the
dependency-edge classification and the architecture risk register — is
[ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md). The properties this structure
must preserve, and the scenarios that prove them, are
[INVARIANTS.md](INVARIANTS.md).

## Layering

```
rules/          pure functions + seeded rng, no Phaser/DOM/Date  ← the only rules authority
core/           event bus, settings, persistence, play log, PWA, lifecycle
game-state/     GameStore: turn lifecycle over rules/
mexe-mode/      table draft editor (break/split/merge/move, undo/redo/reset)
ai/             SimpleAi, RearrangerAi, personalities        ← rules + mexe-mode only
net/            wire protocol, WebSocket client, view→state projection
table/ ui/ scenes/ assets/ audio/ cosmetics/                  ← Phaser + DOM layer
localization/ tutorial/ demo/ verification/                   ← support
server/         authoritative room server (imports src/net/protocol + src/rules)
```

`core/` is where the layering is weakest: it is a bucket of six roles rather
than one layer, and four of its modules import *upward* into `ui/`,
`cosmetics/`, `ai/` and `verification/` (settings→ui/helpers,
persistence→cosmetics, pwa→verification; playlog's viewport read was removed in Wave
2D). Treat "put it in
core" as a smell, not a default — see
[ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) ARCH-009.

**Hard rule:** `src/rules` is pure and deterministic — no Phaser, no DOM, no
`Date`, no `Math.random`. Everything in it is testable in Vitest without a
browser. The Phaser layer renders state and emits intents; it never decides
legality.

## Modules

| Path | Responsibility |
|---|---|
| `src/rules` | deck, seeded rng (`rng.ts`), shuffle, deal (`createNewGame`), meld analysis, table validation, turn legality, card conservation, win check, serialize, `draftFromCardIds` (card ids → draft, used by the server and by replay), `hash.ts` (one FNV-1a, shared by the wire digest and the replay digest) |
| `src/core` | `EventBus` (`events.ts`), settings + `localStorage` persistence, session play log, objective hints, results summary, error recovery, app sleep/resume, PWA registration |
| `src/game-state` | `actions.ts`: the local gameplay-action vocabulary and the pure `applyGameAction`. `store.ts`: `GameStore`, the one mutable slot for the committed local `GameState`, which only `dispatch` replaces. `replay.ts`: the deterministic reproduction format (record, validate, run) |
| `src/mexe-mode` | draft state: melds under edit, cards played from hand, undo/redo history |
| `src/ai` | `SimpleAi`, `RearrangerAi`, the four personalities and their presentation constants |
| `src/net` | `protocol.ts` (shared wire types, redaction, boundary validation), `client.ts` (browser socket), `viewToState.ts` (server view → local-shaped state), `errors.ts` |
| `src/table` | table layout, snapping, zoom, tap destinations, the portrait editor layout |
| `src/ui` | widgets, overlays, panels (settings, rules, pause), helper modes, regions, viewport |
| `src/scenes` | Boot, Menu, Setup, Game, Online, Tutorial, Win |
| `src/assets` | asset manifest, procedural fallbacks, card composition |
| `src/audio` | SFX player and the streamed music playlist |
| `src/cosmetics` | table themes, card backs, avatars (client-side only) |
| `src/localization` | pt-BR (default) + en-US dictionaries, `t(key)` |
| `src/tutorial` | scripted steps, fixture table, step director |
| `src/demo` | `?showcase=` scenarios used by the screenshot suite |
| `src/verification` | `window.__MEXE__` debug API (see [TESTING.md](TESTING.md)) |
| `server/` | `index.ts` process + HTTP health/metrics + socket dispatch + broadcast, `rooms.ts` room/turn authority, `connections.ts` socket registry and rate-limit windows, `matchmaking.ts` casual FIFO queue, `metrics.ts` counters + Prometheus text, `config.ts` env parsing, `log.ts` redacting logger |

## Data model

```ts
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
type Rank = 1..13;                  // 1 = Ace, low or high depending on the meld
interface Card {
  id: string;         // `${suit}-${rank}-d${deckId}` | `joker-d${deckId}-${n}`
  deckId: number;     // which of the two decks this card came from
  suit: Suit | null;  // null iff isJoker
  rank: Rank | null;  // null iff isJoker
  isJoker: boolean;
}
interface Meld { readonly id: string; readonly cards: readonly Card[] }
interface GameState {          // every field readonly — see State ownership below
  readonly seed: number; readonly players: readonly PlayerState[];
  readonly activePlayerIndex: number;
  readonly table: readonly Meld[];        // committed, always valid
  readonly drawPile: readonly Card[]; readonly turn: number;
  readonly winnerId: string | null;
  readonly phase: 'playing' | 'finished'; readonly config: RulesConfig;
}
```

`suit`/`rank` are nullable precisely so the type checker forces every card-face
read to handle jokers. The Mexe Mode draft is a separate structure (melds under
edit, hand cards played, undo history) and is never serialized into committed
state.

`RulesConfig` (`src/rules/types.ts`, `DEFAULT_RULES`) says what a game is dealt
from — deck count, jokers per deck, hand size — and nothing else. Meld legality
is fixed; see GAME_RULES.md.

## Rules API (`src/rules/rules.ts`)

`analyzeMeld(cards, config)` is the single source of meld truth — it tries a run
then a group and returns either `{ valid: true, kind, assignments }` or
`{ valid: false, reason }`. `isValidRun` / `isValidGroup` / `isValidMeld` /
`validateTable` / `getInvalidMeldReasons` are all thin wrappers around it, and
the server calls the same function, so client and server can never disagree
about legality.

Turn legality is `canConfirmTurn(state, draft)`, which checks: every draft meld
valid, at least one hand card added, card conservation (draft cards == committed
table + played hand cards), no committed table card missing, no duplicate or
foreign ids. It returns `{ ok: true }` or `{ ok: false, reasons }` where each
reason is an i18n key, so the FEITO button can render the exact translated
cause.

Other entry points: `createDeck`, `shuffleDeck`, `dealInitialHands`,
`createNewGame` (the one deal — offline play and the server both start a match
through it, so a seed means one game on both sides), `applyConfirmedTurn`,
`drawAndEndTurn`, `timerExpireTurn` (the server's online turn-timer expiry path
— see MULTIPLAYER.md §7b; local play never starts a timer), `checkWinner`,
`cardsConserved`, `serializeGameState` / `deserializeGameState`
(`GAME_STATE_VERSION = 2`). `createRng` lives next door in `src/rules/rng.ts`.

**Joker assignments** are derived on demand from the run/group search, never
stored in place of the card: jokers keep their own identity on the table, in
saves and on the wire.

**Draw-pile exhaustion ends the game immediately** — `drawAndEndTurn` on an
empty pile returns `phase: 'finished'` with `fewestCardsWinner`, ties broken by
earliest seat.

**Card conservation** has one implementation, `cardsConserved(state)`, derived
from `config.deckCount * (52 + config.jokersPerDeck)` and never hardcoded. The
save loader and the server's `assertConservation` both call it.

## Local game flow

```
MenuScene → SetupScene → GameScene
 START_TURN(player)
 ├─ human: edit draft (mexe-mode) → FEITO → dispatch(confirmTurn)
 │ └─ or COMPRAR → dispatch(drawAndEndTurn)
 ├─ ai: plan (sync, budgeted) → dispatch(confirmTurn), or dispatch(drawAndEndTurn)
 └─ then, from the returned outcome: finished → WinScene, else START_TURN(next)
```

### The local action path

Every local gameplay intent — human FEITO/COMPRAR, AI, the tutorial opponent, the
`window.__MEXE__` hooks — goes through one path and nothing else calls a `src/rules`
transition directly:

```
intent → GameScene.dispatch(action) → GameStore.dispatch → applyGameAction (pure)
       → outcome → onWin() | onTurnStart() → render + notifications
```

| Piece | Where | What it owns |
|---|---|---|
| `GameAction` | `src/game-state/actions.ts` | the vocabulary: `confirmTurn`, `drawAndEndTurn`. Nothing else changes committed local state. |
| `applyGameAction` | `src/game-state/actions.ts` | preconditions (match still playing, actor is the active seat) then the `src/rules` transition. Pure — a test or replay can drive it without Phaser. |
| `ActionOutcome` | `src/game-state/actions.ts` | `{ ok: false, reasons }` (state untouched) or `{ ok: true, state, actorId, cardsPlayed, finished }`. |
| `GameStore.dispatch` | `src/game-state/store.ts` | the one mutable state slot, plus announcing the fact on the bus. |
| `GameScene.dispatch` | `src/scenes/GameScene.ts` | post-transition orchestration: win vs next turn, presentation, logging. |

The actor differs between a human and an AI seat; the transition authority does not. UI intents
(open settings, zoom the table, hover a card, play a sound) are *not* actions and never become
ones.

Online is deliberately not on this path. An online client never commits authoritative state: it
sends an intent (`submit_turn` / `draw`) and waits for the server's `state_sync`. The server's own
action path is `RoomManager.claimTurn` (room exists, mid-match, not already processing, caller is
the active seat at the revision it believes in) → the same `src/rules` transition → `commitTurn`.
Same semantics, different authority — see [MULTIPLAYER.md](MULTIPLAYER.md).

### Invalid transitions

Both action paths refuse rather than throw, with `ReasonCode`s the UI already translates:

| Attempt | Result |
|---|---|
| confirm or draw after the match finished | `reason.notYourTurn`, state untouched |
| action from a seat that is not the active player | `reason.notYourTurn` |
| illegal draft | the rules' own reasons from `canConfirmTurn` |
| online action at a stale `rev` | `reason.staleRevision`, client requests a resync |
| second online action while one is in flight | `reason.alreadySubmitted` |

### Events

Every bus event is a **notification of a fact that already happened**. None of them advance the
game, so no subscriber is load-bearing and delivery order carries no gameplay meaning.

| Event | Publisher | Subscribers | Payload |
|---|---|---|---|
| `turn:confirmed` | `GameStore.dispatch` | playlog | `{ playerId, cardsPlayed }` |
| `turn:drawn` | `GameStore.dispatch` | playlog | `{ playerId }` |
| `turn:start` | `GameStore.dispatch` | playlog | `{ playerId, turn }` |
| `game:won` | `GameStore.dispatch` | playlog | `{ winnerId }` |
| `viewport:changed` | `main.ts` resize handler | every scene, playlog | `{ portrait }` |

A refused action emits nothing. `GameStore` is the publisher of the turn facts because it *is*
the local application-action executor; the server does not use it (ARCH-004) and does not inherit
the bus. Every subscription returns an unsubscribe and every scene calls it from
`this.events.once('shutdown', …)`, so a dead scene cannot be reached. `GameScene` still guards its
async AI continuation with `sceneGone` and a store-identity check, because the search yields
across frames — not because an event might arrive late.

## Online game flow

```
OnlineScene (lobby)  ──create/join/ready/start──▶  server/rooms.ts
GameScene (online)   ──submit_turn / draw──────▶  validate with src/rules
       ▲                                              │
       └──────── per-seat redacted GameView ◀─────────┘
```

The **server holds the only authoritative state** (both hands, draw-pile order,
whose turn it is, `rev`). Clients send intents and render the view they are
given; the draft editor stays a local scratchpad the server never sees until
FEITO. Each client receives a per-seat view containing its own hand, opponents
as counts, the committed table, `drawCount`, and the room's `RulesConfig` — the
**hand-privacy boundary**, which is also why `window.__MEXE__.state()` cannot
leak an opponent's hand online. `src/net/viewToState.ts` projects that view back
into a local-shaped `GameState` (placeholder cards for hidden information) so
the offline renderer draws it unchanged.

Full protocol, room lifecycle, reconnect and alpha limits: [MULTIPLAYER.md](MULTIPLAYER.md).

## RNG

`mulberry32(seed)` in `src/rules/rng.ts` — the deterministic contract lives beside the
domain that consumes it (ARCH-010 resolved). The seed comes from `?seed=` or the
clock at boot and is recorded in state and logs; all shuffles and AI tie-breaks
draw from the state's stream, so the same seed replays the same deal and the
same AI decisions. Online, the **server** picks the seed.

## Assets and rendering

Logical canvas 480×270, integer-scaled inside a 16:9 letterbox, `pixelArt: true`.
`src/assets/manifest.ts` lists every asset with key, path and dimensions;
`BootScene` GET-probes each path first and substitutes a procedural fallback
texture (`src/assets/fallbacks.ts`) for anything missing, so a missing file
never crashes the game. Fallbacks are reported in
`window.__MEXE__.missingAssets`, and verification fails if that is non-empty.
See [ASSETS.md](ASSETS.md).

## Failure model

Two families, and every failure in the project is deliberately in one of them.

**Expected failure** — someone or something outside this code said no, or sent
something we do not accept. It is represented as *data*, never inferred from
unchanged state, and the layer that owns the player's language turns it into a
sentence.

| Where | Shape | Turned into copy by |
|---|---|---|
| rules legality | `ConfirmResult` / `MeldAnalysis` `ReasonCode` | `src/ui`, `src/table/invalid-detail` |
| local action | `ActionOutcome` `{ ok: false, reasons }` (`src/game-state/actions.ts`) | the scene that dispatched it |
| wire input | `parseClientMessage` → `{ error }` → `bad_message` | never shown; dev detail only |
| server refusal | `RoomManager` result `{ ok: false, error: ServerErrorCode }` → `ErrorMsg.code` | `errorMessage()` in `src/net/errors.ts` |
| connection | `ConnStatus` + `ConnReason` (`src/net/client.ts`) | `OnlineScene` |
| untrusted snapshot | `RulesError` with a `RulesInputErrorCode` | its caller's recovery path |
| stored settings/save | no failure: `parseSave` clamps per field to defaults | — |

**Unexpected failure** — an invariant this code was supposed to uphold did not
hold. It stays an exception and must reach a diagnostic path, never a silent
no-op:

| Where | Shape | Diagnostic path |
|---|---|---|
| rules invariants | `RulesError` with a `RulesInvariantErrorCode` (`badPlayerCount`, `deckTooSmall`, `illegalConfirm`, `corruptState`) | client: `window.onerror` → `__MEXE__.errors` + toast + return to menu (`src/main.ts`, `src/core/error-recovery.ts`). Server: `log.error` |
| server message handler | any throw | `message_handler_error` + `messageHandlerErrorsTotal`, client gets `internal_error` with no detail |
| server turn tick | any throw | room dropped, `room_crashed` logged with the error *type* (`errorFields`), sockets closed |
| anything else in the process | any throw | `uncaught_exception` → exit 1, supervisor restarts |

Error codes are stable, presentation-neutral and localization-independent.
`ServerErrorCode` lives in `src/net/protocol.ts` (one owner, shared by both
runtimes); `ReasonCode` lives in `src/rules/types.ts`. No UI branches on an
error *message*: `msg.message` is developer detail for logs and the trace, and
a raw exception text is never sent to a client or shown to a player.

### Deliberate fallbacks

These swallow a failure on purpose, because the alternative is worse than the
degraded behaviour:

- missing assets → procedural fallback textures, reported in `__MEXE__.missingAssets` (verification fails if non-empty)
- audio/haptics blocked → silent no-op (a browser autoplay policy is not an error)
- AI throws mid-decision → the AI draws and ends its turn, so a bug cannot hang the match
- storage blocked or full → reads return defaults, writes are dropped; the session works, it just does not survive a reload
- corrupt/partial `mexe-save` → per-field defaults (`parseSave`), never a throw

Everything else is either an expected failure with a code or an exception that
reaches one of the diagnostic paths above.

## Configuration ownership

Every configurable fact has exactly one owner. "Configurable" is reserved for
what genuinely varies by runtime or by match — the MexeMexe rules themselves
are code.

| Class | Owner | Validated | Notes |
|---|---|---|---|
| GAME_RULE | `src/rules` | — | Meld legality, turn structure, win condition. Not configurable, deliberately: nothing in `RulesConfig` reaches `analyzeMeld`. |
| MATCH_CONFIG | `RulesConfig` (`src/rules/types.ts`) + `DEFAULT_RULES` | fixed values; `createNewGame` refuses a deck too small or a player count outside 2–4 | Deck count, jokers per deck, hand size. Varies only because tests and fixtures need it to; the product ships `DEFAULT_RULES`. |
| MATCH_CONFIG (online) | `RoomSettings` (`src/net/protocol.ts`), server-owned | `normalizeRoomSettings` — presets are taken whole, `custom` is clamped to `CUSTOM_BOUNDS` | The client proposes and renders; it never applies a value. The lobby UI reads `CUSTOM_BOUNDS` rather than keeping its own ranges. |
| PLAYER_PREFERENCE | `src/core/settings.ts` over `src/core/persistence.ts` | `parseSave` — unknown/mistyped values fall back per field | Persisted in `mexe-save`. |
| CLIENT_RUNTIME_CONFIG | `src/config.ts` | — | `resolveWsUrl` only: `?ws=` → `VITE_WS_URL` → same-origin default. |
| SERVER_RUNTIME_CONFIG | `server/config.ts` `loadConfig(env)` | once, at startup; a bad value exits with a message naming the variable | The env table is [OPERATIONS.md](OPERATIONS.md). Room capacity, reconnect grace and idle lifetime default to the room aggregate's own constants (`server/rooms.ts`), imported rather than restated. |
| BUILD_CONFIG | `vite.config.ts`, `.env.example` | — | `__APP_VERSION__`, `VITE_WS_URL`. |
| Shared room shape | `src/net/protocol.ts` | — | `ROOM_CODE_LENGTH`, `MAX_SEATS`, `SERVER_ERROR_CODES`, `TIMER_PRESETS`, `CUSTOM_BOUNDS` — facts both runtimes state, so they are stated once. |

Deliberate differences, kept rather than merged: the wire accepts a room code
up to 16 characters while a real one is `ROOM_CODE_LENGTH` (a probe is refused
at the boundary, a typo is refused by the room manager); the client trims a
display name to `MAX_NAME_LENGTH` for the seat row while the server trims to 64
as its own trust boundary.

There are no feature flags. Units are in the name (`*Ms`, `*Length`, `*Count`,
`*Ratio`); milliseconds are the only time unit that crosses a boundary.

## Persistence

Persistence is never a second gameplay authority. Nothing persisted can decide
a legality question, and no online state is restored from disk — a reconnect
recovers from the server (see [MULTIPLAYER.md](MULTIPLAYER.md) §7).

| Domain | Key | Store | Owner | Versioned | Validation | Lifetime |
|---|---|---|---|---|---|---|
| settings + progress + cosmetics | `mexe-save` | `localStorage` | `src/core/persistence.ts` (`settings` singleton reads/writes it) | `version: 1` envelope | `parseSave` — wrong version or corrupt JSON → defaults; unknown enum/cosmetic id → per-field default | until cleared (`settings.resetData()`) |
| pre-v1 settings | `mexe-settings` | `localStorage` | same | unversioned | migrated into `mexe-save` on first read, then removed | gone after one load |
| display name | `mexe.online.name` | `localStorage` | `src/net/client.ts` | no | trimmed to `MAX_NAME_LENGTH`; the server sanitizes it again | until cleared |
| recent rooms | `mexe.online.recent` | `localStorage` | `src/net/client.ts` | no | shape-checked per entry, code re-normalized, entries older than 6h dropped | 6h TTL, max 5 |
| reconnect token | `mexe.online.token` | **`sessionStorage`** | `src/net/client.ts` | no | paired with the endpoint that issued it; a token stored for another endpoint is never sent | tab session |
| offline shell | cache named by build version | Cache Storage | `public/sw.js` | cache name *is* the version | old caches deleted on activate | until a new build activates |
| play log | — | memory only | `src/core/playlog.ts` | — | — | page |

A room code is a locator, not a credential; the reconnect token is the one
credential and it is the one thing kept out of `localStorage`, in a different
key and a different shape, so it cannot be confused with history. No hidden
opponent information is persisted anywhere — see
[OBSERVABILITY_PRIVACY.md](OBSERVABILITY_PRIVACY.md).

## Replay and reproduction

Three artifacts, three jobs. They share serialization helpers; they are not the
same format and must not merge:

```text
SAVE     serializeGameState        restore the match the player left
REPLAY   src/game-state/replay.ts  reproduce how a match reached a state
PLAYLOG  src/core/playlog.ts       human/debug timeline and session statistics
```

A replay is **seed + start + ordered actions**, versioned separately from the
save format (`REPLAY_VERSION = 1`; `GAME_STATE_VERSION = 2` moves on its own
schedule, and a replay only embeds a save envelope in the snapshot case below):

```text
{ version, start, actions[], finalHash? }

start  { kind: 'new', seed, players, config }     the normal case
       { kind: 'snapshot', state }                tutorial/showcase states only
actions  { type: 'confirmTurn', actorIndex, melds: [{id, cardIds}] }
         { type: 'drawAndEndTurn', actorIndex }
```

Properties that make it worth having:

- **One gameplay authority.** `runReplay` folds each action through
  `applyGameAction` — the same function `GameStore.dispatch` calls. There is no
  replay-only transition, and a replay can only reach states live play can.
- **Card ids, never card identity.** Melds carry ids and `draftFromCardIds`
  (`src/rules`) resolves them against the state the action lands on, exactly as
  the server resolves `submit_turn`. A full two-player match is tens of kB.
- **`start.kind` is proven, not declared.** `replayOf` emits a seed start only
  when re-dealing from that seed reproduces the recorded initial state; a
  tutorial fixture or a showcase table therefore records as a snapshot.
- **Untrusted input.** `parseReplay` validates version, shape, action type,
  actor and meld shape; legality is left to `applyGameAction`, so there is no
  second legality check. Failures throw `RulesError` with
  `unsupportedReplayVersion`, `corruptReplay` or `replayDiverged`.
- **No platform.** `replay.ts` imports rules and actions only; it runs under
  `tsx`/Vitest with no Phaser, DOM, storage, socket or clock.

Capture and run: [DEVELOPMENT.md](DEVELOPMENT.md#reproducing-a-bug-from-a-replay).

**AI decisions are recorded, not recomputed.** The rearranging engines budget
their search with `performance.now()`, so re-running an AI would not reliably
choose the same move on a different machine. A replay stores the action the AI
actually produced, which makes AI turns exactly as reproducible as human ones
and removes the engine from the replay's trusted set.

**Online is not client-replayable.** `window.__MEXE__.replay()` returns `null`
online: the local store there holds `viewToState`'s redacted projection with
placeholder opponent cards, so its actions never ran against authoritative
state. Server-side reproduction would start from the room's own seed. Network
race reproduction needs what a gameplay replay deliberately omits — revision
order, message arrival order, disconnect/reconnect timing — and belongs in a
transport-level trace, not in this format.

### Game-state snapshots

`serializeGameState` / `deserializeGameState` (`src/rules/rules.ts`) are the
one snapshot format. **Current version 2; no older version is supported and
there are no migrations** — nothing in the product writes a snapshot to
storage, so no v1 payload exists in any browser to migrate. The format is used
by determinism tests today and is the shape a future replay would build on.

Deserialization treats its input as untrusted, in this order: parse → require
the versioned envelope → version check → shape check → the gameplay invariants
(`cardsConserved`, `validateTable`, the same functions the server asserts).
Anything refused throws a `RulesError` with an input error code
(`corruptSave`, `unsupportedSaveVersion`) rather than producing a half-valid
state. A bare unversioned state is refused: a snapshot that cannot be dated
cannot be trusted. Serialization is deterministic — the same state produces
the same string, which is what `createNewGame` determinism tests compare.

## System context

```text
Browser tab
 ├─ main.ts                  composition root: Phaser game, locale, PWA, resize, error recovery
 ├─ scenes/ (Phaser)         render + input + (today) match orchestration
 ├─ game-state + mexe-mode   committed local state and the turn's draft
 ├─ rules/                   the legality authority — shared with the server verbatim
 ├─ ai/                      local opponents (no network, no Phaser)
 ├─ core/ + localization/    settings, save, playlog, PWA, bus, copy
 ├─ verification/            window.__MEXE__ surface for Playwright
 ├─ localStorage             mexe-save (settings/progress/cosmetics), online name + reconnect token
 ├─ service worker           offline shell + assets (see PWA_OFFLINE.md)
 └─ net/client.ts ── WebSocket ──┐
                                 ▼
                    Node + ws server (optional, online only)
                     ├─ index.ts        process, HTTP health/metrics, dispatch, broadcast, timers
                     ├─ rooms.ts        RoomManager — the authoritative room/match aggregate
                     ├─ matchmaking.ts  casual FIFO queue
                     ├─ connections.ts  socket registry + rate limits
                     └─ imports src/rules + src/net/protocol   ← same legality, same wire types
```

Actors: the local player (pointer/keyboard/touch), the AI (in-process, seeded),
remote players (via the server only), Phaser, the browser platform
(storage, service worker, vibration, clipboard, share), and the Playwright
suites (through `window.__MEXE__`, never through internals).

## Ownership and authority

| Concern | Authority | Everyone else |
|---|---|---|
| meld legality, turn legality, winner, draw | `src/rules` | may only ask, never decide |
| committed local game state | `GameStore` (`src/game-state`) | reads through `get()`; treat as read-only |
| Mexe draft | `DraftEditor` (`src/mexe-mode`) | never serialized, never sent until FEITO |
| AI choice | `src/ai` behind `AiPlayer.decide` | scene only schedules and presents it |
| online match state, `rev`, deal seed, turn timer, room membership, host, ready, reconnect seat | the server's `RoomManager` | clients render the per-seat view they are given |
| hidden information | `buildView` redaction (`src/net/protocol.ts`) | no client path may reconstruct an opponent hand |
| settings, progress, cosmetics | `src/core/settings` over `persistence` | no scene-local copies |
| layout, sizing, orientation | `src/ui/viewport` + `src/ui/regions` + `src/table` | scenes consume, never re-derive |

Two ownership facts worth knowing before changing anything:

- **The server does not use `GameStore`.** `GameStore` emits on the global bus,
  and one process holds many rooms, so `server/rooms.ts` calls the same
  `src/rules` functions directly — including `createNewGame`, so the deal is no
  longer written out twice. What stays client-side is the announcement, not the
  gameplay. (ARCH-004.)
- **`GameScene` currently owns more than presentation** — online state
  adaptation, AI scheduling and the online turn clock live there. That is a
  known concentration, not the intended end state. (ARCH-001/ARCH-002.) What it
  no longer owns is the turn transition itself: it issues actions and reacts to
  outcomes, and the rules-facing part of that (`applyGameAction`) is testable
  without Phaser.
- **Post-transition orchestration is the caller's, not a subscriber's.** The bus
  announces facts; `GameScene.dispatch` decides what happens next. (ARCH-006.)

## Module categories and dependency rules

Five categories are enough for this repository. They describe what a module is
allowed to *know*, not where its file sits.

| Category | Modules | May depend on |
|---|---|---|
| **Domain** | `src/rules`, `src/mexe-mode` | domain only (plus the `Rng` type contract) |
| **Shared contract** | `src/net/protocol.ts`, `src/net/viewToState.ts` | domain types |
| **Application** | `src/game-state`, `server/rooms.ts`, `server/matchmaking.ts`, the AI engine in `src/ai` | domain, shared contract, the seeded rng |
| **Presentation** | `src/scenes`, `src/ui`, `src/table`, `src/assets`, `src/audio`, `src/cosmetics`, `src/tutorial`, `src/demo` | everything below it; `src/table` additionally stays effect-free |
| **Platform / infrastructure** | `src/core/*`, `src/net/client.ts`, `server/index.ts`, `server/connections.ts`, `src/verification` | domain + shared contract + application contracts |

Cross-cutting and unowned by a layer: `src/localization` (data), `src/config.ts`
(query params).

Allowed directions, in one line: **domain ← application ← presentation**, with
platform adapters called *from* application/presentation, never the reverse.
`server/` is application + infrastructure over the *same* domain and shared
contract as the client — that shared edge is the point, not an accident.

### Forbidden directions

| Forbidden edge | Why | Status |
|---|---|---|
| `rules`/`mexe-mode`/`game-state` → Phaser, DOM, `localStorage`, WebSocket, service worker | destroys determinism and node-only testability | enforced (`tests/boundaries.test.ts`) |
| `rules`/`mexe-mode`/`game-state`/`table` → `Math.random`, `Date.now`, `performance.now` | a seed must replay exactly | enforced (`tests/boundaries.test.ts`) |
| anything outside `scenes`/`ui`/`assets`/`audio`/`main.ts` → `phaser` | keeps the domain portable | enforced (`tests/boundaries.test.ts`) |
| `server/` → any `src/` module other than `rules`, `net/protocol` | the server must never import client presentation | enforced (`tests/boundaries.test.ts`) |
| presentation → a second legality implementation | one `analyzeMeld`, one `canConfirmTurn` | convention (ARCH-019) |
| `src/ai` → opponent hand identities | AI must not see what a player cannot | convention (INV-A2) |
| `src/core/*` → `ui`, `cosmetics`, `ai`, `verification` | makes the platform layer unusable without presentation | **violated today** — ARCH-009/ARCH-011, Phase 3/4 |
| `src/game-state` → the global bus | announcement, not turn application — the shareable half lives in `src/rules`, the transition in the pure `applyGameAction` | **narrowed to notification only** — ARCH-004; the control-flow half closed with ARCH-006 |

New violations belong in the [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md)
register as an `ARCH-xxx` finding with a phase, not in a second list.

## State ownership and mutation rules

The authority table above says who decides. This says who may write.

| State | Canonical owner | Mutation entrypoints | Readers | Lifetime |
|---|---|---|---|---|
| committed local `GameState` | `GameStore` | `confirmTurn`, `drawEndTurn` only | scenes, demo, tests via `get()` — the live object, readonly **by type** (ARCH-005 resolved) | match |
| Mexe draft | `DraftEditor` | its own editing methods | `GameScene` render + `canConfirmTurn` | one turn |
| authoritative room/match state | `RoomManager` | `RoomManager` methods only | `server/index.ts` broadcast path | room |
| seat ownership / reconnect token | `RoomManager` | `join`, `reconnect`, `disconnect`, `sweep` | `server/index.ts` | room |
| turn timer | `RoomManager` | `startTurnClock`, `advanceStalledTurns` | clients render `turnMsLeft` | turn |
| lobby view | `OnlineScene` | its own handlers, from server messages | its render methods | scene (mirror, never authority — ARCH-003) |
| settings / progress / cosmetics | `src/core/settings` | `settings.update*` | everywhere | app |
| connection state, name, tokens | `NetClient` | `NetClient` | `OnlineScene`, `GameScene` | socket |
| scene UI state | the owning scene | scene methods | that scene | scene instance; reset in lifecycle code |

Rules that follow from the table: a mirror of server state is never written
locally except from a server message; derived values (helper flags, joker
assignments, `turnMsLeft`, invalid-meld reasons) are recomputed, never cached as
a second authority; and nothing outside the owner mutates an owned object in
place.

## Side-effect boundaries

| Effect | Allowed in |
|---|---|
| Phaser, DOM, input | `src/scenes`, `src/ui`, `src/main.ts` |
| `localStorage` | `src/core/persistence.ts` and `src/net/client.ts` — nowhere else |
| timers, `Date.now` | scenes, `src/net/client.ts`, `server/` (the `RoomManager` clock is injected) |
| randomness | seeded `createRng` for anything a seed must replay; `Math.random` only in non-gameplay paths (reconnect jitter, sfx detune, one cosmetic AI emote roll) |
| WebSocket | `src/net/client.ts`, `server/index.ts` |
| service worker, connectivity | `src/core/pwa.ts` |
| audio, haptics | `src/audio`, `src/core/haptics.ts` |
| clipboard, share, URL params | `OnlineScene`, `src/config.ts`, `src/verification/debug-api.ts`, `src/demo` |
| **none of the above** | `src/rules`, `src/mexe-mode`, `src/game-state`, `src/table`, `src/net/protocol.ts`, `src/net/viewToState.ts` |

The last row is the one that matters most. `tests/boundaries.test.ts` enforces
it for `src/rules`, `src/mexe-mode`, `src/game-state`, `src/table` and the wire
contract; the rest of the table is still convention (ARCH-019).

Effects are worth separating by *kind* when deciding where one belongs:

| Kind | Examples | Where it may live |
|---|---|---|
| gameplay | the deal, shuffles, AI tie-breaks | the state's seeded rng only |
| application | turn clock, reconnect schedule, rate-limit windows, persistence writes | `game-state`/`server/*` application modules and their platform adapters |
| platform | storage, sockets, service worker, wall clock, haptics | `src/core/*`, `src/net/client.ts`, `server/index.ts` |
| presentation | Phaser, DOM, audio, animation timers, sfx detune | `src/scenes`, `src/ui`, `src/audio`, `src/main.ts` |

### Platform ownership

The rows above *are* the platform seams. There is no generic platform layer and
no port without a current caller — a port is introduced only where it buys
testability or removes a leak, which today means the ones already here:

| Seam | Contract | Implementations |
|---|---|---|
| clock (server) | injected into `RoomManager` (clock, codes, tokens, seed) | `Date.now` in `server/index.ts`; fakes in `tests/server/*` |
| app visibility | `onAppHidden` / `onAppVisible` (`src/core/lifecycle.ts`), `doc`/`win` injectable | browser listeners; plain objects in tests |
| storage | `src/core/persistence.ts` (`mexe-save`) and `src/net/client.ts` (name, reconnect token) — domain-specific APIs, not a generic `StorageService` | `localStorage`/`sessionStorage`, with a no-op fallback when storage is blocked |
| connectivity / service worker | `src/core/pwa.ts` | browser only |
| transport | `NetClient` over the shared `src/net/protocol` contract | browser WebSocket; the server speaks the same contract |
| URL input | read where it enters: `src/config.ts` (`?ws=`), `src/verification/debug-api.ts` (`?seed=`, `?playlog=`, capture flags), `src/demo` (`?showcase=`) | browser `location` |
| haptics, audio | `src/core/haptics.ts`, `src/audio` | browser only; never consulted by application logic |

**Wall clock vs gameplay time.** No gameplay transition reads a clock: the deal
comes from a seed, and turn expiry is a server decision (`advanceStalledTurns`
→ `timerExpireTurn`) that arrives as an ordinary transition. The client renders
`turnMsLeft`; it never decides expiry. `performance.now()` appears in the play
log's relative timeline and in the AI's search budget, both outside the state
transition.

**Non-browser reuse.** `rules`, `mexe-mode`, `game-state` (including
`replay.ts`), `net/protocol`, `net/viewToState`, `table` and the AI engine run
under plain Node today — `scripts/replay.ts` and the server are the proof. The
remaining blockers for reusing the *application* layer are ARCH-009's upward
imports out of `core` (settings→`ui/helpers`, persistence→`cosmetics`/`ai`),
not the platform seams.

## Enforcement status

Which mechanism actually holds each architectural rule today. Cheapest
sufficient mechanism wins; a rule with no mechanism is a rule that regresses
during restructuring (ARCH-019).

| Rule | Mechanism |
|---|---|
| domain purity (no Phaser/DOM/storage/socket in rules, draft, store, layout, wire contract) | **test** — `tests/boundaries.test.ts` |
| no unseeded randomness or wall clock in gameplay | **test** — `tests/boundaries.test.ts`, plus determinism tests |
| Phaser confined to the presentation layer | **test** — `tests/boundaries.test.ts` |
| server imports only shared rules/protocol/rng from `src/` | **test** — `tests/boundaries.test.ts` |
| client and server share one protocol and version | **type system** — `server/` imports `src/net/protocol` |
| server authority and hidden-hand privacy | **test** — `tests/server/*`, `verify:multiplayer`, OH-26 |
| card conservation, table legality, determinism | **test** — `rules`, `draft`, `probes`, `server/rooms` |
| no telemetry in the client | **test** — `tests/no-telemetry.test.ts` |
| `src/rules` is the only legality authority | **convention** — structurally reinforced by there being one `analyzeMeld` |
| one owner per mutable state domain | **type system** for `GameState`/`DraftState` (`readonly` fields, checked in `tests/boundaries.test.ts`); **convention** elsewhere |
| `core` does not depend upward | **none** — currently violated, ARCH-009 |
| scene state reset on relaunch | **convention** — ARCH-018 |

The invariants these mechanisms protect, and the scenarios that exercise them,
are in [INVARIANTS.md](INVARIANTS.md).

## Lifecycles and cleanup

| Lifecycle | Owner | Must be released |
|---|---|---|
| boot | `src/main.ts` | nothing (page lifetime) |
| local match / tutorial | `GameScene` | bus + settings + app-visibility subscriptions, AI timer, hesitation timer, guard timer, emote timers, ambience, the `pointercancel` listener, playlog human seat |
| online lobby | `OnlineScene` | `NetClient`, bus + connectivity subscriptions, the offscreen DOM input, debug hooks |
| online match | `GameScene` (client) / room (server) | socket subscriptions, pending-proposal timeout, turn-timer tick, reconnect ticker |
| reconnect | `NetClient` schedule + server grace window | reconnect timer; the seat is released by the server's grace expiry or `sweep` |
| rematch | `RoomManager.recycleForRematch` | the room is reused in place, not recreated |
| server process | `server/index.ts:shutdown` | three intervals, the WebSocket server, the HTTP server, with a 5s hard-exit backstop |

Every scene releases through `this.events.once('shutdown', …)`. `GameScene`
additionally resets ~45 fields in `resetForNewMatch()` because the scene is
relaunched rather than reconstructed — a new field needs an entry there, not a
field initializer.

### Explicit state machines

These are the lifecycles whose states are a value you can read, not a set of booleans to infer:

| Machine | States | Owner | Transitions |
|---|---|---|---|
| match | `GameState.phase`: `playing` \| `finished` (+ `winnerId`) | `src/rules` transitions, held by `GameStore` (local) / `RoomManager` (online) | only `applyGameAction` locally; only `submitTurn`/`drawEndTurn`/`advanceStalledTurns` on the server |
| turn | `GameState.activePlayerIndex` / `turn` | same | one per accepted action; no partial turn is ever committed (the draft never leaves the client until FEITO) |
| draft | `DraftEditor` history (untouched / edited / confirmable), `canConfirm()` | `DraftEditor` | its own edit methods; discarded whole on confirm, draw, rejection or `state_sync` |
| lobby screen | `OnlineScene.phase`: `idle` \| `join` \| `name` \| `lobby` \| `custom` \| `party` \| `browse` \| `queue` \| `matched` \| `error` | `OnlineScene` | its own handlers, driven by server messages — a **screen** machine mirroring server state, never an authority (ARCH-003) |
| connection | `NetClient` status: `closed` \| `connecting` \| `open` \| `reconnecting` | `NetClient` | `connect`/`retryNow`/socket events; the reconnect schedule is the client's, the seat grace window is the server's |
| room | `RoomManager` room record: lobby → started (`state !== null`) → finished → recycled for rematch → swept/closed | `RoomManager` | `startGame`, turn actions, `recycleForRematch`, `sweep`. A rematch reuses the room in place and resets per-match state (`rev`, ready flags, `missedTurns`, `winningMove`), so no prior-match value survives into the new one |

Everything that can refuse does so with a `ReasonCode` — see *Invalid transitions* above. Nothing
here is a generic state-machine framework, and none of it should become one.

## Where new code goes

| Change | Goes in | Never in |
|---|---|---|
| A rule, a legality check, a new reason code | `src/rules` (+ tests in `tests/rules.test.ts`) | a scene, the server, the UI |
| Table editing behaviour | `src/mexe-mode` | `GameScene` |
| Layout, snapping, zoom maths | `src/table` (pure, unit-tested) | `GameScene` |
| A new widget, panel or helper affordance | `src/ui` | `src/rules` |
| AI behaviour or a new personality | `src/ai` | `src/game-state` |
| A new wire message or field | `src/net/protocol.ts` **and** `server/` together, bumping `PROTOCOL_VERSION` | client-only shortcuts |
| Player-visible text | `src/localization/i18n.ts` (both locales) | inline literals |
| A new asset | `public/assets/` + `src/assets/manifest.ts` + ASSETS.md | hardcoded paths |
| A setting | `src/core/settings.ts` (+ the settings panel) | scene-local state |
| A server error code | `SERVER_ERROR_CODES` in `src/net/protocol.ts` + copy in both locales | a free-form `message` the client parses |
| A server tuning knob | `server/config.ts` `loadConfig` + the OPERATIONS.md table | `process.env` read from an arbitrary module |
| Something to persist | its own small store next to its owner, with validation on read | a new key written from a scene |

Principles worth keeping:

- **No gameplay authority in the UI.** Scenes render and forward intents. If a
  question is "is this legal?", `src/rules` answers it.
- **No `Math.random` or `Date.now` in gameplay.** Use the state's seeded rng, so
  a seed replays exactly.
- **The server is authoritative online.** A client never decides a turn was
  legal, never advances `rev`, and never sees hidden information.
- **Client and server share `src/rules`.** Adding a validation rule to only one
  side is drift; add it to `src/rules` and both get it.
- **Docs are part of the change.** A rules change updates GAME_RULES.md, a
  protocol change updates MULTIPLAYER.md, a new asset updates ASSETS.md.
