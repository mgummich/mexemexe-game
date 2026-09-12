# 15 — Playtesting / Telemetry

Goal: validate the experience with real behavior before adding major new systems.

- **TELEMETRY-01** Run real first-time-player playtests; code review alone is insufficient.
- **TELEMETRY-02** Record every hesitation longer than a few seconds during silent/uncoached sessions.
- **TELEMETRY-03** Capture full-match screen recordings for frame-by-frame review.
- **TELEMETRY-04** Use deterministic showcase states as repeatable visual regression checkpoints.
- **TELEMETRY-05** Track invalid FEITO attempts.
- **TELEMETRY-06** Track Undo/Redo/Reset usage.
- **TELEMETRY-07** Track time spent with unresolved tables and problem type.
- **TELEMETRY-08** Track turn duration, draw vs play, cards played, table cards moved, hand sizes and deck remaining.
- **TELEMETRY-09** Compare desktop/mobile failed drags, cancelled drags, destination mis-taps and immediate Undo-after-drop rates.
- **TELEMETRY-10** Track zoom/focus/orientation usage on mobile where privacy/product policy allows.
- **TELEMETRY-11** Track tutorial start → first successful Mexe time.
- **TELEMETRY-12** Track tutorial completion → first real game start.
- **TELEMETRY-13** Track first real game → second game/rematch.
- **TELEMETRY-14** Ask players explicitly when a long match began to feel slow.
- **TELEMETRY-15** Use evidence to determine whether repetition comes from draw streaks, AI timing, interaction friction, low table complexity or presentation.
- **TELEMETRY-16** Fix observed friction before using progression/random-rule systems to mask it.

Guardrails: use existing logging where possible; do not create invasive analytics infrastructure solely for this backlog. Respect privacy and product policy.
