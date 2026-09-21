# Roadmap

What is done, what is being worked on, what is planned, and what has been
deliberately set aside. Anything not listed under **Completed** is not
implemented, regardless of how it reads elsewhere.

## The remaining roadmap is finished

`MexeMexe_Remaining_Roadmap_Detailed.md` — Waves 6 to 12 plus the deferred visual
wave — has been executed phase by phase. What each phase changed, what it
verified, what it deliberately did not do, and every risk it deferred is in
`docs/ROADMAP_STATUS.json`; `npm run health` reads that file and prints the part
that still needs a person. This document stays what it always was: the
player-facing view of done, next and set aside.

## Current status

The game is released and playable: local play against four AI opponents, the
tutorial, cosmetics, mobile layouts and full offline play are finished.
Online rooms are an **alpha** — they work, they are server-authoritative, and
they are missing the comforts listed in [MULTIPLAYER.md](MULTIPLAYER.md).

## Completed

The shipped feature set is described in [the README](index.md) and, per
release, in [CHANGELOG.md](CHANGELOG.md). This document does not repeat it.

## In progress

**Speed Modes** — MexeMexe under time pressure, on one shared timing domain
(`src/game-state/timing.ts`). Shipped so far: **Blitz** (a fixed per-turn clock,
online as a lobby preset and offline with four difficulties plus custom),
**Time Attack** (server-owned personal clocks with an increment, Freeze and
Time Debt in a custom room) and **Tempo** (a local mode where the clock is
survival, Tempo is power and Heat is risk). Perfect Rhythm and Adrenaline are
native to every timed mode and are not settings; the Panic Button and Last
Breath are always individually disableable. Simultaneous Start, Tempo Sync and
the advanced Tempo powers are deferred with reasons in
[specs/speed-modes-timing.md](specs/speed-modes-timing.md). **Every Speed number
is provisional and awaiting playtest evidence.**

## Planned next

- **Tutorial depth** — multi-turn steps: confirm a turn, then watch an opponent
  move.
- **Rules panel sectioning** — the in-game help is one long panel; split it by
  topic.
- **Small-phone pass** — no SE/mini-class runtime has been exercised; narrow
  screens are unconfirmed rather than known good.
- **Mobile usability polish** — quick-move helpers (send a card to its obvious
  destination), clearer drag affordances on crowded tables.
- **Playtest hardening** — the two flaky specs on record were addressed, and
  then measured: `@perf` tests read fps over their own window and now report every
  window they measured (`measureFpsSamples` in `e2e/screenshot.spec.ts`), so a
  failure says whether one window or all of them dropped. The CI floors still hold
  numbers measured under the old lifetime-average read — floors with slack until a
  CI run re-measures them.

## Deferred

- **Online result stats** — needs a protocol change (the client never observes
  per-turn state locally). Deliberately postponed rather than faked with zeros.
  Online *rematch* itself is shipped: a finished room is recycled back to its
  lobby on the same code (see [MULTIPLAYER.md](MULTIPLAYER.md) §3).
- **Sprite pooling in the render loop** — measured at 59 fps with 21 sprites
  and 20 zones; revisit only if a lower-end target dips below 50.
- **Continuous responsive layout** — portrait is a second authored layout, not
  a fluid one; window shapes far from 16:9 or 9:16 letterbox.
- **Hostile-scale hardening** — the alpha assumes friends with a room code.
  Per-IP connection caps and a per-IP room-creation budget *are* shipped; what
  is not is protection against a large connection farm, stated as such in
  [THREAT_MODEL.md](THREAT_MODEL.md) TM-06 and TM-18.

## Not planned now

- Accounts, ranked play, skill rating, chat, spectators. Casual matchmaking
  *is* shipped — one FIFO queue, a player-count preference and server-chosen
  casual terms (see [MULTIPLAYER.md](MULTIPLAYER.md) §3e); nothing above it is.
- Cosmetics synced across the network (they are strictly client-side).
- Native app builds — the PWA is the install story.
- New AI personalities beyond the existing four (difficulty tiers now exist).
