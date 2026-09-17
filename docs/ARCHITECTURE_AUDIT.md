# Architecture audit — baseline

**Canonical for:** the architecture risk register and the evidence behind it.

**Not canonical for:** the architecture itself. [ARCHITECTURE.md](ARCHITECTURE.md)
describes what the code is; this file records what was measured, what is risky
about it, and the earliest phase in which each risk may be acted on.

This is a discovery baseline taken from the code as built (post Phase 0
cleanup). No structural change was made while producing it. Every claim below
cites a file and a symbol; anything not evidenced is listed under
[Evidence gaps](#evidence-gaps).

**Phase numbering** used in "Earliest phase" refers to the architecture work
programme (Phase 0 = repository cleanup, Phase 1 = this audit, Phase 2 =
enforcement/low-risk corrections, Phase 3 = ownership extraction, Phase 4 =
layer/boundary restructuring). It is not the product roadmap in
[ROADMAP.md](ROADMAP.md).

---

## 1. Measured shape

19,280 lines of TypeScript across `src/` and `server/`, in 17 top-level
modules. Five files hold 47% of it:

| File | Lines | Verdict |
|---|---|---|
| `src/scenes/GameScene.ts` | 4,539 | MULTI-RESPONSIBILITY CONCENTRATION |
| `src/scenes/OnlineScene.ts` | 1,762 | MULTI-RESPONSIBILITY CONCENTRATION |
| `server/rooms.ts` | 968 | COHESIVE LARGE MODULE |
| `src/localization/i18n.ts` | 944 | COHESIVE LARGE MODULE (data) |
| `server/index.ts` | 916 | MULTI-RESPONSIBILITY CONCENTRATION |
| `src/ai/ai.ts` | 601 | MULTI-RESPONSIBILITY CONCENTRATION (mild) |

The verdicts are argued in §7. None of them is based on line count.

## 2. Module map

Only meaningful ownership boundaries are listed. `env` is the runtime the
module can run in: `pure` (node or browser, no platform API), `browser`,
`node`.

| Path | Responsibility | Owns state | Public API | Depends on | Depended on by | Side effects | env | Category |
|---|---|---|---|---|---|---|---|---|
| `src/rules` | deck, deal, meld analysis, table validation, turn legality, win, serialize | no (pure functions over `GameState`) | `analyzeMeld`, `canConfirmTurn`, `applyConfirmedTurn`, `drawAndEndTurn`, `timerExpireTurn`, `checkWinner`, `createNewGame`, `cardsConserved`, `serializeGameState` | `rules/rng` (in-module since Wave 2A) | everything | none | pure | domain |
| `src/game-state` | committed local state ownership + announcement (the deal and the transitions moved to `rules` in Wave 2A) | `GameStore.state` | `GameStore` | `rules`, `core/events` | scenes, demo, tests | emits on the global bus | pure-ish | application |
| `src/mexe-mode` | draft table under edit, undo/redo/reset | `DraftEditor` melds + history | `DraftEditor` | `rules` | scenes, ai, table | none | pure | domain |
| `src/ai` | move generation, search, personality, difficulty, presentation constants | per-call only (search scratch) | `createAi`, `SimpleAi`, `RearrangerAi`, `PERSONALITY_STYLE`, `DIFFICULTIES` | `rules`, `mexe-mode`, `core/persistence` (type only) | `scenes`, `demo` | `performance.now()` budgeting | pure-ish | domain + presentation (mixed, ARCH-015) |
| `src/net/protocol.ts` | wire types, redaction (`buildView`), boundary validation, state digest | no | `parseClientMessage`, `buildView`, `digestOfState`, `PROTOCOL_VERSION` | `rules` | `net/client`, scenes, `server/` | none | pure | domain (shared contract) |
| `src/net/client.ts` | browser socket, reconnect schedule, token/name storage | socket + reconnect attempt + trace | `NetClient`, `readDisplayName`, `readRecentRooms` | `protocol`, `core/playlog`, `core/pwa`, `config` | `scenes` | WebSocket, `localStorage`, timers, `Date.now` | browser | infrastructure |
| `src/net/viewToState.ts` | redacted `GameView` → local-shaped `GameState` | no | `viewToState` | `rules` types | `GameScene` | none | pure | application (anti-corruption layer) |
| `src/core` | bus, rng, settings, persistence, playlog, PWA, lifecycle, objective, intensity, results-summary, error-recovery, haptics | `bus` handlers, `settings` save, `playlog` ring | per-module | `rules`, `ui`, `cosmetics`, `ai`, `localization`, `verification` | everything | `localStorage`, `navigator`, `document`, `location.reload` | mixed | **bucket, not a layer** (ARCH-009) |
| `src/table` | meld layout, snap targets, zoom, tap destinations, editor layout | no | pure layout functions | `rules`, `mexe-mode`, `assets`, `ui` | `scenes` | none | pure | presentation support |
| `src/ui` | widgets, panels, regions, viewport profile, helper flags, feel | `view()` profile | per-module | `assets`, `audio`, `core`, `cosmetics`, `localization`, `table`, `verification` | scenes, core | Phaser, DOM | browser | presentation |
| `src/scenes` | Boot, Menu, Setup, Game, Online, Tutorial, Win | scene-local UI state (large, see §4) | Phaser scene lifecycle | everything | `main.ts` | Phaser, DOM, timers, audio, sockets, storage | browser | presentation + application (mixed) |
| `src/verification` | `window.__MEXE__` debug surface | mutable `debugApi` singleton | `debugApi`, `installDebugApi` | `core`, `net`, `ui`, `rules` | scenes, ui, core, audio, main | `window` | browser | observability (ARCH-011) |
| `src/localization` | pt-BR/en-US dictionaries, `t()` | current locale | `t`, `setLocale` | — | everywhere | none | pure | cross-cutting utility |
| `src/tutorial` | scripted steps, fixture table, step director | director step index | `TutorialDirector`, `buildTutorialState` | `rules`, `localization` | `GameScene` | none | pure | application |
| `src/assets` `src/audio` `src/cosmetics` `src/demo` | manifest + fallbacks, sfx/music, themes, showcase states | audio playback state | per-module | Phaser, `core`, `rules` | scenes, ui | Phaser audio, network fetch | browser | platform / presentation support |
| `server/rooms.ts` | authoritative room + match aggregate | `RoomInternal` per code | `RoomManager` | `rules`, `net/protocol` | `server/index.ts` | injected clock only | node | domain/application (server) |
| `server/index.ts` | process, HTTP, WebSocket, dispatch, broadcast, rate limits, timers, shutdown | module-level singletons (`rooms`, `queue`, `sockets`, `connections`) | none (entrypoint) | all server modules, `net/protocol` | — | sockets, HTTP, timers, `Date.now`, process signals | node | infrastructure + orchestration (ARCH-013) |
| `server/connections.ts` | socket registry + rate-limit windows as pure functions over maps | no (caller owns maps) | `attachSocket`, `hitFlood`, `clientIp`, … | — | `server/index.ts` | none | node | infrastructure (well isolated) |
| `server/matchmaking.ts` | FIFO casual queue | `MatchQueue` entries | `MatchQueue` | — | `server/index.ts` | none | node | application (server) |
| `server/metrics.ts` `server/config.ts` `server/log.ts` | counters + Prometheus text, env parsing, redacting logger | counters, parsed config | `counters`, `renderMetrics`, `config`, `createLogger` | — | `server/index.ts` | `process.env`, stdout | node | observability / infrastructure |

## 3. Dependency graph (measured)

Edges below are the actual module-level import edges, derived from every
`from '…'` in `src/` and `server/`.

```text
rules ──────────────► rules/rng (seeded, in-module)    OK (ARCH-010 resolved)
game-state ─────────► rules, core/events              EXPECTED + bus coupling (ARCH-004)
mexe-mode ──────────► rules                           EXPECTED
ai ─────────────────► rules, mexe-mode, core(type)    EXPECTED
net ────────────────► rules, core, localization, config   EXPECTED
table ──────────────► rules, mexe-mode, assets, ui    EXPECTED
ui ─────────────────► assets, audio, core, cosmetics, localization, table, verification
scenes ─────────────► (everything)                    EXPECTED for a composition point
core ───────────────► rules, ui, cosmetics, ai, localization, verification   INVERTED (ARCH-009)
verification ───────► core, net, rules, ui            EXPECTED for a debug surface
audio ──────────────► core, verification              PRESENTATION-LEAK (ARCH-011)
server ─────────────► src/rules, src/net/protocol                 EXPECTED (shared authority)
```

Edge classification, with the reason it matters:

| Edge | Class | Why it matters |
|---|---|---|
| `server/*` → `src/rules`, `src/net/protocol` | EXPECTED | This is the invariant "client and server share rule logic", enforced by there being exactly one `analyzeMeld`. |
| ~~`src/rules` → `src/core/rng`~~ | RESOLVED (Wave 2A) | The rng moved into `src/rules/rng.ts`, interface and `mulberry32` together, so the contract for gameplay randomness now sits in the layer that consumes it. |
| `src/core/settings` → `src/ui/helpers` | INVERTED | Persisted settings reach up into the presentation layer to compute `HelperFlags`. Makes `core` unusable without `ui`. |
| `src/core/persistence` → `src/cosmetics`, `src/ai` | INVERTED | Save validation depends on presentation catalogues and on the AI's `Difficulty` union. |
| `src/core/playlog` → `src/ui/viewport` | PLATFORM-LEAK | An observability module reads the browser viewport profile directly. |
| `src/core/pwa` → `src/verification/debug-api` | PLATFORM-LEAK | Feature code writes into the debug singleton. |
| `src/audio/music`, `src/ui/*`, `src/scenes/*` → `verification/debug-api` | PRESENTATION-LEAK | Same: the test surface is a write target inside product code rather than an observer of it. |
| ~~`server/rooms.ts` re-implements `createNewGame` inline~~ — **resolved in Wave 2A**, both callers use `rules/createNewGame` | DUPLICATED-LOGIC | Deal construction exists twice: `src/game-state/store.ts:createNewGame` and the room's `startGame`. Deliberate (see ARCH-004) and currently identical, but nothing enforces that. |
| `src/core/persistence` ↔ `src/ai/ai` | CYCLE | Type-only in both directions; no runtime cycle. |
| `src/core/pwa` → `verification/debug-api` → `src/net/client` → `src/core/pwa` | CYCLE | One edge (`debug-api` → `client`) is type-only, so no runtime cycle exists. |

Those two are the **only** import cycles in the repository (Tarjan SCC over
every resolved relative import). Both are erased at runtime.

## 4. State ownership map

| State | Authoritative owner | Writers | Readers | Lifetime | Serialized | Derived | Multiple-writer risk |
|---|---|---|---|---|---|---|---|
| Committed local `GameState` | `GameStore` (`src/game-state/store.ts`) | `GameStore.dispatch(action)` only | GameScene, WinScene, playlog, debugApi | one local match | `serializeGameState` (v2) | canonical | **yes, latent** — `get()` returns the live object (ARCH-005) |
| Mexe draft | `DraftEditor` (`src/mexe-mode/draft.ts`) | GameScene input handlers via editor methods | GameScene render, `canConfirmTurn` | one turn | never | canonical | no — every accessor clones |
| AI decision state | per-call inside `src/ai` | AI search | AI only | one decision | no | derived | no |
| Scene UI state (selection, focus, zoom/pan, editor scroll, emotes, notices, timers) | `GameScene` fields (~45) | GameScene methods | GameScene | scene instance; reset in `resetForNewMatch` | no | canonical | **yes** — reset is manual (ARCH-018) |
| Lobby state (phase, code, seat, players, settings, party, queue, browse, in-flight) | `OnlineScene` fields (~40) | OnlineScene handlers | OnlineScene render | scene instance | no | mirror of server truth | no, but implicit machine (ARCH-003) |
| Settings + progress + cosmetics | `settings` singleton (`src/core/settings.ts`) over `persistence` | `settings.update*` only | everywhere | app | `mexe-save` envelope | canonical | no |
| Play log | `playlog` singleton (`src/core/playlog.ts`) | bus subscriptions + direct `record()` calls | debugApi, WinScene | module load → page unload | export only | derived | no; but never torn down (ARCH-007) |
| Connection state | `NetClient` (`src/net/client.ts`) | NetClient | OnlineScene, GameScene | socket | reconnect token in `localStorage` | canonical | no |
| Authoritative room/match state | `RoomInternal` in `RoomManager` (`server/rooms.ts`) | `RoomManager` methods only | `server/index.ts` broadcast path | room lifetime | no (in-memory) | canonical | no |
| Reconnect seat ownership | `Seat.token` in `RoomManager` | `RoomManager.reconnect/disconnect` | `server/index.ts` | room lifetime | client keeps token in `localStorage` | canonical | no |
| Turn timer | `RoomInternal.turnStartedAt/turnBudgetMs` (server) | `RoomManager.startTurnClock`, `advanceStalledTurns` | client renders `turnMsLeft` only | turn | no | canonical | no |
| Socket registry, rate-limit counters | module-level maps in `server/index.ts` | `server/index.ts` | `server/connections.ts` helpers | process | no | canonical | no (single-threaded), but untestable in isolation (ARCH-013) |
| PWA/connectivity | `src/core/pwa.ts` | browser events | OnlineScene, NetClient | app | no | derived | no |
| Debug surface | `debugApi` singleton | **many** modules write into it | Playwright | app | no | mirror | **yes, by design** (ARCH-011) |

Searched explicitly for external mutation of store-owned objects
(`store.get().<field> =`, `.push`, `.splice` on committed state): **none found**
outside `src/rules` itself. ARCH-005's missing barrier is now the type system,
not a present bug.

## 5. Authority matrix

| Concern | Authority | Validators | Consumers | Duplicated authority |
|---|---|---|---|---|
| Meld legality | `analyzeMeld` (`src/rules/rules.ts`) | itself | UI hints, snap, AI, server | none — `isValidRun`/`isValidGroup`/`validateTable`/`getInvalidMeldReasons`/`table/snap.ts` are all wrappers |
| Turn legality | `canConfirmTurn` | itself | `DraftEditor.analyze`, `GameScene.feitoAccepted`, `RoomManager.submitTurn` | none; the client pre-check is an optimistic UX gate over the same function the server re-runs |
| Winner | `checkWinner` / `fewestCardsWinner` | rules | GameStore, RoomManager | none |
| Draw result | `drawAndEndTurn` | rules | GameStore, RoomManager | none |
| Deal / shuffle seed | offline `GameStore.createNewGame`; online `RoomManager.genSeed` | — | — | one `createNewGame` since Wave 2A; the server still owns online seed choice (see ARCH-004) |
| AI choice | `src/ai` (`createAi(...).decide`) | — | GameScene | none |
| Local draft | `DraftEditor` | `canConfirmTurn` | GameScene | none |
| Online match state | server `RoomManager` | `canConfirmTurn` + `assertConservation` | all clients via `buildView` | none; client `verifyOnlineHash` only *detects* divergence |
| Hidden hand privacy | `buildView` (`src/net/protocol.ts:382`) | test `OH-26` | server broadcast path | none |
| Room membership / host / ready | `RoomManager` | itself | OnlineScene renders the answer | none — OnlineScene never writes `ready` locally |
| Timer expiry | `RoomManager.advanceStalledTurns` + `timerExpireTurn` | rules | clients render remaining ms | none |
| Reconnect seat ownership | `Seat.token` in `RoomManager` | `RoomManager.reconnect` | NetClient | none |
| Rendering / layout | `src/ui/viewport` + `src/ui/regions` + `src/table` | — | scenes | none |
| Settings | `src/core/settings` | `persistence` load validation | everywhere | none |
| Tutorial permission | `GameScene.tutorialAllows` over `TutorialDirector` | — | GameScene | a **second permission gate**, but subtractive only — it can refuse a legal action, never permit an illegal one (ARCH-021) |
| Assets | `src/assets/manifest.ts` + BootScene probe | BootScene | Phaser | none |

## 6. Data flows

### Local human turn

```text
pointer/key (GameScene.wireDrag, handleShortcut)
 → DraftEditor mutation (playCard/moveCard/...)
 → DraftEditor.analyze() → rules.canConfirmTurn        [legality]
 → GameScene.renderAll() paints reasons/checklist
 → FEITO → GameScene.feitoAccepted → GameScene.dispatch({confirmTurn})
 → GameStore.dispatch → applyGameAction → rules.applyConfirmedTurn → new immutable GameState
 → bus.emit('turn:confirmed' + 'turn:start' | 'game:won') → playlog        [notification only]
 → outcome.finished ? GameScene.onWin() : GameScene.onTurnStart()         [explicit, ARCH-006 resolved]
 → renderAll
```

### AI turn

```text
bus 'turn:start' → GameScene.onTurnStart
 → Phaser delayedCall(aiThinkDelay)                    [scheduling owned by the scene]
 → createAi(personality, settings.aiDifficulty).decideSliced(state)
 → candidates (findHandMelds/tryExtend/search*) filtered through rules
 → guard: scene alive && store.get() unchanged
 → debugApi.lastAiThought = …                                             [ARCH-008 resolved]
 → GameScene.dispatch({confirmTurn} | {drawAndEndTurn})                   [same path as the human]
 → presentAiMove → renderAll
```

### Online turn

```text
GameScene.onFeitoOnline → NetClient.submitTurn(rev, melds)
 → ws → server/index.ts handleMessage 'submit_turn'
 → RoomManager.submitTurn → claimTurn(rev) → canConfirmTurn → applyConfirmedTurn
 → commitTurn: rev++, assertConservation, startTurnClock
 → server/index.ts broadcastStateSync → buildView(state, seat) per seat   [redaction]
 → NetClient 'state_sync' → GameScene.onOnlineStateSync
 → viewToState(view) → new GameStore(...)   [store used as a container only]
 → verifyOnlineHash(digestOfState) → onTurnStart() called directly        [server is the authority; no local commit]
 → renderAll
```

### Reconnect

```text
socket close → NetClient.scheduleReconnect (bounded, jittered)
server: RoomManager.disconnect marks seat.connected=false, disconnectedAt=now
        sweep()/grace window keeps the seat for disconnectGraceMs
client: reconnect with token (localStorage, endpoint-scoped)
server: RoomManager.reconnect(token) → same seat
        → server/index.ts moveSocket + broadcast room_state/state_sync
client: GameScene.onOnlineStatusChange + onAppVisible → requestResync
        → onOnlineStateSync replaces the whole local store
```

### Persistence

```text
settings.update(patch) → storeSave(save) → localStorage 'mexe-save' (versioned envelope)
boot: loadSave() → validation → on corruption src/core/error-recovery + defaults
```

No duplicate transformation was found in these flows. `viewToState` is the one
projection, and it is deliberately lossy (placeholder cards) with the
constraint documented in the file.

## 7. Concentration verdicts

### `src/scenes/GameScene.ts` — MULTI-RESPONSIBILITY CONCENTRATION

Not because it is 4,539 lines. Because it is the sole host of:

- **~14 state domains** in ~45 fields: render objects, drag, selection/focus,
  zoom/pan, portrait Mexe editor, hand scroll, online connection view, online
  turn timer, reconnect ticker, emote/reaction cooldowns, tutorial progress,
  hesitation timer, pause, presentation gating.
- **8 side-effect kinds**: Phaser scene graph, Phaser timers (28 call sites),
  DOM (`canvas.addEventListener`), audio, haptics, `localStorage` (via
  settings/playlog), WebSocket (via `NetClient`), `Date.now`, plus one
  `Math.random` (ARCH-017).
- **Unrelated reasons to change**: a rendering tweak, an AI pacing change, a
  protocol field, a tutorial step, a reconnect policy and an accessibility
  setting all edit this file.
- **19 subsystem imports**, including both `net` and `ai` — the only file that
  depends on both the multiplayer client and the AI engine.
- **Lifecycle complexity**: `resetForNewMatch()` manually resets ~45 fields and
  `shutdown` tears down 10 distinct resources.
- **Testability**: none of the application logic it hosts (online state
  adaptation, AI scheduling, turn orchestration) has a unit test; it is covered
  only through Playwright.

The genuinely scene-shaped parts are rendering, input, layout, animation and
Phaser lifecycle. The application/domain parts currently hosted here are:
online state adaptation (`wireOnline`, `onOnlineStateSync`, `verifyOnlineHash`,
`onOnlineRejected`, `onOnlineGameOver`), match orchestration
(`onTurnStart`/`runAiTurn` AI scheduling), the online turn clock, the reconnect
policy reaction, and the tutorial step machine.

### `src/scenes/OnlineScene.ts` — MULTI-RESPONSIBILITY CONCENTRATION

A 10-state machine (`phase: 'idle' | 'join' | 'name' | 'lobby' | 'custom' |
'party' | 'browse' | 'queue' | 'matched' | 'error'`) exists as a single string
field with transitions scattered across ~25 handlers and 15 render methods,
plus connection status, room mirror state, matchmaking queue state, room
discovery listings, in-flight request guards, an offscreen DOM input for mobile
keyboards, PWA connectivity reaction and the debug hook installation. The state
machine is real and implicit; the rendering is genuinely scene work.

### `server/rooms.ts` — COHESIVE LARGE MODULE

One aggregate (`RoomInternal`) with one invariant set, one lifecycle, and a
single writer. It takes no sockets and starts no timers (`sweep` and
`advanceStalledTurns` are called by the host), its clock/codes/tokens/seed are
injected for tests, and `tests/server/*` drive it directly. Party history,
activity feed, visibility and reaction cooldowns are all room-scoped state, so
they belong to the aggregate. No split is warranted today.

### `server/index.ts` — MULTI-RESPONSIBILITY CONCENTRATION

Composition root **and** protocol dispatcher (`handleMessage`, 365 lines) **and**
broadcaster **and** rate limiter **and** matchmaking orchestrator **and** HTTP
health/metrics host **and** timer owner **and** shutdown handler, over
module-level singletons (`rooms`, `queue`, `sockets`, `connections`,
`connectionsByIp`, `roomCreatesByIp`) that cannot be constructed twice. The
pure parts were already extracted into `connections.ts`/`matchmaking.ts`/
`metrics.ts`; what remains is orchestration that can only be tested by opening
a real socket.

### `src/ai/ai.ts` — MULTI-RESPONSIBILITY CONCENTRATION (mild)

Engine concerns (candidate generation, three rearrangement searches,
comparison/evaluation, time budgeting) sit beside product concerns (difficulty
tiers, personality traits) and presentation concerns (`PERSONALITY_STYLE` with
emote keys and colours, `AI_SPEED_SCALE`, `aiReasonKeySuffix` and the i18n
reason-key list). The public interface (`AiPlayer.decide/decideSliced`) is clean
and small; the file behind it is not layered.

## 8. Side-effect map

| Effect | Where it lives | Contained at the right boundary |
|---|---|---|
| Phaser scene graph / input | `src/scenes`, `src/ui` | yes |
| DOM | `src/main.ts` (portrait hint, error toast), `OnlineScene.ensureTextInput`, `GameScene` pointercancel | mostly — `main.ts` hosts two ad-hoc DOM overlays |
| `localStorage` | `src/core/persistence.ts`, `src/net/client.ts` only | yes |
| Timers | `src/scenes` (36), `src/net/client.ts` (4), `server/index.ts` (4), `src/audio/music.ts` | yes for net/server; concentrated in GameScene |
| `Date.now` / wall clock | scenes, `net/client`, `server/index.ts`, `RoomManager` (injected default) | yes — absent from `src/rules` |
| Randomness | seeded `createRng` in `game-state` and `server/rooms.ts`; `Math.random` in `net/client` (reconnect jitter), `audio/sfx` (detune), `GameScene.reactToPlayerMexe` | yes for gameplay; the GameScene use is presentation-only (ARCH-017) |
| WebSocket | `src/net/client.ts`, `server/index.ts` | yes |
| Service worker | `src/core/pwa.ts`, `public/` | yes |
| Audio | `src/audio` | yes |
| Haptics | `src/core/haptics.ts` | yes |
| Logging | `server/log.ts` (redacting), `console.warn` in `GameScene.verifyOnlineHash` | yes |
| Clipboard / share | `OnlineScene.copyCode`, `shareCode` | yes |
| URL / query params | `src/config.ts` (`?ws=`), `src/verification/debug-api.ts` (`?seed=`), `src/demo` (`?showcase=`) | yes |
| `location.reload` | `settings.resetData()` | a platform effect inside `core` (ARCH-009) |

`src/rules` performs no side effect of any kind. Verified by grep for
`Math.random`, `Date`, `performance`, `window`, `document` across
`src/rules`, `src/mexe-mode`, `src/game-state`: zero hits (the only hits in that
sweep were `performance.now()` inside `src/ai` time budgeting).

## 9. Lifecycle map

| Phase | Owner | Resources acquired | Released by |
|---|---|---|---|
| boot | `src/main.ts` | Phaser game, debug API, locale, music, PWA registration, resize + error listeners | never (page lifetime) |
| menu / setup | `MenuScene`, `SetupScene` | bus subscription, ambience | `events.once('shutdown')` |
| local match | `GameScene` | store, editor, 10 timer/listener kinds, ambience, playlog human seat | `shutdown` handler (explicit, 10 teardowns) + `resetForNewMatch` on relaunch |
| tutorial | `GameScene` + `TutorialDirector` | same as local match plus overlay | same |
| online lobby | `OnlineScene` | `NetClient`, bus + connectivity subscriptions, DOM input, debug hooks | `shutdown` → `unsubs`, `destroyJoinInput` |
| online match | `GameScene` (client) / `RoomManager` (server truth) | socket subscriptions, pending-timeout timer, turn-timer tick, reconnect ticker | `shutdown` |
| win | `WinScene` | bus subscription | `shutdown` |
| app hidden / visible | `src/core/lifecycle.ts` consumers (`GameScene`, `audio/music`) | visibility listeners | returned unsubscribe |
| disconnect / reconnect | `NetClient` (schedule) + `RoomManager` (grace) | reconnect timer, seat retention | attempt exhaustion / grace expiry / `sweep` |
| rematch | `RoomManager.recycleForRematch` + `server/index.ts:recycleFinishedRoom` | room recycled in place | room deletion |
| scene shutdown | each scene's `events.once('shutdown')` | see above | — |
| socket/server shutdown | `server/index.ts:shutdown(signal)` | intervals, wss, http | signal handler + 5s hard exit |

Unclear ownership: **`playlog`** subscribes to the global bus at module load and
never unsubscribes (ARCH-007); **`debugApi`** accumulates closures set by whichever
scene ran last and is only partially reset on scene change (ARCH-011).

## 10. Architecture enforcement today

| Rule | Enforced by |
|---|---|
| `src/rules` is the only legality authority | **convention + review**. No lint rule, no boundary test. Reinforced in practice by there being exactly one `analyzeMeld` implementation. |
| Rules stay pure (no Phaser/DOM/Date/`Math.random`) | **convention**. `tests/rules.test.ts` runs in a node env, so a `document` reference would fail *if the code path is executed*; nothing scans the source. |
| Gameplay randomness is seeded | **tests** (`rules.test.ts` determinism, `probes.test.ts` 40 seeds) |
| UI is not gameplay authority | **types + convention** — scenes hold no rule functions, but nothing prevents adding one |
| Server authority online | **architecture + tests** (`tests/server/*`, `verify:multiplayer`) |
| Protocol client/server sync | **types** (`server/` imports `src/net/protocol`) + `PROTOCOL_VERSION` check at the wire boundary |
| Hidden-hand privacy | **types + tests** (`buildView` shape, `OH-26` frame scan) |
| One state owner | **convention**. `GameStore.get()` hands out a live reference. |
| No telemetry | **test** (`tests/no-telemetry.test.ts` source scan) — the only source-scanning architecture guard in the repo |
| Docs track contracts | **convention** (`AGENTS.md`, `WORKFLOW.md` §15) |
| Module layering / import direction | **not enforced**. `eslint.config.js` is `tseslint.recommended` + one unused-vars rule; there is no `no-restricted-imports`, no dependency-cruiser, no boundary test. |

## 11. Risk register

Priorities: **P0** correctness/privacy/authority · **P1** blocks later work ·
**P2** structural growth risk · **P3** organisation debt.

No P0 finding was identified. No correctness bug was found during this audit.

---

### ARCH-001 — GameScene hosts application and domain responsibilities

**P1 · OWNERSHIP**

**Evidence:** `src/scenes/GameScene.ts` — `wireOnline` (669), `onOnlineStateSync`
(756), `verifyOnlineHash` (801), `onTurnStart` (1010), `runAiTurn` (1341),
`updateTurnTimer` (1643), `resetForNewMatch` (409); 19 subsystem imports
including both `../ai/ai` and `../net/client`.

**Current behavior:** one Phaser scene owns rendering *and* match orchestration,
AI scheduling, online state adaptation, the online turn clock, tutorial
progression and reconnect reaction.

**Why it matters:** every future change to AI, protocol, tutorial or online
policy edits the same 4.5k-line file, and none of that logic can be unit-tested
without Phaser.

**Current risk:** concrete, not hypothetical — `resetForNewMatch` already exists
because forgotten field resets leaked between matches.

**Desired direction:** a match-orchestration owner (local and online) outside the
scene; the scene renders state and forwards intents.

**Do now:** documented here and in ARCHITECTURE.md §Ownership.

**Earliest phase:** Phase 3. **Do NOT do yet:** mechanical file-splitting of
GameScene by line count, or an extraction that precedes ARCH-004/ARCH-006.

---

### ARCH-002 — Online state adaptation lives in the presentation layer

**P1 · BOUNDARY**

**Evidence:** `GameScene.onOnlineStateSync` rebuilds `this.store = new
GameStore(viewToState(view))`, then reconciles draft loss, Mexe bonus, seat
mapping, notice text and hash verification in one 45-line method; `wireOnline`
registers eight socket subscriptions directly on the scene.

**Current behavior:** the server→client projection pipeline
(`GameView` → `viewToState` → store → reconcile → render) terminates inside a
scene method. `GameStore` is used online purely as a container — `confirmTurn`
and `drawEndTurn` are never called in that mode.

**Why it matters:** the online client has a real application layer, but it has no
home, so it cannot be tested against recorded server frames.

**Current risk:** the desync/resync policy, the seat-gap translation and the
draft-drop rule are only covered by browser e2e.

**Desired direction:** an online match session object owning socket
subscriptions, projection and reconciliation, emitting a view the scene renders.

**Do now:** documented.

**Earliest phase:** Phase 3. **Do NOT do yet:** a second protocol layer or a
client-side state mirror that could diverge from the server view.

---

### ARCH-003 — OnlineScene contains an implicit lobby state machine

**P1 · STATE**

**Evidence:** `src/scenes/OnlineScene.ts:106` — `phase` with 10 values; ~40
private fields; transitions written inline across `wireClient` (425),
`joinCode`, `commitName`, `startQueue`, `enterMatch`, `refreshListings`,
`backToMenu`; `inFlight: Set<string>` as an ad-hoc request guard.

**Current behavior:** lobby, connection, matchmaking, discovery and error
recovery all transition one string field from many places, and `rebuild()`
re-renders whatever it finds.

**Why it matters:** no single place enumerates legal transitions, so a new lobby
feature has to be reasoned about against 25 handlers.

**Current risk:** real but bounded — the comments record several bugs already
fixed in this area (in-flight double-click, offline error stuck state, stale
listing codes), which is exactly the failure mode an implicit machine produces.

**Desired direction:** an explicit, testable lobby machine outside the scene;
the scene renders a state and dispatches events.

**Do now:** documented.

**Earliest phase:** Phase 3. **Do NOT do yet:** rewriting the lobby UI or
introducing a state-machine library.

---

### ARCH-004 — GameStore is coupled to the global bus, so the server cannot reuse it

**P1 · COUPLING**

**Evidence:** `src/game-state/store.ts:2` imports the `bus` singleton and emits
from `confirmTurn`/`drawEndTurn`/`postTurn` (now one `dispatch`); `server/rooms.ts:5-8` states the
reason it calls `src/rules` directly; `server/rooms.ts:598-608` rebuilds the
deal that `createNewGame` already performs.

**Current behavior:** `GameStore` = committed state + turn application + global
event emission. The server needs the first two and must not have the third
(N rooms in one process on one bus would cross-talk).

**Why it matters:** this is a **real architectural boundary**, not an accident:
turn application is domain logic, event emission is application/presentation
wiring. They are fused in one class, so the shared part cannot be shared.

**Current risk:** deal construction is duplicated between client and server with
nothing enforcing that they stay identical. Both currently use the same
`createDeck`/`shuffleDeck`/`dealInitialHands` calls with `DEFAULT_RULES`.

**Desired direction:** separate "apply a turn to a state" (shareable, pure) from
"announce that a turn happened" (client-side). A shared `createGame(seed,
players, config)` both sides call.

**Status (Wave 2A): half resolved.** `createNewGame` moved into `src/rules` and
both `GameStore` and `RoomManager.startGame` now call it, so the deal exists
once and a seed produces the same game on both sides
(`tests/server/rooms.test.ts` → "shared deal"). What remains is the emission
half: `GameStore` still publishes `turn:start`/`game:won` on the global bus,
which is the same coupling as ARCH-006 and moves with it.

**Earliest phase:** Phase 3 (split emission from application), Phase 4 (share
the constructor with the server — done). **Do NOT do yet:** injecting a bus into
`GameStore` as a constructor parameter — that keeps the coupling and adds a seam
no one needs.

---

**Update (Wave 2B):** narrowed, not closed. `GameStore` still imports the bus,
but it now emits notifications only — the turn cycle advances on `dispatch`'s
returned outcome (ARCH-006). The reusable half is the pure `applyGameAction` in
`src/game-state/actions.ts`, which the server *could* share if the import
boundary were widened; it deliberately does not today, because `RoomManager`
also owns `rev`, seat and `processing` preconditions that a local store has no
concept of. Semantics are aligned; authority is not shared.

---

### ARCH-005 — `GameStore.get()` exposes the live authoritative object

**P2 · STATE**

**Evidence:** `src/game-state/store.ts:56-58` returns `this.state` directly;
~20 call sites in `GameScene` read through it.

**Current behavior:** nothing clones or freezes. Only convention (and
`applyConfirmedTurn` returning fresh objects) keeps callers read-only. A repo-wide
search for mutation of store-owned state found **no violations today**.

**Why it matters:** "every mutable value has one owner" is an `AGENTS.md`
invariant with no mechanical barrier behind it.

**Current risk:** low today, rises with every new reader.

**Desired direction:** `readonly`-typed accessor (types, not a defensive copy —
this is a hot render path).

**Status (Wave 2A): resolved.** `GameState`, `PlayerState`, `Meld` and
`DraftState` are `readonly` throughout `src/rules/types.ts`, so `get()` can keep
handing out the live object and no reader can write to it. `DraftEditor` keeps
its own mutable `DraftMeld` — a draft is what the player rearranges, and it is
cloned off the committed table on the way in. Production code needed no change
(the audit's "zero violations today" held); the fixtures that staged state by
mutating it now build the state they want, and the server exposes a documented
`setStateForTest` seam for that. `tests/boundaries.test.ts` fails if the
`readonly` markers are dropped.

---

### ARCH-006 — ~~The event bus carries control flow, not only notification~~ RESOLVED (Wave 2B)

**P1 · BOUNDARY · resolved**

**Was:** `GameStore.postTurn` emitted `turn:start`/`game:won`; `GameScene`
subscribed and advanced the local turn cycle from the handler, while the online
path called `this.onTurnStart()` directly. One entry point, two invisible paths,
both running through a process-global singleton.

**Now:** `GameStore.dispatch` returns an `ActionOutcome` and `GameScene.dispatch`
advances the cycle from it (`onWin()` / `onTurnStart()`) — the same explicit call
the online path already used. The two `bus.on` subscriptions are gone. The bus
still carries `turn:start`/`game:won`, but as facts for the playlog only: no
subscriber is load-bearing, and `tests/actions.test.ts` covers that a stale
subscriber cannot affect the next lifecycle.

**Residual:** `GameScene` still guards its async AI continuation with `sceneGone`
and a store-identity check. That guard is now about the AI search yielding across
frames, not about late bus delivery, and it stays.

---

### ARCH-007 — `playlog` subscribes globally for the process lifetime

**P2 · LIFECYCLE**

**Evidence:** `src/main.ts:22` `playlog.attachToBus(bus)`; `src/core/playlog.ts`
registers five handlers and returns no unsubscribe.

**Current behavior:** one log spans every match in the tab. Correct for the
current single-match-at-a-time app.

**Why it matters:** it bakes the "one live match per page" assumption into an
observability module.

**Current risk:** low today; blocks nothing until a second concurrent match
exists.

**Earliest phase:** Phase 3 (alongside ARCH-006). **Do NOT do yet:** per-match
log instances with no consumer for them.

---

### ARCH-008 — ~~Dead and duplicated bus events~~ RESOLVED (Wave 2B)

**P3 · DUPLICATION · resolved**

**Was:** `src/core/events.ts` declared `game:ready` and `draft:changed` with zero
publishers and zero subscribers, and `ai:thought` with one publisher and no
subscriber — the very next line wrote the same value to
`debugApi.lastAiThought`.

**Now:** all three keys are deleted, along with the `ai:thought` emission in
`GameScene.runAiTurn`. `debugApi.lastAiThought` is unchanged, so the e2e suites
that read it still do. Every remaining key in `GameEvents` has a live publisher
and at least one subscriber, and each is documented with both.

---

### ARCH-009 — `src/core` is a convenience bucket, not a layer

**P1 · BOUNDARY**

**Evidence:** measured imports out of `core`: `core/settings` → `ui/helpers`;
`core/persistence` → `cosmetics`, `ai`, `localization`; `core/playlog` →
`ui/viewport`; `core/pwa` → `localization`, `verification`; `core/intensity`,
`core/results-summary` → `rules` types. `settings.resetData()` calls
`location.reload()`.

**Current behavior:** `core` contains at least six different architectural roles:
domain-derived reads (`intensity`, `objective`, `results-summary`), a
cross-cutting utility (`events`), a domain contract (`rng`), platform adapters
(`pwa`, `lifecycle`, `haptics`), application state (`settings`,
`persistence`) and observability (`playlog`). It sits *below* everything by
convention but imports *upward* from four higher modules.

**Why it matters:** "core" cannot be reused, reasoned about as a layer, or
extracted for a non-Phaser client, because pulling it in pulls in `ui` and
`cosmetics`.

**Current risk:** it is the main obstacle to answering "where does this
responsibility belong?" — the honest answer today is "probably core", which is
why it keeps growing.

**Desired direction:** classify and relocate: derived-domain reads next to the
domain, platform adapters into a platform module, settings into application.

**Earliest phase:** Phase 4. **Do NOT do yet:** a folder rename. The
classification in §2 is the deliverable; moving files before ARCH-001/003/004
would churn every import for no behavioural gain.

---

### ARCH-010 — `src/rules` depends on `src/core/rng`

**P3 · COUPLING**

**Evidence:** `src/rules/rules.ts:1` — `import type { Rng } from '../core/rng'`.
Type-only; erased at compile time. `shuffleDeck(deck, rng)` takes the RNG as a
parameter, so rules never *creates* randomness.

**Current behavior:** harmless type-level coupling. The concern is conceptual:
the contract the domain depends on is declared in a higher, browser-adjacent
module that also holds `location.reload()`.

**Why it matters:** only for layering clarity and for a future non-browser reuse
of `rules`, which already works today (the server imports `rules` and
`core/rng` side by side without pulling in any browser code, because `rng.ts`
has no imports at all).

**Desired direction:** the `Rng` interface belongs beside the domain that
consumes it (e.g. `src/rules/types.ts`), with the `mulberry32` implementation
staying wherever it is convenient.

**Status (Wave 2A): resolved.** `src/core/rng.ts` moved wholesale to
`src/rules/rng.ts` — interface and `mulberry32` together, no new contracts
module — so the domain no longer reaches up into `core`, and the server's
allowed-import list lost its `core/rng` exception.

**Earliest phase:** Phase 4, or opportunistically whenever `rules/types.ts` is
already being edited. **Do NOT do yet:** a new "contracts" module for one
interface.

---

### ARCH-011 — Product code writes into the verification singleton

**P2 · TESTABILITY / OBSERVABILITY**

**Evidence:** `src/verification/debug-api.ts` is imported by `main.ts`, all six
gameplay scenes, `ui/rules-panel`, `ui/settings-panel`, `core/pwa` and
`audio/music`. `GameScene.wireOnline` installs 16 closures onto `debugApi.online`;
`debugApi.state = () => this.store.get()` hands the test surface a live getter.

**Current behavior:** the e2e surface is assembled by the modules under test
rather than observed from outside, and it outlives the scene that populated it
unless overwritten.

**Why it matters:** it is a second, unmanaged ownership graph pointing back into
live state, and it makes the debug contract invisible to the type system at the
call sites that must maintain it.

**Current risk:** low correctness risk (it is read-only in production and
carries no hidden information — see `MULTIPLAYER.md` §2), moderate
maintainability risk.

**Earliest phase:** Phase 4. **Do NOT do yet:** removing debug hooks that the
Playwright suites depend on.

---

### ARCH-012 — Two type-only import cycles

**P3 · COUPLING**

**Evidence:** `src/core/persistence.ts` ↔ `src/ai/ai.ts` (`Difficulty` /
`AiSpeed`); `src/core/pwa.ts` → `src/verification/debug-api.ts` →
`src/net/client.ts` → `src/core/pwa.ts`.

**Current behavior:** both cycles consist of at least one `import type`, so no
runtime cycle exists and bundling is unaffected. These are the only cycles in
the repository.

**Why it matters:** they are symptoms of ARCH-009, not independent problems.

**Earliest phase:** Phase 4, resolved as a side effect of ARCH-009.

---

### ARCH-013 — `server/index.ts` owns process, transport, dispatch and policy

**P2 · OWNERSHIP / TESTABILITY**

**Evidence:** `handleMessage` spans lines 278–643; module-level singletons
`rooms`, `queue`, `queueSockets`, `connections`, `connectionsByIp`,
`roomCreatesByIp`, `sockets`; three `setInterval` owners; HTTP health/metrics
server; `shutdown(signal)`.

**Current behavior:** the genuinely pure parts were already extracted
(`connections.ts`, `matchmaking.ts`, `metrics.ts`, `config.ts`, `log.ts`) and are
unit-tested. What remains is orchestration bound to module scope, testable only
through `tests/server/index.integration.test.ts` with a live socket.

**Why it matters:** dispatch (protocol → room call) and broadcast (room state →
per-seat frames) are policy, not transport; they are the layer most likely to
drift from `MULTIPLAYER.md`.

**Current risk:** moderate. The server is small, single-threaded and well
covered by `verify:multiplayer`; the cost is iteration speed, not correctness.

**Desired direction:** a constructible server context so dispatch and broadcast
can be exercised without a socket.

**Earliest phase:** Phase 4. **Do NOT do yet:** splitting `index.ts` by size, or
introducing a framework/DI container.

---

### ARCH-014 — `RoomManager` cohesion confirmed; watch its growth

**P3 · SCALABILITY**

**Evidence:** `server/rooms.ts` — one aggregate, injected clock/code/token/seed,
no sockets, no self-started timers, 38 public methods over `RoomInternal`.

**Current behavior:** coherent. Party history, activity feed, visibility,
listings, reaction cooldowns and matchmade terms are all room-scoped.

**Why it matters:** it is the correct shape; the risk is only that
non-room-scoped concerns get added here because it is convenient.

**Desired direction:** keep it as is. New concerns that are not keyed on a room
code go elsewhere.

**Earliest phase:** none scheduled. Re-evaluate if a second aggregate (accounts,
persistence, spectators) appears.

---

### ARCH-015 — `src/ai` mixes engine, product and presentation

**P2 · BOUNDARY**

**Evidence:** `src/ai/ai.ts` — engine (`findHandMelds`, `tryExtend`,
`searchEdgeSteal`, `searchRunSplit`, `searchInterMeldMove`, `compareCandidates`,
`SEARCH_BUDGET_MS`), product (`DIFFICULTIES`, `PERSONALITY_TRAITS`,
`createAi`), presentation (`PERSONALITY_STYLE` emotes/colours/`thinkMs`,
`AI_SPEED_SCALE`, `AI_REASON_KEYS`, `aiReasonKeySuffix`). `GameScene` imports
five of these symbols directly.

**Current behavior:** one public interface (`AiPlayer`) with a flat 601-line
implementation behind it. Candidate legality always routes through `src/rules`
— no duplicated legality.

**Why it matters:** the roadmap keeps AI expansion open (difficulty tiers exist,
personalities are capped at four). Adding a search strategy or a difficulty
today means editing a file that also owns emote colours.

**Desired direction:** engine / policy / presentation separated behind the
existing `AiPlayer` interface, which is already the right seam.

**Earliest phase:** Phase 3 if AI work is scheduled, otherwise Phase 4. **Do NOT
do yet:** a plugin architecture for four personalities.

---

### ARCH-016 — Client reuse for a non-Phaser client is partially blocked

**P2 · PORTABILITY**

**Evidence:** `rules`, `mexe-mode`, `net/protocol`, `net/viewToState`,
`table/*` and `ai`'s engine are Phaser-free and DOM-free. Blocking edges:
`core/settings` → `ui/helpers`, `core/persistence` → `cosmetics`,
`core/playlog` → `ui/viewport`, `ai` → `PERSONALITY_STYLE`/i18n keys,
`game-state` → global `bus`.

**Current behavior:** the domain core is portable; the application layer around
it is not, because `core` reaches into `ui`.

**Why it matters:** this is the concrete answer to "could this architecture
serve a future native/mobile client?" — yes for rules/protocol/AI engine, no for
settings/persistence/orchestration as currently wired.

**Desired direction:** fixing ARCH-004 and ARCH-009 removes every blocking edge
listed above. No engine-migration-specific design is needed or recommended.

**Earliest phase:** falls out of Phase 3 + Phase 4. **Do NOT do yet:** any
abstraction layer designed for a hypothetical second renderer.

---

### ARCH-017 — Unseeded randomness in a presentation path

**P3 · SIDE_EFFECT**

**Evidence:** `src/scenes/GameScene.ts:4469,4472` — `reactToPlayerMexe` uses
`Math.random()` twice to decide whether, and which, AI seat reacts to a big
player Mexe.

**Current behavior:** purely cosmetic (an emote bubble). It changes no state, no
legality and no AI decision. The other two `Math.random()` uses (`net/client`
reconnect jitter, `audio/sfx` detune) are non-gameplay by nature.

**Why it matters:** the `AGENTS.md` invariant is "gameplay randomness flows
through the seeded RNG". This is not gameplay randomness, but it does mean a
fixed seed does not replay an identical *screen*, which matters to
screenshot-based verification.

**Current risk:** low; no verification gate currently asserts emote presence.

**Desired direction:** either keep and document the exception (done here), or
draw from the state's stream for exact replay.

**Earliest phase:** Phase 2 if a screenshot gate ever covers emotes; otherwise
no action. **Do NOT do yet:** routing presentation randomness through the
gameplay RNG stream — that would change the deal for a given seed.

---

### ARCH-018 — Scene reset is a manual, unenforced checklist

**P2 · LIFECYCLE**

**Evidence:** `GameScene.resetForNewMatch()` (409–462) resets ~45 fields by
hand, with section comments; the `shutdown` handler tears down 10 resources.

**Current behavior:** correct today, and deliberately written this way (the
`AGENTS.md` invariant "scene state that must not survive a restart is reset in
scene lifecycle code" exists because of past leaks).

**Why it matters:** correctness depends on a human remembering to extend two
lists whenever a field is added.

**Desired direction:** fewer fields to reset — a consequence of ARCH-001, not a
separate fix.

**Earliest phase:** Phase 3. **Do NOT do yet:** reflection-based or
decorator-based auto-reset.

---

### ARCH-019 — No mechanical enforcement of module boundaries

**P2 · ENFORCEMENT**

**Evidence:** `eslint.config.js` is `tseslint.recommended` plus one
`no-unused-vars` rule. No `no-restricted-imports`, no dependency-cruiser, no
boundary test. `tests/no-telemetry.test.ts` is the only source-scanning guard.

**Current behavior:** every layering invariant in `AGENTS.md` is upheld by review
alone. They *are* upheld today — this audit found no violation of "no Phaser in
rules", "no `Math.random` in gameplay" or "rules-only legality".

**Why it matters:** Phase 3/4 will move ownership around; without a guard, the
invariants that survived so far by discipline are exactly what regresses during
restructuring.

**Desired direction:** two cheap guards — an eslint `no-restricted-imports` zone
forbidding `phaser`/DOM imports under `src/rules`, `src/mexe-mode`,
`src/game-state`, and a source scan (in the style of `no-telemetry.test.ts`) for
`Math.random`/`Date.now` in those folders.

**Earliest phase:** Phase 2 — this is the highest-value cheap item in the
register and should land before any Phase 3 extraction. **Do NOT do yet:** a
full dependency-cruiser ruleset encoding a layering that ARCH-009 has not
settled.

**Update (Phase 2, partial):** `tests/boundaries.test.ts` now enforces the
domain-purity half mechanically — an allow-list of imports for `src/rules`,
`src/mexe-mode`, `src/game-state` and the wire contract, a ban on
platform/clock/`Math.random` usage in those plus `src/table`, Phaser confined to
the presentation layer, and the server's `src/` imports limited to
rules/protocol/rng. One source-scanning test rather than an eslint zone *and* a
test: it covers more (type-only imports included) for less configuration. Still
unenforced: rules-as-sole-authority, single-writer ownership, and the `core`
layering that ARCH-009 has not settled.

---

### ARCH-020 — Canonical architecture doc drifted from the code

**P3 · DOCUMENTATION** — *fixed in this phase*

**Evidence (before the fix):** `docs/ARCHITECTURE.md` stated `ai/ ← rules +
game-state only` (actual: `rules`, `mexe-mode`, `core` types — never
`game-state`); listed `game:ready`, `draft:changed` and `ai:thought` as live bus
events (two have no publisher, one has no subscriber); omitted
`server/matchmaking.ts` and `server/metrics.ts` from the server file list; and
described `core` without any of its upward dependencies.

**Do now:** corrected, and the audit maps were added. **Earliest phase:** done.

---

### ARCH-021 — The tutorial is a second permission gate

**P3 · OWNERSHIP**

**Evidence:** `GameScene.tutorialAllows(action)` (1296) consulted before drag
drops, FEITO and COMPRAR; `src/tutorial/director.ts` owns the step script.

**Current behavior:** subtractive only — it refuses actions that are legal but
off-script. It can never permit an action `canConfirmTurn` refuses, because the
rules check runs regardless.

**Why it matters:** it is a legitimate second gate, but an unlabelled one. Noted
so a future reader does not mistake it for duplicated legality.

**Earliest phase:** none. Documented in the authority matrix (§5).

---

## 12. Answers to the Phase 1 questions

1. **Is `src/rules` the only gameplay-legality authority?** Yes. Every legality
   call site resolves to `analyzeMeld` or `canConfirmTurn`; `isValidRun`,
   `isValidGroup`, `isValidMeld`, `validateTable`, `getInvalidMeldReasons`,
   `table/snap.ts` and the AI's candidate filters are all wrappers or callers.
2. **Legality duplicated outside rules?** No. The client's pre-FEITO check
   (`feitoAccepted`) calls the same `canConfirmTurn` the server re-runs; the
   tutorial gate (ARCH-021) is subtractive; `src/ui/helpers`, `core/objective`
   and `table/invalid-detail` only restate reasons rules produced.
3. **Who owns committed local `GameState`?** `GameStore`. Online, the server
   owns it and `GameStore` degrades to a read-only container (ARCH-002).
4. **Can a caller mutate authoritative local state outside the API?** No since
   Wave 2A: `get()` still returns the live object, but `GameState` is readonly by
   type, so a write does not compile (ARCH-005).
5. **Why can the server not reuse `GameStore`?** Because `GameStore` emits on a
   process-global bus and a server process holds many rooms; the emissions would
   cross-talk. This is a real boundary: turn application (shareable) is fused
   with event announcement (client-only). See ARCH-004.
6. **Is the bus notification or control flow?** Both, and that is the problem:
   `turn:start`/`game:won` drive the local turn cycle (control flow), while
   `viewport:changed` and the playlog subscriptions are true notification.
   ARCH-006.
7. **Does GameScene hold responsibilities that should move?** Yes — online state
   adaptation, AI scheduling/turn orchestration, the online turn clock,
   reconnect reaction and tutorial progression. ARCH-001/002.
8. **Does OnlineScene hold a state machine that should become explicit?** Yes —
   10 phases, transitions in ~25 handlers. ARCH-003.
9. **Is `src/core` a layer?** No. Six architectural roles and four upward
   dependencies. ARCH-009.
10. **Are platform concerns leaking into domain/application logic?** Into
    `core` (`ui/viewport` in playlog, `location.reload` in settings) and into
    scenes (by design). **Not** into `rules`, `mexe-mode` or `game-state`.
11. **Are server room responsibilities cohesive?** Yes — `RoomManager` is a
    coherent aggregate (ARCH-014). The incoherence is one level up, in
    `server/index.ts` (ARCH-013).
12. **Where do reconnect/rematch/timer responsibilities live?** Reconnect:
    policy split between `NetClient` (retry schedule) and `RoomManager` (grace +
    token seat recovery) — a correct split. Rematch: `RoomManager.recycleForRematch`
    with `server/index.ts:recycleFinishedRoom` broadcasting. Turn timer: server
    only (`RoomInternal.turnStartedAt`, `advanceStalledTurns`, `timerExpireTurn`);
    the client renders `turnMsLeft` and never decides expiry.
13. **Are AI boundaries sufficient for expansion?** The `AiPlayer` interface is;
    the implementation file is not layered behind it. ARCH-015.
14. **Dependency cycles?** Two, both type-only, both erased at runtime.
    ARCH-012.
15. **Enforced vs convention?** See §10. Enforced: seeded randomness, server
    authority, hand privacy, protocol sharing, no telemetry, and — since Wave 2A —
    domain/layering boundaries and committed-state immutability
    (`tests/boundaries.test.ts`). Convention only: rules-as-sole-authority.
16. **First three risks to address after Phase 2?** ARCH-006 (make turn control
    flow explicit), ARCH-004 (separate turn application from event emission),
    ARCH-002 (give online adaptation an owner). ARCH-001 and ARCH-003 become
    tractable once those three land; attempting them first would move code
    without fixing ownership. ARCH-019 should land *in* Phase 2, before any of
    them.
17. **Suitable for a future native/mobile client?** Partly, and improvable
    without designing for one: `rules`, `mexe-mode`, `net/protocol`,
    `net/viewToState`, `table` and the AI engine are already platform-free; the
    blockers are exactly ARCH-004 and ARCH-009. No engine-migration-specific
    work is recommended.

## 13. Boundary migration register

The boundary rules themselves are in
[ARCHITECTURE.md](ARCHITECTURE.md#module-categories-and-dependency-rules). This
is the list of edges that currently disagree with them, each already carrying a
finding above — no competing ID space.

| Current edge | Desired edge | Risk if left | Depends on | Phase |
|---|---|---|---|---|
| `core/settings` → `ui/helpers`; `core/persistence` → `cosmetics`, `ai`; `core/playlog` → `ui/viewport`; `core/pwa` → `verification` (ARCH-009, ARCH-011, ARCH-016) | platform modules depend downward only; presentation catalogues are passed in, not imported | `core` cannot be reused by any non-Phaser client, and "put it in core" stays the default | splitting `core` by role | 4 |
| `game-state` → global `bus` (ARCH-004) | turn application separated from announcement, so the server *could* share it | ~~deal duplication~~ closed in Wave 2A; ~~bus as control flow~~ closed in Wave 2B — what remains is a notification-only import, and the shareable transition is the pure `applyGameAction` | — | **narrowed** |
| ~~bus carries control flow (`turn:start`, `game:won`) (ARCH-006)~~ | explicit turn-cycle call graph; the bus keeps notification only | **resolved in Wave 2B** — `GameStore.dispatch` returns an outcome, `GameScene.dispatch` advances the cycle from it; the two `bus.on` control-flow subscriptions are gone | — | done |
| `GameScene` owns online adaptation, AI scheduling, turn clock (ARCH-001, ARCH-002) | a match-orchestration owner outside the scene | application logic remains untestable without Phaser; `resetForNewMatch` keeps growing | ARCH-006, ARCH-004 | 3 |
| `OnlineScene` holds an implicit 10-phase machine (ARCH-003) | explicit, testable lobby machine; scene renders and dispatches | every new lobby feature is reasoned about across ~25 handlers | ARCH-002 | 3 |
| ~~`GameStore.get()` returns the live object (ARCH-005)~~ | `readonly`-typed state | **resolved in Wave 2A** — `GameState`/`DraftState` are readonly by type, guarded in `tests/boundaries.test.ts` | — | done |
| `src/ai/ai.ts` mixes engine, policy and presentation (ARCH-015) | the three behind the existing `AiPlayer` seam | AI expansion edits a file that also owns emote colours | AI work being scheduled | 3–4 |
| `playlog` subscribes for process lifetime (ARCH-007) | per-lifecycle subscription | bakes "one live match per page" into observability | ARCH-006 | 3 |
| `server/index.ts` is composition root + dispatcher + broadcaster + limiter (ARCH-013) | dispatch/broadcast separated from process wiring | protocol growth lands in a 365-line `handleMessage` | none | 4 |

## Evidence gaps

- Runtime behaviour was not exercised in this phase: no game, browser or
  multiplayer suite was run (documentation-only change). All findings are from
  static reading of sources, imports and tests.
- Event-bus fan-out was measured by grep over `bus.on`/`bus.emit`; a listener
  registered dynamically through a variable alias would not appear (none was
  found, but the search is textual).
- `docs/` beyond `ARCHITECTURE.md`, `ROADMAP.md`, `MULTIPLAYER.md` (outline
  only) and the two process docs was not audited for drift.
- Coverage of the concentration verdicts relies on reading method lists and
  representative bodies, not on every one of GameScene's 123 methods.
