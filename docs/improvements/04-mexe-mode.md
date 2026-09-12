# 04 — Mexe Mode

Goal: turn the core table-rearrangement mechanic into the signature tactile/puzzle moment of the game.

- **MEXE-01** Make entering Mexe Mode visibly distinct: board becomes editable, surrounding HUD quiets, table subtly lifts, brief `MEXE!` cue.
- **MEXE-02** Tune drag scale so dense boards remain readable; prefer lift/shadow over excessive enlargement.
- **MEXE-03** Add very small velocity-based card tilt during drag, capped to preserve readability.
- **MEXE-04** Preserve green/gold/red legality language and reinforce it with shape/motion, not color alone.
- **MEXE-05** Prefer in-place destination preview: target meld opens a slot/ghost. Use detached preview only when space requires it.
- **MEXE-06** Reframe temporary broken melds as unresolved work-in-progress, not failure.
- **MEXE-07** Show concise progress such as `1 combinação para resolver` while editing.
- **MEXE-08** Distinguish soft temporary invalidity from stronger final invalidity after a FEITO attempt.
- **MEXE-09** Make the unresolved→valid transition a signature moment: outlines clear, melds settle together, soft resolve sound, FEITO wakes up.
- **MEXE-10** Synchronize FEITO visual enablement with the existing accidental-confirm guard so it never looks clickable before it is.
- **MEXE-11** Recognize meaningful final committed transformations and show rare feedback such as `MEXEU BONITO!`; compare start/end state, not intermediate movement.
- **MEXE-12** Define simple/big/huge Mexe thresholds using existing moved-card/meld information, without exploitable move-count farming.
- **MEXE-13** Animate Undo/Redo where practical rather than hard-rerendering.
- **MEXE-14** Reset: immediate for small drafts; confirm only when significant work would be lost.
- **MEXE-15** Animate source meld closing and destination meld opening around card transfer.
- **MEXE-16** Preserve untouched meld positions; reflow only affected areas unless collisions require broader movement.
- **MEXE-17** Animate cards returning from table to hand with a distinct reverse-commit motion/sound.
- **MEXE-18** In guided mode, optionally expose a compact table-integrity/problem count.
- **MEXE-19** Make invalid explanations spatial: highlight conflicting cards, show missing run slot, point to exact problem.
- **MEXE-20** Give jokers visible current assignment and animate assignment change when moved.
- **MEXE-21** Give Mexe an audio identity: slightly more energy while editing, subtle tension while unresolved, resolve when valid.

Verification: simple add, multi-meld rearrange, invalid intermediate state, joker cases, undo/redo/reset, crowded table, reduced motion, mobile focus editor.
