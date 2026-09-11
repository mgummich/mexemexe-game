# Contributing to MEXEMEXE!

Thanks for your interest in contributing! This project welcomes bug reports,
feature ideas and pull requests.

## Getting started

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

Setup, scripts, URL parameters and troubleshooting: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Before opening a pull request

Run the full gate locally:

```bash
npm run verify
```

That is unit tests, lint, a production build, the Playwright screenshot suite
and its console/asset/fps gate. If you touched online play, mobile layout or
offline behaviour, also run the matching `verify:multiplayer`, `verify:cross`
or `verify:pwa`. What each suite covers: [`docs/TESTING.md`](docs/TESTING.md).

Playwright needs its browsers once: `npx playwright install chromium firefox webkit`.

### Pre-push hook

`.githooks/pre-push` runs `npm run lint` and `npm run test` (about five seconds
together). The Playwright suites are left to CI so pushing stays fast. Enable it
once per clone:

```bash
git config core.hooksPath .githooks
```

## Project conventions

- `src/rules` is a **pure** rules engine — no Phaser imports, fully unit-tested.
  It is the only place legality is decided, and the server calls the same
  functions.
- `src/mexe-mode` holds the draft editor (undo/redo/reset). Meld ids are
  namespaced per turn; never reuse ids across turns.
- Phaser scenes only render state and forward intents.
- New game logic needs unit tests in `tests/`; user-visible behavior should be
  reachable from the `?showcase=` URL params so the screenshot suite can cover it.
- Keep the docs current with the change: rules → `docs/GAME_RULES.md`, protocol
  → `docs/MULTIPLAYER.md`, assets → `docs/ASSETS.md`.

The table at the end of [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) says
where each kind of change belongs.

## Releases

Every user-visible change lands under a `## Unreleased — <title>` heading at the
top of `CHANGELOG.md`; several may stack up between releases. Cutting a release
collapses them into one version:

```
npm run release minor          # or patch / major / an explicit 1.7.0
git push origin main --follow-tags
```

`scripts/release.mjs` bumps `package.json`, rewrites those `Unreleased` headings
into a single `## X.Y.Z — <date>` section (each keeps its title as an `###`
subhead), commits and creates an annotated `vX.Y.Z` tag. Nothing is pushed until
you push it.

Pushing the tag runs `.github/workflows/release.yml`, which re-runs lint, tests
and the build, checks the tag matches `package.json`, and publishes a GitHub
Release. Its body is rendered from that CHANGELOG section by
`node scripts/release.mjs --notes X.Y.Z`: a stat line, play/docs links, the
bullets regrouped into Fixed / Added / Changed / Docs with the phase each came
from, then the verbatim section folded into a `<details>` block and a compare
link. That grouping reads the `- **Fixed: what broke.** why` bullet convention,
so keep writing them that way — anything unrecognized still shows up, under
"Also". `--raw-notes X.Y.Z` prints the section unrendered. So the version lives in
exactly one place: `package.json`'s version feeds the git tag, the release notes
and — via `vite.config.ts` — the service worker's cache key, which is what makes
a deploy reach players who already have the game cached.

`node scripts/release.mjs --selfcheck` covers the bump and CHANGELOG rewriting.

## Art & audio

All art is generated with PixelLab (`docs/ASSETS.md` has the full
prompt/path table). Replacements just need the same path and size under
`public/assets/` — missing files fall back to procedural placeholders, never a
crash. SFX are synthesized by `node scripts/gen-sfx.mjs`.

## Reporting bugs

Open a GitHub issue with: what you did, what you expected, what happened, and
the `?seed=` value if the deal matters (deals are deterministic per seed).
