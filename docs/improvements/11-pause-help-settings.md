# 11 — Pause / Rules / Settings / Help

Goal: make support UI a quick pit stop that preserves match context and answers the current question.

- **SUPPORT-01** Keep Pause lightweight over the visible board; Continue dominant, Quit clearly dangerous/secondary.
- **SUPPORT-02** If progress-safety reassurance is needed, consider showing it only in early pauses instead of permanently.
- **SUPPORT-03** Convert Rules into a one-screen visual quick reference; place full text behind `VER REGRAS COMPLETAS`.
- **SUPPORT-04** Use card examples for runs/sets/ace/joker rules where possible instead of paragraphs.
- **SUPPORT-05** Add contextual Help that explains current state: disabled FEITO, selected joker, what to do now, table focus, etc.
- **SUPPORT-06** Add `show me` behavior that can focus/highlight the current problem where useful.
- **SUPPORT-07** Separate Rules (`what is legal`) from Controls (`how to perform it`), potentially via compact tabs.
- **SUPPORT-08** Simplify default Settings to common controls; keep power/test options behind More/Advanced.
- **SUPPORT-09** Move table theme/card back/avatar toward a `PERSONALIZAR` experience rather than burying fun customization in Settings, if scope allows.
- **SUPPORT-10** Keep play-log export/diagnostic/test controls in Advanced or dev-facing surfaces.
- **SUPPORT-11** Apply/preview audio, text, motion and cosmetic changes immediately; avoid Save/Apply unless technically required.
- **SUPPORT-12** Rename assistance levels so they cannot be confused with AI difficulty; e.g. assistance Complete/Normal/Minimal vs AI Casual/Normal/Hard.
- **SUPPORT-13** Preserve Mexe draft, undo history, focus/zoom and validation state through Pause → nested Settings/Rules → return.
- **SUPPORT-14** Add regression coverage for pausing mid-complex draft.
- **SUPPORT-15** Online overlays must not say `PAUSADO` if server time continues; state clearly that the match continues.
- **SUPPORT-16** Replace Yes/No quit confirmation with explicit `CONTINUAR JOGANDO` / `ABANDONAR`.
- **SUPPORT-17** Make Esc/back behavior predictable across gameplay, pause, nested panels and quit confirmation.

Verification: local/online overlay behavior, mid-draft persistence, large text, reduced motion, keyboard/back behavior, mobile.
