# MexeMexe — Remaining Roadmap

Repository: `https://github.com/mgummich/mexemexe-game`

## Purpose

This document defines the remaining MexeMexe roadmap from the current point forward.

It is the durable planning document for:

- remaining waves
- recommended sub-wave splits
- phase goals
- scope boundaries
- key risks
- dependencies
- phase exit criteria
- deferred work
- final execution order

It intentionally does **not** contain the full master execution prompt, builder/critic loop, repair-loop mechanics, or detailed agent orchestration instructions.

Those belong in the separate execution prompt.

---

# Roadmap Principles

The roadmap is an audit-and-improvement plan, not a rewrite mandate.

For every phase:

1. Inspect the current implementation first.
2. Preserve working behavior unless the phase explicitly changes it or fixes a verified defect.
3. Prefer the smallest coherent improvement.
4. Reuse existing architecture and infrastructure where healthy.
5. Avoid parallel authorities.
6. Avoid speculative abstractions.
7. Test at the cheapest reliable level.
8. Keep canonical documentation synchronized with implementation.
9. Defer unrelated work to the appropriate later phase.
10. `NO CHANGE REQUIRED` is a valid phase outcome when the repository already satisfies the phase goal.

The roadmap optimizes for:

- correctness
- deterministic behavior where required
- clear ownership
- maintainability
- player experience
- multiplayer safety
- efficient verification
- security/privacy
- performance
- release readiness

It does not optimize for:

- number of files changed
- number of tests
- global coverage percentage
- arbitrary abstraction
- roadmap completion speed

---

# Canonical Ownership Invariants

Unless deliberately revised in canonical architecture documentation, preserve these boundaries:

```text
rules
= gameplay legality authority

game/application state
= committed local match lifecycle/state ownership

server
= online match authority

client
= sends intents and renders authoritative views

AI
= chooses among legal player-appropriate possibilities

UI
= presentation + user intent

tutorial
= pedagogical restriction, never alternate gameplay legality

persistence
= storage/recovery, never gameplay authority

debug / verification
= observer or adapter, never product authority
```

Other important invariants:

- UI must not decide legality.
- Online clients must not receive hidden opponent information.
- Final committed actions should use normal application/rules paths.
- Deterministic systems must not depend on ambient wall-clock timing or unseeded randomness.
- Browser/platform dependencies should remain out of pure/domain layers.
- Test/debug surfaces should not become required production control paths.

---

# Risk and Deferral Policy

Use the following conceptual priority model:

```text
P0
correctness / authority / privacy / data loss / security

P1
major lifecycle / architecture / multiplayer / regression risk

P2
maintainability / scalability / testability / performance risk

P3
organization / naming / low-impact debt
```

General policy:

- Relevant P0 risks normally block phase completion.
- P1 risks block when they invalidate the assumptions of the next phase.
- P2/P3 risks may be explicitly deferred.
- Do not attempt to eliminate all technical debt.
- Do not lower a risk classification merely to advance the roadmap.
- A deferred risk should name the future phase that owns it.
- Before each wave transition, check whether an open risk would cause the next wave to build on the wrong boundary.

---

# Current Position

The roadmap assumes the earlier architecture, test, and UX waves have already established:

- core architecture boundaries
- deterministic gameplay foundations
- test architecture
- property/replay/mutation foundations
- Wave 5 UX/game-feel work
- Wave 5 UI/app-shell system work
- Wave 5 tutorial/accessibility/localization work
- Wave 6A AI foundation

Current forward execution starts at:

```text
Wave 6B — Planning, Difficulty & Personality
```

Wave 4 remains intentionally deferred until later, before final release readiness.

---

# Remaining Execution Order

```text
Wave 6B — Planning, Difficulty & Personality
    ↓
Wave 6C — Human-Like, Adaptive & Explainable AI
    ↓
Wave 6D — AI Performance, Simulation & Balance
    ↓
Wave 6E — AI Tooling & Regression Hardening
    ↓
Wave 7 — Multiplayer Hardening
    ↓
Wave 8 — Resilience, Recovery & Product Feedback
    ↓
Wave 9 — Performance, Security & Operations
    ↓
Wave 10 — QA / CI Optimization
    ↓
Wave 11 — Simplification & Maintainability
    ↓
Wave 4 — Deferred Visual / PixelLab / Asset System
    ↓
Wave 12 — Final Release Readiness
```

---

# Wave 6 — AI Upgrade

## Wave 6B — Planning, Difficulty & Personality

### Phase 46 — Strategic Planning

**Goal**

Improve AI decision depth beyond immediate one-step evaluation while preserving legality, determinism, and bounded work.

**Why now**

Wave 6A established the AI observation, legality, and evaluation foundation. Planning should build on that stable base rather than redefining legality or state ownership.

**In scope**

- bounded lookahead/search
- future-state evaluation
- candidate sequencing
- deterministic planning budget
- tactical planning around Mexe/rearrangement
- stable fallback when planning budget ends

**Out of scope**

- adaptive player modeling
- human-like mistakes
- final personality system
- simulation/balance infrastructure
- player-facing explanation

**Key risks**

- search becoming wall-clock dependent
- duplicated legality inside planner
- explosive candidate growth
- mutation of authoritative state
- AI becoming too slow on lower-end devices

**Depends on**

- Phase 43 AI interface architecture
- Phase 44 legal-move foundation
- Phase 45 evaluation model

**Feeds into**

- Phase 47 difficulty
- Phase 48 personalities
- Phase 52 AI performance budgets

**Exit criteria**

- planning remains deterministic for fixed state/config/seed/budget
- all executed actions remain rule-valid
- planner uses bounded work
- no authoritative state mutation occurs
- fallback is legal
- planning quality is measurably better in representative scenarios without unacceptable runtime cost

---

### Phase 47 — Difficulty Model

**Goal**

Create clear difficulty levels through decision quality, planning depth, budgets, and deliberate simplification.

**Why now**

Difficulty should modify a stable AI decision system rather than creating separate engines.

**In scope**

- difficulty configuration
- search/planning budget differences
- evaluation simplification where justified
- optional deterministic mistake rate
- consistent difficulty naming/behavior
- difficulty-specific acceptance scenarios

**Out of scope**

- adaptive difficulty
- personality
- hidden-information cheating
- random illegal moves
- UI redesign

**Key risks**

- difficulty implemented through arbitrary randomness
- easy AI behaving nonsensically
- hard AI becoming slow instead of smarter
- duplicated difficulty-specific code paths
- difficulty accidentally changing legality

**Depends on**

- Phase 46 strategic planning
- base evaluator from Phase 45

**Feeds into**

- Phase 48 personality
- Phase 50 adaptive AI
- Phase 54 balance metrics

**Exit criteria**

- difficulty changes decision quality, not legality
- difficulty remains deterministic under fixed inputs
- levels are behaviorally distinguishable
- easy/medium/hard/expert remain maintainable through configuration rather than separate engines
- performance remains bounded

---

### Phase 48 — Personality Framework

**Goal**

Create reusable AI personalities that alter strategic preferences without duplicating the AI engine.

**Why now**

Personality should sit on top of stable planning/difficulty foundations.

**In scope**

- personality configuration
- evaluation weight modifiers
- preference profiles
- controlled tie-breaking tendencies
- personality metadata
- shared personality contracts

**Out of scope**

- adaptive player modeling
- emotional UI behavior
- per-opponent bespoke engines
- illegal or hidden-information behavior

**Key risks**

- personality mixed into base legality
- personalities becoming cosmetic-only
- personalities becoming separate AI implementations
- conflicting personality and difficulty configuration

**Depends on**

- Phases 45–47

**Feeds into**

- Phase 49 human-like behavior
- Phase 54 balance metrics
- Phase 55 AI content tooling

**Exit criteria**

- multiple personalities produce meaningfully different legal play
- personality is configuration over shared AI foundations
- personality and difficulty are independent dimensions where intended
- no personality duplicates core planning/legality code

---

## Wave 6C — Human-Like, Adaptive & Explainable AI

### Phase 49 — Human-Like Behavior

**Goal**

Make AI behavior feel less mechanical while keeping legality, determinism, and strategic coherence.

**Why now**

Human-like behavior should modify an already competent AI rather than compensate for weak foundations.

**In scope**

- bounded deterministic imperfections
- believable preference variation
- non-optimal but plausible choices
- move cadence presentation where UI-owned
- repeated-pattern avoidance
- controlled risk behavior

**Out of scope**

- deliberate illegal moves
- hidden information
- adaptive player modeling
- wall-clock decision authority

**Key risks**

- “human-like” becoming random
- easy mistakes undermining personality
- non-deterministic behavior
- UI timing leaking into decision logic

**Depends on**

- Phases 47–48

**Feeds into**

- Phase 50 adaptation
- Phase 54 balance metrics

**Exit criteria**

- behavior variation is deliberate and reproducible
- AI remains legal
- personality remains visible
- mistakes are bounded and plausible
- decision determinism is preserved

---

### Phase 50 — Adaptive AI

**Goal**

Allow optional bounded adaptation to observable player behavior without cheating or destabilizing difficulty.

**Why now**

Adaptation should build on stable difficulty/personality dimensions.

**In scope**

- player-observable pattern tracking
- bounded policy adjustment
- configurable adaptation limits
- reset/lifecycle semantics
- deterministic adaptation state where applicable

**Out of scope**

- hidden opponent information
- opaque permanent profiling
- cross-account telemetry dependence
- uncontrolled dynamic difficulty

**Key risks**

- hidden-information leakage
- runaway difficulty
- adaptation persisting unexpectedly
- opaque state affecting reproducibility
- privacy concerns

**Depends on**

- Phases 47–49

**Feeds into**

- Phase 51 explainability
- Phase 54 balance
- Phase 72 privacy review

**Exit criteria**

- adaptation uses only legitimate observations
- adaptation remains bounded
- reset/persistence semantics are explicit
- behavior is reproducible where required
- privacy implications are documented

---

### Phase 51 — AI Explainability

**Goal**

Expose structured AI decision metadata useful for debugging, balancing, and optional player-facing explanation.

**Why now**

Explainability is most useful once planning, difficulty, personality, and adaptation exist.

**In scope**

- decision feature summaries
- chosen-vs-alternative reason metadata
- debug traces
- compact explainability schema
- optional UI-ready explanation data

**Out of scope**

- verbose chain-of-thought style internal reasoning
- player-facing redesign
- exposing hidden information
- logging sensitive full states

**Key risks**

- explainability coupled tightly to implementation internals
- leaking hidden information
- large debug payloads
- explainability affecting decision behavior

**Depends on**

- Phases 45–50

**Feeds into**

- Phase 53 simulation harness
- Phase 54 balance metrics
- Phase 55 AI tooling

**Exit criteria**

- explanations are structured and stable enough for debugging
- no private/hidden state is exposed
- explainability is observational, not decision authority
- normal production behavior does not depend on debug output

---

## Wave 6D — AI Performance, Simulation & Balance

### Phase 52 — AI Performance Budgets

**Goal**

Define measurable deterministic AI work budgets and runtime safety limits.

**Why now**

Planning and personalities must be constrained before large-scale simulation/balance work.

**In scope**

- node/candidate/iteration/depth budgets
- per-difficulty budget policy
- emergency runtime guard where necessary
- device-sensitive safety constraints where appropriate
- AI profiling hooks

**Out of scope**

- broad application performance
- simulation metrics
- major strategy redesign

**Key risks**

- hard difficulty relying on slow execution
- wall-clock cutoffs affecting move choice
- inconsistent behavior across devices

**Depends on**

- Phases 46–51

**Feeds into**

- Phase 53 simulation
- Phase 54 balance
- Phase 75 global performance budgets

**Exit criteria**

- deterministic work budgets are explicit
- normal decisions do not depend on CPU speed
- emergency time guards cannot silently redefine ordinary choice
- representative devices remain within acceptable runtime

---

### Phase 53 — AI Simulation Harness

**Goal**

Create efficient deterministic AI-vs-AI simulation using production rules/actions.

**Why now**

Balance and robustness need large-scale reproducible data.

**In scope**

- headless/fast match simulation
- seed control
- matchup configuration
- replay/reproduction metadata
- batch execution
- result summaries

**Out of scope**

- production telemetry
- visual rendering
- synthetic alternate rules

**Key risks**

- simulation using different rules from production
- unreproducible failures
- excessive runtime
- hidden shortcuts that invalidate results

**Depends on**

- Phases 43–52

**Feeds into**

- Phase 54 balance
- Phase 56 regression
- Phase 74 playtesting

**Exit criteria**

- simulation uses production rules/application contracts
- every failure can be reproduced from seed/config
- harness is fast enough for practical batch use
- simulation results are machine-readable

---

### Phase 54 — AI Balance Metrics

**Goal**

Measure AI quality and differentiation without optimizing toward a single misleading score.

**Why now**

Simulation infrastructure enables evidence-based balance decisions.

**In scope**

- win rates
- game length
- draw rates
- move quality proxies
- difficulty separation
- personality differentiation
- matchup matrices
- confidence/variance reporting

**Out of scope**

- automatic self-balancing
- leaderboard product features
- player analytics

**Key risks**

- overfitting to AI-vs-AI
- using win rate as the only metric
- too-small sample sizes
- personalities converging

**Depends on**

- Phase 53

**Feeds into**

- Phase 56 regression
- future tuning/content work

**Exit criteria**

- metrics reveal meaningful difficulty/personality differences
- sample methodology is explicit
- metrics are reproducible
- no single metric is treated as universal quality truth

---

## Wave 6E — AI Tooling & Regression Hardening

### Phase 55 — AI Content Tooling

**Goal**

Make AI scenarios, personalities, configurations, and simulations easier to inspect and maintain.

**Why now**

The AI system is now large enough to need developer tooling.

**In scope**

- scenario inspection
- personality configuration helpers
- simulation presets
- reproducible debug commands
- result comparison
- lightweight developer-facing tools

**Out of scope**

- production player UI
- general-purpose editor framework
- analytics platform

**Key risks**

- tooling becoming production dependency
- configuration split across multiple authorities
- overbuilding

**Depends on**

- Phases 48–54

**Feeds into**

- Phase 56 robustness
- Phase 96 developer experience

**Exit criteria**

- common AI investigation workflows are straightforward
- tools are reproducible
- production code does not depend on debug tooling
- configuration remains canonical

---

### Phase 56 — AI Regression & Robustness

**Goal**

Protect AI correctness, determinism, and quality against future regressions.

**Why now**

AI foundations, planning, personality, simulation, and metrics are all available.

**In scope**

- canonical AI regression scenarios
- pathological states
- deterministic replay cases
- simulation-based regression thresholds
- property tests
- selective mutation
- crash/timeout protection

**Out of scope**

- broad QA redesign
- multiplayer soak
- product telemetry

**Key risks**

- overlarge slow AI test suite
- brittle exact-score assertions
- missed pathological arrangements
- regression thresholds that block harmless changes

**Depends on**

- Phases 43–55

**Feeds into**

- Wave 7 onward
- Wave 10 QA optimization

**Exit criteria**

- critical AI contracts are protected
- known pathological scenarios are reproducible
- test suite remains efficient
- meaningful strategy regressions are detectable without freezing implementation details

---

# Wave 7 — Multiplayer Hardening

Recommended split:

```text
7A Contracts & Authority
7B Lobby / Reconnect / Rematch
7C Multi-Client & Ordering
7D Chaos / Soak / Cross-Browser
```

---

## Wave 7A — Contracts & Authority

### Phase 57 — Multiplayer Contract Audit

**Goal**

Establish a precise picture of protocol, authority, privacy, revision, validation, and compatibility contracts.

**Why now**

Later multiplayer hardening should not test or optimize an ambiguous contract.

**In scope**

- protocol messages
- validation
- authority
- revisions
- hidden-state redaction
- error codes
- compatibility assumptions
- reconnect/session identity contracts

**Out of scope**

- major feature additions
- lobby redesign
- soak testing

**Key risks**

- client/server contract drift
- hidden information leakage
- ambiguous revision semantics
- user-facing prose embedded in protocol

**Depends on**

- existing architecture/rules
- prior multiplayer work

**Feeds into**

- all Wave 7 phases
- Phase 70 compatibility policy

**Exit criteria**

- contracts are explicit
- hidden information boundaries are verified
- protocol ownership is clear
- high-risk ambiguities are resolved before continuing

---

### Phase 58 — Authoritative Multiplayer State Flow

**Goal**

Ensure all online gameplay follows one coherent authoritative server-to-client state path.

**Why now**

Reconnect/race/rematch work depends on one state authority model.

**In scope**

- intent handling
- server validation
- authoritative transitions
- redacted views
- revisions
- client projection
- resync behavior

**Out of scope**

- lobby UX
- network chaos
- browser matrix

**Key risks**

- duplicate client-side authority
- stale view projection
- impossible projected states
- silent resync corruption

**Depends on**

- Phase 57

**Feeds into**

- Phases 59–67

**Exit criteria**

- server remains sole online gameplay authority
- client cannot create authoritative state
- malformed/stale authoritative views fail explicitly
- projection/resync behavior is testable outside presentation

---

## Wave 7B — Lobby / Reconnect / Rematch

### Phase 59 — Lobby State Machine

**Goal**

Make lobby lifecycle explicit, valid, and testable.

**Why now**

Lobby complexity is a frequent multiplayer failure source.

**In scope**

- lobby states
- transitions
- readiness
- join/leave
- room state
- error transitions
- pending states

**Out of scope**

- match gameplay protocol
- network chaos
- final lobby visual polish

**Key risks**

- invalid boolean combinations
- stale pending state
- leaked listeners
- transitions buried in scenes

**Depends on**

- Phases 57–58

**Feeds into**

- reconnect/rematch
- cross-browser multiplayer QA

**Exit criteria**

- lobby transitions are explicit
- impossible states are prevented
- repeated entry/exit works
- lifecycle cleanup is reliable

---

### Phase 60 — Disconnect & Reconnect

**Goal**

Make temporary connection loss recover safely and predictably.

**Why now**

Reconnect semantics must be correct before soak/chaos testing.

**In scope**

- grace periods
- seat ownership
- reconnect tokens
- resync
- expiry
- repeated reconnect
- stale connection replacement

**Out of scope**

- persistent account identity
- advanced matchmaking

**Key risks**

- seat hijacking
- stale state restoration
- token leakage
- duplicate live connections
- reconnect race conditions

**Depends on**

- Phases 57–59

**Feeds into**

- Phases 62–67

**Exit criteria**

- seat ownership is protected
- reconnect restores authoritative state
- expired/stale reconnect fails safely
- repeated reconnect is tested
- hidden/private state remains protected

---

### Phase 61 — Rematch Lifecycle

**Goal**

Guarantee a fresh match after completion without stale match state.

**Why now**

Rematch is a lifecycle stress point and should be stable before soak.

**In scope**

- new match identity
- revision reset
- winner reset
- timers
- player readiness
- seed/reset semantics
- subscriptions
- reconnect interaction

**Out of scope**

- new tournament modes
- visual result redesign

**Key risks**

- stale winner/state
- duplicate listeners
- stale revisions
- old reconnect tokens affecting new match

**Depends on**

- Phases 58–60

**Feeds into**

- multi-client/soak testing

**Exit criteria**

- repeated rematches behave as fresh matches
- no stale match data leaks
- lifecycle cleanup is deterministic
- reconnect/rematch interaction is covered

---

## Wave 7C — Multi-Client & Ordering

### Phase 62 — Race / Duplicate / Ordering Protection

**Goal**

Protect online gameplay against realistic concurrency and message-order problems.

**Why now**

The state flow and lifecycle are stable enough to stress ordering semantics.

**In scope**

- duplicate intents
- stale revisions
- reordering
- retries
- reentrancy
- concurrent actions
- idempotence where needed

**Out of scope**

- arbitrary hostile DDoS mitigation
- full chaos testing

**Key risks**

- duplicate actions
- stale state overwrite
- race-triggered divergence
- non-idempotent retries

**Depends on**

- Phases 58–61

**Feeds into**

- multi-client harness
- chaos/soak

**Exit criteria**

- stale/duplicate actions are handled deliberately
- authoritative state cannot diverge from race conditions
- failure behavior is explicit
- focused race regressions exist

---

### Phase 63 — Multi-Client Harness

**Goal**

Test multiplayer using genuinely independent clients/sessions.

**Why now**

Many multiplayer defects cannot be proven with one client or mocked view.

**In scope**

- independent clients/processes
- deterministic room setup
- synchronized actions
- reconnect
- rematch
- multi-seat observation

**Out of scope**

- full device farm
- performance benchmarking

**Key risks**

- tests accidentally sharing client state
- flaky orchestration
- excessive runtime

**Depends on**

- Phases 57–62

**Feeds into**

- Phases 64–67

**Exit criteria**

- harness uses independent stateful clients
- key multi-client scenarios are reproducible
- orchestration is stable enough for CI/manual use
- failures identify client/seat/revision context

---

### Phase 64 — Multiplayer Scenario Matrix

**Goal**

Define a compact risk-based multiplayer behavior matrix.

**Why now**

The harness makes representative scenario coverage practical.

**In scope**

- 2/3/4 player representative flows
- create/join/leave
- ready/start
- normal play
- disconnect/reconnect
- rematch
- stale/duplicate/error paths

**Out of scope**

- exhaustive combinatorial testing
- every scenario on every browser

**Key risks**

- matrix explosion
- redundant E2E coverage
- missing high-risk lifecycle paths

**Depends on**

- Phase 63

**Feeds into**

- chaos/soak/cross-browser

**Exit criteria**

- high-risk multiplayer behaviors are mapped to appropriate test levels
- matrix remains compact
- no important lifecycle path is unowned

---

## Wave 7D — Chaos / Soak / Cross-Browser

### Phase 65 — Network Chaos Testing

**Goal**

Verify multiplayer behavior under adverse but realistic network conditions.

**Why now**

Normal lifecycle/race correctness is established.

**In scope**

- delay
- disconnect
- retry
- stale messages
- duplicate messages
- selected reordering/drop behavior where infrastructure permits

**Out of scope**

- internet-scale load testing
- security penetration testing

**Key risks**

- unrealistic chaos model
- non-reproducible failures
- too-slow CI

**Depends on**

- Phases 62–64

**Feeds into**

- soak/final multiplayer QA

**Exit criteria**

- selected adverse conditions are reproducible
- authoritative state remains consistent
- recovery behavior is explicit
- failures capture enough evidence for diagnosis

---

### Phase 66 — Multiplayer Soak Testing

**Goal**

Detect long-session lifecycle drift, leaks, and repeated-cycle defects.

**Why now**

Short tests cannot reveal cumulative room/rematch/reconnect failures.

**In scope**

- repeated matches
- repeated rematches
- reconnect cycles
- room create/destroy
- long-running clients
- memory/resource observations

**Out of scope**

- global performance profiling
- massive-scale concurrency

**Key risks**

- soak that only consumes time without useful assertions
- nondeterministic failures with poor diagnostics

**Depends on**

- Phases 63–65

**Feeds into**

- Phase 67
- Phase 100 final multiplayer QA

**Exit criteria**

- repeated lifecycle remains stable
- no meaningful resource/state drift appears
- soak failures are diagnosable
- run frequency is appropriate for cost

---

### Phase 67 — Cross-Browser & Device Validation

**Goal**

Validate the highest-risk multiplayer flows on primary browser/device targets.

**Why now**

The multiplayer behavior model is mature enough for platform validation.

**In scope**

- Chrome
- Firefox
- Safari/iOS
- touch/input
- WebSocket lifecycle
- background/foreground behavior
- selected lobby/reconnect/rematch flows

**Out of scope**

- every scenario on every browser
- final visual QA

**Key risks**

- duplicating the entire suite
- missing Safari/iOS lifecycle behavior
- platform-specific DOM/input issues

**Depends on**

- Phases 59–66

**Feeds into**

- Wave 8 resilience
- final multiplayer QA

**Exit criteria**

- selected critical flows pass on target browsers/devices
- platform-specific issues are resolved or explicitly deferred
- cross-browser suite remains risk-based

---

# Wave 8 — Resilience, Recovery & Product Feedback

Recommended split:

```text
8A Recovery & Compatibility
8B Production Diagnostics & Privacy
8C Playtesting & Product Feedback
```

---

## Wave 8A — Recovery & Compatibility

### Phase 68 — Persistence & Session Recovery

**Goal**

Harden restoration after reload, crash, backgrounding, or interrupted local sessions.

**Why now**

Core/multiplayer lifecycle behavior is mature enough to define recovery correctly.

**In scope**

- persisted settings/state
- local-session restoration where supported
- corruption handling
- recovery UX
- online reconnection handoff

**Out of scope**

- server-authority replacement
- cloud account sync unless already present

**Key risks**

- stale saved state
- persistence becoming gameplay authority
- corrupted data crashes
- online state restored locally instead of resynced

**Depends on**

- earlier persistence architecture
- Wave 7 multiplayer lifecycle

**Feeds into**

- offline resilience
- compatibility policy

**Exit criteria**

- supported recovery paths are explicit
- corruption fails safely
- online sessions resync from server
- recovery does not create second state authority

---

### Phase 69 — Offline-First Resilience

**Goal**

Make supported offline/PWA behavior predictable and robust.

**Why now**

Recovery contracts clarify what can and cannot function offline.

**In scope**

- offline app shell
- cached assets
- local play where supported
- graceful online-feature failure
- reconnect transitions
- update/cache lifecycle

**Out of scope**

- pretending online multiplayer works offline
- complex sync engine

**Key risks**

- stale app shell
- broken service-worker state
- misleading offline UI
- incompatible cached assets

**Depends on**

- Phase 68
- existing PWA infrastructure

**Feeds into**

- Phase 70
- release operations

**Exit criteria**

- offline-supported features work predictably
- unsupported online actions fail clearly
- recovery after network restoration works
- cache/update behavior is documented

---

### Phase 70 — Save & Protocol Compatibility Policy

**Goal**

Define explicit compatibility/version policy across persisted data, replays, and multiplayer protocol.

**Why now**

Persistence and multiplayer contracts now have enough stability to formalize compatibility.

**In scope**

- version fields
- forward/backward compatibility expectations
- migration/failure behavior
- replay compatibility
- protocol compatibility
- rollout implications

**Out of scope**

- indefinite support for every historical format
- complex migration platform

**Key risks**

- silent corruption
- incompatible clients
- old replay misinterpretation
- uncontrolled migration complexity

**Depends on**

- Phases 57, 68, 69

**Feeds into**

- release channels
- rollback strategy
- final release readiness

**Exit criteria**

- supported compatibility guarantees are explicit
- unsupported versions fail clearly
- migration policy is bounded
- rollback/release implications are documented

---

## Wave 8B — Production Diagnostics & Privacy

### Phase 71 — Production Error Reporting

**Goal**

Make production failures actionable without exposing sensitive data.

**Why now**

Stable architecture and lifecycle make error context meaningful.

**In scope**

- error boundaries/reporting
- reason codes
- build/version metadata
- reproducibility context
- privacy-safe logs
- rate limiting/dedup where needed

**Out of scope**

- broad product analytics
- secret/full-state uploads

**Key risks**

- sensitive data leakage
- noisy reports
- reports without reproduction context
- product dependency on reporting backend

**Depends on**

- observability foundations
- multiplayer lifecycle contracts

**Feeds into**

- privacy review
- release operations

**Exit criteria**

- critical production failures are diagnosable
- reporting excludes sensitive/private state
- failures do not depend on reporting availability
- logging volume is controlled

---

### Phase 72 — Privacy & Data Model Review

**Goal**

Audit what the product stores, transmits, logs, caches, and exposes.

**Why now**

Diagnostics, multiplayer, persistence, and optional adaptation now define the real data model.

**In scope**

- local storage
- reconnect/session data
- logs
- hidden hands
- telemetry candidates
- debug APIs
- network payloads
- AI adaptation state

**Out of scope**

- legal/compliance certification
- unrelated corporate policy

**Key risks**

- hidden-state leakage
- token exposure
- unnecessary retention
- debug surfaces exposing private data

**Depends on**

- Phases 50, 57–71

**Feeds into**

- optional telemetry
- security threat model
- final privacy checks

**Exit criteria**

- sensitive data is identified
- unnecessary storage/logging is removed
- hidden gameplay information remains protected
- privacy-sensitive features have explicit purpose

---

### Phase 73 — Optional Product Telemetry

**Goal**

Add only minimal telemetry that has a clear product/quality purpose, if justified.

**Why now**

Privacy review should happen before instrumentation.

**In scope**

- narrowly scoped quality/product metrics
- opt-in/consent behavior if required by product policy
- privacy-safe event schema
- sampling where appropriate

**Out of scope**

- surveillance-style analytics
- large analytics platform
- telemetry as gameplay authority

**Key risks**

- unnecessary data collection
- privacy scope creep
- metrics without decisions attached

**Depends on**

- Phase 72

**Feeds into**

- Phase 74 playtesting
- release observability

**Exit criteria**

- every collected event has a clear purpose
- no unnecessary sensitive data is collected
- telemetry can be disabled/absent without breaking product behavior
- `NO CHANGE REQUIRED` is valid if telemetry is not justified

---

## Wave 8C — Playtesting & Product Feedback

### Phase 74 — Structured Playtest Program

**Goal**

Create a repeatable path from real playtesting to actionable product changes.

**Why now**

The product is robust enough for feedback to focus on experience rather than obvious technical instability.

**In scope**

- playtest scenarios
- observation templates
- issue classification
- severity
- reproduction
- feedback reconciliation
- AI/multiplayer/UX coverage

**Out of scope**

- formal market research platform
- replacing automated QA

**Key risks**

- anecdotal feedback driving random changes
- duplicate findings
- unstructured notes
- no link from observation to decision

**Depends on**

- Waves 5–8B

**Feeds into**

- Wave 9 performance priorities
- Wave 11 simplification
- final release QA

**Exit criteria**

- playtests are repeatable
- findings are classified
- technical defects are reproducible
- product feedback can be accepted/deferred/rejected with rationale

---

# Wave 9 — Performance, Security & Operations

Recommended split:

```text
9A Performance
9B Security
9C Release Operations
```

---

## Wave 9A — Performance

### Phase 75 — Performance Budgets

**Goal**

Define defensible product performance budgets.

**Why now**

Feature behavior is mature enough to establish meaningful targets.

**In scope**

- boot
- interaction latency
- rendering
- AI
- network
- memory
- assets
- bundle size

**Out of scope**

- optimization before measurement

**Key risks**

- arbitrary targets
- platform-insensitive budgets
- optimizing irrelevant metrics

**Depends on**

- Waves 5–8
- Phase 52 AI budgets

**Feeds into**

- profiling
- final performance gate

**Exit criteria**

- budgets are measurable and justified
- target environments are explicit
- budgets map to user-visible/product risk

---

### Phase 76 — Performance Profiling

**Goal**

Measure real bottlenecks before optimizing.

**Why now**

Budgets provide thresholds and priorities.

**In scope**

- startup
- frame/runtime hotspots
- AI
- DOM/Phaser interaction
- networking
- assets
- browser profiles

**Out of scope**

- speculative micro-optimization

**Key risks**

- profiling unrepresentative scenes
- optimizing benchmark-only code
- missing lower-end devices

**Depends on**

- Phase 75

**Feeds into**

- Phases 77–78
- final performance work

**Exit criteria**

- bottlenecks are evidence-backed
- optimization priorities are ranked
- no optimization is justified solely by intuition

---

### Phase 77 — Memory Leak Testing

**Goal**

Detect long-session resource leaks.

**Why now**

Soak/lifecycle infrastructure and profiling now exist.

**In scope**

- Phaser scenes
- DOM nodes
- event listeners
- timers
- sockets
- audio
- cached state
- repeated match/rematch cycles

**Out of scope**

- unrelated architecture rewrites

**Key risks**

- false positives from GC timing
- tests too short to reveal drift
- leaks without ownership attribution

**Depends on**

- Phase 76
- Phase 66 soak work

**Feeds into**

- final performance gate

**Exit criteria**

- critical repeated flows do not show meaningful unbounded growth
- known retained resources have owners
- regressions are reproducible

---

### Phase 78 — Dependency & Bundle Governance

**Goal**

Keep dependency and bundle cost intentional.

**Why now**

Feature development is largely mature.

**In scope**

- dependency inventory
- duplicates
- abandoned packages
- bundle contribution
- supply-chain risk
- unnecessary runtime dependencies

**Out of scope**

- replacing healthy dependencies for aesthetic preference

**Key risks**

- churn from gratuitous rewrites
- dependency removal breaking hidden behavior
- bundle analysis without user impact

**Depends on**

- Phase 76 profiling

**Feeds into**

- security hardening
- release readiness

**Exit criteria**

- dependencies have clear purpose
- obvious waste/duplicates are removed
- bundle cost is understood
- unnecessary high-risk dependencies are addressed

---

## Wave 9B — Security

### Phase 79 — Security Threat Model

**Goal**

Model realistic threats and trust boundaries for MexeMexe.

**Why now**

Architecture, multiplayer, persistence, diagnostics, and deployment behavior are stable enough to model accurately.

**In scope**

- client/server trust
- protocol
- reconnect/session tokens
- persistence
- logs
- debug surfaces
- dependencies
- deployment
- abuse scenarios

**Out of scope**

- generic checklist without project relevance

**Key risks**

- missing server-authority attacks
- token leakage
- input validation gaps
- supply-chain risk
- debug exposure

**Depends on**

- Phases 57–78

**Feeds into**

- Phase 80 hardening

**Exit criteria**

- assets/trust boundaries/threats are explicit
- threats are prioritized
- mitigations map to concrete code/ops owners

---

### Phase 80 — Security Hardening

**Goal**

Resolve validated high-value security risks.

**Why now**

Threat model provides evidence and priorities.

**In scope**

- input validation
- server authority
- session/reconnect safety
- deployment headers/config
- dependency risks
- storage/logging exposure
- debug hardening

**Out of scope**

- security theater
- unrelated rewrites
- controls without identified threat

**Key risks**

- fixes harming multiplayer compatibility
- overengineering
- client-only mitigations for server threats

**Depends on**

- Phase 79

**Feeds into**

- release operations
- final release QA

**Exit criteria**

- P0/P1 validated threats are addressed or explicitly blocked
- controls are tested
- no security fix introduces duplicate authority
- remaining risks are documented

---

## Wave 9C — Release Operations

### Phase 81 — Rollback Strategy

**Goal**

Define safe recovery from a bad production release.

**Why now**

Compatibility and deployment/security assumptions are known.

**In scope**

- version rollback
- protocol compatibility
- cached/PWA client concerns
- data compatibility
- operational steps
- validation after rollback

**Out of scope**

- enterprise deployment platform

**Key risks**

- rollback to incompatible protocol/save format
- stale service-worker assets
- undocumented manual recovery

**Depends on**

- Phase 70
- Phase 80

**Feeds into**

- release channels
- final production readiness

**Exit criteria**

- rollback path is documented and testable
- compatibility constraints are known
- unsafe rollback conditions are explicit

---

### Phase 82 — Release Channels

**Goal**

Define a controlled path from development to production.

**Why now**

Rollback and compatibility behavior are known.

**In scope**

- development/staging/production or equivalent
- build promotion
- environment configuration
- release validation
- versioning

**Out of scope**

- unnecessary enterprise infrastructure

**Key risks**

- environment drift
- secrets/config mixing
- untested production-only behavior

**Depends on**

- Phase 81

**Feeds into**

- Wave 10 CI
- final release readiness

**Exit criteria**

- release flow is explicit
- environment differences are controlled
- promotion has defined quality gates
- production configuration is reproducible

---

# Wave 10 — QA / CI Optimization

Recommended split:

```text
10A Test Suite Efficiency
10B Risk-Based CI
10C Architecture / Docs / Repository Health
```

---

## Wave 10A — Test Suite Efficiency

### Phase 83 — Regression Suite Optimization

**Goal**

Reduce redundant coverage while preserving defect detection.

**Why now**

The product has accumulated enough mature tests to optimize intelligently.

**In scope**

- duplicate tests
- wrong-level tests
- expensive E2E cases
- slow fixtures
- redundant scenario matrices

**Out of scope**

- deleting tests for speed without evidence

**Key risks**

- removing unique protection
- optimizing around runtime only
- losing regression intent

**Depends on**

- Waves 3–9

**Feeds into**

- flaky-test control
- risk-based CI

**Exit criteria**

- each important contract has an appropriate owning test level
- redundant expensive coverage is reduced
- critical behavior remains protected

---

### Phase 84 — Flaky-Test Control

**Goal**

Identify and eliminate unreliable verification.

**Why now**

Risk-based CI requires trustworthy signals.

**In scope**

- flaky browser tests
- timing assumptions
- shared-state pollution
- nondeterminism
- retry policy
- temporary quarantine rules

**Out of scope**

- hiding failures behind unlimited retries

**Key risks**

- normalization of flaky tests
- false CI confidence
- random timing patches

**Depends on**

- Phase 83

**Feeds into**

- Phases 85–87

**Exit criteria**

- known flaky tests have root-cause handling
- retries are bounded/justified
- deterministic failures are reproducible
- flaky signal rate is materially reduced

---

### Phase 85 — Risk-Based Quality Gates

**Goal**

Map change types to appropriate required verification.

**Why now**

Test levels and reliability are understood.

**In scope**

- gate taxonomy
- change/risk mapping
- mandatory vs specialized suites
- release gates

**Out of scope**

- implementation of full change-scope automation

**Key risks**

- under-testing risky changes
- over-running expensive suites
- ambiguous ownership

**Depends on**

- Phases 83–84

**Feeds into**

- Phases 86–87

**Exit criteria**

- quality gates are explicit
- each major risk category maps to verification
- normal developer loop remains fast

---

## Wave 10B — Risk-Based CI

### Phase 86 — Change-Scope Detection

**Goal**

Determine which product areas a code change can affect.

**Why now**

Quality-gate routing has been defined.

**In scope**

- path/dependency mapping
- shared-contract detection
- conservative fallback
- docs-only changes

**Out of scope**

- perfect static impact analysis

**Key risks**

- false negatives skipping critical tests
- overly broad detection eliminating savings

**Depends on**

- Phase 85

**Feeds into**

- Phase 87

**Exit criteria**

- high-risk shared changes are detected conservatively
- narrow changes can avoid unrelated expensive suites
- fallback-to-broader-gates exists

---

### Phase 87 — Risk-Based CI

**Goal**

Execute appropriate CI gates based on change scope and risk.

**Why now**

Scope detection and quality mapping exist.

**In scope**

- fast tests
- server tests
- multiplayer
- PWA
- browser
- fuzz/replay/mutation
- scheduled/extended jobs

**Out of scope**

- arbitrary CI complexity

**Key risks**

- skipped critical coverage
- hard-to-debug CI routing
- too many bespoke workflows

**Depends on**

- Phases 85–86

**Feeds into**

- repo health
- release readiness

**Exit criteria**

- critical changes trigger required gates
- routine changes remain efficient
- routing logic is understandable
- extended checks have clear schedule/manual path

---

## Wave 10C — Architecture / Docs / Repository Health

### Phase 88 — Architecture Enforcement

**Goal**

Automatically enforce the most valuable architecture boundaries.

**Why now**

Architecture is mature enough to encode durable constraints.

**In scope**

- dependency rules
- forbidden imports
- ownership boundaries
- domain purity
- protocol/rules separation

**Out of scope**

- encoding every architectural preference as a test

**Key risks**

- brittle enforcement
- false confidence
- excessive custom tooling

**Depends on**

- stabilized architecture from prior waves

**Feeds into**

- agent guardrails
- continuous health

**Exit criteria**

- critical boundaries have cheap automated protection
- enforcement failures are actionable
- rules reflect canonical architecture

---

### Phase 89 — Documentation Drift Detection

**Goal**

Detect when canonical docs no longer match implementation.

**Why now**

Many waves depend on reliable repository documentation.

**In scope**

- commands
- paths
- scripts
- named contracts
- phase/release docs
- duplicate canonical docs

**Out of scope**

- semantic AI verification of every prose sentence

**Key risks**

- noisy false positives
- duplicate documentation systems
- stale command examples

**Depends on**

- canonical docs established earlier

**Feeds into**

- Phase 90
- Phase 103 final documentation reconciliation

**Exit criteria**

- high-value drift classes are automatically detected
- canonical-doc ownership is clear
- duplicate sources of truth are reduced

---

### Phase 90 — Repository Health Dashboard

**Goal**

Provide concise actionable repository-health signals.

**Why now**

Tests, CI, architecture, docs, security, and performance now have measurable signals.

**In scope**

- gate status
- flaky tests
- architecture failures
- docs drift
- selected performance/security indicators
- roadmap health links

**Out of scope**

- vanity metrics
- complex monitoring platform

**Key risks**

- noisy dashboard nobody uses
- duplicate CI status
- misleading aggregate score

**Depends on**

- Phases 83–89

**Feeds into**

- Wave 11
- continuous health

**Exit criteria**

- dashboard surfaces actionable health only
- no misleading single “quality score”
- maintainers can find failing areas quickly

---

# Wave 11 — Simplification & Maintainability

Recommended split:

```text
11A Simplification & Debt
11B Governance & Developer Experience
```

---

## Wave 11A — Simplification & Debt

### Phase 91 — Complexity Reduction

**Goal**

Simplify verified hotspots after behavior and architecture are well protected.

**Why now**

Tests and boundaries make simplification safer.

**In scope**

- large controllers/scenes
- duplicated orchestration
- unnecessary indirection
- overcomplex state handling
- high cognitive-load modules

**Out of scope**

- aesthetic refactoring
- rewrites without measurable payoff

**Key risks**

- changing behavior during cleanup
- abstraction churn
- large diff with little value

**Depends on**

- mature test/architecture coverage

**Feeds into**

- dead-code cleanup
- technical-debt review

**Exit criteria**

- selected hotspots are materially easier to reason about
- behavior remains protected
- complexity moves toward clearer ownership, not more abstraction

---

### Phase 92 — Dead-Code & Legacy Cleanup

**Goal**

Remove obsolete implementation paths and repository clutter.

**Why now**

Major feature/architecture migrations are complete.

**In scope**

- dead code
- legacy flags
- unused adapters
- obsolete tests
- stale scripts
- compatibility paths no longer required

**Out of scope**

- speculative deletion

**Key risks**

- removing hidden runtime paths
- deleting useful compatibility without policy check

**Depends on**

- Phase 91
- compatibility policy Phase 70

**Feeds into**

- technical-debt review

**Exit criteria**

- removals are evidence-backed
- no obsolete parallel authority remains
- repository surface area is reduced without regressions

---

### Phase 93 — Technical Debt Review

**Goal**

Reconcile remaining debt against actual product risk and roadmap needs.

**Why now**

Most major implementation work is complete.

**In scope**

- architecture debt
- test debt
- platform debt
- performance debt
- security debt
- UX debt
- deferred risks

**Out of scope**

- fixing every low-value item

**Key risks**

- debt inventory becoming an endless wishlist
- reopening deliberately accepted decisions

**Depends on**

- Phases 91–92
- all prior risk registers

**Feeds into**

- governance
- final release planning

**Exit criteria**

- remaining debt is prioritized
- accepted/deferred items have rationale
- no hidden P0/P1 debt remains unowned

---

## Wave 11B — Governance & Developer Experience

### Phase 94 — Architectural Decision Records

**Goal**

Capture important durable architectural decisions and tradeoffs.

**Why now**

The architecture has stabilized through multiple waves.

**In scope**

- major authority decisions
- state ownership
- protocol model
- deterministic AI
- persistence/compatibility
- critical technology choices

**Out of scope**

- ADR for every small refactor

**Key risks**

- stale ADRs
- duplicating architecture docs
- excessive documentation overhead

**Depends on**

- stable architecture
- Phase 93 debt review

**Feeds into**

- agent guardrails
- future maintenance

**Exit criteria**

- only significant decisions are recorded
- ADRs link to canonical architecture
- rejected alternatives/rationale are preserved where valuable

---

### Phase 95 — Agent Regression Guardrails

**Goal**

Prevent future coding-agent work from violating established contracts.

**Why now**

The repository now has stable architecture, tests, docs, and CI rules.

**In scope**

- AGENTS guidance
- ownership boundaries
- required verification
- forbidden patterns
- canonical docs
- risk/exit expectations

**Out of scope**

- giant prompt duplication
- rules agents cannot realistically follow

**Key risks**

- stale instructions
- conflicting guidance
- overly rigid workflow

**Depends on**

- Phases 88–94

**Feeds into**

- future autonomous development
- continuous health

**Exit criteria**

- agent guidance is concise and aligned with repository truth
- critical regressions are prevented by automation where possible
- prompts reference canonical sources instead of duplicating them

---

### Phase 96 — Developer Experience

**Goal**

Make common development workflows fast, obvious, and reliable.

**Why now**

Architecture, tests, tooling, and governance have stabilized.

**In scope**

- setup
- commands
- local feedback
- debugging
- scenario tooling
- docs navigation
- common scripts

**Out of scope**

- unrelated developer-platform investment

**Key risks**

- too many scripts
- wrappers hiding real commands
- documentation/tool drift

**Depends on**

- Phases 55, 83–95

**Feeds into**

- Wave 4 production work
- Wave 12 release maintenance

**Exit criteria**

- new/returning developers can identify correct workflows quickly
- commands are predictable
- common debugging paths are documented
- tooling reduces friction instead of adding layers

---

# Deferred Wave 4 — Visual / PixelLab / Asset System

This wave remains intentionally deferred until architecture, AI, multiplayer, resilience, performance, QA/CI, and maintainability are sufficiently stable.

It should run before Wave 12 final release readiness.

Recommended split:

```text
4A Visual System & Asset Strategy
4B PixelLab Production System
4C Production & Integration
4D Visual Validation & Performance
```

---

## Wave 4A — Visual System & Asset Strategy

### Phase 24 — Asset Inventory & Visual Debt Audit

**Goal**

Establish the real state of current assets and visual debt.

**Why now**

Final art production should not begin without knowing what exists and what must be replaced.

**In scope**

- current assets
- placeholders
- low-resolution sources
- inconsistent families
- scaling issues
- missing states
- runtime ownership

**Out of scope**

- generating final assets

**Key risks**

- replacing healthy assets unnecessarily
- missing hidden runtime dependencies
- unclear source provenance

**Depends on**

- stabilized UI/layout from Wave 5
- simplified repository from Wave 11

**Feeds into**

- art direction
- resolution strategy

**Exit criteria**

- asset inventory is complete enough to plan production
- visual debt is prioritized
- replacement scope is explicit

---

### Phase 25 — Art Direction Lock

**Goal**

Define the final visual language and consistency target.

**Why now**

Asset generation needs one stable direction.

**In scope**

- visual references
- color/material language
- shape language
- typography relationship
- card/table/UI relationship
- atmosphere
- golden examples

**Out of scope**

- large-scale asset production

**Key risks**

- vague style target
- inconsistent generated assets
- final art fighting existing UX readability

**Depends on**

- Phase 24

**Feeds into**

- all later Wave 4 work

**Exit criteria**

- approved references exist
- visual rules are concrete enough to judge assets
- readability/accessibility constraints are preserved

---

### Phase 26 — Multi-Resolution Strategy

**Goal**

Define how assets and UI scale across target devices/displays.

**Why now**

Source resolution and export strategy must be decided before production.

**In scope**

- logical resolution
- source resolution
- device density
- pixel-art/scaling behavior
- large-screen behavior
- export sizes

**Out of scope**

- final asset generation

**Key risks**

- blurry high-DPI output
- huge memory usage
- inconsistent scaling
- redoing assets later

**Depends on**

- Phase 25
- Wave 5 responsive work

**Feeds into**

- PixelLab production
- asset pipeline

**Exit criteria**

- source/export resolution policy is explicit
- target displays are covered
- memory/performance implications are understood

---

## Wave 4B — PixelLab Production System

### Phase 27 — PixelLab Production System

**Goal**

Create a repeatable production workflow for generated visual assets.

**Why now**

Art direction and resolution policy are stable.

**In scope**

- prompt templates
- metadata
- source tracking
- naming
- regeneration
- versioning
- review workflow

**Out of scope**

- uncontrolled one-off generation

**Key risks**

- unreproducible assets
- inconsistent prompts
- missing provenance
- manual chaos

**Depends on**

- Phases 25–26

**Feeds into**

- asset families
- high-resolution production

**Exit criteria**

- assets can be regenerated intentionally
- prompt/source metadata is preserved
- naming/version rules are clear

---

### Phase 28 — Asset Families & Golden References

**Goal**

Establish canonical families and visual anchors.

**Why now**

Generation quality depends on stable references.

**In scope**

- cards
- table
- controls
- icons
- effects
- backgrounds
- golden examples

**Out of scope**

- every final asset

**Key risks**

- style drift
- inconsistent scale/detail
- reference set too broad

**Depends on**

- Phase 27

**Feeds into**

- UI assets
- production

**Exit criteria**

- major asset families have approved anchors
- future assets can be judged consistently
- references preserve gameplay readability

---

### Phase 29 — Scalable UI Asset System

**Goal**

Create final-quality UI assets that scale across layouts.

**Why now**

Wave 5 already defined structural UI semantics.

**In scope**

- scalable panels
- buttons
- frames
- icon states
- 9-slice or equivalent
- state variants

**Out of scope**

- redoing UI architecture
- changing interaction semantics

**Key risks**

- decorative assets locking layout
- unreadable disabled/focus states
- excessive texture memory

**Depends on**

- Wave 5B
- Phases 26–28

**Feeds into**

- final production/integration

**Exit criteria**

- canonical UI states are visually supported
- assets scale without distortion
- interaction/accessibility semantics remain clear

---

## Wave 4C — Production & Integration

### Phase 30 — High-Resolution Asset Production

**Goal**

Produce final-quality visual assets.

**Why now**

Visual direction, references, scaling, and pipeline are defined.

**In scope**

- final asset families
- large-screen/high-DPI sources
- effects
- gameplay art
- backgrounds
- final UI imagery

**Out of scope**

- architecture redesign

**Key risks**

- quantity over quality
- inconsistent families
- asset bloat

**Depends on**

- Phases 27–29

**Feeds into**

- integration/QA

**Exit criteria**

- required production asset set exists
- assets meet approved references
- source quality supports target displays

---

### Phase 31 — Asset Integration Pipeline

**Goal**

Integrate final assets predictably into runtime.

**Why now**

Production assets exist.

**In scope**

- manifests
- naming
- loading
- atlases
- fallbacks
- compression
- runtime references
- metadata

**Out of scope**

- broad rendering rewrite

**Key risks**

- missing assets
- silent fallback
- duplicate loading
- brittle paths

**Depends on**

- Phase 30

**Feeds into**

- automated asset QA
- visual regression

**Exit criteria**

- runtime uses canonical asset pipeline
- missing/invalid assets fail predictably
- loading/fallback behavior is explicit

---

### Phase 32 — Automated Asset QA

**Goal**

Catch objective asset defects automatically.

**Why now**

The integration pipeline provides stable metadata and manifests.

**In scope**

- dimensions
- formats
- transparency
- missing assets
- naming
- manifest consistency
- resolution constraints

**Out of scope**

- subjective visual-quality judgment

**Key risks**

- false confidence from structural checks
- overly rigid validation

**Depends on**

- Phase 31

**Feeds into**

- visual regression
- release QA

**Exit criteria**

- common objective asset defects fail automatically
- checks are fast/actionable
- subjective quality remains separately reviewed

---

## Wave 4D — Visual Validation & Performance

### Phase 33 — Visual Regression Baseline

**Goal**

Protect stable final visuals from accidental regression.

**Why now**

The visual system is finally mature enough to freeze representative states.

**In scope**

- representative screenshots
- deterministic states
- comparison tolerances
- baseline review workflow

**Out of scope**

- snapshotting every screen/state

**Key risks**

- noisy baselines
- freezing temporary visuals
- false positives from nondeterminism

**Depends on**

- Phases 30–32

**Feeds into**

- responsive QA
- final visual QA

**Exit criteria**

- selected durable visual states have stable baselines
- review/update workflow is explicit
- visual regressions are actionable

---

### Phase 34 — Large-Screen & Responsive Visual QA

**Goal**

Validate final visual quality across representative target displays.

**Why now**

Final assets and visual baselines exist.

**In scope**

- phones
- tablets
- desktop
- high-DPI
- large screens
- portrait/landscape where supported

**Out of scope**

- exhaustive device matrix

**Key risks**

- high-DPI blur
- clipping
- oversized/undersized assets
- inconsistent table composition

**Depends on**

- Phases 26, 33

**Feeds into**

- final visual QA

**Exit criteria**

- representative target displays look intentional
- critical UI remains readable/usable
- major visual scaling issues are resolved

---

### Phase 35 — Asset Performance & Loading

**Goal**

Optimize final asset cost without degrading visual quality.

**Why now**

Actual production assets are available to measure.

**In scope**

- compression
- decoding
- memory
- atlases
- caching
- load order
- bundle impact

**Out of scope**

- premature optimization of placeholder assets

**Key risks**

- overcompression
- memory spikes
- slow startup
- duplicated textures

**Depends on**

- Phases 30–34
- Phase 75 performance budgets

**Feeds into**

- Wave 12 performance/release gates

**Exit criteria**

- asset loading meets defined budgets
- memory use is acceptable
- visual degradation from optimization is reviewed

---

# Wave 12 — Final Release Readiness

### Phase 97 — Final Product QA

**Goal**

Run a final product-level acceptance pass across the entire game.

**Why now**

All major implementation and visual work is complete.

**In scope**

- local play
- AI
- tutorial
- settings
- persistence
- recovery
- app shell
- representative failure paths

**Out of scope**

- new feature development

**Key risks**

- cross-wave regressions
- assumptions never tested together
- late integration defects

**Depends on**

- all prior waves

**Feeds into**

- Phases 98–104

**Exit criteria**

- critical player journeys pass
- no unresolved release-blocking product defect remains

---

### Phase 98 — Final Visual QA

**Goal**

Approve final production visual quality.

**Why now**

Wave 4 is complete.

**In scope**

- final assets
- representative resolutions
- responsive states
- effects
- UI consistency
- visual regression review

**Out of scope**

- redesign

**Key risks**

- unresolved placeholder art
- inconsistent asset families
- late readability regression

**Depends on**

- Wave 4
- Phase 97

**Exit criteria**

- no release-blocking visual defect remains
- final visual baselines match intended quality

---

### Phase 99 — Final Accessibility QA

**Goal**

Revalidate accessibility against the final UI/art/product.

**Why now**

Final assets can affect contrast, focus visibility, motion, and readability.

**In scope**

- keyboard/focus
- reduced motion
- color independence
- text scaling
- touch
- accessible labels
- final contrast/readability

**Out of scope**

- claiming unsupported compliance certification

**Key risks**

- Wave 4 art reducing accessibility
- late UI states missing semantics

**Depends on**

- Wave 5C
- Wave 4
- Phase 97

**Exit criteria**

- critical accessibility regressions are resolved
- remaining limitations are documented honestly

---

### Phase 100 — Final Multiplayer QA

**Goal**

Run the final high-risk multiplayer acceptance suite.

**Why now**

All product/platform changes are complete.

**In scope**

- authority
- privacy
- normal match
- reconnect
- rematch
- races
- multi-client
- soak
- target browsers

**Out of scope**

- new multiplayer features

**Key risks**

- late regression from persistence/security/UI/asset changes
- compatibility drift

**Depends on**

- Wave 7
- Waves 8–11
- Phase 97

**Exit criteria**

- release-critical multiplayer scenarios pass
- no known privacy/authority blocker remains

---

### Phase 101 — Final Performance Gate

**Goal**

Prove the production build meets accepted performance budgets.

**Why now**

All code and final assets are present.

**In scope**

- startup
- runtime/frame behavior
- AI
- multiplayer overhead
- memory
- bundle
- asset loading

**Out of scope**

- speculative optimization beyond budgets

**Key risks**

- final art increasing load/memory
- production-only regression
- lower-end target misses

**Depends on**

- Wave 9
- Wave 4
- Phase 97

**Exit criteria**

- defined release budgets pass or have explicitly accepted exceptions
- no major memory leak remains
- production build is measured

---

### Phase 102 — Production & Release Readiness

**Goal**

Confirm operational readiness to ship safely.

**Why now**

Product, multiplayer, accessibility, and performance gates have passed.

**In scope**

- production config
- deployment
- release channels
- rollback
- monitoring/error reporting
- versioning
- secrets/environment checks

**Out of scope**

- feature changes

**Key risks**

- configuration drift
- unsafe rollback
- missing production observability
- wrong environment settings

**Depends on**

- Phases 70–82
- Phases 97–101

**Exit criteria**

- release procedure is reproducible
- rollback path is ready
- production configuration is validated
- release blockers are zero or explicitly accepted

---

### Phase 103 — Final Documentation Reconciliation

**Goal**

Make repository documentation match the product that is actually shipping.

**Why now**

Implementation is effectively final.

**In scope**

- architecture
- rules
- multiplayer
- testing
- AI
- accessibility
- localization
- deployment
- release
- commands
- troubleshooting

**Out of scope**

- historical documentation cleanup without current value

**Key risks**

- stale commands
- obsolete architecture claims
- duplicate canonical docs

**Depends on**

- Phases 97–102

**Feeds into**

- continuous health

**Exit criteria**

- canonical docs reflect current implementation
- obsolete competing documentation is removed or clearly historical
- operational instructions are accurate

---

### Phase 104 — Continuous Architecture & Quality Health

**Goal**

Leave MexeMexe with sustainable long-term quality controls after release.

**Why now**

The roadmap should end with durable maintenance, not a one-time snapshot.

**In scope**

- architecture gates
- CI health
- docs drift
- flaky tests
- security/dependency checks
- performance trend checks
- roadmap/risk handoff

**Out of scope**

- permanent high-cost gating for every commit

**Key risks**

- release gates disappearing after launch
- noisy automation
- future agent/developer drift

**Depends on**

- all prior phases

**Exit criteria**

- critical health checks remain automated or explicitly scheduled
- ownership of future risks is clear
- maintainers have concise health signals
- the repository can continue evolving without recreating the entire roadmap process

---

# Wave Exit Rule

A wave should not advance merely because all named phases were attempted.

Before advancing, confirm:

```text
Are the wave's core outcomes actually present?

Are canonical ownership boundaries still valid?

Are relevant P0/P1 risks resolved or explicitly blocking?

Would an open risk cause the next wave to build on the wrong boundary?

Are tests protecting the durable contracts created by this wave?

Are canonical docs current?
```

Possible wave outcomes:

```text
PASS
PASS WITH DEFERRED NON-BLOCKING RISKS
BLOCKED
```

If a narrow blocker exists between waves, close that blocker before continuing rather than creating unnecessary new roadmap scope.

---

# Deferred Work Policy

A phase may intentionally defer work when:

- another later phase is the correct owner
- the issue is P2/P3 and non-blocking
- the evidence does not justify implementation yet
- the product requirement is not yet known
- the work would freeze an unstable subsystem prematurely

Deferred work must state:

```text
what is deferred
why it is safe to defer
which future phase owns it
what would make it blocking
```

Examples:

- final visual polish → Wave 4
- broad CI optimization → Wave 10
- code cleanup unrelated to current behavior → Wave 11
- final cross-product QA → Wave 12

---

# Final Roadmap Definition of Done

The roadmap is complete when MexeMexe is not merely feature-complete, but:

- gameplay-correct
- deterministic where required
- AI-capable and reproducible
- multiplayer-authoritative and resilient
- privacy-safe
- security-hardened
- recoverable
- performant
- memory-stable
- consistently designed
- accessible
- localization-ready
- visually production-ready
- efficiently tested
- CI-governed
- maintainable
- operationally releasable
- accurately documented

The final standard is:

> every major subsystem has clear ownership, appropriate evidence, bounded risk, and a maintainable path forward.
