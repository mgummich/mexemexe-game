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

## Blitz difficulty presets (Phase 8)

`BLITZ_PRESETS` in the timing domain: Easy 12s, Medium 9s, Hard 7s (the online Blitz preset, so
offline practice is practice for the real thing), Expert 5s and unassisted, Custom starting from
Medium with a stored turn length (`BLITZ_TURN_BOUNDS`, floored at the server's own 5s).

A difficulty sets *defaults*, never a lock:

- Perfect Rhythm and Adrenaline are in every preset, because they are not settings
- Panic and Last Breath keep their own switches, which override any preset's strength with off
- the warning threshold is half the turn, whatever that turn is — a fixed 4s would be all of an
  Expert turn and a third of an Easy one

The setup screen carries one row (difficulty · panic · breath); Custom's turn length lives in the
settings panel's Game section, because at four seats the setup panel has exactly one free row.

## Time Attack (Phases 9–12)

Server-owned, protocol v11. `RoomSettings` carries `startClockMs`/`incrementMs`, `GameView`
carries `clocksMs` and `panicLeft` per player index, and `server/speed-rules.ts` holds the policy
(which budget a turn gets, what a turn costs the seat that took it, what the room grants) so
`RoomManager` keeps owning rooms rather than arithmetic.

- a turn's budget **is** the active seat's clock; `spendClock` charges the authoritative interval
  and pays the increment, floored at zero, with a flagged clock earning nothing
- a clock reaching zero ends the match for that seat (`missedTurnLimit: 1` — there is no second
  chance to count towards)
- clocks are dealt with the match, so a rematch always starts full, and a reconnecting client is
  told them rather than reconstructing them
- **Perfect Rhythm** reuses the shared fold through `noteTurnUsed`: Time Attack has no per-turn
  budget to take a fraction of, so a turn that cost less than the increment — one that paid for
  itself — is a turn in rhythm
- **Adrenaline** needs no special case: the scene latches the budget at the turn change, so the
  critical window is a fraction of the clock the seat actually started the turn with
- **Panic Button** is a `use_panic` message; the server extends both the turn clock and the
  personal clock, and refuses a non-active seat, a spent budget or a room that grants none
- **Last Breath** is granted by the server's own tick, once per turn, to a connected seat only —
  an absent seat is not out of time, it is out of the room

Either assist can be switched off on any preset: `normalizeRoomSettings` accepts an explicit zero
for panic or breath and ignores everything else a payload sends, so terms can be weakened and never
strengthened. The lobby has no switch for it yet — that UI is Phase 27's.

## Freeze, Time Debt and Time Attack presets (Phases 13–15)

Protocol v12. Both powers are Time Attack's, both are off in the named preset, and a custom room
with a `startClockMs` is what turns them on — "does this room have personal clocks?" has one
answer, `startClockMs > 0`, whatever the preset is called.

- **Freeze** (`use_freeze`, `useFreeze`): stops the personal clock for a fixed span, modelled as
  time credited to both the turn and the clock. The seat is charged for the whole turn either way,
  so crediting exactly the frozen span leaves it having spent nothing while frozen — deterministic,
  and impossible to stretch with a slow connection because no client says when a freeze ended.
- **Time Debt** (`borrowTime`): at zero, after Last Breath, a seat may borrow against its own
  future increments up to `maxDebtMs`. The debt is explicit and public (`GameView.debtMs`), the
  clock never goes negative, and `spendClock` pays the debt out of the increment before the clock
  grows. Bounded, so a seat cannot borrow its way out twice.
- **Presets** (`TIME_ATTACK_PRESETS`): Easy 120s/+5s with every power, Medium 90s/+4s, Hard
  60s/+3s (the lobby preset exactly), Expert 45s/+2s with nothing. Each one is expressible through
  the custom screen's own bounds, which is where a host picks a non-default difficulty until the
  lobby ruleset UI lands in Phase 27.

The clock face carries all of it as text: `+Ns` a panic is available, `❄Ns` once it is spent and a
freeze is not, `−Ns` for debt owed, and the rhythm pips. Never colour alone.
