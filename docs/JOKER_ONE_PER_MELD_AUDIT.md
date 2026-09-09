# Joker One-Per-Meld Audit

Audit taken before the rule change that limits every meld to at most one joker, plus the
strategy guidance that jokers are usually best saved for the final play.

## Current joker behaviour (before the change)

- `analyzeRun` accepted any number of jokers as long as the sliding rank window had exactly
  that many empty slots (`2D joker joker AD` was a valid A-2-3-4 run).
- `analyzeGroup` accepted up to one joker per *unused suit* of the group's natural rank, so a
  single natural plus two jokers was a legal trinca.
- All-joker melds were already rejected (`reason.groupAllJokers`), and a group whose jokers
  outnumbered the missing suits was rejected as `reason.jokerUnassignable`.
- No joker count limit existed anywhere: validator, server, AI or UI.

## Affected files

| Area | File | Change |
| --- | --- | --- |
| Validator | `src/rules/rules.ts` | joker-count guard in `analyzeRun` and `analyzeGroup` |
| Reason codes | `src/rules/types.ts` | new `reason.tooManyJokers` |
| Tests | `tests/rules.test.ts` | two obsolete 2-joker "valid" tests replaced; new `one joker per meld` suite |
| Tests | `tests/ai.test.ts` | 2-joker invariant over seeded games; joker-holding strategy tests |
| Tests | `tests/server/rooms.test.ts` | server rejects a 2-joker proposal |
| Tests | `tests/i18n.test.ts` | new reason key must exist in both locales |
| AI | `src/ai/ai.ts` | `holdJokers` preference; joker-count candidate tiebreak |
| Server | `server/rooms.ts` | none — it already calls the shared `canConfirmTurn` |
| UI copy | `src/localization/i18n.ts` | `reason.tooManyJokers`, `rules.body`, `tutorial.step6` (pt-BR + en-US) |
| Docs | `docs/RULES.md`, `README.md` | one-joker rule + strategy section |

## Old conflicting text

- `docs/RULES.md` said "each joker fills a different unused suit", implying multiple jokers per
  group — rewritten.
- `README.md` said "a group joker fills a different missing suit", same implication — rewritten.
- `rules.body` (both locales) described group jokers in the plural — rewritten.
- Tests `2D joker joker AD is valid` and `accepts one natural plus two jokers` asserted the old
  behaviour — replaced with the rejecting cases.

## Strategy guidance gaps

The AI had no notion of joker value: `SimpleAi` laid every meld it found, including
joker-assisted ones, and `RearrangerAi` ranked candidates purely by hand cards played. Nothing
in the tutorial, help screen or rules text mentioned that the shared table makes an early joker
a gift to the other players.

## Top risks

1. Save/network compatibility: `deserializeGameState` re-validates the table, so an old save
   holding a 2-joker meld now fails to load as a corrupt save. Accepted — the rule change makes
   that table illegal by definition.
2. AI joker-holding could deadlock a bot into never playing a joker. Mitigated: the hold is
   skipped whenever the play empties the hand, and juninho never holds at all.
3. Determinism: the candidate tiebreak is a pure comparison on joker counts, so replay
   determinism is unaffected (covered by the existing determinism tests).

## Changes made

Minimal: one guard per analyzer, one new reason code, one AI preference flag, plus copy. No
validator rewrite, no server-side change, no unrelated rule touched.
