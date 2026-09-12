# 08 — Final 1–3 Cards / Endgame

Goal: make the existing rules produce a clear climax before the results screen.

- **END-01** At 3 cards, add subtle attention only.
- **END-02** At 2 cards, present a clear threat state and mild audio escalation.
- **END-03** At 1 card, trigger a brief unmistakable `ÚLTIMA CARTA` moment near the relevant player.
- **END-04** Treat the local player's last card as the focal hand object; treat opponent last card as a threat at their seat.
- **END-05** Promote late-game hand counts in HUD hierarchy.
- **END-06** Give the final hand card slightly stronger pickup/drop/audio treatment without excessive slow motion.
- **END-07** Never declare victory merely because the hand reaches zero; table legality still decides whether the player can finish.
- **END-08** Add a special hand-empty/table-unresolved state such as `QUASE! ARRUME A MESA PARA BATER.`
- **END-09** When hand is empty and table becomes valid, show `PODE BATER!`.
- **END-10** Change FEITO to `BATER!` when that confirmation will win the match.
- **END-11** Let the player own the final BATER click; do not auto-win before confirmation.
- **END-12** Add a short in-table victory beat before transitioning to results; current board should visibly resolve first.
- **END-13** Fully animate an opponent's winning move before announcing the result.
- **END-14** Detect presentation-only win types such as comeback, close race, large Mexe or simple finish.
- **END-15** Use layered endgame audio: subtle tension at 2, stronger at 1, resolve/drop before BATER, sting on win.
- **END-16** Treat deck-exhaustion ending differently from batting out.
- **END-17** Make low deck visibly thin and optionally show current fewest-card standing when exhaustion becomes imminent.
- **END-18** Make the final draw-pile card and `FIM DO BARALHO` outcome readable.

Verification: player win, AI win, empty-hand invalid table, final valid table, deck exhaustion, 3/2/1-card thresholds, reduced motion.
