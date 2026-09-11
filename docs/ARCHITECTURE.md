# Architecture

MEXEMEXE! is a Vite + TypeScript + Phaser client with an optional Node +
`ws` server for online rooms. This document describes the code as it is
built; the ruleset it implements lives in [GAME_RULES.md](GAME_RULES.md).

## Layering

```
rules/          pure functions, no Phaser/DOM/Date/random   ← the only rules authority
core/           event bus, seeded rng, settings, persistence, play log, PWA, lifecycle
game-state/     GameStore: turn lifecycle over rules/
mexe-mode/      table draft editor (break/split/merge/move, undo/redo/reset)
ai/             SimpleAi, RearrangerAi, personalities        ← rules + game-state only
net/            wire protocol, WebSocket client, view→state projection
table/ ui/ scenes/ assets/ audio/ cosmetics/                  ← Phaser + DOM layer
localization/ tutorial/ demo/ verification/                   ← support
server/         authoritative room server (imports src/net/protocol + src/rules)
```

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
| `server/` | `index.ts` process + health check, `rooms.ts` room/turn authority, `connections.ts` socket registry, `config.ts` env parsing, `log.ts` redacting logger |

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

`RulesConfig` (`src/rules/types.ts`, `DEFAULT_RULES`) is the single balance-knob
block; its defaults are documented in GAME_RULES.md.

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
`applyConfirmedTurn`, `drawAndEndTurn`, `timerExpireTurn` (implemented but not
wired to any UI — see GAME_RULES.md), `checkWinner`, `fewestCardsWinner`,
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

Typed events on the bus: `game:ready`, `turn:start`, `draft:changed`,
`turn:confirmed`, `turn:drawn`, `game:won`, `ai:thought`.

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
