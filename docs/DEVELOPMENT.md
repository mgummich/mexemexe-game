# Development

## Prerequisites

- Node 22+ (CI runs 22) and npm.
- Playwright browsers, once per clone, if you want to run the e2e suites:
  `npx playwright install chromium firefox webkit`.

## Install and run

```bash
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # tsc --noEmit + vite build into dist/
npm run preview    # serve the build on :4173 (strict port)
```

Local play needs nothing else — no server, no network.

### The online server

```bash
npm run server                       # tsx server/index.ts on :8787
PORT=9000 npm run server             # different port
MEXE_ENV=production npm run server   # production checks on
```

Or both together: `docker compose up -d --build` (game on :8080, server on
:8787). Deployment shapes live in [SELF_HOSTING.md](SELF_HOSTING.md); the full
environment-variable reference, log format and health check live in
[OPERATIONS.md](OPERATIONS.md).

## URL parameters

| Param | Effect |
|---|---|
| `?seed=123` | Deterministic deal and AI decisions |
| `?lang=en\|pt` | Locale override (pt-BR is the default) |
| `?ws=wss://host` | Point the client at a specific WebSocket server |
| `?showcase=menu\|game\|game4\|mexe\|setup\|settings\|win` | Jump straight to a scene/state |
| `?ai=cida\|juninho\|bia\|ze` | Force the opponent personality in a 2-player showcase |
| `?playlog=0` | Disable the in-memory session play log |
| `?helper=beginner\|standard\|expert` | Force the helper mode before the scene loads |
| `?textscale=125` | Turn the large-text setting on |
| `?motion=0` | Turn reduced motion on |
| `?crowd=N` | Drive the showcase state on until the table holds ≥ `N` cards (stress captures) |
| `?room=CODE` | Invite link: join that online room on entry (see [MULTIPLAYER.md](MULTIPLAYER.md)) |

Everything above except `?lang=` and `?room=` exists for the screenshot suite
and for reproducing bugs — they are developer tools, not game features. The
settings-flipping ones (`helper`, `textscale`, `motion`) write the real setting,
so a capture does not have to click through the settings panel.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check then production build |
| `npm run preview` | Serve `dist/` on :4173 |
| `npm run server` | WebSocket server for online rooms |
| `npm run replay run <file>` / `record <seed>` | Reproduce or capture a deterministic match — see below |
| `npm run test` / `test:watch` / `test:server` | Vitest — see [TESTING.md](TESTING.md) |
| `npm run test:property` / `test:replay` / `test:mutation` | Extended fuzz budget, the golden replays alone, mutation testing — see [TESTING.md](TESTING.md) |
| `npm run lint` | ESLint + `tsc --noEmit` |
| `npm run screenshot` | Build + Playwright screenshot/perf suite |
| `npm run verify` / `verify:multiplayer` / `verify:multiplayer:chromium` / `verify:cross` / `verify:pwa` / `verify:preview` | Verification gates — see [TESTING.md](TESTING.md) |
| `npm run gen:cosmetics` | Regenerate procedural table/card-back/emote PNGs (deterministic) |
| `npm run gen:icons` | Regenerate the PWA manifest icons (deterministic) |
| `npm run health` | Roadmap and risk health, derived — see below |
| `npm run release` | Version bump + CHANGELOG collapse + tag (see [CONTRIBUTING.md](CONTRIBUTING.md)) |

`node scripts/gen-sfx.mjs` regenerates the synthesized sound effects; there is
no npm alias for it.

## Repository health

```bash
npm run health
```

Derives the state of the roadmap from `docs/ROADMAP_STATUS.json` — the current
phase, how phases closed, anything `BLOCKED`, and the two risk lists that matter:
risks deferred to a phase that has **already passed** (the actionable ones, since
nobody is coming back for them by accident) and risks waiting on a phase still
ahead.

It prints no score. One number would hide which area is failing, which is the
only thing worth knowing. And it restates nothing: every other signal is a
command or a document that owns it, listed at the end of the output — CI and
nightly for gate status, `tests/boundaries.test.ts` for architecture,
`tests/docs-drift.test.ts` for documentation, `tests/deployment.test.ts` for
shipped config, [THREAT_MODEL.md](THREAT_MODEL.md) for anything not yet mitigated,
[PERFORMANCE.md](PERFORMANCE.md) for budgets, and
[ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) §11 for structural debt.

## Dependencies and bundle cost

Three runtime dependencies. Each one is here for a reason that can be stated in
a sentence, and the cost of each is measured rather than assumed
([PERFORMANCE.md](PERFORMANCE.md)):

| Dependency | Why | Cost | What would replace it |
|---|---|---|---|
| `phaser` | the game renders a canvas scene graph with input, tweens, audio and asset loading; all of it is used | 347 kB gzip — 80 % of the shipped JS | nothing realistic: this *is* the presentation layer |
| `ws` | the room server needs a WebSocket implementation; Node has none for servers | server-side only, never shipped to a browser | Node's built-in server WebSocket, if it ever stabilises |
| `tsx` | runs `server/index.ts` directly, so the server ships as the TypeScript it is reviewed as | server image only: `tsx` + `esbuild` and its platform binary | a compile step in the Dockerfile's server stage and plain `node` — see the note below |

Everything else is dev tooling (10 direct packages: Vite, Vitest, Playwright,
ESLint, TypeScript, Stryker, and their types). The lockfile has 391 entries, 358
of them dev-only; of the 33 that are not, most are `esbuild`'s per-platform
binaries, and exactly one is a transitive library (`eventemitter3`, via Phaser).
Ten packages exist at two versions in the lockfile — all of them dev-only
transitives (Babel, ESLint, ajv) that never reach the bundle or the server image.

**`tsx` in production is a deliberate trade.** Running TypeScript directly keeps
the deployed server identical to the reviewed source, with no build artefact to
drift, and the server image is not player-facing. The cost is a transpiler and
`esbuild` inside the runtime image. Revisit if any of these becomes true: the
server image is exposed to untrusted input beyond the WebSocket boundary, startup
time starts to matter, or `tsx`/`esbuild` acquires an advisory that has no patch.
It is a one-stage Dockerfile change plus `OPERATIONS.md`, not an architecture
change.

### Rules

- **A new runtime dependency needs a sentence in the table above.** If the
  sentence is "it would be convenient", the answer is no — see the YAGNI ladder
  in `AGENTS.md` (rung 7 is the last rung, not the first).
- **A dev dependency still costs.** It runs in CI, on every contributor's
  machine, and in the supply chain that produces the build.
- **The lockfile is committed and CI installs with `npm ci`.** Every job, every
  workflow: a resolved tree is part of what is being tested.
- **Advisories are checked nightly**, not per PR (`.github/workflows/nightly.yml`,
  `dependency-audit`): runtime dependencies at `--audit-level=moderate`, dev
  tooling at `high`, and `npm outdated` reported without failing. A gate that
  fails for reasons unrelated to the diff in front of a reviewer gets ignored.
- **Updates land as their own change**, with the gates the dependency affects —
  a Vite bump runs the build and the browser suites, a Vitest bump runs the unit
  suites. Majors are never bundled with feature work. Dependabot opens them
  weekly, grouped into one production and one development pull request and capped
  at three open at a time (`.github/dependabot.yml`), which is what keeps this
  rule from turning into a backlog.
- **Duplicates are only a problem where they ship.** Dev-only duplicate versions
  are npm doing its job; a duplicate inside `dist/` or the server image is a
  defect.

## Reproducing a bug from a replay

A replay is seed + ordered actions (`src/game-state/replay.ts`). It runs in
Node, without Phaser, the DOM or a server, so a reproduction is a file and a
command rather than a sequence of clicks.

**Capture from a session** — in the browser console, or from Playwright:

```js
copy(JSON.stringify(window.__MEXE__.replay()))   // null online, by design
```

**Capture without a browser** — play a deterministic AI match:

```bash
npm run replay record 12345 tmp/bug.json          # full match
npm run replay record 12345 tmp/bug.json 60 bia,ze  # 60 actions, rearranging AI
```

**Run one:**

```bash
npm run replay run tmp/bug.json
PASS replay tmp/bug.json actions=148 turn=148 phase=finished winner=p0 hash=9615062c
```

A failure names the action index and the reasons the rules refused it:

```text
FAIL replay tmp/bug.json

corruptReplay
corrupt replay: action 31 (confirmTurn) refused: reason.runGap
```

The hash is a digest of the full final state; a `finalHash` recorded with the
replay is checked on every run, so a rules change that moves the outcome fails
as `replayDiverged` rather than silently producing a different match. The five
committed examples in `tests/fixtures/replays/` are the golden corpus, replayed
by `tests/replay.test.ts` on every `npm run test`; they are behaviour
expectations, not samples, so regenerating one is a reviewed act —
[TESTING.md](TESTING.md#golden-update-policy).

Attach the replay JSON to a bug report. It carries no names or tokens — seats
are `p0`/`p1` and cards are ids — but it does reveal the whole deal, which is
why online matches have no client-side replay (see
[ARCHITECTURE.md](ARCHITECTURE.md#replay-and-reproduction)).

## Typical loop

1. `npm run dev`, work against :5173.
2. New game logic gets unit tests in `tests/`; new player-visible behaviour
   should be reachable from a `?showcase=` state so the screenshot suite can
   cover it.
3. `npm run lint && npm run test` before pushing (`.githooks/pre-push` does
   this for you — enable with `git config core.hooksPath .githooks`).
4. `npm run verify` before opening a PR.

Where a given change belongs — rules, UI, AI, protocol, assets, settings — is
tabulated at the end of [ARCHITECTURE.md](ARCHITECTURE.md), along with the
principles that keep client and server from drifting apart.

## The documentation site

These pages are built with [MkDocs](https://www.mkdocs.org/) and a theme kept in
`theme/`. GitHub Pages serves the game at the site root and the docs under
`/docs`, both from `.github/workflows/pages.yml`.

```bash
python3 -m venv .venv
.venv/bin/pip install -r docs/requirements.txt
.venv/bin/mkdocs serve            # live reload on :8000
.venv/bin/mkdocs build --strict   # what CI runs; fails on any broken link
```

Add a new page under `docs/` and list it in the `nav:` block of `mkdocs.yml` —
`--strict` fails the build if a page is missing from the navigation or a link
points at a file that does not exist. `docs/CHANGELOG.md` and
`docs/CONTRIBUTING.md` are symlinks to the repository root, so those two files
stay in one place.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| e2e tests pass on an old build | A stale `vite preview` is already on :4173; Playwright reuses it. Kill it and re-run. |
| Online play fails over HTTPS | A page on `https://` cannot open `ws://`. The default falls back to `wss://<host>/ws`; see [SELF_HOSTING.md](SELF_HOSTING.md). |
| Service worker not registering in dev | By design — it only registers in a production build (`src/core/pwa.ts`). Use `npm run preview`. |
| Art is flat-colored placeholders | The asset file is missing; `BootScene` fell back procedurally. Check `window.__MEXE__.missingAssets` and [ASSETS.md](ASSETS.md). |
| Server refuses to start | Invalid env value — it names the variable and exits rather than silently defaulting. See [OPERATIONS.md](OPERATIONS.md). |
| A deal is not reproducible | Pass `?seed=`. Without it the seed comes from the clock; it is recorded in state and in the play log. |
| The docs build fails in CI but not locally | `mkdocs build --strict` treats warnings as errors. Run it with `--strict` locally too. |
| `tests/server` times out on the two baseline tests (`OH-34/OH-35`, the session soak) | A leftover `tsx server/index.ts` is holding :8787 — often from running the server by hand, since `npx` children outlive the shell wrapper. `ps aux \| grep "tsx server/index.ts"`, kill it, re-run. The failure looks like starvation, not a port conflict, which is why it reads as a regression in whatever you were changing. |
| An `@perf` fps floor fails locally | Something else is using the machine — most often a second Playwright suite. The floors assume an idle machine and already take the best of three windows; the failure prints all three, and interference moves one while a real regression moves all ([TESTING.md](TESTING.md) §Flake policy). |
| `git status` is full of modified PNGs after a verify run | Expected: the screenshot suite writes into `docs/screenshots/`. Consecutive runs are byte-identical, so this is staleness in the committed set, not a visual change. Revert them unless you meant to refresh. |
