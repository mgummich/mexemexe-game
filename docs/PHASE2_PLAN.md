# Phase 2 execution plan

*Planner: Fable. Implementation: Sonnet agents. One writer per hot file at a time.*

| Wave | Scope | Files | Model | Status |
|---|---|---|---|---|
| 1 | Mexe Mode polish: overflow-proof meld layout, hand-card markers, drop-zone highlights, drag lift, FEITO anim + guard, invalid badges, validator edge tests | GameScene, table/layout, widgets, tests, e2e | Sonnet | running |
| 2 | Puzzle AI: run splits, inter-meld moves, most-cards preference, hard timeout, tests | ai.ts, tests/ai | Sonnet | running |
| 2b | Emote icons ×4, dominoes prop (covers boteco felt smudge) | PixelLab jobs | Fable (prompts/gen) → Sonnet (integration) | generating |
| 3 | Interactive tutorial: 10 teach-by-doing steps over scripted GameScene states, highlights, action blocking, skip/replay, PT/EN | TutorialScene (rewrite), GameScene hooks, i18n | Sonnet | queued |
| 4 | Setup screen (seats/personalities/seed), settings (mute, volumes, reduced motion), pause, rules summary, tooltips, sort toggle, localize 'Você', integrate emotes/props, ambience loop in gen-sfx | MenuScene, new scenes, i18n, GameScene sfx hooks, scripts | Sonnet | queued |
| 5 | Verification expansion: setup/AI-showcase/PT/EN/1080p captures, fps fix outside GameScene, drag e2e via pointer events | e2e, debug-api, playwright config | Sonnet | queued |
| 6 | Critic pass: Fable scores all 10 categories from screenshots/logs; Sonnet fixes weakest; repeat until all ≥8.5 | docs | both | queued |

Constraints honored: Sonnet-only code edits; Fable writes docs/critiques/prompts;
verify runs serialized on port 4173; STATUS.json records roles.
