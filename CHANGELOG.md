# Changelog

All notable changes to MEXEMEXE!. Entries below are historical and are kept as
written: some name phase audits and status files that have since been deleted,
and those remain readable in git history.

## 1.11.0 — 2026-09-16

### Changes

### lobby stabilization

### Fixed

- **A player who left between matches could strand the room for good.** Seats
  never move, so a four-player table that lost seat 1 kept seats 0, 2 and 3 —
  and `start_game` refused that shape outright with `seat_gap`, because the
  server assumed a room seat and a `GameState` player index were the same
  number. The two are now related explicitly (`RoomInternal.matchSeats`, on the
  wire as `GameView.seats`, see MULTIPLAYER.md §3f): a gap is dealt, seats still
  never compact, and the `seat_gap` error is gone. `PROTOCOL_VERSION` is 9.
- **An occupied seat above a gap vanished from the lobby.** The seat rows were
  sized by `players.length`, so with seats 0 and 3 taken the lobby drew three
  rows and the player in seat 3 was simply not on screen. Rows are counted from
  the highest occupied seat. Before/after:
  `docs/screenshots/lb-seat-gap-BEFORE.png` and
  `docs/screenshots/lb-seat-gaps-gaps.png`.
- **READY could disagree with the row it sat under.** The lobby kept its own
  copy of the local ready bit beside the server's. It is now derived from the
  room state, so a reconnect, a reload or a settings reset can never leave the
  button and the seat row telling different stories.
- **A refused START threw the host off the lobby.** `not_ready`, `not_host`,
  `game_started`, `room_full` and `rate_limited` are answered on the lobby
  itself now — the caller is still seated and every other control still works.
- **Two tabs of one session flapped the seat between them.** An evicted socket
  saw an ordinary close, still held the token, and its bounded reconnect loop
  took the seat straight back. The server now tells it `invalid_token` before
  closing it, which is one of the two codes the client treats as definitive.
- A scene restart no longer inherits the previous room's host seat, terms or
  lock state.

### Added

- `e2e-multiplayer/lobby.spec.ts` (`LB-*`) — the lobby as a distributed state
  machine, on **Chromium, Firefox and WebKit**: 2/3/4-client rooms, seat gaps,
  replacement seats, ready/settings/host-transfer races, real 2/3/4-player
  matches and rematches, a three-match endurance run across churn, reload,
  reconnect, multi-tab takeover and room-switch isolation. Assertions are on
  the rows the lobby actually painted, not only on its internal roster.
- `tests/server/lobby-soak.test.ts` — the seeded counterpart to those named
  scenarios: a deterministic random walk of join/leave/ready/disconnect/
  reconnect/start/play/rematch against a real `RoomManager` (10 seeds x 1200
  steps), re-checking every room invariant after each step, including the
  seat/player-index mapping. A failure prints the step log and its seed replays
  it exactly.
- `e2e-multiplayer/ios-lobby.spec.ts` — the WebKit iOS gate: five portrait and
  landscape viewports, an orientation change that must not touch server state,
  and a two-client match with a mid-match reload.

## 1.10.2 — 2026-09-15

### join screen name, quieter by default

### Fixed

- Online players can set their display name directly on the join screen instead
  of being stuck with whatever name the client picked for them.

### Changed

- Background music is now off by default. `DEFAULT_SETTINGS.musicEnabled` is
  `false`, so the ambient playlist and the boteco room tone stay silent until
  the player turns music on in Settings. Saves migrated from the pre-music
  settings key start silent too.

## 1.10.1 — 2026-09-15

### menu and online papercuts

### Fixed: screens that offered something that could not work

Four papercuts reported from play, all the same shape.

- The menu treated "tutorial not completed" as "first run", so a player who
  skipped the lesson and then finished a match still got APRENDER A JOGAR as the
  big green button on every visit. First run now also requires
  `gamesStarted === 0`.
- The lobby's START sat at `cx()+110` with a half-width of 41, hanging 11px off
  the 280-wide backdrop panel on every desktop screen. It moved to `cx()+95`,
  and its "waiting on ..." line is centred on the panel rather than on an
  off-centre anchor it overflowed from.
- Creating a room and backing out left a CONTINUAR whose room the server had
  already destroyed, because we were its only occupant. Leaving a room we were
  alone in now forgets it.
- A recent-room shortcut the server says is gone dropped the player onto the
  full-screen error phase. The card is still retired, but the reason is said on
  the entry screen, so every other way in stays one tap away.

The E2E menu specs no longer assume the first-run layout after a match has been
played.

### Documentation

`docs/SELF_HOSTING.md` told self-hosters to pull an image tag that did not
exist, and described compose files that were not in the repository. The tag now
matches what the release workflow publishes, and the compose files ship
alongside the docs.

### Packaging

`package-lock.json` carried the version from before the last release. The
release script now bumps the lockfile with `package.json`, so the two cannot
drift apart again.

The arm64 container images were built on an amd64 runner under QEMU, where
`npm ci` dies with "illegal instruction". Each architecture is now built on its
own native runner and the two are joined into one multi-arch tag, so the
published `-web` and `-server` images cover amd64 and arm64 again. Publishing
the GitHub Release is idempotent, so a release whose image build failed can be
re-run against the same tag.

## 1.10.0 — 2026-09-15

### Fixed: a search that had already found a chair could still be matched again

A session that joined the Quick Match queue and then created or joined a room by
code stayed in the queue. The next group formed around it, moved its socket to
the matchmade table, and left the room it had just sat down in holding a seat
marked connected with no transport on it — which made that room invisible to the
sweep, to the idle backstop and to the stalled-turn check, so anyone else in it
was stranded on it for the life of the process. Taking a seat now leaves the
queue, and the searching screen is told so. Regression test:
`tests/server/queue.integration.test.ts`.

### Fixed: a crafted link could ask the game for its seat credential

The client resolves its server from `?ws=` first (documented, and how LAN and
self-hosted setups point at their own server), but it replayed the stored
reconnect token to whatever server that resolved to. A link on the real origin
naming someone else's server was therefore enough to be handed a live seat
token. The token is now stored beside the endpoint that issued it and replayed
only to that endpoint; a token from an older build carries no endpoint and is
discarded. Regression test: `tests/net/reconnect.test.ts`.

### Documentation

`docs/MULTIPLAYER.md` said rate limiting was per connection and not per IP,
which stopped being true when the per-address budgets landed; the turn-timer
note in `docs/GAME_RULES.md` listed the three presets and not the custom screen
behind them. Both now describe what ships.

## 1.9.2 — 2026-09-14

### Fixed: the board could go dead mid-match

Two independent bugs, both reachable only after a match had run a while, both
with the same player-visible symptom — no button answers a click until you tap
a card on the table first.

- **The presentation hold could never end.** `presentingUntil` is an absolute
  `time.now` deadline, but the `delayedCall` that wakes the board up counts
  smoothed frame deltas: the wake-up can land a frame short of its own deadline.
  The re-render it triggered then still read the board as presenting, built
  FEITO, COMPRAR and every card disabled, and left nothing scheduled to try
  again — so the turn stayed locked until some unrelated input forced another
  render. The waker now clears the deadline it was scheduled for
  (`endPresentation`) instead of re-comparing two clocks that disagree. The
  FEITO confirm guard had the same shape and the same fix.
- **A long hand drew on top of the action buttons.** An overflowing hand keeps
  `MIN_HAND_GAP` between cards and scrolls rather than compressing, so the row
  is wider than the hand strip by design — but nothing clipped it. In landscape
  the tail spilled straight over the action cluster, and a card sprite beats a
  button in the hit test, so past roughly forty cards the spill swallowed every
  click on COMPRAR/FEITO. Cards outside the strip are now hidden and
  un-clickable (`clipToHandStrip`), at layout and while scrolling.

Neither is reachable from a fixture, so the regression test plays a real match
and clicks the real button turn after turn (`long-match: COMPRAR stays
clickable turn after turn`). It fails on the old code at the third human turn.

### Added: arm64 container images

The published `mexemexe-game-web` and `mexemexe-game-server` images were
amd64-only, so pulling them on an Apple Silicon Mac or an arm64 Linux host
(Raspberry Pi, AWS Graviton, Ampere) failed with `no matching manifest for
linux/arm64/v8 in the manifest list entries`. The release workflow now sets up
QEMU and builds both images for `linux/amd64,linux/arm64`, so each tag pushes a
multi-arch manifest list.

### Changed: the server image no longer carries the browser bundle's toolchain

The server stage inherited the shared `deps` layer, so its image shipped the
whole install — phaser, typescript, vite, playwright, eslint, vitest — 305MB of
`node_modules` for a process that imports `ws`, `tsx` and the pure modules under
`src/rules`, `src/core` and `src/net`. It now installs its own tree with
`--omit=dev` and drops phaser, which only the browser bundle needs. The image
went from 637MB to 298MB, most of what remains being the Node base and the
esbuild binary that `tsx` ships.

## 1.9.1 — 2026-09-13

### Repository simplification

- **Fixed: the second match of a session lost its escalation cues.** The seats
  whose last-card and 2-cards moments had already fired were remembered across
  matches, so in a rematch those seats got no cue at all. Phaser reuses one
  GameScene instance for the whole page load, so a field initializer runs once
  per page, not once per match — every per-match field now resets in one
  `resetForNewMatch()`, placed under the declarations it mirrors.
- **Fixed: a rematch could show the previous match's winning move.** The same
  cause: `lastConfirmedMoveText` and the AI's explanation line carried over.
- **Fixed: the pause overlay could be left permanently unopenable.** `pauseOpen`
  latches; if the scene leaves while the overlay is open by any path other than
  Quit, the pause button and ESC silently do nothing for the rest of the next
  match. The second-match e2e now quits through the pause overlay, so a latch
  fails the suite.
- **Fixed: "reset all data" left the pre-v1 save key behind.** `resetData()`
  promised to wipe both keys and wiped one, so `loadSave`'s migration restored
  the old settings on the next boot. Save storage now has one owner
  (`src/core/persistence.ts`); `src/core/settings.ts` no longer reaches for
  `localStorage` itself.
- **Changed: RulesConfig says only what a game is dealt from.** Seven of its ten
  fields were read by nothing — group bounds, the unique-suit rule and the
  needs-a-natural rule are fixed in `analyzeMeld`. Removing them made the
  `config` argument inert in nine rules and table functions, so it is gone from
  all of them. Meld legality is unchanged.
- **Changed: 75 exported symbols are module-private.** Including 22 wire-message
  interfaces that exist only to build the ClientMessage/ServerMessage unions.
  Three symbols nothing used at all are deleted, as are six duplicated blocks —
  among them the server's turn preconditions and publish, now `claimTurn` and
  `commitTurn`.
- **Docs: 76 tracked Markdown files (9694 lines) down to 18 (3615).** Completed
  phase audits, the finished improvements backlog and a status file that
  restated the changelog are readable in git history instead of in the way of
  every task. `AGENTS.md` is now a permanent rules file naming one canonical
  document per concept.

## 1.9.0 — 2026-09-13

### Online, rotation and late-review fixes

- **Fixed: input is locked while disconnected.** An online client whose socket
  had dropped still accepted taps, queueing moves against a server that would
  never see them.
- **Fixed: the room host is no longer hardcoded to seat 0.** If the host left
  after a match the lobby became permanently unstartable, because nobody else
  could ever be host.
- **Fixed: online results reported a previous local match's numbers.** The
  results screen read the local match record rather than the online one.
- **Changed: the reason line and problem cycle sort illegal before incomplete.**
  The game now names the real contradiction instead of a trivially-fixable lone
  card.
- **Changed: chrome gold is separated from status gold.** `#f7d23e` was
  simultaneously `STATUS_COLOR.incomplete.fill` and the banner, reason line,
  active-seat ring and win title, so meld status and page furniture were
  indistinguishable.
- **Fixed: rotation no longer orphans the drag layer.** A flip mid-drag left a
  permanent black shadow ellipse and stale drop zones behind, and board chrome
  is now rebuilt on rotation — the background was cover-fit to the wrong world
  and a 480x270 dim rect sat inside a 270x480 one.
- **Fixed: input is gated on the opening deal.** Plus the online timer leaking a
  ticker per rotation, a reset arm that could desync from its own warning, a
  portrait workspace pointing at a deleted meld, three branches dead because
  `historyLength()` is seeded with one snapshot and so is never 0, and
  layout-affecting settings not applying until some later unrelated action.

### Experience improvement backlog (280/280)

- **Fixed: one meld classifier, one status-to-colour map.** `src/table/snap.ts`
  now owns `meldStatus` and `STATUS_COLOR`. Two classifiers previously
  disagreed about `reason.runGap`: dragging a card over a gapped run painted the
  zone red, and releasing it rendered the same meld gold. An under-length
  work-in-progress meld no longer carries the same red alarm as a genuine
  contradiction.
- **Added: spatial invalid explanations.** A reserved column and dashed
  placeholder mark a run's missing card, and a ring marks the cards actually in
  conflict.
- **Fixed: scene lifecycle state survived shutdown.** `sceneGone`, `guardTimer`
  and `onlineResyncing` (GameScene) and `dealing` (SetupScene) were field
  initializers that shutdown mutated and `create()` never restored. Since
  Phaser reuses one scene instance, `sceneGone` made every second match of a
  page load hang on the AI's turn with all controls disabled — reachable from
  rematch, replay and the tutorial handoff.
- **Changed: the tutorial is Dona Cida's.** Steps cut to a two-sentence bar, a
  phase name beside the step counter, undo taught at the point of failure, and
  completion leading into a real first match with beginner helpers.
- **Added: AI tells, pacing and a visible endgame.** Per-personality pre-move
  tells, a comeback moment, `matchIntensity` wired to emote cooldown and sfx,
  and an opponent's winning move shown instead of the board freezing before
  results.
- **Fixed: hand scroll for oversized hands.** The gesture existed but was
  unreachable — the touch hit-pad left no bare strip to grab. Zoom is preserved
  across an orientation flip, and a density-gated rotate hint was added.
- **Fixed: results copy competed with the dimmed table behind it.** Opaque
  backing plates now sit under it; a Mexe time-extension notice and missed-turn
  warning are wired to server state that already carried them.
- **Changed: haptics default to off.** They were shipping on by default while
  documented as opt-in.

### Test and documentation upkeep

- **Fixed: a tap race on WebKit, and CI fps floors rebased.**
- **Fixed: real-input e2e helpers wait for the opening deal.**
- **Docs: cross-browser and PWA screenshots refreshed.**
- **Docs: `AGENTS.md` condensed** from prose lists into the rules themselves.

## 1.8.0 — 2026-09-11

### privacy-first production monitoring

- **Added: nginx access logging is off.** The static-game image now ships its own
  `nginx.conf` with `access_log off;`. The stock configuration persisted a client
  IP, user agent, referrer and full request URL for every asset fetch. Error
  logging stays on but at `crit` rather than the default `error`, because nginx
  writes the client IP and the request line into *every* error entry and a
  missing favicon counts as one — the default would have kept logging an IP per
  404 through the back door.
- **Changed: exceptions are logged as a type, never as text.** The five
  `String(err)` call sites in `server/index.ts` became `errorFields(err,
  config.mode)`, which yields `{errorType}` in production. An exception message
  is player- and attacker-influenced free text; a name, a room code or a whole
  payload can end up inside one. `errorType` is validated as a source identifier
  (`Error.prototype.name` is writable, so an unvalidated name could smuggle the
  text straight back), and development keeps the message so local debugging is
  not blinded by a production rule.
- **Changed: the logger redacts more, centrally.** `address`, `remote`, `agent`,
  `email`, `session` and `fingerprint` joined the sensitive-substring list — a
  canary test caught `remoteAddress` passing through untouched. Free-form keys
  (`message`, `error`, `stack`, `payload`, …) are now redacted by *exact* match,
  so a bounded field like `messageType` still survives.
- **Added: a `/metrics` endpoint.** Sixteen aggregate Prometheus series:
  connections, rooms, capacity ratios, uptime, memory, and lifecycle/error
  counters. There is no per-room, per-player, per-socket or per-request series,
  because one time series per player is a tracking system however it is
  labelled. The only label in the whole exposition is a fixed-set
  `reason="global_cap"|"ip_cap"`, and a test asserts exactly that by matching
  every rendered label against the set.
- **Added: `/metrics` is closed by default in production.** It exists only when
  `MEXE_METRICS_TOKEN` is set (minimum 16 characters, enforced at startup), and
  then only for a caller presenting it as a bearer token, compared in constant
  time. An unauthorized request gets a 404, not a 401, so it learns nothing
  about whether the endpoint is there. `/health` stays open and unchanged — five
  aggregate numbers that the Docker healthcheck depends on.
- **Added: bounded log retention and an optional monitoring stack.** Both
  containers cap their json-file logs at 10 MB × 3. `docker compose --profile
  monitoring up -d` brings up Prometheus (30-day retention, eight actionable
  alerts) and Grafana with one aggregate dashboard; it is off by default, since
  a single-host deployment can read `/health` and `/metrics` directly. Grafana
  reads its admin password from a git-ignored file rather than an env default,
  so there is no `admin` fallback to forget about.
- **Added: privacy regression tests.** Fake canaries (`SECRET_PLAYER_NAME_123`,
  `SECRET_ROOM_CODE_456`, `SECRET_RECONNECT_TOKEN_789`, `203.0.113.42`) are
  asserted absent from every emitted line, from `/metrics` and from `/health`,
  against a real server running in production mode with debug logging on — the
  noisiest configuration that can ship. `tests/no-telemetry.test.ts` fails the
  build if an analytics vendor, a `sendBeacon` or a persistent diagnostic
  identifier ever appears in the client.
- **Documented:** `docs/OBSERVABILITY_PRIVACY.md` — what is logged, what is
  never logged, every metric and the label policy, client diagnostics, retention
  and the debugging workflow. It states plainly that client IP addresses *are*
  processed in memory for the per-IP connection cap, because claiming the
  application processes no personal data would not be true.

### improvement package: room settings, server turn timer, AI difficulty

- **Added: a server-authoritative online turn timer.** The host picks Casual
  (90s turn, +45s Mexe bonus, 10s warning, 60s reconnect grace), Fast (45s /
  +20s / 10s / 30s) or Off in the lobby, and the choice freezes the moment the
  match starts. The server owns the clock outright: a room stores a start
  instant and a budget, the existing per-tick stalled-match check (now every
  second instead of every five) compares them, and the client only ever renders
  the `turnMsLeft` it was sent. A client countdown reaching zero does nothing.
  There is no per-room `setTimeout`, so a deleted room leaves nothing to leak.
- **Added: `timerExpireTurn` is finally wired.** An expiry — clock run out, or a
  seat absent past the room's reconnect grace — draws one card and passes,
  nothing else. It cannot confirm an illegal table, structurally rather than by
  a check: a Mexe draft never leaves the client until FEITO, so the server's
  turn-start state *is* the table it falls back to.
- **Added: anti-stall.** Each seat carries a missed-turn counter; losing
  `missedTurnLimit` turns in a row ends the match with a stated reason instead
  of leaving the others on a board that only advances by draw. Any turn the seat
  actually takes resets the streak. A reconnecting seat receives the *current*
  remaining time, never a fresh budget, so a reconnect loop cannot hold a turn
  open.
- **Added: the Mexe bonus.** Opening the Mexe editor online claims a one-off
  turn extension. Active seat only, once per turn, only while a clock is
  running — re-opening the editor is a no-op.
- **Added: a lobby room summary.** Every seat reads the terms it is playing
  under (timer preset, turn length, Mexe bonus, reconnect grace); the host taps
  the line to cycle presets. Nothing is applied locally — the tap sends a
  proposal and the server's answer is what redraws the line, so host and guests
  can never show different terms.
- **Added: AI difficulty, pace and move explanations** (settings → ADVERSÁRIOS /
  OPPONENTS). Difficulty is a search tier — Beginner plays one action per turn,
  Casual lays down and extends, Smart is each personality's own engine, Expert
  runs the rearrangement search for every personality with a wider candidate cap
  and budget. Personality still picks the policy (joker holding, minimal play,
  patience). `smart` reproduces the previously shipped behaviour exactly. No tier
  sees a hidden hand, and every candidate still goes through `canConfirm`.
- **Added: a turn-timer tick cue** over the warning window, on the player's own
  turn only, mixed through the existing SFX volume and switchable under AUDIO.
- **Changed: `PROTOCOL_VERSION` 3 → 4.** `GameView` gained `settings` and
  `turnMsLeft`; `room_joined`/`room_state` gained `settings`/`hostSeat` (and
  `room_state` a `locked` flag); the client gained `set_room_settings` and
  `mexe_started`, the server a `turn_timeout` notice. `turnMsLeft` is
  deliberately outside the state digest — a ticking clock is not a desync.
- **Changed: settings gained an AI section** between Cosmetics and Advanced, and
  an audio row for the timer tick. Row coordinates still come from
  `src/ui/settings-layout.ts`, so the e2e suite follows the enum rather than a
  snapshot.
- **Changed: the in-game rules panel** explains the online clock (who sets it, what
  the Mexe extension does, that a timeout draws one card and reverts the table
  rather than confirming anything) and points at the AI settings, in both locales.
- **Fixed: the `help` / `help-en` screenshots were photographing the settings
  panel.** They clicked a hardcoded pause-menu row that had drifted onto
  Settings, so the panel they are named for had no capture at all. They now click
  REGRAS and wait on `debugApi.rulesOpen` instead of trusting a coordinate.
- **Tests: 564 → 610.** New: `tests/net/room-settings.test.ts` (preset and
  custom-bound normalization, wire parsing, digest stability),
  `tests/server/timer.test.ts` (settings lock, expiry applies exactly once,
  timeout leaves the table untouched, the bonus cannot be spammed, reconnect
  resumes rather than restarts, missed-turn limit), AI difficulty legality and
  determinism at every tier, and settings persistence/corruption fallbacks.
  New e2e capture: `ai-settings`.

### UI/UX, usability and clarity pass

- **Fixed: a greyed-out DONE now always says why.** The reason line next to
  FEITO/DONE used to go blank outside beginner/standard helper mode, and the
  disabled button wore a `✕ ` prefix that playtesters read as "press this to
  cancel". The label is now always plain FEITO/DONE, the blocking reason is live
  in every mode, and beginner adds a three-line ✓/✕ checklist — played a hand
  card, all melds valid, nothing returned to hand — restated from
  `canConfirmTurn`'s own result, never decided independently.
- **Changed: the "what do I do now" copy is state-aware.** `objectivePhase` gained
  a card-selected phase and a played-but-not-confirmable phase, so the line reads
  "Sua vez — jogue cartas ou compre 1", "Carta selecionada — toque no lugar onde
  ela vai", "Mesa inválida — corrija as combinações para tocar FEITO" and so on,
  instead of one generic sentence.
- **Fixed: the table no longer looks abandoned.** `computeMeldLayout` centres each
  packed row horizontally and centres the whole block vertically when it fits, so
  a one-meld table sits in the middle instead of the top-left corner. An
  overflowing (zoomed) table still starts at y0 so nothing is pushed off-screen.
- **Changed: menu and setup share one real wooden panel.** The translucent
  rectangle with a hairline stroke read as a debug overlay; `woodPanel` draws an
  opaque frame both scenes now use. `ONLINE (ALFA)` became `SALA ONLINE` /
  `ONLINE ROOM` with a small "Teste alpha" line, and setup gained a match summary
  ("2 jogadores · Você vs Juninho · Partida local") while the replay-seed button
  moved behind an ADVANCED toggle.
- **Changed: settings is a section menu, not a debug screen.** One flat 14-row
  list became Mute / Game / Audio / Accessibility / Cosmetics / Advanced / Close,
  each section its own sub-panel. COPY TEST LOG, RESET DATA and the build version
  live under Advanced.
- **Fixed: the rotate banner no longer tells phone players portrait is wrong.**
  Portrait has a hand-authored layout; the hint now reads "Retrato funciona.
  Paisagem dá mais espaço." and only appears during a match.
- **Fixed: the per-meld magnifier was a ~7-unit tap target** — a click a pixel off
  its corner selected the card underneath. It now has an enlarged hit rect, the
  same fix the invalid badge already carried.
- **Changed: pause menu** gained "Jogo pausado. Seu progresso está seguro." and
  consistent uppercase captions.
- Full audit, including what was deliberately not attempted (server-owned turn
  timers, AI difficulty settings, the toolbar relabel), in
  `docs/UI_UX_USABILITY_DESIGN_AUDIT.md`.

### Documentation cleanup

- **Changed: the documentation was restructured around one source of truth per
  topic.** The root now holds only README, CHANGELOG, CONTRIBUTING and LICENSE;
  everything else lives in `docs/`, with 37 phase audits, plans and the stale
  `RELEASE_NOTES.md` moved to `docs/archive/`. `RULES.md`, `MULTIPLAYER_ARCHITECTURE.md`
  and `PIXELLAB_ASSETS.md` were renamed to `GAME_RULES.md`, `MULTIPLAYER.md` and
  `ASSETS.md`; `DEVELOPMENT.md`, `TESTING.md`, `PWA_OFFLINE.md` and `ROADMAP.md`
  are new. The README dropped from 344 to 142 lines. Full account in
  `docs/CLEANUP_REPORT.md`.
- **Fixed: docs that disagreed with the build.** Online play is alpha everywhere
  (the UI always said `ONLINE (ALPHA)`), the "no composed music track" note is
  gone (five tracks ship), the turn timer is marked an unwired hook rather than
  an optional rule, and `ARCHITECTURE.md`'s module map matches the actual tree.
  `GAME_RULES.md` gained ten worked examples, each verified against
  `analyzeMeld`.
- **Changed: `docs/STATUS.json` is a 137-line status file** instead of a 176 KB
  accumulation of every phase since wave 1; the history moved to
  `docs/archive/STATUS-history.json`.
- **Removed: 7.7 MB of duplicate audio masters** — three `music/*.mp3` files
  byte-identical to the shipped tracks in `public/assets/audio/music/`. No
  shipped asset changed, and no gameplay code was touched in this pass.

### Release container images

- **Added: tagged releases publish Docker images to GitHub Container Registry.**
  `.github/workflows/release.yml` gained an `images` job that builds both
  `Dockerfile` targets and pushes them as `ghcr.io/<owner>/mexemexe-game-web`
  and `-server`, tagged with the release tag and `latest`. Self-hosters can pull
  instead of building; `docs/SELF_HOSTING.md` documents that the published web image
  bakes an empty `VITE_WS_URL`, so a client pointed at a different host still
  needs a local build.

## 1.7.0 — 2026-09-11

### Phase 23 (PWA offline reliability)

Service worker lifecycle pass. Offline play, the versioned cache and the offline
online-room gating were already built and tested (Phases 16, 18 and 20); what had
no coverage was what happens on the *first* install and on an *update*. Five
defects there, all client-side, no game rules touched. See
`docs/archive/PHASE23_PWA_OFFLINE_AUDIT.md`.

- **Fixed: the first install reloaded the page mid-boot.** `sw.js`'s `activate`
  calls `clients.claim()`, so a first-ever visit fires `controllerchange` — and
  the handler reloaded unconditionally, throwing away a cold boot's worth of
  asset loading and repeating it. Reloading now requires the player to have
  actually asked for an update. Measured 2 main-frame navigations on a first load
  before the fix, 1 after.
- **Fixed: a build that finished installing during an earlier visit never
  announced itself.** The update banner was wired only from `updatefound`, which
  does not fire again for a worker already `waiting` at page load, so that build
  sat unused while the stale one kept being served. The waiting worker is now
  checked at registration.
- **Fixed: the update banner had no action affordance** — it showed the notice
  only, while the whole div was silently the tap target. It now reads
  `Nova versão disponível. Atualize quando terminar a partida. [Atualizar agora]`
  (new `update.now` key, both locales). The handover still happens only on a tap,
  so an in-progress match is never interrupted.
- **Fixed: `updatefound` firing twice stacked a second banner** on the first.
- **Added: an installed PWA re-checks for updates on resume.** Browsers only
  check on navigation, which a standalone app that is merely backgrounded never
  does. `visibilitychange` now calls `reg.update()`; it can at most surface the
  banner.
- **Added: `e2e-pwa/update.spec.ts`** (2 tests, a fresh context each — the only
  way to observe a first install). The second stands in for a deploy by rewriting
  `dist/sw.js`'s cache key, then asserts the banner appears with no reload, the
  old cache still serves, and the tap produces exactly one reload plus eviction
  of the old cache.
- **Added: the PWA suite now runs in CI** (`PWA offline verification` job,
  Chromium only). It previously only ran locally.
- **Fixed: two flaky CI gates.** `verify:multiplayer` asserted the transient
  `'reconnecting'` status with a live `status()` sample taken *after* an unbounded
  screenshot step, so on a loaded runner it could only ever observe `'open'` — no
  timeout would have helped. `NetClient` now keeps a bounded status history
  (`statusTrace`, exposed on the debug API next to `trace`) and the spec asserts
  the transition was recorded, which is order-independent. Separately,
  `crowded-table-max`'s fps floor is now `process.env.CI ? 30 : 45`: the GPU-less
  runner measured 40 and had been squeaking past a single 45 bar, so that bar was
  gating on runner load rather than on a regression.
- **Fixed: a third flaky CI gate**, in the WebKit touch suite. Three
  `e2e-cross/mobile-gameplay.spec.ts` tests tapped twice in a row and asserted
  immediately, trusting `tapWorld`'s two-frame barrier. Phaser applies a tap on
  the frame it drains its pointer queue, so on a loaded runner the second tap
  could be dispatched before the first had taken effect and then act on stale
  state — a deselect that arrived before its own select landed, or a place tap
  with nothing yet held. New `tapCardAndSettle` helper polls for the selection
  to flip before returning, and the drop is polled for the same reason.
- **Docs: `docs/SELF_HOSTING.md` gained "Service worker cache and deploys"** —
  `public/assets/**` is unhashed and served cache-first, so a deploy that changes
  art or SFX needs a `package.json` version bump to reach players who already
  loaded the game.

### Phase 19 (gameplay bug hunt + rules regression + iOS/WebKit mobile probe)

An active hunt for gameplay, rules, AI, local/online parity and mobile bugs. No
bug was reproducible, so no game code changed — the outcome of this phase is
test coverage over the two areas that had none. See
`docs/archive/PHASE19_GAMEPLAY_BUG_AUDIT.md`.

- **Added: seeded whole-game invariant probes (`tests/probes.test.ts`, 45 tests).**
  `tests/soak.test.ts` only asserted that games terminate. These probes run 40
  seeded full AI-vs-AI games (seeds 1-40) and check, on every turn, that the deck
  still totals 108 cards with no duplicate ids, that the committed table passes
  `validateTable`, that `activePlayerIndex` stays in range and advances clockwise,
  and that at least one card leaves the active hand on every confirm. Plus a
  determinism test (seeds 1, 17 and 40 run twice produce a JSON-equal final state
  and turn count) and four edge probes: an empty draw pile, a one-card draw pile, a
  ten-meld crowded table, and 120 operations of `DraftEditor` undo/redo/reset abuse.
- **Added: mobile gameplay end-to-end coverage (`e2e-cross/mobile-gameplay.spec.ts`,
  12 tests across 3 WebKit touch projects).** `e2e-cross/` previously covered layout
  and rotation only — no tap, drag, FEITO, Mexe Mode, undo/reset or draw had ever
  been exercised on a touch viewport. The suite runs on `ios safari`,
  `ios safari portrait` and `ipad`, asserting real game state through
  `window.__MEXE__` rather than pixels, and checks that an orientation flip
  mid-match preserves card conservation. Screenshots land in
  `docs/screenshots/phase19-mobile-*.png`.
- **Added: three rules regression tests** covering card conservation on the deal,
  the `applyConfirmedTurn` conservation invariant, and 4-player clockwise turn-order
  cycling.
- **Verified, not changed:** every required joker, trinca and ace example
  (including `K♠ A♠ 2♠` wrap rejection and a cross-deck repeated suit), the
  fewest-cards-wins tie-break, the server's start/stall/reconnect guards, and the
  redaction boundary that keeps opponent hands off the wire. Seven suspected
  defects raised during the audit were each probed and refuted; the refutations are
  recorded in the audit document.
- **Checked that the new suites can fail:** breaking `applyConfirmedTurn`'s hand
  removal failed 41 of 45 probe tests, and breaking `DraftEditor.reset()` failed the
  mobile undo/reset test. Both mutations were reverted.

### Phase 18 (multiplayer stability + abuse hardening)

Online hardening pass over reconnect, seat ownership, protocol bounds, room
cleanup and the client's online UX. No game-rule changes. See
`docs/archive/PHASE18_MULTIPLAYER_AUDIT.md`.

- **Fixed: reconnecting onto another room no longer leaves the old room stuck.**
  `reconnect` detached the socket from its previous seat but never told the room
  manager, so that seat stayed `connected` with nothing attached — which hid the
  room from the stalled-turn advance, from the sweep and from the idle backstop.
  A member of a live match could hop away and strand everyone else in it
  permanently. The hop now releases the old seat and tells that room
  (`player_disconnected` + refreshed `room_state`).
- **Fixed: a legal late-game proposal could be rejected as a malformed message.**
  `parseClientMessage` capped `submit_turn` at 60 card ids, but a proposal carries
  the whole draft table plus the cards being played, against a 108-card deck.
  Cap raised to 120, so a large table rearrangement comes back as a proposal
  result instead of a generic `bad_message` that made FEITO look dead.
- **Fixed: a move pressed while the socket was down was dropped silently.**
  `NetClient.submitTurn`/`drawEndTurn` now report that nothing went out, and the
  board releases its submit lock with "Sua jogada não foi enviada. Reconecte e
  tente de novo." instead of sitting locked until the pending timeout.
- **Fixed: an expired session token trapped the online lobby.** The dead token
  stayed in `sessionStorage` and was re-sent on every later entry, so the lobby
  (and the retry) kept landing on the "session expired" screen. The client now
  drops a token the server has rejected.
- **Fixed: stale lobby presence.** Disconnect and reconnect now re-broadcast
  `room_state`, which is what the lobby renders presence from.
- **Added: the online lobby survives app sleep**, matching the in-match
  behaviour — resync if the socket is still open, otherwise reconnect.
- **Crash policy: an uncaught exception now exits the process** (status 1) rather
  than serving rooms from unknown state; `docker-compose` already restarts it.
  Per-room crash isolation is unchanged and still handles a single corrupt room.
- The flood guard closes with `1008` (policy violation) instead of a bare close,
  so a client can tell it apart from a network drop.
- **New integration suite** `tests/server/index.integration.test.ts`: spawns the
  real server and drives raw `ws` clients through malformed, oversized and
  out-of-room frames, the failed-join and flood closes, the connection cap, seat
  ownership and the room-hop regression, hand privacy in a real frame, room and
  connection cleanup, and a clean-session stderr check.
- `verify:multiplayer` now runs in CI as its own job.

## 1.6.0 — Audit fixes

- Isolate reconnect sockets and harden connection limits.
- Stop crashed scenes before menu recovery; destroy rebuilt menu-family objects.
- Rotate the service-worker cache namespace.
- Rate-limit failed room-code guesses per connection and cap join-code length.
- Isolate stalled-turn advancement per room; a corrupt room is dropped and its
  sockets notified instead of throwing on every tick.
- Close finished-match rooms right after `game_over` (frees the slot, clean
  `room_closed` notice) instead of waiting for the idle sweep.
- Slice the rearranging AI search across event-loop turns so it no longer
  blocks a frame for up to 400ms.
- Boot asset probes use GET instead of HEAD, so the service worker's HEAD
  special-case is gone and probe responses prime the offline cache. The probe
  drains the response body rather than cancelling it — cancelling raced the
  service worker's own `cache.put` clone and broke asset loads in Firefox.

### Phase 15 (PWA + offline local/AI play)

The game is now installable and works fully offline once loaded once. See
`docs/archive/PHASE15_AUDIT.md`.

- **Installable PWA**: `public/manifest.webmanifest` (name MEXE!, standalone
  display) and three generated icons (`scripts/gen-icons.mjs`,
  `npm run gen:icons`), linked from `index.html`.
- **Service worker** (`public/sw.js`): precaches the app shell only —
  `BootScene` fills the runtime cache on first (online) load. Network-first
  navigations with the cached `index.html` as an offline fallback, so a new
  build is always picked up without a manual purge. Background music is
  passthrough, never cached (~11 MB of streamed mp3, silent offline); every
  other same-origin GET is cache-first. Cross-origin and non-GET traffic is
  never touched, so private multiplayer state can never land in the cache.
- **Offline detection** (`src/core/pwa.ts`): the ONLINE menu button disables
  itself offline with a reason line; entering the online screen offline goes
  straight to the existing error state instead of attempting to connect.
  Every local option (matches, AI, tutorial, rules, settings) stays fully
  usable offline.
- **Safe updates**: a new service worker never takes over on its own — a
  dismissible banner appears when an update is ready, and only a click
  applies it and reloads, so a match in progress is never interrupted.
- **New verification**: `npm run verify:pwa` (Playwright, production build
  only) covers manifest/icons, first-load caching, offline reload, offline
  local/AI/tutorial play, and returning online. `tests/pwa.test.ts` and
  `tests/offline.test.ts` added (408/408 unit tests total, was 330).

### Phase 14 (helper modes, mobile Mexe editor, table zoom, tutorial/help)

Phase 13 gave touch its own board shape; Phase 12 gave tap-select-then-place
visual feedback on drag only. This phase closes both remaining gaps: the
tap-select path now gets the same legality feedback a drag does, a crowded
table gets a dedicated mobile editing surface and a zoom/focus view, and the
tutorial and in-game help panel teach all of it. See `docs/archive/PHASE14_AUDIT.md`.

- **Three helper modes** (`src/ui/helpers.ts`, Settings → VISUAL HELP):
  Beginner shows legal destinations, invalid-meld reasons and a ghost
  preview; Standard shows only validity highlights and the FEITO reason;
  Expert shows the least — the final check only. The mode changes what is
  *shown*, never what is *legal*.
- **Selection feedback for tap and keyboard** (`src/scenes/GameScene.ts`):
  selecting a card highlights its legal destinations (Beginner), an invalid
  meld's ✗ badge is tappable and can carry more than one reason, and a
  non-mutating ghost preview shows the result of a held card before it's
  dropped. Two invalid-run reasons were split out of the old generic
  `reason.notAMeld` bucket: `reason.runSuitMismatch` and `reason.runGap`.
- **A focused mobile Mexe editor** (`src/table/editor-layout.ts`): a
  full-screen, scrollable meld-list view for a portrait phone, toggled by an
  icon next to Undo — a bigger workspace than the normal cramped table for
  rearranging melds by tap.
- **Table zoom and meld focus** (`src/table/zoom.ts`): + / − buttons zoom a
  crowded table (no pinch gesture) with clamped panning, and a magnifier icon
  opens a large, read-only focus view of one meld. A dragged card now clears
  the zoomed table's clipping mask for the gesture, so dragging it toward the
  hand no longer clips it mid-drag.
- **Tutorial and help panel updated**: the tutorial's invalid-meld step now
  says to tap the ✗ instead of describing a hover-only gesture, and the
  rules/help panel (`src/ui/rules-panel.ts`) gained a scrollable UI-help
  section covering helper modes, selection highlights, the ghost preview, the
  mobile editor, zoom/focus, and the online locked (not-your-turn) state.
- **Full pt-BR/en-US coverage**: every string this phase added exists in both
  locales with real, locale-specific copy, checked by `tests/i18n.test.ts`.

### Phase 13 (mobile layout, tap-first controls)

The board was authored into one fixed 480x270 world and letterboxed to fit, so a
portrait phone got a 390x219 board and a permanent "turn your phone sideways"
banner. Touch input was already fine — Phase 12 shipped select-then-place, a
tappable invalid badge and padded card hit areas — so this phase gave the board a
second shape rather than a second input model. See `docs/archive/PHASE13_AUDIT.md`.

Desktop is unchanged by construction: the landscape half of the region table is
the old constants, and `tests/regions.test.ts` fails if any of them moves.

- **A real portrait board** (`src/ui/viewport.ts`, `src/ui/regions.ts`). A window
  taller than it is wide gets a 270x480 world: full-width table on top, hand
  carousel below it, and a pinned action bar with FEITO and COMPRAR side by side.
- **Orientation flips re-lay-out live** (`viewport:changed` on the event bus).
  GameScene rebuilds its static UI in place rather than restarting — it owns the
  match state and the online socket — and OnlineScene rebuilds around its live
  connection.
- **Bigger touch targets without bigger art** (`src/ui/widgets.ts`). On a coarse
  pointer a button's hit box grows to at least 32x26 world units, and tooltips —
  previously hover-only — also open on tap.
- **A disabled FEITO explains itself when tapped**, using the same reason string
  the objective line renders, so the two can never disagree.
- **Notch-safe canvas**: `viewport-fit=cover` plus `env(safe-area-inset-*)`
  padding, so cutouts cost canvas area instead of covering the board.
- **The centred screens follow the world** (`src/ui/menu-layout.ts`): menu, setup,
  lobby, results, settings, pause and rules panels remap generically instead of
  being hand-authored a second time.
- **Localized touch copy** (pt-BR/en-US) and a rotate hint that now auto-hides.
- **Mobile is verified, not assumed**: ten captures at 390x844 and 844x390 in
  `npm run verify` (tap-select, tap move valid/invalid, blocked-FEITO reason,
  badge reason, both locales) and three portrait online captures in
  `npm run verify:multiplayer`, all required by the gate scripts.

## 1.5.0 — Phase 11 (resilience, render cost, cleanup)

Deployable production build → one that survives a hostile browser. No rules
change, no protocol change, no gameplay change: local and online play behave
exactly as in 1.4.0.

The phase opened expecting a client performance problem and did not find one.
No scene implements `update()`, nothing allocates per frame, rendering is driven
by interactions rather than by the frame loop, and the crowded-table capture
already held 58 fps. The real defects were three ways the game could fail to
start or silently stop working, and one online path that could lock input
forever. See `docs/archive/PHASE11_AUDIT.md`, including the perf items that were
investigated and deliberately left alone.

- **The game boots on a browser with storage blocked** (`src/core/persistence.ts`).
  `loadSave()` read `localStorage` unguarded, and `src/core/settings.ts` calls it
  at module scope — so in Safari with site data blocked, or any webview with
  storage disabled, reading storage *threw* during module evaluation and the game
  never started at all: a blank canvas. Reads are now fail-safe, and the
  `localStorage` default parameter is resolved lazily inside a `try`, because
  reading the property itself throws before any guard in the function body could
  run. A blocked browser now plays normally, with settings simply not persisting.
- **A blocked browser no longer breaks online reconnect** (`src/net/client.ts`).
  `sessionStorage` was touched unguarded inside `ws.onopen`, `ws.onclose`,
  `ws.onmessage` and `leaveRoom()`. A throw inside a socket callback aborts that
  callback: the reconnect handshake would never send, and the
  retry-versus-terminal decision would be skipped, leaving the interface parked on
  a dead socket showing no notice at all. All four sites now go through guarded
  token accessors. No protocol, status-transition or reconnect-timing change.
- **A failed asset step no longer strands the player on a black screen**
  (`src/scenes/BootScene.ts`). `finish()` was `async`, called without `await`, and
  had no error handling, so a throw from font loading or card-face composition was
  an unhandled rejection and the menu never started — even though the scene
  already generates procedural fallbacks for every asset and the game is fully
  playable without composed faces. The failure is now caught, recorded in
  `debugApi.errors` rather than swallowed, and the menu always starts.
- **Online input can no longer lock forever** (`src/scenes/GameScene.ts`). The
  pending-move lock was released only by `state_sync` or `proposal_rejected`; a
  dropped or ignored proposal on a socket that stayed open produced neither, and
  there was no timeout, so the player was left with a dead board and no
  explanation. The lock now has a single set/clear point owning a 10s timer: on
  expiry it releases, shows the resyncing notice, asks the server for a fresh
  authoritative snapshot, and re-renders.
- **The render path stopped analyzing every meld twice** (`src/scenes/GameScene.ts`,
  `src/mexe-mode/draft.ts`, `src/rules/rules.ts`). Each render of a human turn ran
  the whole table through meld analysis once to draw the invalid badges and again
  to gate the FEITO button. `DraftEditor.analyze()` now does one pass and
  `canConfirmTurn()` reuses it. Rules semantics are unchanged — the new parameter
  is optional and every existing caller behaves exactly as before. The
  `tutorial-complete` capture, previously the lowest reading in the whole suite at
  44 fps, now measures 59.
- **Dead code removed**: the unused `clientConfig` export (`src/config.ts`) and the
  unused `SUIT_COLOR` export (`src/assets/fallbacks.ts`), both left over from
  Phase 10. A full slop scan of `src/`, `server/`, `tests/`, `scripts/` and the
  three e2e suites found nothing else: no `TODO`/`FIXME`/`HACK`, no commented-out
  code, no duplicated implementations, no stub fallback paths, no docs claiming
  features that do not exist.
- **Tests**: 301 → 303. New coverage for the blocked-storage load path and for the
  collapsed meld analysis agreeing with the two calls it replaced, on both a valid
  and an invalid draft.

Verification: 303/303 unit tests, lint clean, build clean, `npm run verify` OK
(28 captures, fps 54–60, zero console errors, zero missing assets),
`npm run verify:multiplayer` 7/7, `npm run verify:preview` OK.

## 1.4.0 — Phase 10 (production hardening)

Content-rich beta → deployable production build. No rules change, no protocol
change, no gameplay change: local and online play behave exactly as in 1.3.0.

- **HTTPS deployments work by default** (`src/config.ts`): the WebSocket URL
  fallback is now protocol-aware — `wss://<host>/ws` over https (matching the
  reverse-proxy layout documented in `docs/SELF_HOSTING.md`), `ws://<hostname>:8787`
  over http. Previously the https case fell back to a plain `ws://` URL that
  browsers block outright, so any TLS deployment that forgot `VITE_WS_URL` got a
  silently dead ONLINE menu. `?ws=` and `VITE_WS_URL` still take precedence, in
  that order.
- **Server configuration is centralized and validated** (`server/config.ts`):
  `PORT`, `HOST`, `MEXE_ENV`/`NODE_ENV`, `LOG_LEVEL`, `MEXE_MAX_ROOMS`,
  `MEXE_DISCONNECT_GRACE_MS`, `MEXE_IDLE_TIMEOUT_MS`, `MEXE_TEST_SEED`. A
  malformed numeric value fails startup naming the variable instead of silently
  falling back to a default, and `MEXE_TEST_SEED` set in production mode is a
  fatal error — a seeded deck would deal every match identically. Room capacity
  and timeouts are now operator-tunable rather than hardcoded in `rooms.ts`.
- **Graceful shutdown** (`server/index.ts`): `SIGTERM`/`SIGINT` send every
  connected client a `server_shutdown` error so they see a real message instead
  of a silent drop, then clear the timers, close the sockets and the HTTP
  listener, and exit 0. Idempotent, with a 5s hard-exit backstop. The new code is
  translated (PT/EN) rather than falling through to the generic error copy.
- **Structured, privacy-enforcing logs** (`server/log.ts`): one JSON line per
  event, `debug`/`info` to stdout and `error` to stderr only. Redaction lives in
  the logger rather than at call sites — `name`, `playerName`, `token`,
  `sessionToken`, `ip` and `userAgent` are redacted, every array/object field
  collapses to its length so hands and melds can never be serialized, and room
  codes are logged only as a length. Still no persistence, no telemetry, no
  analytics, nothing written to disk.
- **`/health` is diagnosable**: `{ok, uptimeSec, rooms, connections, protocol}`,
  with no room codes and no player names. Previously `{"ok":true}`, which proved
  the process was listening and nothing else.
- **Phaser is a separate cached chunk** (`vite.config.ts`): the build went from
  one 1604 kB chunk to 121 kB of game code plus a 1482 kB Phaser chunk, so a
  game-code release no longer invalidates Phaser in returning players' caches.
- **The built client is now gated** (`npm run verify:preview`,
  `scripts/check-preview.mjs`): serves `dist/` on :4173 and fails on an asset
  that does not resolve, a missing boot-time asset, or a credential-shaped
  string in any emitted `.js`. Nothing previously exercised the production build.
- **Operations documentation** (`docs/OPERATIONS.md`): environment reference,
  build and run, health-check reading, log format and privacy guarantees,
  troubleshooting, rollback, verify commands, known limits. Plus
  `docs/archive/PHASE10_AUDIT.md`, and `docs/SELF_HOSTING.md`/`docker-compose.yml` updated
  for the new defaults (`mexe-server` now runs with `MEXE_ENV=production`).

## 1.3.0 — Phase 9 (content-rich beta)

Playtest-ready demo → content-rich beta. No rules change, no protocol change.

- **Cosmetics** (`src/cosmetics/index.ts`, local-only): 4 table themes (boteco,
  kitchen, quintal, feira), 5 card backs, 9 avatars (player, cida, juninho,
  bia, ze, rosa, tuca, nina, ivo). Menu → ⚙ settings →
  **COSMETICS** sub-panel, live preview, persists immediately to `localStorage`
  under a new `cosmetics` block in `mexe-save` (old saves migrate to
  defaults; an unknown/removed id or a missing texture degrades to the
  default rather than rendering broken). Strictly client-side — an e2e test
  asserts cosmetics never appear in `src/net/protocol.ts`.
- **Procedural art** (`scripts/gen-cosmetics.mjs`, `npm run gen:cosmetics`):
  2 new table backgrounds, 1 new card back, 2 new emotes — a hand-rolled PNG
  encoder over Node `zlib`, no dependencies, deterministic. The 4 new avatars
  (rosa, tuca, nina, ivo) were produced with PixelLab once the subscription
  was renewed, style-matched to the existing set — not attempted
  procedurally, since that would read visibly worse than PixelLab art.
- **Context-aware music** (`src/audio/music.ts`): `menu` / `game` / `mexe`
  contexts, calm tracks during the concentration-heavy Mexe draft, fuller
  songs during general play; 900ms crossfade (scaled by reduced motion); new
  music-by-context settings toggle. `src/audio/sfx.ts` gained an 80ms per-key
  retrigger debounce so rapid repeats can't stack into a loud spike.
- **AI personality depth** (`src/ai/ai.ts`): per-personality think pace and
  emotes, tagged move reasons (`cida:minimal-meld`, `juninho:dump-all`,
  `bia:rearrange-extend`, `ze:hold-for-bigger`), characterful lines for
  big plays / near-wins / forced draws, PT+EN. Presentation only — pacing is
  capped, scaled by reduced motion, and never extends the 400ms search
  deadline; search legality/determinism unchanged.
- **Charm + clarity**: always-visible objective prompt (`src/core/objective.ts`);
  win-screen rematch summary — turns, cards played, draws, winning-move line,
  per-personality avatar reactions (`src/core/results-summary.ts`, local play
  only, see Known issues); menu idle motion and scene fade transitions; an
  ONLINE badge so local mode is never mistaken for online; expanded
  joker-in-run explanation in the rules panel.
- **Known limitation**: online games show no rematch stats or winning-move
  text — the client never observes server-driven turns locally, and fixing it
  needs a protocol change, out of scope this phase.
- Verify: 6 new e2e tests + 6 new gated screenshots (theme × 4, cosmetics
  panel, reduced motion), all added to `EXPECTED_SHOTS`; 2 pre-existing e2e
  tests fixed where layout shifts had moved hardcoded click coordinates.
  280/280 unit (18 files), 46/46 local e2e, 7/7 multiplayer e2e, lint clean,
  build clean, zero console/server errors.

### Rules adaptation

### Phase 8 — playtest-ready public demo

Turns the online beta into something a stranger can be handed. No protocol
change, no rules change.

- **Session play log** (`src/core/playlog.ts`): a 2000-entry in-memory ring
  buffer fed by the existing `EventBus`. It records turn starts and durations,
  cards played, draws, undo/redo/reset, the reason codes behind a blocked
  FEITO, tutorial progress and skips, and disconnect/reconnect/desync/reject
  counts. It is session-only — never written to disk, never sent anywhere.
  Player names and reconnect/session tokens are stripped by an explicit key
  filter before export, and a test enforces it. `?playlog=0` disables it.
  Exposed at `window.__MEXE__.playlog`, plus a **COPY TEST LOG** button in the
  settings panel for testers who will not open a console.
- **Tutorial teaches the current ruleset**: 10 steps become 12. The set step
  now states the two constraints that actually reject real plays (a trinca is
  exactly 3–4 cards, every natural card a different suit), a new step has the
  player *hit* the duplicate-suit rejection and recover from it, and a new step
  introduces jokers — wildcard, needs a concrete card it stands for, and every
  meld needs at least one natural card. All copy is at most two sentences, in
  PT and EN.
- **Online errors are readable**: all 15 server error codes now map to
  player-facing PT/EN copy via `src/net/errors.ts`. Testers used to see
  `cannot join room: room_full`. A never-reachable server gets its own message
  instead of looking like a mid-session drop, and an unrecognised code falls
  back to a generic sentence rather than leaking the raw server string.
- **Lobby survives impatient humans**: CREATE, JOIN, READY, START and LEAVE
  are debounced, so a double-click cannot put two `create_room` frames on the
  wire.
- Balance knobs stay in one place (`DEFAULT_RULES`, documented in
  `docs/GAME_RULES.md`); the turn timer remains a declared, unimplemented, off-by-
  default hook and is now documented as such rather than implied.
- New: `docs/PLAYTEST_GUIDE.md` (how to run, what to test, how to report, and
  what the log does and does not contain) and `docs/archive/PHASE8_AUDIT.md`.

### Phase 7 — online beta

Protocol **v3**. The online mode moves from alpha to beta: the remaining
stability, recovery and safety gaps from `docs/archive/PHASE7_AUDIT.md` are closed.

- **Socket liveness**: the server pings every connection every 15s and
  terminates one that misses a probe, so a half-open socket releases its seat
  instead of holding it until TCP notices.
- **Frame size cap**: inbound frames above 16 KiB are dropped by `ws` before
  any parsing.
- **Desync detection**: `GameView` carries a `hash` digest of everything all
  seats can see. A client recomputes it after every sync; on mismatch it locks
  input and requests a fresh authoritative snapshot with the new `resync`
  message. The server never reads client state to recover — it only re-sends.
- **Stalled matches recover**: when the active seat has been gone past the
  disconnect grace and someone else is still connected, the server plays that
  seat's draw-and-end-turn so the match keeps moving. It never melds for a
  player.
- **Correlatable errors**: `error` now echoes the failing request's `reqId`.
- **In-canvas join code** replaces the native `window.prompt()`, and the lobby
  now states why START is disabled.
- Tests: state-hash agreement across seats, digest divergence, `resync`
  parsing, stalled-turn recovery (before/after grace, empty room), and room
  churn/cleanup under repeated create-join-leave. `verify:multiplayer` gained
  an in-canvas join, hand-privacy and resync round-trip scenario, and its gate
  now fails on hand leaks or state-hash disagreement.

### Phase 6 — 2–4P online hardening

- Private online rooms now support **2–4 human players** with stable clockwise
  seat IDs and session tokens; a fifth join and joins after start are rejected.
- Ready no longer auto-starts a 2P room. The host explicitly starts only when
  every occupied 2–4P seat is ready. Deals and turn rotation use player count.
- Added host start UI, 3P/4P server tests and 3P/4P browser rotation captures.
- Preserved authoritative FEITO validation, per-seat hand redaction, revision
  safety, reconnect/resync, and the safe reconnect-to-local-menu fallback.

Rules engine, protocol and docs adapted to the final Mexe-Mexe ruleset
(`docs/GAME_RULES.md`), replacing the MVP's single-deck/ace-low/stalemate-by-passing
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
- Release packaging: version bump to 1.0.0, `docs/archive/RELEASE_NOTES.md`, README
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
