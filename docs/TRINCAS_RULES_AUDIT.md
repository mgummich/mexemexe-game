# Trincas rules audit

Audit run: 2026-09-09T08:25:11Z. Inspection model: GPT-5.6-Luna (Low substitute), with caveman skill available and invoked before inspection.

## Current behavior

- `src/rules/rules.ts:analyzeGroup` accepts groups with 3 or more cards, caps only by `config.maxGroupSize`, requires one natural and one natural rank, and conditionally checks suits only when `groupUniqueSuits` is true. Default config currently sets `groupUniqueSuits: false`, so repeated suits from different decks are accepted.
- Group jokers currently get `{ suit: null, rank }`; no unused-suit assignment or missing-suit capacity check exists. `analyzeGroup` rejects all-joker groups through `reason.jokerUnassignable`.
- `analyzeMeld` tries runs first, then groups. Its fallback selects group reasoning only when all naturals share rank; repeated-suit run cases therefore remain run failures unless they also look like groups. `analyzeRun` has no group-suit interaction beyond this dispatch.
- `isValidGroup`, `isValidMeld`, `validateTable`, and `getInvalidMeldReasons` all delegate to `analyzeMeld`/`analyzeGroup`. `validateTable` checks each meld independently and does not enforce duplicate ids across the whole table.
- `canConfirmTurn` uses `countIds` across draft melds and rejects duplicate ids in a confirmation, but this is draft-only. `applyConfirmedTurn` relies on `canConfirmTurn`.
- `src/rules/types.ts` exposes `RulesConfig.groupUniqueSuits` default false and `maxGroupSize` default 4. `MeldAnalysis` exposes only `kind` and joker assignments; no group rank/natural suits/joker count/reasons array.
- `server/rooms.ts:submitTurn` rehydrates cards by authoritative id and calls shared `canConfirmTurn`/`applyConfirmedTurn`; server/local validation share source of truth. Existing tests cover invalid/valid joker proposals and identity preservation, but not final Trinca suit/capacity rules.
- `src/ai/ai.ts:findHandMelds` generates rank buckets and a two-natural-plus-joker group, then gates candidates with `isValidMeld`. It can currently generate repeated-suit groups because validator permits them; it does not assign group joker suits itself.

## Affected files

- Rules/types: `src/rules/rules.ts`, `src/rules/types.ts`.
- Focused unit coverage: `tests/rules.test.ts`, with AI invariants in `tests/ai.test.ts`.
- Multiplayer authority and server tests: `server/rooms.ts`, `tests/server/rooms.test.ts`; protocol only carries card ids (`src/net/protocol.ts`).
- AI generation: `src/ai/ai.ts`.
- Player-facing rules: `docs/RULES.md`, `README.md`, and PT/EN `rules.body` strings in `src/localization/i18n.ts`. Current text says groups are 3+ and suits may repeat.
- Status tracking: `docs/STATUS.json` (Main must update; this audit intentionally does not touch it).

## Gaps and risks

1. Final defaults conflict with source of truth: groups must have unique natural suits, but default is false and the current implementation treats uniqueness as an optional house rule.
2. Group size must be exactly 3 or 4. Current config permits a custom larger max and does not define a minimum config field; existing tests explicitly accept a five-card group under `maxGroupSize: 6`.
3. Group joker assignments lack concrete suits. A pair plus two jokers can exceed missing suits; two jokers can collide with each other or natural suits under the final rules.
4. `validateTable` does not detect duplicate unique ids globally. Confirmation catches duplicates only in the draft path; table-level callers can receive a false positive.
5. Invalid reasons are coarse (`reason.notAMeld`/`reason.jokerUnassignable`), and analysis result lacks requested group metadata. Adding reason codes/types may affect localization and tests.
6. Server correctness follows shared validation, so changing the shared validator should align multiplayer automatically; server tests still need explicit repeated-suit/all-joker/over-capacity coverage.
7. AI candidate generation is validator-gated, but comments and rank buckets assume repeated-suit groups are legal. A validator change should be checked against AI tests and any direct group construction.
8. UI/help/docs contain conflicting old wording in both locales and README. `docs/RULES.md` also documents the old repeated-suit behavior and `groupUniqueSuits: false` hook.

## Minimal implementation plan

1. Main: change `DEFAULT_RULES` to `groupUniqueSuits: true`; enforce exact total size 3–4 for groups, one natural minimum, same natural rank, unique natural suits regardless of deck id, no all-joker group.
2. Main: implement deterministic group joker assignment to unused suits, reject joker count above missing suits, and preserve joker card ids. Extend analysis result/reasons only as far as existing architecture permits; keep run analysis behavior unchanged.
3. Main: enforce duplicate unique ids across all table melds and confirmation inputs at the shared validation boundary, with clear existing/new reason codes as needed. Ensure `validateTable`, `canConfirmTurn`, and server submission use same path.
4. Main: add focused rules tests for all supplied valid/invalid examples, including assignment collision and duplicate ids; add confirm/table tests and explicit server proposal rejection tests.
5. Main: run AI tests and patch only direct group generation if validator tests reveal an invalid candidate; ensure joker groups remain 3/4 cards and suit assignments are legal.
6. Main: update `docs/RULES.md`, README rules copy, and PT/EN help strings to state same rank, unique suits, jokers fill missing suits, no all-joker groups, and exactly 3 or 4 cards. Remove conflicting repeated-suit/optional-house-rule text.
7. Main: update `docs/STATUS.json` with active task, files/tests/issues, scripts absent/present, model routing, and caveman run record.

## Verification scripts

`package.json` provides `npm test`, `npm run lint`, `npm run build`, `npm run verify`, and `npm run verify:multiplayer`. No separate rules-specific script exists. `npm run verify:multiplayer` is available and should be run because server validation is in scope.

