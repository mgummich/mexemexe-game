# MEXE! — Playtest guide

This is the public-demo build. It is a **playtest**, not a release: we want to find out where
people get stuck, which rules bite, and whether online play survives real humans on real
networks. Everything below takes about 30 minutes.

## How to run

Local play only (no server needed):

```bash
npm install
npm run dev          # open the printed URL
```

Online play needs the room server running too:

```bash
npm run server       # terminal 1 — WebSocket room server
npm run dev          # terminal 2 — game client
```

The client picks its WebSocket URL from the page origin; see the **Online Beta** section of
`README.md` if you are serving the build from somewhere other than `localhost`.

Useful URL parameters:

| Parameter | Effect |
|---|---|
| `?lang=en` | English UI (default is Brazilian Portuguese) |
| `?textscale=125` | +25% text size |
| `?playlog=0` | turn the session play log off entirely |
| `?ai=cida\|juninho\|bia\|ze` | force the opponent personality in a 2-player local game |

## What to test

Work through these in order and stop to write down anything that made you hesitate. **Hesitation
is the bug we are hunting** — if you had to think about what the game wanted, that is a finding
even if nothing broke.

**First run**
1. Start the game cold, with no saved data, and take the tutorial without skipping. Where, if
   anywhere, did you stop understanding what to do?
2. Take the tutorial again from the menu (replay), and this time skip out of it partway. Does
   skipping leave you somewhere sensible?

**Local play**
3. Play a full 2-player game to a win.
4. Play a 4-player game. Can you always tell whose turn it is?
5. Deliberately build an illegal meld and press FEITO. Does the game tell you *why* in words you
   can act on? Try at least: a group of 5 same-rank cards, a group with two cards of the same
   suit, a run that wraps K-A-2, and a FEITO with no card played from your hand.
6. Use a joker. Then try to build a meld out of nothing but jokers.
7. Rearrange the shared table (Mexe Mode) — split a meld, move cards between melds, then undo
   and reset back to the start of your turn.

**Online play**
8. Two browser windows: create a room in one, join with the code in the other, ready up, START.
9. Try the impatient-human moves: double-click CREATE, double-click JOIN, type a room code that
   does not exist, try to join a room that is already full, and press READY repeatedly.
10. Mid-match, kill your network (or close the tab and reopen it). Does the match recover? Does
    the other player's game keep working while you are gone?
11. Start the client with the server **not** running. Does the game explain that clearly, or does
    it just sit there?
12. Play an online game to a win.

**Both languages**
13. Repeat a short local game with `?lang=en`. Any untranslated or overflowing text?

## Rule summary

Full rules: `docs/RULES.md`. The short version:

- Two 54-card decks — **108 cards, 4 jokers**. Everyone is dealt **7**.
- **Goal:** empty your hand first. If the draw pile runs out, fewest cards in hand wins.
- **Runs:** 3+ consecutive cards of one suit. Ace may be low (A-2-3) or high (Q-K-A), never
  wrapping (K-A-2 is not a run).
- **Groups (trincas):** **exactly 3 or 4** cards of the same rank, and every natural card must be
  a **different suit** — even when they came from different decks.
- **Jokers** are wildcards, but every joker must have a concrete card it stands for, and every
  meld needs at least one natural card.
- The whole table is **shared**. On your turn you may rearrange it freely, but to confirm (FEITO)
  you must add at least one card from your hand and every meld on the table must be valid.
- If you do not confirm, you draw one card and your turn ends. There is no draw at the start of a
  turn, and nothing is ever discarded.

## Online test checklist

- [ ] Room code is readable and typeable from the other player's screen
- [ ] START explains itself while it is greyed out
- [ ] Both players see the same table after every turn
- [ ] You never see another player's hand
- [ ] A rejected play tells you why and does not lock up your turn
- [ ] A disconnect recovers, or fails to the menu with an explanation — never a frozen board
- [ ] The other players' match keeps moving while someone is disconnected

## Known limitations

These are known and in scope for a later phase. Reporting them again is not useful.

- No accounts, matchmaking, chat, or spectating.
- No online rematch — an online match ends at the menu.
- Rooms are private and code-only, and vanish when everyone leaves.
- The optional turn timer is **off** and unimplemented; `turnTimerSeconds` is a documented hook.
- The four AI opponents are personalities, not difficulty levels — there is no Easy/Hard setting.
- Rate limiting is per connection, not per IP.
- Pointer-drag is verified in tests through editor hooks rather than synthetic pointer drags.
- Cosmetic issues already logged in the **Known issues** section of `README.md`.

## How to report a bug

Open an issue with:

1. **What you expected** and **what happened**, in that order, one sentence each.
2. **How to reproduce it**, numbered. If you cannot reproduce it, say so — an unreproducible
   report with a seed and a log is still worth filing.
3. **Mode**: local or online, and the player count.
4. **Seed** — `window.__MEXE__.seed` always has it. A game can also be replayed with `?seed=<n>`.
5. **Room code and your seat number** for online bugs (`window.__MEXE__.online.code()` and
   `.seat()`).
6. **A screenshot** of the moment it went wrong — for a rules complaint, one showing the table and
   your hand.
7. **The session log** (below), attached as a `.json` file.
8. For anything that looks like a crash, the **browser console** output and, for online bugs, the
   **server terminal** output.

## The session log

The build keeps a small **in-memory, session-only** log of what happened, to turn "it felt
confusing" into something countable. To grab it, open the browser console and run:

```js
copy(window.__MEXE__.playlog.exportJson())   // Chrome/Edge: copies to clipboard
window.__MEXE__.playlog.exportJson()         // or just print it and copy manually
```

Paste it into a file and attach it. `window.__MEXE__.playlog.summary()` prints the aggregate
counters alone if you want a quick look.

### Privacy note

Read this before attaching a log — you are the one deciding to send it.

- The log lives **in memory for one session**. It is never written to disk, never stored in
  `localStorage`, and never sent anywhere. Reloading the page destroys it. Nothing leaves your
  machine unless you personally export the file and attach it.
- It records **game events only**: turn numbers and durations, cards-played counts, which rule
  reason codes rejected a play, undo/redo/reset counts, how far you got in the tutorial, and
  disconnect/reconnect/desync counts.
- It records **no personal data**. Player names, reconnect tokens and session tokens are stripped
  by an explicit key filter before anything is exported, and this is covered by a test. Timestamps
  are milliseconds since the page loaded, not wall-clock times, so the log cannot say when you
  played.
- It contains no IP address, no device or browser fingerprint, and no free text you typed.
- `?playlog=0` disables it completely.

If you would still rather not send it, send the report without it. A described bug is worth more
than a withheld one.
