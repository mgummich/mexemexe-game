# Bug Hunt Audit — 2026-09-10

## Known failures

- No current failing unit, server, lint, or build checks. Pre-hunt baseline: `npm run test` 408/408 and `npm run test:server` 72/72.
- Earlier phase audit notes carry UX/performance work and intentional limits; none records an open P0.

## Confirmed finding

- **P1 fixed — disconnected ready lobby seat could start a match.** `RoomManager.startGame()` considered a saved ready bit sufficient even after that socket disconnected. The host could start a match that omitted `game_started` for the absent player and later depended on stalled-turn recovery. Regression: `room lifecycle > does not start while a ready lobby player is disconnected`.

## Suspected hotspots

- Server lobby lifecycle, disconnect/reconnect, and revision-gated turn submission.
- Shared rules validation: Joker placement, repeated-suit groups, table-card preservation, and draw-pile exhaustion.
- Online view redaction/reconstruction and local editor synchronization.
- PWA asset HEAD handling and offline/online boundary.

## Available checks

- `npm run test`, `npm run test:server`, `npm run lint`, `npm run build`
- `npm run verify`, `npm run verify:multiplayer`, `npm run verify:pwa`, `npm run verify:preview`

## Active gameplay probe plan / top risks

1. P0: boot/build and local game start.
2. P0: server rejects malformed, forged, stale, and out-of-turn proposals.
3. P0: hand redaction and draw-pile privacy.
4. P1: lobby readiness vs. disconnect/reconnect (confirmed and fixed).
5. P1: stalled-turn progression after disconnect.
6. P1: Joker max-one and no all-Joker melds.
7. P1: repeated-suit trinca rejection and run ace boundaries.
8. P1: undo/reset/draft preservation of committed table cards.
9. P1: draw-pile exhaustion winner selection.
10. P2: offline/PWA asset and disabled-online state.

No issue register is present in this repository.
