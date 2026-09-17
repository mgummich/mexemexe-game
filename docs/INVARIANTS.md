# Invariants and canonical scenarios

**Canonical for:** the properties MEXEMEXE! must preserve through any future
refactor, and the reusable scenario library that proves them.

**Not canonical for:** the rules themselves ([GAME_RULES.md](GAME_RULES.md)),
the architecture ([ARCHITECTURE.md](ARCHITECTURE.md)), the risk register
([ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md)) or the test portfolio and its
gates ([TESTING.md](TESTING.md)).

An invariant here earns its place by being **meaningful, testable or
inspectable, owned by one layer, and independent of implementation shape**. The
set is deliberately small: these are the things a restructuring must not break,
not a style guide.

Two ID spaces already exist and are not duplicated here:

- **GQA-xx** ([TESTING.md](TESTING.md)) are *risk* rows — what could hurt a
  player and which suite is the strongest proof. INV-xx are *properties* — what
  must be true of the system. They cross-reference.
- **LB/OM/OP/OS/OH/ON-xx** are multiplayer acceptance IDs owned by
  [MULTIPLAYER.md](MULTIPLAYER.md) and the suites. Scenarios point at them
  rather than restating them.

## Invariant register

Enforcement column: **test** (a suite fails), **type** (the compiler refuses),
**structure** (only one implementation exists to call), **convention** (review
only — the regression risk during Phase 3/4 extraction).

### Game and rules — owner: `src/rules`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-G1 | No card is lost, duplicated or invented. Hands + table + draw pile always hold the dealt id set exactly. | test — `expectCardConservation` (`tests/helpers/invariants.ts`), re-checked every turn over 40 seeds in `probes`, and `assertConservation` on the server after every accepted turn | SCN-01..08, SCN-12, SCN-20 |
| INV-G2 | Committed table is always legal: every meld on it satisfies `analyzeMeld`. | test — `rules`, `probes` (after every turn) | SCN-01, SCN-09, SCN-12 |
| INV-G3 | A confirmed turn adds ≥1 card from the active hand and removes no card that was on the committed table. | test — `canConfirmTurn` cases (`noHandCard`, `cardMissing`) in `tests/rules.test.ts` | SCN-03, SCN-10, SCN-11 |
| INV-G4 | Jokers keep their physical identity. A joker's meld role is derived on demand; it is never written into the card, a save or the wire. | structure + test — assignments are returned by `analyzeMeld`, never stored; `tests/rules.test.ts` joker cases | SCN-06, SCN-35 |
| INV-G5 | At most one joker per meld; a group is 3–4 cards with unique natural suits; a run never wraps K-A-2. | test — `tests/rules.test.ts`, `tests/ai.test.ts` (never proposes a two-joker meld across seeded games) | SCN-06, SCN-09 |
| INV-G6 | The winner is deterministic: `checkWinner` (empty hand) or `fewestCardsWinner` on pile exhaustion. No other code decides it. | structure + test | SCN-07, SCN-08 |
| INV-G7 | Draw-pile exhaustion ends the match. No state can loop forever. | test — `probes` (every seed terminates), `tests/ai.test.ts` empty-pile cases | SCN-08, SCN-16 |
| INV-G8 | The dealt card count is exactly `deckCount × (52 + jokersPerDeck)` and conservation is checked against that set, not a total. | test — `TOTAL_CARDS` in `tests/helpers/invariants.ts`, `createDeck` cases | SCN-01 |
| INV-G9 | An illegal draft can never become committed state: `applyConfirmedTurn` re-runs `canConfirmTurn` and throws `RulesError('illegalConfirm')` rather than committing. | structure + test | SCN-03, SCN-10, SCN-11, SCN-21 |

### State — owners: `GameStore`, `DraftEditor`, `RoomManager`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-S1 | Draft state and committed state are distinct structures. The draft is never serialized, never persisted and never sent until FEITO. | structure (separate types/modules) + test — `tests/draft.test.ts` | SCN-05, SCN-09, SCN-21 |
| INV-S2 | Every mutable state domain has exactly one owner, listed in [ARCHITECTURE.md](ARCHITECTURE.md#state-ownership-and-mutation-rules). No second writer. | type system for committed `GameState`/`DraftState` (readonly, guarded by `tests/boundaries.test.ts`); convention elsewhere (ARCH-005 resolved) | SCN-14, SCN-22 |
| INV-S3 | Derived values are recomputed, never stored as a second authority — joker assignments, helper flags, `turnMsLeft`, invalid-meld reasons. | convention + test — `tests/net/room-settings.test.ts` keeps the ticking clock out of the state digest | SCN-26 |
| INV-S4 | A finished game cannot silently continue: `phase: 'finished'` and `winnerId` are set together, and no turn is applied afterwards. | test — `rules`, `tests/server/timer.test.ts` (post-finish clock) | SCN-07, SCN-25 |
| INV-S5 | Turn ownership is explicit: locally `activePlayerIndex`; online the server's `activeSeat`, mapped through `matchSeats` so a lobby seat gap never shifts a player. | test — `tests/server/rooms.test.ts`, `lobby-soak` (seat/player-index mapping every step) | SCN-22, SCN-26 |
| INV-S6 | Valid committed state round-trips through `serializeGameState`/`deserializeGameState` at `GAME_STATE_VERSION`. | test — `tests/rules.test.ts` | SCN-35 |

### Randomness — owner: `src/rules/rng` + the state's seed

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-R1 | All gameplay randomness comes from the state's seeded stream. No `Math.random`, `Date.now` or wall clock in `rules`, `mexe-mode`, `game-state`, `table` or the wire contract. | test — `tests/boundaries.test.ts` scans those folders | SCN-02 |
| INV-R2 | Same initial state + same seed + same action sequence ⇒ identical result, including AI decisions. | test — `probes` determinism, `tests/ai.test.ts` determinism | SCN-02, SCN-16 |
| INV-R3 | Online, the server picks the deal seed (`RoomManager.genSeed`). No client input reaches it. | structure — the seed is generated inside `startGame`; no protocol message carries one | SCN-20 |
| INV-R4 | Non-gameplay randomness (reconnect jitter, sfx detune, the cosmetic AI emote roll) never changes a game outcome. | convention — documented exception, see ARCH-017 | — |

### AI — owner: `src/ai` behind `AiPlayer`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-A1 | The AI only ever proposes actions `src/rules` accepts. It owns no legality of its own. | test — `tests/ai.test.ts` ("never proposes illegal confirm"), `probes` (legal every turn, 40 seeds) | SCN-14, SCN-16 |
| INV-A2 | The AI reads only the active player's hand and public state — never an opponent's cards. | convention — `src/ai/ai.ts` touches `state.players[state.activePlayerIndex].hand` and `players.length` only (gap: no test) | SCN-17 |
| INV-A3 | An AI failure or timeout cannot corrupt committed state: the fallback is `drawAndEndTurn`, which is a legal move. | test — `tests/ai.test.ts` fallback + budget cases | SCN-15, SCN-16 |
| INV-A4 | `decide`/`decideSliced` always return a decision within the search budget; a crowded table cannot hang a turn. | test — `tests/ai.test.ts` hardening (10+ melds, 20-card hand, <500 ms) | SCN-13, SCN-15 |

### Multiplayer — owner: `server/rooms.ts` (`RoomManager`) + `src/net/protocol.ts`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-N1 | The server owns authoritative room and match state. Clients submit intents and render what they are given; no client advances `rev` or decides legality. | structure + test — `tests/server/*`, `verify:multiplayer` state-hash agreement | SCN-20, SCN-21 |
| INV-N2 | Opponent hand identities are never transmitted. `buildView` sends own hand + opponent counts only. | test — OH-26, `tests/server/index.integration.test.ts` (privacy in a real frame), `e2e-multiplayer` hand-privacy probe | SCN-23 |
| INV-N3 | A stale action is rejected, not applied: `submitTurn` refuses `rev !== room.rev` with `reason.staleRevision`. | test — `tests/server/rooms.test.ts` double submit | SCN-21 |
| INV-N4 | Seat ownership is unambiguous: one seat per token, one token per seat, for the room's lifetime. | test — `tests/server/rooms.test.ts`, `lobby-soak` (a token never resolves to another seat) | SCN-19, SCN-22, SCN-24 |
| INV-N5 | Reconnect returns the token's own seat or fails (`invalid_token`). It can never take another player's seat. | test — `tests/server/reconnect.test.ts`, `tests/net/reconnect.test.ts`, LB reload/second-tab | SCN-24 |
| INV-N6 | A rematch starts from clean per-match state: state, `rev`, `matchId`, `matchSeats`, timer fields, ready bits and the Mexe-bonus guard are all reset in `recycleForRematch`. | test — `tests/server/rooms.test.ts`, OS-01..OS-16/OS-35 | SCN-25 |
| INV-N7 | The turn timer is server-owned. Clients render `turnMsLeft` and never decide expiry; the running clock is excluded from the state digest. | test — `tests/server/timer.test.ts` (fake clock), `tests/net/room-settings.test.ts` | SCN-26 |
| INV-N8 | Client and server share one protocol module and one `PROTOCOL_VERSION`; every inbound frame is validated at the wire boundary before it reaches room logic. | type + test — `server/` imports `src/net/protocol`; `tests/server/hardening.test.ts`, `index.integration.test.ts` malformed/oversized frames | SCN-28 |

### Lifecycle — owner: each scene, `NetClient`, `server/index.ts`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-L1 | Everything a lifecycle acquires is released when it ends — subscriptions, timers, sockets, DOM nodes, audio. | convention — every scene's `events.once('shutdown', …)`, `server/index.ts:shutdown` (see ARCH-007, ARCH-018) | SCN-29 |
| INV-L2 | A stale callback cannot mutate a new match: async continuations re-check that the scene is alive and that the store/match identity is unchanged. | convention — `sceneGone` + store-identity guards in `GameScene`, `matchId`/`matchSeq` on the server | SCN-15, SCN-29 |
| INV-L3 | Resume and reconnect restore from authority, not from local assumptions: the client requests a resync and replaces its state wholesale. | test — `e2e-multiplayer` explicit resync round-trip, `tests/net/reconnect.test.ts` | SCN-24 |

### Persistence — owner: `src/core/persistence.ts`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-P1 | Corrupt, missing or wrongly-typed persisted data never becomes trusted state. It falls back per field to a documented default. | test — `tests/persistence.test.ts` | SCN-30, SCN-31 |
| INV-P2 | An unsupported save version fails safe: the envelope version is checked and a non-match yields defaults, never a partial read. | test — `tests/persistence.test.ts`, `tests/rules.test.ts` (state envelope) | SCN-31 |
| INV-P3 | Settings/progress/cosmetics live in the single `mexe-save` envelope; online identity (name, reconnect token, recent rooms) is `NetClient`'s own storage. Neither owns the other. | structure — the only two `localStorage` writers | SCN-30 |
| INV-P4 | A storage failure (blocked site data, quota) degrades to defaults without crashing the boot path. | test — `tests/persistence.test.ts` (`getItem` throws), `tests/error-recovery.test.ts` | SCN-32 |

### UI and presentation — owner: `src/scenes`, `src/ui`

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-U1 | The UI never decides legality. It asks `src/rules` and renders the answer, including the reason codes on a blocked FEITO. | convention + structure (one `analyzeMeld`) | SCN-03, SCN-10 |
| INV-U2 | Rendering never mutates canonical game state. Layout, snapping and zoom are pure functions over it. | test — `tests/boundaries.test.ts` (layout maths stay effect-free), `tests/layout.test.ts` et al | SCN-12 |
| INV-U3 | No render or debug path can leak hidden information online. `window.__MEXE__.state()` returns the local state, which online *is* the redacted per-seat view. | test — `e2e-multiplayer` hand-privacy probe reads the debug API | SCN-23 |

### Documentation and architecture

| ID | Invariant | Enforced by | Scenarios |
|---|---|---|---|
| INV-D1 | Each canonical doc has one owner and one subject; no topic has two sources of truth (`AGENTS.md` routing table). | convention | — |
| INV-D2 | A protocol change lands on client and server together, bumping `PROTOCOL_VERSION`. | test — `tests/viewToState.test.ts` pins the version; server shares the module | SCN-28 |
| INV-D3 | Planned work is labelled as planned. Documented behaviour is implemented behaviour. | convention (see `WORKFLOW.md` §13, ARCH-020) | — |

## Canonical scenarios

One compact library, reused rather than re-authored. "Where it lives" is the
existing fixture or suite; **(gap)** means the scenario is defined but not yet
mechanized, and is recorded for a later testing phase — not a to-do for this
wave.

Fixture vocabulary: `n(suit, rank, deckId)` and `j(deckId, k)` from
`tests/helpers/cards.ts`; `expectCardConservation` from
`tests/helpers/invariants.ts`; `tests/server/harness.ts` for a `RoomManager`
with injected clock, codes, tokens and seed; `e2e-multiplayer/harness.ts` for
real browser clients.

### Local gameplay

| ID | Purpose / setup → action → expectation | Invariants | Where it lives |
|---|---|---|---|
| SCN-01 | Fresh default deal. `createNewGame(seed, 4)` → assert 108 unique ids across hands + pile, 7 per hand. | G1, G8 | `tests/rules.test.ts` deal cases |
| SCN-02 | Seeded replay. Same seed, same action sequence, twice → identical final state and turn count. | R1, R2 | `tests/probes.test.ts` determinism |
| SCN-03 | Normal legal turn. Hand card extends an existing run → `canConfirmTurn` ok → `applyConfirmedTurn` → turn advances, hand shrinks by one. | G1, G2, G3, U1 | `tests/draft.test.ts`, `e2e/screenshot.spec.ts` mexe journey |
| SCN-04 | Draw and end turn. No legal play → `drawAndEndTurn` → one card moves pile→hand, turn advances. | G1, G7 | `tests/rules.test.ts`, `tests/ai.test.ts` draw cases |
| SCN-05 | Draft is scratch. Edit, then abandon (reset / leave the turn) → committed state untouched. | S1 | `tests/draft.test.ts` undo/reset |
| SCN-06 | Joker usage. Joker completes a run and a group; a second joker in the same meld is refused. | G4, G5 | `tests/rules.test.ts` joker cases |
| SCN-07 | Player goes out. Last hand card played → `winnerId` set, `phase: 'finished'`, no further turn applies. | G6, S4 | `tests/rules.test.ts` win, `e2e` `win-real-finish` |
| SCN-08 | Empty draw pile. Pile at 0 and at 1 → match ends cleanly by fewest cards, no throw, no loop. | G1, G6, G7 | `tests/probes.test.ts` edge probes |

### Difficult table states

| ID | Purpose / setup → action → expectation | Invariants | Where it lives |
|---|---|---|---|
| SCN-09 | Valid Mexe rearrangement. Split a 6+ run to reach an interior card, rebuild both halves legally, add one hand card → accepted. | G2, G5, S1 | `tests/draft.test.ts` split/merge, `tests/ai.test.ts` run-split |
| SCN-10 | Rearrangement without a hand card. Legal melds, zero cards played → refused with `noHandCard`. | G3, G9, U1 | `tests/draft.test.ts` |
| SCN-11 | Attempted card disappearance. Draft drops a committed table card → refused with `cardMissing`. | G1, G3, G9 | `tests/rules.test.ts` `canConfirmTurn` |
| SCN-12 | Cards move between melds. Every card of one meld merged into another → conservation and table legality hold. | G1, G2, U2 | `tests/draft.test.ts` conservation case |
| SCN-13 | Dense table. 10+ melds, 20-card hand → validation and an AI decision complete inside budget. | A4, G1 | `tests/probes.test.ts` crowded table, `tests/ai.test.ts` hardening |
| SCN-21 | Foreign / placeholder card smuggled into a draft → rejected (locally by `canConfirmTurn`, online by the server before `rev` moves). | G9, N1, N3, S1 | `tests/viewToState.test.ts` placeholder case, `tests/server/rooms.test.ts` |

### AI

| ID | Purpose / setup → action → expectation | Invariants | Where it lives |
|---|---|---|---|
| SCN-14 | Legal move available. Obvious group/run in hand → AI plays it; the proposal passes `canConfirmTurn`. | A1, S2 | `tests/ai.test.ts` SimpleAi |
| SCN-15 | Multiple legal choices. Rearranging personality prefers the play using most hand cards; a thrown search still ends the turn legally by drawing. | A1, A3, A4, L2 | `tests/ai.test.ts` RearrangerAi + fallback |
| SCN-16 | Full-match simulation. Seeded AI-vs-AI games to completion → legal every turn, conservation every turn, terminates. | A1, A3, G1, G7, R2 | `tests/probes.test.ts` (40 seeds), `tests/ai.test.ts` soak |
| SCN-17 | Hidden information. AI decides on a state whose opponent hands differ but whose public state is identical → same decision. | A2 | **(gap)** — no test asserts this today |
| SCN-18 | Difficulty/personality-neutral baseline. One fixture state, all four difficulties and personalities → every decision legal; style differences are pacing and choice, never legality. | A1 | `tests/ai.test.ts` personalities + style regression |

### Multiplayer

| ID | Purpose / setup → action → expectation | Invariants | Where it lives |
|---|---|---|---|
| SCN-19 | Create → join → ready → start. Host creates, second player joins by code, both ready, host starts → both hold a dealt view of the same match. | N1, N4, S5 | `tests/server/rooms.test.ts`, `e2e-multiplayer/multiplayer.spec.ts` |
| SCN-20 | Legal online turn. Client submits at current `rev` → server validates with the same `canConfirmTurn`, `rev++`, redacted views broadcast, hashes agree. | G1, N1, R3 | `tests/server/rooms.test.ts`, multiplayer state-hash assertion |
| SCN-22 | Seat-gap room. Seats 0, 2, 3 occupied → dealt without compacting; turn rotation and scores stay keyed on the stable chair. | S5, N4 | `tests/server/lobby-soak.test.ts`, LB seat-gap evidence |
| SCN-23 | Hand privacy. Opponent's frame, view payload and `window.__MEXE__.state()` inspected → opponent hands are counts only. | N2, U3 | OH-26, `tests/server/index.integration.test.ts`, `e2e-multiplayer` privacy probe |
| SCN-24 | Disconnect → reconnect. Socket drops mid-match → seat held for the grace window → reconnect with the stored token → same seat, fresh authoritative state; another player's token never resolves here. | N4, N5, L3, S3 | `tests/server/reconnect.test.ts`, `tests/net/reconnect.test.ts`, LB reload |
| SCN-25 | Rematch on the same code. Match finishes, room recycled → clean state, `rev` 0, new `matchId`, ready bits cleared, score history retained. | N6, S4 | `tests/server/rooms.test.ts`, OS-01..OS-16/OS-35 |
| SCN-26 | Turn timeout. Timer room, active seat idles past the deadline on a fake clock → server expires the turn, advances authoritatively; clients only rendered the countdown. | N7, S5 | `tests/server/timer.test.ts`, multiplayer timer test |
| SCN-27 | Host departure. Host leaves in the lobby → host role moves to an occupied seat, room stays usable. | N4, S2 | `tests/server/lobby-soak.test.ts` host-authority invariant |
| SCN-28 | Hostile frame. Malformed, oversized or wrong-version message → rejected at the wire boundary, no room state touched, nothing written to stderr. | N8, D2 | `tests/server/hardening.test.ts`, `index.integration.test.ts` |
| SCN-33 | 2/3/4-player rotation. Rooms of each size play a full lap → every seat gets exactly one turn per lap in seat order. | S5, N1 | `e2e-multiplayer` 3P/4P test, `tests/server/rooms.test.ts` |

### Persistence and recovery

| ID | Purpose / setup → action → expectation | Invariants | Where it lives |
|---|---|---|---|
| SCN-29 | Scene teardown. Start a match, leave to menu, start another → no timer, subscription or listener from the first match fires into the second. | L1, L2 | `e2e` `second-match` journey; unit coverage **(gap)** |
| SCN-30 | Valid save restore. Write settings + cosmetics, reload → identical values; online identity read from its own keys. | P1, P3 | `tests/persistence.test.ts` round-trips |
| SCN-31 | Corrupt / unsupported save. Unparseable JSON, missing version, unknown cosmetic id, wrong-typed field → per-field defaults, no crash, no partial trust. | P1, P2 | `tests/persistence.test.ts`, `tests/error-recovery.test.ts` |
| SCN-35 | Committed-state round-trip. Serialize a mid-match state, deserialize it → identical state; a foreign version yields nothing trusted. Joker cards survive as jokers, not as their assigned face. | S6, G4, P2 | `tests/rules.test.ts` serialization cases |
| SCN-32 | Storage unavailable. `getItem`/`setItem` throw → boot continues on defaults. | P4 | `tests/persistence.test.ts` |
| SCN-34 | Reload in a recoverable state. Offline reload boots to the menu from cache; a local match is not resumed mid-turn (documented limitation). | P1, L3 | `e2e-pwa/offline.spec.ts` |

## Traceability gaps

Recorded, not scheduled. Each belongs to a later testing phase; none is a known
defect today.

| Invariant | Gap | Note |
|---|---|---|
| INV-A2 | SCN-17 has no test | The AI currently reads only the active hand; nothing stops a future search from reading `state.players[i].hand`. A fixture pair differing only in opponent hands would pin it. |
| INV-S2 | Partly guarded | Committed `GameState` is readonly by type since Wave 2A (ARCH-005 resolved); ownership of everything else — scene fields, lobby mirror, connection state — is still convention. |
| INV-L1, INV-L2 | SCN-29 is only covered end-to-end | Scene teardown has no unit-level proof; it becomes testable when orchestration leaves `GameScene` (ARCH-001). |
| INV-U1 | Convention only | "No legality in the UI" holds because exactly one `analyzeMeld` exists, not because anything forbids a second. |
| INV-R4 | Convention only | The cosmetic `Math.random` in `GameScene.reactToPlayerMexe` (ARCH-017) means a fixed seed does not replay an identical screen. |
| INV-D1, INV-D3 | Convention only | Doc drift is caught by review; ARCH-020 is the last instance found. |
