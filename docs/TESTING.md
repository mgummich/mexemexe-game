# Testing and verification

Everything below is a script that exists in `package.json` today. Nothing here
is aspirational.

## Unit tests — `npm run test`

Vitest with V8 coverage, node environment (no browser). Anything that imports
Phaser cannot run here, which is why layout, snapping, tap-destination and
helper logic live as pure modules under `src/table` and `src/ui`.

- `tests/rules.test.ts` — the rules engine: decks, deals, runs, groups, joker
  assignment, the one-joker-per-meld limit, ace low/high and the no-wrap case,
  `canConfirmTurn`, win and draw-pile-exhaustion, serialization.
- `tests/draft.test.ts` — Mexe Mode editing, undo/redo/reset, card conservation.
- `tests/ai.test.ts` — legality, determinism, budgets, personalities.
- `tests/tutorial.test.ts` — all 12 steps, the per-step allow-list, completion.
- `tests/i18n.test.ts` — pt-BR and en-US key parity.
- `tests/layout.test.ts`, `snap.test.ts`, `zoom.test.ts`, `regions.test.ts`,
  `editor-layout.test.ts`, `menu-layout.test.ts`, `settings-layout.test.ts`,
  `viewport.test.ts`, `tap-destination.test.ts` — pure layout/interaction maths.
- `tests/persistence.test.ts`, `lifecycle.test.ts`, `error-recovery.test.ts`,
  `offline.test.ts`, `pwa.test.ts` — settings, sleep/resume, corrupt saves,
  connectivity, service-worker registration behaviour.
- `tests/playlog.test.ts`, `objective.test.ts`, `results-summary.test.ts`,
  `cosmetics.test.ts`, `audio.test.ts`, `music-playback.test.ts`,
  `helpers.test.ts`, `showcase.test.ts`, `probes.test.ts`, `motion.test.ts`,
  `config.test.ts`, `viewToState.test.ts`, `net/errors.test.ts`.
- `tests/soak.test.ts` — long-running game loop, used as a perf/stability soak.

`npm run test:watch` for the watch loop.

## Server tests — `npm run test:server`

`tests/server/` only: `rooms.test.ts` (room lifecycle, seat/ready/start, legal
and rejected turns, reconnect, sweep), `connections.test.ts` (socket registry,
flood guard, caps), `config.test.ts`, `log.test.ts` (redaction), and
`index.integration.test.ts`, which spawns the real server process and drives raw
`ws` clients — malformed and oversized frames, failed joins, connection caps,
seat ownership, hand privacy in a real frame, and a clean session writing
nothing to stderr.

These also run as part of `npm run test`.

## Lint — `npm run lint`

ESLint over `src tests e2e e2e-cross e2e-multiplayer e2e-pwa server`, then
`tsc --noEmit`.

## Browser suites (Playwright)

| Suite | Config | Command | Covers |
|---|---|---|---|
| Screenshots + perf | `playwright.config.ts` (`e2e/`) | `npm run screenshot` | Boots the built game, drives Mexe Mode through the debug API, captures `docs/screenshots/*.png`, records fps and console errors into `verify-log.json` |
| Cross-browser layout | `playwright.cross.config.ts` (`e2e-cross/`) | `npm run verify:cross` | Canvas fits, centres and keeps 16:9 on Chrome, Firefox, Safari, Pixel 7, iPhone 14 (both orientations) and iPad; rotation and mobile tap gameplay |
| Multiplayer | `playwright.multiplayer.config.ts` (`e2e-multiplayer/`) | `npm run verify:multiplayer` | Two-plus real clients against the real server: legal turns, illegal-proposal rejection, hand privacy, 3P/4P rotation, reconnect/resync |
| PWA / offline | `playwright.pwa.config.ts` (`e2e-pwa/`) | `npm run verify:pwa` | Service worker registers, offline reload boots to the menu, offline local/AI/tutorial play, online disabled offline, the update handover |

All four serve the production build via `npm run preview` — the service worker
only registers in a production build, and the screenshot suite must measure the
shipped bundle.

## Verification gates

| Gate | What it adds |
|---|---|
| `npm run verify` | `test` + `lint` + `screenshot` + `scripts/check-verify.mjs`: no console/page errors, every expected screenshot present, fps floors met. Also merges perf/test metrics into `STATUS.json`. |
| `npm run verify:multiplayer` | Build + the multiplayer suite + `scripts/check-verify-multiplayer.mjs`: no client console errors, no server stderr, no accepted illegal proposal, hand privacy held, state hashes agree. |
| `npm run verify:cross` | Build + the cross-browser layout suite. |
| `npm run verify:pwa` | Build + the offline/update suite. |
| `npm run verify:preview` | Build + `scripts/check-preview.mjs`: `dist/` serves, every asset reference resolves, no credential-shaped strings in the bundle. |

The release gate is `verify`, `verify:preview`, `verify:multiplayer` and
`verify:pwa`, all green, with zero console errors and zero server stderr lines.

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

The settings overlay also carries a **play-log export** (copies the in-memory
session log to the clipboard) used during playtests. The log is session-only,
never written to disk and never sent anywhere; names and reconnect tokens are
stripped from exports, and `?playlog=0` turns it off. See
[PLAYTEST_GUIDE.md](PLAYTEST_GUIDE.md).

## CI

`.github/workflows/ci.yml` runs on every push and PR, in parallel jobs: lint +
unit tests + build, multiplayer verification, PWA verification, the e2e
screenshot suite with its gate, and cross-browser layout. Failures upload
`test-results/` and the relevant log as artifacts.

`.github/workflows/nightly.yml` re-runs the flakier surfaces with tracing and
repeats (WebKit cross-browser, perf with `--repeat-each=5`, multiplayer).
`codeql.yml` scans the source; `pages.yml` deploys game + docs on `main`;
`release.yml` publishes a GitHub Release when a `vX.Y.Z` tag is pushed.

## Adding tests

- Rules or draft behaviour: a case in `tests/rules.test.ts` or
  `tests/draft.test.ts`. If it can be written as a pure function, it belongs in
  a unit test, not in Playwright.
- Layout or interaction maths: extract the decision into a pure module under
  `src/table` / `src/ui` (as `tap-destination.ts` was) and unit-test that —
  importing a Phaser scene in the node environment throws.
- Anything visual: add a `?showcase=` state in `src/demo/showcase.ts` and a
  capture in `e2e/screenshot.spec.ts`; the check script expects every declared
  screenshot to exist.
- Protocol or server behaviour: `tests/server/`, plus a flow in
  `e2e-multiplayer/` if two clients must observe each other.
- Offline or update behaviour: `e2e-pwa/`, which is the only place the real
  service worker lifecycle runs.
