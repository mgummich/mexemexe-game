# Testing and verification

**Canonical for:** QA strategy, what each test level owns, the Gaming QA risk
matrix, the gates, and what is deliberately left to human playtesting.

Everything below is a script that exists in `package.json` today. Nothing here
is aspirational.

## Philosophy

Test risks, not screens and not implementation shape.

The portfolio is sized for **bug-detection value per test**, not for test count
or coverage percentage. Before a test is added, it has to answer: *which
player-facing or product failure does this catch?* "It could be tested" is not
an answer.

Two consequences run through everything below:

- **Lowest level that reliably exposes the risk wins.** A rule proven by a pure
  function is proven; re-proving it in a browser buys nothing and costs minutes.
- **One strong invariant beats many narrow assertions.** Card conservation is
  one helper re-checked after every state transition, not one bespoke count per
  test.

### Test levels

Eight automated levels, cheapest first, plus manual. "Cost" is the order of
magnitude a developer waits for the whole category on this repo — see
[Runtime budgets](#runtime-budgets).

| Level | Cost | Owns | Does not own | Lives in |
|---|---|---|---|---|
| Pure / unit | ms | Rules, validators, layout maths, serialization, protocol helpers, settings/i18n, state invariants | Anything needing a socket, a scene, storage or a real clock | `tests/*.test.ts` |
| Property / generative | ms | Invariants that hold across *every* generated deal, meld and legal action sequence — conservation, round-trips, determinism, refusal | The specific answers this game gives (that is a unit test's job), anything impure | `tests/property/` |
| Golden replay | ms | Whole-match outcomes: the endings, the rotations, a recorded rearrangement | Any rule a unit test can prove; anything presentational | `tests/replay.test.ts` + `tests/fixtures/replays/` |
| Application / integration | ms | Action orchestration (`LocalMatch`), online state adaptation (`OnlineSession`), lobby transitions (`LobbyMachine`), persistence and lifecycle coordination | Wire framing, rendering, engine behaviour | `tests/match`, `online-session`, `lobby`, `persistence`, `lifecycle`, `net/` |
| Simulation | seconds | Emergent behaviour over many seeded states — AI, full matches, lobby random walks | Single rule cases, which are cheaper as unit tests | `tests/probes`, `server/lobby-soak`, `server/session-soak.integration` |
| Server integration | seconds | Room ownership, authoritative validation, revisions, reconnect, rematch, hidden information, the wire boundary | UI, engine parity | `tests/server/` |
| Browser E2E | minutes | Real input, Phaser interaction, scene transitions, the service worker, several real clients against the real server | Rule legality, or anything a pure function already proves | `e2e/`, `e2e-multiplayer/`, `e2e-pwa/` |
| Cross-browser / device | minutes | Behaviour that genuinely differs per engine or form factor: pointer/touch, viewport, orientation, iOS lifecycle | A second copy of a journey already proven on Chromium | `e2e-cross/`, the `firefox`/`webkit` multiplayer projects |
| Manual | — | Comprehension, feel, presentation, exploratory abuse | Anything a machine can assert | [PLAYTEST_GUIDE.md](PLAYTEST_GUIDE.md) |

Mutation testing is not a level: it has no tests of its own. It is a
**diagnostic on the levels above** — it asks whether they would notice a wrong
comparison — and it is run on demand, never as a gate. See
[Mutation testing](#mutation-testing).

Performance trending is still not a category here. It is named so that nobody
invents a level by accident; when it arrives it gets a row, a gate and a budget
like every other.

#### Choosing a level

> What is the cheapest level that fails when this behaviour breaks?

Write the test there, and add a higher level only for the boundary risk the
lower one cannot see. The same behaviour proven twice costs twice and protects
once.

| Behaviour | Cheapest proving level | Higher level, and only because |
|---|---|---|
| Meld legality, joker rules, winner | unit (`rules`) | — |
| Draft editing, undo/reset | unit (`draft`) | E2E proves the *pointer* reaches it, not the rule |
| Confirm/draw orchestration, AI turn routing, finish | application (`match`) | — |
| Stale frame, desync policy, seat-gap translation | application (`online-session`) | — |
| Lobby screens and refusals | application (`lobby`) | one E2E that the lobby renders and connects |
| Stale revision, seat ownership, rematch reset, privacy | server (`tests/server/`) | multiplayer E2E for genuine client-to-client synchronization |
| Malformed/oversized frame | server integration (`index.integration`) | — |
| Two clients converge on one state | multiplayer E2E (independent clients) | — |
| FEITO click, drag, scene transition | browser E2E | cross-browser only for touch/viewport/iOS lifecycle |
| Offline reload, update handover | PWA E2E | — |

#### Subsystem routing

| Subsystem | Layers, cheapest first |
|---|---|
| Multiplayer | protocol/pure (`net/`, `viewToState`) → `RoomManager` server tests (fake clock, injected codes/tokens/seed) → real-process wire tests (`index.integration`) → a small browser suite with genuinely independent clients where synchronization *is* the subject |
| AI | legality and determinism as unit (`ai`) → behaviour and personality as seeded simulation (`probes`, style regressions) → UX integration as one application/browser test. Subjective quality is a playtest, never a unit expectation |
| UI / app shell | settings, menus and dialog *state* as pure/application tests → browser E2E only for critical navigation paths (`esc`, `pause-draft`, `second-match`). Not every button gets a journey |
| Tutorial | progression logic and the per-step allow-list as application tests (`tutorial`) → the authority boundary as a rules assertion → one browser E2E for the interactive experience |
| Persistence | round-trip, corrupt and unsupported saves as unit/integration (`persistence`, `error-recovery`) → PWA E2E for the real reload |

### New-test admission rule

Add an automated test only when at least one is true:

- it protects a previously uncovered P0/P1 risk,
- it reproduces a real regression (every confirmed bug gets one — see `AGENTS.md`),
- it covers a newly introduced meaningful state transition,
- it replaces manual release work,
- browser/platform behaviour *is* the risk.

Before adding: check whether an existing high-value test can be **strengthened**
instead. That is usually the smaller, better change.

### Deliberately not tested automatically

- **Pixel-level visual regression of every screen.** The screenshot suite captures
  ~130 PNGs and fails on page/console errors and fps floors, not on pixels.
  *Six* states do have pixel baselines — see below — and the rest stay a human
  judgement against those artifacts.
- **Game feel, pacing, clarity, perceived AI quality.** Playtest guide.
- **Raw synthetic pointer-drag drops** — verified through editor hooks instead
  (see the README's known limitations).
- **Every locale × viewport × text-scale combination.** Representative classes
  only; the geometry itself is unit-tested.

## Gaming QA risk matrix

| ID | Area | Primary risk | Strongest proving test | Level | Status |
|---|---|---|---|---|---|
| GQA-01 | Core rules | illegal state accepted | `tests/rules.test.ts` (runs, groups, jokers, `canConfirmTurn`) | unit | Covered |
| GQA-02 | Card integrity | card lost/duplicated | `tests/helpers/invariants.ts` → `expectCardConservation`, re-checked in `rules`, `probes` (every turn, 40 seeds), `server/rooms`, and over generated matches in `tests/property/state.property.test.ts` | unit + property + simulation + server | Covered |
| GQA-03 | Turn flow | softlock / dead state | `tests/actions.test.ts` (the local action path: accepted, refused, after-finish, out-of-turn), `tests/probes.test.ts` (every seed terminates, turn rotation asserted each turn) | unit + simulation | Covered |
| GQA-04 | Mexe | draft/state corruption | `tests/draft.test.ts`, `tests/probes.test.ts` undo/reset abuse; `e2e/screenshot.spec.ts` mexe + editor journeys | unit + E2E | Covered |
| GQA-05 | End game | wrong winner/end state | `tests/rules.test.ts` win + draw-pile exhaustion; the three finished golden replays (empty hand, two-seat exhaustion, four-seat tiebreak); `e2e` `win-real-finish` | unit + golden replay + E2E | Covered |
| GQA-06 | AI | illegal action / hang | `tests/ai.test.ts` (legality, budgets, determinism, observation redaction and no-mutation), `tests/probes.test.ts` (terminates, legal every turn), `tests/property/ai.property.test.ts` (legal, unmutated, reproducible over generated states) | unit + property + simulation | Covered |
| GQA-07 | Multiplayer sync | state divergence | `e2e-multiplayer/multiplayer.spec.ts` state-hash agreement; `tests/server/rooms.test.ts`; `tests/property/protocol.property.test.ts` proves the same digest agreement purely, for every seat of every generated state | E2E + server + property | Covered |
| GQA-08 | Privacy | hidden hand leaked | `tests/server/index.integration.test.ts` (privacy in a real frame, log redaction), `e2e-multiplayer` hand-privacy probe, `tests/property/protocol.property.test.ts` (no seat's view carries another hand, any state) | server + E2E + property | Covered |
| GQA-09 | Reconnect | state/identity corruption | `tests/server/reconnect.test.ts`, `tests/net/reconnect.test.ts`, `e2e-multiplayer/lobby.spec.ts` LB reload/second-tab | server + E2E | Covered |
| GQA-10 | Timer | race / softlock | `tests/server/timer.test.ts` — DONE vs deadline, duplicate tick, disconnect grace, post-finish clock, all on a fake clock | integration | Covered |
| GQA-11 | Duplicate input | action processed twice | `tests/server/rooms.test.ts` double submit, `queue.integration.test.ts` duplicate join, `public-rooms.test.ts` double leave; nightly traced multiplayer for the UI double-click class | server + E2E (nightly) | Covered |
| GQA-12 | Persistence | restored state differs | `tests/persistence.test.ts` (round-trip, corrupt saves, versioning), `tests/lifecycle.test.ts`, `tests/property/serialization.property.test.ts` (round-trip and refusal over generated states — where the out-of-range active seat was found) | integration + property | Covered |
| GQA-13 | Compatibility | unusable on a target platform | `e2e-cross/` on 8 device/engine profiles; multiplayer lobby on Firefox + WebKit (nightly) | E2E | Covered |
| GQA-14 | PWA/offline | expected offline flow unavailable | `e2e-pwa/offline.spec.ts`, `update.spec.ts`, `tests/pwa.test.ts` | E2E + unit | Covered |
| GQA-15 | Player feedback | player cannot understand state | `tests/invalid-detail.test.ts`, `objective.test.ts`, `results-summary.test.ts`; `e2e` blocked-FEITO / reason-badge journeys. Comprehension itself is manual | unit + E2E + manual | Partial (by design) |
| GQA-16 | Full match | emergent integration failure | `tests/probes.test.ts` (40 seeded full matches), `tests/server/lobby-soak.test.ts` (10 seeds × 1200 steps), `e2e-multiplayer` real 2/3/4P matches | simulation + E2E | Covered |
| GQA-17 | Navigation | dead end / wrong return path | `e2e` `esc` (backs out one level at a time), `pause-draft` (draft survives pause → settings → rules → resume), `second-match` | E2E | Covered |
| GQA-18 | Settings | state/persistence incorrect | `tests/persistence.test.ts`, `settings-layout.test.ts`, `audio.test.ts`; `e2e` `ai-settings` persistence journey | unit + integration + E2E | Covered |
| GQA-19 | Localization | missing/mixed/raw UI copy | `tests/i18n.test.ts` — pt/en parity, every declared key non-empty and not a raw key, every `t()` literal in `src/` declared, every `plural()` base declaring its forms, interpolation/plural/fallback behaviour | unit | Covered |
| GQA-20 | Game setup | selected config not applied | `e2e` `setup: seat/personality picker` — asserts the dealt lineup is the 4 seats and 3 distinct opponents picked | E2E | Covered |
| GQA-21 | Accessibility | critical flow inaccessible | `tests/motion.test.ts`, `feel.test.ts`, `persistence.test.ts` (OS reduced-motion/locale on first run), `tokens.test.ts` (`fitTextScale`), `menu/settings-layout` geometry; `e2e` `a11y-reduced-motion`, `*-large-text`, `keyboard`, `mobile-badge-reason` and `tutorial refusal` (non-colour-only, non-sound-only signalling) | unit + E2E | Covered, within the canvas limits documented in [ARCHITECTURE.md](ARCHITECTURE.md) |

| GQA-25 | Assets | a shipped asset is missing, misnamed, the wrong size, or loaded by nothing | `tests/assets.test.ts` — manifest and disk agree in both directions, every sprite is authored at its drawn size and every background at the documented third, naming convention, an alpha channel where a sprite needs one, a file for every audio cue. Subjective quality stays a human judgement against the anchors in [ART_DIRECTION.md](ART_DIRECTION.md) | unit | Covered for the objective classes |
| GQA-24 | Documentation | canonical docs no longer describe the code | `tests/docs-drift.test.ts` — every `npm run …` a doc names exists, every backticked repo path resolves, every quoted version constant matches its source, and every canonical doc `AGENTS.md` routes to is present. Prose staleness stays a human judgement | unit | Covered for the mechanical classes |
| GQA-22 | Deployment | shipped config weakens a boundary | `tests/deployment.test.ts` (the `nginx.conf` header set, CSP without a script escape hatch, access logging still off); CI's `server-image` job (the image boots, answers `/health`, and is not root); nightly `dependency-audit` | unit + CI | Covered |
| GQA-23 | Long session | resource growth over a long session | `e2e/perf-measure.spec.ts` (10 match cycles: heap, DOM nodes, listeners, and the product-owned counters from `__MEXE__.lifecycle()`), bounded in the gated `second-match` journey | measurement + E2E | Covered |

Severity is kept separate from priority. S1 = crash, softlock, card loss,
hidden-information leak, seat/session theft, authoritative corruption, match
cannot start or finish. S2 = wrong rule result, wrong turn, AI cannot finish,
reconnect loses state, feature unusable. S3 = unclear feedback, non-blocking
layout defect. S4 = cosmetic.

## Scenarios and fixtures

A new test should read as **scenario + a short action sequence + a meaningful
assertion**. If it opens with thirty lines of object literal, the fixture is
missing, not the test.

Three layers, each importing only the one below it:

```text
primitive builders   tests/helpers/cards.ts        n(), j(), withHand()
        ↓
state fixtures       tests/helpers/scenarios.ts    gameState(), dealtMatch(), legalDraft()
        ↓
canonical scenarios  tests/helpers/scenarios.ts    tableRearrangement(), oneCardFromWinning(),
                     tests/server/manager.ts       finishedMatch(), invalid.*, testManager(),
                                                   startedRoom()
        ↓
generated families   tests/helpers/generators.ts   randomDeal(), playedMatch(), validMeld(),
                     tests/helpers/property.ts     arbitraryCards(), corrupt.*, forAll()
```

The last layer is the generative one, used only by `tests/property/`: the named
scenarios are single states, the generators are the families they are drawn
from. See [Property and fuzz testing](#property-and-fuzz-testing).

Rules that keep this cheap:

- **Valid by default.** `gameState()` is a legal, playable two-seat state — SCN-03,
  the normal legal turn. Patch only the field the test is about. Anything
  deliberately broken lives under `invalid.*` (`duplicateCard`, `missingCard`,
  `illegalTable`, `wrongActivePlayer`) so a reader never has to work out *which*
  rule a fixture breaks. `tests/rules.test.ts` asserts those fixtures really are
  invalid — an invariant check that cannot fail is not a check.
- **Fresh every call.** Every helper constructs and returns; nothing shared is
  mutable, and `GameState` is readonly anyway (INV-S2), so one test cannot
  contaminate the next.
- **Deterministic.** No `Math.random` and no wall clock in a fixture. A seeded
  deal is `dealtMatch(seed)`; a seed that needs a property (`seedWithTriple()`)
  is *searched* rather than hardcoded, so a shuffle change moves the seed instead
  of silently breaking the test that depended on it.
- **Lowest owner.** Domain fixtures import no Phaser, no DOM and no Playwright,
  which is why a server test and a browser-free AI test can both use them.
  Browser-only setup stays in `e2e-multiplayer/harness.ts` and the Playwright
  configs.
- **Test-local is fine.** A builder with exactly one consumer (the lobby message
  builders in `tests/lobby.test.ts`, the AI's `base()` in `tests/ai.test.ts`)
  stays where it is used. Promote it only when a second suite needs it.
- **No DSL.** These are plain functions. The repo does not need, and will not
  grow, a fixture language.

Server-side, `tests/server/manager.ts` is the equivalent: `testManager()`
injects the four things a room test must control (clock, room code, reconnect
token, deal seed) and `startedRoom()` returns a dealt room and its per-seat
tokens. `tests/server/harness.ts` is the other end — a *real* server process
driven by raw `ws` clients, used only where the wire itself is the subject.

The scenario library is deliberately small and matches the `SCN-xx` catalogue in
[INVARIANTS.md](INVARIANTS.md#canonical-scenarios). A scenario earns a slot when
a second suite needs it; until then the state belongs in the test that uses it.

## Mocking policy

> Mock the platform boundary, not the code under test.

Fine to fake: the clock, the WebSocket transport, `localStorage`, vibration,
document visibility, the network.

Not fine to fake: `src/rules`, `GameState` transitions, action handlers,
`DraftEditor`, `RoomManager`, or any internal collaborator that runs
deterministically in milliseconds. Over-mocking produces a suite that stays
green while the integration it describes is broken — which is exactly the class
of bug the application-level tests exist to catch.

The application seams (`LocalMatch`, `OnlineSession`, `LobbyMachine`,
`GameStore`, `RoomManager`) are the preferred targets precisely because they
need no mocks: they take state in and hand facts back.

## Deterministic testing

- Gameplay randomness comes from the seeded RNG (INV-R1); a failing seeded test
  prints its seed and `npm run replay` reproduces the match exactly.
- Time is injected, never waited on: `now()` on `RoomManager`, fake timers in
  `tests/net/reconnect.test.ts`, explicit `sweep()` calls instead of a real
  grace window.
- No `sleep` in deterministic logic. The only permitted real waits are in
  browser suites, and there they wait on observable state (`expect.poll`,
  `waitFor`), never on a duration chosen to be "probably enough".
- A test that needs a specific dealt hand searches for the seed that has it
  rather than hardcoding card ids that a shuffle change would invalidate.
- A generated test is seeded from the same stream and prints the seed, the
  minimized counterexample and the command that re-runs that one case —
  [Property and fuzz testing](#property-and-fuzz-testing). A randomized test
  whose failure cannot be reproduced is not allowed in this repository.

## Test output

Verbosity modes are `WORKFLOW.md` §1's subject, not this document's. What the
suites owe it: a passing run says almost nothing, and a failing one prints only
what the next step needs — the assertion, the seed of a randomized failure, the
scenario or acceptance id, the file and line. Full logs go to `tmp/` or the
Playwright artifacts and are referenced by path, not pasted. `lobby-soak`'s step
log is the model: silent until it fails, then the exact walk plus the seed that
replays it.

## Runtime budgets

Measured on a developer machine; CI is slower but the ratios hold. Treat these
as orders of magnitude, not deadlines — nothing in the repo asserts them.

| Command | Covers | Typical |
|---|---|---|
| `npx vitest run tests/<file>` | one suite, the iteration loop | < 1s |
| `npm run test` | every unit/application/simulation/server test with coverage, the fast property budget and the golden replays | ~12s, ~1010 tests |
| `npm run test:replay` | the five golden replays alone | < 1s |
| `npm run simulate -- --seeds 1-200` | batch AI-vs-AI matches through the production dispatcher | ~11s |
| `npm run lint` | ESLint over six trees + `tsc --noEmit` | ~4s |
| `npm run test:property` | the same properties at the extended budget | ~9s, nightly |
| `MEXE_SOAK=1 npx vitest run tests/server/session-soak.integration.test.ts` | the session soak at the long budget (8 room lifecycles instead of 2) | ~45s, nightly |
| `npm run screenshot` | build + the browser journey/perf suite | minutes |
| `npm run verify:multiplayer:chromium` | build + two-plus real clients | minutes |
| `npm run verify:multiplayer` | the same on three engines | ~18 min — nightly, not per PR |
| `npm run verify:cross` | build + 8 device/engine layout profiles | minutes |
| `npm run verify:visual` | build + the six pixel baselines | ~30s |
| `npm run test:mutation` | 1521 mutants over the six core modules and the two wire-contract modules, six concurrent vitest sandboxes | ~2 h — weekly, or on demand |

The developer loop is the first two rows. Everything below them is a gate, not
a loop: do not re-run a browser suite after every edit, and do not make a commit
wait on engine parity. The property and replay suites are inside `npm run test`
because they are milliseconds; the extended fuzz budget and mutation testing are
outside every gate because they are not.

## Unit tests — `npm run test`

Vitest with V8 coverage, node environment (no browser). Anything that imports
Phaser cannot run here, which is why layout, snapping, tap-destination and
helper logic live as pure modules under `src/table` and `src/ui`.

- `tests/rules.test.ts` — the rules engine: decks, deals, runs, groups, joker
  assignment, the one-joker-per-meld limit, reusing a committed joker in another
  meld (legal only when the meld it leaves survives without it), ace low/high and
  the no-wrap case, `canConfirmTurn`, win and draw-pile-exhaustion, serialization.
- `tests/helpers/scenarios.ts` — the canonical states (`gameState`, `dealtMatch`,
  `tableRearrangement`, `oneCardFromWinning`, `finishedMatch`, `legalDraft`,
  `seedWithTriple`, `invalid.*`) shared by the rules, application, AI and server
  suites. See [Scenarios and fixtures](#scenarios-and-fixtures).
- `tests/helpers/invariants.ts` — the shared card-conservation assertion
  (GQA-02). It checks the **id set**, not a total: one lost card paired with one
  duplicated card keeps a count intact. Reuse it rather than re-counting.
- `tests/draft.test.ts` — Mexe Mode editing, undo/redo/reset, card conservation.
- `tests/actions.test.ts` — the pure `applyGameAction` and the `GameStore` slot:
  what each action does, what a refusal leaves untouched, and that the store
  reaches no global bus (ARCH-004).
- `tests/match.test.ts` — **local match orchestration without Phaser**
  (`LocalMatch`): confirm, draw, refusal, finish, AI turn routing, disposal
  (a search that yields past the end of the match is dropped), a Mexe
  rearrangement built by the real `DraftEditor` and confirmed through the
  ordinary dispatch path, and that a listener on a finished match never hears the
  next one.
- `tests/online-session.test.ts` — **online application state without a socket**
  (`OnlineSession`) driven by recorded server frames: a fresh frame, a stale
  revision, a digest mismatch and its resync policy, a dropped draft, the Mexe
  bonus edge, seat-gap translation, and the missed-turn limit.
- `tests/lobby.test.ts` — **every lobby transition without Phaser**
  (`LobbyMachine`): entry/offline/resume, the share link, joining, ready and the
  terms-changed explanation, host-only screens, the matchmaking queue, and where
  each class of server refusal is answered.
- `tests/probes.test.ts` — 40 seeded AI-vs-AI full matches asserting card
  conservation, table legality, turn rotation and termination after *every*
  turn, plus the draw-pile and undo/reset-abuse edge probes.
- `tests/ai.test.ts` — legality, determinism, budgets, personalities and the
  four difficulty tiers, plus one **strategy threshold**: Bia (rearranges) must
  still beat Cida (never does) on at least 10 of 12 seeded matches *and* leave her
  holding at least 5 cards on average. A search that quietly stops finding its
  plays leaves every other AI test green — the moves stay legal, reproducible and
  in character, they are simply worse — so the guard has to be an outcome, not a
  recorded move. Twelve games of win/loss only catch a catastrophic break; the
  margin is the continuous measurement that degrades smoothly with search quality,
  which is what gives a sample this small any resolution. Widen it with
  `npm run simulate`, not here: it costs ~2s of the suite as it stands.
- `tests/tutorial.test.ts` — all 12 steps, the per-step allow-list, completion,
  and the **authority boundary**: the tutorial gate is pedagogical only, so it
  can refuse a legal action and can never let an illegal one past `src/rules`
  (ARCH-021). Also the refusal itself: an off-script move is held as state the
  step panel writes out, survives until the step gets what it asked for, and
  never outlives a restart (A11Y-007).
- `tests/i18n.test.ts` — pt-BR/en-US key parity, every declared key resolving to
  non-empty copy that is not the raw key, and every `t('...')` string literal in
  `src/` being a declared key, every `plural('...')` base declaring `.one` and
  `.many`, `{param}` interpolation replacing *every* occurrence, `plural()`
  choosing one/many/zero, and a missing key falling back to its own name while
  warning once in dev.
- `tests/net/room-settings.test.ts` — timer presets, custom-value clamping,
  `set_room_settings` on the wire, and that a ticking clock stays out of the
  state digest.
- `tests/layout.test.ts`, `snap.test.ts`, `zoom.test.ts`, `regions.test.ts`,
  `editor-layout.test.ts`, `menu-layout.test.ts`, `settings-layout.test.ts`,
  `viewport.test.ts`, `tap-destination.test.ts` — pure layout/interaction maths.
- `tests/overlay.test.ts` — the modal contract: Esc backs out one overlay at a
  time, and a scene shutdown under an open panel runs its `close()` once, so an
  orientation flip (every menu-family scene restarts on one) strands no Esc
  entry, canvas listener or "panel open" flag.
- `tests/tokens.test.ts` — the design-system guard: no `src/ui`, `src/scenes`,
  `src/main.ts` or `src/core/pwa.ts` module (the Phaser UI plus the DOM chrome
  drawn over it) hardcodes a text colour or uses an inline integer colour (a content
  colour must be a named, documented constant), each semantic role is distinct,
  a colour that exists as both text and fill is defined once, no focus ring
  reuses a gameplay-status colour, the ground colour agrees with `index.html`,
  and every control is taller on a coarse pointer. See
  [ARCHITECTURE.md](ARCHITECTURE.md) "UI design system".
- `tests/persistence.test.ts`, `lifecycle.test.ts`, `error-recovery.test.ts`,
  `offline.test.ts`, `pwa.test.ts` — settings, sleep/resume, corrupt saves,
  connectivity, service-worker registration behaviour.
- `tests/playlog.test.ts`, `objective.test.ts`, `results-summary.test.ts`,
  `cosmetics.test.ts`, `audio.test.ts`, `music-playback.test.ts`,
  `helpers.test.ts`, `showcase.test.ts`, `motion.test.ts`, `feel.test.ts`,
  `intensity.test.ts`, `invalid-detail.test.ts`, `no-telemetry.test.ts`,
  `config.test.ts`, `viewToState.test.ts`, `net/errors.test.ts`.
- `tests/replay.test.ts` — deterministic reproduction: same seed + same actions
  → same state and digest, the five golden fixtures in
  `tests/fixtures/replays/`, and the refusals (future version, malformed JSON,
  unknown action type/actor/meld, illegal sequence, a card the seat cannot
  play, corrupt snapshot start, an active player that is not a seat, diverged
  final hash). See [Golden replays](#golden-replays).
- `tests/property/*.test.ts` — the generative invariants, in their fast budget.
  See [Property and fuzz testing](#property-and-fuzz-testing).
- `tests/boundaries.test.ts` — the architecture guard: the domain core's import
  allow-list, no platform/clock/unseeded randomness in `rules`, `mexe-mode`,
  `game-state` or `table`, Phaser confined to the presentation layer, and the
  server importing only the shared rules/protocol/rng, the extracted application
  modules (`match.ts`, `online-session.ts`, `lobby.ts`) reaching no scene, Phaser
  or DOM, legality functions being declared only in `src/rules`, product code not
  importing the verification adapters, plus the play log importing nothing outside
  `core` (bar the match-event type) and reading no browser API. See
  [ARCHITECTURE.md](ARCHITECTURE.md#enforcement-status).

`npm run test:watch` for the watch loop.

## Property and fuzz testing — `npm run test:property`

`tests/property/` asks a different question from every suite above it. A unit
test says *this deal, this meld, this answer*. A property says **this is true of
every deal, every meld, every legal action sequence** — and then generates a few
hundred of them looking for the one that is not.

### When a property is the right test

Use one where the invariant is clearer than the examples:

- card conservation, table legality and turn rotation over generated matches
- a round trip: `deserialize(serialize(state))`, `runReplay(replayOf(match))`
- determinism: same state + same action ⇒ same next state
- an *agreement* between two entry points — `analyzeMeld` vs `validateTable` vs
  `getInvalidMeldReasons`
- a refusal: every named corruption of a valid state comes back as a
  `RulesError` with a code, never as a crash and never as trusted state

Do not use one where the example is the point. `Q-K-A-2` being illegal is a
rule, not a property; it belongs in `tests/rules.test.ts` where a reader can see
the case. And never assert a property by re-deriving the implementation —
`expect(result).toEqual(reimplementTheAlgorithm(input))` proves only that the
bug was copied twice.

**Not fuzzed at all:** rendering, Phaser, audio, animation, input, the service
worker, anything with a real clock. Their failures are not invariant-shaped, and
a generator cannot tell a good frame from a bad one.

The four files, and what each owns:

| File | Owns |
|---|---|
| `tests/property/rules.property.test.ts` | deck, shuffle, deal; meld analysis, jokers, the validators agreeing, display sorting |
| `tests/property/state.property.test.ts` | the `applyGameAction` contract: what an accepted action reports, that a refusal changes nothing, determinism, a finished match refusing everything |
| `tests/property/serialization.property.test.ts` | save round-trip and refusal; replay round-trip, divergence and a foreign card id |
| `tests/property/ai.property.test.ts` | every AI decision over reachable states: legal or a draw, observation untouched, reproducible — on small budgets, not the shipped search |
| `tests/property/protocol.property.test.ts` | every seat's redacted view: own hand only, and the client's reconstruction digesting to the server's hash |

### Generators

`tests/helpers/generators.ts`, layered under the fixtures the same way
`scenarios.ts` is: `cards.ts` builds cards, `scenarios.ts` builds named states,
`generators.ts` builds *families* of them — `randomDeal`, `playedMatch`,
`reachableState`, `validMeld`, `arbitraryCards`, `corrupt.*`.

Two rules keep them honest:

- **Valid by construction.** A generated meld is built as a run or a group with
  at most one joker filling a slot the naturals leave open. "The validator
  accepts it" is then a real claim, not a tautology. Generating arbitrary JSON
  and discarding 99.9% of it would prove nothing about a card game.
- **Invalid by name.** `corrupt.duplicateCard`, `missingCard`, `illegalTable`
  and `wrongActivePlayer` each break exactly one documented invariant, so a
  rejection can be attributed. Random garbage only proves garbage is refused.

Action sequences come from `RearrangerAi`, the widest production decision path,
so the generated matches exercise table rearrangement rather than only
lay-down-and-extend. They used to come from `SimpleAi` because the rearrange
search stopped on a `performance.now()` deadline, and a generator whose whole
value is that a seed reproduces the failure cannot call something a loaded
machine decides differently. The search spends a deterministic trial budget now
(INV-A5), so the workaround went with the reason for it — at the cost of the
extended budget's runtime, which is the price of fuzzing the real engine.

### Seeds, reproduction and minimization

Every property runs on the game's own seeded RNG (INV-R1). Iteration *i* uses
`baseSeed + i`, so CI and a laptop see the same corpus.

On failure `tests/helpers/property.ts` prints the property name, the seed, the
minimized size, the counterexample and the command that runs that one case:

```bash
MEXE_PROP_SEED=42 MEXE_PROP_SIZE=3 npx vitest run -t "a corrupted save is refused"
```

Minimization is exact rather than heuristic: a generator takes a `size` (action
count, meld length), and the runner scans sizes upwards from 0 for the smallest
one that still fails at that seed. There is no shrinking framework and no
library — the only dimension worth shrinking here is "the same match with fewer
turns", which is one number.

When a property finds a real defect: fix production, then **keep the smallest
durable regression** as an ordinary unit case (naming the property that found
it), not the whole generated match. The property stays as the generative net;
the unit test is what a reader sees. `tests/rules.test.ts` → *rejects a save
whose active player is not a seat* is the worked example.

### Fast and extended budgets

Each property declares both counts inline as `runs(fast, extended)`:

| Mode | Command | Iterations | Runs in |
|---|---|---|---|
| Fast | `npm run test` (included) | 10–80 per property | every PR, the developer loop |
| Extended | `npm run test:property` | 60–3000 per property | nightly (`.github/workflows/nightly.yml`), on demand, and before a rules change lands |

Extended is the same tests with `MEXE_FUZZ=extended` and a 60-second per-test
timeout (a few hundred generated matches outlast vitest's 5-second default on a
loaded machine — a timeout there is a starved CPU, not a failed invariant); it
is not a different suite and it never has different assertions. The fast budget is sized to stay
inside the unit-test runtime — if a property cannot pay for itself there, it
belongs only in extended.

## Golden replays — `npm run test:replay`

A golden replay answers one question no unit test does: *did this whole match
still end the way it ended?* Five committed artifacts in
`tests/fixtures/replays/`, replayed on every `npm run test`:

| Replay | Protects |
|---|---|
| `basic-turns` | the ordinary opening — draws, one confirmed turn, the turn counter and the seat rotating |
| `rearrange-joker` | Mexe rearrangement: cards, jokers included, moving between committed melds without loss |
| `win-empty-hand` | the win ending: a seat empties its hand while cards remain in the pile |
| `ai-match-finish` | the exhaustion ending at two seats: the pile runs out, fewest cards wins |
| `four-seat-pile-out` | four-seat rotation to an exhausted pile, decided by the seat-order tiebreak |

The corpus is deliberately small: **one artifact per ending, not one per rule.**
A sixth replay that re-proves a rule `tests/rules.test.ts` already owns is a
liability — it is slower, larger and harder to read than the unit test it
duplicates.

### What a replay is, and what it is not

The format is `src/game-state/replay.ts` (`REPLAY_VERSION` 1): a start point
(seed + seats, or a snapshot) plus the ordered actions, carrying card **ids**
only. No coordinates, no animation, no timing, no presentation state — nothing
Phaser can see. A recorded match is a few kB, it is JSON a human can open, and
it replays through `applyGameAction`, the same function live gameplay
dispatches, so a replay can only reach states the game could reach.

The contract each one defends is the table in `tests/replay.test.ts`: the
outcome facts a player would notice (actions, turn, phase, winner, pile size,
hand sizes), plus card conservation, table legality and the file's own
full-state digest. Assertions are targeted, not "snapshot everything".

### Running and regenerating

```bash
npm run test:replay                                   # the whole corpus
npm run replay run tests/fixtures/replays/<id>.json   # one, with its final hash
npm run replay record <seed> <out.json> [maxActions] [personalities]
```

### Golden update policy

There is no "update the snapshots" command, on purpose: a flag that rewrites
every expectation turns a behaviour change into a green diff.

When a golden replay fails:

1. **Read the diff.** The failure prints the replay id, its start (seed and
   seat count), the contract fields that moved, and — if an action was refused
   — its index and reasons. An action refused mid-replay means a legality
   change; a matching contract with a different digest means something moved
   inside the state that the contract does not name.
2. **Decide whether the product changed.** A rules or deal change that moves a
   recorded outcome is expected to fail here. A change that was not supposed to
   touch gameplay is a defect, and the replay just caught it.
3. **Only then regenerate**, with `npm run replay record` and the same seed and
   personalities, and review the regenerated file's contract line by line in the
   PR.
4. **Say why in the commit message.** A regenerated golden with no stated reason
   is an unreviewed behaviour change.

Never edit a fixture by hand, and never relax a contract to make a run pass —
that is the "weaken a test" prohibition in `AGENTS.md`.

## Mutation testing — `npm run test:mutation`

Coverage says a line ran. Mutation testing asks the question that matters:
**would these tests fail if the logic were subtly wrong?** Stryker rewrites one
operator, branch or literal at a time and re-runs the suite. A mutant the tests
kill is a defect class they would catch; a mutant that survives is one they
would not.

### Scope

`stryker.conf.json` mutates the deterministic gameplay core only:

```text
src/rules/rules.ts        legality, transitions, the deal, the save reader
src/rules/rng.ts          the seeded stream
src/rules/hash.ts         the digest replays and the server compare on
src/game-state/actions.ts the one validated local transition
src/game-state/replay.ts  the replay parser and runner
src/mexe-mode/draft.ts    the draft editor
src/net/protocol.ts       the wire contract: view projection, digest, message validation
src/net/viewToState.ts    the client-side projection and its seat validation
```

The two `src/net` modules were added once the gameplay core had been measured.
They are the right second target for the same reason the core was the first:
deterministic, contract-sensitive, small next to the server orchestration, and
the place where a dropped validation is a privacy or correctness bug rather than
a cosmetic one.

Scenes, rendering, audio, the socket glue, the AI and generated assets are out.
A mutant in a scene is either killed by a browser suite that costs minutes or
survives for reasons that say nothing about product risk. Expand the scope only
when a survivor elsewhere is shown to matter.

The mutants run against `vitest.mutation.config.ts` — the rules, draft, action,
match, replay, probe, AI and property suites, plus the view-projection, online
session and `tests/net` suites that observe the wire contract — not the whole
tree. Every suite in that list is pure: suites that scan the source or drive a
socket cannot kill a mutant in `src/rules` and would be paid for once per
mutant. Adding the four net suites left the runner's own cost unchanged (5.8s).

#### `server/rooms.ts`: not a whole-file mutation target yet

Deliberately out of scope, and not for lack of risk — it owns revision checks,
seat authorization, reconnect eligibility and the hidden-view projection. The
reasons are structural:

- It is a 970-line `RoomManager` class. The logic worth mutating lives in
  methods reached through room lifecycle, not in pure module-level functions
  (there are three, all trivial: `sameSettings`, `displayName`, `newSeat`).
  Extracting seams purely to satisfy the tool would be a refactor of the
  server's core for a diagnostic's convenience.
- Most of what protects it — `index.integration.test.ts`, the party/queue
  integration suites, `e2e-multiplayer` — drives a real socket, so it cannot
  join the mutation runner. Mutating the file against a runner that excludes its
  main evidence would report a flood of survivors that are artifacts of the
  harness rather than real gaps.

Protected primarily by the server integration tests, the multiplayer E2E
scenarios and `tests/server/rooms.test.ts`. Revisit during multiplayer
hardening, when a seam that already exists for its own reasons can be mutated —
not before.

### Interpreting survivors

For each surviving mutant, in order: *is this a realistic defect? would a player
notice? should an existing test have caught it?* Classify it, and only then
decide whether anything changes:

| Class | Meaning | Action |
|---|---|---|
| **Important gap** | A realistic wrong answer no test notices | Fix the *cheapest* level that sees it — usually one unit assertion or one property, rarely a new integration test |
| **Equivalent** | The mutant cannot change observable behaviour (a redundant guard, a defensive fallback that is unreachable) | Document, move on |
| **Low value** | Observable but harmless — a display sort order inside an invalid meld, a reason-code preference | Document, move on |
| **Unreachable** | Dead under current configuration (a config the product never sets) | Document, move on |
| **Tool artifact** | A string/literal mutation with no semantic meaning | Ignore |

Accepted survivors are listed below with their class, so the next run's report
can be diffed instead of re-litigated.

### The run of record

#### Wire contract, 2026-09-17

`src/net/protocol.ts` + `src/net/viewToState.ts`, 423 mutants, 39 minutes. This is the run that
*found* the gaps — it predates the tests written to close them, so read the survivor column as the
question that was asked, not as the state of the suite today:

| Module | Mutants | Killed | Timed out | Survived | Score |
|---|---|---|---|---|---|
| `src/net/protocol.ts` | 377 | 225 | 24 | 128 | 66.05% |
| `src/net/viewToState.ts` | 46 | 41 | 0 | 5 | 89.13% |

Read the survivors, not the score. Two groups mattered and both were closed:

- **`parseClientMessage`, 94 survivors.** Removing the visibility, queue, meld-shape, meld-id,
  card-id and reaction guards outright changed no test's answer, and so did turning every `>`
  limit into `>=`. The direction that looks harmless is the dangerous one: an off-by-one refuses a
  *legal* maximum-size turn, which the `MAX_TOTAL_CARDS` comment already warns surfaces as a
  generic `bad_message` and makes FEITO look dead. `tests/net/parse-client-message.test.ts` now
  pins each type's well-formed frame, each type's refusal, and every limit from both sides; the 13
  representative mutants above were re-applied by hand, one at a time, and all 13 die. Applying a
  known mutant directly is the cheap confirmation; a second 39-minute full pass would buy a number,
  not a fact.
- **The `viewToState` placeholder contract, 2 survivors.** A placeholder could claim `isJoker`,
  and a projected seat could claim `isAi`, with nothing noticing — both are fabricated gameplay
  meaning of exactly the kind the C4 trick promises never to produce. Pinned in
  `tests/viewToState.test.ts`.

No product defect was found: every test added above passed against the shipped code on the first
run. What the run exposed was missing *evidence*, not a broken parser.

#### A score is only comparable to one measured the same way

The first attempt at this run scored `protocol.ts` at **72.9%** — while `verify:multiplayer` was
running beside it. Alone, the same scope scored **61.8%**. The high number was the false one:
Stryker reads any non-zero exit as a killed mutant, so a wall-clock assertion that fails for lack
of CPU reports a mutant as caught that no test detected. `EMPTY_PARTY` — which no suite in the
mutation runner asserts at all — was reported killed under load and survives when applied by hand
on an idle machine.

`tests/helpers/timing.ts` fixes the cause: `expectWithinMs` stands down when the runner sets
`MEXE_MUTATION=1`, so a timing budget can no longer manufacture a kill. Termination is still
covered while mutating — Stryker's own `timeoutMS` is what actually catches a mutant that stops a
loop terminating, which is what those budgets were guarding. The cost is wall clock: mutants that
a 500ms assertion used to fail fast now run to the 60s timeout, which roughly doubled this scope's
runtime (16 → 39 minutes). Budget for that when reading `mutation.yml`'s timeout.

#### Gameplay core, 2026-09-17

Full scope, on the six core modules:

| Module | Mutants | Killed | Timed out | Survived |
|---|---|---|---|---|
| `src/rules/rules.ts` | 650 | 633 | 16 | 1 |
| `src/game-state/replay.ts` | 197 | 197 | 0 | 0 |
| `src/mexe-mode/draft.ts` | 194 | 182 | 12 | 0 |
| `src/game-state/actions.ts` | 41 | 41 | 0 | 0 |
| `src/rules/rng.ts` | 9 | 9 | 0 | 0 |
| `src/rules/hash.ts` | 7 | 6 | 1 | 0 |
| **Total** | **1098** | **1068** | **29** | **1** |

A timed-out mutant is a killed one: it made a loop stop terminating, and the
suite noticed by not finishing. The score is recorded because it is evidence
from one run, not because it is a target — see [Not a gate](#not-a-gate).

### Accepted survivors

| Mutant | Class | Why it is accepted |
|---|---|---|
| `src/rules/rules.ts:542` — the *message* of `RulesError('corrupt save: invalid table', 'corruptSave')` replaced with `""` | Tool artifact | The message is developer diagnostics; the contract is the `code`, and the tests assert `corruptSave`. Asserting message prose would pin a string that is meant to be rewritten freely, and would make the suite fail on a typo fix. |

That single survivor is also the run's control: a harness that marked
everything killed regardless would have "killed" this one too.

No important gaps were found, so no test was added to chase a survivor. What
the run does show is where sensitivity came from — the reason-code mutants in
`analyzeMeld` die against
`tests/property/rules.property.test.ts`'s validator-agreement property, which
asserts the exact reason `getInvalidMeldReasons` reports for every generated
card set.

### Not a gate

There is **no mutation-score threshold** (`thresholds.break` is `null`) and
there never should be: a score target is gamed by adding assertions to whatever
is cheapest to kill, which is the opposite of the portfolio rule at the top of
this document. Mutation testing is a diagnostic — run before a rules change, when a suite is
being restructured, or when a defect escaped a level that should have caught it
— never on every commit. It takes about two hours; the developer loop is
seven seconds.

It no longer depends on being run by hand: `.github/workflows/mutation.yml`
runs the full scope weekly (03:00 UTC Sundays) and on manual dispatch, and
uploads `tmp/mutation/` as an artifact whatever the score. The run reports and
never blocks, so the artifact is the result — a green check on that workflow
means it finished, not that nothing survived.

This used to carry a warning not to run it next to `npm run test`, because six
concurrent vitest sandboxes could starve `RearrangerAi`'s wall-clock search
deadline and fail the AI soak for lack of CPU rather than for a defect. That
deadline is gone (the search spends a deterministic trial budget, INV-A5), and
with it the whole class of CPU-contention flake.

Phase 83 removed the last of that class from the unit suite: the deleted soak
suite played seeds 1..20 of the same harness `probes.test.ts` runs over seeds
1..40, so its termination coverage was a strict subset, and its two remaining
assertions were a wall clock and a heap sample. The heap tripwire moved into `probes` as an
`afterAll` over the runs that already happen (no seed is replayed for it); the
wall clock did not — it measured
the runner rather than the code and failed under parallel suite load instead of on
a defect.

## Server tests — `npm run test:server`

`tests/server/` only: `rooms.test.ts` (room lifecycle, seat/ready/start, legal
and rejected turns, double submit, reconnect, sweep), `timer.test.ts`
(room-settings lock, the server turn clock on a fake clock, timeout behaviour,
the Mexe bonus, DONE-vs-deadline, reconnect grace and the missed-turn limit),
`connections.test.ts` (socket registry, flood guard, caps), `matchmaking.test.ts`
and `queue.integration.test.ts` (`OM-*`), `public-rooms.test.ts` and
`discovery.test.ts` (`OP-*`), `party.test.ts` / `party.integration.test.ts`
(`OS-*`), `hardening.test.ts` (`OH-*`), `config.test.ts`, `log.test.ts`
(redaction), and `index.integration.test.ts`, which spawns the real server
process and drives raw `ws` clients — malformed and oversized frames, failed
joins, connection caps, seat ownership, hand privacy in a real frame, and a
clean session writing nothing to stderr.

`lobby-soak.test.ts` is the seeded counterpart to the named `LB-*` browser
scenarios: a deterministic random walk of join/leave/ready/disconnect/
reconnect/start/play/rematch against a real `RoomManager` (10 seeds x 1200
steps), re-checking every room invariant after each step — seat uniqueness, the
roster matching who actually joined, host authority on an occupied chair, a
token never resolving to another seat, the lock following the match state, and
the seat/player-index mapping inside a view (MULTIPLAYER.md §3f). A failure
prints the step log and the seed replays it exactly.

These also run as part of `npm run test`.

## Lint — `npm run lint`

ESLint over `src tests e2e e2e-cross e2e-multiplayer e2e-pwa server`, then
`tsc --noEmit`.

## Browser suites (Playwright)

| Suite | Config | Command | Covers |
|---|---|---|---|
| Screenshots + perf | `playwright.config.ts` (`e2e/`) | `npm run screenshot` | Boots the built game, drives real journeys (Mexe, pause/help/Esc navigation, setup → match, mobile tap play, helper modes, tutorial) through the debug API, captures `docs/screenshots/*.png`, records fps and console errors into `verify-log.json` |
| Cross-browser layout | `playwright.cross.config.ts` (`e2e-cross/`) | `npm run verify:cross` | Canvas fits, centres and keeps the live world's aspect on Chrome, Firefox, Safari, Pixel 7, iPhone 14 (both orientations), iPad, a 2560×1440 desktop and a 412×915 phone at DPR 3; rotation (including a panel left open across the flip) and mobile tap gameplay |
| Multiplayer | `playwright.multiplayer.config.ts` (`e2e-multiplayer/`) | `npm run verify:multiplayer` | Two-plus real clients against the real server: legal turns, illegal-proposal rejection, hand privacy, 3P/4P rotation, reconnect/resync, and LB-46's lobby flow at both text scales. Three projects: `chromium` runs everything, `firefox` and `webkit` run the `LB-*` lobby state-machine suite, `webkit` also the iOS-viewport one |

Every spec here starts its own server on an **OS-assigned** port (`freePort()`
in `e2e-multiplayer/harness.ts`), never on a fixed block. A fixed port is shared
with whatever else is on the machine: when something already held it, the test
server died on `EADDRINUSE` while the health probe was answered by that other
process, so the suite ran against a stranger and the first visible symptom was a
WebSocket timeout in whichever engine ran that file — Firefox, which runs only
the lobby spec. `startTestServer` now fails the run with the child's stdout and
stderr if it exits during startup, or if the healthy answer came from a server
this process did not start (it waits for that process's own `server_listening`
line). The server itself logs `server_listen_failed` and exits 1 rather than
throwing an unhandled `error` event.

Adverse network conditions are exercised in the same suite rather than in a
level of their own: `CH-01..CH-05` intercept one client's socket with
`page.routeWebSocket` and delay, duplicate, re-deliver, drop or hold its
incoming frames, with the other client as the clean control. Deterministic by
construction — the mangler decides, not the network.

They are tagged `@chaos` and **excluded from the PR path**
(`verify:multiplayer:chromium` greps them out); the nightly
`verify:multiplayer` runs them. Not for their own cost — 57s for all five on
CI — but for peak concurrency: this suite is contention-bound, it already went
from three workers to two because the heaviest tests starved, and five more
tests each holding two browser contexts plus a Node-side frame proxy pushed
`LB-19..LB-24` past its 7-minute budget and `OD-28/OD-29` past its 3-minute one
on a 4-core runner. Locally they are `-g CH-0`. See
[MULTIPLAYER.md](MULTIPLAYER.md) §11.

`e2e-multiplayer/harness.ts` is also the single definition of a simulated
player: `newClient`/`newPhoneClient` (own browser context, own storage, own
socket), `trackConsoleErrors`/`consoleErrorsOf` and `shot`. The specs import
them rather than re-declaring their own — `multiplayer.spec.ts` keeps only its
worker's server URL and its `mp-` screenshot prefix — so "what a client is"
cannot drift between the multiplayer and lobby suites.

Because the harness opens every client, it can also say where each one was when
a test failed: each spec's `afterEach` calls `attachClientContexts(testInfo)`,
which on a failure attaches one record per client — scene, socket status, room
code, seat, dense player index, `rev`, `matchId`, notice, last rejections,
desyncs, app errors and the last twelve wire messages. A canvas screenshot and a
timed-out `waitForFunction` cannot name a seat or a revision; this does. It
reports and drains its list, and never closes a context: each test still owns
the clients it opened.
| Visual baselines | `e2e/visual.spec.ts` (the default config) | `npm run verify:visual` | Six deterministic states compared pixel-for-pixel against a per-platform baseline — see §Visual baselines |
| PWA / offline | `playwright.pwa.config.ts` (`e2e-pwa/`) | `npm run verify:pwa` | Service worker registers, offline reload boots to the menu, offline local/AI/tutorial play, online disabled offline, the update handover |

All four serve the production build via `npm run preview` — the service worker
only registers in a production build, and the screenshot suite must measure the
shipped bundle.

The screenshot suite is the project's functional browser suite as much as its
visual one: most of its captures are the *evidence* attached to a journey that
also asserts behaviour. The handful of pure captures (`*-large-text`,
`*-portrait`, `*-en` variants of the menu, settings, rules panel, pause menu and
setup lineup) are render smoke — they prove the screen builds without a page
error in that locale/scale/viewport and leave a PNG for human review. They are
not baseline-diffed.

## Verification gates

| Gate | What it adds |
|---|---|
| `npm run verify` | `test` + `lint` + `screenshot` + `scripts/check-verify.mjs`: no console/page errors, every expected screenshot present, no asset fell back to placeholder art, fps floors met (the fps floors are asserted inside the three `@perf` tests). |
| `npm run verify:multiplayer` | Build + the multiplayer suite on Chromium, Firefox and WebKit + `scripts/check-verify-multiplayer.mjs`: no client console errors, no server stderr, no accepted illegal proposal, hand privacy held, state hashes agree, and per-engine lobby evidence (rendered seat gaps, a three-match endurance run, the iOS orientation/rematch gate, and the background/foreground round trip that must resume on the live session rather than open a second one). |
| `npm run verify:multiplayer:chromium` | The same, Chromium only, with the gate told not to demand the Firefox/WebKit lobby evidence (`--engines=chromium`). This is the PR-path variant. |
| `npm run verify:cross` | Build + the cross-browser layout suite. |
| `npm run verify:pwa` | Build + the offline/update suite. |
| `npm run verify:preview` | Build + `scripts/check-preview.mjs`: `dist/` serves, every asset reference resolves, no credential-shaped strings in the bundle. |

### Which gate runs when

**PR gate** (`.github/workflows/ci.yml`, every push and PR): lint + unit tests +
build; `verify:multiplayer:chromium`; `verify:pwa`; the screenshot suite plus
`check-verify.mjs`; the cross-browser layout suite; and `server-image`, which
builds the server stage, boots it, reads `/health` and asserts the container is
not running as root — the images were previously first exercised by a deploy. Fast, deterministic,
high-signal — engine parity is deliberately *not* on this path. `npm run test`
carries the fast property budget and the golden replays; they cost about a
second between them and need no job of their own.

**What a change's scope can skip.** The `scope` job classifies the pull request's
diff and only two narrow shapes shrink the run; everything else falls through to
the full set, which is the conservative direction:

| Scope | Recognised as | Runs | Skips |
|---|---|---|---|
| Documentation only | Markdown, `docs/ROADMAP_STATUS.json`, `LICENSE` | nothing | every job |
| Server only | `server/**`, `tests/server/**` (plus docs) | lint + unit tests + build, `multiplayer`, `server-image` | `e2e`, `cross`, `pwa` — nothing in `server/` changes what a canvas paints |
| Anything else | any touch of `src/`, `public/`, `index.html`, a config file, `package.json`, the lockfile, a workflow | everything | — |

A push to `main` never shrinks: that run is what promotes the public build
([OPERATIONS.md](OPERATIONS.md#release-channels)), and an empty or unreadable
diff is not a licence to skip. If required status checks are configured on the
branch, they must tolerate a skipped job — the routing works by skipping jobs,
not by making them pass trivially.

**Scheduled, gating nothing:** both specialized suites now run on a clock as
well as on demand, because "run it when you remember" is not a control.

- `npm run test:property` (extended fuzz) and `npm run test:replay` run in
  nightly's `specialized-tests` job. Under ten seconds of pure node, so the
  earlier objection — that scheduling them buys a number nobody reads — does not
  apply at this price. Still run it by hand before a rules or deal change lands.
- `dependency-audit` runs in nightly: `npm audit` at `moderate` for runtime
  dependencies and `high` for dev tooling, plus `npm outdated` reported without
  failing. Nightly rather than per-PR on purpose — a gate that fails for an
  advisory published mid-review teaches reviewers to ignore it
  ([DEVELOPMENT.md](DEVELOPMENT.md#dependencies-and-bundle-cost)).
- `npm run test:mutation` runs weekly in `.github/workflows/mutation.yml`,
  not nightly: it takes over an hour, and its output is a report to read rather
  than a pass/fail. Still run it by hand when a core module is being
  restructured or a defect escaped the level that should have caught it.

Neither blocks a merge, and neither should. What the schedule buys is that a
regression in them surfaces within a day or a week instead of whenever someone
next thinks of it.

**Nightly** (`.github/workflows/nightly.yml`, 04:00 UTC): the expensive and the
race-hunting work — WebKit touch flake detection (`--repeat-each=5`,
`--retries=0`), the screenshot suite traced and retry-free, the full
cross-browser matrix, repeated untraced fps sampling for drift, the multiplayer
suite on all three engines, the multiplayer suite under tracing (tracing
slows frame processing enough to lose races a fast machine always wins — that is
how the double-click `create_room` duplicate was found), and the session soak at
its long budget (`MEXE_SOAK=1`), where eight room lifecycles on one process cost
~45s instead of the ~11s two cycles cost on every PR.

**Release gate:** `verify`, `verify:preview`, `verify:multiplayer` and
`verify:pwa`, all green, with zero console errors and zero server stderr lines.
`verify:multiplayer` here means the three-engine form, not the Chromium PR
variant. This is a human gate run before tagging: `.github/workflows/release.yml`
itself only re-runs lint, unit tests and the build, checks the tag against
`package.json`, and then publishes the Release and the container images.

Not every useful QA check blocks every PR. Engine parity for the lobby, traced
race hunting and fps trend lines are a within-a-day guarantee, not a
per-review one.

## Visual baselines

Six deterministic states (`e2e/visual.spec.ts`): the menu, a board mid-turn, the
Mexe draft, the win screen, the board in portrait, and the board at +25 % text.
Six, because a baseline that covers everything is a baseline nobody dares update.

```bash
npm run verify:visual                                     # build + compare
npx playwright test e2e/visual.spec.ts --update-snapshots  # after an intended change
```

**Baselines are per platform, because the platform is the renderer.** Captures
are byte-identical across runs on one machine and differ across machines (Phase 84
measured both), so Playwright's `{platform}` suffix is load-bearing: a
`-darwin` baseline says nothing about linux. CI's fixed runner is the one that
gates, in nightly's `visual-baseline` job; a developer's first local run writes
their own baseline and compares against it from then on.

**A platform with no committed baseline skips, and says so.** Failing every night
until someone adopts one is noise, and adopting one silently is worse. Run the
**Update visual baselines** workflow (`workflow_dispatch`): it regenerates on the
CI runner, confirms the new images pass as written, and opens a pull request — so
the review happens in a diff. That PR is the only way linux baselines arrive.

Tolerance is `maxDiffPixelRatio: 0.002` with animations disabled: a handful of
pixels can move when a tween lands a frame apart, while a real rendering change
moves thousands. Anything between the two is what a failure is asking you to look
at.

**Updating a baseline is a review, not a chore.** Regenerate, look at the diff,
and say in the commit what changed and why. A baseline updated without being
looked at has stopped meaning anything — which is why this is six states and not
every screen.

## Manual playtesting

Automation does not judge comprehension or game feel. The session protocol, the
observation prompts, the visual checkpoints and the bug-report format live in
[PLAYTEST_GUIDE.md](PLAYTEST_GUIDE.md). What a playtest owns: whether a player
knows whose turn it is, why FEITO is blocked, what just happened and how to
recover; whether the AI reads as an opponent rather than a delay; readability on
a real device in real light; and the exploratory sequences no scripted suite
thinks to try.

## Developer tools (not player features)

`window.__MEXE__` (`src/verification/debug-api.ts`) is how the browser suites
drive the game:

```
{ ready, seed, scene, fps, errors[], missingAssets[], validation, state(),
  showcase, tutorialStep, lastAiThought,
  mexe: { playHandCard, moveTableCard, undo, feito, comprar, getDraft } }
```

`state()` returns the local state only — online it holds the redacted per-seat
view, so it cannot leak an opponent's hand.

**The surface is an adapter, not a product dependency.** `window.__MEXE__.online`
is built in `src/verification/online-debug.ts` *from* the product's own owners —
`OnlineSession` and `LobbyMachine`, plus the `NetClient` — rather than assembled
out of a scene's private fields. A scene passes its owner in and supplies only
the handful of genuinely rendered facts (the on-screen notice, the focus ring,
the painted seat rows) and product actions (COMPRAR, join, queue) that have no
other reader. The direction that matters: verification reads product contracts;
product code does not exist to maintain a parallel test API, and
`tests/boundaries.test.ts` fails if a product module imports the adapters.

The few genuinely test-only entry points that remain are labelled as such —
`submitRaw` (an intentionally illegal proposal, the only way to exercise
server-side rejection) and `forceDrop` (kill the socket) — and both go through
the ordinary `NetClient`.

`replay()` returns the deterministic reproduction of the match on screen (seed,
start, ordered actions) and `null` online, where the local store is a projection
rather than a match this client played. Save its JSON and run it with
`npm run replay run <file>`; see
[DEVELOPMENT.md](DEVELOPMENT.md#reproducing-a-bug-from-a-replay).

**AI simulation harness.** `npm run simulate -- --seeds 1-200 --seats
cida,juninho,bia,ze --difficulty smart` plays batches of AI-vs-AI matches for
balance and regression work. It is not a test and asserts nothing; it reports.
It runs the production path — `createNewGame`, `observeForAi`, the personality
engines from `createAi` and `GameStore.dispatch` — so there is no simulation-only
rule or shortcut that could make a result the game itself could not produce. The
printed line is the whole input needed to reproduce a run (seats, difficulty,
seed range); `--json <path>` writes per-game rows (winner, turns, draws, cards
left per seat, peak trial spend) for tooling. A refused action would be a bug,
since every AI draft has already passed `canConfirm`, so one dumps that game's
replay to `tmp/` and exits non-zero with the `npm run replay run` command.

`--sweep difficulty` plays the same seeds at all four tiers, one row each;
`--sweep matchups` plays every head-to-head pair, each pair twice so both sides
move first — going first is worth real games in this format, and a one-sided run
would measure the seat as much as the personality. Rows within a sweep are paired
by construction: identical deals, identical seat order, one thing varied.

`--explain` prints one line per decision — seat, personality, reason class, cards
played, whether it rearranged, candidates weighed and trials spent — which is the
"why did it do that?" workflow that otherwise ends with a `console.log` inside the
engine. Use it on one seed at a time.

**Reading the numbers.** No single one of them is the answer, and none of them is
a pass/fail bar — the harness reports, it never asserts. A win count says who went
out first but not by how much; `avgCardsLeft` says how close the rest were;
`avgTurns` says whether the table moved at all; `drawRate` separates a seat that
had nothing to play from one that chose to wait. The `±` on a win count is the 95%
confidence half-width for that share, and the `±` on `avgTurns` is a standard
deviation: a gap narrower than the two intervals together is sample size, not a
difference. Numbers measured this way belong in the change that measured them, not
copied into this document, where they would rot.

The settings overlay also carries a **play-log export** (copies the in-memory
session log to the clipboard) used during playtests. The log is session-only,
never written to disk and never sent anywhere; names and reconnect tokens are
stripped from exports, and `?playlog=0` turns it off. See
[PLAYTEST_GUIDE.md](PLAYTEST_GUIDE.md).

## CI

`.github/workflows/ci.yml` runs on every push and PR, in parallel jobs: lint +
unit tests + build, multiplayer verification, PWA verification, the e2e
screenshot suite with its gate, and cross-browser layout.

The multiplayer job installs **Chromium only** and runs
`verify:multiplayer:chromium`. The three-engine run was the longest job on every
PR (~18m), and most of that was the lobby state machine replayed on Firefox and
WebKit; that replay moved to the nightly `multiplayer-all-engines` job. Engine
parity is therefore a nightly guarantee, not a per-PR one. The PWA and
screenshot jobs are Chromium-only too — they drive the service-worker lifecycle
and rendering, not cross-engine layout, which the cross job (all three engines)
covers. Failures upload `test-results/` and the relevant log as artifacts.

`.github/workflows/nightly.yml` re-runs the flakier and more expensive surfaces
— see "Which gate runs when" above for the job list. Its `specialized-tests`
job is the one that is not about browsers: it runs the extended fuzz budget
(`test:property`) and the golden replays (`test:replay`), both pure node and
under ten seconds combined. Those are the checks that previously ran only when
somebody remembered, which is the same as not running.

`.github/workflows/mutation.yml` runs the full mutation scope weekly and on
dispatch — separate from nightly because it takes over an hour, where every
nightly job is minutes. See [Not a gate](#not-a-gate).

`codeql.yml` scans the source; `pages.yml` deploys game + docs on `main`;
`release.yml` publishes a GitHub Release when a `vX.Y.Z` tag is pushed.

### Flake policy

Retries are a deliberate, documented choice per suite, never a way to hide a
race:

- `playwright.config.ts` and `playwright.cross.config.ts` retry once in CI to
  absorb a pointer event lost on a loaded shared runner. Playwright still
  reports the test as flaky, and the nightly no-retry runs of the same suites
  turn a first-attempt failure back into a hard failure.
- The three `@perf` fps tests run first, serially, with `--retries=0`: an fps
  measurement retried into passing hides exactly the regression it exists to
  catch.
- Tracing is off on the PR path (it is behaviour-changing — the tracer's
  overhead ate into the fps budget) and on nightly instead.
- Never raise a timeout to make a race pass. Wait on observable state.

**What is not flake, and must not be treated as one** (measured in Phase 84):

- **A dirty `docs/screenshots/` after `npm run screenshot`.** The suite writes its
  captures there, and ~64 of the committed PNGs differ from what this build
  renders. That is *staleness*, not nondeterminism: two consecutive full runs
  produced byte-identical files (md5 lists compared, zero differences), and
  `game.png` — the one the README and docs site actually embed — regenerates
  byte-for-byte. So a `git status` full of modified PNGs after a verify run is
  expected, is usually reverted, and is not evidence of a visual change. The
  useful consequence: because captures *are* byte-stable on one machine, a
  before/after comparison on that machine is a valid visual check. What the
  committed set should be is Phase 33's (visual regression baseline) decision, not
  a flake question.
- **An `@perf` fps floor failing while another suite is running.** The floors are
  measured on an otherwise-idle machine and `measureFpsSamples` already takes the
  best of three 2-second windows; a second Playwright suite on the same machine
  still beats it (33.4 fps against a floor of 45, reproduced once, then six
  isolated passes at the floor). Failures now print every window, because
  interference moves one window and a rendering regression moves all of them —
  which is the first question asked when one of these fails. Do not run two
  browser suites concurrently and then read the fps result.

A test that flakes is a defect report, not noise. In order: **diagnose** (run it
traced and un-retried; a race that only appears under tracing is still a race),
**fix**, and only if neither is possible today, **quarantine** — skipped with
`test.skip`, a comment naming the suspected cause, an owner and the condition
that puts it back. A quarantine with no removal condition is a deletion in
disguise; either is better than a retry loop that hides the bug. A permanently
failing test is never silently skipped.

## Adding tests

Answer these in order; each one is already decided above.

1. **Should it exist?** Re-read the [admission rule](#new-test-admission-rule).
   Strengthening an existing test beats adding one.
2. **Which level?** The cheapest one that fails when the behaviour breaks —
   [Choosing a level](#choosing-a-level).
3. **Which scenario?** Look in `tests/helpers/scenarios.ts` (and
   `tests/server/manager.ts` for rooms) before writing a state literal.
   **One case or every case?** If the claim is "for all deals/melds/actions",
   it is a property, not twenty copies of a unit test —
   [Property and fuzz testing](#property-and-fuzz-testing). If the claim is
   about how a whole match *ends*, check whether a
   [golden replay](#golden-replays) already carries it before recording a sixth.
4. **What may I fake?** Platform boundaries only — [Mocking policy](#mocking-policy).
5. **Does it need a browser?** Only if the risk *is* input, rendering, the
   service worker or two genuinely independent clients.
6. **Cross-browser too?** Only for pointer/touch, viewport, orientation or iOS
   lifecycle. One engine otherwise.
7. **Which gate runs it?** [Which gate runs when](#which-gate-runs-when).

Then name it for the failure it catches — *rejects a stale client revision*, not
*test submitTurn* — and assert the contract (`ok`, the reason code, the
conserved id set), not a snapshot of everything the call returned.

- Re-read the admission rule above first. Strengthening an existing test beats
  adding one.
- Rules or draft behaviour: a case in `tests/rules.test.ts` or
  `tests/draft.test.ts`. If it can be written as a pure function, it belongs in
  a unit test, not in Playwright.
- Anything that moves cards between hand, table and draw pile: assert through
  `expectCardConservation` from `tests/helpers/invariants.ts` instead of a new
  bespoke count.
- Layout or interaction maths: extract the decision into a pure module under
  `src/table` / `src/ui` (as `tap-destination.ts` was) and unit-test that —
  importing a Phaser scene in the node environment throws.
- Anything visual: add a `?showcase=` state in `src/demo/showcase.ts` and a
  capture in `e2e/screenshot.spec.ts`; the check script expects every declared
  screenshot to exist.
- Protocol or server behaviour: `tests/server/`, plus a flow in
  `e2e-multiplayer/` if two clients must observe each other. Prefer the server
  test — it is deterministic, it takes milliseconds, and it can drive a fake
  clock.
- Offline or update behaviour: `e2e-pwa/`, which is the only place the real
  service worker lifecycle runs.
