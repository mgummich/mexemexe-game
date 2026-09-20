# Speed Modes — shared timing architecture (Phase 1 deliverable)

Feature spec for the Speed Modes initiative. Scope order lives in
`docs/SPEED_MODES_IMPLEMENTATION_PHASES.md`; progress in
`docs/SPEED_MODES_IMPLEMENTATION_STATUS.md`. Canonical docs
(`docs/ARCHITECTURE.md`, `docs/MULTIPLAYER.md`, `docs/GAME_RULES.md`) stay
authoritative for shipped behaviour and are updated per phase, not by this file.

## Goal

One timing domain for Blitz, Time Attack and Tempo. No second timer engine, and
no change to untimed MexeMexe.

## What already exists (audit, Phase 1)

| Concern | Owner today | Reusable for Speed Modes |
|---|---|---|
| Online per-turn clock | `server/rooms.ts` (`turnStartedAt`, `turnBudgetMs`, `startTurnClock`, `msLeft`) | yes — this is the authority model to extend |
| Turn budget config | `RoomSettings` + `TIMER_PRESETS` (`src/net/protocol.ts`), bounds in `CUSTOM_BOUNDS` | yes — Speed rulesets extend this shape |
| Deadline on the wire | `PlayerView.turnMsLeft` (remaining ms, not an absolute timestamp) | yes |
| Client projection | `GameScene.turnDeadlineAt` + `turnClockReadout` (`src/ui/turn-clock.ts`, pure) | yes |
| Timeout outcome | server tick → `turn_timeout`, `missedTurnLimit` ends the match | yes |
| Reconnect | `reconnectGraceMs`; reconnect resyncs from the server, nothing restored from disk | yes |
| Rematch reset | fresh `matchId`, room recycled; local rematch is `new LocalMatch(...)` | yes |
| Local (offline) match timing | **nothing** — `LocalMatch` holds no timer (ARCH-001) | gap |
| Personal clock, increment, Freeze, Time Debt, Tempo, Heat | **nothing** | gap |

Conclusion: the online turn timer is already authoritative and already
config-driven. Speed Modes are a *generalisation* of it plus a local-match
clock, not a new subsystem next to it.

## Timing ownership

```text
online   → server/rooms.ts owns every competitive deadline (unchanged rule)
local    → LocalMatch owns the deadline, advanced by a `now` the scene injects
domain   → src/game-state/timing.ts: pure functions both callers use
client   → presentation only; never decides a timeout
```

`src/rules` stays out of it: timing is not legality, and `src/rules` may not see
a clock. `src/game-state/timing.ts` is DOMAIN under `tests/boundaries.test.ts`
(imports limited to `./*`, `../rules/*`, `../ai/ai`), so it takes `now: number`
as an argument and never reads `Date`.

## Shared timing state

One record per match, one entry per seat:

```ts
interface SpeedTimingState {
  readonly ruleset: SpeedRuleset;        // frozen at match start
  readonly activeSeat: number;
  readonly turnStartedAt: number | null; // null = no running turn
  readonly turnBudgetMs: number;         // per-turn allowance incl. granted bonuses
  readonly seats: readonly SeatTiming[]; // personal clock, streak, resources
}
interface SeatTiming {
  readonly clockMs: number;     // Time Attack / Tempo survival clock
  readonly debtMs: number;      // Time Debt
  readonly rhythm: number;      // Perfect Rhythm streak
  readonly tempo: number;       // Tempo currency
  readonly heat: number;        // Tempo risk
  readonly frozenUntil: number | null;
  readonly used: Readonly<Record<string, number>>; // one-shot abilities consumed
}
```

Transitions are pure: `startTurn`, `onAction`, `tick(now)`, `endTurn`,
`applyAbility`. Each returns the next state plus the events it produced
(`timeout`, `overheat`, `eliminated`). Deterministic in, deterministic out — the
same inputs give the same outcome on server and client.

## Mode policies

A mode is a policy object over the same state, not a separate engine:

```text
Blitz       per-turn budget only, clock resets each turn
Time Attack persistent per-seat clock + increment on turn end
Tempo       persistent clock (survival) + Tempo (power) + Heat (risk)
```

Always-internal in Blitz and Time Attack: Perfect Rhythm, Adrenaline (no
player-facing toggle). Always individually disableable: Panic Button, Last
Breath, and in Time Attack also Freeze and Time Debt. Presets set defaults; they
never remove the per-option switch.

## Authoritative timestamps and client projection

Wire keeps the existing shape: **remaining ms**, never an absolute server
timestamp (client wall clocks disagree; `turnMsLeft` already dodges that). The
client converts to a local absolute deadline on receipt (`GameScene` already
does this) and renders via `turnClockReadout`. Reaching zero on the client
renders `0s` and ends nothing — the authority's tick does.

Move-vs-deadline race rule: an action is accepted iff the authority's own `now`
is within the budget when the action is processed, compared against the same
`turnStartedAt`/`turnBudgetMs` pair carried in the state. Duplicate protection
stays the existing revision check (`rev !== room.rev`).

## Reconnect and rematch

Reconnect: server resends the frame; timing state is re-projected from
`turnMsLeft` and per-seat values. Nothing timing-related is persisted to disk.
Rematch: a new `SpeedTimingState` is constructed with the match — every
resource (clock, rhythm, tempo, heat, debt, one-shots) resets by construction,
not by a reset list (ARCH-018).

## Configuration / ruleset model

`SpeedRuleset` extends the existing `RoomSettings` idea: host-chosen, frozen at
match start, server-owned, validated at the wire boundary with clamped bounds
(the `CUSTOM_BOUNDS` pattern). Blitz's ~7s default needs `CUSTOM_BOUNDS.turnMs`
lowered from its current 15s floor for Speed rulesets only; untimed and
casual/fast rooms keep today's bounds.

## AI integration boundary

AI stays pure and clock-free (`SEARCH_BUDGET_TRIALS`, not a deadline — the
boundary test enforces it). Speed awareness enters as *inputs*: the observation
gains the seat's timing resources, and the caller chooses a search budget from
the remaining time. The AI never reads a clock itself.

## UI adapter boundary

Presentation reads timing state and renders it; it emits intents (use Panic
Button, spend Tempo) and never mutates timing. `src/ui/turn-clock.ts` stays the
pure readout maths and grows the Speed states (warning, critical, frozen,
overheat) there rather than in a scene.

## Portability boundary

Domain timing is platform-neutral TypeScript with an injected `now`; Phaser,
DOM, `Date` and `performance.now` stay in scenes and in the server process. A
future native/Godot client reimplements the adapter, not the timing rules.

## Exit criteria (Phase 1)

- architecture documented (this file)
- no parallel timer design planned — the server clock is extended, not duplicated
- integration points identified (table above)
- existing non-speed contract understood: untimed and casual/fast rooms and every
  local match behave exactly as today until a Speed ruleset is selected

## Shared Speed UX contract (Phase 3)

Speed Modes reuse the timed-online UX rather than growing a parallel one. What
exists and is the contract every Speed Mode renders against:

| Requirement | Where it lives |
|---|---|
| Clock presentation, warning, critical | `turnClockReadout` (pure) → `GameScene.updateTurnTimer` paints it |
| Non-color-only urgency | the readout's `scale` (1.25× at critical) and the seconds themselves, never colour alone |
| Audio cue | `timerTickSound` setting → `sfx-snap`, own turn only |
| Haptic cue | `haptic('tick')` at critical, own turn only, third channel only |
| Reduced motion | `settings.motionScale()` (0 with reduced motion or battery saver) |
| Immediate handoff, nonblocking feedback | the online notice line; no modal during a running clock |
| Quick rematch | the room's rematch lobby, same code |
| Mobile touch layout | the existing portrait/landscape HUD regions |

Rules for every later phase:

- a new Speed signal is added to `src/ui/turn-clock.ts` as arithmetic, not to a scene as a branch
- no blocking dialog while a clock is running
- no signal may be colour-only, sound-only or haptic-only
- mode-specific chrome (Tempo meter, Heat bar, ability buttons) lands in the phase
  that introduces the mechanic, where it has a consumer — not ahead of it

## Perfect Rhythm (Phase 5)

`Rhythm` in `src/game-state/timing.ts`: a streak of turns decided inside the first half of their
own budget (`RHYTHM_FRACTION`), folded by `noteTurnTaken` when a turn is taken and broken by a
timeout. Defined against the budget rather than a wall-clock number, so it means the same thing at
7s and at 90s.

- no setup toggle, no lobby setting — it is native to a timed match
- it changes nothing about what a move is worth, so reckless fast play buys nothing
- feedback is the pip run beside the clock (`GameScene.rhythmMarker`), nothing below two in a row
- the scene folds its own seat only; online this is a local read of the clock the server owns, and
  it is display-only, which is why it needs no protocol field

## Adrenaline (Phase 6)

`turnClockReadout` returns `adrenaline`: 0 outside the critical window, 1 at zero. It drives the
readout's growth and the tick cue's volume — presentation only, never what a move is worth, and
never a setting.

The critical window itself is now budget-aware (`CRITICAL_FRACTION`, capped by `TURN_CRITICAL_MS`):
30% of a short Speed turn, still a flat 5s on a long one. A 7s Blitz turn is critical for its last
2.1s instead of five of its seven seconds.

Accessibility: the escalation is a size change and a volume change, not motion, so reduced motion
loses no information; with sound off the size still escalates, and with the screen unread the
haptic still fires. No channel is load-bearing alone. Reconnect-safe by construction — it is
derived from the deadline in the frame, holding no state of its own.

## Panic Button and Last Breath (Phase 7)

Both live in `src/game-state/timing.ts` as pure transitions, both are off at zero, and both are
disableable on their own — `blitzPanic` and `blitzLastBreath` are two settings, never one "assists"
switch.

- **Panic Button** (`usePanic`): one emergency extension per match (+5s of a 7s turn). Offline the
  clock face *is* the button — tapping it spends the panic, and the face shows `+5s` while one is
  available. Refused by the domain when it is off, spent, or pressed with no turn running, so a
  double tap cannot buy two.
- **Last Breath** (`enterLastBreath`): +3s granted automatically when the clock reaches zero, once
  per turn. The used flag rides on the `TurnClock`, and `startTurn` replaces the clock wholesale,
  so it cannot chain into a turn that never ends.

Tested in all four ON/OFF combinations. Online rulesets do not carry either yet — that is Phase 27
(lobby and ruleset policy), where they need a wire field and server ownership.
