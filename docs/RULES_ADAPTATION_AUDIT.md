# Rules Adaptation Audit

Opus-authored audit of what the current MEXEMEXE! codebase assumes about the rules, and what the
final Mexe-Mexe ruleset (2×54-card deck, jokers, ace high/low, draw-on-pass) breaks.

Scope note: this is the pre-implementation audit. Design decisions that resolve each gap are in
the "Target design" section and are binding for the implementation phases.

## 1. Current rule assumptions (as implemented)

| # | Assumption | Where | Verdict |
|---|---|---|---|
| A1 | One 52-card deck, no jokers | `createDeck()` in `src/rules/rules.ts` | replace |
| A2 | `Card.id = "${suit}-${rank}"` is globally unique | `cardId()`, all id-keyed logic, wire protocol | replace (needs deckId) |
| A3 | `Card` has non-null `suit` + `rank`, no joker concept | `src/rules/types.ts` | replace |
| A4 | Runs: same suit, consecutive ranks, ace **low only**, no jokers | `isValidRun()` | replace (ace high, jokers) |
| A5 | Sets: same rank, "single deck ⇒ suits necessarily distinct" | `isValidSet()` | rename to group; allow repeated suits from different decks; add max size |
| A6 | Card conservation invariant hardcodes 52 | `deserializeGameState()`, `assertConservation()` in `server/rooms.ts` | replace with config-derived total |
| A7 | Empty draw pile = keep passing; stalemate only after a full round of empty-pile draws (`consecutiveDraws`) | `drawAndEndTurn()` | replace: pile exhaustion ends the game immediately, fewest cards wins |
| A8 | 7-card deal, 2–4 players | `dealInitialHands()` | keep (relax upper bound is out of scope; 2–4 stays) |
| A9 | Draw only when passing (no draw at turn start) | `drawAndEndTurn()`, `GameScene` | **already correct** — keep |
| A10 | Table cards may be freely rearranged, must end valid, ≥1 hand card added, no table card returns to hand | `canConfirmTurn()` | **already correct** — keep |
| A11 | No discard pile | whole codebase | **already correct** — keep |
| A12 | No first-meld minimum | `canConfirmTurn()` | correct as default; add house-rule hook only |
| A13 | No turn timer anywhere | (absent) | add config hook + engine entry point; no UI timer today |
| A14 | 52 composed card faces, key `card-${suit}-${rank}` | `src/assets/compose-cards.ts`, `manifest.ts`, `fallbacks.ts` | add a joker face; keys must not collide across decks (same face for both decks is fine) |

## 2. Files affected

**Rules core (must change)**
- `src/rules/types.ts` — Card model, GameState, ReasonCode, joker assignment types, RulesConfig.
- `src/rules/rules.ts` — deck build, deal, run/group/meld validation with jokers, confirm gate, draw/end-turn, winner, (de)serialization, conservation.

**Consumers (compile + behavior)**
- `src/game-state/store.ts` — `createNewGame` must build the configured deck and carry `config`.
- `src/mexe-mode/draft.ts` — id-based; no logic change expected, but joker-aware invalid reasons flow through `invalidMelds()`.
- `src/ai/ai.ts` — reads `c.rank` / `c.suit` unconditionally; breaks on nullable joker fields. Needs joker-aware meld finding and 2-deck duplicate handling.
- `src/net/protocol.ts` — `GameView` must carry the rules config; PROTOCOL_VERSION bump.
- `src/net/viewToState.ts` — placeholder cards must satisfy the new Card shape and carry `config`.
- `server/rooms.ts` — deck creation, deal, conservation constant, config in state. Turn validation itself is already id-rehydrating, so joker identity survives unchanged (good).
- `src/scenes/GameScene.ts` — card sprite key lookup, hand sorting by rank/suit, meld sorting, draw-pile counter text.
- `src/assets/compose-cards.ts`, `src/assets/manifest.ts`, `src/assets/fallbacks.ts` — joker face + `rankLabel` for null rank.
- `src/tutorial/fixture.ts`, `src/tutorial/script.ts` — hand-picked ids like `hearts-7` become `hearts-7-d0`.
- `src/ui/rules-panel.ts` (text only), `src/localization/i18n.ts` (new + reworded strings).
- `src/verification/debug-api.ts` — exposes state to e2e; check any 52 assumptions.

## 3. Tests affected

- `tests/rules.test.ts` — deck size, id format, run/set validity, serialization, conservation (all 52-based).
- `tests/ai.test.ts`, `tests/draft.test.ts`, `tests/tutorial.test.ts` — build cards via `{ id: "${suit}-${rank}", suit, rank }` helpers; every fixture needs `deckId`/`isJoker`.
- `tests/server/rooms.test.ts` — 52-card conservation, deal counts, submit-turn fixtures.
- `tests/viewToState.test.ts` — placeholder shape.
- `e2e/screenshot.spec.ts`, `e2e-multiplayer/multiplayer.spec.ts` — any card-id selectors and deck-count text.

New coverage required: 108-card deck, 4 jokers, duplicate naturals differing only by `deckId`, A-2-3, Q-K-A, K-A-2 rejection, joker fill at gap/start/end, impossible joker assignment rejection, repeated-suit groups, group max size, draw-pile-exhaustion end condition, timer-expiry path.

## 4. UI affected

- Deck counter shows draw-pile length — correct by construction, but copy/tests assume ~31 remaining; 108 cards changes the numbers everywhere in screenshots.
- No joker artwork, no joker glyph in the fallback face generator.
- No joker-assignment hint in the meld tooltip / invalid-meld banner.
- `rules.body` (pt + en) describes "sets (3+ same rank)" and "if the deck runs out and everyone passes" — both now wrong.
- Invalid-meld reasons need new localized strings: group too large, joker unassignable, ace wrap.
- Tutorial script text mirrors the old rules.

## 5. AI affected

- `findHandMelds()` groups by `rank` and `suit` maps — nullable joker fields break typing and semantics.
- Run segmentation assumes strict `+1` steps with no gaps ⇒ cannot use jokers, cannot use ace-high.
- Duplicate naturals from two decks land in the same rank bucket (fine for groups) and the same suit bucket (breaks the run scanner, which treats an equal rank as a segment continuation guard only).
- `RearrangerAi` never inspects joker semantics; all its candidate drafts are gated by `canConfirmTurn`, so it cannot produce an *illegal* joker play — but it will produce *no* joker plays until taught.
- `PatientAi` heuristics unaffected.

## 6. Multiplayer affected

- Wire format carries card **ids only** for submissions and rehydrates from authoritative server state — joker identity is preserved for free, and clients cannot forge a joker's value. This is the single biggest thing the current design gets right.
- `GameView` must carry the rules config so the client validator matches the server's.
- `PROTOCOL_VERSION` must bump (view shape change); old clients must be rejected, not silently mis-validated.
- `assertConservation()` 52 constant must become config-derived.
- Draw-pile exhaustion now ends the game — the server must broadcast the terminal state, and reconnect must show it.

## 7. Save / schema affected

- `GAME_STATE_VERSION` = 1 envelope contains raw `GameState`; card ids and the conservation count both change ⇒ bump to 2 and reject v1 payloads with a clear `corruptSave` error.
- No mid-game state is persisted to `localStorage` today (`src/core/persistence.ts` stores settings + progress only), so no user-visible save migration is required. `serializeGameState` is used by tests and as the wire/save envelope only.
- `Settings`/`Progress` unaffected. House-rule config is game-scoped (`GameState.config`), not a user setting, for now.

## 8. Target design (binding for implementation)

```ts
export interface Card {
  id: string;         // `${suit}-${rank}-d${deckId}` | `joker-d${deckId}-${n}`
  deckId: number;
  suit: Suit | null;  // null iff isJoker
  rank: Rank | null;  // null iff isJoker
  isJoker: boolean;
}
```

Nullable `suit`/`rank` is deliberate: it makes the type checker enumerate every site that reads a
card's face value, which is exactly the set of places joker handling can be silently wrong.

```ts
export interface RulesConfig {
  deckCount: number;          // default 2
  jokersPerDeck: number;      // default 2
  maxGroupSize: number;       // default 4 (total cards, jokers included)
  groupUniqueSuits: boolean;  // default false
  firstMeldMinPoints: number; // default 0 = off
  turnTimerSeconds: number;   // default 0 = off
  handSize: number;           // default 7
}
```
`GameState.config` carries it; `DEFAULT_RULES` is the only enabled variant.

**Run validation.** At least one natural card required. Naturals share a suit and have distinct
values. For each ace mode (low: A=1, window bounds 1..13; high: A=14, bounds 2..14) try every
contiguous window of length `cards.length` that contains all naturals and stays inside the bounds;
the empty slots are the joker assignments, filled left to right. No wrap (K-A-2 fails both modes).

**Group validation.** At least one natural required, all naturals share a rank, total size ≥3 and
≤ `maxGroupSize`, jokers assigned that rank with no suit. Repeated suits allowed (ids differ by
`deckId`); `groupUniqueSuits` re-tightens it as a house rule.

**Turn/draw.** Unchanged confirm gate. `drawAndEndTurn` on an empty pile ends the game immediately;
winner = fewest hand cards, tie broken by earliest seat. `consecutiveDraws` is deleted.

**Timer.** Config hook plus an engine entry point that reverts to the turn-start state, draws and
ends the turn. Default off; no in-game timer UI is added in this pass.

## 9. Top 10 risks

1. **Joker run assignment correctness** — the window search must reject impossible fills (e.g. two jokers that would need to sit outside 1..13) instead of accepting any card count. Highest-value tests.
2. **Ace wrap leaking in** — a naive "sort and check +1 with 1 mapped to 14 when convenient" admits K-A-2. Ace mode must be chosen once per meld, never per card.
3. **Duplicate-card identity** — two `hearts-7` cards now exist. Anything keying a Map by `suit-rank` (AI buckets, sprite lookups, tests) silently collapses them.
4. **`canConfirmTurn` duplicate-id check vs legitimate duplicates** — the check is per `id`, which stays correct only because `deckId` is in the id. Any id-format regression turns a legal double-7 group into a "duplicate card" rejection.
5. **Client/server rule divergence** — if the client validates with `DEFAULT_RULES` while the server's room state carries a different config, submissions pass locally and get rejected online. Config must travel in `GameView` and be used by client validation.
6. **Protocol/version skew** — a stale client with 52-card assumptions must be refused at handshake, not allowed to submit.
7. **Conservation constant drift** — three places hardcode 52 (deserialize, server assert, tests). All must derive from config or the server will throw mid-match.
8. **Sprite/asset gap** — a missing `card-joker` texture is a console error per joker rendered, which fails the zero-console-error verification gate.
9. **AI regression / stalls** — nullable ranks can throw inside the AI's sort comparators on an AI turn, hanging the game loop; and a joker-blind AI holds jokers forever, making games drag past the (now larger) 108-card pile.
10. **Old rule text surviving** — help panel, tutorial script, README and both locales all restate the old rules; the pass fails if any "everyone passes"/"same rank set" copy remains.
