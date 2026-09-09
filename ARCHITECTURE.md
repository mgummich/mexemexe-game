# MEXE! — Architecture

**Working title:** MEXE! — *Arruma. Desarruma. Bate.*
Digital card game based on Brazilian Mexe-Mexe. Vite + TypeScript + Phaser 3.

## Layering

```
core (events, rng, ids, log)          ← no deps
rules (pure functions)                ← core only
game-state (turn lifecycle, store)    ← core, rules
mexe-mode (table draft editing)       ← core, rules, game-state
ai (bots)                             ← core, rules, game-state
cards / table / ui / scenes / input / animation / audio (Phaser layer)
localization / tutorial / verification / debug / demo (support)
```

Hard rule: `rules/` is 100% pure and deterministic — no Phaser, no DOM, no Date/random. Everything testable in Vitest without a browser. Phaser layer only *renders* state and emits intents.

## Modules

| Module | Path | Responsibility |
|---|---|---|
| core | `/src/core` | `EventBus`, `Rng` (seeded mulberry32), id gen, logger |
| rules | `/src/rules` | deck, shuffle, deal, meld validation, table validation, turn legality, win check, serialize |
| game-state | `/src/game-state` | `GameStore`: authoritative state, reducer-style actions, undo/redo history |
| cards | `/src/cards` | card model helpers, card → texture key mapping |
| table | `/src/table` | shared table meld layout model |
| mexe-mode | `/src/mexe-mode` | draft state: break/split/merge/move melds, diff vs committed table, FEITO gate |
| ai | `/src/ai` | `AiPlayer` interface, SimpleAi, RearrangerAi, personalities |
| scenes | `/src/scenes` | BootScene, MenuScene, SetupScene, GameScene, WinScene, TutorialScene |
| ui | `/src/ui` | buttons, panels, banners, hand fan, meld views, reason tooltip |
| input | `/src/input` | drag/drop controller, hit areas, pointer → intent translation |
| animation | `/src/animation` | tweens: pickup, drop, snap, deal, glow, shake |
| audio | `/src/audio` | sfx manager with missing-file tolerance |
| assets | `/src/assets` | manifest + loader with procedural fallbacks |
| localization | `/src/localization` | pt-BR (default) + en dictionaries, `t(key)` |
| tutorial | `/src/tutorial` | scripted step overlay |
| verification | `/src/verification` | GAME_READY signal, window.__MEXE__ debug API, log capture |
| debug | `/src/debug` | seed override, showcase mode, state dump |
| demo | `/src/demo` | showcase scenarios for screenshots |

## Data model

Rules: [`docs/RULES.md`](docs/RULES.md) (authoritative). Two 54-card decks
(108 cards, 4 jokers). `suit`/`rank` are nullable — null iff `isJoker` — so
the type checker forces every card-face read site to handle jokers.

```ts
type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
type Rank = 1..13;                       // 1 = Ace, low or high depending on meld
interface Card {
  id: string;        // `${suit}-${rank}-d${deckId}` | `joker-d${deckId}-${n}`
  deckId: number;     // which of the two decks this card came from
  suit: Suit | null;  // null iff isJoker
  rank: Rank | null;  // null iff isJoker
  isJoker: boolean;
}
interface Meld { id: string; cards: Card[] }
interface PlayerState { id: string; name: string; isAi: boolean; aiType?: 'simple'|'rearranger'; hand: Card[] }

/** Rules configuration. Group constraints below are final hard rules. */
interface RulesConfig {
  deckCount: number;          // default 2
  jokersPerDeck: number;      // default 2
  maxGroupSize: number;       // legacy compatibility field; groups stay 3-4 cards
  groupUniqueSuits: boolean;  // default true; natural group suits stay unique
  groupMinSize: number;       // default 3, hard group floor
  groupMaxSize: number;       // default 4, hard group ceiling
  allowAllJokerGroups: boolean; // default false, hard natural-card requirement
  firstMeldMinPoints: number; // default 0 = off
  turnTimerSeconds: number;   // default 0 = off
  handSize: number;           // default 7
}

interface GameState {
  seed: number;
  players: PlayerState[];
  activePlayerIndex: number;
  table: Meld[];              // committed, always valid
  drawPile: Card[];
  turn: number;
  winnerId: string | null;
  phase: 'playing' | 'finished';
  config: RulesConfig;
}
```

Draft (Mexe Mode) is separate, never serialized into committed state:

```ts
interface DraftState {
  melds: Meld[];              // may be temporarily invalid
  handCardsPlayed: string[];  // card ids moved from active hand this turn
  history: DraftSnapshot[];   // for undo/redo
  historyIndex: number;
}
```

## Rules API (pure, `/src/rules`)

```ts
createDeck(config?: RulesConfig): Card[]       // config-sized: default 2×54 = 108 cards, 4 jokers
shuffleDeck(deck, rng): Card[]
dealInitialHands(deck, playerCount, handSize=7): { hands: Card[][]; drawPile: Card[] }
analyzeMeld(cards, config?): MeldAnalysis
  // single source of truth for meld validity — tries run then group, returns
  // { valid: true, kind: 'run'|'group', assignments: JokerAssignment[] } or
  // { valid: false, reason: ReasonCode }. Every other validator is a thin
  // wrapper around this: isValidRun/isValidGroup/isValidMeld/validateTable/
  // getInvalidMeldReasons all call analyzeMeld under the hood.
isValidRun(cards, config?): boolean            // 3+ same suit, consecutive ranks, ace low OR high (never both), no wrap, jokers fill gaps
isValidGroup(cards, config?): boolean          // exactly 3-4 same-rank cards; natural suits unique across decks; jokers take distinct missing suits; no all-joker group
isValidMeld(cards, config?): boolean
validateTable(melds, config?): boolean
getInvalidMeldReasons(melds, config?): MeldReason[]   // { meldId, reason: i18n key }
canConfirmTurn(committed: GameState, draft: DraftState): ConfirmResult
  // checks: all draft melds valid (analyzeMeld, using state.config); ≥1 hand
  // card added; card conservation (multiset of draft cards == committed
  // table cards + played hand cards); no committed table card missing (no
  // return to hand); no duplicate/foreign ids
applyConfirmedTurn(state, draft): GameState   // returns new state, advances turn, checks win
drawAndEndTurn(state): GameState              // draw pile empty ⇒ game ends immediately, no draw
checkWinner(state): string | null
fewestCardsWinner(state): string              // used when the draw pile runs out
serializeGameState(state): string             // GAME_STATE_VERSION = 2 envelope
deserializeGameState(json): GameState         // validates, throws on corrupt; rejects v1 payloads
```

`ConfirmResult = { ok: true } | { ok: false; reasons: ReasonCode[] }` — ReasonCodes are i18n keys so FEITO button shows exact translated reason.

**Joker assignments.** `MeldAnalysis` (valid case) carries `JokerAssignment[]`
— `{ cardId, suit: Suit | null, rank }` — the concrete card each joker in a
valid meld stands for. This is derived on demand from the run/group window
search, never stored in place of the card: jokers keep their own identity on
the table and in save/network data.

**Draw-pile exhaustion ends the game immediately.** No stalemate-by-passing
rule — `drawAndEndTurn` on an empty pile returns `phase: 'finished'` with
`fewestCardsWinner`, ties broken by earliest seat, on the very draw that would
have emptied it further. `consecutiveDraws` (the old MVP's full-round-of-passes
counter) no longer exists.

**Card conservation.** `deserializeGameState` and the server's
`assertConservation` both derive the expected total from
`config.deckCount * (52 + config.jokersPerDeck)` rather than a hardcoded 52.

## Turn lifecycle

```
START_TURN(p)
 ├─ human: idle → (enter Mexe Mode: edit draft) → FEITO (if canConfirmTurn) → applyConfirmedTurn
 │                                             └─ or COMPRAR → drawAndEndTurn
 ├─ ai: plan (sync, budgeted) → either confirm legal move or drawAndEndTurn
 └─ after apply: checkWinner → WinScene | START_TURN(next)
```

Events on the bus (typed): `game:ready`, `turn:start`, `draft:changed`, `turn:confirmed`, `turn:drawn`, `game:won`, `ai:thought` (debug explanation).

## RNG

`mulberry32(seed)` in `/src/core/rng.ts`. Seed from URL `?seed=` else `Date.now()` at boot (recorded in state + logs). All shuffle/AI tie-breaks go through the state's rng stream. Same seed ⇒ same deal ⇒ same AI decisions.

## Undo/Redo

Scope: Mexe Mode draft only (committed turns are final, like real table play). Snapshot stack of `DraftState.melds` + `handCardsPlayed`, capped 100. Reset = restore snapshot 0 (committed table + full hand back).

## Validator / FEITO gate

FEITO enabled iff `canConfirmTurn().ok`. Otherwise disabled with first reason rendered:
- `reason.meldTooSmall`, `reason.notAMeld`
- `reason.groupTooLarge` (group over 4 cards)
- `reason.groupDuplicateSuit` (a group repeats a natural suit)
- `reason.groupAllJokers` (a group has no natural rank/suit anchor)
- `reason.jokerUnassignable` (a meld's jokers have no legal card to stand for)
- `reason.runWrap` (ace used as both low and high in the same run, e.g. K-A-2)
- `reason.noHandCard` (must add ≥1 from hand)
- `reason.cardMissing` (table card can't leave table)
- `reason.duplicateCard`, `reason.foreignCard`

Invalid melds glow red; valid glow green on hover.

## AI

- `SimpleAi`: find melds in own hand (all combinations of 3+, runs & sets), also try appending single hand cards to existing table melds. First legal play by deterministic ordering (sorted card ids). Else draw. Budget <100ms — trivial, hand ≤ ~15 cards.
- `RearrangerAi`: SimpleAi first; then limited table reuse: try moving one table card between melds / splitting one run to enable placing a hand card. Bounded search (≤ few hundred candidates), deterministic ordering. Budget <500ms.
- Personalities map to characters: Dona Cida = simple/conservative (plays minimal), Juninho = simple/greedy (plays max cards), Bia = rearranger, Seu Zé = rearranger but prefers drawing early game.
- Every AI decision emits `ai:thought` with human-readable explanation (debug overlay + logs).
- AI proposals run through `canConfirmTurn` before apply — illegal proposal ⇒ assertion failure in dev, fallback draw in prod. AI can never commit an illegal table.

## Asset policy

- All final art generated via PixelLab MCP → `/public/assets/{cards,characters,tables,ui,audio,effects}`.
- `/src/assets/manifest.ts` lists every asset with key, path, dimensions.
- Loader tries file; on 404 generates procedural fallback texture (flat-color card with vector rank/suit text) so game never crashes on missing asset. Fallbacks tracked and reported in `window.__MEXE__.missingAssets` — verification fails a "no programmer art" check if non-empty in final builds.
- Logical canvas 480×270, integer-scaled ×3 to 1440×810 inside 16:9 letterbox; `pixelArt: true`, no smoothing.
- `docs/PIXELLAB_ASSETS.md` tracks every generated asset: prompt, dimensions, path, status.

## Verification loop

- `npm run test` — Vitest (rules, state, ai, mexe-mode).
- `npm run lint` — eslint + tsc --noEmit.
- `npm run screenshot` — Playwright: launch vite preview, wait for `window.__MEXE__.ready === true` (GAME_READY), set `?seed=&showcase=`, capture PNGs to `docs/screenshots/`, write JSON log: console errors, fps sample, active scene, validation status, seed, screenshot path.
- `npm run verify` — test + lint + screenshot + assert no console errors.

`window.__MEXE__` debug API (`/src/verification/debug-api.ts`): `{ ready, seed,
scene, fps, errors[], missingAssets[], validation, state(), showcase,
tutorialStep, lastAiThought, mexe: { playHandCard, moveTableCard, undo, feito,
comprar, getDraft } }`. `fps` is sampled scene-agnostically off the Phaser
game's `step` event (`src/main.ts`), so it's populated in every scene, not
just GameScene. `lastAiThought` holds the explanation text of the most recent
`ai:thought` event. `?lang=en|pt` on the URL sets the locale via the same
`settings` singleton the in-game language toggle uses.

`docs/STATUS.json` updated after each wave: wave, done modules, screenshots, test status, perf, module scores (honest 0–10), open issues, next task.

## Failure isolation

- Rules throw typed `RulesError` — caught at UI boundary, shown as toast, never crashes scene.
- Asset load failures → fallback textures (above).
- Audio failures → silent no-op.
- AI exceptions → fallback to drawAndEndTurn, error logged.
- Corrupt save/deserialize → fresh game with warning.
- Global `window.onerror` → captured into `__MEXE__.errors` for Playwright.

## Waves

1. Setup + verification harness
2. Rules engine (pure + tests)
3. Vertical slice (menu → 1v1 vs SimpleAi, Mexe Mode, FEITO, win)
4. Assets via PixelLab + art direction
5. Polish (2–4p, personalities, tutorial, i18n, audio, animations)
