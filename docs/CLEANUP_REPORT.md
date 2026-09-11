# Cleanup report — 2026-09-11

A docs, spec-alignment and clutter pass. **No gameplay behaviour was changed.**
Source changes were limited to path references inside comments.

## Summary

The code was already clean (a previous pass had removed dead code, TODOs and
debug spam). The clutter was in the documentation: 47 Markdown files, 27 of them
phase audits, three overlapping rules explanations, a 176 KB `STATUS.json`
accumulating every phase since wave 1, and a 344-line README mixing quick start,
full rules, server operations and test detail.

The repo now has one short README, one source-of-truth doc per topic under
`docs/`, and everything historical in `docs/archive/`.

## Baseline

Run before any edit, at a clean tree: `npm run test` **pass** (545/545, 38
files), `npm run lint` **pass**, `npm run build` **pass**. No pre-existing
failures. Browser suites were not run as a baseline; they are covered in CI and
were not affected by this pass.

## Docs kept (source of truth)

| Doc | Role |
|---|---|
| `README.md` | Short overview, status, quick start, doc index (344 → 142 lines) |
| `docs/GAME_RULES.md` | Implemented rules, now with 10 worked examples asserted against the engine |
| `docs/ARCHITECTURE.md` | Rewritten against the real module tree; adds online flow, PWA, "where new code goes" |
| `docs/DEVELOPMENT.md` | **New** — setup, scripts, URL params, troubleshooting |
| `docs/TESTING.md` | **New** — every suite and gate that actually exists, plus developer tools |
| `docs/MULTIPLAYER.md` | Protocol/authority/reconnect, with alpha limits moved in from the README |
| `docs/PWA_OFFLINE.md` | **New** — offline coverage, cache policy, versioning, update handover |
| `docs/ASSETS.md` | Asset tracker with a new load/replace/regenerate preamble |
| `docs/ROADMAP.md` | **New** — completed / in progress / planned / deferred / not planned |
| `docs/OPERATIONS.md`, `docs/SELF_HOSTING.md`, `docs/PLAYTEST_GUIDE.md`, `docs/ART_DIRECTION.md`, `docs/AUDIO_DIRECTION.md` | Kept, references fixed |
| `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/STATUS.json` | Kept; trimmed of duplicated detail |

## Docs moved and archived

- Root `ARCHITECTURE.md`, `ART_DIRECTION.md`, `AUDIO_DIRECTION.md`,
  `SELF_HOSTING.md` → `docs/`. The root now holds only README, CHANGELOG,
  CONTRIBUTING and LICENSE.
- Renamed: `RULES.md` → `GAME_RULES.md`, `MULTIPLAYER_ARCHITECTURE.md` →
  `MULTIPLAYER.md`, `PIXELLAB_ASSETS.md` → `ASSETS.md`.
- 37 files moved to `docs/archive/`: 26 `PHASE*` audits and plans, 9 topic
  audits (rules adaptation, trincas, jokers, bug hunt, iOS, mobile, responsive,
  project cleanup, audit fix plan), `RULES_VERIFICATION_LOG.md` and
  `RELEASE_NOTES.md` (a stale duplicate of `CHANGELOG.md`).
- `docs/STATUS.json` (176 KB, 100+ phase keys) → `docs/archive/STATUS-history.json`;
  replaced by a 137-line status file keeping the `tests` and `metrics` keys
  `scripts/check-verify.mjs` writes to.

Nothing was deleted. Every reference to a moved or renamed doc was updated in
source comments, tests, workflows, `CHANGELOG.md` and the docs site nav.

## Spec mismatches fixed

- **Alpha vs beta.** The README called online play "Online Beta"; the UI says
  `ONLINE (ALPHA)`. Docs now say alpha everywhere. UI unchanged.
- **Music.** The README's Known issues claimed "Ambience is a procedural
  cricket-bed loop, no composed music track" while five composed tracks ship and
  a context-aware playlist plays them.
- **Turn timer.** Documented as an optional rule. It is a hook: `turnTimerSeconds`
  is 0, `timerExpireTurn` exists and is tested, and nothing starts a timer. Now
  marked as not wired into play in `GAME_RULES.md`, `ROADMAP.md` and the README.
- **Architecture module map.** Listed `src/cards`, `src/input`, `src/animation`
  and `src/debug`, none of which exist, and omitted `src/net`, `src/cosmetics`,
  `src/table` and `server/`. Rewritten from the tree.
- **Architecture "Waves" section** — a stale 5-item plan from before the first
  release. Removed; `ROADMAP.md` replaces it.
- **Joker rule in the playtest guide** omitted the one-joker-per-meld limit.
- **`docs/index.html`** nav listed only 11 docs and never linked the rules;
  rebuilt around the new structure.

The rules themselves were verified, not assumed: all ten required examples were
run through `analyzeMeld` and match `GAME_RULES.md` exactly (two-joker melds
rejected as `reason.tooManyJokers`, same-suit-across-decks groups as
`reason.groupDuplicateSuit`, K-A-2 as `reason.runWrap`, ace low and high runs
valid).

## Code, localization and assets

- **Code:** no dead code, no TODO/FIXME, no debug `console` spam and no
  `Math.random` in gameplay — verified, nothing to remove. Only doc-path strings
  in comments changed.
- **Localization:** pt-BR and en-US are aligned at 214 keys each. 37 keys look
  unused to a literal scan but are all composed dynamically
  (`ai.line.*`, `cosmetics.back.*`, `online.err.*`, `online.status.*`) —
  verified in `src/net/errors.ts`, `OnlineScene.ts`, `GameScene.ts`,
  `src/cosmetics/index.ts`. Nothing removed.
- **Assets:** removed three root-level `music/Mexe_Table_Loop_FULL_SONG_musicgpt(N).mp3`
  files, byte-identical (md5-verified) to the shipped
  `public/assets/audio/music/full-song-{1,2,3}.mp3`, and a stray `music/.DS_Store`
  — 7.7 MB. The two unique masters in `music/` were kept and are now documented
  in `ASSETS.md`. No shipped asset was touched.

## Scripts and config

- `.github/workflows/pages.yml` — the site assembly copied the four root design
  docs explicitly and then copied `docs/*.md` over them; now one copy of each.
- `Dockerfile` comment path updated for the moved `SELF_HOSTING.md`.
- `package.json` scripts, dependencies, Playwright configs and CI workflows were
  checked and left alone: every script is referenced by docs, CI or another
  script, and every dependency is in use.

## Verification

`npm run test`, `npm run lint`, `npm run build` — all pass after the changes,
same counts as the baseline. A link check over every active Markdown file finds
no broken relative link.

Browser suites (`verify`, `verify:cross`, `verify:multiplayer`, `verify:pwa`)
were **not** re-run: this pass changed documentation, comments and two unshipped
audio files, none of which they exercise. CI runs all of them on push.

## Deferred, with reasons

- **"COPY TEST LOG" stays in the settings overlay.** Moving it under an Advanced
  section would shift the panel layout that `tests/settings-layout.test.ts` and
  the screenshot suite assert against — a UI change, out of scope for a docs
  pass. It is already labelled a test tool and is documented under developer
  tools in `TESTING.md`, not as a player feature.
- **~44 exported types/constants have no cross-file consumer.** Almost all are
  protocol message interfaces, option bags and enums used structurally in their
  own file; they document the wire format. Deleting them is churn with no
  benefit and some risk.
- **Cross-references *between* archived docs** still point at the old
  `docs/<NAME>.md` paths. They were broken before the move as well (a link from
  inside `docs/` to `docs/…`), and rewriting historical records to make dead
  links point somewhere else is not worth it.
- **`docs/screenshots/` is 22 MB across 125 files**, including `final/` (a
  curated release set) alongside the regenerated set. Both are referenced —
  `final/` by the README, the rest by the verification gate's expected-shot list
  — so nothing was removed. Pruning needs a decision about which set is
  canonical.
- **`docs/archive/STATUS-history.json`** was left verbatim, including its
  now-stale paths, because it is the historical record.

## Recommended next maintenance

1. Decide whether `docs/screenshots/final/` or the regenerated set is canonical
   and drop the other, roughly halving the repo's image weight.
2. Fold `CHANGELOG.md` entries older than the current major into a
   `docs/archive/CHANGELOG-history.md`; it is 646 lines.
3. When the next feature lands, update `ROADMAP.md` in the same PR — that is the
   file that rots first.
4. Consider adding a markdown link checker to CI so the check run in this pass
   becomes continuous.
