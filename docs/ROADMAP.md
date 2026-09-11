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

- Pure, fully-tested rules engine: two 54-card decks, jokers with a one-per-meld
  limit, ace low/high without wrap, trincas with unique natural suits, shared
  table, draw-pile exhaustion ending.
- Mexe Mode draft editor with undo/redo/reset and a FEITO gate that explains
  itself in both locales.
- 2–4 seats, hot-seat and AI; two AI levels across four personalities;
  deterministic and budgeted.
- 12-step interactive tutorial.
- pt-BR and en-US localization with key parity enforced by a test.
- Cosmetics: 4 table themes, 5 card backs, 9 avatars.
- Audio: procedural SFX plus a context-aware streamed music playlist.
- Mobile: portrait and landscape layouts, tap-to-move, a full-screen Mexe
  editor, table zoom, meld focus view.
- Accessibility: non-color validity signals, +25% large text, reduced motion.
- PWA: installable, offline local play, versioned cache, opt-in update handover.
- Online alpha: private rooms, server-authoritative turns, hand privacy,
  reconnect, desync detection and resync.
- Server-owned turn timer: Casual/Fast/Off lobby presets, a once-per-turn Mexe
  bonus, a warning window, per-room reconnect grace and a missed-turn limit.
  The client only ever renders `turnMsLeft`; the server decides every expiry.
- Lobby room summary: the agreed timer terms are shown to every seat and the
  host taps the line to cycle presets, frozen the moment the match starts.
- AI difficulty (Beginner / Casual / Smart / Expert), pace and move-explanation
  settings, on top of the four existing personalities.
- Verification: unit + server + screenshot/perf + cross-browser + multiplayer +
  PWA suites, all gated in CI.

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
