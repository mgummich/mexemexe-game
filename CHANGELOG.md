# Changelog

All notable changes to MEXE! by phase. See `docs/STATUS.json` for the full
wave-by-wave log this summarizes.

## Unreleased — Rules adaptation

Rules engine, protocol and docs adapted to the final Mexe-Mexe ruleset
(`docs/RULES.md`), replacing the MVP's single-deck/ace-low/stalemate-by-passing
approximation.

- **Two 54-card decks (108 cards, 4 jokers)** instead of one 52-card deck.
  `Card` gained `deckId` and `isJoker`, with `suit`/`rank` now nullable (null
  iff `isJoker`) so every card-face read site had to be reconsidered for
  jokers.
- **Runs**: ace may be low (A-2-3) or high (Q-K-A), never both in the same
  meld, so K-A-2 is correctly rejected as a wrap. **Groups** (renamed from
  "sets"): repeated suits are legal since there are two decks, capped at 4
  cards by a configurable `maxGroupSize`.
- **Jokers** as wildcards in either meld kind, with a required concrete
  interpretation — `analyzeMeld` is now the single source of truth for meld
  validity and returns `JokerAssignment[]` for the valid case; a meld with
  unassignable jokers or no natural anchor card is rejected.
- **`RulesConfig`/`DEFAULT_RULES`** house-rule hooks (`deckCount`,
  `jokersPerDeck`, `maxGroupSize`, `groupUniqueSuits`, `firstMeldMinPoints`,
  `turnTimerSeconds`, `handSize`), carried on `GameState.config` and now on
  `GameView.config` so client and server validate against the same rules.
- **Draw-pile exhaustion ends the game immediately** — fewest cards in hand
  wins, tie to earliest seat. Replaces the old MVP stalemate rule
  (`consecutiveDraws`, a full round of passes), which is deleted.
  Card-conservation checks (save/deserialize, server assertion) are now
  config-derived instead of hardcoding 52.
- New rejection reasons: `reason.groupTooLarge`, `reason.jokerUnassignable`,
  `reason.runWrap`.
- `GAME_STATE_VERSION` bumped to 2 (save/wire envelope shape changed); v1
  payloads are rejected with `corruptSave` rather than mis-read.
- `PROTOCOL_VERSION` bumped to 2; a stale client is refused at connect instead
  of silently mis-validating turns against the new card model.
- AI, tutorial fixtures, and all localized rules copy (PT/EN) updated for the
  new deck, meld and end-game rules.
- Fixed analyzed-meld display ordering (`src/rules/rules.ts`,
  `src/scenes/GameScene.ts`) so table melds render in the joker-resolved,
  analysis-assigned card order instead of raw hand/drop order.
- Fixed pile-exhaustion win copy so the results screen correctly describes a
  fewest-cards-wins finish instead of reusing the old stalemate-by-passing
  wording.

## 1.1.0 — Phase 5 (online alpha)

**ALPHA**: 2-player private online rooms over WebSocket, on top of the 1.0.0
launch build. Local play is unaffected — it works fully with the server down
or absent.

- New `server/` process (plain Node + `ws`, run via `npm run server`):
  authoritative game state per room, server-chosen deal seed, room codes,
  ready/auto-start, a `GET /health` check, a room cap, a crude per-connection
  flood guard, and an idle-room reaper.
- Authoritative server validation: every proposal is rehydrated from the
  server's own state by card id (never trusting client-supplied suit/rank),
  checked against the same shared `canConfirmTurn` the offline rules engine
  uses, and re-asserted for 52-card conservation before it is applied — so
  client and server can never disagree about what's legal.
- Deterministic, redacted synced state: each client only ever sees its own
  hand in full; the opponent's hand and the draw pile are counts only. A
  monotonically increasing revision number rejects stale/duplicate/late
  submissions.
- Mexe Mode online: FEITO/COMPRAR become submit-and-wait (locked while a
  request is in flight), the opponent's turn is structurally read-only (no
  drag handlers wired, not just visually disabled), and rejected proposals
  show the same localized rejection reasons local play already uses
  (`reason.duplicateCard`, `reason.cardMissing`, `reason.unknownCard`, etc.)
  with the draft discarded and rebuilt from the last synced state.
- Draw/end, win and stalemate are all server-decided and broadcast — the
  client never computes a winner locally online.
- Disconnect notice and reconnect: the opponent is told when a seat drops;
  the disconnected client attempts one bounded reconnect and resyncs to the
  server's current revision, verified end to end in
  `e2e-multiplayer/multiplayer.spec.ts` with a forced socket drop and
  screenshots of the disconnected/reconnecting/reconnected states.
- New `npm run server`, `npm run test:server` (39 server unit tests,
  including a malformed-message battery) and `npm run verify:multiplayer`
  (two-client Playwright flow + log-based gate) scripts.
- Known alpha limitations, documented rather than hidden: join code entry via
  a native `window.prompt()` dialog, generic opponent avatar (no accounts),
  no matchmaking/ranked/chat, 2 players only, no online rematch (MENU only
  from the win screen), no socket liveness probe, and reconnect as a single
  bounded retry rather than a persistent retry loop.

## 1.0.0 — Phase 4 (launch polish)

- Readability floor: no user-facing text renders below a legible size at
  1280×720 (top bar, tooltips, FEITO disabled-reason, labels, win subtitle);
  large-text toggle now a bonus on top of a readable default, not a crutch.
- Fixed 4-player prop/UI occlusion (mug over the top bar, cookie plate under
  the FEITO tooltip) and prop/meld-zone collisions at crowded tables.
- Overflow-proof scaled meld layout, with hover meld-reason tooltips
  explaining why a table meld is invalid.
- Wooden button unification: every UI button (pause menu, rules/help panel,
  quit-confirm, tutorial skip/replay, settings, win, setup) now renders the
  `PixelButton` wooden 9-slice style (primary/secondary/danger palette) —
  no remaining flat-rect "programmer art" buttons.
- E2e coverage for rematch (WinScene "MESMA PARTIDA" starts a new game on
  the same seed) and reset-data (settings "APAGAR DADOS" wipes the
  versioned save and the game reboots clean).
- Four deterministic per-personality AI showcase captures (Dona Cida,
  Juninho, Bia, Seu Zé), each with its `ai:thought` asserted.
- Release packaging: version bump to 1.0.0, `docs/RELEASE_NOTES.md`, README
  refresh.

## 0.3.0 — Phase 3 (flow, persistence, accessibility, perf, release)

- Pause menu with quit confirmation, Esc shortcut, in-game help (rules panel).
- Soft error recovery: window errors surface as a toast with a safe return to
  the menu instead of a dead scene.
- Versioned persistence (`mexe-save-v1`): settings, locale, volumes, reduced
  motion, last seed, tutorial-completed — with migration, corrupt-save
  fallback, and a "reset data" button.
- 34 rules-engine edge tests (empty melds, zero-card confirm, reset exactness,
  mid-draft round-trip, 3/4-player turn order, stalemate ties, win-only-via-
  confirm) plus deterministic per-personality AI regression snapshots.
- Accessibility: colorblind-safe validity (✗ badges + dashed strokes, not
  color-only), keyboard shortcuts (undo/redo/reset/draw/confirm/sort/help/
  pause), a +25% large-text toggle, meld separators at minimum layout gap.
- Performance evidence: a 20-game AI-vs-AI soak test and an 80-card stress
  render check (fps ≥ 50), both gated in `npm run verify`.
- Audio rebalanced to a consistent loudness order (win > feito > invalid >
  drop/draw > pickup/snap > click > ambience), all peaks ≤0.5 pre-volume.
- `npm run build` gated in `verify`; STATUS.json now carries a `metrics`
  block (per-shot fps, viewports, test counts) written on every verify run.

## 0.2.0 — Phase 2 (Mexe Mode polish, AI, tutorial, settings)

- Overflow-proof table layout, drag lift/shadow, FEITO confirm fx, invalid-
  meld badges.
- `RearrangerAi`: bounded table rearranging (edge steals, run splits, inter-
  meld moves) on top of `SimpleAi`'s direct-play search; four personalities
  (Dona Cida, Juninho, Bia, Seu Zé) wrapping the two skill levels.
- 10-step interactive tutorial (teach-by-doing over a scripted table), full
  PT/EN localization.
- Setup screen (seat/personality picker), settings overlay (mute, SFX/music
  volume, reduced motion, language), looping ambience.
- Expanded verification: AI showcase captures, fps gate, 1080p capture,
  viewport logging.

## 0.1.0 — Phase 1 (playable core)

- Pure rules engine (deck, deal, meld validation, confirm/draw turn cycle,
  win/stalemate detection) with no Phaser dependency.
- Mexe Mode draft editor: freely rearrange table melds during your turn, with
  undo/redo/reset, gated by `canConfirmTurn`.
- Phaser scenes rendering the rules-engine state; PixelLab-generated pixel
  art throughout (no programmer art).
- `window.__MEXE__` debug API and Playwright screenshot suite for
  deterministic, headless verification.
