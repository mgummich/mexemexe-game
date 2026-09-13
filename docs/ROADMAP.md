# Roadmap

What is done, what is being worked on, what is planned, and what has been
deliberately set aside. Anything not listed under **Completed** is not
implemented, regardless of how it reads elsewhere.

## Current status

The game is released and playable: local play against four AI opponents, the
tutorial, cosmetics, mobile layouts and full offline play are finished.
Online rooms are an **alpha** — they work, they are server-authoritative, and
they are missing the comforts listed in [MULTIPLAYER.md](MULTIPLAYER.md).

## Completed

The shipped feature set is described in [the README](../README.md) and, per
release, in [CHANGELOG.md](../CHANGELOG.md). This document does not repeat it.

## In progress

Nothing is mid-flight. The repository is at a released, green state.

## Planned next

- **Custom timer UI** — `custom` timer values are validated end to end on the
  wire but have no lobby control; three presets cover a room of friends.
- **Online rematch** — still needs the protocol change noted under Deferred.
- **Tutorial depth** — multi-turn steps: confirm a turn, then watch an opponent
  move.
- **Rules panel sectioning** — the in-game help is one long panel; split it by
  topic.
- **Small-phone pass** — no SE/mini-class runtime has been exercised; narrow
  screens are unconfirmed rather than known good.
- **Mobile usability polish** — quick-move helpers (send a card to its obvious
  destination), clearer drag affordances on crowded tables.
- **Playtest hardening** — act on the two flaky specs on record
  (`crowded-table-max` fps gate, `mobile-tap-move-valid` lost tap).

## Deferred

- **Online rematch and online result stats** — both need a protocol change
  (the client never observes per-turn state locally). Deliberately postponed
  rather than faked with zeros.
- **Sprite pooling in the render loop** — measured at 59 fps with 21 sprites
  and 20 zones; revisit only if a lower-end target dips below 50.
- **Continuous responsive layout** — portrait is a second authored layout, not
  a fluid one; window shapes far from 16:9 or 9:16 letterbox.
- **Per-IP rate limiting and hostile-scale hardening** — the alpha assumes
  friends with a room code.

## Not planned now

- Accounts, matchmaking, ranked play, chat, spectators.
- Cosmetics synced across the network (they are strictly client-side).
- Native app builds — the PWA is the install story.
- New AI personalities beyond the existing four (difficulty tiers now exist).
