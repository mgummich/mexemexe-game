# Phase 20 UX/Onboarding Audit — 2026-09-11

Read-only audit of first-time user experience, tutorial clarity, rules documentation accuracy, and localization completeness. No code changes, no tests.

## 1. Menu/Setup Flow Issues

1. **MenuScene language button placement redundant.** Button text shows `t('menu.language')` (localized word for the other language: "English" in PT, "Português" in EN). Icon would fit better, or placement in settings-only. _File: `src/scenes/MenuScene.ts:116-121`, duplicates language toggle already in settings panel._

2. **SetupScene AI personality cycle feedback unclear.** "Toque para trocar" (tap to change) is small gray text below the name; a player may not realize tapping the avatar cycles it. No visual feedback on a successful cycle (name changes, but no highlight/glow/toast). _File: `src/scenes/SetupScene.ts:71-79`._

3. **Setup screen lacks visual hierarchy for player slots.** Seats 1-3 stack vertically with no visual separator; at 4 players the list is cramped. A subtle line or card-like frame per seat would help. _File: `src/scenes/SetupScene.ts:57-81`, `playable, not blocking`._

## 2. Tutorial/Onboarding Gaps

1. **Tutorial step 6 (joker) strategy text duplicates rules panel.** Copy reads: "Curinga vale por qualquer carta..." matches `rules.body` exactly. Opportunity to teach a play scenario (e.g. "save the joker for your last card") or reinforce a specific rule. _File: `src/localization/i18n.ts:146 (pt)`, `src/tutorial/script.ts` step 6._

2. **Tutorial never teaches drag-to-invalid-destination and the red ✗ badge.** Steps 7-10 teach MEXE rearrangement and invalid-meld rejection, but all steps use allowed-actions gates — a learner never sees what "not allowed" looks like during a real tap. Ghost preview (hold to see legality) is taught in step 9, but only as "red border," not as a failure path. _File: `src/tutorial/script.ts:49-143`, step coverage._

3. **No onboarding for "draw only on pass" rule.** Tutorial step 11 shows COMPRAR for the first time with copy "Sem uma boa jogada?" (no good move). A first-time player may assume draw is always available (like many TCGs), not just on pass. This rule appears in `rules.body` but not reinforced in gameplay hints. _File: `src/localization/i18n.ts:151 (pt)`, missing from tutorial steps._

4. **Tutorial skips multi-turn flow.** All 12 steps occur in a single turn. A learner never confirms a turn, sees the AI opponent play, or manages the turn counter. `game.turnOf` is used in GameScene but not demonstrated in tutorial. _File: `src/tutorial/script.ts`, last step never confirms and returns to menu._

## 3. Rules/Help Inaccuracies

1. **Help text (uiHelp) claims "ghost preview" is a hold-gesture; actually tap+hold or select.** Copy says "segure a carta" (hold the card) but the code shows selection or hover drives ghostPreview. On desktop it's `pointerover` (hover); on touch it's `pointerdown` (tap). Desktop players see preview on hover, touch players need to select and hold or tap the card. _File: `src/localization/i18n.ts:92 (pt)`, mismatches `src/ui/helpers.ts:17-25` mode names._

2. **Rules panel says "Ás não faz volta com K-A-2" (ace doesn't wrap K-A-2); never clarifies this is a *rule*, not player choice.** A player who tries K-A-2 and gets `reason.runWrap` may blame themselves instead of understanding the rule. Phrasing should be "K-A-2 is not allowed — ace is either low or high, never both in the same run." _File: `src/localization/i18n.ts:91 (pt), 313 (en)`, rules.body._

3. **Tutorial step 10 copy says "Arrume tudo de volta (o 9♣ pertence ao trinca)" — but doesn't explain WHY the 9 can't move.** A learner sees the 9♣ belongs to the set, but not that it's because "you can only move cards you just played this turn" or "table cards can never leave the table." This rule is in `reason.cardMissing` but never explained outside the error message. _File: `src/localization/i18n.ts:150 (pt)`, `src/tutorial/script.ts:123-127`._

4. **"Trinca" and "sequência" terminology used in PT; "group" and "run" in EN — but "trinca" is explained nowhere in the first-time UX.** RULES button defines both, but SetupScene and GameScene use "Toque em uma carta..." for both meld types without naming them. An EN player learns "run" and "group"; a PT player learns only via the RULES panel or tutorial steps 2-5. _File: `src/localization/i18n.ts:142-145, 196-197`._

5. **Win condition copy conflates "empty hand" and "draw pile exhaustion."** PT: "Monte acabou! {name} vence com menos cartas" (draw pile empty! X wins with fewest cards). EN: "Draw pile empty! {name} wins with the fewest cards." Both are correct, but a player who wins via empty hand sees the same template, which reads as "I won because the draw pile emptied," not "I won by going out." _File: `src/localization/i18n.ts:117 (pt), 338 (en)`, both branches use `stalemate` copy for draw-pile-exhaustion, not empty-hand win._

## 4. Unclear/Generic Validation Messages

1. **`reason.notAMeld` reads as jargon.** Copy: PT "Tem jogo inválido na mesa", EN "There is an invalid meld on the table." Neither specifies what makes it invalid (too few cards? non-consecutive? repeated suit?). When combined with a ✗ badge on every invalid meld, a player must tap each badge to read the specific reason. Batch diagnosis would help: show the first reason inline, let the player spot-check badges if they want detail. _File: `src/localization/i18n.ts:121, 342`._

2. **`reason.jokerUnassignable` is vague.** PT: "Curinga não pode virar nenhuma carta válida aqui", EN: "Joker can't stand for any legal card here." Doesn't explain *why* — is the slot already filled? Is the rank/suit impossible? On a crowded table with multiple melds, this message alone doesn't tell a player which meld(s) reject the joker. _File: `src/localization/i18n.ts:131, 352`._

3. **Online errors use raw server codes in fallback paths.** If a server message arrives untranslated, `errorMessage()` falls back to the raw code (e.g. `room_full`, `seat_gap`). The PT user sees English. Checked: all codes in `src/net/errors.ts` map to i18n keys, but if a new server message adds a code without a translator, this breaks. _File: `src/net/errors.ts`, `src/localization/i18n.ts` online.err.* keys._

## 5. Local/Online Flow Issues

1. **OnlineScene join-code entry has no visual feedback on invalid character input.** Player types a number (the input allows it), nothing happens; no beep, no visual flash. Then they press ENTER and get "invalid code" error. _File: `src/scenes/OnlineScene.ts:61-62` (wireCodeEntry), accepts printable chars but no validation UI._

2. **OnlineScene ready state shows "PRONTO ✓" for self, "AGUARDANDO" for opponent — but never explains what happens after both are ready.** A first-time player may not realize pressing START auto-launches the game, and may wait for a second action. No tooltip or help text on the START button explains "starts the match immediately." _File: `src/scenes/OnlineScene.ts`, no ready-state explanation in i18n._

3. **Reconnect UX never announces reconnection succeeded.** If a player's socket drops and auto-reconnects, the board unfreezes with no toast/flash/sound. They must infer "we're back on" from board responsiveness. `online.opponentReconnected` fires for the *opponent*, not for self. _File: `src/scenes/GameScene.ts` online branch, no self-reconnected message._

## 6. Mobile/PWA UX Issues

1. **Portrait rotate hint appears on every MenuScene launch.** Copy: "Gire o celular para ter mais espaço" (rotate for more space). A first-time player sees this, but every subsequent return to menu (after quitting a game) sees it again. No "got it, don't show again" option; hint is always-on. _File: `src/main.ts`, DOM overlay, `a11y.rotateHint` read once._

2. **Mobile helper-mode toggle in settings is labeled "AJUDA VISUAL" (VISUAL HELP) but never explains what each mode does.** Beginners, Standard, Expert show no preview or example. A player must trial each and switch back to understand the difference. The full explanation is only in `rules.uiHelp` (bottom of RULES panel). _File: `src/localization/i18n.ts:79-82 (pt)`, settings panel builds radio buttons with no desc._

3. **PWA install banner (if shown) never mentions offline play.** No copy addresses "you can play this offline" or "it works without internet." A user who installs and loses signal may think the app is broken, not realizing local play is guaranteed to work. _File: Not in codebase — PWA manifest handles install, not copy._

## 7. Endgame/Result Screen Issues

1. **WinScene stalemate copy reads as victory.** PT: "Monte acabou! {name} vence com menos cartas" (draw pile empty! X wins with fewest). EN: "Draw pile empty! {name} wins with the fewest cards." A player who went out sees `win.wins` ("X won!"); a player who ran out of draw pile sees `win.stalemate` with the same emphasis. Both use the same banner graphic and music. The distinction is only in the body text — no visual urgency change for a draw-pile end. _File: `src/scenes/WinScene.ts:78-82`, uses `win.stalemate` key for the draw-pile-exhaustion message._

2. **WinScene results row missing for online matches.** Results table (`win.statLine`: "X turns · Y cards played · Z draws") doesn't populate for online play — all counters show 0 because the playlog only observes the local player's turns. A user who won online sees no summary of their own play. Local-play matches show full stats. _File: `src/scenes/WinScene.ts:99-130`, checks `data.online` and skips results._

3. **No "New Game" / "Main Menu" disambigution on WinScene.** Buttons say "NOVA PARTIDA" (NEW GAME) and "MENU" (MENU). On an online match, "NEW GAME" is unavailable (no rematch) and only "MENU" works. Local play shows both. No disabled-state text or tooltip on the greyed "NEW GAME" button explains why. _File: `src/scenes/WinScene.ts:130-150`, conditionally builds buttons._

## 8. Localization Gaps

1. **"Você" (You) is used everywhere for the human player, but no honorific or distinction in EN.** PT respects formality with "Você" (formal you). EN uses "You" flatly. Minor, but PT feels more personable. Not a bug, just an asymmetry in voice. _File: `src/localization/i18n.ts:11, 232`._

2. **Cosmetics panel labels "Você" for the player avatar, but setup screen says "Você" in the player list.** Redundant in both places. On cosmetics, could say "Jogador" (Player) or leave it; on setup, "Você" is clear. Minimal friction, but read-twice moment. _File: `src/localization/i18n.ts:179 (cosmetics.avatar.player)`, `src/scenes/SetupScene.ts:65`._

3. **No PT-BR accent marks in some labels due to font fallback.** PT uses "Você," "Ás," "É," but the pixel font may not render accents perfectly at small sizes (noted in STATUS.json). Already acknowledged, but worth noting for new localizers. _File: STATUS.json line 169: "PT accents slightly rough at 6-7px font sizes"._

## 9. Dead-End Screens / Hover-Only Critical UX

1. **No way to skip the tutorial once started.** TUTORIAL button leads to GameScene in tutorial mode. The SKIP button advances steps, but to exit early a player must close the browser tab. No "quit tutorial early and return to menu" option. _File: `src/tutorial/director.ts`, TutorialDirector never exposes an early-exit action._

2. **FEITO button disabled-state feedback is subtle.** On a coarse pointer (touch), the disabled FEITO button shows a lighter tint and a ✕ prefix. Hovering is not an option. Tapping produces `onFeitoBlocked()` which updates the status line — but a player who taps and doesn't watch the status line sees no feedback. The visual tint is too light against busy table art. _File: `src/scenes/GameScene.ts:1453-1467`, onFeitoBlocked prints to status, no toast/sound._

3. **Online error screen (unreachable server) has no retry button.** If the server is down when OnlineScene loads, the screen shows "Can't reach the game server. Is it running?" and a BACK button. No "retry connection" option — player must backtrack to menu and try again. _File: `src/scenes/OnlineScene.ts:117-119`, error phase trapped with only VOLTAR (back) available._

4. **Settings panel APAGAR DADOS (reset data) has no undo.** Tapping the button opens a YES/NO confirm, but NO only closes the confirm, doesn't provide a safety window (e.g. "data deleted, undo for 5 seconds"). If a player taps YES by accident, settings and progress are gone. _File: `src/ui/settings-panel.ts`, calls `settings.reset()` and `localStorage.clear()` on confirm with no timer._

## 10. Top 10 Fixes by Impact

1. **Clarify draw-only-on-pass rule in gameplay hints.** Add `game.drawOnlyOnPass` i18n key and show it once per first game or in tutorial step 11. Currently `reason.noHandCard` is the only signal (too late). _File: `src/localization/i18n.ts`, `src/tutorial/script.ts:128-133`._

2. **Add a self-reconnected message for online play.** Wire `online.selfReconnected: "You're back in the room."` and show it on `netClient` reconnect success. Currently only `online.opponentReconnected` fires. _File: `src/net/client.ts`, `src/scenes/GameScene.ts` online branch._

3. **Expand `reason.jokerUnassignable` to name the specific issue.** Change to reason code + structured data: `{ reason: 'jokerUnassignable', context: { meldId, issue: 'slotFilled' | 'rankImpossible' } }` and build localized copy (e.g. "That suit is already in this group" or "The joker can't reach card 10 in a sequence of 2-3-4"). _File: `src/rules/types.ts`, `src/localization/i18n.ts`._

4. **Give SetupScene AI personality cycle visual feedback.** On cycle, glow the avatar for 200ms or swap the name+avatar with a brief fade. Currently only the name changes, silently. _File: `src/scenes/SetupScene.ts:73-76`, add tween on rebuild._

5. **Add keyboard/controller flow bypass for tutorial.** Allow ESC to exit the tutorial to menu (with a "abandon tutorial?" confirm). Currently no way out except closing the tab. _File: `src/tutorial/director.ts`, wire keyboard input._

6. **Rename or reposition MenuScene language button.** Either (a) move it to settings-only, or (b) use an icon (🇬🇧🇧🇷) instead of text to save space. Currently duplicates settings panel toggle. _File: `src/scenes/MenuScene.ts:116-121`._

7. **Improve WinScene stalemate visual distinction.** Add a different banner/overlay tint for draw-pile-exhaustion wins (e.g. desaturated, or a different graphic). Currently identical to normal win except message text. _File: `src/scenes/WinScene.ts:65-76`, conditionally apply visual treatment._

8. **Wire a "retry connection" button on OnlineScene error screen.** For 'unreachable' errors, show TENTAR DE NOVO (RETRY) alongside VOLTAR. Retries the initial connect without backtracking to menu. _File: `src/scenes/OnlineScene.ts:117-149`, add retry action to error phase._

9. **Suppress rotate hint on repeat visits.** Store `rotateHintShown` in settings and show only on first-ever visit, not every menu return. PT: "Vire o celular para ter mais espaço" is educational on launch, annoying on re-entry. _File: `src/main.ts`, `src/core/settings.ts`._

10. **Add undo/grace for data-destructive actions.** On APAGAR DADOS (reset data), show a toast with "Dados apagados. Desfazer?" (Data cleared. Undo?) for 5 seconds. Clicking undo restores from a backup before the wipe. _File: `src/ui/settings-panel.ts`, `src/core/settings.ts`._

---

## Summary

**Highest-value findings (blocking first-time play):**
- Draw-only-on-pass rule never taught in tutorial.
- Joker unassignability error is vague (3 different causes, one generic message).
- Tutorial never demonstrates invalid-move rejection UX.

**Usability friction (doesn't block, but confuses):**
- Stalemate win looks and feels identical to normal win.
- SetupScene AI cycle lacks visual feedback.
- Ghost preview description mismatches actual mechanics (hold vs. select+hold vs. hover).

**Deferred / out-of-scope:**
- Small-iPhone (SE/mini) layout confirmation (no runtime installed).
- Real-device iOS safari and PWA standalone install testing.
- Per-IP rate limit behind reverse proxies (known limitation).

**No P0 bugs found.** All issues are UX clarity, not game-breaking defects. Rules engine, online protocol, and tutorial logic all work correctly; this audit focuses on player guidance and visual feedback.


## Phase 20 outcome (2026-09-11)

A plan (`/private/tmp/.../phase20-plan.md`, not committed) was written after re-verifying every claim in this audit against source. Four claims above did not hold up and were rejected as **false findings**:

- "No way to skip the tutorial" — FALSE. The SKIP button exits to menu (`GameScene.ts`), and ESC opens the pause menu with QUIT.
- "WinScene greys out NEW GAME online with no reason" — FALSE. The online path builds only a MENU button; nothing is greyed out.
- "Online stats read 0" — FALSE by design; stats are suppressed online, and the reason is documented in `WinScene.ts`.
- "Rotate hint never goes away" — FALSE. It auto-hides after 6s (`main.ts`).

Two more items from "Top 10 Fixes by Impact" were **rejected for this phase, not disproven**:

- Splitting `reason.jokerUnassignable` into structured sub-reasons — `ReasonCode` is part of the client/server protocol, so this is a protocol change, not UX polish. The copy was improved in place instead (names both possible causes in one sentence).
- Undo/grace window on reset-data — a YES/NO confirm already guards the destructive action; an undo buffer is new machinery for a rare action.

Everything else concrete and actionable was **implemented**:

- Menu first-run nudge toward TUTORIAL (section 9, item 1 in Top 10).
- Tutorial step 10/11 copy now explains the "cards already on the table stay put" and "draw only on pass, no discard pile" rules (section 2 items 2–3, section 3 item 3).
- `rules.body` gained explicit no-discard-pile and table-cards-stay-on-table lines (section 3).
- Reason-code copy reworded for `notAMeld`, `groupDuplicateSuit`, `noHandCard`, `tooManyJokers`, `jokerUnassignable`, `cardMissing` (section 4, section 10 item 3 partially — names both causes without a protocol change).
- Mobile Mexe-mode hint reworded (section 6 item 2, adjacent).
- Mobile JOIN now opens a real soft keyboard via a hidden DOM `<input>` (section 5 — was a genuine hard blocker on touch, not called out explicitly in the numbered list above but found during plan verification).
- OnlineScene error phase gained a TENTAR DE NOVO / TRY AGAIN retry button (section 9 item 3, section 10 item 8).
- Self-reconnect now shows a notice, same pattern as the opponent's (section 5 item 3, section 10 item 2).
- WinScene stalemate uses its own title, MONTE VAZIO! / PILE EMPTY! (section 7 item 1, section 10 item 7).
- SetupScene AI-cycle now has a visual pop, and gained a settings gear so language/settings are reachable without backing out (section 1 item 2, section 10 item 4).

See `docs/STATUS.json` → `phase20` for the exact wording, files touched, and verification evidence (`npm run test` 531/531, lint/build clean, `npm run verify`/`verify:pwa`/`verify:multiplayer`/`verify:cross` all green modulo one pre-existing fps-flake test confirmed unrelated to this phase).

---

## Review pass addendum (Opus, same day)

Four findings in this document did not survive verification against source and were NOT implemented:

- §9.1 "No way to skip the tutorial" — false. The SKIP button calls `gotoScene(this, 'menu')` (`src/scenes/GameScene.ts`, tutorial overlay), and ESC opens the pause menu, which has QUIT.
- §7.3 "NEW GAME greyed with no reason online" — false. The online branch of `WinScene.create` builds a single MENU button; nothing is greyed.
- §7.2 "Online stats read 0" — false by design. Stats are suppressed for online matches (`showStats = !data.online && ...`) with the reason documented inline.
- §6.1 "Rotate hint shows on every menu launch with no way out" — false. The hint auto-hides after 6s (`src/main.ts`).

Two further findings were rejected on scope, not accuracy:

- §4.2 / top-10 #3, splitting `reason.jokerUnassignable` into structured sub-reasons — `ReasonCode` crosses the client/server protocol, so this is a protocol change, not UX polish. The copy now names both causes in one sentence instead.
- Top-10 #10, an undo window on APAGAR DADOS — a YES/NO confirm already guards it.

Additions made during review, beyond the implementation plan:

- EN terminology was inconsistent after the copy pass (Group / set / trinca all for the same meld). Unified on "Trinca", self-glossed on first use in `rules.body`. PT dropped the capitalised "Coringa" back to the dictionary's existing lowercase "curinga".
- `online.codeHintTouch`: the join screen told phone players to "press ENTER", a key no soft keyboard shows.
- A touch-context regression test for the mobile join fix now lives in `e2e-multiplayer/multiplayer.spec.ts`.

See `docs/STATUS.json` → `phase20` for the implemented list, final verification numbers, and remaining issues by priority.
