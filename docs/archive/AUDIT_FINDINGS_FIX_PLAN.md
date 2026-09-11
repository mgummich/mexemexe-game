# Audit findings fix plan

Confirmed: 1–12 remained present at audit start (2026-09-10).

Order: 1 reconnect isolation; 2 crash scene teardown; 7 menu teardown; 3–6 server hardening; 8–12 client/PWA; low-risk follow-ups.

Tests: server registry/rooms tests; focused unit tests for net/AI/PWA; existing multiplayer/PWA/visual verification.

Risks: server protocol and Phaser lifecycle changes require targeted plus full verification. Performance/render pooling is deferred unless a minimal safe change is measurable.

Completed pass 1: 1 registry-level reconnect isolation; 2 crash recovery teardown; 3 configurable global/per-IP admission caps; 7 destroyed menu-family children and stopped scene tweens; 11 stale callback identity guards; 12 cache namespace rotation.

Completed pass 2 (2026-09-10): 4 per-connection failed-join limiter (close after 10 nonexistent-code guesses) plus a 16-char join-code cap in protocol parse; 5 per-room try/catch in `advanceStalledTurns` with a crash policy (corrupt room dropped, sockets notified) so one bad room cannot stall or crash the tick for the rest; 6 finished matches now close their room immediately after the `game_over` broadcast (slot freed, sockets detached with a clean `room_closed` notice) instead of lingering until the idle sweep; 8 `RearrangerAi.decideSliced` runs each search phase in its own ~100ms slice with event-loop yields between them, used by GameScene (guarded against scene shutdown mid-search), so an AI turn no longer blocks a frame for up to 400ms; 10 boot asset probes switched from HEAD to GET — the probe response primes the service-worker cache and the SW's HEAD special-case branch is deleted.

Evidence pass 2: `npm run test` 420/420; `npm run lint`; `npm run build`; `npm run verify:multiplayer` 9/9; `npm run verify:pwa` 10/10 — all exit 0. New tests: failed-join limiter, join-code cap, crash-isolation/deleteRoom, AI decideSliced parity, SW HEAD passthrough.

Still deferred by design: 9 renderAll sprite pooling — fps holds 58–60 against a 50 floor, so no minimal safe change is measurable (STATUS.json openIssues tracks it). Remaining low-priority openIssues in STATUS.json are documented as intentional behavior.
