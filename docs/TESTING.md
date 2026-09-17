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

Six automated levels, cheapest first, plus manual. "Cost" is the order of
magnitude a developer waits for the whole category on this repo — see
[Runtime budgets](#runtime-budgets).

| Level | Cost | Owns | Does not own | Lives in |
|---|---|---|---|---|
| Pure / unit | ms | Rules, validators, layout maths, serialization, protocol helpers, settings/i18n, state invariants | Anything needing a socket, a scene, storage or a real clock | `tests/*.test.ts` |
| Application / integration | ms | Action orchestration (`LocalMatch`), online state adaptation (`OnlineSession`), lobby transitions (`LobbyMachine`), persistence and lifecycle coordination | Wire framing, rendering, engine behaviour | `tests/match`, `online-session`, `lobby`, `persistence`, `lifecycle`, `net/` |
| Simulation | seconds | Emergent behaviour over many seeded states — AI, full matches, lobby random walks | Single rule cases, which are cheaper as unit tests | `tests/probes`, `soak`, `server/lobby-soak` |
| Server integration | seconds | Room ownership, authoritative validation, revisions, reconnect, rematch, hidden information, the wire boundary | UI, engine parity | `tests/server/` |
| Browser E2E | minutes | Real input, Phaser interaction, scene transitions, the service worker, several real clients against the real server | Rule legality, or anything a pure function already proves | `e2e/`, `e2e-multiplayer/`, `e2e-pwa/` |
| Cross-browser / device | minutes | Behaviour that genuinely differs per engine or form factor: pointer/touch, viewport, orientation, iOS lifecycle | A second copy of a journey already proven on Chromium | `e2e-cross/`, the `firefox`/`webkit` multiplayer projects |
| Manual | — | Comprehension, feel, presentation, exploratory abuse | Anything a machine can assert | [PLAYTEST_GUIDE.md](PLAYTEST_GUIDE.md) |

Fuzz/property, mutation testing, large golden-replay suites and performance
trending are **not** categories here yet. They are named so that nobody invents
a seventh level by accident; when one arrives it gets a row, a gate and a
budget like every other.

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

- **Pixel-level visual regression.** The screenshot suite captures PNGs and
  fails on page/console errors and fps floors; there is no baseline image diff.
  Visual correctness is a human judgement made against those artifacts.
- **Game feel, pacing, clarity, perceived AI quality.** Playtest guide.
- **Raw synthetic pointer-drag drops** — verified through editor hooks instead
  (see the README's known limitations).
- **Every locale × viewport × text-scale combination.** Representative classes
  only; the geometry itself is unit-tested.

## Gaming QA risk matrix

| ID | Area | Primary risk | Strongest proving test | Level | Status |
|---|---|---|---|---|---|
| GQA-01 | Core rules | illegal state accepted | `tests/rules.test.ts` (runs, groups, jokers, `canConfirmTurn`) | unit | Covered |
| GQA-02 | Card integrity | card lost/duplicated | `tests/helpers/invariants.ts` → `expectCardConservation`, re-checked in `rules`, `probes` (every turn, 40 seeds), `server/rooms` | unit + simulation + server | Covered |
| GQA-03 | Turn flow | softlock / dead state | `tests/actions.test.ts` (the local action path: accepted, refused, after-finish, out-of-turn), `tests/probes.test.ts` (every seed terminates, turn rotation asserted each turn) | unit + simulation | Covered |
| GQA-04 | Mexe | draft/state corruption | `tests/draft.test.ts`, `tests/probes.test.ts` undo/reset abuse; `e2e/screenshot.spec.ts` mexe + editor journeys | unit + E2E | Covered |
| GQA-05 | End game | wrong winner/end state | `tests/rules.test.ts` win + draw-pile exhaustion; `e2e` `win-real-finish` | unit + E2E | Covered |
| GQA-06 | AI | illegal action / hang | `tests/ai.test.ts` (legality, budgets, determinism), `tests/probes.test.ts` (terminates, legal every turn) | unit + simulation | Covered |
| GQA-07 | Multiplayer sync | state divergence | `e2e-multiplayer/multiplayer.spec.ts` state-hash agreement; `tests/server/rooms.test.ts` | E2E + server | Covered |
| GQA-08 | Privacy | hidden hand leaked | `tests/server/index.integration.test.ts` (privacy in a real frame, log redaction), `e2e-multiplayer` hand-privacy probe | server + E2E | Covered |
| GQA-09 | Reconnect | state/identity corruption | `tests/server/reconnect.test.ts`, `tests/net/reconnect.test.ts`, `e2e-multiplayer/lobby.spec.ts` LB reload/second-tab | server + E2E | Covered |
| GQA-10 | Timer | race / softlock | `tests/server/timer.test.ts` — DONE vs deadline, duplicate tick, disconnect grace, post-finish clock, all on a fake clock | integration | Covered |
| GQA-11 | Duplicate input | action processed twice | `tests/server/rooms.test.ts` double submit, `queue.integration.test.ts` duplicate join, `public-rooms.test.ts` double leave; nightly traced multiplayer for the UI double-click class | server + E2E (nightly) | Covered |
| GQA-12 | Persistence | restored state differs | `tests/persistence.test.ts` (round-trip, corrupt saves, versioning), `tests/lifecycle.test.ts` | integration | Covered |
| GQA-13 | Compatibility | unusable on a target platform | `e2e-cross/` on 8 device/engine profiles; multiplayer lobby on Firefox + WebKit (nightly) | E2E | Covered |
| GQA-14 | PWA/offline | expected offline flow unavailable | `e2e-pwa/offline.spec.ts`, `update.spec.ts`, `tests/pwa.test.ts` | E2E + unit | Covered |
| GQA-15 | Player feedback | player cannot understand state | `tests/invalid-detail.test.ts`, `objective.test.ts`, `results-summary.test.ts`; `e2e` blocked-FEITO / reason-badge journeys. Comprehension itself is manual | unit + E2E + manual | Partial (by design) |
| GQA-16 | Full match | emergent integration failure | `tests/probes.test.ts` (40 seeded full matches), `tests/server/lobby-soak.test.ts` (10 seeds × 1200 steps), `e2e-multiplayer` real 2/3/4P matches | simulation + E2E | Covered |
| GQA-17 | Navigation | dead end / wrong return path | `e2e` `esc` (backs out one level at a time), `pause-draft` (draft survives pause → settings → rules → resume), `second-match` | E2E | Covered |
| GQA-18 | Settings | state/persistence incorrect | `tests/persistence.test.ts`, `settings-layout.test.ts`, `audio.test.ts`; `e2e` `ai-settings` persistence journey | unit + integration + E2E | Covered |
| GQA-19 | Localization | missing/mixed/raw UI copy | `tests/i18n.test.ts` — pt/en parity, every declared key non-empty and not a raw key, every `t()` literal in `src/` declared | unit | Covered |
| GQA-20 | Game setup | selected config not applied | `e2e` `setup: seat/personality picker` — asserts the dealt lineup is the 4 seats and 3 distinct opponents picked | E2E | Covered |
| GQA-21 | Accessibility | critical flow inaccessible | `tests/motion.test.ts`, `feel.test.ts`, `menu/settings-layout` geometry; `e2e` `a11y-reduced-motion`, `*-large-text`, `keyboard`, `mobile-badge-reason` (non-colour-only signalling) | unit + E2E | Covered |

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
```

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
| `npm run test` | every unit/application/simulation/server test with coverage | ~6s, ~960 tests |
| `npm run lint` | ESLint over six trees + `tsc --noEmit` | ~4s |
| `npm run screenshot` | build + the browser journey/perf suite | minutes |
| `npm run verify:multiplayer:chromium` | build + two-plus real clients | minutes |
| `npm run verify:multiplayer` | the same on three engines | ~18 min — nightly, not per PR |
| `npm run verify:cross` | build + 8 device/engine layout profiles | minutes |

The developer loop is the first two rows. Everything below them is a gate, not
a loop: do not re-run a browser suite after every edit, and do not make a commit
wait on engine parity.

## Unit tests — `npm run test`

Vitest with V8 coverage, node environment (no browser). Anything that imports
Phaser cannot run here, which is why layout, snapping, tap-destination and
helper logic live as pure modules under `src/table` and `src/ui`.

- `tests/rules.test.ts` — the rules engine: decks, deals, runs, groups, joker
  assignment, the one-joker-per-meld limit, ace low/high and the no-wrap case,
  `canConfirmTurn`, win and draw-pile-exhaustion, serialization.
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
  (a search that yields past the end of the match is dropped), and that a
  listener on a finished match never hears the next one.
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
  four difficulty tiers.
- `tests/tutorial.test.ts` — all 12 steps, the per-step allow-list, completion,
  and the **authority boundary**: the tutorial gate is pedagogical only, so it
  can refuse a legal action and can never let an illegal one past `src/rules`
  (ARCH-021).
- `tests/i18n.test.ts` — pt-BR/en-US key parity, every declared key resolving to
  non-empty copy that is not the raw key, and every `t('...')` string literal in
  `src/` being a declared key.
- `tests/net/room-settings.test.ts` — timer presets, custom-value clamping,
  `set_room_settings` on the wire, and that a ticking clock stays out of the
  state digest.
- `tests/layout.test.ts`, `snap.test.ts`, `zoom.test.ts`, `regions.test.ts`,
  `editor-layout.test.ts`, `menu-layout.test.ts`, `settings-layout.test.ts`,
  `viewport.test.ts`, `tap-destination.test.ts` — pure layout/interaction maths.
- `tests/persistence.test.ts`, `lifecycle.test.ts`, `error-recovery.test.ts`,
  `offline.test.ts`, `pwa.test.ts` — settings, sleep/resume, corrupt saves,
  connectivity, service-worker registration behaviour.
- `tests/playlog.test.ts`, `objective.test.ts`, `results-summary.test.ts`,
  `cosmetics.test.ts`, `audio.test.ts`, `music-playback.test.ts`,
  `helpers.test.ts`, `showcase.test.ts`, `motion.test.ts`, `feel.test.ts`,
  `intensity.test.ts`, `invalid-detail.test.ts`, `no-telemetry.test.ts`,
  `config.test.ts`, `viewToState.test.ts`, `net/errors.test.ts`.
- `tests/replay.test.ts` — deterministic reproduction: same seed + same actions
  → same state and digest, the two golden fixtures in
  `tests/fixtures/replays/`, and the refusals (future version, malformed JSON,
  unknown action type/actor/meld, illegal sequence, a card the seat cannot
  play, corrupt snapshot start, diverged final hash). Regenerate a fixture with
  `npm run replay record <seed> <out.json>` — it is committed output, so a
  rules change that moves a recorded match's outcome fails here first.
- `tests/boundaries.test.ts` — the architecture guard: the domain core's import
  allow-list, no platform/clock/unseeded randomness in `rules`, `mexe-mode`,
  `game-state` or `table`, Phaser confined to the presentation layer, and the
  server importing only the shared rules/protocol/rng, the extracted application
  modules (`match.ts`, `online-session.ts`, `lobby.ts`) reaching no scene, Phaser
  or DOM, legality functions being declared only in `src/rules`, product code not
  importing the verification adapters, plus the play log importing nothing outside
  `core` (bar the match-event type) and reading no browser API. See
  [ARCHITECTURE.md](ARCHITECTURE.md#enforcement-status).
- `tests/soak.test.ts` — long-running game loop, used as a perf/stability soak.

`npm run test:watch` for the watch loop.

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
| Cross-browser layout | `playwright.cross.config.ts` (`e2e-cross/`) | `npm run verify:cross` | Canvas fits, centres and keeps 16:9 on Chrome, Firefox, Safari, Pixel 7, iPhone 14 (both orientations) and iPad; rotation and mobile tap gameplay |
| Multiplayer | `playwright.multiplayer.config.ts` (`e2e-multiplayer/`) | `npm run verify:multiplayer` | Two-plus real clients against the real server: legal turns, illegal-proposal rejection, hand privacy, 3P/4P rotation, reconnect/resync. Three projects: `chromium` runs everything, `firefox` and `webkit` run the `LB-*` lobby state-machine suite, `webkit` also the iOS-viewport one |
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
| `npm run verify:multiplayer` | Build + the multiplayer suite on Chromium, Firefox and WebKit + `scripts/check-verify-multiplayer.mjs`: no client console errors, no server stderr, no accepted illegal proposal, hand privacy held, state hashes agree, and per-engine lobby evidence (rendered seat gaps, a three-match endurance run, the iOS orientation/rematch gate). |
| `npm run verify:multiplayer:chromium` | The same, Chromium only, with the gate told not to demand the Firefox/WebKit lobby evidence (`--engines=chromium`). This is the PR-path variant. |
| `npm run verify:cross` | Build + the cross-browser layout suite. |
| `npm run verify:pwa` | Build + the offline/update suite. |
| `npm run verify:preview` | Build + `scripts/check-preview.mjs`: `dist/` serves, every asset reference resolves, no credential-shaped strings in the bundle. |

### Which gate runs when

**PR gate** (`.github/workflows/ci.yml`, every push and PR): lint + unit tests +
build; `verify:multiplayer:chromium`; `verify:pwa`; the screenshot suite plus
`check-verify.mjs`; the cross-browser layout suite. Fast, deterministic,
high-signal — engine parity is deliberately *not* on this path.

**Nightly** (`.github/workflows/nightly.yml`, 04:00 UTC): the expensive and the
race-hunting work — WebKit touch flake detection (`--repeat-each=5`,
`--retries=0`), the screenshot suite traced and retry-free, the full
cross-browser matrix, repeated untraced fps sampling for drift, the multiplayer
suite on all three engines, and the multiplayer suite under tracing (tracing
slows frame processing enough to lose races a fast machine always wins — that is
how the double-click `create_room` duplicate was found).

**Release gate:** `verify`, `verify:preview`, `verify:multiplayer` and
`verify:pwa`, all green, with zero console errors and zero server stderr lines.
`verify:multiplayer` here means the three-engine form, not the Chromium PR
variant. This is a human gate run before tagging: `.github/workflows/release.yml`
itself only re-runs lint, unit tests and the build, checks the tag against
`package.json`, and then publishes the Release and the container images.

Not every useful QA check blocks every PR. Engine parity for the lobby, traced
race hunting and fps trend lines are a within-a-day guarantee, not a
per-review one.

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
— see "Which gate runs when" above for the job list.
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
