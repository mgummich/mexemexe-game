# MexeMexe Speed Modes — Implementation Status

This file is maintained by the autonomous Speed Modes implementation controller.

Do not use this file as the product specification.
The source of truth for scope is:

`SPEED_MODES_IMPLEMENTATION_PHASES.md`

## Status values

```text
NOT_STARTED
IN_PROGRESS
COMPLETE
PARTIAL
BLOCKED
DEFERRED
```

## Progress

| Phase | Status | Notes |
|---|---|---|
| 1 — Architecture Audit and Shared Timing Design | COMPLETE | Design: `docs/specs/speed-modes-timing.md` |
| 2 — Shared Authoritative Timing Foundation | PARTIAL | `src/game-state/timing.ts` owns the turn-clock arithmetic; `server/rooms.ts` uses it. Per-seat resources (personal clock, Freeze, Time Debt, Tempo, Heat) land with the phases that introduce them. |
| 3 — Shared Speed UX | COMPLETE | Contract documented in the spec; existing timed-online UX is the shared layer. Added the missing critical-second haptic cue. Mode chrome lands with its mechanic. |
| 4 — MexeMexe Blitz Core | COMPLETE | Online: fourth timer preset (7s, no Mexe bonus). Local: setup toggle + scene-owned clock, `?blitz=1` e2e hook, `blitz-clock` screenshot evidence. |
| 5 — Blitz Perfect Rhythm | COMPLETE | `Rhythm` in the timing domain (4 tests); pip run beside the clock; no toggle. Local Speed clock moved to its own HUD slot (`regions.speedClock`). |
| 6 — Blitz Adrenaline | COMPLETE | `adrenaline` ramp in `turn-clock.ts` (3 tests) driving readout growth and cue volume; budget-aware critical window. Stateless, so reconnect-safe. |
| 7 — Blitz Panic Button and Last Breath | COMPLETE | Domain + local Blitz (four-combination tests, `?panic=`/`?breath=` hooks); online half landed with Phase 12 — the Blitz preset carries +4s panic and a 2s breath. |
| 8 — Blitz Difficulty Presets | COMPLETE | `BLITZ_PRESETS` (easy/medium/hard/expert/custom) + setup row with independent panic/breath switches; custom turn length in the settings panel. Evidence: `setup-blitz`. |
| 9 — MexeMexe Time Attack Core | COMPLETE | Protocol v10: `startClockMs`/`incrementMs`, `GameView.clocksMs`, server charge/increment, `server/speed-rules.ts`. Lobby preset + per-seat HUD clocks. |
| 10 — Time Attack Perfect Rhythm | COMPLETE | Shared fold via `noteTurnUsed`; threshold is the increment, so a turn that paid for itself keeps rhythm. |
| 11 — Time Attack Adrenaline | COMPLETE | No special case needed: the scene latches the turn budget at the turn change, so the critical window is a fraction of the seat’s own clock. |
| 12 — Time Attack Panic Button and Last Breath | COMPLETE | Protocol v11: `use_panic`, `panicLeft`, server-granted Last Breath. Tests: panic near zero, breath at zero, increment after a breath, reconnect mid-breath, rematch reset, both disabled. Lobby switches are Phase 27. |
| 13 — Time Attack Freeze | COMPLETE | `useFreeze` + `use_freeze` (protocol v12), credited to both turn and personal clock, one use per match, no lag-based extension. |
| 14 — Time Attack Time Debt | COMPLETE | `borrowTime` at zero (after Last Breath), bounded by `maxDebtMs`, repaid out of the increment first; `GameView.debtMs` renders it. |
| 15 — Time Attack Presets | PARTIAL | `TIME_ATTACK_PRESETS` (easy/medium/hard/expert/custom), each expressible through the custom screen bounds; Hard is the lobby preset. Named-difficulty lobby UI is Phase 27. |
| 16 — Optional Overheat Modifier Outside Tempo | COMPLETE | Heat ladder + cooldown in the shared domain (3 tests); left experimental and off outside Tempo, per the phase guardrail. |
| 17 — Commit / No Undo Thinking | COMPLETE | `commitPlay` setting: undo/redo/reset removed while building a turn, local only, off by default. |
| 18 — Simultaneous Start Prototype | DEFERRED | Designed in the spec (eligibility, lifecycle, lock, timeout, conflict order, reconnect). Deferred under the phase’s own clause: simultaneous commits raise a legality question (shared cards), not a timing one, and replay coverage must prove the conflict rule first. |
| 19 — MexeMexe Tempo Core | COMPLETE | Local mode on the shared clock: Clock/Tempo/Heat, setup cycle entry, top-bar HUD. Evidence: `tempo-hud`. |
| 20 — Tempo Generation | COMPLETE | `noteTempoTurn`: rhythm, play and close-call sources, capped, deterministic, Adrenaline and Surge as the two multipliers. |
| 21 — Tempo Abilities v1 | COMPLETE | Freeze 3 / Recover 5 / Surge 4, explicit cost on the button face, refused when unaffordable, overheated or already surging. |
| 22 — Tempo Heat and Overheat | COMPLETE | Shared heat ladder: close calls and Surge heat, rhythm cools, ceiling trips a two-turn power lockout with no Tempo gain. |
| 23 — Tempo Adrenaline | COMPLETE | Clock share under 25% doubles both gain and heat — comeback and risk on one lever. Not a toggle. |
| 24 — Tempo Survival Systems | COMPLETE | Recover is Tempo’s Panic (Tempo-to-Clock); Last Breath costs Tempo, once per turn. No separate assists to overwhelm the three numbers. |
| 25 — Advanced Tempo Powers | DEFERRED | Explicitly permitted by the phase: Focus, Tempo Shield, alternate Surge and Time Domains are all variations on v1’s multipliers and answer no open question. Revisit after play. |
| 26 — Tempo Sync | DEFERRED | Depends on Phase 18, which is deferred: simultaneous resolution is unproven, and the phase says to enable Sync only if it is. |
| 27 — Matchmaking, Lobby, and Ruleset Policy | COMPLETE | Casual queue stays on one preset; Speed rooms are private/custom only, experimental parts behind CUSTOM. Lobby summary states clock/increment/assists and never lists Rhythm or Adrenaline. |
| 28 — Speed AI | PARTIAL | Pace scales with the Speed budget; search budget stays a trial count, so strength is unchanged and nothing leaks. Risk-tolerance over Panic/Freeze/Tempo is unbuilt: no AI seat holds those resources yet. |
| 29 — Focused Speed QA Matrix | NOT_STARTED | |
| 30 — Balancing and Telemetry | NOT_STARTED | |
| 31 — Documentation Synchronization | NOT_STARTED | |
| 32 — Release Hardening and Final Acceptance | NOT_STARTED | |

## Phase detail template

Use when a phase needs more than a table note:

```text
Phase:
Status:

Completed scope:
-

Tests:
-

Docs updated:
-

Known issues:
-

Deferred items:
-

Commit/revision:
-
```
