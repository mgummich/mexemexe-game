# MEXE! — Audio Direction

*Drafted by Fable; implementation-facing details reviewed by Sonnet in the
release-docs wave.*

## Pillars

- **Tactile, dry, short.** Card sounds are paper and wood, not synths trying
  to be music. Under 150ms for interactions.
- **Warm celebration.** Confirm/win use triadic pluck arpeggios (C-E-G family)
  — cavaquinho spirit, not fanfare bombast.
- **Quiet by default.** Ambience sits far below SFX; the game must feel
  complete with audio muted.

## Palette (all procedural — scripts/gen-sfx.mjs; PixelLab has no audio)

| Cue | Character | Notes |
|---|---|---|
| pickup / drop / snap | papery noise burst + soft blip | drag feedback triad; snap slightly brighter |
| deal / draw | layered paper swishes | draw has a low falling tone = "resign" feel |
| feito | 3-note rising triad | the signature "arrumei!" moment |
| win | 4-note major arpeggio, longer tail | loudest cue in the mix |
| invalid | two falling low tones | gentle "uh-uh", never harsh/buzzer |
| click | tiny tick | UI only |
| ambience | 7s loop: cricket bed + sparse warm plucks | evening boteco; optional, muteable |

## Mix rules

- Loudness order: win > feito > invalid > drop/draw > pickup/snap > click > ambience.
- No cue may clip or startle; keep peak amplitudes ≤0.5 before user volume.
- Every cue routed through settings (mute, SFX slider); ambience through the
  music slider. Missing files are silent no-ops.
- No flashing-adjacent audio strobing (no rapid repeats <80ms apart).
