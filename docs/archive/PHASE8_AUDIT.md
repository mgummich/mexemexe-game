# Phase 8 audit — online beta to playtest-ready public demo

Inspection pass: Haiku (read-only, `phase8-low-audit-01`); judgement and this document: main model.
Baseline measured at the start of the phase: `npm test` 219/219 green, `npm run lint` clean,
working tree carrying the uncommitted Phase 7 beta + trincas work.

## Phase 7 status

Phase 7 closed the beta blockers it set out to close, and the evidence is in the tree:
protocol **v3** with server-side socket liveness probes, a 16 KiB inbound frame cap, a
per-revision `hash` digest on `GameView` with client-side mismatch detection, a
client-initiated `resync` message, stalled-seat recovery (the server draws-and-ends for a
seat gone past grace so a 3P/4P match cannot freeze), `reqId` echoed on errors, an
in-canvas join-code input replacing `window.prompt()`, and a stated reason on the greyed-out
lobby START button. Rules were separately adapted to the final ruleset (2×54 deck, 4 jokers,
ace high/low, exact 3–4 card trincas with unique natural suits).

What Phase 7 did *not* address is everything a stranger sitting down in front of the game
needs, which is exactly Phase 8's scope.

## Demo blockers

1. **No instrumentation whatsoever.** One `console.warn` in the whole client (the desync
   detector at `src/scenes/GameScene.ts:305`). A playtest that produces no record of what
   testers did is a playtest that produces anecdotes. There is a typed `EventBus`
   (`src/core/events.ts`, 7 events) that already carries most of the interesting moments —
   nothing consumes it for analysis.
2. **The tutorial does not teach the current rules.** `src/tutorial/script.ts` has 10 steps
   (goal, set, run, extend, mexe-explain, rebuild, invalid, feito, comprar, win) written
   against the pre-adaptation ruleset. It never mentions jokers — the deck now has four of
   them — and it teaches "set" with four 9s without ever stating the two constraints that
   actually reject player melds today: a group is exactly 3–4 cards, and every card in it
   must be a different suit. A tester will meet `reason.groupDuplicateSuit` having been
   taught nothing about it.
3. **No rapid-input protection in the lobby.** `OnlineScene` gates START on `allReady` and
   JOIN on a non-empty code, but nothing debounces the click itself. A tester who
   double-clicks CREATE gets two `create_room` messages in flight.
4. **Server-unavailable has no dedicated copy.** A failed initial connection surfaces through
   the same generic error channel as a rejected proposal.

## Tutorial friction

Beyond the missing joker/trinca content: the 10 steps are linear with no visible progress,
and while `tutorial.skip` / `tutorial.replay` strings exist, dropping out mid-tutorial leaves
no record of *where* a tester gave up — which is the single most valuable onboarding
measurement a playtest can produce.

## UX confusion

Invalid-action explanation is in better shape than expected: all 14 rule reason codes plus the
three server codes (`notYourTurn`, `alreadySubmitted`, `staleRevision`) are mapped to PT and EN
strings (`src/localization/i18n.ts:83-96` PT, `:212-226` EN). The gap is not the vocabulary,
it is that a rejected FEITO shows a reason for a moment and nothing accumulates — a tester
cannot tell you afterwards which rule kept biting them. That is an instrumentation gap wearing
a UX costume.

## Balance and pacing risks

`DEFAULT_RULES` (`src/rules/types.ts:43-53`) is already a centralized knob block —
`deckCount: 2`, `jokersPerDeck: 2`, `maxGroupSize/groupMaxSize: 4`, `groupMinSize: 3`,
`groupUniqueSuits: true`, `handSize: 7`, `firstMeldMinPoints: 0` (hook only), `turnTimerSeconds: 0`
(off). Phase 8 should **not** build a second config system next to it.

- **Turn timer is declared but never implemented.** `turnTimerSeconds: 0` means the field is
  read by nobody. For a playtest this is the right default (a timer punishes a first-time
  player mid-Mexe-draft), but it should stay a documented off-by-default knob, not a promise.
- **Joker pacing is the real unknown.** Four jokers in a 108-card deck with 7-card hands, and
  no tutorial coverage. Whether that reads as generous or chaotic is a measurement, not a
  guess — log joker usage rather than tuning it blind.
- **AI difficulty is a personality choice, not a slider.** Two engines (`SimpleAi`,
  `RearrangerAi`) are wrapped by four personalities (`cida`, `juninho`, `bia`, `ze`), pickable in
  the setup screen; there is no separate Easy/Normal/Hard control and no pacing delay constant
  (the 400ms figure is a search deadline, not think time). The ladder is real but implicit — the
  honest move is to document it as the difficulty ladder rather than add a label nothing
  implements.

## Multiplayer tester-risk areas

Server authority is sound and unchanged: proposals carry ids and a revision, never suit/rank;
hands are redacted per seat; card conservation is asserted. The residual risk is all client-side
and all about impatient humans — double-clicks, refresh mid-room, create/join/leave loops,
and a server that is simply not running. `room_closed` is handled; room-full and
connection-refused are not distinguished for the player.

## Instrumentation gaps

No session log, no export, no invalid-FEITO record, no turn duration, no tutorial drop-off
point, no disconnect/reconnect/desync counters surfaced anywhere but `__MEXE__.desyncs()`.

## Privacy concerns

Whatever is added must stay local. No network sink, no identifiers beyond the session-scoped
room code and seat index the debug API already exposes, no player-typed names in exported logs
(names are free text a tester may put anything into). Export must be an explicit human action,
not a background upload.

## Verify and deployment gaps

`npm run verify` (31 local e2e) and `npm run verify:multiplayer` (2P flow + 3P/4P rotation)
both pass, but neither exercises a first-run tutorial completion, a server-unavailable launch,
or the new instrumentation. There is no single "public demo" gate a person can run before
handing the URL to a tester.

## Top 10 tasks

1. Session-local play log built on the existing `EventBus`, with JSON export from the debug API.
2. Log the measurements that decide Phase 9: invalid-FEITO reasons, turn duration, draw/pass
   frequency, undo/reset counts, tutorial step reached, disconnect/reconnect/desync/reject counts.
3. Tutorial steps for jokers and for the exact-size / unique-suit trinca constraints.
4. Tutorial drop-off recording (which step a skip happened on).
5. Click debounce on lobby CREATE/JOIN/READY/START.
6. Distinct, translated copy for server-unavailable and room-full.
7. Document `DEFAULT_RULES` as the balance knob block; keep the turn timer off by default and
   say so.
8. Document the four AI personalities as the difficulty ladder instead of adding a fake one.
9. A public-demo verify pass covering first-run tutorial, PT and EN, and server-unavailable UX.
10. `docs/PLAYTEST_GUIDE.md` — how to run, what to test, how to report, what the logs contain
    and what they deliberately do not.
