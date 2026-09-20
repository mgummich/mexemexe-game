# MEXEMEXE! engineering rules

Permanent constraints for humans and AI working in this repo. Canonical detail
lives in the files below. **Do not duplicate those docs — here, in prompts, or
in code comments. Link to them instead.**

| Concern | Canonical source |
| --- | --- |
| Task routing, execution process, output modes | `WORKFLOW.md` |
| Gameplay rules | `docs/GAME_RULES.md` |
| Module map, layering, ownership | `docs/ARCHITECTURE.md` |
| Architecture risk register, audit evidence | `docs/ARCHITECTURE_AUDIT.md` |
| System invariants, canonical scenarios | `docs/INVARIANTS.md` |
| Setup, scripts, troubleshooting | `docs/DEVELOPMENT.md` |
| Tests and verification gates | `docs/TESTING.md` |
| Performance budgets and target devices | `docs/PERFORMANCE.md` |
| Security threats and trust boundaries | `docs/THREAT_MODEL.md` |
| Durable decisions and what was rejected | `docs/DECISIONS.md` |
| Online protocol and authority | `docs/MULTIPLAYER.md` |
| PWA / offline behaviour | `docs/PWA_OFFLINE.md` |
| Assets | `docs/ASSETS.md` |
| Visual quality, PixelLab | `docs/ART_DIRECTION.md` |
| Current roadmap | `docs/ROADMAP.md` |
| Active feature specs | `docs/specs/` (created on demand; none open) |
| Scripts, dependencies, version | `package.json` |

## Priority

correctness → safety/privacy → no regressions → player experience →
verification → readability → minimal code → token efficiency → speed

## Mandatory agent modes

These rules apply to **every agent, subagent, session and task**. They are
inherited automatically and must not be repeated inside every phase prompt.

### Caveman

**Caveman: be a caveman.** Meaning:

- choose the simplest path
- prefer obvious code over clever code
- prefer direct state/data flow over indirection
- reuse existing code before adding helpers
- delete unnecessary code before adding code
- keep one source of truth
- avoid speculative abstractions
- avoid architecture for hypothetical future needs
- make failures visible
- prove behaviour with the smallest evidence

Caveman is a simplicity constraint, not permission for sloppy work.
Correctness, security, privacy, determinism, accessibility and required
verification always win.

### Ponytail

**Ponytail: be the laziest senior engineer you know.** Ponytail optimizes for
the least work, least code, least context, least output and fewest validation
cycles that produce a maintainable, verified result.

#### Output discipline

- say only what is necessary
- no progress narration unless requested
- no repeated summaries
- no restating the prompt
- no long command output when a one-line result is enough
- subagents return evidence/findings only
- final reports use the repo completion format below

#### YAGNI ladder

Before writing code, climb this ladder from the top and stop at the **first
sufficient rung**:

```text
0. Do nothing — is the requested behavior already correct?
1. Delete/simplify — can removing stale code/config/docs solve it?
2. Reuse — can an existing function/component/type/path solve it?
3. Local edit — can one existing function/component be changed safely?
4. Small helper — is one narrowly scoped helper genuinely needed now?
5. Shared abstraction — are there at least two concrete current callers/problems?
6. New module/system — is ownership materially clearer and current scope requires it?
7. New dependency/framework — is existing code/platform demonstrably insufficient?
```

Rules:

- never start below the lowest sufficient rung
- "we will need it later" is not evidence
- do not generalize a one-off
- do not create extension points without a current consumer
- do not add options/settings without a current requirement
- prefer 20 obvious lines over a premature abstraction

#### Validation-cycle cap

The default budget is one targeted validation cycle during implementation plus
one required final domain gate — two cycles. A third is justified only when a
required gate failed or the fix changed the behaviour that gate covers. The
full policy, including what to do after two failed fix/validate attempts, is
`WORKFLOW.md` §7. The cap never permits skipping a required final gate.

### Output modes

`WORKFLOW.md` §1 is canonical for output modes. In short: agents use **AI
Mode** (`MEXE_OUTPUT=ai`) by default, so that successful operations produce
almost no context and failures reveal only what the next investigation step
needs. Use Human Mode for interactive developer workflows, and Debug Mode only
when AI/Human output is insufficient to diagnose a concrete failure.

### Precedence

When rules conflict:

```text
correctness / safety / privacy / determinism
→ explicit acceptance criteria
→ required verification
→ Caveman simplicity
→ Ponytail YAGNI + token/output efficiency
→ speed
```

## Non-negotiable invariants

- `src/rules` is the only gameplay-legality authority.
- Rules stay pure and deterministic: no Phaser, no DOM, no `Date`, no
  `Math.random`.
- Gameplay randomness flows through the seeded RNG.
- Phaser/UI renders state and emits intents; it never decides legality.
- Online state is server-authoritative.
- Clients never receive or infer hidden opponent hand identities.
- Protocol changes land on client and server together and are validated at the
  wire boundary.
- Every mutable value has one owner. Recompute derived values rather than
  maintaining stale copies.
- Scene state that must not survive a restart is reset in scene lifecycle code,
  never assumed from field initialization.
- Never weaken a test to make a behaviour change pass.
- Every confirmed bug gets a regression test.
- Visual changes require runtime evidence; compilation alone is not proof.

## Start every task

1. Run `git status --short`.
2. Classify the task with `WORKFLOW.md`.
3. Read **only** the canonical context listed for that task.
4. Search symbols/call sites before opening large files.
5. Establish acceptance criteria before editing.
6. Baseline the smallest test or screenshot.
7. Implement the smallest coherent change.
8. Run targeted verification while iterating.
9. Run only the required final gates from `WORKFLOW.md`.
10. Update canonical docs/specs only when behaviour or contracts changed.
11. Stop when the acceptance criteria pass.

## Context discipline

- Search first; read line ranges/symbols, not whole large files by default.
- Treat already summarized/read source as read unless exact new lines are needed.
- Do not ask multiple agents the same question.
- Do not spawn an agent for work cheaper than a grep/search.
- Batch nearby edits by ownership/domain.
- Do not re-run expensive browser suites after every small edit.
- Do not re-state stable project rules in phase prompts.
- Prefer one canonical source over duplicated documentation.

## Changing code

- Read the existing implementation and its call sites before adding anything.
- Search for an existing helper before creating one.
- Prefer deletion over addition, and direct code over indirection.
- Add an abstraction only when it removes concrete existing complexity.
- Do not invent requirements or design for hypothetical futures.
- Do not add a dependency for something already handled by the project or the
  platform.
- Change gameplay only when explicitly requested or when fixing a verified bug.
- Comments explain *why*, constraints and quirks — not what obvious code does.

## Errors and trust boundaries

Never swallow failures. Validate at trust boundaries:

- the network
- persisted saves/settings
- storage
- URL/deep-link input
- external files/data

Inside trusted code, fail on a violated invariant rather than silently
inventing fallback state.

## Tests

- Tests protect behaviour, not implementation shape.
- No test ships unrun.
- Never report a gate that was not executed.
- Use the smallest test during iteration.
- Build before Playwright/e2e when the suite runs against `dist/`.
- Use the Playwright CLI and the existing configs/projects; do not invent
  project names.
- Save screenshots/traces/logs as artifacts; summarize paths rather than
  pasting large output.

## Visual quality

Follow `docs/ART_DIRECTION.md`. The PixelLab.ai MCP is always the optional
production tool when original or adapted art materially improves readability,
polish, responsiveness or game feel.

All changed player-facing screens must remain sharp, crisp, readable and
intentionally composed on:

- desktop
- mobile portrait
- mobile landscape

## Accessibility

New interaction must account for:

- reduced motion
- large text
- non-color-only signaling
- touch target size
- no-hover mobile behaviour
- portrait and landscape layouts

Reduced motion must preserve information.

## Product guardrails

Improve presentation, clarity, pacing, accessibility, recovery and reliability
before changing the classic rules. Do not add random events, gameplay
power-ups, currencies, daily rewards or rule modifiers unless explicitly
requested.

## Completion

A task is done only when:

- the acceptance criteria pass
- the required verification ran
- no known regression is hidden
- docs/specs match the implementation where it changed
- visual evidence exists for visual claims
- remaining risk is stated concisely

Final report format:

```text
PASS | BLOCKED

Changed:
Verified:
Acceptance:
Artifacts:
Remaining risk:
Blocked:
```
