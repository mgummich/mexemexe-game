# Architecture

MEXEMEXE! is a Vite + TypeScript + Phaser client with an optional Node +
`ws` server for online rooms. This document describes the code as it is
built; the ruleset it implements lives in [GAME_RULES.md](GAME_RULES.md).
The measured baseline behind the maps below — module-by-module evidence, the
dependency-edge classification and the architecture risk register — is
[ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md).

## Layering

```
rules/          pure functions, no Phaser/DOM/Date/random   ← the only rules authority
core/           event bus, seeded rng, settings, persistence, play log, PWA, lifecycle
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
persistence→cosmetics, playlog→ui/viewport, pwa→verification). Treat "put it in
core" as a smell, not a default — see
[ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) ARCH-009.

**Hard rule:** `src/rules` is pure and deterministic — no Phaser, no DOM, no
`Date`, no `Math.random`. Everything in it is testable in Vitest without a
browser. The Phaser layer renders state and emits intents; it never decides
legality.

## Modules

| Path | Responsibility |
|---|---|
| `src/rules` | deck, shuffle, deal, meld analysis, table validation, turn legality, win check, serialize |
| `src/core` | `EventBus` (`events.ts`), seeded `mulberry32` rng, settings + `localStorage` persistence, session play log, objective hints, results summary, error recovery, app sleep/resume, PWA registration |
| `src/game-state` | `GameStore`: game creation, turn application, AI scheduling |
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
interface Meld { id: string; cards: Card[] }
interface GameState {
  seed: number; players: PlayerState[]; activePlayerIndex: number;
  table: Meld[];        // committed, always valid
  drawPile: Card[]; turn: number; winnerId: string | null;
  phase: 'playing' | 'finished'; config: RulesConfig;
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
`applyConfirmedTurn`, `drawAndEndTurn`, `timerExpireTurn` (the server's online
turn-timer expiry path — see MULTIPLAYER.md §7b; local play never starts a
timer), `checkWinner`, `fewestCardsWinner`,
`serializeGameState` / `deserializeGameState` (`GAME_STATE_VERSION = 2`).

**Joker assignments** are derived on demand from the run/group search, never
stored in place of the card: jokers keep their own identity on the table, in
saves and on the wire.

**Draw-pile exhaustion ends the game immediately** — `drawAndEndTurn` on an
empty pile returns `phase: 'finished'` with `fewestCardsWinner`, ties broken by
earliest seat.

**Card conservation** is derived from `config.deckCount * (52 + config.jokersPerDeck)`
both in `deserializeGameState` and in the server's `assertConservation`, never
hardcoded.

## Local game flow

```
MenuScene → SetupScene → GameScene
  START_TURN(player)
   ├─ human: edit draft (mexe-mode) → FEITO if canConfirmTurn → applyConfirmedTurn
   │                                └─ or COMPRAR → drawAndEndTurn
   ├─ ai:    plan (sync, budgeted) → confirm a legal move, or drawAndEndTurn
   └─ then:  checkWinner → WinScene, else START_TURN(next)
```

Events on the bus, and what each one actually is:

| Event | Publisher | Subscribers | Kind |
|---|---|---|---|
| `turn:start` | `GameStore.postTurn` | `GameScene.onTurnStart`, playlog | **control flow** — advances the local turn cycle. Online, `GameScene` calls `onTurnStart()` directly instead. |
| `game:won` | `GameStore.postTurn` | `GameScene.onWin`, playlog | **control flow** |
| `turn:confirmed`, `turn:drawn` | `GameStore` | playlog | notification |
| `viewport:changed` | `main.ts` resize handler | every scene, playlog | notification |
| `ai:thought` | `GameScene.runAiTurn` | *none* — the same value is written straight to `debugApi.lastAiThought` | dead |
| `game:ready`, `draft:changed` | *none* | *none* | declared in `GameEvents`, never used |

The control-flow entries are why `GameScene` guards every async continuation
with `sceneGone` and a store-identity check: the bus is a process-global
singleton, so an event can reach a scene that has already shut down. See
ARCH-006/ARCH-008 in [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md).

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

`mulberry32(seed)` in `src/core/rng.ts`. The seed comes from `?seed=` or the
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

## Failure isolation

- Rules throw typed errors, caught at the UI boundary — never a dead scene.
- Missing assets → procedural fallback textures.
- Audio failures → silent no-op.
- AI exceptions → fall back to drawing and ending the turn.
- Corrupt save → fresh game with a warning (`src/core/error-recovery.ts`).
- `window.onerror` → captured into `__MEXE__.errors` for Playwright.

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
  and one process holds many rooms, so `server/rooms.ts` calls the same `src/rules`
  functions directly and builds its own deal. Turn application is shared; event
  announcement is client-only. (ARCH-004.)
- **`GameScene` currently owns more than presentation** — online state
  adaptation, AI scheduling and the online turn clock live there. That is a
  known concentration, not the intended end state. (ARCH-001/ARCH-002.)

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

The last row is the one that matters most and the one nothing currently
enforces mechanically — see ARCH-019.

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
