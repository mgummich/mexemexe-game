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
  Gains in `scripts/gen-sfx.mjs` are scaled per cue to hit this order; peaks
  stay ≤0.5 before user volume.
- Every cue routed through settings (mute, SFX slider); ambience through the
  music slider. Missing files are silent no-ops.
- No flashing-adjacent audio strobing (no rapid repeats <80ms apart) — now
  enforced in code, not just in the mix: `src/audio/sfx.ts` drops a same-key
  `playSfx` call that lands within 80ms of the previous one for that key,
  instead of letting two copies stack into a louder spike. Debounce is
  per-key (`sfx-drop` and `sfx-snap` back to back both still play).
- `scripts/gen-sfx.mjs` re-run (Phase 9 balance pass) reproduced the
  checked-in WAVs byte-for-byte (seeded RNG, no `Math.random()`) — no asset
  regeneration was needed this pass, the existing gains already matched the
  loudness order above.

## Music (Phase 9: context-aware playlist)

`src/audio/music.ts` picks tracks by scene context instead of a flat
shuffle, so the player gets calmer music while heads-down in a Mexe draft:

| Context | Tracks | Why |
|---|---|---|
| `menu` | boteco-table, cafe-pixelado | short ambient loops, fine to loop while browsing menus |
| `mexe` (drafting a turn) | boteco-table, cafe-pixelado | same calm pair — concentration moment, avoid pulling focus |
| `game` (general play, opponents' turns) | full-song-1/2/3 | fuller songs carry the table's energy between your turns |

Scenes only call `setMusicContext('menu' \| 'game' \| 'mexe')`; the module
owns track selection (fixed round-robin per context — no `Math.random()`),
crossfade, and the reduced-motion shortcut (fade duration is scaled by
`settings.motionScale()`, so reduced motion swaps instantly instead of
skipping the transition outright). A context with no tracks assigned falls
back to the full 5-track catalog rather than playing nothing.

Settings panel: a `settings.musicContext` toggle (Ligado/Desligado — pt/en
via `t()`) switches between context-aware selection and the original plain
shuffle across all 5 tracks, on top of the existing mute + SFX/music volume
sliders and the music on/off switch.
