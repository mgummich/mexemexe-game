# Performance budgets — MEXEMEXE!

**Canonical for:** what "fast enough" means here, on which devices, measured how.
Not canonical for: test-suite runtimes (that is [TESTING.md](TESTING.md)
§Runtime budgets) or AI search limits (those are exported constants in
`src/ai/ai.ts`, restated here only as a budget).

Every number below was measured before it was written down. A budget nobody has
measured is a wish, and a budget that does not map to something a player can
feel is a distraction.

## Target environments

Two, and only two, because they bracket everything that matters:

| Class | Stands for | How it is reproduced |
|---|---|---|
| **Desktop** | a laptop from the last five years, 1280×720 or larger | Chromium at default speed, `npm run preview` |
| **Modest mobile** | a mid-range Android phone, 390×844 portrait | Chromium, `isMobile`, **4× CPU throttling** via CDP |

4× is the throttle the frame-rate work already used (`e2e/screenshot.spec.ts`),
so the two halves of the suite agree on what "slow device" means. iOS Safari is
covered for layout and lifecycle (`npm run verify:cross`, the WebKit projects in
`verify:multiplayer`), not for these numbers — an iPhone is faster than this
profile, so the modest-mobile budget bounds it.

## Budgets

Measured 2026-09-20 on the desktop class and on the modest-mobile profile, at
`__APP_VERSION__` 1.11.0. Budgets are set with headroom over the measurement, so
a regression trips the budget before a player notices it.

| What the player feels | Metric | Desktop measured | Mobile measured | Budget | Why this number |
|---|---|---|---|---|---|
| "it opened" | first contentful paint | 200 ms | — | **≤ 1.5 s** | past ~1 s a tap feels unanswered; the shell is HTML + CSS and should never approach this |
| "it's ready to play" | navigation → `__MEXE__.ready` | 350 ms | 836 ms | **≤ 2.5 s** desktop, **≤ 5 s** mobile | boot loads every card, table, portrait and UI atlas; the second load is served from the service-worker cache |
| "the screen changed" | menu → game scene | 210 ms | 836 ms | **≤ 1 s** desktop, **≤ 2 s** mobile | a scene switch is a state change, not a level load; slower than this reads as a stall |
| "it's smooth" | fps, crowded table | 60 | 52 | **≥ 50** desktop, **≥ 45** mobile, **≥ 12–20** under CI contention | the existing `@perf` gates own these; the CI floors are deliberately low because a shared runner measures the runner |
| "the opponent isn't hanging" | one AI decision, expert, dense table | 36 ms / 22 924 trials | ~150 ms derived (4×) | **≤ 120 000 trials** (`SEARCH_BUDGET_TRIALS`) | deterministic work, not a clock: the budget is trials so the same seed gives the same move on any device (INV-A5) |
| "my move landed" | per-turn wire payload (`state_sync`) | 1.2 kB | same | **≤ 8 kB** | measured on a two-player match start (1.1 kB) and the following turn (1.2 kB); the ceiling leaves room for a four-seat, 44-meld table |
| "it doesn't eat my phone" | JS heap after boot | ~17 MB | — | **≤ 80 MB**, and no upward drift across repeated matches | drift, not the absolute number, is the leak signal — Phase 77 owns measuring it |
| "the download was reasonable" | first-load wire bytes, cold cache | 432 kB | same | **≤ 1.5 MB** excluding music | `phaser` 347 kB gzip + `index` 84 kB gzip dominate; art (380 kB on disk) and sfx (400 kB) are served compressed and cached on first use. Was 1618 kB until Phase 76 stopped preloading a music track |
| — | streamed music | 13 MB | same | **not budgeted, never precached** | it is excluded from the service-worker cache on purpose ([PWA_OFFLINE.md](PWA_OFFLINE.md)) |

## Profiling findings (Phase 76)

Profiled on the modest-mobile profile (390×844, 4× CPU throttle) on the worst
board the game can reach (`?showcase=mexe&crowd=44`, 44 committed melds), plus a
cold-cache network capture through CDP. Ranked by what it costs a player:

| # | Finding | Evidence | Verdict |
|---|---|---|---|
| 1 | **A 1.18 MB music track downloaded on every cold boot, for music that is off by default.** `new Audio(src)` inherits Chrome's `preload = 'auto'`. | cold-cache wire bytes: 1618 kB total, of which `boteco-table.mp3` was 1185 kB | **Fixed here.** `preload = 'none'` before the src; the track is fetched when playback actually starts. Cold load is now 432 kB. Regression test in `tests/music-playback.test.ts` |
| 2 | **Frame time is not JS-bound.** Under 4× throttle on the crowded table, JS self time is ~5 % of samples (largest single JS frame: Phaser `run`, 1.4 %); 78 % is `(program)` — native paint/GPU/compositor — and 12.5 % is idle. | `Profiler.start/stop`, 4 s sample at 200 µs | **No optimization.** There is no game-code hot spot to fix; fps headroom lives in Phaser's draw-call and text work. Optimizing here would be intuition, not evidence |
| 3 | **Every asset is requested twice**: `BootScene` probes with GET, then Phaser loads it. | 164 requests for 105 URLs; the second request reports 0 wire bytes (HTTP/service-worker cache hit) | **Accepted, not changed.** The cost is request count, not bytes, and the probe is what produces `missingAssets` and warms the offline cache. Revisit only if a high-RTT profile shows it |
| 4 | **Phaser is the largest download** at 347 kB gzip, 80 % of the JS bytes. | bundle measurement | **Accepted.** One game screen, no route to split it along; replacing the engine is not a performance decision |
| 5 | **AI decision cost is bounded in trials, not milliseconds** (22 924 of 120 000 trials, 36 ms desktop, on a dense table). | Phase 52 measurement, unchanged | **No change.** A wall-clock target here would trade determinism (INV-A5) for a number no player can feel |

Method, for the next person: `e2e/perf-measure.spec.ts` prints all of the above
except the bundle sizes. Findings 2–5 were each ranked *below* the threshold for
action deliberately — the phase's job was to find out where the time goes, and
the answer was "one wasteful download, and nothing else that evidence supports
touching".

## Memory across a long session (Phase 77)

Ten menu → setup → match (one human turn, one AI turn) → quit cycles in **one
page**, with a forced GC before each reading, because otherwise a measurement
like this reports collector timing rather than retention. Counters come from the
browser (`Performance.getMetrics`) and from `window.__MEXE__.lifecycle()`, which
reports the counts the product itself owns.

| Counter | Before the fix | After | Owner |
|---|---|---|---|
| Phaser sound instances | 1 → 33 (**+8 per match**, never dropped) | flat at 4 | `src/audio/sfx.ts`, `MenuScene`/`GameScene` ambience |
| active scenes | `['menu']` | `['menu']` | scene lifecycle |
| scene children, tweens | flat | flat | scene lifecycle |
| `bus` subscriptions | 2 | 2 | `src/core/events.ts` (ARCH-007) |
| DOM nodes | 166, flat | 166, flat | overlay plates |
| JS heap | +110 kB per match | +100 kB per match | see residual below |
| DOM-level listeners | +13 per match | +4 per match | see residual below |

**The leak that was real.** `scene.sound.play(key, …)` creates a *new* Phaser
sound per call, and Phaser only removes one when it emits `COMPLETE` — which a
sound played into a locked or muted audio context never does. A long session
therefore accumulated one live sound object per cue played. The per-scene
ambience had the same shape: `stop()` leaves the instance in the manager's list,
so every visit to the menu or a match added another. Fixed by reusing the
instance for a key (the 80 ms retrigger guard already means one per key is
enough) and by destroying the ambience on scene shutdown. The gated
`second-match` journey now asserts the bounds, so it cannot come back quietly.

**The residual drift, chased down and closed.** With the fix in place a cycle
still added ~100 kB, so the obvious question was whether it ever stops. Twenty-five
cycles, measured twice, say it does:

```text
cycle   1    5    9   13   17   21   25
heap  7.6  8.3  8.8  8.9  8.9  9.0  9.1 MB     DOM nodes 166, listeners 202 — flat throughout
```

The first nine cycles add ~1.2 MB and the next sixteen add ~0.3 MB: a warm-up
curve, not a leak. A heap-snapshot diff across six cycles says what is in it —
**+804 kB of the +843 kB is V8 `code`** (3,434 new code objects, i.e. functions
being compiled and optimised as more of the game gets exercised), plus 939 native
objects at 31 kB. Product objects account for 58 plain objects and 12 arrays.
DOM-level listeners no longer grow at all, which the earlier +13-per-cycle
reading did: that was Web Audio source nodes in a context that never unlocked, and
it does not reproduce now that a key holds one reusable sound.

So the ceiling is the JIT's, it plateaus around 9 MB against an 80 MB budget, and
nothing in the match lifecycle retains. The nightly `perf-trend` job keeps the
series so a real leak would show as a curve that does not flatten.

Re-run with:

```bash
npx playwright test e2e/perf-measure.spec.ts -g memory --workers=1 --retries=0
```

## Asset cost (Phase 35)

Measured against the budgets above, not re-derived:

| | Measured | Budget | Headroom |
|---|---|---|---|
| First-load wire bytes, cold cache | 432 kB | 1.5 MB | 3.5× |
| Texture bytes on disk | 380 kB across 49 PNGs | — | — |
| JS heap after boot | ~17 MB | 80 MB | 4.7× |
| Boot to playable | 350 ms desktop / 836 ms at 4× CPU throttle | 2.5 s / 5 s | 3–6× |

Three things were checked and deliberately not changed:

- **Compression.** Re-encoding every PNG at maximum zlib would save 19 kB (8 %)
  of 261 kB — against 3.5× headroom on the only budget it touches, and at the
  cost of the property that makes the procedural assets trustworthy: re-running
  `gen-cosmetics`/`gen-icons` reproduces them byte-identically today, and a
  hand-optimised file would not survive the next regeneration.
- **Atlases.** 49 textures, no duplicate payloads (checked by hash), all loaded
  once at boot and never streamed. An atlas would add a build step and a
  packing format to save draw calls that the fps gates say are not the
  constraint (the profile is 78 % native paint, ~5 % JS).
- **Load order.** `BootScene` probes and loads everything before the menu, which
  is what makes the offline cache complete after one visit. An eager precache
  list was tried in Phase 16 and reverted for starving the first-load fetches.

The one asset that dominates anything is the streamed music (13 MB), and it is
never precached and no longer fetched at boot at all (Phase 76).

## What is deliberately not budgeted

- **Server CPU and latency.** The server does one legality check per turn on an
  in-memory room; the soak and chaos suites gate its behaviour, not its speed.
  If room count ever becomes the constraint, the metric to budget already exists
  (`mexemexe_rooms_capacity_ratio`).
- **Time to first *online* match.** It depends on another human or the queue,
  not on this code.
- **Install size of the PWA.** It is the first-load transfer plus the cache,
  both above.

## Measuring again

```bash
npm run build
npx playwright test e2e/perf-measure.spec.ts --workers=1 --retries=0   # both classes, prints PERF / PERF-THROTTLED
ls -l dist/assets/index-*.js && gzip -c dist/assets/index-*.js | wc -c  # bundle
du -sh dist dist/assets/*                                              # asset weight
```

`e2e/perf-measure.spec.ts` is a measurement tool, not a gate: it prints numbers
and asserts almost nothing, because a budget should be chosen from a measurement
rather than the other way round. The gates that do fail on a regression are the
three `@perf` fps tests in `e2e/screenshot.spec.ts` and the AI trial budget in
`tests/ai.test.ts`.
