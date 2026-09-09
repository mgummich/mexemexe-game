# Phase 6 audit — 2–4P multiplayer hardening

## Baseline

Phase 5 shipped an authoritative 2P WebSocket alpha: redacted views,
revision-gated proposals, server-side card rehydration and shared-rule
validation, reconnect/resync, cleanup, and local-play isolation. Phase 5
evidence was 155 unit/server tests, 25 local E2E tests and one two-client
multiplayer scenario.

## Findings and action

1. **Fixed two-seat room was the blocker.** `RoomManager` stored exactly two
   seats and dealt for two; a third join failed. Phase 6 changes this to four
   stable clockwise seats, with a fifth rejection.
2. **Auto-start could not form 3P/4P rooms.** Ready is now idempotent lobby
   state. Seat 0 explicitly starts only when 2–4 occupied seats are ready.
3. **Authority remains server-only.** FEITO carries only IDs and revision;
   active-seat, stale, duplicate, forged-card, invalid-meld and conservation
   checks stay on the server. Draft undo/redo/reset/cancel remain client-only.
4. **Privacy remains per-view.** Only viewing seat receives card identities;
   other hands and draw pile are counts. `buildView` works for every seat.
5. **Reconnect fallback is safe.** Token restores same seat while room exists;
   a replacement connection evicts the old one. One bounded retry failing
   returns to local menu. A client draft is discarded on authoritative sync.
6. **Known alpha limits.** No public matchmaking, accounts, chat, online
   rematch, persistent retry, or liveness heartbeat. A native join-code prompt
   remains cosmetic technical debt.

## Verification gaps closed

- Server tests: 2/3/4 ready-start and deterministic clockwise rotation,
  stable seats, fifth rejection, non-host/unready start rejection.
- Browser test: host-started 3P and 4P rooms rotate once through every seat;
  captures: `docs/screenshots/mp-3p-rotation.png` and
  `docs/screenshots/mp-4p-rotation.png`.
- Existing two-client flow continues to cover legal proposal, forged-card
  rejection, stale revision behavior, resync and game-over sync.

## Top remaining tasks

1. Add per-seat 3P/4P redaction and reconnect socket integration coverage.
2. Replace native prompt with in-canvas join field.
3. Add socket heartbeat/timeout before broader deployment.
4. Add online rematch only after preserving room-token semantics is designed.
