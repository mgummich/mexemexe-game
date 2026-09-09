# Phase 5 — Opus critic pass #1 (logs + screenshots)

*Evidence reviewed: `docs/screenshots/verify-multiplayer-log.json`, the 8 `mp-*.png`
captures, and the reported suite results (155 unit incl. 39 server, 25 local e2e,
1 multiplayer e2e, lint, build, verify, verify:multiplayer all green).*

## What the evidence actually proves

The log is real and it is good: room `7S7KH`, server-chosen seed `25`, a
revision trail rising to 42, zero client console errors on both clients, empty
server stderr, and an illegal proposal rejected with `reason.unknownCard` and
`accepted: false` with no revision movement. The message trace shows the
expected shape — one `state_sync` per client per accepted action, `game_started`
after both `ready`, and a server-decided `game_over` at the end. The screenshots
corroborate it: the rejection capture shows the opponent's committed meld of
three tens still on the table, the rejecting client's hand intact, and
"Carta inválida" rendered legibly in the action panel; the two win captures show
the stalemate result synced to both clients with the online-only MENU button.
The waiting client shows "A está mexendo…" with FEITO/COMPRAR dead and its own
distinct hand — which also demonstrates the seat fix and the redaction working
end to end.

## Findings

**V1 — Reconnect has zero evidence (blocker for its score).** The client-side
retry was implemented this pass, but the multiplayer run never drops a socket.
`player_disconnected`, `player_reconnected`, the grace window, the token path
and the "reconnecting…" state are all untested and uncaptured. A phase rule says
network claims require logs or screenshots; right now the reconnect claim has
neither. The run must force a socket close on one client, assert the opponent
sees the disconnect notice, assert the dropped client reconnects and resyncs to
the same revision, and capture both states.

**V2 — The "both ready" lobby was never captured.** `mp-both-ready-b.png` is
byte-identical to `mp-in-match-waiting.png`, and `mp-both-ready-a.png` is an
in-match shot too: both captures fired after the game had already started. The
ready/start lobby is an explicit Phase 5 deliverable and currently has no
screenshot at all. Capture it before `ready` completes, on both clients.

**L1 — The lobby ignores the project's own readability rule.** Every other
screen puts a dark backdrop panel behind its controls precisely because the
boteco art is busy (MenuScene added one in Phase 4 for this reason).
`mp-lobby-code-a.png` renders the title, status, room code, player list and
"Esperando o outro jogador…" straight onto the artwork. It is legible in this
capture by luck of what sits behind it, not by construction.

**L2 — The player list row is unreadable.** It renders as `A ...` — a name and
an ellipsis at a size where the ready state cannot be told apart. The lobby's
one job is to show who is here and who is ready; that row should show each
player's name with an explicit ready marker at a legible size.

**L3 — Short names hide behind the active-avatar ring.** In-match, the opponent
name and card count are drawn at a fixed offset from the avatar, but the active
seat's avatar grows to 25px with two rings around it. With the long AI names
used offline this was never visible; with a one-character online name the ring
sits on top of both the name and the `x7` count
(`mp-in-match-waiting.png`). The offset should follow the avatar size.

**L4 — Stalemate copy reads as a win (cosmetic).** The stalemate result shows
the "BATEU!" banner over "Deu velha! A vence com menos cartas.", and the
subtitle line overlaps the results row. Pre-existing WinScene behaviour, more
visible online because stalemates are the easy end state to reach. Cosmetic,
not a blocker.

**L5 — `window.prompt()` for the join code (carried).** Documented alpha
shortcut; must appear in the known issues rather than surprise a playtester.

## Scores (0–10, honest)

| Dimension | Score | Basis |
|---|---|---|
| Local stability | 9.5 | 25/25 local e2e and 155 unit green after every pass; `localSeat` defaults to 0 so offline paths are unchanged; online isolated behind an optional config |
| Server stability | 9.0 | crash guards, bounded parse, flood cap, room cap, 39 server tests incl. malformed battery; no socket liveness probe (S7) |
| Protocol correctness | 9.0 | full message set, versioned envelope, ids-only proposals; observed trace matches the design exactly |
| Authoritative validation | 9.5 | id rehydration, shared `canConfirmTurn`, conservation assert, and a real browser-driven rejection proving it |
| Sync reliability | 9.0 | revision trail verified on both clients, stale syncs dropped, no state movement on rejection |
| Mexe network UX | 8.5 | submit-and-wait, legible rejection reason, structurally read-only opponent turn; lobby readability (L1/L2) and `window.prompt` hold it here |
| Reconnect / recovery | 7.0 | implemented but unevidenced (V1); server grace/token path never exercised end to end |
| Tests | 9.0 | 155 + 39 + 25 + 1, deterministic, non-flaky over two runs; missing the disconnect/reconnect scenario |
| Docs | 7.0 | architecture, audit, plans and reviews exist; README, CHANGELOG, RELEASE_NOTES and STATUS.json not yet updated for Phase 5 |
| Alpha readiness | 8.5 | the flow works end to end with real evidence; two gate items still open |

**Gate: NOT YET PASSED.** Reconnect/recovery (7.0) and docs (7.0) are below the
8.5 bar. Everything else clears it. Neither shortfall is a design problem — one
is missing evidence, one is missing prose.

## Weakest next task

1. V1 — disconnect/reconnect scenario in the multiplayer run, with assertions
   and screenshots. This is the only remaining item that could still reveal a
   real bug.
2. V2 + L1 + L2 + L3 — capture the ready lobby properly and fix the lobby
   backdrop, the player-list row, and the name offset while in there.
3. Docs — README, CHANGELOG, RELEASE_NOTES, STATUS.json with the model-role and
   caveman logs.

---

# Opus critic pass #2 — sign-off

Both gate blockers were closed and the evidence re-checked directly, not taken
on report.

**V1 (reconnect) — closed.** `verify-multiplayer-log.json` now carries a
`reconnect` section from a real run: room `QVR96`, `revisionBefore: 2`,
`revisionAfter: 2` — equal to the revision the surviving client was on, which is
the assertion that actually matters — plus the observed notice
("Adversário desconectou. Esperando reconectar…") and three captures. The
`reconnecting` capture shows the amber status dot and "Conexão caiu.
Reconectando…", so the intermediate state is evidenced and not inferred. The
run continues playing after the reconnect, so the resumed session is usable
rather than merely connected. The gate script fails if the revisions differ.
Score raised 7.0 → 9.0. Not 9.5: it is a single bounded retry, and there is
still no socket liveness probe, so a half-open connection holds a seat until
the grace timer.

**V2 (ready lobby) — closed.** All eleven `mp-*.png` captures are now
byte-distinct, and the lobby shots show two players with explicit ready state
("A — PRONTO" in green, "B — AGUARDANDO"). The earlier duplicate is gone.

**L1/L2/L3 — closed, with one carried cosmetic.** The player row is legible and
the in-match name/count offset now clears the active-seat ring at every avatar
size (visible in `mp-opponent-disconnected-a.png`, where a one-character name
reads cleanly). The lobby backdrop exists but is still fairly transparent over
the brighter bar artwork — better by construction than before, not yet as solid
as the in-game panels. Carried as polish, not a blocker.

**Docs — closed.** README, CHANGELOG, RELEASE_NOTES, the reconciled
architecture doc and STATUS.json all exist and were checked against the code.
The reconciliation caught five places where the pre-implementation design doc
had drifted from what shipped (notably `start_game` never existing, and the
reconnect token being valid for the room's lifetime rather than gated by the
grace window) — exactly the kind of drift a design-then-build phase produces,
and now corrected. Score raised 7.0 → 9.0.

**Independent verification.** `npm run test`, `npm run lint` and `npm run build`
were re-run directly at sign-off: exit 0, 155 tests passed across 10 files.

## Final scores

Local stability 9.5 · Server stability 9.0 · Protocol correctness 9.0 ·
Authoritative validation 9.5 · Sync reliability 9.0 · Mexe network UX 8.5 ·
Reconnect/recovery 9.0 · Tests 9.0 · Docs 9.0 · Alpha readiness 8.5

**GATE: PASS.** All ten dimensions ≥ 8.5, local play unaffected (25/25 local e2e
green throughout), no failed critical tests, zero client console errors, empty
server stderr, no illegal confirm accepted, no stuck online flow, build succeeds.

## Carried into a future pass

Lobby backdrop opacity; `window.prompt` join-code entry; stalemate banner copy
and its subtitle overlapping the results row; socket liveness probe. None of
these affect correctness of play or the authoritative validation path.
