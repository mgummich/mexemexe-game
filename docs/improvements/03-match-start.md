# 03 — Match Start / First Turn

Goal: make the first 5–10 seconds readable, tactile and low-cognitive-load.

- **START-01** Animate the initial deal instead of rendering the fully dealt state instantly; keep normal sequence under ~2 s and allow reduced-motion/fast rematch shortening.
- **START-02** Use the deal to establish deck position, player ownership and opponent seating.
- **START-03** Make `SUA VEZ` a clear 400–600 ms transition that then collapses into normal HUD.
- **START-04** Visually activate the player's hand on their turn and let it recede on opponent turns.
- **START-05** Keep first-turn hierarchy focused on cards → `COMPRAR` → `FEITO` when relevant; secondary tools stay quiet.
- **START-06** Keep FEITO visually dormant until a meaningful draft begins, then progressively emphasize it.
- **START-07** Improve pickup feel with lift, shadow, modest scale and pickup sound.
- **START-08** Valid drop: snap + settle + crisp sound. Invalid drop: gentle rejection + readable return.
- **START-09** In guided assistance, show spatial ghost destinations rather than text-heavy instruction.
- **START-10** Treat an empty first-turn table as a simpler state with subtle run/set guidance.
- **START-11** Add progressive hesitation help: nothing initially, then a small contextual hint such as `Sem jogo? Compre uma carta.`
- **START-12** Animate `COMPRAR`: deck card travels into hand, hand opens/re-fans, then turn passes.
- **START-13** Transition agency clearly: player hand settles, opponent seat activates, then opponent turn starts.

Verification: first game, rematch, reduced motion, long/short hands, empty table, guided/normal assistance.
