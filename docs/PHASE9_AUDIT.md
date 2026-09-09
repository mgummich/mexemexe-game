# Phase 9 Audit — playtest-ready demo → content-rich beta

Date: 2026-09-09. Baseline: `main` @ 6dd3976, working tree clean, `npm run test` 234/234 green.

## 1. Phase 8 status

Phase 8 closed the public-demo gate with no blockers. Shipped: session-only play log
(`src/core/playlog.ts`, 2000-entry ring buffer, names/tokens stripped, no disk write),
tutorial 10 → 12 steps (joker + trinca constraints, PT/EN), server error codes mapped to
localized player copy (15 codes + unreachable fallback), lobby action debounce, verify
suite grown to 37 local + 7 multiplayer e2e. All 12 Phase 8 scores ≥ 8.5.

Carried forward from Phase 8, still open:
- no online rematch (needs room-token semantics)
- flood guard is per-connection, not per-IP
- `turnTimerSeconds` declared but intentionally off
- `MAX_PLAYERS` hardcoded to 4 with no client override
- OnlineScene/GameScene reason text is canvas-rendered, so not readable by the debug API

## 2. Playtest feedback summary

**None exists.** No feedback notes, logs, or issue files anywhere in the repo or git history.
Phase 8 delivered the *instruments* for collecting feedback (PLAYTEST_GUIDE.md, play log
export) but no play sessions have been fed back in. Phase 9's "playtest feedback fixes"
therefore has no data to act on. Treating this as a content/clarity phase instead, and
prioritizing the friction points that are predictable from the code rather than inventing
tester complaints. Getting real sessions logged is the top ask for Phase 10.

## 3. Content gaps

- **No theme system at all.** Three static backgrounds exist (boteco, kitchen, menu);
  nothing selects between them. Biggest single content gap.
- **No cosmetic choice anywhere.** 4 card backs ship but the player can never pick one.
  5 avatars ship but each is hardwired to a seat/AI.
- Save file (`mexe-save` v1) has no cosmetics block.

## 4. Art / audio weak spots

- **PixelLab account is out of credits** (subscription expired, 0 generations available).
  New character art is blocked. Mitigation: procedural generation, which this repo already
  uses as a first-class pattern (`scripts/gen-sfx.mjs`, `src/assets/fallbacks.ts`).
  Geometric assets — tables, card backs, emote symbols — generate well procedurally;
  character avatars do not, so new avatars are deferred rather than shipped badly.
- Music is 5 tracks on one shuffled playlist with no notion of context — the menu, a tense
  Mexe draft, and normal play all sound identical.
- 9 SFX + ambience exist and are wired to mute/volume sliders; balance between them is
  unmeasured.

## 5. UX charm gaps

- Win screen reports the result but not *how* it was won; no rematch summary.
- Menu and lobby are functional and static — no motion, no character presence.
- No avatar reactions on results.

## 6. Bot personality gaps

The four personalities differ only in engine choice and are near-invisible in play
(`src/ai/ai.ts:421-436`): Cida = `SimpleAi(true)` (minimal), Juninho = `SimpleAi(false)`
(dump everything), Bia = `RearrangerAi` (widest search), Zé = `PatientAi` (draws while
hand > 5). All share a 400 ms search deadline. A player watching a match cannot tell who
is who — the difference is real but unexpressed. Depth here is presentation (pacing,
emotes, debug move reasons) far more than it is new search logic.

## 7. Cosmetic / menu gaps

No selector UI, no persistence, no fallback path for a cosmetic whose texture is missing.
All three have to land together or the feature is unsafe.

## 8. Online / local regression risks

- Cosmetics must stay strictly client-side. Nothing cosmetic may enter the protocol, touch
  game state, or influence rules. Server stays authoritative.
- Persistence shape change must not break existing saves — old saves lack the new block.
- Missing asset must degrade to a default, never a blank table or an invisible card back.
- Any AI pacing change must not slow or stall a turn, and must stay deterministic
  (no `Math.random` in logic).

## 9. Verify gaps

The gate (`scripts/check-verify.mjs`) checks console errors, screenshot presence and FPS,
but knows nothing about cosmetics, theme selection, or music context. New content is
invisible to verification until the expected-shot list and e2e specs grow with it.

## 10. Top 10 tasks

1. Cosmetics registry + save migration + missing-asset fallback (unsafe if partial).
2. Cosmetic selector UI reachable from the menu; local-only, never synced.
3. Two new table themes, generated procedurally and deterministically.
4. New card back and two new emote symbols, same procedural route.
5. Context-aware music (menu / gameplay / Mexe focus) over the existing playlist.
6. SFX balance pass; confirm mute + sliders + missing-audio safety.
7. Bot personality expression: per-personality pacing, emotes, and debug move reasons.
8. Results/menu charm: rematch summary, winning-move summary, avatar reactions,
   reduced motion respected throughout.
9. Rules/help/objective clarity pass, PT + EN complete.
10. Extend the verify suite and screenshots to cover every item above.

## Deferred, with reason

- **Four new avatars** — blocked on PixelLab credit. Procedural character art would be
  visibly worse than the existing set; shipping it would lower art quality, not raise it.
  The avatar *selector* ships regardless, over the 5 existing avatars.

## Outcome

All 10 top tasks shipped as scoped. The PixelLab block held through the phase — credits
were never restored — so the avatar deferral in section 4/"Deferred" stands as originally
written, not as a risk that materialized differently.

One thing not anticipated in section 8: the results-summary work (task 8) hit a real limit
online, not just a local one. WinScene's rematch summary reads from the session play log,
but online play never observes the server's per-turn state locally, so there is no play-log
data to summarize for an online match. Fixing it needs a protocol change and was out of
scope this phase — WinScene hides the stats line entirely online rather than showing fake
zeros. Documented in `docs/STATUS.json` phase9.priorityIssues and carried to the next phase.

Final gate: 280/280 unit, 46/46 local e2e + 7/7 multiplayer e2e, lint clean, build clean,
zero console/server errors. See `docs/STATUS.json` phase9 block for the full verification
and model/caveman log.

**Post-close update (2026-09-09):** the PixelLab subscription was renewed and the four
avatars named in "Deferred, with reason" above (rosa, tuca, nina, ivo) were generated and
wired in — the catalog is now 9 avatars, not 5. The deferral text above is left as written
since it accurately describes the situation at phase close; see `docs/STATUS.json`
phase9.blockers and the "avatar wiring" modelCavemanLog entry for the resolution.
