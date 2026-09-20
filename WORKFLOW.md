# Development Workflow

**Canonical for:** task routing, context selection, model/subagent use, verification depth, output modes, and token-efficient implementation.

**Not canonical for:** gameplay rules, multiplayer behavior, or test implementation details. Use the linked canonical docs.

The goal is **maximum implementation quality with minimum unnecessary context and repeated work**.

---

## 0. Mandatory execution modes

Every session and every spawned agent automatically inherits the mandatory **Caveman** and **Ponytail** rules from `AGENTS.md`.

Do not repeat those rules in phase specs or prompts.

Operationally:

```text
Caveman  = simplest correct implementation
Ponytail = minimum work/code/context/output needed for a verified result
```

Before coding:

1. climb the YAGNI ladder in `AGENTS.md`
2. choose the first sufficient rung
3. set the smallest relevant validation plan
4. avoid speculative work

Default validation budget is one targeted cycle plus one required final domain gate. Extra cycles require an actual failure or behavior-changing fix.

---

## 1. Output modes

### AI Mode

Default for every agent and subagent.

Principle:

```text
success → almost no context
failure → only enough evidence for the next investigation step
```

Preferred success form:

```text
PASS test:rules 61/61 1.4s
PASS typecheck 3.2s
PASS build 4.6s
```

Preferred failure form:

```text
FAIL test:server

ON-07 reconnect reclaims seat
expected: seat=2
received: seat=3

server/room-session.ts:184
tests/server/reconnect.test.ts:92
log: tmp/agent-logs/test-server.log
```

Rules:

- do not print all passing tests
- do not print complete coverage tables unless coverage is the task
- do not print complete bundler output
- do not print complete Playwright output
- do not inline traces/screenshots
- do not paste full logs into context by default
- store verbose logs as files when possible
- inspect logs progressively and only as needed

### Human Mode

Default for a developer manually running commands.

Preferred output:

```text
MEXE! Verification

✓ Rules         61 tests   1.4s
✓ Multiplayer   31 tests   2.7s
✓ TypeScript               3.2s
✓ Build                     4.6s

All checks passed in 11.9s.
```

Human Mode may show slightly more context but should still avoid noise.

### Debug Mode

Use only when a concrete failure cannot be diagnosed from AI/Human output.

Debug Mode may expose:
- full stdout/stderr
- verbose reporters
- detailed network logs
- full stack traces
- Playwright trace/video details
- coverage tables

Exit Debug Mode as soon as the failure is understood.

### Environment convention

Prefer a single environment variable:

```bash
MEXE_OUTPUT=ai
MEXE_OUTPUT=human
MEXE_OUTPUT=debug
```

Agents should set/use `MEXE_OUTPUT=ai` when supported.

CI may use Human Mode while preserving full logs as artifacts.

---

## 2. Core loop

```text
git status
→ classify task
→ read minimal canonical context
→ search code
→ define acceptance
→ baseline
→ implement smallest coherent slice
→ targeted verification
→ required final gates
→ update canonical docs if needed
→ stop
```

Do not begin by reading the whole repository.

---

## 3. Task router

Read `AGENTS.md` first, then use this table.

| Task | Read next | Search/edit area | Fast loop | Final gate |
| --- | --- | --- | --- | --- |
| Rules / legality | `GAME_RULES.md`, relevant `ARCHITECTURE.md` section | `src/rules`, game-state/mexe call sites, matching tests | targeted Vitest | `npm run verify` |
| Game state / turn flow | `GAME_RULES.md`, `ARCHITECTURE.md` | game-state/core + matching tests | targeted Vitest | `npm run verify` |
| Mexe Mode | `GAME_RULES.md`, `ARCHITECTURE.md` | mexe/table/draft + tests | targeted Vitest | `npm run verify`; screenshot if UI changed |
| AI | rules + AI architecture section | `src/ai`, matching tests | targeted Vitest | `npm run verify` |
| UI / scenes / controls | `ARCHITECTURE.md`, `ART_DIRECTION.md` | relevant scene/UI/table files | targeted tests + one viewport | `npm run verify`; visual evidence |
| Mobile / responsive | `ART_DIRECTION.md`, relevant architecture | scene/UI/layout | focused layout tests + viewport | `npm run verify`; portrait + landscape evidence |
| Online / lobby / protocol | `MULTIPLAYER.md`, architecture network section | `src/net`, `server`, online UI, matching tests | net/server Vitest | `npm run verify:multiplayer`; `npm run verify` if shared client gameplay changed |
| PWA / offline | `PWA_OFFLINE.md` | PWA/core/public SW/manifest | focused PWA tests | `npm run verify:pwa`; build |
| Assets / art | `ASSETS.md`, `ART_DIRECTION.md` | referenced asset + loader only | build / focused runtime | screenshot evidence; relevant verify |
| Audio | architecture + relevant asset docs | audio manager/assets/settings | targeted test/build | relevant runtime evidence |
| Docs only | target canonical doc | docs only | `npx vitest run tests/docs-drift.test.ts` | that drift test plus `mkdocs build --strict` (CI's `Docs site builds` job, the one that runs for every change); no game e2e unless behaviour changed |
| Build / release / CI | `DEVELOPMENT.md`, `TESTING.md`, package/workflow | scripts/config/CI | targeted command | exact affected gate |
| Deployment / container / headers | `THREAT_MODEL.md`, `OPERATIONS.md` §Release channels | `nginx.conf`, `Dockerfile`, compose files, `.github/workflows` | `npx vitest run tests/deployment.test.ts`; YAML parse | `tests/deployment.test.ts` + CI's `server-image` job. The browser suites run against Vite preview and send no headers, so they cannot catch a CSP regression |
| Security | `THREAT_MODEL.md` | the boundary the threat names (wire, token, storage, logs) | the owning unit/server suite | the gate for that boundary, plus a new/updated row in `THREAT_MODEL.md` |
| Performance | `PERFORMANCE.md` | the owner of the budget in question | `npx playwright test e2e/perf-measure.spec.ts` (prints, gates nothing) | the three `@perf` fps tests; a changed budget needs a fresh measurement in the doc |
| Bug fix | canonical doc for affected domain | reproduce first | failing regression test | domain gate |
| Refactor | `ARCHITECTURE.md` | narrow ownership boundary | existing behavior tests | affected domain gate |

If a task spans multiple rows, union only the required context and gates.

---

## 4. Context budget

### Read in this order

1. `AGENTS.md`
2. task-specific canonical doc(s)
3. `git status --short`
4. grep/search for exact symbols
5. call sites / tests
6. exact implementation ranges

### Avoid

- reading all docs "just in case"
- full-file reads when a symbol/range is enough
- re-reading a file already summarized
- loading PWA/multiplayer/AI docs for unrelated UI work
- copying canonical rules into feature specs
- huge command logs in model context

### Escalate context only when

- an invariant is unclear
- a shared contract changes
- a failing test contradicts expected behavior
- a call path crosses an ownership boundary
- security/privacy or concurrency is involved

---

## 5. Acceptance-first development

Before editing, write 3–10 observable acceptance items.

Use stable IDs for feature specs:

```text
ON-01 create room
ON-02 join by code
ON-03 duplicate names remain distinct
```

Tests should reuse IDs when practical:

```ts
describe('ON-03 duplicate display names', () => { ... })
```

Do not track progress in long prose. Prefer:

```text
PASS: ON-01..ON-05
OPEN: ON-06
BLOCKED: none
```

---

## 6. Verification levels

### Level 1 — inner loop

Run the smallest check that can falsify the current change.

Examples:

```bash
MEXE_OUTPUT=ai npx vitest run tests/rules.test.ts
MEXE_OUTPUT=ai npx vitest run tests/server
MEXE_OUTPUT=ai npx vitest run tests/layout.test.ts
```

Use focused Playwright only when browser behavior is the thing being changed.

### Level 2 — domain check

Before considering implementation complete:

- relevant unit/integration tests
- TypeScript/lint where affected
- build when browser bundles/assets changed
- representative visual state when UI changed

### Level 3 — final gate

Use only gates required by the affected domain.

Current repository gates may include:

```bash
npm run verify
npm run verify:multiplayer
npm run verify:cross
npm run verify:pwa
npm run verify:preview
```

Do not run every gate for every task.

Do not claim a gate ran unless it did.

---

## 7. Validation-cycle cap

Default:

```text
cycle 1 = targeted implementation check
cycle 2 = required final domain gate
```

Do not rerun a passing command without a relevant change.

If a check fails:
- fix the evidenced cause
- rerun only the failed/relevant check

A third cycle is justified only when:
- a required final gate failed
- the fix changed the behavior the gate covers

After two failed fix/validate attempts on the same issue:
- stop brute-force patching
- investigate root cause
- escalate reasoning if the high-reasoning trigger applies

---

## 8. Playwright policy

Prefer Playwright CLI over MCP for normal verification.

Use existing config files/projects only.

Rules:

- build first when tests consume `dist/`
- never invent project names
- screenshots for visual claims
- trace/video primarily for failures or hard reproduction
- store artifacts as files
- AI output should summarize only failing spec, viewport, reason, and artifact path
- use MCP only if CLI cannot reproduce or inspect the problem

Example AI-mode success:

```text
PASS verify:mobile 12/12 28.4s
artifacts: artifacts/mobile/
```

Example failure:

```text
FAIL verify:mobile

MOB-08 lobby portrait
viewport: 390x844
reason: Ready button outside viewport
screenshot: artifacts/mobile/MOB-08-failure.png
trace: artifacts/mobile/MOB-08-trace.zip
```

---

## 9. Model routing

Use the smallest model capable of the work.

### Discovery model

Use for:
- grep/search
- locating symbols
- test discovery
- file inventories
- compact summaries

No implementation.

### Main coding model

Use for:
- code edits
- tests
- config
- docs
- commands
- integration
- final patch

### High-reasoning model

Use only when triggered by:
- conflicting rules/specs
- architecture boundary changes
- protocol/security design
- concurrency/race behavior
- nondeterminism
- same meaningful failure after one serious main-model fix
- unresolved high-risk final review

High-reasoning output is prose only:

```text
decision
reason
patch plan
risks
acceptance criteria
```

Main coding model implements it.

---

## 10. Subagent policy

Default:

```text
small task  → one main agent
medium task → one cheap investigator + one main implementer
high-risk   → investigator + main + high reviewer only if triggered
```

Parallelize only independent ownership.

Good:

```text
A: server/session audit
B: lobby UI audit
Integrator: protocol/shared state
```

Bad:

```text
A/B/C: all investigate the same multiplayer bug
```

For multi-agent work, assign file/domain ownership before implementation.

Shared contracts have one integrator owner.

Subagents return compact evidence summaries only.

---

## 11. Investigate → contract → implement

For features touching multiple owners:

```text
cheap investigation
→ evidence summary
→ integrator defines minimal shared contract
→ independent implementation
→ integration
→ verification
```

Do not let multiple builders invent competing protocol/state shapes.

---

## 12. Command-output discipline

Successful commands should be summarized as:

```text
PASS <command/check> <useful-count> <duration>
```

For failures retain only:
- failing test/acceptance IDs
- expected vs actual when useful
- first relevant stack/error
- relevant file:line
- artifact/log path
- narrow rerun command if useful

Avoid pasting:
- every passing test
- full coverage tables
- entire Playwright logs
- repeated npm install/build noise
- full TypeScript context unless needed
- complete bundle manifests

Verbose output should be saved to `tmp/agent-logs/` or an equivalent ignored directory when possible.

---

## 13. Suggested command wrapper

**Not built.** `scripts/run-check.mjs` does not exist today; agents pipe verbose
output to `tmp/agent-logs/` by hand (§12). This section is the shape to build if
the manual step ever becomes worth automating.

Prefer one wrapper rather than custom quiet-mode logic in every tool.

Suggested interface:

```bash
node scripts/run-check.mjs unit -- npm run test
node scripts/run-check.mjs build -- npm run build
```

Responsibilities:

- inherit `MEXE_OUTPUT`
- capture stdout/stderr
- measure duration
- preserve command exit code
- save verbose output to log file
- print compact AI/Human summary
- print log path on failure
- never hide actual failures

Keep the wrapper simple; do not build a logging framework.

---

## 14. Spec lifecycle

Large features live in `docs/specs/`. The directory is created on demand and is
empty today — no spec is open.

A phase spec is a plain Markdown file; there is no template file to copy.

A phase spec should contain feature-specific facts only:
- goal
- scope/exclusions
- success criteria
- contracts/invariants
- edge/failure cases
- fixtures/acceptance IDs
- waves
- final gate

Do **not** repeat:
- global model routing
- Caveman/Ponytail
- full game rules
- general Playwright policy
- output-mode policy
- permanent visual standards

Those belong in canonical docs.

When complete:
- update canonical docs with final implemented behavior
- archive/delete the completed spec according to project policy
- do not allow old specs to become a second source of truth

---

## 15. Documentation rule

Implementation is authoritative only when canonical docs agree with it.

Update docs in the same change when modifying:
- gameplay rules
- protocol behavior
- architecture/ownership
- setup/scripts
- PWA guarantees
- asset conventions
- permanent visual standards

Do not update docs for implementation details that do not change public contracts or developer guidance.

---

## 16. Visual work

Follow `docs/ART_DIRECTION.md`.

Visual loop:

```text
baseline screenshot
→ identify concrete defect
→ smallest coherent visual change
→ same viewport/state screenshot
→ compare
→ fix critical failures
```

PixelLab MCP may be used whenever new/adapted original art materially improves quality.

Do not create new art simply because the tool exists.

---

## 17. Stop conditions

Stop when:
- acceptance criteria pass
- required gates pass or verified blockers are documented
- canonical docs match changed behavior
- visual evidence supports visual claims
- no P0/P1 regression remains in touched scope

Do not continue polishing unrelated areas.

---

## 18. Final report

Return only:

```text
PASS | BLOCKED

Changed:
Verified:
Acceptance:
Artifacts:
Remaining risk:
Blocked:
```

Keep it factual and short.
