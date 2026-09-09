# Contributing to MEXEMEXE!

Thanks for your interest in contributing! This project welcomes bug reports,
feature ideas and pull requests.

## Getting started

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

## Before opening a pull request

Run the full verification suite locally:

```bash
npm run verify
```

This runs, in order:

1. `npm run test` — Vitest unit tests (rules engine, Mexe Mode editor, AI, perf soak)
2. `npm run lint` — ESLint + `tsc --noEmit`
3. `npm run screenshot` — production build + Playwright e2e (drives the game
   via the `window.__MEXE__` debug API and captures screenshots)
4. `scripts/check-verify.mjs` — gates on console errors, missing assets and low FPS

Cross-browser layout gate (canvas fits, stays centred and keeps 16:9 on Chrome,
Firefox, Safari/WebKit and phone viewports):

```bash
npm run verify:cross
```

Playwright needs its browsers once: `npx playwright install chromium firefox webkit`.

Tip: kill any stale `vite preview` on port 4173 before running the e2e suite —
Playwright reuses an existing server and would test an old build.

### Pre-push hook

`.githooks/pre-push` runs `npm run lint` and `npm run test` (about five seconds
together). The Playwright suites are left to CI so pushing stays fast. Enable it
once per clone:

```bash
git config core.hooksPath .githooks
```

## Project conventions

- `src/rules` is a **pure** rules engine — no Phaser imports, fully unit-tested.
- `src/mexe-mode` holds the draft editor (undo/redo/reset). Meld ids are
  namespaced per turn; never reuse ids across turns.
- Phaser scenes only render state and forward intents. See `ARCHITECTURE.md`.
- New game logic needs unit tests in `tests/`; user-visible behavior should be
  reachable from the `?showcase=` URL params so the screenshot suite can cover it.

## Art & audio

All art is generated with PixelLab (`docs/PIXELLAB_ASSETS.md` has the full
prompt/path table). Replacements just need the same path and size under
`public/assets/` — missing files fall back to procedural placeholders, never a
crash. SFX are synthesized by `node scripts/gen-sfx.mjs`.

## Reporting bugs

Open a GitHub issue with: what you did, what you expected, what happened, and
the `?seed=` value if the deal matters (deals are deterministic per seed).
