# 15 — Accessibility / Visual Readability

Goal: preserve the same rules and information for players with reduced vision, color-vision differences, motion sensitivity, motor imprecision or higher cognitive load.

- **ACCESS-01** Never communicate validity, selection, threat or disabled state by color alone; pair color with shape, stroke, icon, label or motion where appropriate.
- **ACCESS-02** Preserve and extend the existing large-text option; new copy/control layouts must remain usable at large text sizes.
- **ACCESS-03** Preserve reduced-motion support for every new animation; replace motion with equivalent highlight/state change rather than removing information.
- **ACCESS-04** Maintain readable rank/suit information at supported card sizes, especially crowded late-game tables and long mobile hands.
- **ACCESS-05** Verify text/background contrast for labels, badges, tooltips, disabled controls and threat states.
- **ACCESS-06** Keep primary touch/click targets comfortably larger than their visible artwork where needed; compact utilities must not become hard to hit.
- **ACCESS-07** Provide touch/keyboard equivalents for critical hover-only information.
- **ACCESS-08** Keep focus/back/keyboard behavior predictable in overlays and primary controls where keyboard support exists.
- **ACCESS-09** Treat cognitive accessibility explicitly: assistance modes should clearly describe how much guidance they provide and must not be confused with AI difficulty.
- **ACCESS-10** Prefer short contextual explanations and spatial problem highlighting over dense rule prose.
- **ACCESS-11** Ensure warning/error copy remains visible long enough to read and does not disappear solely because an animation ended.
- **ACCESS-12** Keep high-frequency feedback multi-channel where appropriate: visual + sound, and optional haptics on supported mobile devices.
- **ACCESS-13** Do not require audio to understand a legal/illegal state or turn change.
- **ACCESS-14** Do not require motion to understand a state change in reduced-motion mode.
- **ACCESS-15** Test worst-case combinations: large text + portrait + crowded table + invalid draft; reduced motion + endgame; color-independent legality states.

Verification: representative desktop/mobile screenshots and runtime interaction in default, large-text and reduced-motion modes; inspect all new color-coded states without relying on color alone.
