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
| `npm run test` / `test:watch` / `test:server` | Vitest — see [TESTING.md](TESTING.md) |
| `npm run lint` | ESLint + `tsc --noEmit` |
| `npm run screenshot` | Build + Playwright screenshot/perf suite |
| `npm run verify` / `verify:multiplayer` / `verify:multiplayer:chromium` / `verify:cross` / `verify:pwa` / `verify:preview` | Verification gates — see [TESTING.md](TESTING.md) |
| `npm run gen:cosmetics` | Regenerate procedural table/card-back/emote PNGs (deterministic) |
| `npm run gen:icons` | Regenerate the PWA manifest icons (deterministic) |
| `npm run release` | Version bump + CHANGELOG collapse + tag (see [CONTRIBUTING.md](CONTRIBUTING.md)) |

`node scripts/gen-sfx.mjs` regenerates the synthesized sound effects; there is
no npm alias for it.

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
