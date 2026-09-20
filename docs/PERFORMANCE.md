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
| "the download was reasonable" | first-load transfer | 1.7 MB (app + art + sfx) | same | **≤ 3 MB** excluding music | `index` 279 kB / 86 kB gzip, `phaser` 1.3 MB / 354 kB gzip, art 380 kB, sfx 400 kB |
| — | streamed music | 13 MB | same | **not budgeted, never precached** | it is excluded from the service-worker cache on purpose ([PWA_OFFLINE.md](PWA_OFFLINE.md)) |

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
