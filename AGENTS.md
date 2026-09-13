# MEXEMEXE Engineering Rules

## Goal

Implement requested MEXEMEXE improvements with the smallest safe, maintainable, verified changes.

The improvement files under `docs/improvements/` are the product backlog. Preserve the core game rules and working behavior unless a backlog item explicitly requires otherwise.

Priority: correctness → no regressions → player experience intent → verification → readability/maintainability → minimal code/complexity → token efficiency → speed.

## Engineering Rules

Think narrowly. Change narrowly. Verify aggressively.

Prefer existing scenes, widgets, helpers, assets, game state, validation, DraftEditor logic, AI systems, localization, settings/progress, audio/motion/accessibility hooks, deterministic showcases, and tests.

Avoid unrelated refactors, speculative abstractions, duplicate validation/rules, unnecessary files/helpers/services/managers/interfaces, broad formatting changes, placeholder-quality assets, redundant comments, generated-looking boilerplate, and new dependencies without necessity.

Every new line must have a reason to exist. Prefer the smallest clear solution.

## Context and Token Discipline

Prefer targeted search over broad exploration, symbols/excerpts over whole files, targeted tests over full suites during iteration, and diff review over rereading changed files. Do not load unrelated improvement files. Do not request chain-of-thought.

## Workflow

1. Read only the active improvement file(s).
2. Establish the cheapest useful baseline.
3. Group IDs by root cause/code surface.
4. Implement minimally.
5. Verify immediately.
6. Review the diff and simplify.
7. Run final relevant verification.

Visual changes require runtime/screenshot verification; compilation alone is insufficient.

## Product Guardrails

Improve presentation, pacing, clarity, accessibility, recovery and interaction before changing core rules. Do not add random events, power-ups, XP/currencies, daily rewards, battle-pass systems, or arbitrary rule modifiers to Classic mode unless explicitly requested.

## Accessibility Guardrails

Any new interaction must account for reduced motion, large text, non-color-only communication, touch targets, mobile no-hover behavior, and responsive portrait/landscape layouts where applicable. Reduced motion must preserve information.

## Final Report

Report only: completed IDs; incomplete IDs and reasons; materially changed files; verification/results; remaining known risk. Keep it concise.
