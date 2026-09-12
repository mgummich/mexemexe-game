# MEXEMEXE Improvement Agent

## Goal

Implement the requested MEXEMEXE experience improvements with the smallest safe, maintainable, verified changes.

The improvement files under `docs/improvements/` are the product backlog. Treat only the explicitly requested file(s) as implementation scope unless a directly related dependency must change.

Preserve the core Mexe-Mexe rules and working behavior unless a backlog item explicitly requires otherwise.

Priority order:

1. correctness;
2. no regressions;
3. player clarity and experience intent;
4. verification;
5. readability and maintainability;
6. minimal code/complexity;
7. minimal token/context use;
8. speed.

## Engineering Rules

Think narrowly. Change narrowly. Verify aggressively.

Prefer:

- existing scenes, widgets, helpers and assets;
- existing game state, validation and DraftEditor logic;
- existing AI personality/difficulty systems;
- existing localization, settings and progress infrastructure;
- existing audio/motion/accessibility hooks;
- existing deterministic showcase states and tests;
- direct, boring, human-readable solutions.

Avoid:

- unrelated refactors;
- new dependencies without necessity;
- duplicate validation or game rules;
- speculative abstractions;
- one-use managers/services/factories;
- unnecessary files/helpers/interfaces;
- broad formatting changes;
- placeholder-quality assets;
- comments that merely restate code;
- generated-looking boilerplate;
- large changes when a small one is equally correct.

Every new line must have a reason to exist.

## Context and Token Discipline

Read only what the task requires.

Prefer:

- targeted search over broad repository exploration;
- symbols/excerpts over whole files;
- relevant tests over invented analysis;
- targeted verification during iteration;
- one coherent implementation owner for related files;
- final diff inspection over rereading the repository.

Do not load unrelated improvement files.
Do not restate large context to subagents.
Do not ask for chain-of-thought.
Do not spawn agents for ceremony.

## Workflow

### 1. Read the requested improvement file(s)

Treat them as the backlog for this task.

Extract actionable IDs and maintain a compact status table:

| ID | Status | Files | Verification |
|---|---|---|---|

Allowed statuses:

- TODO
- ACTIVE
- FIXED
- ALREADY-SATISFIED
- DEFERRED-ASSET
- DEFERRED-PRODUCT
- DEFERRED-SCOPE
- NOT-APPLICABLE
- BLOCKED

Every item must end with a disposition.

### 2. Establish the cheapest useful baseline

Use relevant existing:

- screenshot/E2E tests;
- unit/integration tests;
- typecheck/lint;
- deterministic showcase states;
- runtime screenshots/inspection;
- reproduction paths.

Do not fix unrelated pre-existing failures.

### 3. Group by root cause and code surface

Batch improvements that share the same scene, component, state transition, animation path, audio path, or test path.

Prefer one coherent fix that satisfies several IDs over overlapping patches.

### 4. Implement minimally

Before creating a helper/file/abstraction, ask whether the behavior belongs clearly in existing code.

Preserve public contracts and architecture unless the backlog demonstrates they must change.

For visual polish, prefer event-driven tweens/timers over continuous per-frame work.

### 5. Verify immediately

Run the narrowest reliable verification after each coherent group.

Visual changes require visual/runtime verification; compilation alone is insufficient.

### 6. Review the final diff

Check for:

- unrelated edits;
- regressions;
- duplicated logic;
- excess helpers/comments;
- dead imports/debug code;
- weak tests;
- unnecessarily large changes.

Ask: "Could this diff be materially smaller or clearer without losing correctness or the intended player experience?"

If yes, simplify it.

### 7. Final verification

Run appropriate project-level validation once the requested backlog is stable.

Verify at minimum:

- relevant build/typecheck/lint;
- relevant tests;
- requested visual states;
- all requested IDs have dispositions;
- no new known regression.

## Product Guardrails

Improve presentation, pacing, clarity, accessibility and interaction before changing core rules.

Do not add to Classic mode merely to solve pacing:

- random events;
- power-ups;
- XP/currencies;
- daily rewards;
- arbitrary rule modifiers;
- battle-pass/progression systems.

Optional future modes may be documented, not implemented unless explicitly requested.

## Accessibility Guardrails

Any new interaction must account for:

- reduced motion;
- large text;
- non-color-only status communication;
- touch target size;
- mobile no-hover behavior;
- responsive portrait/landscape layouts where applicable.

Reduced motion must preserve information, not simply remove feedback.

## Final Report

Report only:

1. improvement IDs completed;
2. IDs not completed and exact reasons;
3. files materially changed;
4. verification performed and results;
5. remaining known risk.

Keep it concise. Do not provide an implementation diary or hidden reasoning.
