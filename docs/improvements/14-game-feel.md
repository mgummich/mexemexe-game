# 14 — Global Visual / Audio Feel

Goal: create one coherent physical/emotional language across the game instead of unrelated effects.

- **JUICE-01** Define impact levels: tiny, normal, strong, major; reserve major effects for rare events.
- **JUICE-02** Standardize pickup: lift, shadow, modest scale, tiny tilt, soft sound.
- **JUICE-03** Standardize valid drop: target opens, card snaps, small overshoot/settle, crisp sound.
- **JUICE-04** Standardize invalid drop: soft rejection, readable glide back, muted sound.
- **JUICE-05** Standardize return-to-hand: hand opens, card enters, hand recenters.
- **JUICE-06** Use short anticipation before strong impacts such as FEITO/BATER.
- **JUICE-07** Keep global camera movement extremely restrained and rare.
- **JUICE-08** Make table-valid completion a signature synchronized settle/resolution effect.
- **JUICE-09** Use particles only for rare strong/major moments; normal play relies on cards, sound and alignment.
- **JUICE-10** Define a sound vocabulary: pickup, place, snap, invalid, undo, draw, table solved, FEITO, BATER, threat, win, stalemate/loss.
- **JUICE-11** Add subtle sample/pitch/volume variation to frequent card sounds to reduce fatigue.
- **JUICE-12** Drive layered music intensity from match state instead of constant track switching where architecture/assets support it.
- **JUICE-13** Give AI a small reusable reaction set: idle, think, pleased, surprised, annoyed, near-win, win, loss.
- **JUICE-14** Enforce reaction cooldowns and no-immediate-repeat behavior.
- **JUICE-15** Standardize timing bands (fast/normal/expressive/major) and easing so scenes feel related.
- **JUICE-16** Reduced motion must preserve semantic state via highlight/instant reposition rather than simply removing feedback.
- **JUICE-17** Centralize a small set of presentation constants where that reduces scattered magic numbers; do not create a large framework.
- **JUICE-18** Prefer semantic presentation events such as TABLE_BECAME_VALID, BIG_MEXE, PLAYER_REACHED_ONE_CARD, PLAYER_BATEU if existing architecture benefits from them.
- **JUICE-19** Define big-Mexe thresholds from committed start/end state, not intermediate motion.
- **JUICE-20** Keep the board visually quiet between events; no constant pulsing/glow.
- **JUICE-21** Use low-frequency environmental ambience to create life without covering cards.
- **JUICE-22** Spend the largest effects budget on BATER/victory; losing still receives a polished readable finish.
- **JUICE-23** Every effect should primarily communicate what changed, what is interactable, validity, turn ownership or importance.
- **JUICE-24** Add a dev-only feel-testing state if it can be done cheaply, with triggers for pickup/snap/invalid/table solved/big Mexe/last card/FEITO/BATER/AI reaction/victory.

Verification: normal/reduced motion, audio settings, repeated actions for fatigue, mobile performance, scene cleanup.
