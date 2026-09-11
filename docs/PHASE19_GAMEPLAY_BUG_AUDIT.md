# Phase 19 Gameplay Bug Audit — 2026-09-11

## 1. Current Gameplay/Rules Status

The codebase ships a complete, tested rules implementation with the following canonical rules encoded in `src/rules/rules.ts`:

- **Deck**: 108 cards (2 full 52-card decks + 4 jokers total) or configurable per `RulesConfig`
- **Deal**: 7 cards per player to 2–4 players; remainder becomes draw pile
- **Win condition**: Empty hand after a confirmed turn (no draw-pile exhaustion scenario)
- **Draw-pile exhaustion fallback**: If draw pile empties on someone's draw, game ends immediately; fewest hand cards wins (ties broken by earliest seat)
- **Meld requirements**: Minimum 3 cards; runs (consecutive same suit) or groups (same rank, unique natural suits)
- **Ace rules**: Ace-low (A-2-3) and ace-high (Q-K-A) supported per run; no wrap (K-A-2 rejected)
- **Jokers**: Max 1 per meld; at least 1 natural card per meld; joker fills an unoccupied slot
- **Groups (trincas)**: 3–4 cards same rank; each natural must be a different suit; 1 joker can fill an unused suit
- **Turn mechanics**: Draw only when not playing; must add ≥1 hand card to confirm; empty hand wins; table cards stay committed (no return to hand after confirm)
- **Draft state**: Temporary, client-side; invalid intermediate states allowed; final submission must be legal
- **Undo/reset**: Restores exact turn-start state including table cards and hand

## 2. Known Open Failures/Issues Carried from Prior Phases

### Phase 18 Multiplayer Audit (Fixed Issues)
All P1–P3 findings from Phase 18 have been addressed:
- Room leak and permanent softlock (P1) ✓
- Legal move rejected late-game due to payload cap (P1) ✓
- Silent drop of submit during reconnect (P1) ✓
- Unrecoverable lobby after expired session (P2) ✓
- Corrupt process continuation on uncaught exception (P2) ✓
- Stale lobby presence after disconnect/reconnect (P2) ✓
- Lobby survival on app sleep (P2) ✓

### Phase 18 Remaining Risks (Not Fixed, Acknowledged)
1. **P2 — per-IP cap behind reverse proxy**: `connectionsByIp` keys on raw `req.socket.remoteAddress`. Behind a proxy, all clients share the proxy's address. Mitigation: operators must not proxy WebSocket or raise cap; documented in `docs/OPERATIONS.md`.
2. **P2 — room codes 5 chars, 28-symbol alphabet (17.2M combos)**: Per-connection throttle (10 failed lookups, then close) + per-IP cap bound guess rate to ~200 attempts/IP/connection. Longer codes deferred; per-IP failed-join counter is the next step.
3. **P3 — no cross-process room state**: Server restart loses all rooms; clients get `server_shutdown` and return to menu. Horizontal scaling/restart survival out of scope for online alpha.
4. **P3 — unhandledRejection is log-only**: No `await` on room-mutating paths; rejections cannot half-apply room state (throws can). Not a blocking issue.
5. **P2 — pre-existing flake**: `e2e/screenshot.spec.ts` "mobile-tap-move-invalid" intermittently loses one tap, reports wrong reason. Reproduces pre-Phase-18 (verified by stashing). Local-play timing, no online path; left alone.

### Bug Hunt Audit (Phase 18 Follow-up)
- One P1 confirmed and fixed: disconnected ready lobby seat could start a match (regression test added).
- No current failing unit, server, lint, or build checks (408/408 unit + 72/72 server at hunt start).

## 3. Suspected Bug Hotspots

| File | Line(s) | Concern | Severity |
|------|---------|---------|----------|
| `src/rules/rules.ts:247–291` | `canConfirmTurn()` | Validates draft legality; checks table-card preservation, hand-card addition, foreign-card rejection. Core validation gate. | P0 |
| `src/rules/rules.ts:292–351` | `applyConfirmedTurn()` | Applies confirmed draft; rewrites hand, melds, table, playlog entry. Any bug corrupts all downstream state. | P0 |
| `src/rules/rules.ts:373–390` | `drawAndEndTurn()` | Handles both normal draw and draw-pile exhaustion (fewest cards wins). Empty-hand win must not fire. | P0 |
| `src/rules/rules.ts:188–206` | `analyzeMeld()`, `isValidRun()`, `isValidGroup()` | Joker assignment, ace mode (low/high), repeated-suit rejection. If meld slips through, table is corrupted. | P0 |
| `src/rules/rules.ts:398–405` | `checkWinner()`, `fewestCardsWinner()` | Win detection: empty hand vs. draw-pile exhaustion. Wrong condition breaks game end. | P0 |
| `src/mexe-mode/draft.ts:19–…` | `DraftEditor` class | Undo/redo/reset state machine. If reset does not restore exact turn-start state, turn is corrupted. | P1 |
| `src/table/snap.ts:43–57` | `computeSnapTargets()`, `snapTargetFor()` | Ghost preview validation. If snap reflects illegal meld, UX lies; player may think move is legal and tap it. | P1 |
| `src/table/tap-destination.ts:10–…` | `resolveCardTapDestination()` | Routes card taps to hand, table, or discard based on current draft state. Logic errors route to wrong destination. | P1 |
| `src/net/viewToState.ts:15–36` | `viewToState()` | Reconstructs game state from server view; opponent hands are placeholders. If reconstruction is off, local rules checks fail. | P1 |
| `server/rooms.ts:213–220` | `startGame()` | Checks ready bits and connected seats. If a disconnected seat's ready bit is not cleared, game starts with missing player. | P1 |
| `server/rooms.ts:350–356` | `disconnect()` | Marks seat disconnected, sets grace timer. If grace timer logic is wrong, room stuck or prematurely reaped. | P1 |
| `server/rooms.ts:358–368` | `reconnect()` | Clears `disconnectedAt` on reconnect. If token mismatch or seat mismatch, reconnect silently fails, socket left orphaned. | P1 |
| `server/rooms.ts:316–349` | `advanceStalledTurns()` | Progresses turn when active seat past grace. If condition is off, room stalls or advances when it shouldn't. | P1 |
| `server/rooms.ts:393–414` | `sweep()` | Removes dead rooms. If room sweep is too aggressive, live rooms reaped; if too lenient, memory leaks. | P2 |
| `src/scenes/GameScene.ts:830–850` | AI turn execution and FEITO path | Calls `confirmTurn()` or `drawEndTurn()`. If AI hangs or produces invalid draft, game deadlocks. | P1 |
| `src/scenes/GameScene.ts:696–705` | Undo/redo/reset button handlers | Calls editor methods and records playlog. If playlog record is missed, replay is corrupted. | P1 |

## 4. Playwright CLI/Mobile Project Map

### Base Projects (playwright.config.ts)
- **chrome**: Desktop Chrome
- **firefox**: Desktop Firefox
- **safari**: Desktop Safari (macOS)
- **android chrome**: Pixel 7 landscape (emulated mobile)
- **ios safari**: iPhone 14 landscape (emulated iOS)
- **android chrome portrait**: Pixel 7 portrait
- **ios safari portrait**: iPhone 14 portrait
- **ipad**: iPad (gen 7) landscape

### Cross-Device Layout Tests (playwright.cross.config.ts)
- Runs all base projects
- Specs: `e2e-cross/layout.spec.ts`, `e2e-cross/rotate.spec.ts`

### Multiplayer Tests (playwright.multiplayer.config.ts)
- Spec: `e2e-multiplayer/multiplayer.spec.ts`

### PWA/Offline Tests (playwright.pwa.config.ts)
- Spec: `e2e-pwa/offline.spec.ts`

### Main Gameplay Suite (default playwright.config.ts)
- Spec: `e2e/screenshot.spec.ts` (45+ visual/gameplay tests)

## 5. iOS Simulator Availability

iOS simulators are installed and available:

```
iOS 26.4:
  iPhone 17 Pro
  iPhone 17 Pro Max
  iPhone 17e
  iPhone Air
  iPhone 17
  iPad Pro 13-inch (M5)
  iPad Pro 11-inch (M5)
  iPad mini (A17 Pro)
  iPad Air 13-inch (M4)
  iPad Air 11-inch (M4)
  iPad (A16)
```

Playwright browsers: Version 1.63.0 installed and ready.

## 6. Rules Coverage Map

### Fully Tested
- **Deck creation and shuffling** (`rules.test.ts: createDeck, shuffleDeck`)
- **Deal initial hands** (7 per player, correct count per `RulesConfig`)
- **Runs (sequences)** (ace-low, ace-high, no wrap K-A-2, gap detection)
- **Groups (trincas)** (3–4 cards same rank, unique suits, repeated-suit rejection)
- **Joker rules** (max 1 per meld, assignability, unassignable rejection)
- **Meld validation** (`isValidMeld`, `validateTable`, reason codes)
- **Confirm turn logic** (table preservation, hand-card requirement, foreign-card rejection)
- **Apply confirmed turn** (melds committed, hand updated, playlog recorded)
- **Draw and end turn** (normal draw, draw-pile exhaustion, winner detection)
- **Timer expiry** (same as draw/end)
- **Win condition** (empty hand, fewest cards on draw-pile exhaustion)
- **Serialize/deserialize** (round-trip state preservation)
- **Deterministic initial game creation** (same seed → same game)

### Partially Tested or Untested
- **Draw-pile exhaustion edge cases** (simultaneous empty hand and draw-pile exhaustion; fewest-cards tie-break logic under pressure)
- **Table card re-entry prevention under edge conditions** (extreme draft manipulation, undo/reset at table limit)
- **Joker-heavy late-game melds** (4–5 jokers on table, max-per-meld constraint under rearrangement)
- **Repeated-suit rejection in online context** (opponent hand placeholder vs. validation; cross-device view mismatch)
- **Ace mode persistence across undo/reset** (if table has 2-3 as ace-low, undo doesn't corrupt it to ace-high)

## 7. AI Coverage Map

### Fully Tested
- **SimpleAi**: Full decision tree (confirm vs. draw decision, hand vs. table placement)
- **RearrangerAi**: Complex rearrangement logic with heuristics
- **Personality styles**: 4 personalities (cida, juninho, bia, ze) with deterministic snapshots
- **Joker decision-making**: AI handles jokers in hand and on table correctly
- **Full-game smoke test**: AI plays 1–4 player games to completion
- **Personality expression**: Correct emotes and decision speed per personality
- **Hardening tests**: Recovery from invalid state, fallback to draw

### Partially Tested or Untested
- **AI decision quality under late-game draw-pile pressure** (optimal play when draw pile is nearly exhausted)
- **AI rearrangement under table-limit constraints** (complex melds near 44-card table max)
- **AI response to illegal intermediate draft states** (should never occur, but offline timeout/crash recovery untested)

## 8. Local/Online Parity Risks

| Area | Risk | Mitigation |
|------|------|-----------|
| **Hand redaction** | Opponent hand is placeholder array in `viewToState()`. If rules check accidentally touches opponent hand, local-only bugs slip online. | Unit tests only touch own hand; online suite spot-checks hand privacy. |
| **Draw-pile privacy** | Draw pile is placeholder. If code reads draw-pile details, crash on opponent's turn. | No client code reads draw-pile details; server always picks card. |
| **Table state sync** | Server sends table as array of melds. If meld order or card order is not deterministic, client renders different table. | Melds are sorted by server; cards sorted by `sortMeldCards()` on both sides. |
| **Draft rejection** | Client rejects draft early; server also validates. If reasons differ, UX says "legal" but submit fails. | Both run identical `canConfirmTurn()` logic; integration test checks parity. |
| **Turn order** | Clients keep copy of turn order; server is authoritative. If mismatch, turn skipped or double-played. | `viewToState()` rebuilds turn order from server view; turn:confirmed message is authoritative. |
| **Undo/reset recovery** | Undo is local-only. If local and online undo restore different state, game desync. | Undo only on local turns; online turns cannot be undone, only viewed. |

## 9. Missing Tests

| Area | Scope | Priority |
|------|-------|----------|
| Draw-pile exhaustion under edge conditions | Unit: two players, both near 0 hand cards, draw pile at 1 | P1 |
| Repeated-suit rejection across two decks | Unit: two ♣5 cards, one from each deck; group validation | P0 (already tested; caveat: cross-deck ace mode) |
| Table card re-entry impossible after confirm | Unit: multi-undo from post-confirm state | P1 |
| Joker assignment persistence across undo/reset | Unit: table holds a run with joker, player undoes and resets | P1 |
| Online vs. local hand redaction parity | E2E: two players online, one opponent's hand never visible | P1 |
| Server stalled-turn progression under disconnect | Unit: `advanceStalledTurns()` with grace timer elapsed | P1 (already tested) |
| Room sweep does not prematurely reap live rooms | Unit: sweep with a room at grace-timer boundary | P1 (already tested) |
| AI fallback to draw on invalid draft state | Unit: AI in corrupted state (should never occur, fallback untested) | P2 |

## 10. Affected Files

Core gameplay and rules logic:
- `src/rules/rules.ts` (464 lines; 21 exported functions; rules validation, meld analysis, win detection)
- `src/mexe-mode/draft.ts` (DraftEditor class; undo/redo/reset state machine)
- `src/ai/ai.ts` (SimpleAi, RearrangerAi; 3 personalities, decision tree)
- `src/game-state/store.ts` (GameStore; turn lifecycle, state transitions)
- `src/table/snap.ts` (SnapTarget computation; ghost preview validation)
- `src/table/tap-destination.ts` (Card tap routing logic)
- `src/net/viewToState.ts` (Online state reconstruction from server view)
- `src/scenes/GameScene.ts` (2709 lines; turn rendering, AI coordination, undo/redo UI)

Server:
- `server/rooms.ts` (RoomManager; 114 class, 8 exported types/constants; lobby, turn submission, disconnect/reconnect, room sweep)
- `server/index.ts` (Message wiring, caps, payload validation, room routing)

Tests:
- `tests/rules.test.ts` (18 describe blocks, covers all rule families)
- `tests/draft.test.ts` (DraftEditor undo/redo/reset; 2 describe blocks)
- `tests/snap.test.ts` (computeSnapTargets; 1 describe block)
- `tests/tap-destination.test.ts` (resolveCardTapDestination; 1 describe block)
- `tests/ai.test.ts` (AI decision-making, personality snapshots, smoke tests; 9 describe blocks)
- `tests/rooms.test.ts` (RoomManager lobby, disconnect/reconnect, game-start state; server unit tests)
- `e2e/screenshot.spec.ts` (45+ visual/gameplay tests covering local single/multi-player, tutorial, settings, joker rules, snap preview)
- `e2e-multiplayer/multiplayer.spec.ts` (9 online gameplay specs: create, join, ready, turn submission, reconnect, error handling, mobile layout)
- `e2e-cross/layout.spec.ts`, `rotate.spec.ts` (Cross-device responsive layout)
- `e2e-pwa/offline.spec.ts` (Offline cache, service worker, local play without network)

## 11. Top 10 Risks by Severity

| Rank | Severity | Issue | Location | Root Cause | Impact |
|------|----------|-------|----------|-----------|--------|
| 1 | **P0** | Draw-pile exhaustion winner detection failure | `src/rules/rules.ts:398–405` | If `checkWinner()` or `fewestCardsWinner()` is off-by-one or wrong sort, end-game wrong winner or infinite loop | Game ends with wrong player declared winner or game doesn't end |
| 2 | **P0** | Meld legality slip-through (repeated suit, too many jokers) | `src/rules/rules.ts:158–180` (groups), `src/rules/rules.ts:86–154` (runs) | If joker count or suit check is skipped, illegal meld commits to table | Corrupted table state, future melds invalid; player may discard thinking it's legal |
| 3 | **P0** | Confirm turn rejects legal play (false positive) | `src/rules/rules.ts:247–291` | If validation is overly strict (e.g., marks valid meld as foreign), player cannot confirm legal move | Player stuck, must reset (loosing time) or draw (conceding) |
| 4 | **P0** | Online state reconstruction mismatch | `src/net/viewToState.ts:15–36` | If placeholder counts/ordering are off, local rules checks reject legal online moves | Same as #3: legal move stuck in online game |
| 5 | **P1** | Undo/reset does not restore turn-start state | `src/mexe-mode/draft.ts` + `src/scenes/GameScene.ts:640–641` | If reset doesn't clear all melds, hand reverts only partially, or table melds are not restored, state corrupted | Player's next turn is played from corrupted board; future moves illegal |
| 6 | **P1** | Server allows game start with disconnected ready player | `server/rooms.ts:213–220` | If `startGame()` doesn't check current socket connection (only ready bit), game starts without that player | Stalled turn, player stuck, room may need restart |
| 7 | **P1** | Stalled turn not advanced on grace expiry | `server/rooms.ts:316–349` | If `advanceStalledTurns()` condition is off (grace timer, seat status), room doesn't progress | Players wait forever, must disconnect/reconnect |
| 8 | **P1** | Reconnect silently fails, socket orphaned | `server/rooms.ts:358–368` | If token mismatch or seat lookup fails, reconnect returns error but socket isn't closed or isn't re-notified | Player sees spinning loader, cannot recover without manual reload |
| 9 | **P1** | Snap preview shows illegal move as legal | `src/table/snap.ts:43–57` | If `computeSnapTargets()` misses a validation (e.g., repeated suit), ghost shows green checkmark | Player taps thinking move is legal, gets rejected with cryptic reason banner |
| 10 | **P2** | AI deadlock on invalid draft state | `src/scenes/GameScene.ts:830–850` | If AI produces invalid draft and `confirmTurn()` returns error but AI doesn't fall back to draw, game hangs | Board locked, game over without resolution |

## 12. Remaining Uncertainties / Deferred Checks

- **Ace mode edge cases**: Tables with both A-low and A-high runs on the same table, under undo/reset. Tested individually; cross-interaction untested.
- **Joker assignment stability**: If a meld with a joker is rearranged and undo is called, does joker restore to exact original position? Tested for small melds; large-table rearrangement untested.
- **Draw-pile exhaustion under concurrent 4-player draw**: All four players have ≥1 card; draw pile has 1 card. Next player draws, game ends. Tie-break by seat order tested; interleaving of "simultaneous" empty hand and exhaustion untested (not possible in real play, but state corruption risk if logic is wrong).
- **iOS simulator Playwright execution**: Playwright configs target `iPhone 14` emulated device. Real device (iPhone actual hardware) will differ in touch latency, screen size variant, Safe Area layout. PWA manifest serving and install prompt not fully tested on real iOS 17+ (Phase 17 carries this caveat).
- **Offline/online toggle boundary**: PWA offline mode disables online lobby entirely; re-enabling online requires page reload or app resume. Edge case: user backgrounded app in offline mode, comes back online — socket may not be re-established automatically.

---

## Phase 19 Testing Roadmap

**Immediate (P0 blocking)**: Boot/build, local game completion, server rejects malformed proposals, hand redaction parity.

**High-priority (P1 defects)**: Repeated-suit trinca rejection, joker max-one per meld, draw-pile exhaustion winner, undo/reset state restoration, lobby disconnect/reconnect lifecycle, stalled-turn advancement.

**Medium-priority (P2 hardening)**: AI fallback on error, snap preview accuracy, room sweep boundary conditions, offline/online boundary.

**Deferred (Phase 20)**: Per-IP failed-join counter, ace mode edge cases, real iOS device testing, Add-to-Home-Screen verification on hardware.

---

## Verification Outcome (post-audit)

This section supersedes the risk list above. The hotspots named earlier were
*suspicions* derived from reading the code, not reproduced defects. Every one of
them was probed and none survived.

### Result: no P0 and no P1 gameplay, rules, AI, parity or mobile bug was reproducible.

No file under `src/` or `server/` needed to change. The deliverable of this phase
is therefore coverage, not fixes.

### Suspicions refuted

| Suspicion | Outcome |
| --- | --- |
| `checkWinner` / `fewestCardsWinner` wrong sort or off-by-one | Refuted. `Array.prototype.sort` is stable, so a hand-count tie resolves to the earliest seat exactly as documented. Covered by `tests/rules.test.ts` and the `drawPile.length === 0` edge probe. |
| `isValidRun` / `isValidGroup` let a repeated suit or a second joker through | Refuted. Every required source-of-truth example passes, including `K♠ A♠ 2♠` wrap rejection and `7♥(deck 0) 7♥(deck 1) 7♣`. The `jokers.length > 1` guard fires before any window search. |
| `canConfirmTurn` falsely rejects legal plays | Refuted. 40 seeded full games produced no rejected-legal confirm and no accepted-illegal confirm. |
| `viewToState` placeholders make the server reject legal online moves | Refuted. Placeholder cards never reach validation — `canConfirmTurn` reads only `state.table` and the active player's own hand. `verify:multiplayer` stays green. |
| `rooms.ts startGame` can start with a missing player | Refuted. `server/rooms.ts:218` already rejects when any occupied seat has `!ready \|\| !connected`. |
| `rooms.ts advanceStalledTurns` can stall a room | Refuted. `server/rooms.ts:322-349` is per-room isolated, asserts card conservation, and drops plus reports a corrupt room rather than throwing out of the caller's interval. |
| `rooms.ts reconnect` orphans the socket | Refuted. `server/rooms.ts:358-368` resolves the seat by token, clears `disconnectedAt`, and returns a fresh redacted view. |

### Real gaps found, and closed

Two genuine holes existed — both in coverage, not behaviour.

1. **No whole-game invariant probes.** `tests/soak.test.ts` asserted only that games
   terminate. Nothing checked card conservation, duplicate ids, or table legality
   *per turn*. Closed by `tests/probes.test.ts` (45 tests): 40 seeded full AI-vs-AI
   games over seeds 1–40 asserting, every turn, that the deck totals 108 cards with
   no duplicate ids, that `validateTable` holds on the committed table, that
   `activePlayerIndex` stays in range and advances clockwise, and that at least one
   card leaves the active hand on every confirm; plus a determinism test (seeds 1,
   17, 40 run twice, JSON-equal final state and turn count) and four edge probes
   (`drawPile` length 0 and 1, a 10-meld crowded table, and 120 operations of
   `DraftEditor` undo/redo/reset abuse).
2. **No mobile gameplay e2e at all.** `e2e-cross/` covered layout and rotate only —
   no tap, drag, FEITO, Mexe Mode, undo/reset or draw on a touch viewport. Closed by
   `e2e-cross/mobile-gameplay.spec.ts` (12 tests × 3 WebKit touch projects = 36 runs).

`tests/rules.test.ts` gained 3 tests (deal card conservation, `applyConfirmedTurn`
conservation invariant, 4-player clockwise turn-order cycling). `tests/draft.test.ts`
gained none — its existing reset/undo/redo/`returnHandCard` coverage already satisfies
the source-of-truth list, and adding more would have duplicated it.

### Mobile evidence

Playwright CLI only; Playwright MCP was not used. Config `playwright.cross.config.ts`,
projects `ios safari` (iPhone 14 landscape), `ios safari portrait` (iPhone 14) and
`ipad` (iPad gen 7). The five non-touch projects skip via `test.skip` in `beforeEach`.
Screenshots: `docs/screenshots/phase19-mobile-*.png` (12 files).

Flows covered: boot to a playable human turn in both orientations, card
select/deselect, tap to a valid destination, tap to an invalid destination, drag to a
valid meld, invalid drop restoring the draft, FEITO blocked with a surfaced reason,
undo and the real RESET button, portrait focused-editor open/close, COMPRAR advancing
the turn, and an orientation flip mid-match preserving card conservation. Every test
also asserts `window.__MEXE__.errors` is empty.

**Incidental WebKit finding:** `page.mouse.{move,down,up,click}` *does* dispatch working
pointer events under WebKit touch emulation (`hasTouch`/`isMobile`), unlike Chromium,
which drops `page.mouse.click` there. This is what makes the drag tests possible on the
iOS projects.

**iOS Simulator — limitation.** Simulators are available on this machine (iOS 26.4:
iPhone 17 / 17 Pro / 17e / Air, iPad Pro / mini / Air, iPad A16) but were deliberately
not used: every targeted flow reproduced cleanly under Playwright WebKit and no Safari-
or PWA-specific quirk surfaced that the CLI could not cover. Real-device Safari and
Add-to-Home-Screen therefore remain unverified, as they did after Phase 17.

### Mutation testing — proof the new suites have teeth

A passing suite proves nothing unless it can fail. Both new suites were checked by
deliberately breaking the code they guard:

- `applyConfirmedTurn` was changed to stop removing played cards from the hand.
  41 of 45 tests in `tests/probes.test.ts` failed — the probes genuinely detect card
  duplication.
- `DraftEditor.reset()` was changed to restore the current snapshot instead of the
  turn-start snapshot. `e2e-cross/mobile-gameplay.spec.ts:267` failed on
  `ios safari portrait` — the mobile suite genuinely detects a broken reset.

Both mutations were reverted and `dist/` rebuilt. `git diff` on `src/` is empty.

### Verification run

| Command | Result |
| --- | --- |
| `npm run test` | 38 files, 531 passed (baseline 37 / 483) |
| `npm run lint` | clean (eslint + `tsc --noEmit`) |
| `npm run build` | clean |
| `npm run verify:cross` | 84 passed, 60 skipped (48 baseline + 36 new) |
| `npm run verify:multiplayer` | 9 passed, room 7BHHT, seed 2, revisions [1, 2], 18 screenshots |
| `npm run verify:pwa` | 11 passed |

`npm run verify` (the full chromium screenshot gate) was not re-run: no `src/` change
was made, so its screenshot baseline is untouched.

### Remaining issues

All P2. None blocks play.

- The mobile "invalid destination" test taps empty space rather than a genuinely
  illegal meld target, so the on-screen invalid-reason banner is asserted through
  `invalidMeldReasons()` rather than through a real illegal drop.
- Real-device iOS Safari and Add-to-Home-Screen PWA install remain unverified.
- Carried from Phase 18: the per-IP connection cap reads `req.socket.remoteAddress`
  directly, so it is wrong behind a reverse proxy without trusted-proxy configuration.
- Carried from Phase 18: no per-IP failed-join counter; room-code guessing is bounded
  only by the per-connection throttle and the per-IP connection cap.
- Online 4-player has server-side coverage but no dedicated `e2e-multiplayer` spec.
