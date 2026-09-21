# MexeMexe Speed Modes — Autonomous Implementation Controller

# Goal

Implement the complete MexeMexe Speed Modes initiative autonomously by reading and executing the phases defined in:

`SPEED_MODES_IMPLEMENTATION_PHASES.md`

Repository:
`https://github.com/mgummich/mexemexe-game`

This prompt is the **controller**.

The phase file is the **implementation source of truth**.

Do not require step-by-step interaction from the user.

Read the phase file, determine the current implementation state, execute all incomplete phases in order, verify each phase, update progress, and continue automatically until:

```text
A. all phases are complete
or
B. a genuine blocker prevents safe progress
```

Do not pause after each phase to ask for permission.

Do not ask the user which phase to execute next.

Do not ask for confirmation when the phase file already defines the intended behavior.

Use best judgment for small implementation details that are not product decisions.

---

# Mandatory startup sequence

Before making changes:

1. Read `AGENTS.md`.
2. Read `WORKFLOW.md`.
3. Read `SPEED_MODES_IMPLEMENTATION_PHASES.md` completely.
4. Inspect the current branch and repository.
5. Identify which phases are already:
   - complete
   - partially complete
   - not started
   - obsolete because equivalent functionality already exists
6. Verify implementation state from code and tests rather than trusting stale documentation.
7. Start from the earliest incomplete phase whose prerequisites are satisfied.
8. Continue sequentially without user interaction.

If the phase file is not present at the expected path, search the repository for:

```text
SPEED_MODES_IMPLEMENTATION_PHASES.md
speed modes
MexeMexe Blitz
MexeMexe Time Attack
MexeMexe Tempo
```

If a matching canonical phase document exists under another path, use it and normalize documentation references where appropriate.

If no phase document exists, this is a genuine blocker because this controller intentionally delegates product scope to that file.

---

# Source-of-truth hierarchy

When instructions disagree, use this order:

```text
1. AGENTS.md
2. WORKFLOW.md
3. this controller prompt
4. SPEED_MODES_IMPLEMENTATION_PHASES.md
5. existing canonical architecture/gameplay docs
6. existing implementation
7. comments/tests that are not canonical docs
```

However:

- never blindly overwrite working production behavior solely because old documentation says otherwise
- investigate mismatches
- preserve existing behavior unless the phase file explicitly changes it
- if the implementation already satisfies a phase more cleanly than the phase text anticipated, keep the cleaner implementation and document equivalence

---

# Autonomous execution contract

The task is intended to run without user interaction.

Therefore:

## Do not stop for normal implementation choices

Do not ask questions such as:

```text
Which file should this go in?
Should I continue?
Should I implement the next phase?
Which naming option do you prefer?
Should I add the tests now?
Should I update the docs?
```

Decide using:

- repository conventions
- existing architecture
- smallest coherent change
- phase requirements
- testability
- maintainability

## Do not stop after phase completion

After a phase passes its quality gate:

```text
update progress
→ identify next phase
→ continue
```

## Do not wait for user approval between commits/phases

The phase file already represents approval of the roadmap.

## When ambiguity exists

Resolve locally when the choice is:

- naming
- file placement
- helper extraction
- test level
- UI component placement
- configuration shape
- internal event naming
- refactor necessary to preserve architecture

Choose the option most consistent with the existing repository.

## Only stop for genuine blockers

Examples:

- required secret/credential unavailable
- external service cannot be accessed
- repository is corrupted
- required dependency cannot be installed and no safe local alternative exists
- product requirement has two mutually exclusive interpretations with materially different user-visible behavior and neither is established in code/docs
- implementation would require destructive migration without a recoverable path
- required upstream API/tool is unavailable

Do not classify ordinary compiler errors, failing tests, refactoring work, or implementation complexity as blockers.

Fix them.

---

# Phase orchestration

Treat `SPEED_MODES_IMPLEMENTATION_PHASES.md` as an ordered state machine.

For each phase:

```text
READ
→ AUDIT
→ PLAN LOCALLY
→ IMPLEMENT
→ TEST
→ VERIFY
→ UPDATE DOCS
→ UPDATE PHASE STATUS
→ CONTINUE
```

Never jump forward merely because a later phase is easier.

A later phase may be started early only when:

- it is a prerequisite extraction/refactor required by the current phase
- it does not change later product scope
- doing it now clearly reduces duplication

If that occurs, record it as preparatory work rather than marking the later phase complete unless all its acceptance criteria are actually met.

---

# Phase status model

Maintain a progress section in:

`SPEED_MODES_IMPLEMENTATION_STATUS.md`

Create it if it does not exist.

Use these statuses:

```text
NOT_STARTED
IN_PROGRESS
COMPLETE
PARTIAL
BLOCKED
DEFERRED
```

The status file is operational tracking only.

It must not replace the phase specification.

For every phase record:

```text
Phase:
Status:
Completed scope:
Tests:
Docs updated:
Known issues:
Deferred items:
Commit/revision reference if available:
```

Keep entries concise.

Do not store speculative plans or large reasoning dumps.

---

# Resume behavior

The controller must be safe to run multiple times.

On every run:

1. inspect code
2. inspect tests
3. inspect status file
4. compare status against actual implementation
5. repair stale status
6. continue from earliest incomplete phase

Do not assume `COMPLETE` is correct without lightweight verification.

If a previous run stopped mid-phase:

- inspect working tree
- preserve valid partial work
- finish or clean it
- rerun relevant tests
- then continue

Do not restart the entire roadmap unnecessarily.

---

# Product rules that must remain true

## MexeMexe Blitz

```text
- fixed per-turn time pressure
- Perfect Rhythm is always part of the mode
- Adrenaline is always part of the mode
- Perfect Rhythm is not a normal player-facing toggle
- Adrenaline is not a normal player-facing toggle
- Panic Button is optional
- Last Breath is optional
- Panic Button can always be disabled
- Last Breath can always be disabled
- presets define defaults, not forced restrictions
```

## MexeMexe Time Attack

```text
- persistent personal clock
- configurable increment
- Perfect Rhythm always active internally
- Adrenaline always active internally
- Panic Button optional
- Last Breath optional
- Panic Button can always be disabled
- Last Breath can always be disabled
- Freeze optional
- Time Debt optional
- presets define defaults, not forced restrictions
```

## MexeMexe Tempo

```text
- separate mode
- Clock = survival
- Tempo = power
- Heat = risk
- Perfect Rhythm contributes to Tempo generation
- Adrenaline modifies low-clock risk/reward
- Freeze, Recover, Surge are v1 abilities
- Overheat is a core system
```

Do not reinterpret these decisions without explicit contradictory repository instructions.

---

# Engineering rules

1. Build one shared timing architecture.
2. Do not create independent Blitz, Time Attack, and Tempo timer engines.
3. Keep competitive timing authoritative.
4. Do not trust client wall-clock time for outcomes.
5. Keep domain timing logic platform-neutral.
6. Keep browser APIs at adapter/UI edges.
7. Prefer pure deterministic functions for timing math/state transitions.
8. Preserve normal MexeMexe gameplay unless the phase explicitly changes it.
9. Reuse current multiplayer architecture.
10. Reuse current AI architecture.
11. Reuse current settings/config patterns.
12. Reuse current test infrastructure.
13. Do not create duplicate abstractions.
14. Do not overengineer speculative future mechanics.
15. Do not broaden into unrelated cleanup.
16. Add regression coverage for real defects discovered.
17. Keep documentation synchronized with code.
18. Keep the normal developer loop fast.

---

# Testing strategy

For each phase, use the cheapest test layer that proves the required behavior.

Prefer:

```text
pure unit/domain tests
→ integration/state-machine tests
→ selected multiplayer tests
→ small number of browser/E2E tests
→ manual device checks only where automation is impractical
```

Do not create E2E tests for behavior that a deterministic domain test can prove.

Do not create dozens of combination tests when a table/property test can prove the invariant.

Important multiplayer timing behavior should be tested with real separate clients/contexts where the existing test infrastructure supports it.

Primary browser targets:

```text
Chrome
Firefox
Safari on iOS
```

---

# Verification rules

Follow `WORKFLOW.md`.

Run repository-native commands.

At minimum, after meaningful source changes, run the project equivalents of:

```bash
npm run test
npm run test:server
npm run lint
npm run build
```

Also run specialized tests relevant to the phase:

```text
multiplayer
AI
browser/e2e
reconnect/rematch
property/replay where applicable
```

Do not invent commands if the repository uses different names.

Record actual commands in the status/report.

---

# Documentation rules

At the end of every phase:

1. identify behavior changed
2. update canonical docs that describe that behavior
3. remove stale statements
4. ensure defaults/examples match code
5. ensure tests/docs agree
6. update the status file
7. continue

Do not postpone all documentation until the final phase.

---

# Failure handling

If a test fails:

```text
determine whether regression or stale expectation
→ fix root cause
→ rerun targeted test
→ rerun affected gate
→ continue
```

Do not weaken a valid test merely to make the phase pass.

If the test exposes a real product defect:

```text
reproduce
→ confirm contract
→ fix smallest root cause
→ add regression protection
→ continue
```

Do not hide defects using:

- exclusions
- fixture hacks
- silent fallback behavior
- timer clamping without contract
- client-only compensation
- skipped multiplayer assertions

---

# Git/worktree discipline

Inspect existing repository conventions before committing.

Do not discard unrelated user changes.

Do not reset or overwrite unrelated work.

Keep phase changes coherent.

If commits are part of the expected workflow, prefer one coherent commit per completed phase or tightly related phase group.

Do not create meaningless checkpoint commits.

---

# Scope guardrails

Allowed:

- shared timing architecture
- Speed Mode gameplay
- Blitz
- Time Attack
- Tempo
- listed modifiers/mechanics
- setup/presets
- narrow AI integration
- multiplayer timing integration
- focused QA
- documentation
- small refactors required to support the above

Not allowed unless a verified blocker requires it:

- full game rewrite
- multiplayer redesign
- unrelated protocol redesign
- broad AI redesign
- unrelated UI redesign
- general CI overhaul
- new analytics platform
- unrelated code cleanup
- speculative feature expansion

---

# Completion behavior

Continue until every phase in `SPEED_MODES_IMPLEMENTATION_PHASES.md` has one of:

```text
COMPLETE
DEFERRED with explicit justification permitted by the phase
BLOCKED by a genuine external blocker
```

Do not treat `PARTIAL` as final completion unless the phase specification explicitly permits partial delivery.

When all phases are handled:

1. run the final required verification suite
2. perform documentation synchronization audit
3. perform architecture duplication audit
4. perform timer authority audit
5. perform rematch/reconnect reset audit
6. update `SPEED_MODES_IMPLEMENTATION_STATUS.md`
7. produce the final report

---

# Final acceptance audit

Before finishing, explicitly verify:

```text
One shared timing architecture exists.

Blitz works.

Time Attack works.

Tempo core works.

Perfect Rhythm is native/invisible in Blitz and Time Attack.

Adrenaline is native/invisible in Blitz and Time Attack.

Panic Button is always individually disableable.

Last Breath is always individually disableable.

Presets are defaults, not forced restrictions.

Multiplayer authority owns competitive time.

Reconnect restores timing state correctly.

Rematch resets all timing resources.

AI understands relevant timing resources.

Commit is touch-safe if enabled.

Simultaneous Start is deterministic if enabled.

Tempo Sync is enabled only if simultaneous resolution is proven robust.

Docs match code.

Tests match behavior.
```

---

# Final report

Use the reporting format required by `AGENTS.md`.

At minimum include:

```text
PASS | PARTIAL | BLOCKED

Phases:
- phase number/name
- status

Changed:
- architecture
- Blitz
- Time Attack
- Tempo
- modifiers
- AI
- multiplayer
- tests
- docs

Architecture:
- timing authority
- timing state model
- client display model
- reconnect model
- ruleset model

Verified:
- exact commands run

Browsers:
- Chrome
- Firefox
- Safari/iOS

Defects fixed:
- issue
- root cause
- regression protection

Deferred:
- explicit experimental/balancing items only

Blocked:
- genuine blockers only

Remaining risk:
- concrete non-blocking risks only
```

# Definition of Done

The controller is done only when:

```text
the phase file has been fully processed
+
all required phases are complete or explicitly allowed to defer
+
final verification passes
+
documentation matches implementation
+
no user interaction was required for ordinary phase progression
```

Once complete, stop.

Do not continue into unrelated architecture, multiplayer, AI, CI, or gameplay work.
