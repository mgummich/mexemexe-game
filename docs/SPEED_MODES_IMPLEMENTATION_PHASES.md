# MexeMexe Speed Modes — Implementation Phases

This file is the ordered source of truth for the autonomous Speed Modes implementation.

The implementation controller must execute these phases in order and update:

`SPEED_MODES_IMPLEMENTATION_STATUS.md`

Do not ask for user approval between phases.

---

# Phase 1 — Architecture Audit and Shared Timing Design

## Goal

Understand the current repository and establish the smallest coherent shared timing architecture.

## Inspect

- `AGENTS.md`
- `WORKFLOW.md`
- architecture docs
- game state
- turn state machine
- multiplayer authority
- current timers
- lobby/setup
- reconnect/resync
- rematch
- AI interfaces
- settings/config
- persistence
- UI
- audio/haptics
- tests
- replay/debug tooling
- browser/mobile handling

## Deliver

Document:

```text
timing ownership
shared timing state
mode policies
authoritative timestamps/deadlines
client countdown projection
reconnect behavior
rematch reset
configuration/ruleset model
AI integration boundary
UI adapter boundary
Godot/native portability boundary
```

## Exit criteria

- architecture is documented
- no parallel timer design is planned
- current integration points are identified
- existing non-speed gameplay contract is understood

---

# Phase 2 — Shared Authoritative Timing Foundation

## Goal

Implement one deterministic timing domain for all Speed Modes.

Support where applicable:

```text
mode
ruleset
active player
decision start
deadline
per-turn timer
personal Clock
increment
Freeze
timeout
Panic
Last Breath
Time Debt
Perfect Rhythm
Adrenaline
Tempo
Heat
Overheat
simultaneous decision windows
```

## Requirements

- authority owns competitive timing
- client wall clock is presentation only
- deterministic move-vs-deadline race rule
- reconnect-safe
- rematch-safe
- duplicate action protection
- no leaked timers/listeners
- browser backgrounding does not alter authoritative outcome

## Tests

- timing math
- timeout
- near-deadline action
- reconnect
- rematch
- teardown

## Exit criteria

- one timing foundation exists
- multiplayer clients converge
- normal MexeMexe unaffected

---

# Phase 3 — Shared Speed UX

## Goal

Create reusable fast-play UX.

## Implement

- timer/Clock presentation
- warning state
- critical state
- fast animation policy
- immediate turn handoff
- nonblocking feedback
- quick rematch
- mobile touch layout
- audio hooks
- haptic hooks
- reduced motion
- non-color-only warnings

## Exit criteria

Usable on:

```text
Chrome
Firefox
Safari/iOS layout target
```

No blocking dialogs during active timed play.

---

# Phase 4 — MexeMexe Blitz Core

## Goal

Implement Blitz as normal MexeMexe with fixed per-turn time pressure.

## Default prototype

Approximately:

```text
7 seconds per turn
```

but fully configuration-driven.

## Implement

- mode registration
- fixed authoritative turn timer
- timeout behavior
- lobby/setup
- multiplayer
- AI interface
- game over
- reconnect
- rematch
- summary/stat hooks

## Exit criteria

A complete Blitz game works across supported game lifecycle paths.

---

# Phase 5 — Blitz Perfect Rhythm

## Goal

Add Perfect Rhythm as an always-present internal flow system.

## Rules

- not a normal player-facing toggle
- based on decision timing/consistency
- subtle feedback
- optional small configurable gameplay influence
- must not make reckless fast play universally optimal

## Exit criteria

- Rhythm progresses/resets deterministically
- visible only through intended feedback/stats
- no setup toggle exists

---

# Phase 6 — Blitz Adrenaline

## Goal

Add automatic critical-time intensity.

## Rules

- always part of Blitz
- not a normal toggle
- activates near turn expiry
- can modify feedback/animation intensity
- must preserve readability/accessibility

## Exit criteria

- threshold behavior tested
- resets correctly
- reconnect-safe
- reduced-motion/audio-disabled behavior valid

---

# Phase 7 — Blitz Panic Button and Last Breath

## Goal

Add optional assistance.

## Panic Button

- emergency time extension
- optional
- limited/configurable
- deterministic
- reconnect-safe
- duplicate-use protected

## Last Breath

- short final survival window
- optional
- deterministic
- finite
- no accidental chain loop

## Mandatory rule

```text
Panic Button can always be disabled.
Last Breath can always be disabled.
```

## Tests

All four combinations:

```text
ON / ON
ON / OFF
OFF / ON
OFF / OFF
```

---

# Phase 8 — Blitz Difficulty Presets

Create:

```text
Easy
Medium
Hard
Expert
Custom
```

Presets define defaults for allowed player-facing settings.

Potential values:

- turn duration
- Panic default/uses/duration
- Last Breath default/duration
- forgiveness values if justified

## Mandatory

Perfect Rhythm and Adrenaline remain built-in.

Panic and Last Breath remain individually disableable.

---

# Phase 9 — MexeMexe Time Attack Core

## Goal

Implement persistent personal clocks.

## Default prototype

Approximately:

```text
60 seconds starting Clock
+3 seconds per valid move
```

but fully configurable.

## Requirements

- Clock consumes authoritative decision time
- Clock persists across turns
- increment deterministic
- zero authoritative
- reconnect/rematch safe
- multiplayer synchronized
- AI-compatible

## Exit criteria

Complete multiplayer Time Attack match works without clock desync.

---

# Phase 10 — Time Attack Perfect Rhythm

## Goal

Reuse shared Rhythm behavior in Time Attack.

## Rules

- always internal
- not a normal toggle
- reuse shared implementation
- may affect subtle feedback/statistics
- any Clock reward must remain small/configurable

---

# Phase 11 — Time Attack Adrenaline

## Goal

Adapt Adrenaline to persistent Clock.

## Rules

- always internal
- not a normal toggle
- primarily based on remaining personal Clock threshold/percentage
- enhances intensity without obscuring play

---

# Phase 12 — Time Attack Panic Button and Last Breath

Integrate both assistance mechanics.

## Mandatory

```text
Panic Button always individually disableable.
Last Breath always individually disableable.
```

## Tests

- Panic near zero
- zero + Last Breath
- increment after successful Last Breath
- reconnect during Last Breath
- rematch reset
- both disabled

---

# Phase 13 — Time Attack Freeze

## Goal

Add optional Freeze.

## Behavior

```text
activate
→ authoritative Clock consumption pauses
→ player may continue thinking/interacting
→ Freeze ends deterministically
```

## Requirements

- optional
- limited/configurable
- reconnect-safe
- no lag-based extension
- duplicate-use protection

---

# Phase 14 — Time Attack Time Debt

## Goal

Add optional borrowing.

## Preferred model

```text
borrow Clock now
→ create explicit debt
→ future positive Clock gains repay debt first
```

Avoid surprise arbitrary deductions.

## Requirements

- deterministic debt state
- clear UI
- reconnect-safe
- no invalid negative values
- explicit Panic/Last Breath/increment interaction

---

# Phase 15 — Time Attack Presets

Create:

```text
Easy
Medium
Hard
Expert
Custom
```

Potential fields:

- starting Clock
- increment
- Panic
- Last Breath
- Freeze
- Time Debt

Perfect Rhythm and Adrenaline remain native.

Panic and Last Breath remain disableable.

---

# Phase 16 — Optional Overheat Modifier Outside Tempo

## Goal

Prototype optional Overheat in Blitz/Time Attack.

State:

```text
CALM
→ WARM
→ HOT
→ OVERHEAT
```

Possible effects:

- temporary bonus suppression
- temporary time-power restriction
- cooldown

## Guardrail

If it reduces clarity outside Tempo:

```text
keep implementation reusable
mark modifier experimental/off by default
```

Do not force into standard play.

---

# Phase 17 — Commit / No Undo Thinking

## Goal

Implement safe irreversible commitment.

Preferred behavior:

```text
exploration allowed
→ explicit valid commit
→ action final
```

## Requirements

- optional
- hardcore
- touch-safe
- deterministic
- off standard matchmaking initially

---

# Phase 18 — Simultaneous Start Prototype

## Goal

Prototype simultaneous decisions.

State flow:

```text
window starts
→ eligible players choose
→ choices lock
→ missing/timeout choices handled
→ conflicts resolve deterministically
→ authoritative result
```

## Document

- eligibility
- lifecycle
- choice lock
- timeout
- conflicts
- order
- disconnect/reconnect

## Exit criteria

```text
same authoritative choices
→ same resolved state
```

If this cannot be proven robust, keep experimental/deferred.

---

# Phase 19 — MexeMexe Tempo Core

## Goal

Create the separate Tempo mode.

Core resources:

```text
Clock = survival
Tempo = power
Heat = risk
```

Core loop:

```text
play confidently
→ gain Tempo
→ manipulate time
→ gain Heat
→ manage Overheat
→ continue
```

Must reuse shared timing architecture.

---

# Phase 20 — Tempo Generation

## Sources

Potentially:

- fast valid move
- Snap-like move
- Perfect Rhythm
- critical-time success

## Requirements

- deterministic
- bounded
- configurable
- authoritative
- observable
- AI-accessible

Perfect Rhythm becomes mechanically meaningful here.

---

# Phase 21 — Tempo Abilities v1

Implement only:

```text
Freeze
Recover
Surge
```

## Freeze

Spend Tempo to pause own Clock briefly.

## Recover

Spend Tempo to gain Clock.

## Surge

Increase Tempo generation while increasing Heat/risk.

## Requirements

- explicit cost
- authoritative
- deterministic duration
- reconnect-safe
- duplicate-use protection
- AI-accessible

---

# Phase 22 — Tempo Heat and Overheat

## Goal

Implement Heat as Tempo's risk system.

State:

```text
CALM
→ WARM
→ HOT
→ OVERHEAT
```

At Overheat prefer:

- temporary power lockout
- reduced/paused Tempo gain
- deterministic cooldown

Avoid arbitrary instant death or unexplained Clock loss.

---

# Phase 23 — Tempo Adrenaline

## Goal

Adapt Adrenaline to low Clock.

Possible effects:

```text
higher Tempo generation
higher Heat generation
stronger feedback
```

Creates:

```text
comeback potential
+
greater risk
```

Not a normal toggle.

---

# Phase 24 — Tempo Survival Systems

Integrate:

```text
Panic
Last Breath
Time Debt
```

Prefer Panic as Tempo-to-Clock conversion.

Last Breath may require Tempo/cost.

If Panic or Last Breath is exposed as assistance:

```text
it must remain individually disableable
```

Do not let survival mechanics overwhelm Clock/Tempo/Heat.

---

# Phase 25 — Advanced Tempo Powers

Prototype one at a time only after Tempo v1 is stable.

Candidates:

```text
Focus
slower own Clock consumption
Tempo Shield
alternate Surge
global time states
Time Domains
```

For each:

```text
define
implement
test
evaluate
keep or remove
```

Do not add all ideas automatically.

This phase may explicitly defer weak/unproven concepts.

---

# Phase 26 — Tempo Sync

## Goal

Reuse Simultaneous Start as an advanced Tempo ability.

Possible flow:

```text
spend Tempo
→ SYNC
→ simultaneous decision window
→ lock
→ deterministic resolution
```

Only enable if Phase 18 proved robust.

Otherwise mark deferred with explicit justification.

---

# Phase 27 — Matchmaking, Lobby, and Ruleset Policy

Define availability for:

```text
casual
ranked
private
custom
AI/local
experimental
```

## Goals

- avoid fragmented queues
- keep ranked rules stable
- expose advanced experimentation mainly in private/custom until validated

Lobby should show relevant player-facing rules.

Do not list Perfect Rhythm or Adrenaline as ordinary modifiers.

---

# Phase 28 — Speed AI

## Goal

Make AI understand time/resources.

Provide relevant inputs:

- remaining turn time
- personal Clock
- Panic
- Last Breath
- Freeze
- Time Debt
- Tempo
- Heat
- Overheat
- mode/preset
- risk tolerance

AI may vary in:

- decision speed
- Clock conservation
- Panic use
- debt tolerance
- Freeze timing
- Tempo spending
- Surge
- Heat tolerance

Do not redesign the full AI architecture.

Do not allow hidden-information cheating.

---

# Phase 29 — Focused Speed QA Matrix

## Unit/domain

Cover:

- deadlines
- Clock
- increment
- Panic
- Last Breath
- Freeze
- debt
- Rhythm
- Adrenaline
- Tempo
- Heat
- Overheat
- Surge
- simultaneous resolution

## Integration

Cover:

- complete Blitz
- complete Time Attack
- complete Tempo
- teardown
- rematch
- rulesets
- presets
- AI
- non-speed regression

## Real multi-client

Cover:

- just-before deadline
- just-after deadline
- latency
- duplicate input
- reconnect
- disconnect
- Last Breath reconnect
- Freeze reconnect
- Time Debt sync
- Tempo/Heat sync
- simultaneous windows
- repeated rematches
- lobby changes

## Browsers

Primary:

```text
Chrome
Firefox
Safari on iOS
```

If iOS automation is unavailable, execute/document concrete manual coverage.

---

# Phase 30 — Balancing and Telemetry

## Goal

Centralize balancing and collect evidence if infrastructure already exists.

Potential metrics:

- decision duration
- timeouts
- Panic
- Last Breath
- Time Debt
- Rhythm
- Adrenaline
- Freeze
- Tempo
- Heat/Overheat
- Surge
- match duration
- rematch
- reconnect/disconnect

Do not build a new analytics platform.

This phase may leave numerical tuning marked as requiring playtest evidence.

---

# Phase 31 — Documentation Synchronization

Update canonical docs for:

- overview
- Blitz
- Time Attack
- Tempo
- presets
- optional assistance
- Freeze
- Time Debt
- Commit
- Simultaneous Start
- Tempo abilities
- architecture
- authority
- reconnect
- multiplayer
- AI
- QA
- browsers
- known limitations
- ruleset versioning if used

Remove stale contradictions.

---

# Phase 32 — Release Hardening and Final Acceptance

Audit:

- races
- duplicate timers
- leaked listeners
- stale state
- negative clocks
- duplicate ability requests
- stale previous-match requests
- rematch reset
- reconnect
- desync
- serialization
- accessibility
- mobile layout
- localization readiness
- performance
- logs/errors
- client trust boundaries

Run final verification.

## Final acceptance

### Blitz

```text
fixed authoritative timer
Perfect Rhythm native/invisible
Adrenaline native/invisible
Panic optional + disableable
Last Breath optional + disableable
presets/custom
multiplayer
AI
reconnect/rematch
```

### Time Attack

```text
persistent Clock
increment
Perfect Rhythm native/invisible
Adrenaline native/invisible
Panic optional + disableable
Last Breath optional + disableable
Freeze optional
Time Debt optional
presets/custom
multiplayer
AI
reconnect/rematch
```

### Tempo

```text
Clock
Tempo
Heat
Perfect Rhythm generation
Freeze
Recover
Surge
Overheat
Adrenaline
survival systems
multiplayer
AI
```

### Experimental

```text
Commit touch-safe if enabled
Simultaneous Start deterministic if enabled
Tempo Sync only enabled when proven robust
```

### Quality

```text
one timing architecture
no client wall-clock authority
no hidden test workarounds
docs match code
tests match behavior
```

When these criteria are satisfied, the Speed Modes initiative is complete.
