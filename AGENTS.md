# MEXEMEXE Engineering Rules

Permanent constraints for anyone — human or AI — changing this repository.
Canonical detail lives elsewhere; this file only says what must always hold.

| Concept | Canonical source |
|---|---|
| Gameplay rules | `docs/GAME_RULES.md` |
| Module map, layering, invariants | `docs/ARCHITECTURE.md` |
| Setup, scripts, troubleshooting | `docs/DEVELOPMENT.md` |
| Test suites and gates | `docs/TESTING.md` |
| Online protocol and authority | `docs/MULTIPLAYER.md` |
| Scripts, deps, version | `package.json` |

Do not restate those documents here or in code comments. Link instead.

## Priority

correctness → no regressions → player-experience intent → verification →
readability → minimal code → token efficiency → speed.

## Invariants

- `src/rules` is the only authority on gameplay legality. It stays pure and
  deterministic: no Phaser, no DOM, no `Date`, no `Math.random`. Randomness
  flows through the seeded rng in `src/core/rng.ts`.
- The Phaser layer renders state and emits intents. It never decides legality.
- Online state is server-authoritative. The client never trusts hidden state and
  never re-implements a rule the shared module already owns.
- Protocol changes land on both sides (`src/net/protocol.ts` + `server/`) in the
  same change, and are validated at the wire boundary.
- Every mutable value has one owner. Derived values are recomputed, not cached
  into a second copy that can go stale.
- Phaser reuses one scene instance across `scene.start`. Scene state that must
  not survive a restart is reset in `create()`, never in a field initializer.

## Changing code

- Read the existing implementation and its call sites before adding anything.
  Search for the helper that already exists before writing a new one.
- Prefer deletion over addition, and direct code over indirection. Every new
  abstraction must remove more complexity than it introduces.
- Do not add a class, manager, service, factory, wrapper, event or config layer
  without a concrete problem in the current repository that it removes.
- Do not invent requirements or build for hypothetical futures.
- Do not add a dependency for something the project or the standard library
  already does.
- Change gameplay only when explicitly asked or when fixing a verified bug.
  Strange-looking behavior is not a bug without evidence.
- Comments explain why, constraints and quirks — never what the code plainly
  says.

## Errors

Never swallow a failure. Classify it: expected/recoverable, malformed external
input, transient infrastructure, or a violated internal invariant. Validate at
trust boundaries (network, save files, storage, URL params) and stop
re-validating once inside. Fail loudly on a broken invariant rather than
falling back to an invented default.

## Tests and verification

- Tests protect behavior, not implementation shape. Do not weaken or rewrite a
  test to accommodate a change in behavior.
- Every confirmed bug gets a regression test that fails before the fix.
- No test ships unrun, and no gate is reported that was not executed.
- Visual changes need runtime/screenshot evidence; compiling is not enough.
- `npm run verify` (tests + lint + screenshots + gate check) must pass before a
  change is considered done. `npx vitest run` and `npm run lint` are the fast
  loop.
- e2e runs against the prebuilt `dist/` via `vite preview`, so `npm run build`
  must precede any e2e run that should reflect a source edit.

## Accessibility

Any new interaction accounts for reduced motion, large text, non-color-only
signalling, touch target size, mobile no-hover behavior, and portrait/landscape
layouts. Reduced motion must preserve information, not remove it.

## Product guardrails

Improve presentation, pacing, clarity, accessibility and recovery before
touching core rules. Classic mode gets no random events, power-ups, currencies,
daily rewards or rule modifiers unless explicitly requested.
