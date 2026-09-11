# PHASE 5 AUDIT — Online multiplayer alpha readiness

*Auditor: Opus (reasoning/prose only; no code touched). Implementation owner:
Sonnet. Baseline: v1.0.0 launch build, Phase 4 PASS — 112/112 unit, 25/25 e2e,
lint + build + verify green, 0 console errors, 57–60fps.*

## 1. Current release state

The repository ships a complete, single-process browser game: Phaser 3 front
end (`src/scenes/*`), a pure rules engine (`src/rules/*`), a pure draft editor
(`src/mexe-mode/draft.ts`), a thin authoritative-ish store
(`src/game-state/store.ts`), four AI personalities, tutorial, i18n (PT/EN),
settings persistence, and a Playwright verification harness that writes
`docs/screenshots/verify-log.json` and merges metrics into `docs/STATUS.json`.

There is **no network layer of any kind today**: no `/server`, no WebSocket
dependency, no transport abstraction, no room concept, no session identity.
Phase 5 is therefore additive greenfield work bolted onto a stable base — which
is the good case, provided the bolt-on does not reach into the local paths.

## 2. Local stability

Strong and not in question. The risk is not that local play is fragile; it is
that Phase 5 will *make* it fragile by editing the shared centre of the game —
`GameScene`, `GameStore`, `rules.ts` — to accommodate a second driver. Every
change in this phase should be judged first by "can this break the offline
game", and the safest shape is: local play keeps its existing code path
unchanged by default, and online play is a *different driver* feeding the same
renderer.

## 3. Multiplayer risks (ranked)

1. **Full-state broadcast leaks hidden information.** `GameState` contains
   every player's `hand` and the entire ordered `drawPile`. Shipping it to both
   clients hands a trivial cheat (open devtools, read `window.__MEXE__.state()`)
   and makes "authoritative validation" cosmetic. The server must broadcast a
   *redacted per-player view*: own hand in full, opponents as a count, draw pile
   as a count.
2. **Client-supplied card objects.** A proposal carries `Card` objects
   (`{id, suit, rank}`). If the server melds using the client's objects, a
   client can send `{id:'hearts-3', suit:'hearts', rank:5}` and forge a run.
   The server must treat proposals as *id lists only* and rehydrate every card
   from its own authoritative state before validating.
3. **Seat-0 assumption in the renderer.** `GameScene.renderAll` renders
   `state.players[0].hand` as "the hand" and skips index 0 in the opponent bar.
   The joining client is seat 1; without a `localSeatIndex`, player two sees the
   host's hand. This is simultaneously a correctness bug, a cheat, and a UX bug.
4. **No revision number.** Nothing in `GameState` distinguishes "state after
   turn 7" from a stale copy. Double-submit and late-submit (the classic
   reconnect race) cannot be rejected without one.
5. **Meld ids are client-generated** (`m{turn}-{n}` in `DraftEditor.newMeldId`).
   Two clients, or a malicious one, can collide or reuse ids. The server should
   validate uniqueness and may renumber on commit; ids must never be a key into
   anything security-relevant.
6. **AI timers inside `GameScene`.** `onTurnStart` schedules an AI turn whenever
   the active player has `isAi`. An online game must never construct AI seats,
   and the online driver must not let a stray timer confirm a turn on the
   network.
7. **Malformed input crashing the server.** `JSON.parse` on socket data,
   `state.players[i]!` non-null assertions, and unguarded array indexing are all
   crash vectors. Every inbound message needs shape validation at the boundary
   before it reaches game code.
8. **Stuck lobbies.** Create-room-then-close-tab leaves a room forever without a
   reaper; a client waiting on `start_game` that never arrives has no exit. Both
   are "no stuck online flow" gate violations.
9. **Deterministic-but-not-reproduced deal.** The deal is seeded, but the seed
   must come from the server (client-chosen seeds let a host reroll until a good
   hand). Server picks the seed and includes it in `game_started`.
10. **Local regression by accident.** The most likely Phase 5 failure is not a
    network bug — it is `npm run verify` going red because a shared file grew an
    online branch.

## 4. Rules-engine reuse readiness

Better than expected. `src/rules/rules.ts`, `src/rules/types.ts`,
`src/core/rng.ts`, `src/mexe-mode/draft.ts` and `src/game-state/store.ts`
import nothing browser-specific — no `window`, no `document`, no Phaser, no
`localStorage`. `store.ts` pulls in `core/events.ts`, which is a hand-rolled
in-memory bus and is also environment-free. `createRng` is mulberry32; there is
no `Math.random` in gameplay logic. Vitest already runs these under
`environment: 'node'`, which is de-facto proof they run server-side.

`canConfirmTurn(state, draft)` is already the correct authoritative gate: it
checks duplicates, foreign cards, table-card conservation, at-least-one-hand-card,
and per-meld validity, and it derives the played-from-hand set from ids rather
than trusting `draft.handCardsPlayed`. The server should call exactly this
function — not a reimplementation — so client and server can never disagree.

Reuse blockers, all small:

- No package/path boundary marking "this subtree is shared and must stay pure".
  A future edit could add a Phaser import to `store.ts` and nobody would notice
  until the server crashed. A lint rule or at minimum a documented convention is
  cheap insurance.
- `GameStore` emits on the global `bus` singleton. On a server hosting several
  rooms in one process, a global bus is cross-talk waiting to happen. Either the
  server uses the pure functions (`applyConfirmedTurn`, `drawAndEndTurn`)
  directly and skips `GameStore`, or `GameStore` takes an injected bus. The
  first option is less code and is preferred.
- `RulesError` is thrown by `applyConfirmedTurn`; the server must catch it and
  answer with `proposal_rejected`, never let it escape to the socket handler.

## 5. Serialization gaps

- `serializeGameState`/`deserializeGameState` are bare `JSON.stringify/parse`
  with a shape and card-conservation check but **no version field**. Wire
  formats need a version from day one; the save file learned this lesson already
  (`Save.version = 1`) and the game state did not.
- No `rev` (state revision) anywhere.
- No redacted view type. Everything downstream of the renderer assumes
  `PlayerState.hand` is a full array; a view type needs an explicit
  `handCount` so the UI can render opponents without their cards.
- No declared message envelope: no `type`, no `v`, no correlation id for
  request/response (`submit_turn` → `proposal_rejected` needs to be matchable to
  the submission that caused it).
- `deserializeGameState`'s hard 52-card assertion is correct for this game and
  should be reused server-side as a post-apply invariant check — a cheap,
  high-value guard that catches any card duplication or loss the moment it
  happens.

## 6. Server/client architecture gaps

Everything is a gap; the notable decisions are:

- **Runtime**: no server process, no `ws` dependency, no way to execute
  TypeScript outside Vite. Two small dev-time additions (`ws`, and a TS runner
  such as `tsx`) are the minimum. Do not build a second bundler pipeline for the
  server.
- **No transport seam on the client**. `GameScene` calls `this.store.confirmTurn`
  directly. Online needs an indirection — a "turn driver" the scene talks to,
  implemented locally by today's synchronous store and remotely by a socket
  client. Introducing that seam is the single most important structural change,
  and it must default to the existing local behaviour so offline is untouched.
- **No server URL configuration**. The client needs a resolvable WS endpoint
  (env-var override, sensible same-host default) and must degrade gracefully —
  a dead server shows "cannot connect", never a broken menu.
- **Static-only deployment assets**: `Dockerfile`/`docker-compose.yml` serve the
  built site; they know nothing about a second process or port.
- **No session identity**. Reconnect is impossible without a token issued at
  join and stored client-side.

## 7. UI flow gaps

- No online entry point in `MenuScene`, no lobby scene, no room-code display or
  copy affordance, no ready control, no connection-status indicator, no
  disconnect/reconnect messaging, no path back to the local menu from a dead
  online session.
- `GameScene` has no notion of "not my turn, and I am not watching an AI": today
  the inactive state is always an AI turn with a thinking emote and a timer. The
  online inactive state needs its own presentation ("opponent is rearranging"),
  with the table strictly read-only.
- FEITO is currently *locally* authoritative: `onFeito` clears the editor and
  commits immediately. Online, FEITO must become "submit and wait", with a
  pending state, a rejection path that restores a safe state, and protection
  against a second submit while one is in flight.
- Rejection reasons already exist as localized `ReasonCode` strings — the server
  can return reason codes and the client can render them with the existing `t()`
  table. Reuse this; do not invent server-side English strings.
- `WinScene`'s rematch (`MESMA PARTIDA`) restarts locally from a config; online
  rematch is out of MVP scope and its button must not strand an online player.

## 8. Test/verification gaps

- Zero network tests. The unit suite is `environment: 'node'`, so server room
  logic can be tested in-process with the same runner — no new framework.
- The Playwright config starts one `webServer` (the static preview) and every
  test drives a single page. Multiplayer verification needs a second process
  (the WS server) and two browser contexts, plus a per-run log capturing room
  code, seed, revisions, message trace, validation results, and screenshot
  paths — mirroring the existing `verify-log.json` discipline rather than
  inventing a new format.
- `check-verify.mjs` gates on console errors, missing screenshots and fps; it
  has no notion of server errors. The multiplayer gate needs the equivalent:
  zero client console errors, zero server crashes, zero illegal accepted
  confirms.
- No adversarial tests. The valuable ones are the *rejections*: wrong player,
  stale revision, duplicate card, missing table card, zero hand cards, returning
  a committed table card to hand, forged card attributes, double submit.

## 9. Deployment gaps

- Single static artefact today; the alpha needs a second long-lived process,
  which changes the Docker story (two services or one image with two entry
  points) and requires the client to know the WS origin at build or run time.
- No health endpoint, no port documentation, no note on `wss://` behind TLS
  (a page served over HTTPS cannot open `ws://` — this will be the first
  deployment surprise and belongs in the docs before it bites).
- No room-count or memory ceiling; an alpha still deserves a hard cap on rooms
  and a reaper, or one bored visitor exhausts the process.

## 10. Top 10 Phase 5 tasks (ranked, weakest-blocker first)

1. **Shared-core hardening**: add a versioned wire envelope and `rev` to game
   state, a redacted per-player view type, and id-only proposal types; keep
   `canConfirmTurn` as the single validator; add save/load equality and
   redaction tests. Nothing else can be built safely first.
2. **Turn-driver seam on the client**: extract the scene's commit path behind a
   small interface with a local implementation that is behaviourally identical
   to today. Verify offline is byte-for-byte unchanged before any socket code
   exists.
3. **Server MVP**: `ws` server, room manager with codes, 2-player cap,
   ready/start, authoritative state, revision numbers, proposal validation via
   the shared rules, redacted broadcast, disconnect tracking, room reaper, and a
   hard boundary validator so no malformed message can crash the process.
4. **Anti-cheat essentials**: rehydrate cards from ids, reject stale/foreign
   revisions, reject out-of-turn intents, assert 52-card conservation after
   every apply.
5. **Lobby UI**: online menu entry, create/join, room code + copy, ready state,
   waiting/connection status, and an always-available exit back to local play.
6. **In-match online flow**: local seat index, read-only inactive view with an
   "opponent is rearranging" state, FEITO as submit-and-wait with in-flight
   locking, rejection reasons via the existing `t()` codes, and reconciliation
   to server state.
7. **Draw/end and win sync**, including the stalemate path, which is easy to
   forget because it is server-decided.
8. **Reconnect**: session token at join, resume-if-room-alive, resync to
   authoritative state, opponent-disconnected notice, timeout cleanup. If the
   in-flight-proposal race cannot be made safe cheaply, ship clean disconnect →
   lobby with a clear message and document the limitation honestly.
9. **Verification**: server unit tests (including malformed-message fuzzing),
   two-client Playwright flow with a full log, and a `verify:multiplayer` gate
   that fails on any client console error or server error.
10. **Docs and status**: architecture doc, README run-and-play sections,
    alpha limitations, protocol summary, CHANGELOG/RELEASE_NOTES, and
    `STATUS.json` with model-role and caveman logs.

## Pass criteria reminder for this phase

Local play must remain exactly as green as it is now (112/112 unit, 25/25 e2e,
lint, build, verify). An online alpha that costs a single local regression is a
net loss and should be reverted, not patched.
