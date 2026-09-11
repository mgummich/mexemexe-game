# Improvement Package Audit

READ-ONLY code map for new turn-timer, AI-difficulty, and online-UX features.

## 1. Settings Architecture

**Schema & Defaults** (`src/core/persistence.ts:7-42`)
- `Settings` interface: `muted`, `sfxVolume`, `musicVolume`, `musicEnabled`, `musicContextAware`, `reducedMotion`, `locale`, `largeText`, `helperMode`, `batterySaver` (9 fields)
- `DEFAULT_SETTINGS` line 42: `{muted:false, sfxVolume:80, musicVolume:55, musicEnabled:true, musicContextAware:true, reducedMotion:false, locale:'pt', largeText:false, helperMode:'standard', batterySaver:false}`

**Persistence** (`src/core/settings.ts:6-81`)
- Singleton `settings` object: `get()`, `update(patch)`, `progress()`, `cosmetics()`, `setLastSeed()`, `setTutorialCompleted()`, `resetData()`
- `onChange(fn)` listener subscriptions (line 56-59)
- Corruption fallback: `parseSave()` (`persistence.ts:72`) sanitizes unknown/corrupt `helperMode` to 'standard'; `sanitizeCosmetics()` resolves stale IDs to defaults

**UI Panels** (`src/ui/settings-layout.ts:27-100`)
- **Main (7 rows)**: `SettingsRow` enum — Mute(0), Game(1), Audio(2), Access(3), Cosmetics(4), Advanced(5), Close(6)
- **Sub-panels**: 
  - Game: HelperMode(0), Lang(1), Back(2) → `GameRow` 
  - Audio: Sfx(0), Music(1), MusicEnabled(2), MusicContext(3), Back(4) → `AudioRow`
  - Accessibility: Motion(0), BatterySaver(1), LargeText(2), Back(3) → `AccessRow`
  - Advanced: Export(0), ResetData(1), Version(2), Back(3) → `AdvancedRow`
- Cosmetics: 3 rows (table theme, card back, avatar) rendered via `COSMETICS_ROW_PITCH=30` (line 141)
- Row layout: `ROW_PITCH=17` (line 24), `FIRST_ROW_OFFSET=22` (line 70), computed y-coords via `subRowY()` (line 91)

## 2. Online Lifecycle

**Room Manager** (`server/rooms.ts:114-430`)
- `createRoom(name)` (line 138): generates code, seat 0 assigned, returns `CreateRoomResult`
- `joinRoom(code, name)` (line 165): find empty seat, returns token + seat
- `startGame(code, seat)` (line 213): checks host, all ready, no gaps, transitions to `state`
- `submitTurn(code, seat, rev, melds)` (line 246): applies move via `applyConfirmedTurn()`, increments rev, broadcasts
- `drawEndTurn(code, seat, rev)` (line 294): applies draw via `drawAndEndTurn()`, checks win via `phase==='finished'`
- `disconnect(code, seat)` (line 350): marks `disconnectedAt=now()`
- `reconnect(token)` (line 358): restores seat + view
- `sweep()` (line 397): removes rooms idle >10min, evicts disconnected >30s

**WebSocket Server** (`server/index.ts:361-410`)
- `WebSocketServer` on line 361, `maxPayload: MAX_PAYLOAD_BYTES`
- `wss.on('connection', handler)` (line 367): rate-limits by IP, global cap 500 connections
- `handleMessage(ws, conn, msg)` (line 134): dispatches `create_room`, `join_room`, `ready`, `start_game`, `submit_turn`, `draw_end_turn`, `reconnect`, `leave_room`, `ping`
- Broadcasts via `broadcastRoom(code, msg)` (line 120), `broadcastGameEnd()` (line 90)

## 3. Protocol

**Messages** (`src/net/protocol.ts:196-282`)
- `ClientMessage` union (line 196): CreateRoomMsg, JoinRoomMsg, LeaveRoomMsg, ReadyMsg, StartGameMsg, SubmitTurnMsg, DrawEndTurnMsg, ReconnectMsg, PingMsg, ResyncMsg — all carry `reqId` for response matching
- `ServerMessage` union (line 281): RoomJoinedMsg, RoomStateMsg, GameStartedMsg, StateSyncMsg, ProposalRejectedMsg, PlayerDisconnectedMsg, PlayerReconnectedMsg, GameOverMsg, ErrorMsg, PongMsg
- **GameView redaction** (line 24-39): `seat`, `players[]`, `table`, `drawCount`, `activeSeat`, `turn`, `rev`, `phase`, `winnerId`, `config`, `hash`; hand only for viewing seat
- **State hash** (line 56-72): FNV-1a over canonical digest (rev, active, turn, phase, handCounts, drawCount, table) — used to detect client desync (never server-trusting)

**Safe message addition**: New fields go into `ClientMessage` union types (e.g., `SubmitTurnMsg` line 164-170) or extend `GameView` (no breaking changes if optional). Test parity via resync on hash mismatch.

## 4. Turn Timer Hook

**Defined** (`src/rules/rules.ts:394-407`)
```typescript
export function timerExpireTurn(state: GameState): GameState {
  // Ends current player's turn as if they drew, respects rules (can't skip required draw)
  return drawAndEndTurn(state);
}
```

**Tests** (`tests/rules.test.ts:579-600`): covers valid draw + turn end, re-entry after discard

**NOT WIRED**: No call in any scene. To hook:
1. Server: Add timer to `RoomInternal`, arm on `submitTurn()` (line 246), fire via `sweep()` → `timerExpireTurn()` → broadcast `state_sync`
2. Client: Listen for `state_sync` post-timeout, update `GameStore`
3. UI: Show countdown timer on active turn, optional toast on expiry

## 5. AI Structure

**Personalities** (`src/ai/ai.ts:17`)
- `Personality = 'cida' | 'juninho' | 'bia' | 'ze'` — 4 fixed personas, no difficulty/speed settings

**Implementations**
- `SimpleAi` (line 148-395): greedy rank-play + fallback draw, `findHandMelds()` deterministic (sorted iteration)
- `RearrangerAi` (line 396+): sliced (async) meld-rearrangement search
- `PatientAi` (line 519): conservative 1-meld/turn hold-for-bigger strategy

**Factory** (`createAi()` line 498): wires personality name → engine → wraps decision in `tagReason()` (line 488) for debug `ai:reason` tags (line 469-486)

**No difficulty levels**: All `AiPlayer.decide(state)` → `AiDecision` (kind='confirm'|'draw', explanation). To add difficulty:
1. Extend schema: `AiPlayer.decide(state, difficulty?)` or new config on `createAi(personality, difficulty)`
2. Modify search depth / meld-quality filter in SimpleAi / RearrangerAi
3. Extend explanations for UI display (e.g., "playing safe" vs "aggressive")
4. Seed handling: `createRng()` (`src/core/rng.ts`) already deterministic, used in `shuffleDeck()` — seed chain covers AI + deck

## 6. Localization

**Keys** (`src/localization/i18n.ts:3-150+`)
- `dict: Record<Locale, Record<string, string>>` with ~300 keys across `pt` and `en`
- Locale type: `'pt' | 'en'` (line 1)
- Setter `setLocale(locale)`, getter `t(key, params?)`
- Interpolation: `t('win.statLine', {name, turns, cards, draws})` expands `{param}` placeholders

**Parity test** (`tests/i18n.test.ts:7-15`)
- Asserts `pt` and `en` define **identical key set** — any mismatch fails CI
- Smoke test: `REASON_CODES[]` + `NEW_KEYS[]` (line 42-63) must resolve non-empty in both locales
- Adding keys: update `i18n.ts` dict for both locales, register in test `NEW_KEYS[]` if new-phase addition

## 7. Tests

**Settings & Layout** (32 test files total)
- `tests/settings-layout.test.ts`: row y-coordinate assertions (can break on ROW_PITCH/count change)
- `tests/i18n.test.ts`: key parity, reason-code coverage, interpolation
- `tests/helpers.test.ts`: helper-mode flag computation
- `tests/rules.test.ts`: `timerExpireTurn()` (line 579), turn submission, draw+end

**E2E** (`tests/` + `e2e-pwa/`, `playwright.*.config.ts`): 
- `offline.spec.ts`, `update.spec.ts` (PWA)
- Multiplayer config (line 1, `playwright.multiplayer.config.ts`) — hooks WebSocket server if exists

**CI Coverage**: New timer/difficulty UI must not assume hardcoded coordinates — import from `settings-layout.ts` enums.

## 8. Assets & Fallbacks

**Manifest** (`src/assets/manifest.ts:16-60`)
- `AssetDef`: `{key, path, w, h, composed?}`
- `composed=true` for runtime-drawn cards (no file probe) — see `compose-cards.ts`
- `buildManifest()`: 53 cards (composed) + card-blank + 5 card-backs + 5 table BGs + 9 avatars + UI buttons/icons/audio

**Fallback pipeline** (`src/assets/fallbacks.ts:36-115`)
- `makeFallback(scene, key, w, h)`: dispatches by key prefix — card-back → solid + grid, card-* → rank/suit text, avatar-* → colored circle, bg-* → gradient
- Missing-asset tracking: `BootScene` GET-probes each manifest entry, logs to `window.__MEXE__.missingAssets`, `npm run verify` fails if non-empty
- **No generated-asset pipeline for new cosmetics**: procedurally generated via `scripts/gen-cosmetics.mjs` (deterministic LCG) and `scripts/gen-sfx.mjs`, NOT real-time

## Implementation Risk Map

| Risk | Scope | Mitigation |
|------|-------|-----------|
| Timer callback during game save/load | Server sweep + client resync | Ensure `timerExpireTurn()` idempotent, hash mismatch triggers resync (already in protocol) |
| New settings field → corruption | Persistence migration | Add to `sanitizeSettings()` with default fallback |
| UI row coordinate break | E2E brittle | Import enums from `settings-layout.ts`, never hardcode y-values |
| AI difficulty bias | Balance | Seed all RNG, trace all `findHandMelds()` calls, log decision weights |
| Locale key miss | Runtime fallback to key string | Parity test catches — add key to i18n.ts + NEW_KEYS[] before pushing |
| Asset fallback during gameplay | Visual downgrade | Fallbacks tested in BootScene, `npm run verify` enforces zero missingAssets on ship |

## Top 10 Impact Changes

1. **Server timer arm/fire** (server/rooms.ts:246, :397) — allocate `RoomInternal.timerHandle`, call `timerExpireTurn()` on expiry, broadcast `state_sync`
2. **Client turn-timer UI** (src/ui/settings-panel.ts:~, GameScene) — render countdown, optionally toast expiry
3. **AI difficulty enum** (src/ai/ai.ts:17) — extend Personality or add `AiDifficulty`, wire via `createAi(personality, difficulty)`
4. **AI difficulty-knob setting** (src/core/persistence.ts:7-42, settings-layout.ts:38-42) — new setting field, GameRow or Advanced sub-panel row
5. **Timer preset config** (server/config.ts:3-60) — new `TURN_TIMER_SECONDS` env var, pass to RoomManager
6. **Online-room UI fields** (src/net/protocol.ts:212-217) — extend RoomPlayerSummary with `ready`, `connected` status for lobby display
7. **Ready-check timeout** (server/rooms.ts:object) — track readyAt per seat, sweep idle lobbies >N min
8. **AI explanation strings** (src/ai/ai.ts:469-486) — extend reason tags for difficulty context (e.g., "cida:draw:safety")
9. **New i18n keys** (src/localization/i18n.ts) — timer UI, difficulty labels, ready-check messages (audit NEW_KEYS[] in test)
10. **Cosmetics gen script extensibility** (scripts/gen-cosmetics.mjs) — ensure output PNG format stable if adding new card-back or avatar categories

---

**Audit date**: 2026-09-11 | **No edits applied** | **Coverage**: all 7 areas mapped to line ranges.
