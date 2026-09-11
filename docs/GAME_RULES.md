# Game rules

The authoritative ruleset implemented by MEXEMEXE!. Where the code and this document disagree,
this document wins and the code is a bug. Every example below is asserted against the engine
(`analyzeMeld`, `src/rules/rules.ts`) and covered by `tests/rules.test.ts`.

## Setup

- **Players:** 2 or more (this build seats 2–4).
- **Deck:** two 54-card decks = **108 cards**. Each 54-card deck is the 52 standard cards plus
  **2 jokers**, so a game contains **4 jokers**.
- **Deal:** 7 cards to each player.
- **Draw pile:** every undealt card, face down.
- **No discard pile.** Nothing is ever thrown away.
- Turn order is clockwise.

Two decks means the same card exists twice (two ♥7s). They are distinct cards; the engine keeps
them apart by deck id.

## Goal

Be the first player to empty your hand.

If the draw pile runs out before anyone empties their hand, the game ends there and the player
with the **fewest cards in hand** wins (a tie goes to the earliest seat).

## Melds

A meld is **3 or more cards**. Two kinds:

### Runs (sequences)

- 3+ cards of consecutive rank, **all the same suit**.
- The ace may be **low** (A-2-3) or **high** (Q-K-A).
- **No wrap:** K-A-2 is not a run. An ace is either low or high in a given meld, never both.

### Groups (trincas)

- **Exactly 3 or 4 cards** of the **same rank**.
- Natural cards must use different suits, even when they came from different decks.

### Jokers

- A joker is a wildcard in a run or a group.
- **Each meld can use at most 1 joker.** A joker can substitute one missing card in a sequence
  or a trinca. A meld with 2 or more jokers is invalid (`reason.tooManyJokers`).
- Every joker in a valid meld must have a concrete interpretation — the exact card it stands for.
  A meld whose joker cannot be assigned a legal card is invalid, even if the count looks right.
- A meld must contain at least one natural (non-joker) card; a pile of jokers has no suit or rank
  to stand for.
- In a group, the joker fills an unused suit of the group's natural rank. It cannot duplicate a
  natural suit.
- Jokers keep their own identity on the table and in save/network data. The interpretation is
  derived, never stored in place of the card.

### Joker strategy (guidance, not a rule)

The engine never blocks a legal joker play — these are hints the tutorial, help screen and the
AI personalities follow:

- Because the table is shared, playing a joker early can help other players.
- It is often best to save the joker for your final move.

## Turns

On your turn:

1. You may rearrange the table freely — **all melds on the table are shared**. Split them, merge
   them, move cards between them.
2. To confirm your play you must add **at least one card from your hand** to the table.
3. When you confirm, **every** meld on the table must be valid.
4. Cards that were already on the table when your turn began may never move into your hand or the
   draw pile. Cards *you* played this turn may be taken back until you confirm.
5. If you do not confirm a play, you **draw one card** and your turn ends.

**Draw only happens when you pass, cannot play, or will not play.** There is no draw at the start
of a turn.

**Turn timer — not in play.** `turnTimerSeconds` defaults to 0 (off) and nothing in the client
or the server starts a timer. The rules function exists (`timerExpireTurn`: revert the table to
the start of the turn, draw one card, end the turn) and is unit-tested, but it is an unused hook,
not a feature.

## Worked examples

| Cards | Result |
|---|---|
| Joker + 7♥ + Joker | **invalid** — `reason.tooManyJokers` (2 jokers) |
| Joker + 7♥ + 8♥ + Joker | **invalid** — `reason.tooManyJokers` |
| Joker + 7♥ + 8♥ | **valid** run (joker = 6♥ or 9♥) |
| 7♥ + Joker + 9♥ | **valid** run (joker = 8♥) |
| 7♥ + 7♠ + Joker | **valid** group (joker takes an unused suit) |
| 7♥ + Joker + Joker | **invalid** — `reason.tooManyJokers` |
| 7♥ (deck 1) + 7♥ (deck 2) + 7♣ | **invalid** group — `reason.groupDuplicateSuit`; two decks do not make ♥ two different suits |
| A♥ + 2♥ + 3♥ | **valid** run (ace low) |
| Q♠ + K♠ + A♠ | **valid** run (ace high) |
| K♠ + A♠ + 2♠ | **invalid** — `reason.runWrap`; an ace is low or high, never both |

## Draft vs final table

While it is your turn you may leave the table in any state — a two-card meld, a pile of jokers,
a half-split run. That is a **draft**, and nothing validates it except the on-screen feedback.

Validation happens at **FEITO**: every meld on the table must be valid, you must have added at
least one card from your hand, and no card that was on the table when your turn began may be
missing. Cards *you* played this turn can still be pulled back until you confirm.

## Where validation happens

`analyzeMeld` and `canConfirmTurn` in `src/rules/rules.ts` are the only implementations of these
rules. The client uses them to gate the FEITO button and to explain invalid melds; in an online
game the **server** calls the same functions on the submitted table before accepting anything, so
a client cannot confirm a turn the server would reject, and the two can never drift apart. See
[MULTIPLAYER.md](MULTIPLAYER.md).

## Configuration defaults

The engine carries hooks for these variants; none is enabled in a standard game:

| Hook | Default | Variant |
|---|---|---|
| `deckCount` | 2 | one deck |
| `jokersPerDeck` | 2 | 0 = a 52-card deck with no jokers |
| `groupMinSize` | 3 | fixed group minimum |
| `groupMaxSize` | 4 | fixed group maximum |
| `groupUniqueSuits` | true | fixed: natural group suits are all different |
| `allowAllJokerGroups` | false | fixed: every group needs a natural card |
| `firstMeldMinPoints` | 0 (off) | minimum points for a player's first meld |
| `turnTimerSeconds` | 0 (off) | timed turns — hook only, not wired into play |
| `handSize` | 7 | different deal size |

## Rejected variants

These appear in other Mexe-Mexe write-ups and are deliberately **not** used here: a 52-card-only
deck, drawing at the start of every turn, groups with repeated natural suits, and a first-meld
point minimum.
