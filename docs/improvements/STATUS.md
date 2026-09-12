# Improvement Backlog Status

Execution state for the `docs/improvements/` backlog. 280 improvement IDs across 16 files.

Baseline (before this run, 2026-09-12): `npm run lint` pass, `vitest run` 634/634 pass,
`npm run screenshot` 85 browser + 3 perf pass. No pre-existing failures.

States: TODO · ACTIVE · IMPLEMENTED · VERIFYING · VERIFIED · ALREADY-SATISFIED · BLOCKED ·
DEFERRED-ASSET · DEFERRED-PRODUCT · NOT-APPLICABLE

## Ownership

One owner per overlapping code surface, to keep concurrent work from colliding:

| Surface | Owns |
|---|---|
| `MenuScene` / `SetupScene` | MENU-\*, SETUP-\* |
| `GameScene` + `src/table`, `src/mexe-mode` | START-\*, PACE-\*, MEXE-\*, RECOVERY-\*, AI-\*, END-\*, MOBILE-\*, ACCESS-\*, JUICE-\* |
| `WinScene` + `core/results-summary` | RESULT-\* |
| `tutorial/` | TUTORIAL-\* |
| `ui/pause-menu`, `ui/rules-panel`, `ui/settings-panel` | SUPPORT-\* |
| `OnlineScene` + `src/net` + `server/` | ONLINE-\* |
| `core/playlog` + `verification/debug-api` | TELEMETRY-\* |

## Assumptions

- **Telemetry stays local.** `tests/no-telemetry.test.ts` is a standing guard that the client
  ships no analytics, tracking or automatic upload. Every TELEMETRY-\* item is therefore
  implemented against the existing local `core/playlog` + manual export, never a network sink.
- **No new art or audio assets are generated.** Items needing art the repo does not have are
  marked `DEFERRED-ASSET` with the exact asset named, rather than filled with placeholders.

## Status

| ID | File | Subsystem | State | Files changed | Verification | Blocker |
|---|---|---|---|---|---|---|
| MENU-01 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts | `docs/screenshots/menu.png` — tagline renders under the real logo | |
| MENU-02 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts, src/localization/i18n.ts, e2e/screenshot.spec.ts | `menu.png` (first run: APRENDER A JOGAR + ~3 MIN primary) vs `menu-returning.png` (JOGAR primary); e2e `menu-returning` clicks the primary and asserts it reaches `setup` | |
| MENU-03 | 01-main-menu.md | Menu | ALREADY-SATISFIED | — | Rules/language/settings already demoted to 18px utility row; `widgets.ts:168` keeps a 34x31 touch floor | |
| MENU-04 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts, src/localization/i18n.ts | `menu.png` — gold ALPHA plate beside SALA ONLINE; offline disable/explain path untouched | |
| MENU-05 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts | Continuous `repeat: -1` bob replaced by a 5.2s intermittent nudge; skipped entirely (no timer) under reduced motion; `time.removeAllEvents()` on rebuild stops timer stacking on language toggle | |
| MENU-06 | 01-main-menu.md | Menu | VERIFIED | src/ui/widgets.ts, src/scenes/MenuScene.ts | `PixelButtonOpts.primary`: 1.05 hover lift, 0.9 press, Back.out pop, louder click; e2e menu/tutorial navigation still passes | |
| MENU-07 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts | ~600ms staggered arrival (logo -> tagline -> CTA -> secondary -> utilities); e2e `tutorial` + `menu-returning` click during the entrance and still navigate | |
| MENU-08 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts | Sparse warm bulb flicker (~1 in 3 ticks at 3.4s); screen-wide wash rather than per-bulb sprites because landscape and portrait art place lights differently | |
| MENU-09 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts | Existing `ambience.wav` looped at 0.6x music volume, stopped on scene shutdown — reuses GameScene's pattern, no new asset | |
| MENU-10 | 01-main-menu.md | Menu | VERIFIED | src/scenes/MenuScene.ts | Occasional 3-card run<->set teaser in the free margin beside the panel; landscape only, presentation-only, no game state | |
| SETUP-01 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts, src/localization/i18n.ts | `setup.png`, `setup-4players.png`, `setup-en.png`, `mobile-portrait-setup.png` — avatar + name + style line per seat, derived from the real AI trait table | |
| SETUP-02 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts | Changing a seat shows that character's own `ai.line.*` quote for 1.6s; visible in `setup-4players.png` | |
| SETUP-03 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts | Explicit prev/next buttons per AI seat, 34x31 touch floor | |
| SETUP-04 | 02-setup-opponents.md | Setup | DEFERRED-ASSET | src/scenes/SetupScene.ts | Scale-pop + `sfx-click` + character quote landed; per-character voice needs audio the repo does not have | Needs `assets/audio/voice-<personality>.wav` (4 files) |
| SETUP-05 | 02-setup-opponents.md | Setup | ALREADY-SATISFIED | — | Descriptors are style-only; difficulty stays in Settings | |
| SETUP-06 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts, src/localization/i18n.ts | `setup.players.2/3/4` describe turn cadence; `setup.png` (2) and `setup-4players.png` (4) | |
| SETUP-07 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts, src/localization/i18n.ts | Summary now reports difficulty + pace + local; no invented duration claim (no play-time data is stored) | |
| SETUP-08 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts, src/localization/i18n.ts | Beginner tip names Dona Cida, and is hidden at expert difficulty where the claim stops being true | |
| SETUP-09 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts | `stepPersonality()` skips personalities other seats hold; `setup-4players.png` shows 4 distinct characters | |
| SETUP-10 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts | Seating preview (table, deck, per-seat avatars) in leftover panel space; skipped when the lineup fills the panel | |
| SETUP-11 | 02-setup-opponents.md | Setup | VERIFIED | src/localization/i18n.ts | Title is MONTE A MESA / SET THE TABLE | |
| SETUP-12 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts, e2e/screenshot.spec.ts | PLAY deals card backs out of the table centre with `sfx-deal` before the scene change; skipped under reduced motion; e2e asserts the click still reaches the game | |
| SETUP-13 | 02-setup-opponents.md | Setup | VERIFIED | src/scenes/SetupScene.ts | `setup-after-settings.png` — seat count and characters survive a Settings round trip | |
| START-01 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts, src/ui/feel.ts | `dealIn()` flies every card off the deck, 22ms stagger, under ~2s for 4 players; reduced motion renders the dealt board with no flight | |
| START-02 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | The deal originates at the deck sprite and sends a card back to each opponent seat, establishing pile, ownership and seating | |
| START-03 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | `announceTurn()` holds SUA VEZ at 1.6x then collapses into the HUD line over 2x `expressive` (~760ms total); `game.png` | |
| START-04 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | `layoutHand(..., active)` — lit on your turn, 0.72 alpha / 0.94 scale on someone else's; never the only signal (banner + disabled buttons say the same) | |
| START-05 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | `game.png` — with no draft yet FEITO sits at 0.45 alpha while COMPRAR is at full weight, so the first turn reads cards then COMPRAR | |
| START-06 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | `setFeitoEnabled` is now three states: dormant (no draft), disabled (draft unfinished), enabled | |
| START-07 | 03-match-start.md | Match start | ALREADY-SATISFIED | — | `GameScene.ts:2460-2480` — alpha, 1.15x scale, drop shadow, `sfx-pickup` | |
| START-08 | 03-match-start.md | Match start | ALREADY-SATISFIED | — | `GameScene.ts:2714-2729` — snap/drop sfx by snap status, Back.out settle, muted invalid + glide home | |
| START-09 | 03-match-start.md | Match start | ALREADY-SATISFIED | — | `helpers.ts:30-35` — beginner mode already shows spatial ghost destinations | |
| START-10 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | `drawEmptyTableGuide()` — ghosted run and set examples; `game.png` shows it, and it disappears once a meld exists | |
| START-11 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | `armHesitationHint()` — silent for 18s, then "Sem jogo? Compre uma carta." if untouched, or the live blocking reason mid-edit; re-armed on every draft change | |
| START-12 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | COMPRAR snapshots positions, then the drawn card is the only one without a prior position, so it flies off the deck and the hand re-fans | |
| START-13 | 03-match-start.md | Match start | VERIFIED | src/scenes/GameScene.ts | `activateSeat()` — the hand recedes, then the taking-over seat's rings pop a beat later | |
| END-10 | 08-endgame.md | Endgame | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | FEITO becomes BATER! / GO OUT! exactly when confirming would empty the hand | |
| RECOVERY-12 | 05-error-recovery.md | Recovery | VERIFIED | src/scenes/GameScene.ts | Same hesitation watchdog as START-11; mid-edit it offers the actual blocking reason | |
| JUICE-01 | 14-game-feel.md | Game feel | VERIFIED | src/ui/feel.ts | `FEEL` defines fast/normal/expressive/major as both timing bands and impact levels, with major reserved for FEITO/BATER/victory | |
| JUICE-11 | 14-game-feel.md | Game feel | VERIFIED | src/audio/sfx.ts | Per-play pitch (±40 cents) and volume (±8%) spread on frequent cues; `sfx-feito` and `sfx-win` deliberately play dry | |
| JUICE-14 | 14-game-feel.md | Game feel | VERIFIED | src/scenes/GameScene.ts | `lastEmoteBySeat` — 2.5s per-seat cooldown, and a line that would repeat the previous one is dropped while the face still shows | |
| JUICE-15 | 14-game-feel.md | Game feel | VERIFIED | src/ui/feel.ts | Four named bands with their easings replace per-call-site magic numbers | |
| PACE-11 | 07-match-pacing.md | Pacing | VERIFIED | src/scenes/GameScene.ts | Same cooldown/no-repeat rule as JUICE-14 | |
| PACE-18 | 07-match-pacing.md | Pacing | ALREADY-SATISFIED | — | `rules/types.ts:43-52` — `DEFAULT_RULES` has no event or power-up fields, and no random-event code exists | |
| TELEMETRY-01 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | docs/PLAYTEST_GUIDE.md | Debrief section added to the playtest guide | |
| TELEMETRY-02 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, tests/playlog.test.ts | `hesitations` / `hesitationMaxMs` count >=3s gaps inside the human's own turn; test asserts an AI gap is ignored | |
| TELEMETRY-03 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | docs/PLAYTEST_GUIDE.md | Session-recording procedure documented (OS recorder + Playwright trace); `video: 'on'` deliberately not made permanent | |
| TELEMETRY-04 | 16-playtesting-telemetry.md | Telemetry | TODO | — | Screenshots are captured but not diffed against a baseline | Needs `toHaveScreenshot` baselines pinned to one browser image |
| TELEMETRY-05 | 16-playtesting-telemetry.md | Telemetry | ALREADY-SATISFIED | — | `playlog.ts` `invalidFeitoByReason` | |
| TELEMETRY-06 | 16-playtesting-telemetry.md | Telemetry | ALREADY-SATISFIED | — | `playlog.ts` undo/redo/reset counts | |
| TELEMETRY-07 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, src/scenes/GameScene.ts | `noteTableValidity()` times invalid spans by reason; wired in `renderAll` | |
| TELEMETRY-08 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, src/scenes/GameScene.ts | `recordBoard()` sampled once per turn — hand size, deck left, table melds/cards | |
| TELEMETRY-09 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, src/scenes/GameScene.ts | `recordDrop()` wired at all four drop outcomes plus cancelled drags; pointer profile is coarse/fine only | |
| TELEMETRY-10 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, src/scenes/GameScene.ts | Zoom steps recorded in `onZoomIn`/`onZoomOut`; orientation flips come off the existing bus event | |
| TELEMETRY-11 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts | `mexe:first` marker + `timeToFirstMexeMs` | |
| TELEMETRY-12 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, src/core/persistence.ts, src/core/settings.ts, src/scenes/GameScene.ts | `Progress.gamesStarted` (a count, never an id) + `setSessionContext`; `tests/no-telemetry.test.ts` passes unmodified | |
| TELEMETRY-13 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | same as TELEMETRY-12 | `gamesStarted: 2` is how first-game to second-game is read; asserted through the export | |
| TELEMETRY-14 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | docs/PLAYTEST_GUIDE.md | Debrief asks explicitly when the match began to feel slow | |
| TELEMETRY-15 | 16-playtesting-telemetry.md | Telemetry | VERIFIED | src/core/playlog.ts, tests/playlog.test.ts | `drawStreakMax`, human vs AI turn duration means, table complexity, drop friction | |
| TELEMETRY-16 | 16-playtesting-telemetry.md | Telemetry | NOT-APPLICABLE | — | Policy statement; no progression or random-rule system exists, and the guardrails forbid adding one | |
| MEXE-02 | 04-mexe-mode.md | Mexe | ALREADY-SATISFIED | — | `GameScene.ts:2464` 1.15x scale + drop-shadow ellipse — lift over enlargement, as asked | |
| MEXE-04 | 04-mexe-mode.md | Mexe | ALREADY-SATISFIED | — | Solid vs dashed outline plus a ✓/✗ badge — shape channel, not hue alone | |
| MEXE-06 | 04-mexe-mode.md | Mexe | VERIFIED | src/localization/i18n.ts, src/core/objective.ts | "Mesa inválida — corrija" became "Ainda mexendo — falta fechar as combinações abertas"; the checklist counts what is open instead of repeating "invalid" | |
| MEXE-07 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | `unresolvedCountText()` — "(1 combinação pra fechar)"; singular and plural keys, asserted in `tests/objective.test.ts` | |
| MEXE-08 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | `checkMyWork()` — after a refused FEITO the open melds pulse and the resolved ones recede, which is visibly stronger than the resting state | |
| MEXE-09 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | `playTableResolved()` on the unresolved→valid transition: all melds settle together, crisp cue, FEITO wakes. The only synchronized whole-table effect in the game | |
| MEXE-10 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | FEITO now stays disabled through `CONFIRM_GUARD_MS` and re-renders once when the guard expires, so it never looks pressable before it is; `editor-valid-final` e2e still confirms | |
| MEXE-13 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | Undo/redo/reset capture positions first and `animateBoardFrom` carries the cards across, instead of a hard re-render | |
| MEXE-15 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | Drops re-render with motion, so the source meld closing and the destination opening both read as movement | |
| MEXE-16 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | Reflow is now travelled rather than jumped: untouched cards visibly move to their new spots, preserving spatial memory without rewriting the packing algorithm | |
| MEXE-18 | 04-mexe-mode.md | Mexe | VERIFIED | src/core/objective.ts, src/scenes/GameScene.ts, e2e/screenshot.spec.ts | Beginner checklist reports a live count of melds still open; `mobile-done-checklist.png` | |
| RECOVERY-02 | 05-error-recovery.md | Recovery | VERIFIED | src/localization/i18n.ts | Intermediate states now read as work in progress, not failure | |
| RECOVERY-03 | 05-error-recovery.md | Recovery | VERIFIED | src/scenes/GameScene.ts | A refused FEITO pulses the blocking melds themselves, not just a sentence | |
| RECOVERY-05 | 05-error-recovery.md | Recovery | VERIFIED | src/scenes/GameScene.ts | `checkMyWork()` is exactly the check-my-work pass: resolved melds recede, open ones stay lit, concise reason above | |
| RECOVERY-06 | 05-error-recovery.md | Recovery | VERIFIED | src/scenes/GameScene.ts | A 2px horizontal shake plus the existing muted `sfx-invalid` — the press registered, nothing flashed red | |
| RECOVERY-07 | 05-error-recovery.md | Recovery | VERIFIED | src/scenes/GameScene.ts | Undo pulses twice after a refused FEITO when there is history to undo, then stops. Never indefinite | |
| RECOVERY-08 | 05-error-recovery.md | Recovery | VERIFIED | src/scenes/GameScene.ts | Same `animateBoardFrom` continuity as MEXE-13, so a multi-step undo chain stays followable | |
| RECOVERY-10 | 05-error-recovery.md | Recovery | ALREADY-SATISFIED | — | No modal on any invalid path; reason line, tooltip and badge only | |
| RECOVERY-11 | 05-error-recovery.md | Recovery | VERIFIED | src/localization/i18n.ts, src/core/objective.ts | Count decreases toward zero, and the ready state reads "Mesa pronta ✓ — aperte FEITO!" | |
| RECOVERY-15 | 05-error-recovery.md | Recovery | ALREADY-SATISFIED | — | `GameScene.ts:2721-2729` Back.out glide home on a rejected drop | |
| RECOVERY-16 | 05-error-recovery.md | Recovery | ALREADY-SATISFIED | — | Reason line persists until the next render; meld tooltip latches on tap | |
| JUICE-08 | 14-game-feel.md | Game feel | VERIFIED | src/scenes/GameScene.ts | Same signature settle as MEXE-09 | |
| ACCESS-05 | 15-accessibility-readability.md | Accessibility | VERIFIED | src/ui/regions.ts, src/scenes/GameScene.ts | Fixed a pre-existing portrait defect: the reason block drew over the action row. Now bottom-anchored with an opaque backdrop, and portrait lists only outstanding checklist items. `mobile-done-checklist.png` before/after | |
| SUPPORT-01 | 11-pause-help-settings.md | Support | ALREADY-SATISFIED | — | `pause.png` — green primary CONTINUAR, danger-tinted quit, panel over the live board | |
| SUPPORT-02 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/pause-menu.ts | Reassurance note fades after 3 pauses; always shown online, where it is a fact not reassurance. Per-session counter only | Cross-session persistence not done |
| SUPPORT-03 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/rules-panel.ts | `rules-basics.png` one-screen reference, `rules-full.png` behind VER REGRAS COMPLETAS | |
| SUPPORT-04 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/rules-panel.ts | `rules-basics.png` — run/trinca/ace/joker drawn as real card textures | |
| SUPPORT-05 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/rules-panel.ts, src/scenes/GameScene.ts | `openHelp()` passes the live blocking reason; the panel leads with it in gold | |
| SUPPORT-06 | 11-pause-help-settings.md | Support | DEFERRED-PRODUCT | — | The board already answers "show me why" by tapping an invalid meld's ✗. A second entry point in the panel was judged redundant rather than added as a dead button | |
| SUPPORT-07 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/rules-panel.ts, src/ui/settings-layout.ts | `rules-basics.png` / `rules-controls.png` — BÁSICO / CONTROLES tabs, active tab carries a ring, not colour alone | |
| SUPPORT-08 | 11-pause-help-settings.md | Support | ALREADY-SATISFIED | — | `settings.png` — 7 rows, seed/log/reset behind AVANÇADO | |
| SUPPORT-09 | 11-pause-help-settings.md | Support | DEFERRED-SCOPE | src/ui/settings-panel.ts, src/ui/settings-layout.ts | PERSONALIZAR promoted to the first Settings row; `cosmetics-panel.png` | A true top-level surface needs a MenuScene entry |
| SUPPORT-10 | 11-pause-help-settings.md | Support | ALREADY-SATISFIED | — | `settings.png` + `ai-settings` e2e | |
| SUPPORT-11 | 11-pause-help-settings.md | Support | ALREADY-SATISFIED | — | `cosmetics` e2e — applies immediately, survives reload, no Save button | |
| SUPPORT-12 | 11-pause-help-settings.md | Support | VERIFIED | src/localization/i18n.ts | Helper modes are COMPLETA/NORMAL/MÍNIMA against AI ADVERSÁRIOS — no shared option names | |
| SUPPORT-13 | 11-pause-help-settings.md | Support | VERIFIED | — | `pause-draft` e2e — draft JSON identical across pause → Settings → Rules → resume, undo still works | |
| SUPPORT-14 | 11-pause-help-settings.md | Support | VERIFIED | e2e/screenshot.spec.ts | `pause-draft.png` + the assertion above | |
| SUPPORT-15 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/pause-menu.ts, src/scenes/GameScene.ts | GameScene passes `online`; the overlay then says the match and clock keep running instead of PAUSADO | |
| SUPPORT-16 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/pause-menu.ts | `pause-quit-confirm.png` — CONTINUAR JOGANDO / ABANDONAR, no generic YES/NO | |
| SUPPORT-17 | 11-pause-help-settings.md | Support | VERIFIED | src/ui/overlay.ts + panels, e2e | `esc:` e2e backs out one level at a time and proves input is released; Esc also cancels the quit confirm | |
| ONLINE-01 | 13-online.md | Online | ALREADY-SATISFIED | — | Entry screen is CRIAR SALA / ENTRAR, no networking words | |
| ONLINE-02 | 13-online.md | Online | VERIFIED | src/scenes/OnlineScene.ts | `mp-lobby-code-a.png` — code is the hero with COPIAR; COMPARTILHAR only where `navigator.share` exists | |
| ONLINE-03 | 13-online.md | Online | VERIFIED | src/scenes/OnlineScene.ts | `?room=` deep link sanitised to the room alphabet and auto-joined through the normal validated join | |
| ONLINE-04 | 13-online.md | Online | VERIFIED | src/scenes/OnlineScene.ts | `mp-lobby-code-a.png`, `mp-mobile-lobby-host.png` — seat rows with badges, names, host marker, free-seat row | |
| ONLINE-05 | 13-online.md | Online | ALREADY-SATISFIED | — | Status is a word (PRONTO/AGUARDANDO); colour is secondary | |
| ONLINE-06 | 13-online.md | Online | VERIFIED | src/scenes/OnlineScene.ts | Names who is not ready. Fixed a portrait defect where that line was drawn under VOLTAR | |
| ONLINE-07 | 13-online.md | Online | VERIFIED | src/scenes/OnlineScene.ts | Host badge per seat; host-only controls carry the hint, guests do not | |
| ONLINE-08 | 13-online.md | Online | ALREADY-SATISFIED | — | Timer summary leads with the experience word, numbers second | |
| ONLINE-09 | 13-online.md | Online | TODO | — | Notice when the Mexe time extension is granted | GameScene |
| ONLINE-10 | 13-online.md | Online | VERIFIED | src/scenes/OnlineScene.ts | Status line only rendered when not healthy | |
| ONLINE-11 | 13-online.md | Online | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | A sync that discards an in-progress draft now says the table returned to the last confirmed state | |
| ONLINE-12 | 13-online.md | Online | VERIFIED | src/scenes/GameScene.ts | Input is locked while resyncing, not just while a submit is pending | |
| ONLINE-13 | 13-online.md | Online | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | Disconnect/reconnect notices name the player, falling back to the anonymous copy only if the seat has no name yet | |
| ONLINE-14 | 13-online.md | Online | IMPLEMENTED | src/net/protocol.ts, server/rooms.ts, src/localization/i18n.ts | `missedTurns` added to the public view and populated server-side; warning copy added | Client-side warning not yet rendered |
| ONLINE-15 | 13-online.md | Online | VERIFIED | src/scenes/GameScene.ts | Clock escalates warning → critical (colour, size and a louder tick in the last 5s) | |
| ONLINE-16 | 13-online.md | Online | ALREADY-SATISFIED | — | Timeout copy names the action the server took; `verify:multiplayer` test 2 | |
| ONLINE-17 | 13-online.md | Online | ALREADY-SATISFIED | — | `verify:multiplayer` tests 1 and 6 — one request per double-click, pending state locks input | |
| ONLINE-18 | 13-online.md | Online | ALREADY-SATISFIED | — | `errorMessage(code)` is the only text path; raw codes stay in the trace | |
| ONLINE-19 | 13-online.md | Online | VERIFIED | src/localization/i18n.ts | "ATUALIZANDO A MESA..." replaces the sync/server wording | |
| ONLINE-20 | 13-online.md | Online | VERIFIED | src/ui/pause-menu.ts, src/scenes/GameScene.ts | Same fix as SUPPORT-15 — the overlay never claims an online match paused | |
| ONLINE-21 | 13-online.md | Online | IMPLEMENTED | src/net/protocol.ts, src/net/client.ts, server/*, src/scenes/OnlineScene.ts | Fixed 4-id preset list, validated at the parse boundary, server-side per-seat 3s cooldown, unit-tested. Lobby row shipped | In-match row not yet in GameScene |
| ONLINE-22 | 13-online.md | Online | VERIFIED | src/net/client.ts, src/scenes/OnlineScene.ts | Name entry, sanitised to letters/digits/space, persisted locally, shown per seat | |
| ONLINE-23 | 13-online.md | Online | IMPLEMENTED | server/rooms.ts, server/index.ts, src/scenes/OnlineScene.ts, src/scenes/GameScene.ts | Room recycles into an unlocked lobby on the same code, unit-tested; GameScene forwards `{client, code, seat}` to the results screen | WinScene button not yet added |
| ONLINE-24 | 13-online.md | Online | IMPLEMENTED | same as ONLINE-23 | Whole lifecycle exists and is tested except the Results→Lobby press | WinScene button not yet added |
| ONLINE-25 | 13-online.md | Online | IMPLEMENTED | src/net/protocol.ts, server/rooms.ts, src/scenes/GameScene.ts | `winningMove {seat, cardsPlayed}` on game over (counts only, no card identities); GameScene resolves it to the results line | WinScene rendering unverified |
| AI-03 | 06-ai-turns.md | AI turns | ALREADY-SATISFIED | — | Think delay already 250-900ms, capped, scaled by settings | |
| AI-04 | 06-ai-turns.md | AI turns | VERIFIED | src/scenes/GameScene.ts | `presentAiMove` — cards the AI lays down fly out of its seat via `seatPosition()` | |
| AI-05 | 06-ai-turns.md | AI turns | VERIFIED | src/scenes/GameScene.ts | Rearranged table cards travel from where they were, rather than the board being replaced | |
| AI-06 | 06-ai-turns.md | AI turns | VERIFIED | src/ui/feel.ts, src/scenes/GameScene.ts | `moveWeight` picks the band: a draw is `fast`, a table rebuild is `major`. Unit-tested in `tests/feel.test.ts` | |
| AI-07 | 06-ai-turns.md | AI turns | VERIFIED | src/scenes/GameScene.ts | The move itself is now presented, not instant — time moved from pre-move thinking to showing what happened | |
| AI-08 | 06-ai-turns.md | AI turns | VERIFIED | src/scenes/GameScene.ts | `presentingUntil` holds the board read-only for a reading beat before control returns | |
| AI-09 | 06-ai-turns.md | AI turns | ALREADY-SATISFIED | — | `ai.why.*` off/simple/detailed | |
| AI-10 | 06-ai-turns.md | AI turns | ALREADY-SATISFIED | — | Emote bubble anchored at the acting seat | |
| AI-12 | 06-ai-turns.md | AI turns | ALREADY-SATISFIED | — | Per-personality forced-draw emote and line | |
| AI-13 | 06-ai-turns.md | AI turns | ALREADY-SATISFIED | — | `AI_SPEED_SCALE` + the Settings pace row | |
| AI-14 | 06-ai-turns.md | AI turns | VERIFIED | src/scenes/GameScene.ts | Cards move together under one band rather than one animation per mutation | |
| AI-15 | 06-ai-turns.md | AI turns | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | A `huge` AI rearrangement raises the MEXEU BONITO! banner | |
| AI-17 | 06-ai-turns.md | AI turns | IMPLEMENTED | src/core/persistence.ts, src/core/settings.ts, src/scenes/GameScene.ts | `Progress.headToHead` tallied per character on every finished local match | Not yet shown on the results screen |
| PACE-07 | 07-match-pacing.md | Pacing | VERIFIED | src/ui/feel.ts | `moveWeight` classifies draw / simple / big / huge from committed state only | |
| PACE-08 | 07-match-pacing.md | Pacing | VERIFIED | src/scenes/GameScene.ts | Boring turns are compressed, interesting ones get the longer band | |
| PACE-09 | 07-match-pacing.md | Pacing | VERIFIED | src/ui/feel.ts, src/scenes/GameScene.ts | Duration comes from what changed, not a per-turn constant | |
| PACE-10 | 07-match-pacing.md | Pacing | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | MEXEU BONITO! and ÚLTIMA CARTA!, both rare and once-only per occurrence | |
| PACE-12 | 07-match-pacing.md | Pacing | ALREADY-SATISFIED | — | Recent-move outlines already mark what changed | |
| PACE-13 | 07-match-pacing.md | Pacing | VERIFIED | src/core/intensity.ts, src/scenes/GameScene.ts | Hand counts grow and re-word at 3/2/1; `tests/intensity.test.ts` | |
| PACE-15 | 07-match-pacing.md | Pacing | VERIFIED | src/core/intensity.ts, src/scenes/GameScene.ts | The deck sprite visibly thins and turns amber as it drains | |
| PACE-17 | 07-match-pacing.md | Pacing | VERIFIED | src/audio/sfx.ts | Per-play pitch and volume spread on frequent cues (JUICE-11) | |
| END-01 | 08-endgame.md | Endgame | VERIFIED | src/core/intensity.ts, src/scenes/GameScene.ts | 3 cards → `watch`: a size bump only | |
| END-02 | 08-endgame.md | Endgame | VERIFIED | src/core/intensity.ts, src/scenes/GameScene.ts | 2 cards → `threat`: larger, amber, and intensity goes hot | |
| END-03 | 08-endgame.md | Endgame | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | ÚLTIMA CARTA! fires once per seat, at that seat | |
| END-04 | 08-endgame.md | Endgame | VERIFIED | src/scenes/GameScene.ts | The local player's last card renders 1.18x as the focal object; an opponent's shows as ÚLTIMA! at their seat | |
| END-05 | 08-endgame.md | Endgame | VERIFIED | src/scenes/GameScene.ts | Hand counts are promoted in size as the endgame approaches | |
| END-06 | 08-endgame.md | Endgame | VERIFIED | src/scenes/GameScene.ts | Louder pickup on the last card — no slow motion | |
| END-07 | 08-endgame.md | Endgame | ALREADY-SATISFIED | — | `rules.ts` only checks a winner after the confirm gate | |
| END-08 | 08-endgame.md | Endgame | VERIFIED | src/core/objective.ts, src/localization/i18n.ts | New `handEmptyInvalid` phase: "QUASE! Arrume a mesa para bater." Unit-tested | |
| END-09 | 08-endgame.md | Endgame | VERIFIED | src/core/objective.ts, src/localization/i18n.ts | New `canBater` phase: "PODE BATER!" Unit-tested | |
| END-11 | 08-endgame.md | Endgame | ALREADY-SATISFIED | — | The win only happens inside the player-invoked confirm | |
| END-16 | 08-endgame.md | Endgame | ALREADY-SATISFIED | — | Stalemate is a distinct ending in rules, results and copy | |
| END-17 | 08-endgame.md | Endgame | VERIFIED | src/core/intensity.ts, src/scenes/GameScene.ts | Deck art thins at 12 and again at 5 remaining | |
| END-18 | 08-endgame.md | Endgame | VERIFIED | src/scenes/GameScene.ts, src/localization/i18n.ts | "fim do baralho" appears at the pile once exhaustion is imminent | |
| MEXE-03 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | Velocity-derived lean, capped at 6 degrees, reset on drop and on cancel; skipped under reduced motion | |
| MEXE-11 | 04-mexe-mode.md | Mexe | VERIFIED | src/scenes/GameScene.ts | MEXEU BONITO! on a `huge` committed transformation, for the player's own turn as well as the AI's | |
| MEXE-12 | 04-mexe-mode.md | Mexe | VERIFIED | src/ui/feel.ts, tests/feel.test.ts | simple/big/huge thresholds from committed before/after only — a test asserts intermediate dragging cannot inflate it | |
| JUICE-17 | 14-game-feel.md | Game feel | VERIFIED | src/ui/feel.ts | Timing constants centralised in one small module; no framework | |
| JUICE-19 | 14-game-feel.md | Game feel | VERIFIED | src/ui/feel.ts | `moveWeight` reads committed state only | |
| JUICE-20 | 14-game-feel.md | Game feel | ALREADY-SATISFIED | — | No repeating idle tweens on the board; the active-seat ring is static | |
| JUICE-21 | 14-game-feel.md | Game feel | ALREADY-SATISFIED | — | Low-frequency ambience loop, already in GameScene and now also in the menu | |
| JUICE-23 | 14-game-feel.md | Game feel | ALREADY-SATISFIED | — | Every effect maps to validity, ownership or what changed | |
| ACCESS-01 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | ✓/✗ badge plus solid-vs-dashed outline — shape, not hue alone | |
| ACCESS-02 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | `fontScale()` is a single choke point through `fontStyle` | |
| ACCESS-03 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | `motionScale()` gates cosmetic tweens and preserves end state | |
| ACCESS-06 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | 34x31 touch floor on buttons, padded card hit rects | |
| ACCESS-10 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | One short blocking reason plus a per-meld badge at the problem | |
| ACCESS-13 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | Badge, reason line and checklist are all visual, none audio-only | |
| ACCESS-14 | 15-accessibility-readability.md | Accessibility | ALREADY-SATISFIED | — | Reduced motion returns to the same end state rather than dropping information | |
| MOBILE-01 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Hand-authored portrait world, not a scaled landscape one | |
| MOBILE-02 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Portrait bands: status, table, hand, pinned action bar | |
| MOBILE-04 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Tap-select then tap-place, with drag kept | |
| MOBILE-06 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Coarse-pointer hit boxes grow past the art | |
| MOBILE-08 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | FEITO/COMPRAR are the largest, on the bottom row | |
| MOBILE-09 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Zoom steps with +/- and a pan surface | |
| MOBILE-12 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Both orientations supported; manifest allows any | |
| MOBILE-20 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Tap, place, confirm and blocked all produce sound plus a visual | |
| MOBILE-22 | 12-mobile.md | Mobile | ALREADY-SATISFIED | — | Safe-area insets handled in `index.html` and `main.ts` | |
| ZOOM-MASK | (defect found) | Mobile/zoom | VERIFIED | src/scenes/GameScene.ts | Phaser 4 silently ignores `setMask()` under WebGL, so the zoomed table was never actually clipped. Replaced with a Mask filter; zoom/pan e2e all pass | |
| RESULT-01 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts | Staged reveal (~930ms) — banner, then story + headline, then the rest; captures at t=0 / t=450ms / settled. Reduced motion returns everything on frame 1 | |
| RESULT-02 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts | The winning move is now a 9pt headline under the story chip and is the LAST thing dropped when space is tight (it used to be the first) | |
| RESULT-03 | 09-results-rematch.md | Results | VERIFIED | src/core/results-summary.ts, src/scenes/WinScene.ts, src/localization/i18n.ts | `matchStoryKey()` → pileOut / comeback / close / stylish / runaway or null; 8 unit tests assert the computed key. Rendered as a gold chip | |
| RESULT-04 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts | REVANCHE is the only primary button; TROCAR JOGADORES goes to setup; MENU is tertiary | |
| RESULT-05 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts | Rematch keeps the lineup verbatim; avatars, emotes and a character reaction line are preserved | |
| RESULT-06 | 09-results-rematch.md | Results | IMPLEMENTED | src/core/persistence.ts, src/core/settings.ts, src/scenes/GameScene.ts | `Progress.headToHead` exists and is tallied per character on every finished local match | Not yet rendered on the results screen |
| RESULT-07 | 09-results-rematch.md | Results | ALREADY-SATISFIED | src/scenes/WinScene.ts | No score anywhere; trimmed to cards-played only | |
| RESULT-08 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts | Per-seat cards-played rendered under each avatar column so the seats line up and compare; hidden when every counter is zero | |
| RESULT-09 | 09-results-rematch.md | Results | IMPLEMENTED | src/scenes/GameScene.ts | GameScene now passes `finalTable` to the results screen on both the local and online paths | WinScene does not render it yet |
| RESULT-10 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts | A loss gets the same staged polish — story chip, what the winner did, their reaction — and no punitive copy. Checked on a real played-out loss | |
| RESULT-11 | 09-results-rematch.md | Results | ALREADY-SATISFIED | — | Rematch goes straight into the game, no setup detour | |
| RESULT-12 | 09-results-rematch.md | Results | VERIFIED | src/scenes/WinScene.ts, src/localization/i18n.ts | Same-seed and new-seed replay removed from the results hierarchy; the seed control already lives behind SETUP > AVANÇADO | |
| RESULT-13 | 09-results-rematch.md | Results | VERIFIED | src/localization/i18n.ts, src/scenes/WinScene.ts | 8 new `ai.line.<personality>.wonMatch/.lostMatch` keys, looked up exactly like the existing moment lines | |
| RESULT-14 | 09-results-rematch.md | Results | ALREADY-SATISFIED | — | No XP, currency or daily fields anywhere; the telemetry guard stays green | |
