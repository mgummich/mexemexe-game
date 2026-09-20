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
| 7 — Blitz Panic Button and Last Breath | PARTIAL | Domain + local Blitz: `usePanic`/`enterLastBreath`, four-combination tests, `?panic=`/`?breath=` hooks. Online rulesets carry neither yet — deferred to Phase 27. |
| 8 — Blitz Difficulty Presets | COMPLETE | `BLITZ_PRESETS` (easy/medium/hard/expert/custom) + setup row with independent panic/breath switches; custom turn length in the settings panel. Evidence: `setup-blitz`. |
| 9 — MexeMexe Time Attack Core | NOT_STARTED | |
| 10 — Time Attack Perfect Rhythm | NOT_STARTED | |
| 11 — Time Attack Adrenaline | NOT_STARTED | |
| 12 — Time Attack Panic Button and Last Breath | NOT_STARTED | |
| 13 — Time Attack Freeze | NOT_STARTED | |
| 14 — Time Attack Time Debt | NOT_STARTED | |
| 15 — Time Attack Presets | NOT_STARTED | |
| 16 — Optional Overheat Modifier Outside Tempo | NOT_STARTED | |
| 17 — Commit / No Undo Thinking | NOT_STARTED | |
| 18 — Simultaneous Start Prototype | NOT_STARTED | |
| 19 — MexeMexe Tempo Core | NOT_STARTED | |
| 20 — Tempo Generation | NOT_STARTED | |
| 21 — Tempo Abilities v1 | NOT_STARTED | |
| 22 — Tempo Heat and Overheat | NOT_STARTED | |
| 23 — Tempo Adrenaline | NOT_STARTED | |
| 24 — Tempo Survival Systems | NOT_STARTED | |
| 25 — Advanced Tempo Powers | NOT_STARTED | |
| 26 — Tempo Sync | NOT_STARTED | |
| 27 — Matchmaking, Lobby, and Ruleset Policy | NOT_STARTED | |
| 28 — Speed AI | NOT_STARTED | |
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
