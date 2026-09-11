# Phase 11 Audit — Client Performance, Resilience and Cleanup

Scope: turn audit findings into targeted fixes — client performance and input
responsiveness, crash/stuck-state cleanup, resilience and error handling, code
readability, AI-slop removal, and test coverage for whatever gets fixed. Out of
scope: any rewrite, new modes, new content, rule changes, or architecture rebuilds.

## 1. Entry state

Phase 10 closed green and was re-measured at the start of this phase rather than
taken on trust:

- 301/301 unit tests (21 files), `eslint` + `tsc --noEmit` clean, build clean
  (121.43 kB game chunk + 1,481.77 kB Phaser chunk; 38.16 / 337.86 kB gzip).
- `npm run verify` passes: 28 captures, zero console errors, zero missing assets.
- Baseline FPS per capture: 56–60 in menu/game scenes, 58 at 1920×1080, 58 on the
  `stress-table` crowded-table capture, 44 on `tutorial-complete` (the single
  lowest reading, still well above the gate's 30 and above the 40 the tutorial's
  overlay work would justify worrying about).

There is no `ISSUE_REGISTER.json` and no `REFACTOR_PLAN.md` in this repository;
`docs/STATUS.json` and the per-phase audits are the register. This audit therefore
starts from a fresh inspection pass rather than from a carried-over issue list.

## 2. Client performance findings

**The headline finding is that there is no client performance problem to fix.**
This is worth stating plainly because the phase brief assumes one.

- **No per-frame work exists.** No scene implements `update()`. Nothing allocates
  per frame, and there is no per-frame O(n) scan anywhere in `src/`.
- **Rendering is event-driven.** `GameScene.renderAll()`
  (`src/scenes/GameScene.ts:958`) destroys and recreates every card sprite and HUD
  object, which sounds alarming, but it is called only on a state change or a
  completed card drop — roughly once per interaction, never per frame. At the
  sprite counts this game reaches (≈21 sprites + 20 drop zones on the crowded
  `stress-table` capture) it measures 58 FPS. Sprite pooling would be an
  optimisation with no measured problem behind it, and `docs/STATUS.json` already
  carries it as a deliberate deferral.
- **Drag is cheap.** The `drag` handler (`src/scenes/GameScene.ts:1372`) does a
  `setPosition`, a shadow reposition, and a linear `find()` over `meldZones`
  (`:1403`). No rules validation, no layout recompute, and no re-render runs per
  pointer move. At ≈25 zones the scan is not measurable.

One genuine inefficiency does exist, and it is the only performance item this
phase acts on:

- **Duplicate meld analysis per render.** `renderAll()` calls
  `this.editor.invalidMelds()` (`:1010`) and `this.editor.canConfirm()` (`:1020`)
  separately, and both walk every meld calling `analyzeMeld()`. Every render of a
  human turn therefore analyses the whole table twice. This is real duplicated
  work on the interaction path, and collapsing it is a small, safe change.

Two flagged items were investigated and dismissed as **non-issues**, recorded here
so a future pass does not re-raise them:

- Scene keyboard handlers (`:237`, `:244`) are registered on Phaser's *scene*
  keyboard plugin, which is torn down with the scene. They are not leaks.
- `time.delayedCall` timers (`:359`, `:376`, `:387`, `:403`, `:612`, `:908`,
  `:1570`) live on the scene clock, which Phaser destroys on shutdown. Pending
  callbacks do not fire after the scene ends. They are not leaks either.

## 3. Crash and stuck-state risks

These are the real findings of the phase. All three of the first group are
"the game never starts" or "online silently stops working" failures on a browser
configuration the project has simply never been run on.

**S1 — Blocked storage crashes the whole game at import time.**
`src/core/settings.ts:5` calls `loadSave()` at module scope, and
`src/core/persistence.ts:82` calls `storage.getItem(...)` with no guard. In Safari
with cookies/site data blocked — and in any embedded webview with storage disabled —
touching `localStorage` *throws* rather than returning null. The throw happens
during module evaluation, so the app never boots: a blank canvas with a console
error. Every write site in `settings.ts` is already guarded (`:9`, `:48`); only the
read path was missed.

**S2 — Blocked storage breaks the online reconnect path.**
`src/net/client.ts` touches `sessionStorage` unguarded at `:85` (inside
`ws.onopen`), `:100` (inside `ws.onclose`), `:125` (inside `ws.onmessage`) and
`:135`. A throw inside a socket callback aborts that callback: at `:85` the
reconnect handshake never sends, at `:100` the retry decision is skipped and the
status is never updated, so the UI sits on a dead socket with no notice.

**S3 — A failed asset-composition step leaves the player on a black screen.**
`BootScene.finish()` (`src/scenes/BootScene.ts:49`) is `async`, is invoked without
`await` from both branches (`:68`, `:70`), and has no `try`/`catch`. If
`loadPixelFont()` or `composeCardFaces()` throws, the rejection is unhandled and
`this.scene.start('menu')` never runs. The scene has procedural fallbacks for every
asset — the game is fully playable without composed card faces — so the failure
mode is strictly worse than the recovery that already exists a few lines below.

**S4 — Online input can lock indefinitely.**
`onlinePending` (`src/scenes/GameScene.ts:130`) locks input while the server
decides on a FEITO or COMPRAR. It is cleared only by `state_sync` (`:294`) or
`proposal_rejected` (`:329`). A dropped or ignored proposal on a socket that stays
open produces neither, and there is no timeout: the player is left with a dead
board and no explanation. A hard socket close is already handled (`:401` shows a
notice and returns to the menu after 2.5 s); this is the quiet case that is not.

## 4. Resilience and privacy

No new privacy exposure. The Phase 10 posture holds: the play log is in-memory,
capped and redacted; the server logger redacts; no secrets are in the bundle
(`npm run verify:preview` asserts this). Client logging is three `console.*` sites,
one of which is the desync warning at `src/scenes/GameScene.ts:317` — that one is
diagnostic, fires at most once per desync, and logs only a revision number and two
hashes, so it stays.

## 5. Code-slop hotspots

The codebase is, unusually, almost free of slop. A full scan of `src/`, `server/`,
`tests/`, `scripts/` and the three e2e suites found:

- Zero `TODO` / `FIXME` / `HACK` / `XXX`.
- Zero commented-out code blocks.
- Zero duplicated near-identical implementations.
- Zero unused config knobs, zero stub/fake fallback paths, zero docs claiming
  features that do not exist, zero tests asserting only implementation details.

Two dead exports, both from Phase 10 and neither imported anywhere:

- `clientConfig` (`src/config.ts:7`) — a `mode`/`isProduction` pair that nothing
  reads. `resolveWsUrl` in the same module is used and stays.
- `SUIT_COLOR` (`src/assets/fallbacks.ts:9`) — superseded by the composed card
  faces; `SUIT_CHAR` and `RANK_LABEL` beside it are still used.

`GameScene.ts` is 1,579 lines and is the only oversized file. It is however
cleanly sectioned by `// ---------- name ----------` banners and its methods are
short. Splitting it is a multi-file refactor with real regression surface and no
measured benefit, so it is deferred rather than attempted inside a fix phase.

## 6. Files likely affected

`src/core/persistence.ts`, `src/net/client.ts`, `src/scenes/BootScene.ts`,
`src/scenes/GameScene.ts`, `src/config.ts`, `src/assets/fallbacks.ts`, plus new and
extended specs under `tests/`.

## 7. Top 10 tasks

1. Guard `loadSave()` against a throwing storage backend; fall back to defaults (S1).
2. Route every `sessionStorage` access in `src/net/client.ts` through a safe
   accessor so a throw can never abort a socket callback (S2).
3. Wrap `BootScene.finish()` so any failure still reaches the menu with procedural
   fallbacks instead of a black screen (S3).
4. Bound `onlinePending` with a timeout that clears the lock and requests a resync
   instead of leaving input dead forever (S4).
5. Collapse the duplicate per-meld analysis in `renderAll()` into a single pass.
6. Delete the two dead exports (`clientConfig`, `SUIT_COLOR`).
7. Regression tests for 1, 2 and 4; a boot-failure test for 3.
8. Re-run `npm run verify` and `npm run verify:multiplayer` and record before/after
   FPS in `docs/STATUS.json`.
9. Record in this audit the perf items that were investigated and found to be
   non-issues, so they are not re-raised.
10. Update `docs/STATUS.json` and `CHANGELOG.md` to the Phase 11 state.

## 8. Deferred, with reason

- **Sprite pooling in `renderAll()`** — no measured problem (58 FPS on the crowded
  capture). Carried from Phase 9's open issues; revisit only if a real device dips.
- **Splitting `GameScene.ts`** — 1,579 lines, but sectioned and navigable. A split
  is a wide refactor with regression surface and no measured benefit.
- **`music.ts` autoplay-unlock listeners (`:137`, `:138`)** — never removed, so
  they run on every pointer-down for the page's lifetime. The handler is a
  `paused` check and a volume read; the cost is not measurable and removing the
  listeners after the first unlock would break re-unlock after a browser
  auto-pause. Left as is, deliberately.
- **Per-zone drag hover scan (`:1403`)** — linear over ≈25 zones per pointer move.
  Not measurable; a spatial index here would be complexity with no payoff.
- **Online results summary on `WinScene`** — needs a protocol change. Carried from
  Phase 9 and Phase 10.
- **Per-IP rate limiting, online rematch, `turnTimerSeconds`** — carried from
  earlier phases, all server-side and outside this phase's client focus.
