# Phase 7 audit — online beta hardening

## Phase 6 status

Phase 6 shipped 2–4P authoritative rooms: four stable clockwise seats, host-explicit
lobby start, per-seat redacted views, revision-gated proposals, server-side card
rehydration and shared-rule validation, reconnect by session token, single-socket-per-seat
eviction, room sweep, and a crude per-connection flood guard. Evidence: server/unit tests,
`npm run verify`, `npm run verify:multiplayer` with 3P/4P rotation captures.

## Online beta blockers

1. **No server-side liveness.** The client pings every 20s but the server never probes.
   A half-open socket (laptop lid, dead NAT entry) keeps a seat occupied and `connected: true`
   until TCP eventually gives up, so the disconnect grace timer never starts.
2. **No inbound frame size limit.** `parseClientMessage` bounds fields, but `ws` buffers and
   `JSON.parse` runs on the whole frame first. A multi-megabyte frame is accepted before any
   validation.
3. **No desync detection.** `GameView` carries `rev` but no content digest, and there is no
   client-initiated resync message. A client whose local reconstruction diverges has no way
   to notice or recover short of a socket drop.
4. **A disconnected active seat stalls the match.** `sweep()` only reaps a room when *every*
   seat is past grace. In a 3P/4P game the two survivors sit forever on a board that can
   never advance.
5. **Errors are not correlatable.** `ErrorMsg` has no `reqId`, so a client cannot tie a
   failure back to the request that caused it.

## Desync / reconnect / security risks

- Reconnect, single-socket eviction, hand privacy, card conservation, stale-revision and
  forged-card rejection were verified in Phase 5/6 and are unchanged. No new authority holes
  found: FEITO carries ids and a revision only; suit/rank never cross the wire inbound.
- The remaining desync risk is silent client-side divergence (blocker 3), not server drift —
  the server never trusts a client value.
- Flood guard is per connection, not per IP. Acceptable for beta; noted as a known limit.

## UX friction

- Join code entry is a native `window.prompt` (carried debt from Phase 5).
- The lobby START button greys out with no stated reason.
- No visible resync state when the client refetches authoritative state.

## Verify / deployment gaps

- No coverage for liveness timeout, oversized frames, desync/resync, or a stalled seat.
- Multiplayer verify exercises 2P flow plus 3P/4P rotation; the beta suite needs the new paths.

## Top 10 tasks

1. Server heartbeat with pong timeout; terminate dead sockets.
2. `maxPayload` cap on the WebSocket server.
3. State hash in `GameView`; client-side mismatch detection.
4. `resync` client message; server replies with a full authoritative snapshot.
5. Auto-advance a seat disconnected past grace so a match cannot stall.
6. `reqId` on `ErrorMsg` for correlation.
7. In-canvas join-code input replacing `window.prompt`.
8. Lobby START disabled-reason text.
9. Protocol version bump to 3 and tests for every new rejection path.
10. Docs/STATUS/CHANGELOG/release notes refresh for the beta.
