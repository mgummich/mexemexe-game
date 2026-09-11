# Project cleanup audit — 2026-09-11

Scope: `src/`, `server/`, `scripts/`, `docs/`, `public/`, `tests/`, configs.
Ignored: `node_modules/`, `dist/`, `.git/`, `test-results/`, `.playwright-mcp/`.

Baseline before any edit: **531 tests / 38 files pass, lint clean, build clean** —
no pre-existing failures.

## Headline

The codebase was already in good shape. No dead code, no unused exports, no
unused dependencies, no unused assets, no committed build artifacts, no
commented-out code, no TODO/FIXME backlog. Real clutter was confined to three
places, all now fixed. Several plausible-looking cleanups were investigated and
**rejected as unsafe** — those are recorded below so they are not re-proposed.

## Fixed in this pass

1. **Duplicate PNG encoder.** `scripts/gen-icons.mjs` and
   `scripts/gen-cosmetics.mjs` each carried a byte-identical copy of the RGBA
   canvas helpers (`canvas`/`set`/`rect`) and the minimal PNG encoder
   (`CRC_TABLE`/`crc32`/`chunk`/`encodePNG`/`write`) — ~80 duplicated lines.
   Extracted to `scripts/png.mjs`.
   *Verification:* both generators re-run; all 8 emitted PNGs byte-identical
   (`git status --porcelain public/` empty).

2. **Shadowed docs file.** `docs/ART_DIRECTION.md` was not a copy of the root
   `ART_DIRECTION.md` — it was a stray Phase-9 procedural-cosmetics note under a
   misleading name. `.github/workflows/pages.yml` copies `docs/*.md` and *then*
   the root `ART_DIRECTION.md` into `site/docs/`, so the root file overwrote it:
   the content was unreachable on the published site. Its substance is already in
   `docs/PIXELLAB_ASSETS.md:53-65`. Removed.

3. **Dead localization keys.** 12 keys unreferenced in either locale, removed
   from both (24 lines): `menu.players`, `online.copied`, `game.undo`,
   `game.redo`, `game.reset`, `game.deck`, `game.thinking`, `win.again`,
   `tutorial.done`, `win.results`, `win.youWon`, `game.timerExpired`.
   - `game.undo/redo/reset` are leftovers from a text-label button design; the
     buttons now render glyphs `↶ ↷ ⟲` and use the live `tooltip.*` keys
     (`GameScene.ts:941-943`).
   - `game.timerExpired` is copy for a turn timer that does not exist in
     `src/` or `server/`.
   *Verification:* pt and en stayed aligned at 212 keys each; the existing
   parity test (`tests/i18n.test.ts`) passes.

## Investigated and rejected — do not re-propose

- **Archiving the 27 `docs/PHASE*_AUDIT.md` files.** They are unreferenced from
  README/CONTRIBUTING, but `CHANGELOG.md` links ten of them
  (PHASE7/8/10/11/13/14/15/18/19). Moving or deleting them breaks those links
  for no benefit; they are project evidence, and `pages.yml` publishes them by
  glob. **Left in place.**
- **`public/assets/ui/font.ttf`.** Absent from `src/assets/manifest.ts`, so a
  manifest-based scan reports it as orphaned. It is fetched at runtime by
  `src/assets/compose-cards.ts:113` via `fetch()` + `FontFace`. **Keep.**
- **The 53 "missing" card-face PNGs.** `buildManifest()` names
  `assets/cards/<suit>-<rank>.png` and `joker.png`, none of which exist on disk.
  This is by design: `composeCardFaces()` draws them at runtime from
  `card-blank` plus the pixel font. Not a broken path. **Keep as is.**
- **Over-broad `export` keywords.** ~55 exported symbols are never imported
  elsewhere, but every one is used inside its own file; the bulk are
  `src/net/protocol.ts` message types feeding the `ClientMsg`/`ServerMsg`
  unions. Narrowing them is cosmetic churn with no runtime effect. **Left.**
- **Splitting `src/scenes/GameScene.ts` (2721 lines).** It holds the game loop,
  state sync and scene lifecycle. Extraction is a refactor, not clutter removal,
  and is out of scope for a no-behaviour-change pass. **Deferred.**
- **`test:watch`.** The only npm script with no doc/CI reference; it is a
  standard dev convenience. **Kept.**

## Confirmed clean (checked, nothing to do)

- **Dead code / unused exports:** none. Every value export
  (`MIN_PLAYERS`, `PORTRAIT_W/H`, `fewestCardsWinner`, `GAME_STATE_VERSION`,
  `RANK_LABEL`, `ConfigError`, …) is referenced in its own module.
- **Console spam:** 4 calls total, all intentional — the clipboard-export
  fallback (`settings-panel.ts:40,44`) and a desync `console.warn`
  (`GameScene.ts:469`). Server logging is centralised in `server/log.ts`.
- **TODO/FIXME/XXX/HACK:** zero across `src/`, `server/`, `scripts/`.
- **Assets:** 64 files under `public/assets`; every one reachable via
  `buildManifest()`, `AUDIO_ASSETS`, `src/audio/music.ts`, or runtime fetch.
- **Localization:** pt/en at exact parity, no duplicate keys, dynamic prefixes
  (`settings.helperMode.`, `ai.line.`, `online.status.`, `online.err.`,
  `cosmetics.back.`, `cosmetics.table.`, `cosmetics.avatar.`) all live.
- **Dependencies:** `phaser`, `ws`, `tsx` all actively used; no removals.
- **npm scripts:** all referenced by CI, docs, or the pre-push hook.
- **Git hygiene:** no `.DS_Store`, `*.log`, `dist/`, or `test-results/` tracked.

## Net effect

| | |
|---|---|
| Files removed | 1 (`docs/ART_DIRECTION.md`) |
| Files added | 1 (`scripts/png.mjs`) |
| Duplicated lines eliminated | ~80 |
| Dead localization lines removed | 24 |
| Dependencies removed | 0 |
| Assets removed | 0 (none proved unused) |
| Gameplay / rules / server behaviour changed | none |

Untracked local-only clutter, left alone deliberately: three
`music/Mexe_Table_Loop_FULL_SONG_musicgpt(N).mp3` source takes (~7.7 MB) and
`music/.DS_Store`. Untracked and gitignored, so they cost the repo nothing;
deleting a user's source material is not this pass's call.
