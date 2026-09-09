# Phase 5 — Online client: minimal alpha flow, Mexe network risks, reconnect decision

*Reasoning: Opus (prose only). Implementation: Sonnet.*

## A. Minimal alpha UX flow

The alpha needs exactly one new screen and one new in-match mode. Anything more
is scope that will not survive its first playtest.

**New screen — Online lobby.** Reached from a single new `ONLINE (ALFA)` button
on the main menu, placed so it cannot be mistaken for the primary local `JOGAR`
button. The lobby is one scene with three states:

1. *Idle*: two actions, `CRIAR SALA` and `ENTRAR`, plus a connection status
   line and `VOLTAR` (always present, always works, in every state).
2. *Hosting/joined*: room code shown large and monospaced with a `COPIAR`
   button, both players listed with ready checkmarks, a `PRONTO` toggle, and a
   "waiting for opponent" line while the second seat is empty. Start is
   automatic when both seats are ready — a separate start button is one more
   thing to get stuck on.
3. *Error/disconnected*: a plain message and `VOLTAR`. Never a dead end.

Join-by-code entry should accept lowercase and strip spaces; the code alphabet
is already vowel-free, so the only realistic typo is case.

**In-match — two states instead of one.** Today `GameScene` has "your turn"
(editor bound) and "AI turn" (timer running). Online adds "opponent's turn",
which looks like the AI turn minus the AI: table strictly read-only, no drag
handlers wired, no FEITO/COMPRAR, and a banner reading *"Rita está mexendo…"*
rather than the AI thinking bubble. The single most important detail is that
read-only must be enforced by *not wiring the interaction*, not by a check
inside the handler — an unwired sprite cannot be dragged by a stray event.

**Submit-and-wait.** FEITO in an online match means: lock the UI, show a
pending indicator, send, and wait. Three outcomes — accepted (`state_sync`
arrives, animate to the new state), rejected (localized reason, restore the
last synced state), or timeout (treat as a connection problem, show status,
never silently unlock into an inconsistent state).

**Connection status is always visible in an online match** — a small
corner indicator, not a modal. Modals for transient network blips are the
fastest way to make an alpha feel broken.

## B. Mexe Mode network flow — ranked risk list

1. **Double submit.** Keyboard `F` and the FEITO button share `onFeito`; a fast
   player or a stuck key can fire twice before the first `state_sync` returns.
   Must be blocked at three layers: an in-flight flag on the client, the
   existing 250ms confirm guard, and the server's per-turn in-flight lock plus
   revision check. Client-side alone is not enough.
2. **Stale submit after a reconnect or a late sync.** The client must send the
   `rev` it drafted against, and the server must reject anything else. A client
   rendering `rev 12` while the server is at `rev 13` is a normal race, not an
   error — the rejection reason should be quiet and self-healing (resync, do not
   alarm the player).
3. **Draft survives a state change.** If a `state_sync` arrives mid-draft (it
   should not on your own turn, but reconnect makes it possible), the draft must
   be discarded and rebuilt from the new state. A draft rebased onto a different
   table is how duplicate/missing-card bugs are born.
4. **Out-of-turn editing.** Covered by not wiring interaction, plus a server
   seat check. Both, because the client can be wrong.
5. **Returning a committed table card to hand.** Already impossible through
   `DraftEditor` (`returnHandCard` only accepts ids in `handCardsPlayed`) and
   already rejected by `canConfirmTurn` via the `cardMissing` check. Needs a
   *test* on the server path, not new logic.
6. **Zero hand cards added.** Same: `reason.noHandCard` exists; the risk is only
   that an online path bypasses `canConfirmTurn`. It must not.
7. **Forged cards.** A hand-written socket message can claim any suit/rank.
   Server-side id rehydration is the whole defence; nothing on the client
   matters here.
8. **Undo/redo/reset leaking to the network.** They must remain purely local.
   The temptation to "sync the draft so the opponent sees the rearranging" is
   the single worst idea available in this phase — it multiplies message volume,
   creates a real-time editing surface the rules were never designed for, and
   leaks the active player's hand. The opponent sees a waiting state. That is
   the design.
9. **Animation racing a sync.** The FEITO sparkle FX currently delays the
   re-render by ~320ms. Online, the authoritative state may arrive during that
   window. Render from the server view when it lands and let the FX be purely
   decorative — never gate a state transition on a tween completing.
10. **Win arriving as a broadcast rather than a local computation.** The
    client must not call `checkWinner`; it transitions to `WinScene` when
    `game_over` arrives, including the stalemate case.

## C. Reconnect — complexity analysis and decision

Full reconnect for this game is genuinely cheap, and cheaper than for most
real-time games, for one reason: **there is no in-flight state to reconcile.**
The server only mutates on a fully validated message it has already processed,
turns are discrete, and a draft is local and disposable. A reconnecting client
therefore needs exactly one thing — the current view — and can throw away
everything it had.

The real cost is in the parts that are not the game: issuing and storing a
token, holding a room open while a seat is empty, telling the opponent what is
happening, and reaping rooms whose player never came back.

**Decision: implement basic reconnect**, with these boundaries.

- Token issued at join, stored in `sessionStorage` (not `localStorage` — a
  stale token across browser sessions is a support problem, and sessionStorage
  matches the lifetime of the tab that owns the seat).
- Grace window on the order of a minute; the opponent sees an explicit
  "opponent disconnected — waiting" state with a visible countdown or at least a
  clear message, and can leave at any time.
- On successful reconnect the client discards all local state and rebuilds from
  the `state_sync` it receives. No merging, ever.
- After the window expires the room is destroyed and the remaining client is
  returned to the lobby with a clear message. This is the documented fallback
  path and it must be reachable and tested — if reconnect proves flaky in
  verification, this same path becomes the whole feature and the limitation
  goes in the README honestly.

What is explicitly out of scope: reconnecting into a *finished* game,
mid-turn reconnection preserving a draft, and cross-device resume. All three
are alpha-inappropriate and none of them change what a playtest teaches you.
